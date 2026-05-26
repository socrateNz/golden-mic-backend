import { candidateRepository } from '@/repositories/candidateRepository';
import { transactionRepository } from '@/repositories/transactionRepository';
import { voteRepository } from '@/repositories/voteRepository';
import { auditRepository } from '@/repositories/auditRepository';
import { calculatePoints, generateTransactionReference, generateIdempotencyKey } from '@/utils/helpers';
import { sendVoteConfirmationEmail } from '@/lib/resend';
import { createNotchPayTransaction } from '@/lib/notchpay';
import type { InitiateVoteInput } from '@/validators/schemas';
import type { TransactionRow } from '@/repositories/transactionRepository';

const NOTCHPAY_BASE_URL = 'https://api.notchpay.co';
const AGGREGATOR_POLL_INTERVAL_MS = 5000;
/** ~10 min max — évite une boucle infinie si le webhook complète jamais. */
const AGGREGATOR_POLL_MAX_ROUNDS = 120;
/** Si l’API GET renvoie 404 à répétition, on s’appuie sur le webhook NotchPay (source de vérité). */
const AGGREGATOR_POLL_STOP_AFTER_CONSECUTIVE_404 = 3;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function updatePaymentWithRetry<T>(
  fn: () => Promise<T>,
  retries = 5,
  delay = 500
): Promise<T> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= retries) {
        console.error(`[voteService:updatePaymentWithRetry] All ${retries} attempts failed. Error:`, err);
        throw err;
      }
      const backoffDelay = delay * Math.pow(2, attempt - 1);
      console.warn(`[voteService:updatePaymentWithRetry] Attempt ${attempt} failed. Retrying in ${backoffDelay}ms...`, err);
      await sleep(backoffDelay);
    }
  }
  throw new Error('Unreachable code in retry helper');
}

type PaymentActor = 'webhook' | 'system';

function notchPayRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: process.env.NOTCHPAY_PUBLIC_KEY!,
  };
  if (process.env.NOTCHPAY_SECRET_KEY) {
    headers['X-Grant'] = process.env.NOTCHPAY_SECRET_KEY;
  }
  return headers;
}

function getNotchPayPaymentTtlMinutes(): number {
  const raw = process.env.NOTCHPAY_PAYMENT_TTL_MINUTES;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 5) return 30;
  if (n > 24 * 60) return 24 * 60;
  return n;
}

async function cancelNotchPayPaymentByReference(reference: string): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${NOTCHPAY_BASE_URL}/payments/${encodeURIComponent(reference)}`, {
    method: 'DELETE',
    headers: notchPayRequestHeaders(),
  });
  return { ok: res.ok, status: res.status };
}

async function expirePaymentSessionLocally(
  row: TransactionRow,
  reference: string,
  meta: { ipAddress: string; userAgent: string }
) {
  const del = await cancelNotchPayPaymentByReference(reference);
  console.warn('[vote:expire] session de paiement expirée (TTL)', {
    reference,
    notchpayDeleteHttp: del.status,
    notchpayDeleteOk: del.ok,
  });

  await transactionRepository.updateStatus(row.id, 'cancelled');

  await auditRepository.log({
    event_type: 'vote.payment_session_expired',
    entity_type: 'transaction',
    entity_id: row.id,
    actor_type: 'system',
    details: {
      reference,
      payment_expires_at: row.payment_expires_at,
      notchpay_delete_status: del.status,
    },
    ip_address: meta.ipAddress,
    severity: 'info',
  });
}

function isPaymentSessionExpired(row: TransactionRow): boolean {
  if (!row.payment_expires_at) return false;
  const t = new Date(row.payment_expires_at).getTime();
  return Number.isFinite(t) && Date.now() >= t;
}

async function notchPayGetPaymentJson(referenceOrId: string): Promise<{
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
}> {
  const res = await fetch(`${NOTCHPAY_BASE_URL}/payments/${encodeURIComponent(referenceOrId)}`, {
    method: 'GET',
    headers: notchPayRequestHeaders(),
  });
  let body: Record<string, unknown> | null = null;
  try {
    const text = await res.text();
    if (text) {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    }
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

function transactionObjectFromBody(body: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!body) return null;

  // Option 1 : Objet transaction encapsulé (réponse d'initiation)
  const tx = body.transaction;
  if (typeof tx === 'object' && tx !== null && !Array.isArray(tx)) {
    return tx as Record<string, unknown>;
  }

  // Option 2 : Objet data encapsulé (réponse standard GET /payments/{ref})
  const data = body.data;
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }

  // Option 3 : Propriétés au premier niveau (si le corps a directement un status)
  if (typeof body.status === 'string') {
    return body;
  }

  return null;
}

type NotchPayAggregatorFetch = {
  transaction: Record<string, unknown> | null;
  /** Dernier code HTTP utile (ex. 404 si la référence n’existe pas côté API retrieve). */
  lastHttpStatus: number;
};

/**
 * Récupère l’objet transaction chez NotchPay.
 * L’API peut renvoyer `transaction` comme objet complet ou comme identifiant (ex. trx.*) :
 * dans ce cas on refait un GET sur cet identifiant. On essaie aussi `notchpay_id` stocké en BD.
 */
async function fetchNotchPayTransaction(
  integrationReference: string,
  notchpayId: string | null
): Promise<NotchPayAggregatorFetch> {
  const keysToTry = [integrationReference, notchpayId].filter((k): k is string => Boolean(k && k.length > 0));
  const seen = new Set<string>();
  let lastStatus = 0;

  for (const key of keysToTry) {
    if (seen.has(key)) continue;
    seen.add(key);

    const first = await notchPayGetPaymentJson(key);
    lastStatus = first.status;

    let obj = transactionObjectFromBody(first.body);
    if (obj) return { transaction: obj, lastHttpStatus: first.status };

    const txField = first.body?.transaction;
    if (typeof txField === 'string' && txField.length > 0 && !seen.has(txField)) {
      seen.add(txField);
      const second = await notchPayGetPaymentJson(txField);
      lastStatus = second.status;
      obj = transactionObjectFromBody(second.body);
      if (obj) return { transaction: obj, lastHttpStatus: second.status };
    }
  }

  return { transaction: null, lastHttpStatus: lastStatus };
}

/** Quand NotchPay ne renvoie pas `transaction.id`, on dérive un identifiant depuis l’URL de checkout. */
function extractNotchPayIdFromInitPayload(notchPayData: Record<string, unknown>): string | null {
  const tx = notchPayData.transaction;
  if (typeof tx === 'object' && tx !== null && !Array.isArray(tx)) {
    const id = (tx as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  const url = notchPayData.authorization_url ?? notchPayData.checkout_url;
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const pathname = new URL(url).pathname;
    const segment = pathname.split('/').filter(Boolean).pop();
    return segment && segment.length > 0 ? segment : null;
  } catch {
    return null;
  }
}

function getNotchPayWebhookEventType(event: Record<string, unknown>): string {
  const raw = event.event ?? event.type;
  return typeof raw === 'string' ? raw : '';
}

function getNotchPayWebhookData(event: Record<string, unknown>): Record<string, unknown> {
  const d = event.data;
  if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
    return d as Record<string, unknown>;
  }
  if (typeof event.reference === 'string') {
    return event as Record<string, unknown>;
  }
  return {};
}

function referenceFromNotchWebhookData(data: Record<string, unknown>): string | null {
  const keys = [data.reference, data.integration_reference, data.integrationReference];
  for (const c of keys) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  const nested = data.transaction;
  if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
    const t = nested as Record<string, unknown>;
    const r = t.reference ?? t.integration_reference;
    if (typeof r === 'string' && r.length > 0) return r;
  }
  return null;
}

/** Normalise le corps `data` pour `payment.complete` (référence / statut / montant). */
function normalizePaymentCompleteData(data: Record<string, unknown>): Record<string, unknown> {
  const nested = data.transaction;
  if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
    const t = nested as Record<string, unknown>;
    return {
      ...t,
      ...data,
      reference: (typeof data.reference === 'string' && data.reference ? data.reference : t.reference) as string,
      status: (data.status as string) ?? (t.status as string),
      amount: data.amount !== undefined && data.amount !== null ? data.amount : t.amount,
    };
  }
  return data;
}

async function applyTerminalPaymentFromWebhook(
  data: Record<string, unknown>,
  nextStatus: 'failed' | 'cancelled',
  meta: { ipAddress: string; userAgent: string }
) {
  const reference = referenceFromNotchWebhookData(data);
  if (!reference) {
    return { processed: false as const, message: 'Référence manquante dans le webhook' };
  }

  const transaction = await transactionRepository.findByReferenceOrNotchpayId(reference);
  if (!transaction) {
    return { processed: false as const, message: 'Transaction introuvable' };
  }

  if (transaction.webhook_validated || transaction.status === 'complete') {
    return { processed: false as const, message: 'Déjà finalisé', alreadyProcessed: true };
  }

  if (transaction.status !== 'processing' && transaction.status !== 'pending') {
    return { processed: false as const, message: 'Statut déjà définitif' };
  }

  await transactionRepository.updateStatus(transaction.id, nextStatus);

  await auditRepository.log({
    event_type: nextStatus === 'failed' ? 'vote.payment_failed' : 'vote.payment_cancelled',
    entity_type: 'transaction',
    entity_id: transaction.id,
    actor_type: 'webhook',
    details: { reference, nextStatus },
    ip_address: meta.ipAddress,
    severity: 'info',
  });

  return { processed: true as const, reference, status: nextStatus };
}

function isTransactionAwaitingAggregator(row: TransactionRow): boolean {
  if (row.status === 'processing') return true;
  return row.status === 'pending' && row.notchpay_id != null;
}

/**
 * Applique une mise à jour de paiement (webhook ou vérif. agrégateur) : idempotence, points, vote.
 */
async function finalizeFromPaymentData(
  data: Record<string, unknown>,
  meta: { ipAddress: string; userAgent: string; actorType: PaymentActor }
) {
  const reference = data?.reference as string;
  const status = data?.status as string;
  const amount = Number(data?.amount ?? 0);

  const transaction = await transactionRepository.findByReferenceOrNotchpayId(reference);
  if (!transaction) {
    await auditRepository.logFraud({
      ip_address: meta.ipAddress,
      user_agent: meta.userAgent,
      attempt_type: 'unknown_reference',
      details: { reference },
    });
    throw new Error('Transaction introuvable');
  }

  const idempotencyKey = generateIdempotencyKey(reference, 'payment.complete');
  const existingProcessed = await transactionRepository.findByIdempotencyKey(idempotencyKey);
  if (existingProcessed?.webhook_validated) {
    return { message: 'Déjà traité', alreadyProcessed: true };
  }

  if (status !== 'complete') {
    if (transaction.status === 'processing' || transaction.status === 'pending') {
      await transactionRepository.updateStatus(transaction.id, 'failed');
    }
    return { message: 'Paiement non complété', success: false };
  }

  if (Math.abs(amount - transaction.amount) > 0) {
    await auditRepository.logFraud({
      ip_address: meta.ipAddress,
      user_agent: meta.userAgent,
      attempt_type: 'amount_mismatch',
      details: { expected: transaction.amount, received: amount, reference },
      transaction_reference: reference,
    });
    throw new Error('Montant incohérent');
  }

  const points = calculatePoints(transaction.amount);

  await updatePaymentWithRetry(async () => {
    await voteRepository.create({
      transaction_id: transaction.id,
      candidate_id: transaction.candidate_id,
      points,
      amount: transaction.amount,
      voter_phone: transaction.voter_phone ?? undefined,
      voter_name: transaction.voter_name ?? undefined,
      ip_address: meta.ipAddress,
    });

    await candidateRepository.incrementPoints(transaction.candidate_id, points);

    await transactionRepository.markWebhookValidated(transaction.id, {
      ...data,
      idempotency_key: idempotencyKey,
    });
  });

  if (transaction.voter_email && transaction.voter_name) {
    const candidate = await candidateRepository.findById(transaction.candidate_id);
    await sendVoteConfirmationEmail({
      to: transaction.voter_email,
      voterName: transaction.voter_name,
      candidateName: candidate?.artist_name ?? 'le candidat',
      amount: transaction.amount,
      points,
    });
  }

  await auditRepository.log({
    event_type: 'vote.completed',
    entity_type: 'vote',
    entity_id: transaction.id,
    actor_type: meta.actorType === 'webhook' ? 'webhook' : 'system',
    details: { reference, amount: transaction.amount, points, candidateId: transaction.candidate_id, source: meta.actorType },
    ip_address: meta.ipAddress,
    severity: 'info',
  });

  return { success: true, points, reference };
}

export const voteService = {
  /**
   * Initie un vote : crée la transaction et appelle NotchPay.
   */
  async initiateVote(
    input: InitiateVoteInput,
    meta: { ipAddress: string; userAgent: string }
  ) {
    const candidate = await candidateRepository.findById(input.candidateId);
    if (!candidate) {
      throw new Error('Candidat introuvable ou non approuvé');
    }

    const reference = generateTransactionReference();

    const transaction = await transactionRepository.create({
      reference,
      candidate_id: input.candidateId,
      voter_name: input.voterName,
      voter_email: input.voterEmail,
      voter_phone: input.voterPhone,
      amount: input.amount,
      currency: 'XAF',
      status: 'pending',
      ip_address: meta.ipAddress,
      user_agent: meta.userAgent,
    });

    const ttlMinutes = getNotchPayPaymentTtlMinutes();
    const paymentExpiresAtIso = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    let notchPayResult;
    try {
      notchPayResult = await createNotchPayTransaction({
        amount: input.amount,
        email: input.voterEmail ?? 'vote@golden-mic-237.cm',
        phone: input.voterPhone,
        reference,
        description: `Vote pour ${candidate.artist_name} — Golden Mic 237`,
        callbackUrl: `${process.env.FRONTEND_URL}/vote/success?ref=${reference}`,
        ipAddress: meta.ipAddress,
        ttlMinutes,
        paymentExpiresAtIso,
      });
    } catch (err: any) {
      console.error('[vote:initiate] Direct NotchPay creation error', {
        reference,
        error: err.message,
      });
      await transactionRepository.updateStatus(transaction.id, 'failed');
      throw err;
    }

    await transactionRepository.updateStatus(transaction.id, 'processing', {
      notchpay_id: notchPayResult.reference || notchPayResult.notchpayId,
      payment_expires_at: paymentExpiresAtIso,
      payment_method: notchPayResult.channel || null,
    });

    await auditRepository.log({
      event_type: 'vote.initiated',
      entity_type: 'transaction',
      entity_id: transaction.id,
      actor_type: 'user',
      details: { candidateId: input.candidateId, amount: input.amount, reference, channel: notchPayResult.channel },
      ip_address: meta.ipAddress,
      user_agent: meta.userAgent,
    });

    return {
      transactionId: transaction.id,
      reference,
      paymentUrl: notchPayResult.paymentUrl,
      checkoutUrl: notchPayResult.checkoutUrl,
      action: notchPayResult.action,
      ussdMessage: notchPayResult.ussdMessage,
    };
  },

  /**
   * Interroge NotchPay toutes les 5 s tant que la transaction est en attente côté BD,
   * puis aligne le statut (succès, échec, annulation) dès que l’agrégateur répond.
   */
  async pollAggregatorUntilTransactionSettled(reference: string, meta: { ipAddress: string; userAgent: string }) {
    const finalizeMeta = { ipAddress: meta.ipAddress, userAgent: meta.userAgent, actorType: 'system' as const };
    let consecutive404 = 0;

    try {
      for (let round = 0; round < AGGREGATOR_POLL_MAX_ROUNDS; round++) {
        const row = await transactionRepository.findByReference(reference);
        if (!row) {
          console.warn('[vote:poll] transaction introuvable', { reference });
          return;
        }

        if (!isTransactionAwaitingAggregator(row)) {
          return;
        }

        if (isPaymentSessionExpired(row)) {
          await expirePaymentSessionLocally(row, reference, meta);
          return;
        }

        const { transaction: notchTx, lastHttpStatus } = await fetchNotchPayTransaction(reference, row.notchpay_id);

        if (!notchTx) {
          if (lastHttpStatus === 404) {
            consecutive404++;
            if (consecutive404 >= AGGREGATOR_POLL_STOP_AFTER_CONSECUTIVE_404) {
              console.warn(
                '[vote:poll] arrêt du polling (GET NotchPay 404). La mise à jour du statut repose sur le webhook NotchPay (payment.complete / failed / etc.).',
                { reference, rounds: consecutive404 }
              );
              return;
            }
          } else {
            consecutive404 = 0;
          }

          console.log('[vote:poll] pas de réponse exploitable de l’agrégateur', { reference, round, lastHttpStatus });
          await sleep(AGGREGATOR_POLL_INTERVAL_MS);
          continue;
        }

        consecutive404 = 0;
        const payStatus = String(notchTx.status ?? '').toLowerCase();

        if (payStatus === 'complete') {
          const synthetic: Record<string, unknown> = {
            ...notchTx,
            reference,
            status: 'complete',
            amount: notchTx.amount,
          };
          try {
            await finalizeFromPaymentData(synthetic, finalizeMeta);
          } catch (err) {
            console.error('[vote:poll] finalisation impossible', {
              reference,
              error: err instanceof Error ? err.message : err,
            });
          }
          return;
        }

        if (payStatus === 'failed' || payStatus === 'expired') {
          await transactionRepository.updateStatus(row.id, 'failed');
          return;
        }

        if (payStatus === 'canceled' || payStatus === 'cancelled') {
          await transactionRepository.updateStatus(row.id, 'cancelled');
          return;
        }

        await sleep(AGGREGATOR_POLL_INTERVAL_MS);
      }

      console.warn('[vote:poll] nombre max de vérifications atteint', { reference });
    } catch (err) {
      console.error('[vote:poll] erreur inattendue', {
        reference,
        error: err instanceof Error ? err.message : err,
      });
    }
  },

  /**
   * Synchronise l'état d'une transaction avec NotchPay (vérification unique synchrone).
   * Utile pour la route check-status lorsque le statut est encore 'pending' ou 'processing'.
   */
  async syncTransactionStatus(reference: string, meta: { ipAddress: string; userAgent: string }) {
    const row = await transactionRepository.findByReference(reference);
    if (!row || !isTransactionAwaitingAggregator(row)) {
      return row;
    }

    if (isPaymentSessionExpired(row)) {
      await expirePaymentSessionLocally(row, reference, meta);
      return await transactionRepository.findByReference(reference);
    }

    const { transaction: notchTx } = await fetchNotchPayTransaction(reference, row.notchpay_id);
    
    if (!notchTx) {
      return row; // Ne rien faire si introuvable chez NotchPay
    }

    const payStatus = String(notchTx.status ?? '').toLowerCase();

    if (payStatus === 'complete') {
      const synthetic: Record<string, unknown> = {
        ...notchTx,
        reference,
        status: 'complete',
        amount: notchTx.amount,
      };
      try {
        await finalizeFromPaymentData(synthetic, { ...meta, actorType: 'system' });
      } catch (err) {
        console.error('[vote:sync] finalisation impossible', { reference, error: err });
      }
    } else if (payStatus === 'failed' || payStatus === 'expired') {
      await transactionRepository.updateStatus(row.id, 'failed');
    } else if (payStatus === 'canceled' || payStatus === 'cancelled') {
      await transactionRepository.updateStatus(row.id, 'cancelled');
    }

    // Retourne l'état mis à jour
    return await transactionRepository.findByReference(reference);
  },

  /**
   * Webhook NotchPay : événements de paiement (source de vérité si le GET /payments/{ref} n’est pas disponible).
   */
  async processWebhook(
    event: Record<string, unknown>,
    meta: { ipAddress: string; userAgent: string }
  ) {
    const eventType = getNotchPayWebhookEventType(event);
    const rawData = getNotchPayWebhookData(event);

    switch (eventType) {
      case 'payment.complete': {
        const data = normalizePaymentCompleteData(rawData);
        return finalizeFromPaymentData(data, { ...meta, actorType: 'webhook' });
      }
      case 'payment.failed':
      case 'payment.expired':
        return applyTerminalPaymentFromWebhook(rawData, 'failed', meta);
      case 'payment.canceled':
      case 'payment.cancelled':
        return applyTerminalPaymentFromWebhook(rawData, 'cancelled', meta);
      default:
        return { received: true, processed: false, eventType };
    }
  },
};


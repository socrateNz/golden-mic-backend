import { candidateRepository } from '@/repositories/candidateRepository';
import { transactionRepository } from '@/repositories/transactionRepository';
import { voteRepository } from '@/repositories/voteRepository';
import { auditRepository } from '@/repositories/auditRepository';
import { calculatePoints, generateTransactionReference, generateIdempotencyKey } from '@/utils/helpers';
import { sendVoteConfirmationEmail } from '@/lib/resend';
import { createMoneyFusionTransaction, fetchMoneyFusionTransactionStatus } from '@/lib/moneyfusion';
import type { InitiateVoteInput } from '@/validators/schemas';
import type { TransactionRow } from '@/repositories/transactionRepository';

const AGGREGATOR_POLL_INTERVAL_MS = 5000;
/** ~10 min max — évite une boucle infinie si le webhook complète jamais. */
const AGGREGATOR_POLL_MAX_ROUNDS = 120;

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

function getMoneyFusionPaymentTtlMinutes(): number {
  const raw = process.env.MONEYFUSION_PAYMENT_TTL_MINUTES;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 5) return 30;
  if (n > 24 * 60) return 24 * 60;
  return n;
}

/**
 * MoneyFusion n'expose pas d'endpoint d'annulation de session de paiement :
 * on se contente d'expirer la transaction localement.
 */
async function expirePaymentSessionLocally(
  row: TransactionRow,
  reference: string,
  meta: { ipAddress: string; userAgent: string }
) {
  console.warn('[vote:expire] session de paiement expirée (TTL)', {
    reference,
    payment_expires_at: row.payment_expires_at,
  });

  await transactionRepository.updateStatus(row.id, 'cancelled');

  await auditRepository.log({
    event_type: 'vote.payment_session_expired',
    entity_type: 'transaction',
    entity_id: row.id,
    actor_type: 'system',
    details: { reference, payment_expires_at: row.payment_expires_at },
    ip_address: meta.ipAddress,
    severity: 'info',
  });
}

function isPaymentSessionExpired(row: TransactionRow): boolean {
  if (!row.payment_expires_at) return false;
  const t = new Date(row.payment_expires_at).getTime();
  return Number.isFinite(t) && Date.now() >= t;
}

function isTransactionAwaitingAggregator(row: TransactionRow): boolean {
  if (row.status === 'processing') return true;
  return row.status === 'pending' && row.notchpay_id != null;
}

/**
 * Applique une mise à jour de paiement (webhook ou vérif. agrégateur) : idempotence, points, vote.
 * `amount` et `method` doivent provenir d'un appel authentifié à `fetchMoneyFusionTransactionStatus`
 * (source de vérité), jamais d'un corps de webhook non vérifié.
 */
async function finalizeFromPaymentData(
  params: { reference: string; amount: number; method: string | null; raw: Record<string, unknown> },
  meta: { ipAddress: string; userAgent: string; actorType: PaymentActor }
) {
  const { reference, amount, method, raw } = params;

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

  if (transaction.webhook_validated || transaction.status === 'complete') {
    return { message: 'Déjà finalisé', alreadyProcessed: true };
  }

  const idempotencyKey = generateIdempotencyKey(transaction.reference, 'payment.complete');
  const existingProcessed = await transactionRepository.findByIdempotencyKey(idempotencyKey);
  if (existingProcessed?.webhook_validated) {
    return { message: 'Déjà traité', alreadyProcessed: true };
  }

  if (Math.abs(amount - transaction.amount) > 0) {
    await auditRepository.logFraud({
      ip_address: meta.ipAddress,
      user_agent: meta.userAgent,
      attempt_type: 'amount_mismatch',
      details: { expected: transaction.amount, received: amount, reference: transaction.reference },
      transaction_reference: transaction.reference,
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

    await transactionRepository.markWebhookValidated(
      transaction.id,
      { ...raw, idempotency_key: idempotencyKey },
      { payment_method: method }
    );
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
    details: { reference: transaction.reference, amount: transaction.amount, points, candidateId: transaction.candidate_id, source: meta.actorType },
    ip_address: meta.ipAddress,
    severity: 'info',
  });

  return { success: true, points, reference: transaction.reference };
}

function referenceFromWebhookBody(event: Record<string, unknown>): string | null {
  if (typeof event.reference === 'string' && event.reference) return event.reference;

  if (Array.isArray(event.personal_Info)) {
    const first = event.personal_Info[0];
    if (first && typeof first === 'object' && 'reference' in first) {
      const ref = (first as Record<string, unknown>).reference;
      if (typeof ref === 'string' && ref) return ref;
    }
  }

  if (typeof event.tokenPay === 'string' && event.tokenPay) return event.tokenPay;

  return null;
}

async function applyFailedPaymentIfPending(
  row: TransactionRow,
  meta: { ipAddress: string; userAgent: string; actorType: PaymentActor }
) {
  if (row.status !== 'processing' && row.status !== 'pending') {
    return { processed: false as const, message: 'Statut déjà définitif' };
  }

  await transactionRepository.updateStatus(row.id, 'failed');

  await auditRepository.log({
    event_type: 'vote.payment_failed',
    entity_type: 'transaction',
    entity_id: row.id,
    actor_type: meta.actorType === 'webhook' ? 'webhook' : 'system',
    details: { reference: row.reference },
    ip_address: meta.ipAddress,
    severity: 'info',
  });

  return { processed: true as const, reference: row.reference, status: 'failed' as const };
}

export const voteService = {
  /**
   * Initie un vote : crée la transaction et appelle MoneyFusion.
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

    const ttlMinutes = getMoneyFusionPaymentTtlMinutes();
    const paymentExpiresAtIso = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    const webhookSecret = process.env.MONEYFUSION_WEBHOOK_SECRET;
    const webhookUrl = `${process.env.BACKEND_URL}/api/payments/webhook${webhookSecret ? `?key=${encodeURIComponent(webhookSecret)}` : ''}`;

    let moneyFusionResult;
    try {
      moneyFusionResult = await createMoneyFusionTransaction({
        amount: input.amount,
        clientName: input.voterName || 'Voteur Golden Mic 237',
        clientPhone: input.voterPhone,
        reference,
        description: `Vote pour ${candidate.artist_name} — Golden Mic 237`,
        returnUrl: `${process.env.FRONTEND_URL}/vote/success?ref=${reference}`,
        webhookUrl,
      });
    } catch (err: any) {
      console.error('[vote:initiate] MoneyFusion creation error', {
        reference,
        error: err.message,
      });
      await transactionRepository.updateStatus(transaction.id, 'failed');
      throw err;
    }

    await transactionRepository.updateStatus(transaction.id, 'processing', {
      notchpay_id: moneyFusionResult.token,
      payment_expires_at: paymentExpiresAtIso,
    });

    await auditRepository.log({
      event_type: 'vote.initiated',
      entity_type: 'transaction',
      entity_id: transaction.id,
      actor_type: 'user',
      details: { candidateId: input.candidateId, amount: input.amount, reference },
      ip_address: meta.ipAddress,
      user_agent: meta.userAgent,
    });

    return {
      transactionId: transaction.id,
      reference,
      paymentUrl: moneyFusionResult.paymentUrl,
    };
  },

  /**
   * Interroge MoneyFusion toutes les 5 s tant que la transaction est en attente côté BD,
   * puis aligne le statut (succès, échec) dès que l'agrégateur répond.
   */
  async pollAggregatorUntilTransactionSettled(reference: string, meta: { ipAddress: string; userAgent: string }) {
    const finalizeMeta = { ipAddress: meta.ipAddress, userAgent: meta.userAgent, actorType: 'system' as const };

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

        const status = row.notchpay_id ? await fetchMoneyFusionTransactionStatus(row.notchpay_id) : null;

        if (!status) {
          await sleep(AGGREGATOR_POLL_INTERVAL_MS);
          continue;
        }

        if (status.status === 'paid') {
          try {
            await finalizeFromPaymentData(
              { reference, amount: status.amount ?? row.amount, method: status.method, raw: status.raw },
              finalizeMeta
            );
          } catch (err) {
            console.error('[vote:poll] finalisation impossible', {
              reference,
              error: err instanceof Error ? err.message : err,
            });
          }
          return;
        }

        if (status.status === 'failed' || status.status === 'no paid') {
          await applyFailedPaymentIfPending(row, finalizeMeta);
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
   * Synchronise l'état d'une transaction avec MoneyFusion (vérification unique synchrone).
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

    const status = row.notchpay_id ? await fetchMoneyFusionTransactionStatus(row.notchpay_id) : null;
    const finalizeMeta = { ...meta, actorType: 'system' as const };

    if (!status) {
      return row; // Ne rien faire si introuvable chez MoneyFusion
    }

    if (status.status === 'paid') {
      try {
        await finalizeFromPaymentData(
          { reference, amount: status.amount ?? row.amount, method: status.method, raw: status.raw },
          finalizeMeta
        );
      } catch (err) {
        console.error('[vote:sync] finalisation impossible', { reference, error: err });
      }
    } else if (status.status === 'failed' || status.status === 'no paid') {
      await applyFailedPaymentIfPending(row, finalizeMeta);
    }

    // Retourne l'état mis à jour
    return await transactionRepository.findByReference(reference);
  },

  /**
   * Webhook MoneyFusion : simple déclencheur. Le corps n'étant pas signé, on ne lui fait
   * jamais confiance directement — on relit le statut authentique via `notchpay_id`
   * (token MoneyFusion connu de notre BD) avant de créditer quoi que ce soit.
   */
  async processWebhook(
    event: Record<string, unknown>,
    meta: { ipAddress: string; userAgent: string }
  ) {
    const reference = referenceFromWebhookBody(event);

    if (!reference) {
      return { received: true, processed: false, message: 'Référence introuvable dans le webhook' };
    }

    const row = await transactionRepository.findByReferenceOrNotchpayId(reference);
    if (!row) {
      await auditRepository.logFraud({
        ip_address: meta.ipAddress,
        user_agent: meta.userAgent,
        attempt_type: 'unknown_reference',
        details: { reference },
      });
      return { received: true, processed: false, message: 'Transaction introuvable' };
    }

    if (row.webhook_validated || row.status === 'complete') {
      return { received: true, processed: false, alreadyProcessed: true };
    }

    const finalizeMeta = { ...meta, actorType: 'webhook' as const };
    const status = row.notchpay_id ? await fetchMoneyFusionTransactionStatus(row.notchpay_id) : null;

    if (!status) {
      return { received: true, processed: false, message: 'Statut MoneyFusion indisponible' };
    }

    if (status.status === 'paid') {
      const result = await finalizeFromPaymentData(
        { reference: row.reference, amount: status.amount ?? row.amount, method: status.method, raw: status.raw },
        finalizeMeta
      );
      return { received: true, ...result };
    }

    if (status.status === 'failed' || status.status === 'no paid') {
      const result = await applyFailedPaymentIfPending(row, finalizeMeta);
      return { received: true, ...result };
    }

    return { received: true, processed: false, status: status.status };
  },
};

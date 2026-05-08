import { candidateRepository } from '@/repositories/candidateRepository';
import { transactionRepository } from '@/repositories/transactionRepository';
import { voteRepository } from '@/repositories/voteRepository';
import { auditRepository } from '@/repositories/auditRepository';
import { calculatePoints, generateTransactionReference, generateIdempotencyKey } from '@/utils/helpers';
import { sendVoteConfirmationEmail } from '@/lib/resend';
import type { InitiateVoteInput } from '@/validators/schemas';

const NOTCHPAY_BASE_URL = 'https://api.notchpay.co';

export const voteService = {
  /**
   * Initie un vote : crée la transaction et appelle NotchPay.
   */
  async initiateVote(
    input: InitiateVoteInput,
    meta: { ipAddress: string; userAgent: string }
  ) {
    // 1. Vérifie que le candidat existe et est approuvé
    const candidate = await candidateRepository.findById(input.candidateId);
    if (!candidate) {
      throw new Error('Candidat introuvable ou non approuvé');
    }

    // 2. Génère une référence unique
    const reference = generateTransactionReference();

    // 3. Crée la transaction en DB avec statut 'pending'
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

    // 4. Appelle NotchPay pour créer le paiement
    const notchPayload = {
      amount: input.amount,
      currency: 'XAF',
      email: input.voterEmail ?? 'vote@golden-mic-237.cm',
      phone: input.voterPhone,
      paymentPhone: input.voterPhone,
      reference,
      description: `Vote pour ${candidate.artist_name} — Golden Mic 237`,
      callback: `${process.env.FRONTEND_URL}/vote/success?ref=${reference}`,
    };

    const notchPayResponse = await fetch(`${NOTCHPAY_BASE_URL}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': process.env.NOTCHPAY_PUBLIC_KEY!,
        'X-Grant': process.env.NOTCHPAY_SECRET_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(notchPayload),
    });

    console.log('[vote:initiate] NotchPay HTTP response', {
      reference,
      status: notchPayResponse.status,
      ok: notchPayResponse.ok,
    });

    if (!notchPayResponse.ok) {
      const err = await notchPayResponse.json();
      console.error('[vote:initiate] NotchPay error payload', {
        reference,
        status: notchPayResponse.status,
        error: err,
        errorJson: JSON.stringify(err),
      });
      // Marque la transaction comme échouée
      await transactionRepository.updateStatus(transaction.id, 'failed');
      throw new Error(err.message ?? 'Erreur NotchPay lors de la création du paiement');
    }

    const notchPayData = await notchPayResponse.json();
    console.log('[vote:initiate] NotchPay success payload', {
      reference,
      authorization_url: notchPayData?.authorization_url ?? null,
      transaction_id: notchPayData?.transaction?.id ?? null,
      action: notchPayData?.action ?? null,
      message: notchPayData?.message ?? null,
    });

    // 5. Met à jour la transaction avec l'ID NotchPay
    await transactionRepository.updateStatus(transaction.id, 'processing', {
      notchpay_id: notchPayData.transaction?.id,
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
      paymentUrl: notchPayData.authorization_url ?? notchPayData.checkout_url ?? null,
      checkoutUrl: notchPayData.checkout_url ?? notchPayData.authorization_url ?? null,
      action: notchPayData.action ?? null,
      ussdMessage: notchPayData.message ?? null,
    };
  },

  /**
   * Traite le webhook NotchPay après paiement réussi.
   * SEULE source de calcul des points.
   */
  async processWebhook(
    event: Record<string, unknown>,
    meta: { ipAddress: string; userAgent: string }
  ) {
    const data = event.data as Record<string, unknown>;
    const reference = data?.reference as string;
    const status = data?.status as string;
    const amount = Number(data?.amount ?? 0);

    // 1. Récupère la transaction
    const transaction = await transactionRepository.findByReference(reference);
    if (!transaction) {
      await auditRepository.logFraud({
        ip_address: meta.ipAddress,
        user_agent: meta.userAgent,
        attempt_type: 'unknown_reference',
        details: { reference },
      });
      throw new Error('Transaction introuvable');
    }

    // 2. Anti double-traitement
    const idempotencyKey = generateIdempotencyKey(reference, 'payment.complete');
    const existingProcessed = await transactionRepository.findByIdempotencyKey(idempotencyKey);
    if (existingProcessed?.webhook_validated) {
      return { message: 'Déjà traité', alreadyProcessed: true };
    }

    // 3. Vérifie le statut
    if (status !== 'complete') {
      await transactionRepository.updateStatus(transaction.id, 'failed');
      return { message: 'Paiement non complété', success: false };
    }

    // 4. Vérifie le montant (tolérance 0 FCFA)
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

    // 5. Calcul des points — UNIQUEMENT côté backend
    const points = calculatePoints(transaction.amount);

    // 6. Transaction atomique : vote + points candidat
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

    // 7. Email de confirmation
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
      actor_type: 'webhook',
      details: { reference, amount: transaction.amount, points, candidateId: transaction.candidate_id },
      ip_address: meta.ipAddress,
      severity: 'info',
    });

    return { success: true, points, reference };
  },
};

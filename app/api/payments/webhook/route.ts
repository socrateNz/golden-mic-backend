import { NextRequest, NextResponse } from 'next/server';
import { voteService } from '@/services/voteService';
import { verifyWebhookSignature } from '@/utils/helpers';
import { auditRepository } from '@/repositories/auditRepository';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-notch-signature') ?? '';
  const webhookSecret = process.env.NOTCHPAY_WEBHOOK_HASH!;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';
  const userAgent = req.headers.get('user-agent') ?? 'webhook';

  // 1. Validation de la signature HMAC-SHA256
  if (!signature || !verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    await auditRepository.logFraud({
      ip_address: ip,
      user_agent: userAgent,
      attempt_type: 'invalid_webhook_signature',
      details: { signature: signature.slice(0, 10) + '...' },
    });
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  // 2. Traite uniquement les paiements complétés
  if (event.event !== 'payment.complete') {
    return NextResponse.json({ received: true, processed: false });
  }

  try {
    const result = await voteService.processWebhook(event, { ipAddress: ip, userAgent });
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur traitement webhook';
    await auditRepository.log({
      event_type: 'webhook.error',
      actor_type: 'webhook',
      details: { error: message, event },
      ip_address: ip,
      severity: 'error',
    });
    // Retourne 200 pour éviter que NotchPay ne renvoie indéfiniment
    return NextResponse.json({ received: true, error: message }, { status: 200 });
  }
}

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

  let event: Record<string, unknown>;
  let eventType = 'unknown';
  let reference = 'unknown';

  try {
    event = JSON.parse(rawBody);
    eventType = (event.event ?? event.type ?? 'unknown') as string;
    reference = ((event.data as any)?.reference ?? event.reference ?? 'unknown') as string;
  } catch {
    console.error('[webhook:parse-error] JSON invalide');
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  // Logging du webhook reçu
  console.log('[webhook:received]', {
    event: eventType,
    reference,
    timestamp: new Date().toISOString(),
  });

  // 1. Validation de la signature HMAC-SHA256
  if (!signature || !verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    console.error('[webhook:signature-invalid]', {
      event: eventType,
      reference,
      signatureReceived: signature ? signature.slice(0, 10) + '...' : 'none',
    });

    await auditRepository.logFraud({
      ip_address: ip,
      user_agent: userAgent,
      attempt_type: 'invalid_webhook_signature',
      details: { signature: signature.slice(0, 10) + '...', event: eventType, reference },
    });
    
    // Retourne 200 quand même pour ne pas que NotchPay renvoit indéfiniment
    return NextResponse.json({ received: true, error: 'Signature invalide' }, { status: 200 });
  }

  try {
    const result = await voteService.processWebhook(event, { ipAddress: ip, userAgent });
    
    console.log('[webhook:processed]', {
      event: eventType,
      reference,
      processed: result.processed,
      status: (result as any).status,
    });

    return NextResponse.json({ received: true, ...result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur traitement webhook';
    console.error('[webhook:processing-error]', {
      event: eventType,
      reference,
      error: message,
    });

    await auditRepository.log({
      event_type: 'webhook.error',
      actor_type: 'webhook',
      details: { error: message, event: eventType, reference },
      ip_address: ip,
      severity: 'error',
    });
    
    // Retourne 200 pour éviter que NotchPay ne renvoie indéfiniment
    return NextResponse.json({ received: true, error: message }, { status: 200 });
  }
}

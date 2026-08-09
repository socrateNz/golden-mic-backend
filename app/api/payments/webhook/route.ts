import { NextRequest, NextResponse } from 'next/server';
import { voteService } from '@/services/voteService';
import { verifyWebhookSecret } from '@/utils/helpers';
import { auditRepository } from '@/repositories/auditRepository';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const receivedKey = new URL(req.url).searchParams.get('key');
  const webhookSecret = process.env.MONEYFUSION_WEBHOOK_SECRET;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';
  const userAgent = req.headers.get('user-agent') ?? 'webhook';

  let event: Record<string, unknown>;

  try {
    event = JSON.parse(rawBody);
  } catch {
    console.error('[webhook:parse-error] JSON invalide');
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  console.log('[webhook:received]', { timestamp: new Date().toISOString() });

  // 1. MoneyFusion ne signe pas ses webhooks : on filtre via le secret embarqué
  // dans l'URL de webhook qu'on lui a fournie à l'initiation du paiement.
  if (webhookSecret && !verifyWebhookSecret(receivedKey, webhookSecret)) {
    console.error('[webhook:secret-invalid]');

    await auditRepository.logFraud({
      ip_address: ip,
      user_agent: userAgent,
      attempt_type: 'invalid_webhook_secret',
      details: {},
    });

    // Retourne 200 quand même pour ne pas que MoneyFusion renvoie indéfiniment
    return NextResponse.json({ received: true, error: 'Secret invalide' }, { status: 200 });
  }

  try {
    // Le corps du webhook n'est de toute façon jamais utilisé comme source de vérité :
    // voteService.processWebhook relit systématiquement le statut auprès de MoneyFusion.
    const result = await voteService.processWebhook(event, { ipAddress: ip, userAgent });

    console.log('[webhook:processed]', result);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur traitement webhook';
    console.error('[webhook:processing-error]', { error: message });

    await auditRepository.log({
      event_type: 'webhook.error',
      actor_type: 'webhook',
      details: { error: message },
      ip_address: ip,
      severity: 'error',
    });

    // Retourne 200 pour éviter que MoneyFusion ne renvoie indéfiniment
    return NextResponse.json({ received: true, error: message }, { status: 200 });
  }
}

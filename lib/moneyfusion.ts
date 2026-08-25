/**
 * Client pour l'API MoneyFusion (https://moneyfusion.net).
 * Remplace NotchPay, devenu inaccessible.
 *
 * Contrairement à NotchPay, MoneyFusion ne propose pas de charge directe
 * silencieuse (USSD push) : l'utilisateur doit toujours finaliser le paiement
 * sur la page de paiement hébergée renvoyée dans `paymentUrl`.
 */

export interface CreateTransactionParams {
  amount: number;
  clientName: string;
  clientPhone: string;
  reference: string;
  description: string;
  returnUrl: string;
  webhookUrl: string;
}

export interface CreateTransactionResult {
  token: string;
  paymentUrl: string;
}

export async function createMoneyFusionTransaction(
  params: CreateTransactionParams
): Promise<CreateTransactionResult> {
  const MONEYFUSION_API_URL = process.env.MONEYFUSION_API_URL;

  if (!MONEYFUSION_API_URL) {
    throw new Error('MONEYFUSION_API_URL is not configured in environment variables');
  }

  const payload = {
    totalPrice: params.amount,
    article: [{ [params.description]: params.amount }],
    numeroSend: params.clientPhone,
    nomclient: params.clientName,
    return_url: params.returnUrl,
    webhook_url: params.webhookUrl,
    personal_Info: [{ reference: params.reference }],
  };

  console.log('[moneyfusion:initiate] Sending payment initiation POST request...', {
    reference: params.reference,
    amount: params.amount,
  });

  const res = await fetch(MONEYFUSION_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const rawBody = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(rawBody);
  } catch {
    data = null;
  }

  if (!res.ok || !data || data.statut !== true) {
    console.error('[moneyfusion:initiate-failed] API returned error:', rawBody);
    const message = typeof data?.message === 'string' ? data.message : "Échec de l'initialisation du paiement chez MoneyFusion";
    throw new Error(message);
  }

  if (typeof data.token !== 'string' || typeof data.url !== 'string') {
    console.error('[moneyfusion:initiate-invalid] Missing token/url in response:', rawBody);
    throw new Error('Réponse MoneyFusion invalide (token ou url manquant)');
  }

  return { token: data.token, paymentUrl: data.url };
}

export type MoneyFusionPaymentStatus = 'pending' | 'paid' | 'failed' | 'no paid';

export interface MoneyFusionTransactionStatus {
  status: MoneyFusionPaymentStatus;
  amount: number | null;
  method: string | null;
  reference: string | null;
  raw: Record<string, unknown>;
}

/**
 * Interroge MoneyFusion pour l'état réel d'une transaction, à partir du token
 * renvoyé lors de l'initiation. C'est la seule source de vérité : le webhook
 * MoneyFusion n'étant pas signé, on ne crédite jamais de points sans être
 * passé par cette vérification.
 */
export async function fetchMoneyFusionTransactionStatus(
  token: string
): Promise<MoneyFusionTransactionStatus | null> {
  // Le sous-domaine "www." a un certificat TLS invalide côté MoneyFusion ; on utilise
  // le même domaine que MONEYFUSION_API_URL (sans www), qui répond correctement.
  const res = await fetch(`https://pay.moneyfusion.net/paiementNotif/${encodeURIComponent(token)}`, {
    method: 'GET',
  });

  if (!res.ok) {
    return null;
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!body || body.statut !== true || typeof body.data !== 'object' || body.data === null) {
    return null;
  }

  const data = body.data as Record<string, unknown>;
  const firstInfo = Array.isArray(data.personal_Info) ? data.personal_Info[0] : null;
  const reference =
    firstInfo && typeof firstInfo === 'object' && typeof (firstInfo as Record<string, unknown>).reference === 'string'
      ? ((firstInfo as Record<string, unknown>).reference as string)
      : null;

  return {
    status: (data.statut as MoneyFusionPaymentStatus) ?? 'pending',
    amount: typeof data.Montant === 'number' ? data.Montant : null,
    method: typeof data.moyen === 'string' ? data.moyen : null,
    reference,
    raw: data,
  };
}

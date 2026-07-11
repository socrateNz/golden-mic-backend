// We can define detectPaymentMethod here or in a shared file. Let's write the full robust logic directly here.
export function detectPaymentMethod(phone: string): {
  channel: 'cm.mtn' | 'cm.orange' | null;
  formattedPhone: string;
} {
  // Supprime tous les caractères non numériques
  let clean = phone.replace(/\D/g, '');

  // Supprime l'éventuel préfixe pays
  if (clean.startsWith('00237')) {
    clean = clean.substring(5);
  } else if (clean.startsWith('237')) {
    clean = clean.substring(3);
  }

  // Supprime un 0 de tête si présent sur un numéro à 10 chiffres (format camerounais standard sans indicatif)
  if (clean.length === 10 && clean.startsWith('0')) {
    clean = clean.substring(1);
  }

  // Un numéro camerounais local valide doit avoir exactement 9 chiffres
  if (clean.length !== 9) {
    return { channel: null, formattedPhone: phone };
  }

  const prefix3 = clean.substring(0, 3);
  const prefix2 = clean.substring(0, 2);

  let channel: 'cm.mtn' | 'cm.orange' | null = null;

  const mtnPrefixes3 = ['650', '651', '652', '653', '654'];
  const mtnPrefixes2 = ['67', '68'];

  const orangePrefixes3 = ['655', '656', '657', '658', '659'];
  const orangePrefixes2 = ['69', '64'];

  if (mtnPrefixes3.includes(prefix3) || mtnPrefixes2.includes(prefix2)) {
    channel = 'cm.mtn';
  } else if (orangePrefixes3.includes(prefix3) || orangePrefixes2.includes(prefix2)) {
    channel = 'cm.orange';
  }

  return {
    channel,
    formattedPhone: `+237${clean}`,
  };
}

export interface CreateTransactionParams {
  amount: number;
  email: string;
  phone: string;
  reference: string;
  description: string;
  callbackUrl: string;
  ipAddress: string;
  ttlMinutes?: number;
  paymentExpiresAtIso?: string;
}

export async function createNotchPayTransaction(params: CreateTransactionParams) {
  const { channel, formattedPhone } = detectPaymentMethod(params.phone);

  const NOTCHPAY_BASE_URL = process.env.NOTCHPAY_BASE_URL || 'https://api.notchpay.co';
  const NOTCHPAY_PUBLIC_KEY = process.env.NOTCHPAY_PUBLIC_KEY;
  const NOTCHPAY_SECRET_KEY = process.env.NOTCHPAY_SECRET_KEY;

  if (!NOTCHPAY_PUBLIC_KEY) {
    throw new Error('NOTCHPAY_PUBLIC_KEY is not configured in environment variables');
  }

  const headers: Record<string, string> = {
    Authorization: NOTCHPAY_PUBLIC_KEY,
    'Content-Type': 'application/json',
  };

  if (NOTCHPAY_SECRET_KEY) {
    headers['X-Grant'] = NOTCHPAY_SECRET_KEY;
  }

  const notchPayload: Record<string, any> = {
    amount: params.amount,
    currency: 'XAF',
    email: params.email,
    phone: params.phone,
    paymentPhone: params.phone,
    reference: params.reference,
    description: params.description,
    callback: params.callbackUrl,
    metadata: {
      app: 'golden-mic-237',
      payment_ttl_minutes: params.ttlMinutes || 10,
      payment_expires_at: params.paymentExpiresAtIso || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  };

  if (process.env.NOTCHPAY_PAYMENT_SEND_EXPIRES_AT === '1' || process.env.NOTCHPAY_PAYMENT_SEND_EXPIRES_AT === 'true') {
    if (params.paymentExpiresAtIso) {
      notchPayload.expires_at = params.paymentExpiresAtIso;
    }
  }

  console.log('[notchpay:initiate] Sending initialization POST request...', {
    reference: params.reference,
    amount: params.amount,
    channel,
  });

  // Étape 1 : Initialisation du paiement (POST /payments)
  const initRes = await fetch(`${NOTCHPAY_BASE_URL}/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(notchPayload),
  });

  if (!initRes.ok) {
    const errorBody = await initRes.text();
    console.error('[notchpay:initiate-failed] API returned error:', errorBody);
    let errorMessage = 'Échec de l\'initialisation du paiement chez NotchPay';
    try {
      const errJson = JSON.parse(errorBody);
      errorMessage = errJson.message || errorMessage;
    } catch {}
    throw new Error(errorMessage);
  }

  const initData = await initRes.json();
  const trxRef = initData.transaction?.reference || initData.data?.reference || params.reference;
  const notchpayId = initData.transaction?.id || initData.data?.id || initData.id || null;

  let directChargeData: any = null;
  let action = initData.action || null;
  let ussdMessage = initData.message || null;

  // Étape 2 : Si un opérateur mobile camerounais est détecté, déclencher immédiatement la charge directe par USSD Push (PUT /payments/{reference})
  if (channel) {
    console.log(`[notchpay:direct-charge] Triggering USSD push direct charge via PUT for channel ${channel}...`, {
      reference: trxRef,
      phone: formattedPhone,
    });

    const normalizedIp = (!params.ipAddress || params.ipAddress.includes(':')) ? '127.0.0.1' : params.ipAddress;

    const directPayload = {
      channel,
      data: {
        phone: formattedPhone,
      },
      client_ip: normalizedIp,
    };

    const putRes = await fetch(`${NOTCHPAY_BASE_URL}/payments/${encodeURIComponent(trxRef)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(directPayload),
    });

    if (putRes.ok) {
      directChargeData = await putRes.json();
      action = directChargeData.action || action;
      ussdMessage = directChargeData.message || ussdMessage;
      console.log('[notchpay:direct-charge-success] Direct charge successfully triggered:', {
        action,
        message: ussdMessage,
      });
    } else {
      const errorText = await putRes.text();
      console.error('[notchpay:direct-charge-failed] Direct charge charge PUT returned error:', errorText);
      // On ne jette pas d'erreur pour que l'utilisateur puisse toujours utiliser l'URL de paiement classique en fallback si nécessaire.
    }
  } else {
    console.log('[notchpay:initiate] No direct charge channel detected, falling back to standard checkout URL.');
  }

  return {
    notchpayId: notchpayId || directChargeData?.transaction?.id || null,
    reference: trxRef,
    paymentUrl: initData.authorization_url || initData.checkout_url || null,
    checkoutUrl: initData.checkout_url || initData.authorization_url || null,
    action,
    ussdMessage,
    channel,
  };
}

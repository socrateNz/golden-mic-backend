import crypto from 'crypto';

/**
 * Calcule les points à partir d'un montant en FCFA.
 * RÈGLE OFFICIELLE : 100 FCFA = 10 points
 * Formule : points = montant / 10
 * Ne jamais appeler côté frontend.
 */
export function calculatePoints(amountFcfa: number): number {
  if (amountFcfa < 100) {
    throw new Error('Montant minimum 100 FCFA');
  }
  return Math.floor(amountFcfa / 10);
}

/**
 * Vérifie la signature HMAC-SHA256 d'un webhook NotchPay.
 */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const expected = hmac.update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Génère une référence de transaction unique.
 */
export function generateTransactionReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `GM237-${timestamp}-${random}`;
}

/**
 * Génère une clé d'idempotence.
 */
export function generateIdempotencyKey(reference: string, event: string): string {
  return crypto.createHash('sha256').update(`${reference}:${event}`).digest('hex');
}

/**
 * Convertit un nom en slug URL-safe.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Formate un montant en FCFA.
 */
export function formatFCFA(amount: number): string {
  return new Intl.NumberFormat('fr-CM', {
    style: 'currency',
    currency: 'XAF',
    minimumFractionDigits: 0,
  }).format(amount);
}

import crypto from 'crypto';

/**
 * Calcule les points à partir d'un montant en FCFA.
 * RÈGLE OFFICIELLE : 100 FCFA = 10 points
 * Formule : points = montant / 10
 * Minimum 200 FCFA imposé par MoneyFusion (rejette tout montant inférieur).
 * Ne jamais appeler côté frontend.
 */
export function calculatePoints(amountFcfa: number): number {
  if (amountFcfa < 200) {
    throw new Error('Montant minimum 200 FCFA');
  }
  return Math.floor(amountFcfa / 10);
}

/**
 * MoneyFusion ne signe pas ses webhooks. En protection, l'URL de webhook qu'on
 * lui transmet embarque un secret en query param ; on vérifie ici qu'il
 * correspond avant de traiter la requête. Ça ne remplace pas la vérification
 * du statut auprès de MoneyFusion (source de vérité), c'est un filtre en amont.
 */
export function verifyWebhookSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
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

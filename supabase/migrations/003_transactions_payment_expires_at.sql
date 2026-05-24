-- Délai max pour finaliser un paiement NotchPay (session checkout / attente webhook).
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN transactions.payment_expires_at IS 'Horodatage après lequel la session de paiement est considérée expirée côté Golden Mic (TTL configurable).';

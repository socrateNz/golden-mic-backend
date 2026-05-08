-- ================================================
-- Golden Mic 237 — Schéma SQL Supabase complet
-- ================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Recherche texte rapide

-- ── 1. CATEGORIES ──────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active);

-- ── 2. CANDIDATES ──────────────────────────────
CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  artist_name VARCHAR(255) NOT NULL UNIQUE,
  slug VARCHAR(255) UNIQUE NOT NULL,
  date_of_birth DATE NOT NULL,
  region VARCHAR(100) NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  biography TEXT,
  photo_url TEXT,
  photo_public_id TEXT,
  video_url TEXT,
  instagram_url TEXT,
  facebook_url TEXT,
  tiktok_url TEXT,
  youtube_url TEXT,
  total_points BIGINT DEFAULT 0 NOT NULL CHECK (total_points >= 0),
  vote_count INTEGER DEFAULT 0 NOT NULL CHECK (vote_count >= 0),
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','suspended')),
  rejection_reason TEXT,
  is_trending BOOLEAN DEFAULT false,
  rank INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_slug ON candidates(slug);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
CREATE INDEX IF NOT EXISTS idx_candidates_points ON candidates(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_category ON candidates(category_id);
CREATE INDEX IF NOT EXISTS idx_candidates_region ON candidates(region);
CREATE INDEX IF NOT EXISTS idx_candidates_search ON candidates USING gin(artist_name gin_trgm_ops);

-- ── 3. TRANSACTIONS ────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(255) UNIQUE NOT NULL,
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  voter_name VARCHAR(255),
  voter_email VARCHAR(255),
  voter_phone VARCHAR(20),
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 100),
  currency VARCHAR(3) DEFAULT 'XAF',
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','processing','complete','failed','cancelled')),
  payment_method VARCHAR(50),
  notchpay_id VARCHAR(255),
  notchpay_response JSONB,
  webhook_received_at TIMESTAMPTZ,
  webhook_validated BOOLEAN DEFAULT false,
  ip_address INET,
  user_agent TEXT,
  points_awarded BIGINT DEFAULT 0,
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_transactions_candidate ON transactions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_notchpay_id ON transactions(notchpay_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(idempotency_key);

-- ── 4. VOTES ───────────────────────────────────
CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE UNIQUE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  points BIGINT NOT NULL CHECK (points > 0),
  amount DECIMAL(10,2) NOT NULL,
  voter_phone VARCHAR(20),
  voter_name VARCHAR(255),
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_votes_created ON votes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_votes_transaction ON votes(transaction_id);

-- ── 5. ADMINS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'admin'
    CHECK (role IN ('super_admin','admin','moderator')),
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. SPONSORS ────────────────────────────────
CREATE TABLE IF NOT EXISTS sponsors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(20),
  logo_url TEXT,
  logo_public_id TEXT,
  website_url TEXT,
  sponsorship_type VARCHAR(50)
    CHECK (sponsorship_type IN ('gold','silver','bronze','media','tech')),
  amount DECIMAL(12,2),
  message TEXT,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','active')),
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. AUDIT LOGS ──────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  actor_type VARCHAR(20)
    CHECK (actor_type IN ('admin','system','webhook','user')),
  actor_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  severity VARCHAR(20) DEFAULT 'info'
    CHECK (severity IN ('info','warning','error','critical')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);

-- ── 8. FRAUD ATTEMPTS ──────────────────────────
CREATE TABLE IF NOT EXISTS fraud_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address INET NOT NULL,
  user_agent TEXT,
  attempt_type VARCHAR(50) NOT NULL,
  details JSONB,
  transaction_reference VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_ip ON fraud_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_fraud_created ON fraud_attempts(created_at DESC);

-- ── TRIGGERS ───────────────────────────────────

-- updated_at auto
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_candidates_updated_at
  BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sponsors_updated_at
  BEFORE UPDATE ON sponsors FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Incrément atomique points candidat
CREATE OR REPLACE FUNCTION increment_candidate_points(
  candidate_id UUID,
  points_to_add BIGINT
) RETURNS VOID AS $$
BEGIN
  UPDATE candidates
  SET
    total_points = total_points + points_to_add,
    vote_count = vote_count + 1
  WHERE id = candidate_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recalcul automatique des rangs
CREATE OR REPLACE FUNCTION update_candidate_ranks()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE candidates c
  SET rank = ranked.r
  FROM (
    SELECT id, RANK() OVER (ORDER BY total_points DESC) AS r
    FROM candidates
    WHERE status = 'approved'
  ) AS ranked
  WHERE c.id = ranked.id AND c.status = 'approved';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_ranks
  AFTER UPDATE OF total_points ON candidates
  FOR EACH ROW
  WHEN (OLD.total_points IS DISTINCT FROM NEW.total_points)
  EXECUTE FUNCTION update_candidate_ranks();

-- ── RLS POLICIES ───────────────────────────────

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_attempts ENABLE ROW LEVEL SECURITY;

-- Candidats approuvés lisibles publiquement
CREATE POLICY "public_read_approved_candidates"
  ON candidates FOR SELECT
  USING (status = 'approved');

-- Votes lisibles publiquement
CREATE POLICY "public_read_votes"
  ON votes FOR SELECT USING (true);

-- Sponsors actifs lisibles publiquement
CREATE POLICY "public_read_active_sponsors"
  ON sponsors FOR SELECT USING (status = 'active');

-- Tout le reste via service_role uniquement (backend)
CREATE POLICY "service_role_all_candidates"
  ON candidates FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_transactions"
  ON transactions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_votes"
  ON votes FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_audit"
  ON audit_logs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all_fraud"
  ON fraud_attempts FOR ALL USING (auth.role() = 'service_role');

-- ── STORAGE BUCKETS ────────────────────────────
-- À créer via le dashboard Supabase ou CLI :
-- supabase storage create-bucket candidate-photos --public
-- supabase storage create-bucket sponsor-logos --public

-- ── REALTIME ───────────────────────────────────
-- Activer dans Supabase Dashboard > Database > Replication
-- Tables : candidates, votes

-- ── DONNÉES INITIALES ──────────────────────────
INSERT INTO categories (name, slug, description) VALUES
  ('Masculin', 'masculin', 'Catégorie masculine'),
  ('Féminin', 'feminin', 'Catégorie féminine'),
  ('Duo / Groupe', 'duo-groupe', 'Duo ou groupe musical'),
  ('Jeune Talent', 'jeune-talent', 'Artiste de moins de 20 ans')
ON CONFLICT (slug) DO NOTHING;

-- ================================================
-- Golden Mic 237 — Migration : Scores Jury & Réseaux Sociaux
-- ================================================

ALTER TABLE candidates
-- Notes Jury (Max 12.5 chacune)
ADD COLUMN IF NOT EXISTS jury_ecriture DECIMAL(4,2) DEFAULT 0 CHECK (jury_ecriture >= 0 AND jury_ecriture <= 12.5),
ADD COLUMN IF NOT EXISTS jury_technique DECIMAL(4,2) DEFAULT 0 CHECK (jury_technique >= 0 AND jury_technique <= 12.5),
ADD COLUMN IF NOT EXISTS jury_attitude DECIMAL(4,2) DEFAULT 0 CHECK (jury_attitude >= 0 AND jury_attitude <= 12.5),
ADD COLUMN IF NOT EXISTS jury_originalite DECIMAL(4,2) DEFAULT 0 CHECK (jury_originalite >= 0 AND jury_originalite <= 12.5),

-- Statistiques Réseaux Sociaux
ADD COLUMN IF NOT EXISTS social_likes INTEGER DEFAULT 0 CHECK (social_likes >= 0),
ADD COLUMN IF NOT EXISTS social_comments INTEGER DEFAULT 0 CHECK (social_comments >= 0),
ADD COLUMN IF NOT EXISTS social_shares INTEGER DEFAULT 0 CHECK (social_shares >= 0);

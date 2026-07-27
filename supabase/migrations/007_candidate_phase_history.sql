-- ================================================
-- Golden Mic 237 — Migration : Historique des Notes par Phase
-- ================================================

-- 1. Table de stockage de l'historique des notes par candidat et par phase
CREATE TABLE IF NOT EXISTS candidate_phase_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  phase_id UUID NOT NULL REFERENCES game_phases(id) ON DELETE CASCADE,
  phase_name VARCHAR(255) NOT NULL,
  vote_points BIGINT DEFAULT 0,
  jury_ecriture DECIMAL(4,2) DEFAULT 0,
  jury_technique DECIMAL(4,2) DEFAULT 0,
  jury_attitude DECIMAL(4,2) DEFAULT 0,
  jury_originalite DECIMAL(4,2) DEFAULT 0,
  social_likes INTEGER DEFAULT 0,
  social_comments INTEGER DEFAULT 0,
  social_shares INTEGER DEFAULT 0,
  total_score DECIMAL(10,2) DEFAULT 0,
  is_eliminated_in_phase BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(candidate_id, phase_id)
);

-- Index pour accélérer les requêtes par candidat ou par phase
CREATE INDEX IF NOT EXISTS idx_cps_candidate_id ON candidate_phase_scores(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cps_phase_id ON candidate_phase_scores(phase_id);

-- RLS Configuration
ALTER TABLE candidate_phase_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_phase_scores" ON candidate_phase_scores;
CREATE POLICY "public_read_phase_scores" ON candidate_phase_scores FOR SELECT USING (true);

DROP POLICY IF EXISTS "service_role_all_phase_scores" ON candidate_phase_scores;
CREATE POLICY "service_role_all_phase_scores" ON candidate_phase_scores FOR ALL USING (auth.role() = 'service_role');

-- 2. Backfill de la Phase 1 (toutes les phases terminées existantes)
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT * FROM game_phases WHERE status = 'completed' LOOP
    INSERT INTO candidate_phase_scores (
      candidate_id,
      phase_id,
      phase_name,
      vote_points,
      jury_ecriture,
      jury_technique,
      jury_attitude,
      jury_originalite,
      social_likes,
      social_comments,
      social_shares,
      total_score,
      is_eliminated_in_phase,
      created_at
    )
    SELECT 
      c.id,
      p.id,
      p.name,
      -- Votes enregistrés avant ou au moment de la clôture de la phase
      COALESCE((
        SELECT SUM(v.points) 
        FROM votes v 
        WHERE v.candidate_id = c.id 
          AND (p.completed_at IS NULL OR v.created_at <= p.completed_at)
      ), c.phase_vote_points, 0),
      -- Notes du jury
      COALESCE(c.jury_ecriture, c.phase_jury_ecriture, 0),
      COALESCE(c.jury_technique, c.phase_jury_technique, 0),
      COALESCE(c.jury_attitude, c.phase_jury_attitude, 0),
      COALESCE(c.jury_originalite, c.phase_jury_originalite, 0),
      -- Statistiques réseaux sociaux
      COALESCE(c.social_likes, c.phase_social_likes, 0),
      COALESCE(c.social_comments, c.phase_social_comments, 0),
      COALESCE(c.social_shares, c.phase_social_shares, 0),
      -- Calcul du score total pour la phase
      (
        COALESCE((
          SELECT SUM(v.points) 
          FROM votes v 
          WHERE v.candidate_id = c.id 
            AND (p.completed_at IS NULL OR v.created_at <= p.completed_at)
        ), c.phase_vote_points, 0) +
        COALESCE(c.jury_ecriture, c.phase_jury_ecriture, 0) +
        COALESCE(c.jury_technique, c.phase_jury_technique, 0) +
        COALESCE(c.jury_attitude, c.phase_jury_attitude, 0) +
        COALESCE(c.jury_originalite, c.phase_jury_originalite, 0) +
        COALESCE(c.social_likes, c.phase_social_likes, 0) +
        (COALESCE(c.social_comments, c.phase_social_comments, 0) * 2) +
        (COALESCE(c.social_shares, c.phase_social_shares, 0) * 5)
      ),
      -- Si le candidat a été éliminé dans cette phase
      c.is_eliminated,
      COALESCE(p.completed_at, NOW())
    FROM candidates c
    WHERE c.status = 'approved'
    ON CONFLICT (candidate_id, phase_id) DO NOTHING;
  END LOOP;
END $$;

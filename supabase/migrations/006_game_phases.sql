-- ================================================
-- Golden Mic 237 — Migration : Game Phases & Eliminations
-- ================================================

-- 1. Create game_phases table
CREATE TABLE IF NOT EXISTS game_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  eliminated_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Insert initial phase
INSERT INTO game_phases (name) VALUES ('Éliminatoires');

-- 2. Add is_eliminated to candidates
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS is_eliminated BOOLEAN DEFAULT false;

-- 3. Add phase-specific score columns to candidates (we use these for the frontend and ranking)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phase_vote_points BIGINT DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phase_jury_ecriture INTEGER DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phase_jury_technique INTEGER DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phase_jury_attitude INTEGER DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phase_jury_originalite INTEGER DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phase_social_likes INTEGER DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phase_social_comments INTEGER DEFAULT 0;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phase_social_shares INTEGER DEFAULT 0;

-- 4. Initialize phase columns with current global columns (so we don't start at 0 immediately for the current phase)
UPDATE candidates SET 
  phase_vote_points = total_points,
  phase_jury_ecriture = COALESCE(jury_ecriture, 0),
  phase_jury_technique = COALESCE(jury_technique, 0),
  phase_jury_attitude = COALESCE(jury_attitude, 0),
  phase_jury_originalite = COALESCE(jury_originalite, 0),
  phase_social_likes = COALESCE(social_likes, 0),
  phase_social_comments = COALESCE(social_comments, 0),
  phase_social_shares = COALESCE(social_shares, 0);

-- 5. Drop the trigger that depends on note_totale first, then update the generated column
DROP TRIGGER IF EXISTS trg_update_ranks ON candidates;
ALTER TABLE candidates DROP COLUMN IF EXISTS note_totale;
ALTER TABLE candidates ADD COLUMN note_totale DECIMAL(10,2) GENERATED ALWAYS AS (
  phase_vote_points + 
  COALESCE(phase_jury_ecriture, 0) + 
  COALESCE(phase_jury_technique, 0) + 
  COALESCE(phase_jury_attitude, 0) + 
  COALESCE(phase_jury_originalite, 0) + 
  COALESCE(phase_social_likes, 0) + 
  (COALESCE(phase_social_comments, 0) * 2) + 
  (COALESCE(phase_social_shares, 0) * 5)
) STORED;

-- 6. Update increment_candidate_points function to increment BOTH total_points and phase_vote_points
CREATE OR REPLACE FUNCTION increment_candidate_points(
  candidate_id UUID,
  points_to_add BIGINT
) RETURNS VOID AS $$
BEGIN
  UPDATE candidates
  SET
    total_points = total_points + points_to_add,
    phase_vote_points = phase_vote_points + points_to_add,
    vote_count = vote_count + 1
  WHERE id = candidate_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Update rank trigger to only rank non-eliminated candidates
CREATE OR REPLACE FUNCTION update_candidate_ranks()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE candidates c
  SET rank = ranked.r
  FROM (
    SELECT id, RANK() OVER (ORDER BY note_totale DESC) AS r
    FROM candidates
    WHERE status = 'approved' AND is_eliminated = false
  ) AS ranked
  WHERE c.id = ranked.id AND c.status = 'approved' AND c.is_eliminated = false;
  
  -- Set rank to NULL for eliminated candidates
  UPDATE candidates SET rank = NULL WHERE is_eliminated = true;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace the trigger to fire on note_totale update
CREATE TRIGGER trg_update_ranks
  AFTER UPDATE OF note_totale ON candidates
  FOR EACH ROW
  WHEN (OLD.note_totale IS DISTINCT FROM NEW.note_totale)
  EXECUTE FUNCTION update_candidate_ranks();

-- 8. Add RLS for game_phases (if needed, though admin endpoint accesses it via service_role)
ALTER TABLE game_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_phases" ON game_phases FOR SELECT USING (true);
CREATE POLICY "service_role_all_phases" ON game_phases FOR ALL USING (auth.role() = 'service_role');

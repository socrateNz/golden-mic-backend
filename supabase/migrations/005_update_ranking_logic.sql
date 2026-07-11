-- ================================================
-- Golden Mic 237 — Migration : Update Ranking Logic
-- ================================================

-- 1. Add generated column for total note
ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS note_totale DECIMAL(10,2) GENERATED ALWAYS AS (
  total_points + 
  COALESCE(jury_ecriture, 0) + 
  COALESCE(jury_technique, 0) + 
  COALESCE(jury_attitude, 0) + 
  COALESCE(jury_originalite, 0) + 
  COALESCE(social_likes, 0) + 
  (COALESCE(social_comments, 0) * 2) + 
  (COALESCE(social_shares, 0) * 5)
) STORED;

-- 2. Update the ranking function to use note_totale
CREATE OR REPLACE FUNCTION update_candidate_ranks()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE candidates c
  SET rank = ranked.r
  FROM (
    SELECT id, RANK() OVER (ORDER BY note_totale DESC) AS r
    FROM candidates
    WHERE status = 'approved'
  ) AS ranked
  WHERE c.id = ranked.id AND c.status = 'approved';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Replace the trigger to fire on note_totale update
DROP TRIGGER IF EXISTS trg_update_ranks ON candidates;

CREATE TRIGGER trg_update_ranks
  AFTER UPDATE OF note_totale ON candidates
  FOR EACH ROW
  WHEN (OLD.note_totale IS DISTINCT FROM NEW.note_totale)
  EXECUTE FUNCTION update_candidate_ranks();

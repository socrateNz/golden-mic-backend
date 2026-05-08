-- Harmonise les catégories visibles dans le formulaire d'inscription
-- Cibles: Rap, Mbole, Chant / RnB / Soul, Afropop, Autre

-- Désactive les anciennes catégories
UPDATE categories
SET is_active = false;

-- Crée/active les catégories attendues
INSERT INTO categories (name, slug, description, is_active)
VALUES
  ('Rap', 'rap', 'Rap'),
  ('Mbole', 'mbole', 'Mbole'),
  ('Chant / RnB / Soul', 'chant-rnb-soul', 'Chant, RnB, Soul'),
  ('Afropop', 'afropop', 'Afropop'),
  ('Autre', 'autre', 'Autre catégorie')
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = NOW();


-- fc27-community-v1: same as v0, except the manager adds +1 to the count of their nation and of their
-- league (Jeff, from the game, 2026-11-02) instead of +1 chemistry directly, and an in-position Icon always
-- has max chemistry while a Hero does not (Jeff, 2026-11-02). v0 is kept for history.

UPDATE chemistry_rule_versions SET is_active = 0 WHERE id = 'fc27-community-v0';

INSERT INTO chemistry_rule_versions (id, season, label, status, is_active, source_notes) VALUES
  ('fc27-community-v1', 'FC27', 'FC 27 community thresholds v1 (manager counts towards links)', 'unverified', 1,
   'v0 thresholds and Icon/Hero rules (community guides, not confirmed by EA). Manager rule changed on 2026-11-02: Jeff confirmed in game that the manager adds +1 towards the link count, not +1 chemistry. Still unverified until the in-game seed squad test passes.');

INSERT INTO chemistry_thresholds (rule_version_id, link_type, points, players_required)
  SELECT 'fc27-community-v1', link_type, points, players_required
  FROM chemistry_thresholds WHERE rule_version_id = 'fc27-community-v0';

INSERT INTO chemistry_modifiers (rule_version_id, key, value, description)
  SELECT 'fc27-community-v1', key, value, description
  FROM chemistry_modifiers WHERE rule_version_id = 'fc27-community-v0' AND key <> 'manager.bonus';

INSERT INTO chemistry_modifiers (rule_version_id, key, value, description) VALUES
  ('fc27-community-v1', 'manager.nation_count', 1, 'The manager adds 1 to the count of their nation (Jeff, in game, 2026-11-02).'),
  ('fc27-community-v1', 'manager.league_count', 1, 'The manager adds 1 to the count of their league (Jeff, in game, 2026-11-02).'),
  ('fc27-community-v1', 'icon.always_max', 1, 'An Icon in position always has max chemistry (Jeff, in game, 2026-11-02).'),
  ('fc27-community-v1', 'hero.always_max', 0, 'Heroes do NOT get automatic max chemistry (Jeff, in game, 2026-11-02).');

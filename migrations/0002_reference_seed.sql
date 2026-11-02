-- Reference data that the importers rely on. Editable rows, not hardcoded enums.

INSERT INTO positions (code, name, line, sort_order) VALUES
  ('GK',  'Goalkeeper',               'GK',  1),
  ('RB',  'Right Back',               'DEF', 2),
  ('CB',  'Centre Back',              'DEF', 3),
  ('LB',  'Left Back',                'DEF', 4),
  ('CDM', 'Central Defensive Midfield','MID', 5),
  ('CM',  'Central Midfield',         'MID', 6),
  ('CAM', 'Central Attacking Midfield','MID', 7),
  ('RM',  'Right Midfield',           'MID', 8),
  ('LM',  'Left Midfield',            'MID', 9),
  ('RW',  'Right Wing',               'ATT', 10),
  ('LW',  'Left Wing',                'ATT', 11),
  ('ST',  'Striker',                  'ATT', 12);

INSERT INTO attribute_defs (key, name, category, sort_order) VALUES
  ('pac', 'Pace', 'face', 1),
  ('sho', 'Shooting', 'face', 2),
  ('pas', 'Passing', 'face', 3),
  ('dri', 'Dribbling', 'face', 4),
  ('def', 'Defending', 'face', 5),
  ('phy', 'Physical', 'face', 6),
  ('acceleration', 'Acceleration', 'pace', 10),
  ('sprint_speed', 'Sprint Speed', 'pace', 11),
  ('positioning', 'Positioning', 'shooting', 20),
  ('finishing', 'Finishing', 'shooting', 21),
  ('shot_power', 'Shot Power', 'shooting', 22),
  ('long_shots', 'Long Shots', 'shooting', 23),
  ('volleys', 'Volleys', 'shooting', 24),
  ('penalties', 'Penalties', 'shooting', 25),
  ('vision', 'Vision', 'passing', 30),
  ('crossing', 'Crossing', 'passing', 31),
  ('free_kick_accuracy', 'Free Kick Accuracy', 'passing', 32),
  ('short_passing', 'Short Passing', 'passing', 33),
  ('long_passing', 'Long Passing', 'passing', 34),
  ('curve', 'Curve', 'passing', 35),
  ('agility', 'Agility', 'dribbling', 40),
  ('balance', 'Balance', 'dribbling', 41),
  ('reactions', 'Reactions', 'dribbling', 42),
  ('ball_control', 'Ball Control', 'dribbling', 43),
  ('dribbling', 'Dribbling', 'dribbling', 44),
  ('composure', 'Composure', 'dribbling', 45),
  ('interceptions', 'Interceptions', 'defending', 50),
  ('heading_accuracy', 'Heading Accuracy', 'defending', 51),
  ('defensive_awareness', 'Defensive Awareness', 'defending', 52),
  ('standing_tackle', 'Standing Tackle', 'defending', 53),
  ('sliding_tackle', 'Sliding Tackle', 'defending', 54),
  ('jumping', 'Jumping', 'physical', 60),
  ('stamina', 'Stamina', 'physical', 61),
  ('strength', 'Strength', 'physical', 62),
  ('aggression', 'Aggression', 'physical', 63),
  ('gk_diving', 'GK Diving', 'goalkeeping', 70),
  ('gk_handling', 'GK Handling', 'goalkeeping', 71),
  ('gk_kicking', 'GK Kicking', 'goalkeeping', 72),
  ('gk_positioning', 'GK Positioning', 'goalkeeping', 73),
  ('gk_reflexes', 'GK Reflexes', 'goalkeeping', 74);

-- Where data may come from, and whether its terms allow us to use it.
-- The importer refuses 'blocked' sources and requires an explicit, recorded acceptance for 'pending_review'.
INSERT INTO data_sources (id, name, kind, url, terms_status, terms_notes) VALUES
  ('manual', 'Entered by hand from the game', 'manual', NULL, 'approved',
   'Cards typed in by the XI Lab owner from their own FC 27 game. No third-party terms apply.'),
  ('kaggle-mikedpad-fc27', 'Kaggle: EA SPORTS FC 27 Player Ratings (MikeDPad)', 'dataset',
   'https://www.kaggle.com/datasets/mikedpad/ea-sports-fc27-player-ratings', 'pending_review',
   'Licence "Other (specified in description)". Description says it is fetched from EA''s public ratings API, all data belongs to Electronic Arts, and it is an unofficial non-commercial snapshot (2026-09-14). Covers launch gold/silver/bronze base items only: no promos, Icons, Heroes, roles or prices. Needs the owner''s decision before use.'),
  ('ea-ratings-site', 'ea.com FC 27 Player Ratings feed', 'official',
   'https://www.ea.com/games/ea-sports-fc/ratings', 'approved',
   'Undocumented JSON feed behind EA''s public ratings page (drop-api.ea.com). No reuse licence: EA User Agreement s.2 is non-commercial use only, and ea.com/robots.txt reserves rights against scraping and text/data mining. Jeff (owner) approved pulling it on 2026-11-02 for a personal, non-commercial build. Snapshots stay out of the public repo. Re-check before any public or paid launch.'),
  ('ea-fc-community-api', 'EA FC Community API', 'api',
   'https://help.ea.com/en/articles/ea-sports-fc/community-api/', 'blocked',
   'Official, but only FUTBIN, FUT.GG and FUTWIZ are approved partners and EA is not accepting requests (checked 2026-11-02). Revisit if EA opens applications.'),
  ('futbin-futgg-futwiz', 'FUTBIN / FUT.GG / FUTWIZ', 'api', NULL, 'blocked',
   'No public API or data licence. Taking their data would mean scraping, which the XI Lab brief rules out.');

-- Chemistry rule version seeded from community write-ups. NOT confirmed by EA: kept editable and labelled unverified.
INSERT INTO chemistry_rule_versions (id, season, label, status, is_active, source_notes) VALUES
  ('fc27-community-v0', 'FC27', 'FC 27 community thresholds v0', 'unverified', 1,
   'Thresholds from community guides (FIFPlay, Timesaver) as of 2026-11-02. Icon/Hero contributions from Timesaver quoting EA FC 27 launch pitch notes (2026-09-14). Not checked against in-game squads yet. Mark verified only after the in-game scenario test set passes.');

INSERT INTO chemistry_thresholds (rule_version_id, link_type, points, players_required) VALUES
  ('fc27-community-v0', 'club',   1, 2),
  ('fc27-community-v0', 'club',   2, 4),
  ('fc27-community-v0', 'club',   3, 7),
  ('fc27-community-v0', 'nation', 1, 2),
  ('fc27-community-v0', 'nation', 2, 5),
  ('fc27-community-v0', 'nation', 3, 8),
  ('fc27-community-v0', 'league', 1, 3),
  ('fc27-community-v0', 'league', 2, 5),
  ('fc27-community-v0', 'league', 3, 8);

INSERT INTO chemistry_modifiers (rule_version_id, key, value, description) VALUES
  ('fc27-community-v0', 'player.max_chemistry', 3, 'Maximum chemistry for one player.'),
  ('fc27-community-v0', 'manager.bonus', 1, 'Extra chemistry for a player whose nation or league matches the manager.'),
  ('fc27-community-v0', 'icon.nation_bonus', 1, 'Extra nation count an Icon adds (community reading of FC 27 pitch notes).'),
  ('fc27-community-v0', 'icon.every_league_bonus', 1, 'An Icon adds 1 to the count of every league in the XI (community reading).'),
  ('fc27-community-v0', 'hero.league_bonus', 1, 'Extra league count a Hero adds (community reading).'),
  ('fc27-community-v0', 'hero.nation_bonus', 1, 'Extra nation count a Hero adds (community reading).');

-- Boxes are now earned every time a rally reaches a milestone, so a user can hold several of
-- the same tier. Rebuild box_awards with its own id instead of (user_id, threshold) as the key.
CREATE TABLE box_awards_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  threshold  INTEGER NOT NULL,
  awarded_at INTEGER NOT NULL,
  opened_at  INTEGER,
  skin_id    TEXT
);
INSERT INTO box_awards_new (user_id, threshold, awarded_at, opened_at, skin_id)
  SELECT user_id, threshold, awarded_at, opened_at, skin_id FROM box_awards;
DROP TABLE box_awards;
ALTER TABLE box_awards_new RENAME TO box_awards;
CREATE INDEX box_awards_user ON box_awards (user_id, opened_at);

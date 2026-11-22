-- One row per mystery box. A box is earned the first time a player's rally reaches `threshold`
-- (25, 50, 100, 250, 500 -> common ... legendary) and stays unopened until skin_id is set.
CREATE TABLE box_awards (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  threshold  INTEGER NOT NULL,
  awarded_at INTEGER NOT NULL,
  opened_at  INTEGER,
  skin_id    TEXT,
  PRIMARY KEY (user_id, threshold)
);

-- Replaced by box_awards (the old counter was never written to).
DROP TABLE boxes;

-- Players who already reached a milestone before boxes existed get the boxes they earned.
INSERT OR IGNORE INTO box_awards (user_id, threshold, awarded_at)
  SELECT s.user_id, t.threshold, s.best_at
  FROM (SELECT user_id, MAX(best_rally) AS best_rally, MIN(best_at) AS best_at FROM scores GROUP BY user_id) s
  JOIN (SELECT 25 AS threshold UNION ALL SELECT 50 UNION ALL SELECT 100 UNION ALL SELECT 250 UNION ALL SELECT 500) t
    ON s.best_rally >= t.threshold;

-- `users.equipped` now holds JSON: {"ball": skin id or null, "paddle": skin id or null}.

-- Best rally per game mode: 1 = solo, 2 = two-player, 4 = four-player.
CREATE TABLE scores (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode       INTEGER NOT NULL CHECK (mode IN (1, 2, 4)),
  best_rally INTEGER NOT NULL DEFAULT 0,
  best_at    INTEGER NOT NULL,       -- when best_rally was last improved; earlier wins ties
  PRIMARY KEY (user_id, mode)
);
CREATE INDEX scores_board ON scores (mode, best_rally DESC, best_at ASC);

-- Earlier bests were not tracked per mode; keep them as solo scores.
INSERT INTO scores (user_id, mode, best_rally, best_at)
  SELECT id, 1, best_rally, COALESCE(best_at, 0) FROM users WHERE best_rally > 0;

DROP INDEX users_leaderboard;
ALTER TABLE users DROP COLUMN best_rally;
ALTER TABLE users DROP COLUMN best_at;

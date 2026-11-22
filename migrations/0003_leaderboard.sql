ALTER TABLE users ADD COLUMN best_at INTEGER;  -- when best_rally was last improved; earlier wins ties
CREATE INDEX users_leaderboard ON users (best_rally DESC, best_at ASC) WHERE best_rally > 0;

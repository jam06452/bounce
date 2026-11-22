-- Two- and four-player boards rank teams, not individuals.
-- `team` is the members' Slack IDs, sorted and comma-joined.
CREATE TABLE teams (
  mode       INTEGER NOT NULL CHECK (mode IN (2, 4)),
  team       TEXT NOT NULL,
  best_rally INTEGER NOT NULL DEFAULT 0,
  best_at    INTEGER NOT NULL,       -- when best_rally was last improved; earlier wins ties
  PRIMARY KEY (mode, team)
);
CREATE INDEX teams_board ON teams (mode, best_rally DESC, best_at ASC, team ASC);

CREATE TABLE team_members (
  mode    INTEGER NOT NULL,
  team    TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (mode, team, user_id),
  FOREIGN KEY (mode, team) REFERENCES teams(mode, team) ON DELETE CASCADE
);
CREATE INDEX team_members_user ON team_members (user_id, mode);

-- Existing personal 2P/4P bests become single-member teams (partners were not recorded).
INSERT INTO teams (mode, team, best_rally, best_at)
  SELECT s.mode, u.slack_id, s.best_rally, s.best_at
  FROM scores s JOIN users u ON u.id = s.user_id
  WHERE s.mode IN (2, 4) AND s.best_rally > 0 AND u.slack_id IS NOT NULL;
INSERT INTO team_members (mode, team, user_id)
  SELECT s.mode, u.slack_id, u.id
  FROM scores s JOIN users u ON u.id = s.user_id
  WHERE s.mode IN (2, 4) AND s.best_rally > 0 AND u.slack_id IS NOT NULL;

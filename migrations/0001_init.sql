CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sub        TEXT NOT NULL UNIQUE,   -- OIDC subject from Hack Club Auth
  slack_id   TEXT,                   -- refreshed on every login
  equipped   TEXT,                   -- skin id, NULL = default ball
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,       -- sha256 hex of the bearer token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expires ON sessions(expires_at);

CREATE TABLE auth_attempts (
  state      TEXT PRIMARY KEY,
  verifier   TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  origin     TEXT NOT NULL,          -- game origin allowed to receive the token
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_attempts_expires ON auth_attempts(expires_at);

CREATE TABLE inventory (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skin_id     TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skin_id)
);

CREATE TABLE boxes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  count   INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0)
);

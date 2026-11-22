-- Duplicate-box rally bonus waiting to be spent at the next serve (capped in code, see MAX_PENDING_BONUS).
ALTER TABLE users ADD COLUMN pending_bonus INTEGER NOT NULL DEFAULT 0;

-- 0 = won but not yet looked at in the locker (drives the "NEW" badge). Existing skins count as seen.
ALTER TABLE inventory ADD COLUMN seen INTEGER NOT NULL DEFAULT 1;

-- Whether an opened box gave a skin the player already owned (box history).
ALTER TABLE box_awards ADD COLUMN duplicate INTEGER NOT NULL DEFAULT 0;

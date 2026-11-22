ALTER TABLE users ADD COLUMN display_name TEXT;
CREATE INDEX users_display_name ON users (display_name COLLATE NOCASE);

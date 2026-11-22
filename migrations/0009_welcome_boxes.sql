-- New accounts get free boxes on their first sign-in. 0 = not yet given. Every account that exists
-- when this migration runs counts as already welcomed (the default), so only new signups get them.
ALTER TABLE users ADD COLUMN welcomed INTEGER NOT NULL DEFAULT 1;

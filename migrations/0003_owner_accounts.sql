-- Uruchom tylko raz w istniejącej bazie D1; nie usuwa żadnych danych.
CREATE TABLE IF NOT EXISTS owner_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS owner_permissions (
  user_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  can_view INTEGER NOT NULL DEFAULT 0,
  can_cancel INTEGER NOT NULL DEFAULT 0,
  can_block INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, profile_id),
  FOREIGN KEY(user_id) REFERENCES owner_users(id),
  FOREIGN KEY(profile_id) REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS owner_permissions_profile_idx ON owner_permissions(profile_id);

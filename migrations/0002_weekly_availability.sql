-- Dodaje powtarzalne przedziały dostępności, nie zmieniając istniejących danych.
CREATE TABLE IF NOT EXISTS weekly_availability (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS weekly_availability_profile_day_idx ON weekly_availability(profile_id, weekday);

-- Uruchom jednorazowo w Cloudflare D1 / Console przed wdrozeniem plikow.
CREATE TABLE IF NOT EXISTS booking_detail_options (
  category TEXT NOT NULL CHECK (category IN ('place','outfit','food')),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category, label)
);

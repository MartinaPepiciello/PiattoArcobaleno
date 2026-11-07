-- Piatto Arcobaleno: one row per nickname, one row per thing eaten.
CREATE TABLE IF NOT EXISTS people (
  id         TEXT PRIMARY KEY,          -- nickname, lowercased and trimmed
  name       TEXT NOT NULL,             -- nickname as typed
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entries (
  id         TEXT PRIMARY KEY,          -- random id made by the app
  uid        TEXT NOT NULL,             -- people.id
  day        TEXT NOT NULL,             -- YYYY-MM-DD
  cat        TEXT NOT NULL,             -- category key (see src/worker.js)
  portions   REAL NOT NULL DEFAULT 1,
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS entries_uid_day ON entries (uid, day);

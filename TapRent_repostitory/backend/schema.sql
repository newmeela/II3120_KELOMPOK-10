PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS items (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
 daily_rate INTEGER NOT NULL CHECK(daily_rate > 0),
 available_from TEXT NOT NULL, available_until TEXT NOT NULL,
 rfid_uid TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS bookings (
 id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES items(id),
 starts TEXT NOT NULL, ends TEXT NOT NULL CHECK(ends > starts),
 total INTEGER NOT NULL, pickup_code TEXT UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('MENUNGGU_PERSETUJUAN','DISETUJUI','DIPESAN','SIAP_DIAMBIL','SEDANG_DIPINJAM','MENUNGGU_PEMERIKSAAN','SELESAI','DITOLAK','DIBATALKAN')),
 timeline TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_schedule ON bookings(item_id, starts, ends);
CREATE TABLE IF NOT EXISTS iot_logs (
 event_id TEXT PRIMARY KEY, tag_id TEXT NOT NULL, device_id TEXT NOT NULL,
 timestamp TEXT NOT NULL, booking_id INTEGER REFERENCES bookings(id),
 stage TEXT, result TEXT NOT NULL, confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 role TEXT NOT NULL CHECK (role IN ('penyewa', 'pemilik', 'mitra')),
 salt BLOB NOT NULL, password_hash BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);

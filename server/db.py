"""SQLite storage."""
import json
import sqlite3
import threading
from contextlib import contextmanager

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,             -- google | microsoft
    email TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calendars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#1a73e8',
    source TEXT NOT NULL DEFAULT 'local',  -- local | ics | google | microsoft
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    remote_id TEXT,
    url TEXT,
    visible INTEGER NOT NULL DEFAULT 1,
    read_only INTEGER NOT NULL DEFAULT 0,
    default_reminders TEXT NOT NULL DEFAULT '[10]',
    last_synced REAL,
    sync_error TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    uid TEXT,                -- stable id within the calendar (remote id for synced events)
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    start TEXT NOT NULL,     -- UTC 'YYYY-MM-DDTHH:MM:SSZ' or 'YYYY-MM-DD' when all_day
    end TEXT NOT NULL,       -- exclusive
    all_day INTEGER NOT NULL DEFAULT 0,
    tz TEXT,                 -- IANA zone the event was created in (for recurrence)
    rrule TEXT,              -- RFC 5545 RRULE body for local recurring events
    exdates TEXT NOT NULL DEFAULT '[]',
    reminders TEXT,          -- JSON list of minutes before; NULL = calendar default
    color TEXT,
    url TEXT,
    updated_at REAL
);
CREATE INDEX IF NOT EXISTS idx_events_cal ON events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_range ON events(start, end);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_uid ON events(calendar_id, uid);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at REAL
);

CREATE TABLE IF NOT EXISTS sent_notifications (
    key TEXT PRIMARY KEY,
    sent_at REAL
);
"""

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
        _conn.executescript(SCHEMA)
    return _conn


@contextmanager
def tx():
    conn = connect()
    with _lock:
        conn.execute("BEGIN")
        try:
            yield conn
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise


def query(sql: str, params=()) -> list[dict]:
    with _lock:
        return [dict(r) for r in connect().execute(sql, params).fetchall()]


def one(sql: str, params=()) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params=()) -> int:
    with _lock:
        cur = connect().execute(sql, params)
        return cur.lastrowid


def get_setting(key: str, default=None):
    row = one("SELECT value FROM settings WHERE key=?", (key,))
    return json.loads(row["value"]) if row else default


def set_setting(key: str, value) -> None:
    execute(
        "INSERT INTO settings(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, json.dumps(value)),
    )

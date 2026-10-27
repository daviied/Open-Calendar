"""Web Push notifications for event reminders."""
import asyncio
import base64
import json
import logging
import time
from datetime import datetime, timedelta
from urllib.parse import urlencode

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid01
from pywebpush import WebPushException, webpush

from . import config, db, tasks
from .events import UTC, get_zone, list_occurrences, parse_date, parse_dt

log = logging.getLogger("calendar.push")

# Reminders this late are still sent (covers server restarts / sleep).
GRACE = timedelta(minutes=15)
LOOKAHEAD = timedelta(days=8)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def vapid_keys() -> dict:
    keys = db.get_setting("vapid")
    if keys:
        return keys
    private = ec.generate_private_key(ec.SECP256R1())
    pem = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()).decode()
    public = private.public_key().public_bytes(serialization.Encoding.X962,
                                               serialization.PublicFormat.UncompressedPoint)
    keys = {"private_pem": pem, "public": _b64(public)}
    db.set_setting("vapid", keys)
    return keys


def send_to_all(payload: dict) -> int:
    vapid = Vapid01.from_pem(vapid_keys()["private_pem"].encode())
    sent = 0
    for sub in db.query("SELECT * FROM push_subscriptions"):
        info = {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
        try:
            webpush(info, json.dumps(payload), vapid_private_key=vapid,
                    vapid_claims={"sub": config.VAPID_SUBJECT}, ttl=3600)
            sent += 1
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):  # subscription expired / unsubscribed
                db.execute("DELETE FROM push_subscriptions WHERE id=?", (sub["id"],))
            else:
                log.warning("Push failed: %s", exc)
        except Exception as exc:
            log.warning("Push failed: %s", exc)
    return sent


def _start_time(occ: dict) -> datetime:
    if occ.get("kind") == "task":
        # Reminders count back from the deadline; a date-only deadline counts as 9am that day.
        if occ["all_day"]:
            d = parse_date(occ["due"])
            zone = get_zone(db.get_setting("timezone", "UTC"))
            return datetime(d.year, d.month, d.day, 9, tzinfo=zone).astimezone(UTC)
        return parse_dt(occ["due"])
    if occ["all_day"]:
        # All-day reminders are relative to local midnight in the server's configured zone.
        d = parse_date(occ["start"])
        zone = get_zone(db.get_setting("timezone", "UTC"))
        return datetime(d.year, d.month, d.day, tzinfo=zone).astimezone(UTC)
    return parse_dt(occ["start"])


def _when_text(occ: dict, minutes: int) -> str:
    if occ.get("kind") == "task":
        prefix = f"{occ['course']} · " if occ.get("course") else ""
        if minutes == 0:
            return prefix + ("Due today" if occ["all_day"] else "Due now")
        relative = _when_text({**occ, "kind": None, "all_day": False}, minutes)  # e.g. "In 1 day"
        return f"{prefix}Due {relative[0].lower()}{relative[1:]}"
    if occ["all_day"]:
        return "All day" if minutes == 0 else "All-day event"
    if minutes == 0:
        return "Starting now"
    if minutes < 60:
        return f"In {minutes} minutes"
    if minutes < 1440:
        h = minutes // 60
        return f"In {h} hour{'s' if h != 1 else ''}"
    d = minutes // 1440
    return f"In {d} day{'s' if d != 1 else ''}"


def check_reminders() -> None:
    if not db.one("SELECT id FROM push_subscriptions LIMIT 1"):
        return
    now = datetime.now(UTC)
    items = list_occurrences(now - GRACE, now + LOOKAHEAD) + tasks.calendar_items(now - GRACE, now + LOOKAHEAD)
    for occ in items:
        start = _start_time(occ)
        for minutes in occ["effective_reminders"]:
            fire_at = start - timedelta(minutes=minutes)
            if not (now - GRACE <= fire_at <= now):
                continue
            # Includes the time, so moving an event or deadline re-arms its reminders.
            key = f"{occ['id']}|{occ['start']}|{minutes}"
            if db.one("SELECT key FROM sent_notifications WHERE key=?", (key,)):
                continue
            db.execute("INSERT OR IGNORE INTO sent_notifications(key, sent_at) VALUES(?, ?)", (key, time.time()))
            body = _when_text(occ, minutes)
            if occ["location"]:
                body += f" · {occ['location']}"
            send_to_all({"title": occ["title"], "body": body, "tag": key,
                         "url": f"/?{urlencode({'event': occ['id'], 'start': occ['start']})}",
                         "start": occ["start"]})
    db.execute("DELETE FROM sent_notifications WHERE sent_at < ?", (time.time() - 30 * 86400,))


async def reminder_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(check_reminders)
        except Exception:
            log.exception("Reminder loop error")
        await asyncio.sleep(30)

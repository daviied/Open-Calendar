"""Event storage helpers and recurrence expansion."""
import json
import re
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr

from . import db

UTC = timezone.utc


# ---------- time helpers ----------

def parse_dt(value: str) -> datetime:
    """Parse an ISO datetime (any offset) into an aware UTC datetime."""
    value = value.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def fmt_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def get_zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def normalize_rrule(rule: str | None, all_day: bool) -> str | None:
    """Clean an RRULE body ("FREQ=WEEKLY;BYDAY=MO") so dateutil accepts it."""
    if not rule:
        return None
    rule = rule.strip()
    if rule.upper().startswith("RRULE:"):
        rule = rule[6:]
    parts = []
    for part in rule.split(";"):
        if not part or "=" not in part:
            continue
        key, val = part.split("=", 1)
        key = key.upper()
        if key == "UNTIL":
            digits = re.sub(r"[^0-9T]", "", val.upper())
            day = digits[:8]
            if all_day:
                val = day
            elif len(digits) >= 15 and val.upper().endswith("Z"):
                val = digits[:15] + "Z"
            else:
                val = f"{day}T235959Z"
        parts.append(f"{key}={val}")
    if not any(p.startswith("FREQ=") for p in parts):
        return None
    return ";".join(parts)


# ---------- expansion ----------

def _calendar_map() -> dict[int, dict]:
    return {c["id"]: c for c in db.query("SELECT * FROM calendars")}


def _serialize(ev: dict, cal: dict, start: str, end: str, recurring: bool, done_keys: set | None = None) -> dict:
    occ_id = f"{ev['id']}:{start}" if recurring else str(ev["id"])
    reminders = ev["reminders"]
    # Calendars shown as assignments (e.g. Canvas) can have their events checked off.
    done_key = f"{ev['uid']}|{start}" if recurring else (ev["uid"] or str(ev["id"]))
    is_assignment = bool(cal.get("assignments"))
    done = is_assignment and (cal["id"], done_key) in (done_keys or set())
    effective = json.loads(reminders if reminders is not None else cal["default_reminders"])
    return {
        "kind": "event",
        "assignment": is_assignment,
        "done": done,
        "done_key": done_key,
        "calendar_name": cal["name"],
        "id": occ_id,
        "event_id": ev["id"],
        "calendar_id": ev["calendar_id"],
        "title": ev["title"],
        "description": ev["description"],
        "location": ev["location"],
        "start": start,
        "end": end,
        "all_day": bool(ev["all_day"]),
        "recurring": recurring,
        "rrule": ev["rrule"],
        "series_start": ev["start"],
        "series_end": ev["end"],
        "tz": ev["tz"],
        "reminders": json.loads(reminders) if reminders is not None else None,
        "effective_reminders": [] if done else effective,
        "color": ev["color"] or cal["color"],
        "url": ev["url"],
        "read_only": bool(cal["read_only"]),
    }


def expand_event(ev: dict, cal: dict, range_start: datetime, range_end: datetime,
                 done_keys: set | None = None) -> list[dict]:
    if not ev["rrule"]:
        return [_serialize(ev, cal, ev["start"], ev["end"], False, done_keys)]

    exdates = set(json.loads(ev["exdates"] or "[]"))
    out = []
    try:
        if ev["all_day"]:
            s, e = parse_date(ev["start"]), parse_date(ev["end"])
            dur = e - s
            rule = rrulestr(ev["rrule"], dtstart=datetime(s.year, s.month, s.day))
            lo = datetime.combine(range_start.date(), datetime.min.time()) - dur - timedelta(days=1)
            hi = datetime.combine(range_end.date(), datetime.min.time()) + timedelta(days=1)
            for occ in rule.between(lo, hi, inc=True):
                start = occ.date().isoformat()
                if start in exdates:
                    continue
                out.append(_serialize(ev, cal, start, (occ.date() + dur).isoformat(), True, done_keys))
        else:
            zone = get_zone(ev["tz"])
            s, e = parse_dt(ev["start"]), parse_dt(ev["end"])
            dur = e - s
            # Expand in the event's own zone so wall-clock time survives DST changes.
            rule = rrulestr(ev["rrule"], dtstart=s.astimezone(zone))
            for occ in rule.between((range_start - dur).astimezone(zone), range_end.astimezone(zone), inc=True):
                start = fmt_utc(occ)
                if start in exdates:
                    continue
                out.append(_serialize(ev, cal, start, fmt_utc(occ + dur), True, done_keys))
    except (ValueError, TypeError):
        # A rule we can't parse: show the first instance only.
        return [_serialize(ev, cal, ev["start"], ev["end"], False, done_keys)]
    return out


def list_occurrences(range_start: datetime, range_end: datetime, visible_only=True) -> list[dict]:
    cals = _calendar_map()
    rs, re_ = fmt_utc(range_start), fmt_utc(range_end)
    rs_d = (range_start - timedelta(days=1)).date().isoformat()
    re_d = (range_end + timedelta(days=1)).date().isoformat()
    rows = db.query(
        """SELECT * FROM events WHERE
             (rrule IS NULL AND (
                (all_day=0 AND start < ? AND end > ?) OR
                (all_day=1 AND start < ? AND end > ?)))
             OR (rrule IS NOT NULL AND start < ?)""",
        (re_, rs, re_d, rs_d, re_d),
    )
    done_keys = {(r["calendar_id"], r["key"]) for r in db.query("SELECT calendar_id, key FROM event_done")}
    out = []
    for ev in rows:
        cal = cals.get(ev["calendar_id"])
        if not cal or (visible_only and not cal["visible"]):
            continue
        if cal.get("assignments") == 2:
            continue  # these events were turned into assignments, which show instead
        out.extend(expand_event(ev, cal, range_start, range_end, done_keys))
    out.sort(key=lambda o: (o["start"], not o["all_day"]))
    return out


# ---------- validation / writes ----------

def clean_payload(data: dict, existing: dict | None = None) -> dict:
    """Validate an event payload from the client into DB column values."""
    merged = dict(existing or {})
    for key in ("calendar_id", "title", "description", "location", "start", "end",
                "all_day", "tz", "rrule", "reminders", "color", "url"):
        if key in data:
            merged[key] = data[key]

    all_day = bool(merged.get("all_day"))
    if not merged.get("start"):
        raise ValueError("start is required")
    if all_day:
        start = parse_date(merged["start"])
        end = parse_date(merged["end"]) if merged.get("end") else start + timedelta(days=1)
        if end <= start:
            end = start + timedelta(days=1)
        start_s, end_s = start.isoformat(), end.isoformat()
    else:
        start = parse_dt(merged["start"])
        end = parse_dt(merged["end"]) if merged.get("end") else start + timedelta(hours=1)
        if end <= start:
            end = start + timedelta(minutes=30)
        start_s, end_s = fmt_utc(start), fmt_utc(end)

    reminders = merged.get("reminders")
    if isinstance(reminders, str):
        reminders = json.loads(reminders)
    if reminders is not None:
        reminders = sorted({int(m) for m in reminders if int(m) >= 0})

    return {
        "calendar_id": int(merged["calendar_id"]),
        "title": (merged.get("title") or "").strip()[:500] or "(No title)",
        "description": (merged.get("description") or "")[:20000],
        "location": (merged.get("location") or "")[:1000],
        "start": start_s,
        "end": end_s,
        "all_day": 1 if all_day else 0,
        "tz": merged.get("tz") or "UTC",
        "rrule": normalize_rrule(merged.get("rrule"), all_day),
        "reminders": json.dumps(reminders) if reminders is not None else None,
        "color": merged.get("color") or None,
        "url": merged.get("url") or None,
        "updated_at": time.time(),
    }


def insert_event(values: dict, uid: str | None = None) -> int:
    cols = list(values.keys()) + ["uid"]
    params = list(values.values()) + [uid]
    return db.execute(
        f"INSERT INTO events({','.join(cols)}) VALUES({','.join('?' * len(cols))})", params
    )


def update_event(event_id: int, values: dict) -> None:
    sets = ",".join(f"{k}=?" for k in values)
    db.execute(f"UPDATE events SET {sets} WHERE id=?", list(values.values()) + [event_id])


def add_exdate(event_id: int, occurrence_start: str) -> None:
    ev = db.one("SELECT exdates FROM events WHERE id=?", (event_id,))
    ex = set(json.loads(ev["exdates"] or "[]"))
    ex.add(occurrence_start)
    db.execute("UPDATE events SET exdates=? WHERE id=?", (json.dumps(sorted(ex)), event_id))


def shift_exdates(ev: dict, delta: timedelta) -> str:
    """Move a series' skipped dates along with the series when it is shifted."""
    out = []
    for ex in json.loads(ev["exdates"] or "[]"):
        if ev["all_day"]:
            out.append((parse_date(ex) + timedelta(days=delta.days)).isoformat())
        else:
            out.append(fmt_utc(parse_dt(ex) + delta))
    return json.dumps(sorted(out))


def remaining_rrule(ev: dict, occurrence_start: str, new_rule: str | None) -> str | None:
    """For a rule with COUNT, reduce COUNT by the occurrences before the split point."""
    if not new_rule or "COUNT=" not in new_rule.upper() or new_rule != ev["rrule"]:
        return new_rule
    if ev["all_day"]:
        s = parse_date(ev["start"])
        rule = rrulestr(ev["rrule"], dtstart=datetime(s.year, s.month, s.day))
        split = datetime.combine(parse_date(occurrence_start), datetime.min.time())
    else:
        zone = get_zone(ev["tz"])
        rule = rrulestr(ev["rrule"], dtstart=parse_dt(ev["start"]).astimezone(zone))
        split = parse_dt(occurrence_start)
    before = sum(1 for occ in rule if occ < split)
    parts = []
    for p in new_rule.split(";"):
        if p.upper().startswith("COUNT="):
            p = f"COUNT={max(1, int(p.split('=')[1]) - before)}"
        parts.append(p)
    return ";".join(parts)


def truncate_series(ev: dict, occurrence_start: str) -> None:
    """End a recurring series just before the given occurrence."""
    rule = ";".join(p for p in (ev["rrule"] or "").split(";")
                    if not p.upper().startswith(("UNTIL=", "COUNT=")))
    if ev["all_day"]:
        until = (parse_date(occurrence_start) - timedelta(days=1)).strftime("%Y%m%d")
    else:
        until = (parse_dt(occurrence_start) - timedelta(seconds=1)).strftime("%Y%m%dT%H%M%SZ")
    db.execute("UPDATE events SET rrule=?, updated_at=? WHERE id=?",
               (f"{rule};UNTIL={until}", time.time(), ev["id"]))

"""Syncing with external calendars: ICS feeds (Canvas, Outlook, Google, any), Google Calendar
API and Microsoft Graph (Outlook / Microsoft 365)."""
import asyncio
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import httpx
import icalendar
import recurring_ical_events

from . import config, db
from .events import UTC, fmt_utc, get_zone, parse_date, parse_dt

log = logging.getLogger("calendar.sync")

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/calendar"

MS_AUTH = f"https://login.microsoftonline.com/{config.MS_TENANT}/oauth2/v2.0/authorize"
MS_TOKEN = f"https://login.microsoftonline.com/{config.MS_TENANT}/oauth2/v2.0/token"
MS_API = "https://graph.microsoft.com/v1.0"
MS_SCOPES = "openid email offline_access User.Read Calendars.ReadWrite"

GOOGLE_COLORS = ["#1a73e8", "#d50000", "#e67c73", "#f4511e", "#f6bf26", "#33b679",
                 "#0b8043", "#039be5", "#3f51b5", "#7986cb", "#8e24aa", "#616161"]

_sync_lock = asyncio.Lock()


class SyncError(Exception):
    pass


def window() -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    return now - timedelta(days=config.SYNC_PAST_DAYS), now + timedelta(days=config.SYNC_FUTURE_DAYS)


def redirect_uri(provider: str) -> str:
    return f"{config.BASE_URL}/api/oauth/{provider}/callback"


def provider_enabled(provider: str) -> bool:
    if provider == "google":
        return bool(config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET)
    if provider == "microsoft":
        return bool(config.MS_CLIENT_ID and config.MS_CLIENT_SECRET)
    return False


def _row(title, start, end, all_day, uid, description="", location="", url=None,
         reminders=None, tz="UTC") -> dict:
    return {
        "uid": uid,
        "title": (title or "(No title)")[:500],
        "description": (description or "")[:20000],
        "location": (location or "")[:1000],
        "start": start,
        "end": end,
        "all_day": 1 if all_day else 0,
        "tz": tz,
        "url": url,
        "reminders": json.dumps(reminders) if reminders is not None else None,
        "updated_at": time.time(),
    }


def store_remote_events(calendar_id: int, rows: list[dict]) -> None:
    """Replace a synced calendar's events with the given set, keyed by uid."""
    with db.tx() as conn:
        existing = {r["uid"]: r["id"] for r in conn.execute(
            "SELECT id, uid FROM events WHERE calendar_id=?", (calendar_id,)).fetchall()}
        seen = set()
        for r in rows:
            if r["uid"] in seen:
                continue
            seen.add(r["uid"])
            cols = [k for k in r if k != "uid"]
            if r["uid"] in existing:
                conn.execute(f"UPDATE events SET {','.join(c + '=?' for c in cols)} WHERE id=?",
                             [r[c] for c in cols] + [existing[r["uid"]]])
            else:
                conn.execute(
                    f"INSERT INTO events(calendar_id, uid, {','.join(cols)}) "
                    f"VALUES(?, ?, {','.join('?' * len(cols))})",
                    [calendar_id, r["uid"]] + [r[c] for c in cols])
        stale = [existing[u] for u in existing if u not in seen]
        for i in range(0, len(stale), 500):
            chunk = stale[i:i + 500]
            conn.execute(f"DELETE FROM events WHERE id IN ({','.join('?' * len(chunk))})", chunk)


# ---------------------------------------------------------------- ICS feeds

def _ics_time(value, default_tz) -> tuple[str, bool]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=default_tz)
        return fmt_utc(value), False
    if isinstance(value, date):
        return value.isoformat(), True
    raise ValueError("bad date")


def parse_ics(text: str) -> list[dict]:
    cal = icalendar.Calendar.from_ical(text)
    default_tz = get_zone(str(cal.get("X-WR-TIMEZONE", "UTC")))
    lo, hi = window()
    rows = []
    for comp in recurring_ical_events.of(cal, skip_bad_series=True).between(lo, hi):
        if comp.name != "VEVENT" or str(comp.get("STATUS", "")).upper() == "CANCELLED":
            continue
        dtstart = comp.get("DTSTART")
        if dtstart is None:
            continue
        try:
            start, all_day = _ics_time(dtstart.dt, default_tz)
            if comp.get("DTEND") is not None:
                end, _ = _ics_time(comp.get("DTEND").dt, default_tz)
            elif comp.get("DURATION") is not None:
                end, _ = _ics_time(dtstart.dt + comp.get("DURATION").dt, default_tz)
            else:
                end = (parse_date(start) + timedelta(days=1)).isoformat() if all_day else start
        except (ValueError, TypeError):
            continue
        if all_day and len(end) > 10:
            end = end[:10]
        if all_day and end <= start:
            end = (parse_date(start) + timedelta(days=1)).isoformat()
        if not all_day and end < start:
            end = start
        uid = f"{comp.get('UID', '')}|{start}"
        rows.append(_row(str(comp.get("SUMMARY", "")), start, end, all_day, uid,
                         description=str(comp.get("DESCRIPTION", "")),
                         location=str(comp.get("LOCATION", "")),
                         url=str(comp.get("URL")) if comp.get("URL") else None))
    return rows


async def sync_ics(cal: dict, client: httpx.AsyncClient) -> None:
    url = cal["url"].strip()
    if url.lower().startswith("webcal://"):
        url = "https://" + url[9:]
    resp = await client.get(url, follow_redirects=True, headers={"User-Agent": "SelfHostedCalendar/1.0"})
    if resp.status_code != 200:
        raise SyncError(f"Feed returned HTTP {resp.status_code}")
    rows = await asyncio.to_thread(parse_ics, resp.text)
    store_remote_events(cal["id"], rows)


# ---------------------------------------------------------------- OAuth

def auth_url(provider: str, state: str) -> str:
    if provider == "google":
        params = {"client_id": config.GOOGLE_CLIENT_ID, "redirect_uri": redirect_uri("google"),
                  "response_type": "code", "scope": GOOGLE_SCOPES, "access_type": "offline",
                  "prompt": "consent", "state": state}
        return f"{GOOGLE_AUTH}?{urlencode(params)}"
    params = {"client_id": config.MS_CLIENT_ID, "redirect_uri": redirect_uri("microsoft"),
              "response_type": "code", "scope": MS_SCOPES, "response_mode": "query",
              "prompt": "select_account", "state": state}
    return f"{MS_AUTH}?{urlencode(params)}"


def _token_request(provider: str) -> tuple[str, dict]:
    if provider == "google":
        return GOOGLE_TOKEN, {"client_id": config.GOOGLE_CLIENT_ID, "client_secret": config.GOOGLE_CLIENT_SECRET}
    return MS_TOKEN, {"client_id": config.MS_CLIENT_ID, "client_secret": config.MS_CLIENT_SECRET,
                      "scope": MS_SCOPES}


async def finish_oauth(provider: str, code: str) -> int:
    url, base = _token_request(provider)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, data={**base, "code": code, "grant_type": "authorization_code",
                                            "redirect_uri": redirect_uri(provider)})
        if resp.status_code != 200:
            raise SyncError(f"Token exchange failed: {resp.text[:300]}")
        tok = resp.json()
        headers = {"Authorization": f"Bearer {tok['access_token']}"}
        if provider == "google":
            info = (await client.get("https://openidconnect.googleapis.com/v1/userinfo", headers=headers)).json()
            email = info.get("email")
        else:
            info = (await client.get(f"{MS_API}/me", headers=headers)).json()
            email = info.get("mail") or info.get("userPrincipalName")

    existing = db.one("SELECT id, refresh_token FROM accounts WHERE provider=? AND email=?", (provider, email))
    expires = time.time() + int(tok.get("expires_in", 3600))
    if existing:
        db.execute("UPDATE accounts SET access_token=?, refresh_token=?, expires_at=? WHERE id=?",
                   (tok["access_token"], tok.get("refresh_token") or existing["refresh_token"], expires,
                    existing["id"]))
        account_id = existing["id"]
    else:
        account_id = db.execute(
            "INSERT INTO accounts(provider, email, access_token, refresh_token, expires_at) VALUES(?,?,?,?,?)",
            (provider, email, tok["access_token"], tok.get("refresh_token"), expires))
    await discover_calendars(account_id)
    return account_id


async def access_token(account: dict, client: httpx.AsyncClient) -> str:
    if account["access_token"] and account["expires_at"] > time.time() + 60:
        return account["access_token"]
    if not account["refresh_token"]:
        raise SyncError("Account needs to be reconnected")
    url, base = _token_request(account["provider"])
    resp = await client.post(url, data={**base, "grant_type": "refresh_token",
                                        "refresh_token": account["refresh_token"]})
    if resp.status_code != 200:
        raise SyncError("Could not refresh access - reconnect the account")
    tok = resp.json()
    account["access_token"] = tok["access_token"]
    account["expires_at"] = time.time() + int(tok.get("expires_in", 3600))
    if tok.get("refresh_token"):
        account["refresh_token"] = tok["refresh_token"]
    db.execute("UPDATE accounts SET access_token=?, refresh_token=?, expires_at=? WHERE id=?",
               (account["access_token"], account["refresh_token"], account["expires_at"], account["id"]))
    return account["access_token"]


async def api(account: dict, client: httpx.AsyncClient, method: str, url: str, **kwargs) -> dict:
    token = await access_token(account, client)
    headers = {"Authorization": f"Bearer {token}", **kwargs.pop("headers", {})}
    resp = await client.request(method, url, headers=headers, **kwargs)
    if resp.status_code == 401:
        account["expires_at"] = 0
        token = await access_token(account, client)
        headers["Authorization"] = f"Bearer {token}"
        resp = await client.request(method, url, headers=headers, **kwargs)
    if resp.status_code >= 400:
        raise SyncError(f"{account['provider']} API error {resp.status_code}: {resp.text[:300]}")
    return resp.json() if resp.content else {}


async def discover_calendars(account_id: int) -> None:
    account = db.one("SELECT * FROM accounts WHERE id=?", (account_id,))
    async with httpx.AsyncClient(timeout=30) as client:
        if account["provider"] == "google":
            data = await api(account, client, "GET", f"{GOOGLE_API}/users/me/calendarList")
            found = [(c["id"], c.get("summaryOverride") or c.get("summary", "Google"),
                      c.get("backgroundColor") or "#1a73e8",
                      c.get("accessRole") in ("reader", "freeBusyReader"),
                      c.get("selected", c.get("primary", False)))
                     for c in data.get("items", [])]
        else:
            data = await api(account, client, "GET", f"{MS_API}/me/calendars")
            found = [(c["id"], c.get("name", "Outlook"),
                      c.get("hexColor") or "#0078d4", not c.get("canEdit", True), True)
                     for c in data.get("value", [])]
    for remote_id, name, color, read_only, visible in found:
        row = db.one("SELECT id FROM calendars WHERE account_id=? AND remote_id=?", (account_id, remote_id))
        if row:
            db.execute("UPDATE calendars SET name=?, read_only=? WHERE id=?", (name, int(read_only), row["id"]))
        else:
            db.execute("INSERT INTO calendars(name, color, source, account_id, remote_id, read_only, visible) "
                       "VALUES(?,?,?,?,?,?,?)",
                       (name, color, account["provider"], account_id, remote_id, int(read_only), int(bool(visible))))


# ---------------------------------------------------------------- Google

def _google_time(t: dict) -> tuple[str, bool]:
    if "date" in t:
        return t["date"], True
    return fmt_utc(parse_dt(t["dateTime"])), False


async def sync_google(cal: dict, account: dict, client: httpx.AsyncClient) -> None:
    lo, hi = window()
    rows, page = [], None
    while True:
        params = {"singleEvents": "true", "timeMin": fmt_utc(lo), "timeMax": fmt_utc(hi),
                  "maxResults": 2500, "showDeleted": "false"}
        if page:
            params["pageToken"] = page
        data = await api(account, client, "GET",
                         f"{GOOGLE_API}/calendars/{quote(cal['remote_id'], safe='')}/events", params=params)
        for item in data.get("items", []):
            if item.get("status") == "cancelled" or "start" not in item:
                continue
            start, all_day = _google_time(item["start"])
            end, _ = _google_time(item.get("end", item["start"]))
            rem = item.get("reminders") or {}
            reminders = None if rem.get("useDefault", True) else [o["minutes"] for o in rem.get("overrides", [])]
            rows.append(_row(item.get("summary"), start, end, all_day, item["id"],
                             description=item.get("description", ""), location=item.get("location", ""),
                             url=item.get("htmlLink"), reminders=reminders,
                             tz=item["start"].get("timeZone") or "UTC"))
        page = data.get("nextPageToken")
        if not page:
            break
    store_remote_events(cal["id"], rows)


def _google_body(values: dict) -> dict:
    tz = values.get("tz") or "UTC"
    if values["all_day"]:
        start, end = {"date": values["start"]}, {"date": values["end"]}
    else:
        start = {"dateTime": values["start"], "timeZone": tz}
        end = {"dateTime": values["end"], "timeZone": tz}
    body = {"summary": values["title"], "description": values["description"],
            "location": values["location"], "start": start, "end": end}
    if values.get("rrule"):
        body["recurrence"] = [f"RRULE:{values['rrule']}"]
    if values.get("reminders") is not None:
        mins = json.loads(values["reminders"])
        body["reminders"] = {"useDefault": False, "overrides": [{"method": "popup", "minutes": m} for m in mins[:5]]}
    return body


# ---------------------------------------------------------------- Microsoft

def _ms_time(t: dict) -> str:
    return fmt_utc(parse_dt(t["dateTime"][:26]))


async def sync_microsoft(cal: dict, account: dict, client: httpx.AsyncClient) -> None:
    lo, hi = window()
    url = (f"{MS_API}/me/calendars/{cal['remote_id']}/calendarView?"
           + urlencode({"startDateTime": fmt_utc(lo), "endDateTime": fmt_utc(hi), "$top": 500}))
    rows = []
    while url:
        data = await api(account, client, "GET", url, headers={"Prefer": 'outlook.timezone="UTC"'})
        for item in data.get("value", []):
            if item.get("isCancelled"):
                continue
            all_day = item.get("isAllDay", False)
            if all_day:
                start, end = item["start"]["dateTime"][:10], item["end"]["dateTime"][:10]
            else:
                start, end = _ms_time(item["start"]), _ms_time(item["end"])
            reminders = [item.get("reminderMinutesBeforeStart", 15)] if item.get("isReminderOn") else []
            rows.append(_row(item.get("subject"), start, end, all_day, item["id"],
                             description=item.get("bodyPreview", ""),
                             location=(item.get("location") or {}).get("displayName", ""),
                             url=item.get("webLink"), reminders=reminders))
        url = data.get("@odata.nextLink")
    store_remote_events(cal["id"], rows)


MS_DAYS = {"MO": "monday", "TU": "tuesday", "WE": "wednesday", "TH": "thursday",
           "FR": "friday", "SA": "saturday", "SU": "sunday"}


def _ms_recurrence(values: dict) -> dict | None:
    if not values.get("rrule"):
        return None
    parts = dict(p.split("=", 1) for p in values["rrule"].split(";") if "=" in p)
    freq = parts.get("FREQ", "WEEKLY")
    if values["all_day"]:
        d = parse_date(values["start"])
    else:
        d = parse_dt(values["start"]).astimezone(get_zone(values.get("tz"))).date()
    start_day = d.isoformat()
    pattern = {"interval": int(parts.get("INTERVAL", 1))}
    if freq == "DAILY":
        pattern["type"] = "daily"
    elif freq == "WEEKLY":
        pattern["type"] = "weekly"
        days = parts.get("BYDAY", "").split(",") if parts.get("BYDAY") else [list(MS_DAYS)[d.weekday()]]
        pattern["daysOfWeek"] = [MS_DAYS[x[-2:]] for x in days if x[-2:] in MS_DAYS]
    elif freq == "MONTHLY":
        pattern.update(type="absoluteMonthly", dayOfMonth=d.day)
    else:
        pattern.update(type="absoluteYearly", dayOfMonth=d.day, month=d.month)
    rng = {"startDate": start_day, "type": "noEnd"}
    if "COUNT" in parts:
        rng.update(type="numbered", numberOfOccurrences=int(parts["COUNT"]))
    elif "UNTIL" in parts:
        u = parts["UNTIL"]
        rng.update(type="endDate", endDate=f"{u[:4]}-{u[4:6]}-{u[6:8]}")
    return {"pattern": pattern, "range": rng}


def _ms_body(values: dict) -> dict:
    if values["all_day"]:
        tz = values.get("tz") or "UTC"
        start = {"dateTime": f"{values['start']}T00:00:00", "timeZone": tz}
        end = {"dateTime": f"{values['end']}T00:00:00", "timeZone": tz}
    else:
        start = {"dateTime": values["start"].rstrip("Z"), "timeZone": "UTC"}
        end = {"dateTime": values["end"].rstrip("Z"), "timeZone": "UTC"}
    body = {"subject": values["title"], "body": {"contentType": "text", "content": values["description"]},
            "location": {"displayName": values["location"]}, "start": start, "end": end,
            "isAllDay": bool(values["all_day"])}
    if values.get("reminders") is not None:
        mins = json.loads(values["reminders"])
        body["isReminderOn"] = bool(mins)
        if mins:
            body["reminderMinutesBeforeStart"] = mins[0]
    rec = _ms_recurrence(values)
    if rec:
        body["recurrence"] = rec
    return body


# ---------------------------------------------------------------- write-back

async def push_change(cal: dict, action: str, values: dict | None = None, uid: str | None = None) -> str | None:
    """Mirror a local change to Google / Microsoft. Returns the remote id on create."""
    account = db.one("SELECT * FROM accounts WHERE id=?", (cal["account_id"],))
    if not account:
        raise SyncError("Account not found")
    async with httpx.AsyncClient(timeout=30) as client:
        if cal["source"] == "google":
            base = f"{GOOGLE_API}/calendars/{quote(cal['remote_id'], safe='')}/events"
            if action == "create":
                return (await api(account, client, "POST", base, json=_google_body(values)))["id"]
            if action == "update":
                body = _google_body(values)
                body.pop("recurrence", None)  # instance edits can't change recurrence
                await api(account, client, "PATCH", f"{base}/{quote(uid, safe='')}", json=body)
            elif action == "delete":
                await api(account, client, "DELETE", f"{base}/{quote(uid, safe='')}")
        else:
            if action == "create":
                url = f"{MS_API}/me/calendars/{cal['remote_id']}/events"
                return (await api(account, client, "POST", url, json=_ms_body(values)))["id"]
            if action == "update":
                body = _ms_body(values)
                body.pop("recurrence", None)
                await api(account, client, "PATCH", f"{MS_API}/me/events/{uid}", json=body)
            elif action == "delete":
                await api(account, client, "DELETE", f"{MS_API}/me/events/{uid}")
    return None


# ---------------------------------------------------------------- orchestration

async def sync_calendar(cal_id: int) -> None:
    cal = db.one("SELECT * FROM calendars WHERE id=?", (cal_id,))
    if not cal or cal["source"] == "local":
        return
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            if cal["source"] == "ics":
                await sync_ics(cal, client)
            else:
                account = db.one("SELECT * FROM accounts WHERE id=?", (cal["account_id"],))
                if not account:
                    raise SyncError("Account not found")
                if cal["source"] == "google":
                    await sync_google(cal, account, client)
                else:
                    await sync_microsoft(cal, account, client)
        db.execute("UPDATE calendars SET last_synced=?, sync_error=NULL WHERE id=?", (time.time(), cal_id))
    except Exception as exc:  # keep syncing other calendars
        log.warning("Sync failed for calendar %s: %s", cal_id, exc)
        db.execute("UPDATE calendars SET sync_error=? WHERE id=?", (str(exc)[:500], cal_id))


async def sync_all() -> None:
    async with _sync_lock:
        for acc in db.query("SELECT id FROM accounts"):
            try:
                await discover_calendars(acc["id"])
            except Exception as exc:
                log.warning("Calendar discovery failed for account %s: %s", acc["id"], exc)
        cals = db.query("SELECT id FROM calendars WHERE source != 'local'")
        await asyncio.gather(*(sync_calendar(c["id"]) for c in cals))


async def sync_loop() -> None:
    while True:
        try:
            await sync_all()
        except Exception:
            log.exception("Sync loop error")
        await asyncio.sleep(config.SYNC_INTERVAL_MINUTES * 60)

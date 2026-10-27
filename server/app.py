"""Self-hosted calendar - HTTP API and static PWA."""
import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from icalendar import Calendar as ICal, Event as IEvent, vRecur
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner

from . import config, db, push, sync
from .events import (UTC, add_exdate, clean_payload, expand_event, fmt_utc, get_zone, insert_event,
                     list_occurrences, parse_date, parse_dt, remaining_rrule, shift_exdates,
                     truncate_series, update_event)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("calendar")

STATIC = config.ROOT / "static"
COOKIE = "cal_session"
SESSION_AGE = 180 * 86400


# ---------------------------------------------------------------- setup

def _secret() -> str:
    key = db.get_setting("secret_key")
    if not key:
        key = secrets.token_urlsafe(48)
        db.set_setting("secret_key", key)
    return key


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1)
    return f"{salt.hex()}:{digest.hex()}"


def _check_password(password: str) -> bool:
    if config.PASSWORD:
        return hmac.compare_digest(password, config.PASSWORD)
    stored = db.get_setting("password_hash")
    if not stored:
        return False
    salt, _ = stored.split(":")
    return hmac.compare_digest(_hash_password(password, bytes.fromhex(salt)), stored)


def _setup_required() -> bool:
    return not config.PASSWORD and not db.get_setting("password_hash")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.connect()
    _secret()
    push.vapid_keys()
    if not db.get_setting("ics_token"):
        db.set_setting("ics_token", secrets.token_urlsafe(24))
    if not db.one("SELECT id FROM calendars WHERE source='local'"):
        db.execute("INSERT INTO calendars(name, color, source) VALUES('Personal', '#1a73e8', 'local')")
    tasks = [asyncio.create_task(sync.sync_loop()), asyncio.create_task(push.reminder_loop())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Calendar", lifespan=lifespan, docs_url=None, redoc_url=None)


# ---------------------------------------------------------------- auth

def _signer() -> TimestampSigner:
    return TimestampSigner(_secret())


def is_authed(request: Request) -> bool:
    token = request.cookies.get(COOKIE)
    if not token:
        return False
    try:
        _signer().unsign(token, max_age=SESSION_AGE)
        return True
    except (BadSignature, SignatureExpired):
        return False


PUBLIC_API = {"/api/me", "/api/login", "/api/setup"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path not in PUBLIC_API and not is_authed(request):
        return JSONResponse({"detail": "Not signed in"}, status_code=401)
    response = await call_next(request)
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    elif "cache-control" not in response.headers:
        # App files: always check with the server (cheap 304s) so updates reach phones right away.
        response.headers["Cache-Control"] = "no-cache"
    if request.url.scheme == "https":
        # Behind an HTTPS proxy, have the browser upgrade any stray http:// request instead of
        # flagging the page as "not secure". Only sent over HTTPS so plain-http LAN access keeps working.
        response.headers["Content-Security-Policy"] = "upgrade-insecure-requests"
    return response


def _login_response(request: Request) -> JSONResponse:
    resp = JSONResponse({"ok": True})
    # Mark the cookie secure only when this request really came over HTTPS (directly or via a
    # proxy's X-Forwarded-Proto); otherwise browsers drop it and sign-in silently fails.
    resp.set_cookie(COOKIE, _signer().sign("user").decode(), max_age=SESSION_AGE, httponly=True,
                    samesite="lax", secure=request.url.scheme == "https")
    return resp


@app.get("/api/me")
async def me(request: Request):
    authed = is_authed(request)
    data = {"authenticated": authed, "setup_required": _setup_required()}
    if authed:
        data.update(
            providers={"google": sync.provider_enabled("google"), "microsoft": sync.provider_enabled("microsoft")},
            base_url=config.BASE_URL,
            ics_url=f"{config.BASE_URL}/ics/{db.get_setting('ics_token')}.ics",
            vapid_public_key=push.vapid_keys()["public"],
            timezone=db.get_setting("timezone", "UTC"),
            redirect_uris={"google": sync.redirect_uri("google"), "microsoft": sync.redirect_uri("microsoft")},
        )
    return data


@app.post("/api/setup")
async def setup(request: Request):
    if not _setup_required():
        raise HTTPException(400, "Already set up")
    body = await request.json()
    password = body.get("password", "")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    db.set_setting("password_hash", _hash_password(password))
    return _login_response(request)


@app.post("/api/login")
async def login(request: Request):
    body = await request.json()
    if not _check_password(body.get("password", "")):
        await asyncio.sleep(1)
        raise HTTPException(401, "Wrong password")
    return _login_response(request)


@app.post("/api/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE)
    return resp


@app.post("/api/password")
async def change_password(request: Request):
    body = await request.json()
    if config.PASSWORD:
        raise HTTPException(400, "Password is set by the CAL_PASSWORD environment variable")
    if not _check_password(body.get("current", "")):
        raise HTTPException(401, "Current password is wrong")
    if len(body.get("new", "")) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    db.set_setting("password_hash", _hash_password(body["new"]))
    return {"ok": True}


@app.post("/api/settings")
async def save_settings(request: Request):
    body = await request.json()
    if "timezone" in body:
        db.set_setting("timezone", str(body["timezone"])[:64])
    return {"ok": True}


# ---------------------------------------------------------------- calendars

def _calendar_out(c: dict, accounts: dict) -> dict:
    acc = accounts.get(c["account_id"])
    return {
        "id": c["id"], "name": c["name"], "color": c["color"], "source": c["source"],
        "url": c["url"], "visible": bool(c["visible"]), "read_only": bool(c["read_only"]),
        "default_reminders": json.loads(c["default_reminders"]),
        "last_synced": c["last_synced"], "sync_error": c["sync_error"],
        "account_id": c["account_id"], "account_email": acc["email"] if acc else None,
    }


@app.get("/api/calendars")
async def get_calendars():
    accounts = {a["id"]: a for a in db.query("SELECT id, provider, email FROM accounts")}
    cals = db.query("SELECT * FROM calendars ORDER BY CASE source WHEN 'local' THEN 0 ELSE 1 END, id")
    return {
        "calendars": [_calendar_out(c, accounts) for c in cals],
        "accounts": list(accounts.values()),
    }


@app.post("/api/calendars")
async def create_calendar(request: Request):
    body = await request.json()
    name = (body.get("name") or "").strip()[:100] or "Calendar"
    color = body.get("color") or "#1a73e8"
    if body.get("type") == "ics":
        url = (body.get("url") or "").strip()
        if not url.lower().startswith(("http://", "https://", "webcal://")):
            raise HTTPException(400, "Enter a valid calendar feed URL")
        cid = db.execute("INSERT INTO calendars(name, color, source, url, read_only) VALUES(?,?,?,?,1)",
                         (name, color, "ics", url))
        await sync.sync_calendar(cid)
    else:
        cid = db.execute("INSERT INTO calendars(name, color, source) VALUES(?,?,'local')", (name, color))
    return {"id": cid}


@app.patch("/api/calendars/{cal_id}")
async def edit_calendar(cal_id: int, request: Request):
    body = await request.json()
    cal = db.one("SELECT * FROM calendars WHERE id=?", (cal_id,))
    if not cal:
        raise HTTPException(404)
    fields = {}
    if "name" in body:
        fields["name"] = str(body["name"]).strip()[:100] or cal["name"]
    if "color" in body:
        fields["color"] = str(body["color"])[:20]
    if "visible" in body:
        fields["visible"] = 1 if body["visible"] else 0
    if "default_reminders" in body:
        fields["default_reminders"] = json.dumps(sorted({int(m) for m in body["default_reminders"]}))
    if "url" in body and cal["source"] == "ics":
        fields["url"] = str(body["url"]).strip()
    if fields:
        db.execute(f"UPDATE calendars SET {','.join(k + '=?' for k in fields)} WHERE id=?",
                   list(fields.values()) + [cal_id])
    return {"ok": True}


@app.delete("/api/calendars/{cal_id}")
async def delete_calendar(cal_id: int):
    cal = db.one("SELECT * FROM calendars WHERE id=?", (cal_id,))
    if not cal:
        raise HTTPException(404)
    if cal["source"] in ("google", "microsoft"):
        raise HTTPException(400, "Hide this calendar or disconnect the account instead")
    if cal["source"] == "local" and db.one("SELECT COUNT(*) n FROM calendars WHERE source='local'")["n"] <= 1:
        raise HTTPException(400, "You need at least one local calendar")
    db.execute("DELETE FROM calendars WHERE id=?", (cal_id,))
    return {"ok": True}


@app.post("/api/calendars/{cal_id}/sync")
async def sync_one(cal_id: int):
    await sync.sync_calendar(cal_id)
    return {"ok": True}


@app.post("/api/sync")
async def sync_everything():
    await sync.sync_all()
    return {"ok": True}


@app.delete("/api/accounts/{account_id}")
async def disconnect_account(account_id: int):
    db.execute("DELETE FROM calendars WHERE account_id=?", (account_id,))
    db.execute("DELETE FROM accounts WHERE id=?", (account_id,))
    return {"ok": True}


# ---------------------------------------------------------------- OAuth

@app.get("/api/oauth/{provider}/start")
async def oauth_start(provider: str):
    if provider not in ("google", "microsoft") or not sync.provider_enabled(provider):
        raise HTTPException(400, f"{provider} is not configured on this server")
    state = secrets.token_urlsafe(24)
    resp = RedirectResponse(sync.auth_url(provider, state))
    resp.set_cookie("oauth_state", state, max_age=600, httponly=True, samesite="lax")
    return resp


@app.get("/api/oauth/{provider}/callback")
async def oauth_callback(provider: str, request: Request):
    params = request.query_params
    if params.get("error"):
        return RedirectResponse(f"/?connect_error={params.get('error')}")
    if not params.get("state") or params.get("state") != request.cookies.get("oauth_state"):
        return RedirectResponse("/?connect_error=state_mismatch")
    try:
        account_id = await sync.finish_oauth(provider, params["code"])
        for cal in db.query("SELECT id FROM calendars WHERE account_id=?", (account_id,)):
            await sync.sync_calendar(cal["id"])
    except Exception as exc:
        log.warning("OAuth failed: %s", exc)
        return RedirectResponse("/?connect_error=token")
    resp = RedirectResponse("/?connected=" + provider)
    resp.delete_cookie("oauth_state")
    return resp


# ---------------------------------------------------------------- events

def _range(request: Request) -> tuple[datetime, datetime]:
    try:
        start = parse_dt(request.query_params["start"])
        end = parse_dt(request.query_params["end"])
    except (KeyError, ValueError):
        raise HTTPException(400, "start and end are required ISO datetimes")
    if end - start > timedelta(days=400):
        raise HTTPException(400, "Range too large")
    return start, end


@app.get("/api/events")
async def get_events(request: Request):
    start, end = _range(request)
    return {"events": list_occurrences(start, end)}


@app.get("/api/search")
async def search(q: str = ""):
    q = q.strip()
    if not q:
        return {"events": []}
    like = f"%{q}%"
    rows = db.query(
        "SELECT * FROM events WHERE title LIKE ? OR location LIKE ? OR description LIKE ? "
        "ORDER BY start DESC LIMIT 200", (like, like, like))
    cals = {c["id"]: c for c in db.query("SELECT * FROM calendars")}
    now = datetime.now(UTC)
    out = []
    for ev in rows:
        cal = cals.get(ev["calendar_id"])
        if not cal:
            continue
        if ev["rrule"]:
            occ = expand_event(ev, cal, now, now + timedelta(days=366))
            out.extend(occ[:1] or expand_event({**ev, "rrule": None}, cal, now, now))
        else:
            out.extend(expand_event(ev, cal, now, now))
    out.sort(key=lambda o: o["start"])
    return {"events": out}


def _writable(cal_id) -> dict:
    cal = db.one("SELECT * FROM calendars WHERE id=?", (int(cal_id),))
    if not cal:
        raise HTTPException(404, "Calendar not found")
    if cal["read_only"] or cal["source"] == "ics":
        raise HTTPException(403, "This calendar is read-only")
    return cal


async def _create_in(cal: dict, values: dict) -> None:
    if cal["source"] in ("google", "microsoft"):
        remote_id = await sync.push_change(cal, "create", values)
        if values.get("rrule"):
            await sync.sync_calendar(cal["id"])  # pull the expanded instances
        else:
            insert_event(values, uid=remote_id)
    else:
        insert_event(values, uid=str(uuid.uuid4()))


async def _delete_row(cal: dict, ev: dict) -> None:
    if cal["source"] in ("google", "microsoft"):
        await sync.push_change(cal, "delete", uid=ev["uid"])
    db.execute("DELETE FROM events WHERE id=?", (ev["id"],))


@app.post("/api/events")
async def create_event(request: Request):
    body = await request.json()
    cal = _writable(body.get("calendar_id"))
    try:
        values = clean_payload(body)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))
    try:
        await _create_in(cal, values)
    except sync.SyncError as exc:
        raise HTTPException(502, str(exc))
    return {"ok": True}


def _shift(value: str, all_day: bool, delta: timedelta) -> str:
    if all_day:
        return (parse_date(value) + timedelta(days=delta.days)).isoformat()
    return fmt_utc(parse_dt(value) + delta)


@app.patch("/api/events/{event_id}")
async def edit_event(event_id: int, request: Request):
    body = await request.json()
    ev = db.one("SELECT * FROM events WHERE id=?", (event_id,))
    if not ev:
        raise HTTPException(404)
    old_cal = _writable(ev["calendar_id"])
    new_cal = _writable(body.get("calendar_id", ev["calendar_id"]))
    scope = body.get("scope", "all")
    occ_start = body.get("occurrence_start")
    recurring = bool(ev["rrule"]) and occ_start

    try:
        if recurring and scope == "this":
            values = clean_payload({**body, "rrule": None}, ev)
            add_exdate(event_id, occ_start)
            await _create_in(new_cal, values)
        elif recurring and scope == "following" and occ_start != ev["start"]:
            values = clean_payload(body, ev)
            values["rrule"] = remaining_rrule(ev, occ_start, values["rrule"])
            truncate_series(ev, occ_start)
            await _create_in(new_cal, values)
        else:
            if recurring:
                # Editing the whole series from one occurrence: move the series by the same offset.
                all_day = bool(body.get("all_day", ev["all_day"]))
                if all_day == bool(ev["all_day"]):
                    if all_day:
                        delta = parse_date(body.get("start", occ_start)) - parse_date(occ_start)
                        dur = parse_date(body.get("end", ev["end"])) - parse_date(body.get("start", occ_start))
                    else:
                        delta = parse_dt(body.get("start", occ_start)) - parse_dt(occ_start)
                        dur = parse_dt(body.get("end", ev["end"])) - parse_dt(body.get("start", occ_start))
                    new_start = _shift(ev["start"], all_day, delta)
                    body = {**body, "start": new_start, "end": _shift(new_start, all_day, dur)}
                    if delta:
                        db.execute("UPDATE events SET exdates=? WHERE id=?", (shift_exdates(ev, delta), event_id))
            values = clean_payload(body, ev)
            moving_remote = new_cal["id"] != old_cal["id"] and (
                old_cal["source"] != "local" or new_cal["source"] != "local")
            if moving_remote:
                await _create_in(new_cal, values)
                await _delete_row(old_cal, ev)
            else:
                if old_cal["source"] in ("google", "microsoft"):
                    await sync.push_change(old_cal, "update", values, uid=ev["uid"])
                update_event(event_id, values)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))
    except sync.SyncError as exc:
        raise HTTPException(502, str(exc))
    return {"ok": True}


@app.delete("/api/events/{event_id}")
async def delete_event(event_id: int, scope: str = "all", occurrence: str | None = None):
    ev = db.one("SELECT * FROM events WHERE id=?", (event_id,))
    if not ev:
        raise HTTPException(404)
    cal = _writable(ev["calendar_id"])
    try:
        if ev["rrule"] and occurrence and scope == "this":
            add_exdate(event_id, occurrence)
        elif ev["rrule"] and occurrence and scope == "following" and occurrence != ev["start"]:
            truncate_series(ev, occurrence)
        else:
            await _delete_row(cal, ev)
    except sync.SyncError as exc:
        raise HTTPException(502, str(exc))
    return {"ok": True}


# ---------------------------------------------------------------- push

@app.post("/api/push/subscribe")
async def push_subscribe(request: Request):
    body = await request.json()
    keys = body.get("keys") or {}
    if not body.get("endpoint") or not keys.get("p256dh") or not keys.get("auth"):
        raise HTTPException(400, "Invalid subscription")
    db.execute(
        "INSERT INTO push_subscriptions(endpoint, p256dh, auth, user_agent, created_at) VALUES(?,?,?,?,?) "
        "ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth",
        (body["endpoint"], keys["p256dh"], keys["auth"], request.headers.get("user-agent", "")[:300], time.time()))
    return {"ok": True}


@app.post("/api/push/unsubscribe")
async def push_unsubscribe(request: Request):
    body = await request.json()
    db.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (body.get("endpoint", ""),))
    return {"ok": True}


@app.post("/api/push/test")
async def push_test():
    sent = await asyncio.to_thread(push.send_to_all, {
        "title": "Notifications are working", "body": "You'll get event reminders here.", "url": "/"})
    return {"sent": sent}


# ---------------------------------------------------------------- ICS export (subscribe from other apps)

@app.get("/ics/{token}.ics")
async def ics_export(token: str):
    if not hmac.compare_digest(token, db.get_setting("ics_token", "")):
        raise HTTPException(404)
    cal = ICal()
    cal.add("prodid", "-//Self-hosted Calendar//EN")
    cal.add("version", "2.0")
    cal.add("X-WR-CALNAME", "My Calendar")
    rows = db.query("SELECT e.* FROM events e JOIN calendars c ON c.id=e.calendar_id WHERE c.source='local'")
    for ev in rows:
        ie = IEvent()
        ie.add("uid", f"{ev['uid'] or ev['id']}@selfhosted-calendar")
        ie.add("summary", ev["title"])
        if ev["description"]:
            ie.add("description", ev["description"])
        if ev["location"]:
            ie.add("location", ev["location"])
        if ev["all_day"]:
            ie.add("dtstart", parse_date(ev["start"]))
            ie.add("dtend", parse_date(ev["end"]))
        elif ev["rrule"] and ev["tz"] and ev["tz"] != "UTC":
            # Recurring events keep their wall-clock time across DST, so export them in their zone.
            zone = get_zone(ev["tz"])
            ie.add("dtstart", parse_dt(ev["start"]).astimezone(zone))
            ie.add("dtend", parse_dt(ev["end"]).astimezone(zone))
        else:
            ie.add("dtstart", parse_dt(ev["start"]))
            ie.add("dtend", parse_dt(ev["end"]))
        if ev["rrule"]:
            ie.add("rrule", vRecur.from_ical(ev["rrule"]))
            for ex in json.loads(ev["exdates"] or "[]"):
                ie.add("exdate", parse_date(ex) if ev["all_day"] else parse_dt(ex).astimezone(get_zone(ev["tz"])))
        ie.add("dtstamp", datetime.fromtimestamp(ev["updated_at"] or time.time(), UTC))
        cal.add_component(ie)
    cal.add_missing_timezones()
    return Response(cal.to_ical(), media_type="text/calendar; charset=utf-8")


# ---------------------------------------------------------------- static PWA

@app.get("/sw.js")
async def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(STATIC / "icons" / "icon-192.png", media_type="image/png")


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")


def main():
    import uvicorn
    uvicorn.run(app, host=config.HOST, port=config.PORT, proxy_headers=True, forwarded_allow_ips="*")


if __name__ == "__main__":
    main()

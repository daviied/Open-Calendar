"""Assignments (tasks with due dates) and Trello-style boards."""
import json
import re
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request

from . import db
from .events import UTC, fmt_utc, list_occurrences, parse_date, parse_dt

router = APIRouter()

TASK_COLOR = "#8e24aa"
DEFAULT_LISTS = ["To do", "Doing", "Done"]
CANVAS_COURSE = re.compile(r"^(.*?)\s*\[([^\]]+)\]\s*$")


# ---------------------------------------------------------------- helpers

def clean_due(value, all_day) -> tuple[str | None, int]:
    """Normalize a due value: UTC timestamp for a timed due, plain date when all-day."""
    if not value:
        return None, 0
    try:
        if all_day:
            return parse_date(str(value)).isoformat(), 1
        return fmt_utc(parse_dt(str(value))), 0
    except ValueError:
        raise HTTPException(400, "Invalid due date")


def due_range(due: str, all_day: int) -> tuple[str, str]:
    """Calendar placement for a due date: a 30-minute block ending at the deadline, or the whole day."""
    if all_day:
        return due, (parse_date(due) + timedelta(days=1)).isoformat()
    end = parse_dt(due)
    return fmt_utc(end - timedelta(minutes=30)), due


def _range_rows(table: str, range_start: datetime, range_end: datetime, extra: str = "") -> list[dict]:
    rs, re_ = fmt_utc(range_start - timedelta(hours=1)), fmt_utc(range_end + timedelta(hours=1))
    rs_d = (range_start - timedelta(days=1)).date().isoformat()
    re_d = (range_end + timedelta(days=1)).date().isoformat()
    return db.query(
        f"SELECT * FROM {table} WHERE due IS NOT NULL AND ("
        "(all_day=0 AND due >= ? AND due <= ?) OR (all_day=1 AND due >= ? AND due <= ?))" + extra,
        (rs, re_, rs_d, re_d))


def task_out(t: dict, cal_names: dict | None = None) -> dict:
    return {
        "id": t["id"], "title": t["title"], "notes": t["notes"], "course": t["course"],
        "color": t["color"] or TASK_COLOR, "due": t["due"], "all_day": bool(t["all_day"]),
        "done": bool(t["done"]), "done_at": t["done_at"], "reminders": json.loads(t["reminders"] or "[]"),
        "url": t["url"], "imported": t["source_calendar_id"] is not None,
        "source_name": (cal_names or {}).get(t["source_calendar_id"]),
    }


def card_out(c: dict) -> dict:
    return {
        "id": c["id"], "list_id": c["list_id"], "title": c["title"], "description": c["description"],
        "label": c["label"], "due": c["due"], "all_day": bool(c["all_day"]), "done": bool(c["done"]),
        "position": c["position"],
    }


# ---------------------------------------------------------------- feed calendars imported as assignments

def split_course(title: str, fallback: str) -> tuple[str, str]:
    """Canvas titles look like "Lab report [CHEM-110-01]": pull the course out of the brackets."""
    m = CANVAS_COURSE.match(title or "")
    if m and m.group(1):
        return m.group(1), m.group(2)
    return title or "(No title)", fallback


def import_calendar_tasks(cal_id: int) -> int:
    """Create/update one assignment per event of a calendar set to "create as assignments".

    Title, due date, course and link follow the feed; check marks, notes, reminders and colour
    are the user's and are kept. Items due before the import was switched on start out completed.
    """
    cal = db.one("SELECT * FROM calendars WHERE id=?", (cal_id,))
    if not cal or cal["assignments"] != 2:
        return 0
    since = db.get_setting(f"import_since:{cal_id}", time.time())
    now = time.time()
    existing = {t["source_key"]: t for t in db.query("SELECT * FROM tasks WHERE source_calendar_id=?", (cal_id,))}
    seen = set()
    reminders = cal["default_reminders"]
    with db.tx() as conn:
        for ev in conn.execute("SELECT * FROM events WHERE calendar_id=?", (cal_id,)).fetchall():
            key = ev["uid"] or str(ev["id"])
            if key in seen:
                continue
            seen.add(key)
            title, course = split_course(ev["title"], cal["name"])
            due, all_day = ev["start"], ev["all_day"]
            if key in existing:
                conn.execute("UPDATE tasks SET title=?, course=?, due=?, all_day=?, url=?, updated_at=? WHERE id=?",
                             (title, course, due, all_day, ev["url"], now, existing[key]["id"]))
                continue
            due_ts = (datetime.fromisoformat(due + "T23:59:59+00:00") if all_day else parse_dt(due)).timestamp()
            past = due_ts < since
            conn.execute(
                "INSERT INTO tasks(title, notes, course, color, due, all_day, done, done_at, reminders, created_at, updated_at,"
                " source_calendar_id, source_key, url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (title, ev["description"] or "", course, cal["color"], due, all_day, 1 if past else 0, now if past else None,
                 reminders, now, now, cal_id, key, ev["url"]))
        # Gone from the feed: drop it unless it was checked off (keeps your history of finished work).
        for key, t in existing.items():
            if key not in seen and not t["done"]:
                conn.execute("DELETE FROM tasks WHERE id=?", (t["id"],))
    return len(seen)


def set_import_mode(cal_id: int, old_mode: int, new_mode: int) -> None:
    if new_mode == 2 and old_mode != 2:
        db.set_setting(f"import_since:{cal_id}", time.time())
        import_calendar_tasks(cal_id)
    elif old_mode == 2 and new_mode != 2:
        db.execute("DELETE FROM tasks WHERE source_calendar_id=?", (cal_id,))
        db.execute("DELETE FROM settings WHERE key=?", (f"import_since:{cal_id}",))


# ---------------------------------------------------------------- calendar integration

def calendar_items(range_start: datetime, range_end: datetime) -> list[dict]:
    """Tasks and board cards with due dates, shaped like calendar occurrences."""
    out = []
    for t in _range_rows("tasks", range_start, range_end):
        start, end = due_range(t["due"], t["all_day"])
        reminders = json.loads(t["reminders"] or "[]")
        out.append({
            "id": f"task:{t['id']}", "kind": "task", "task_id": t["id"], "event_id": None, "calendar_id": None,
            "title": t["title"], "description": t["notes"], "location": "", "course": t["course"],
            "start": start, "end": end, "due": t["due"], "all_day": bool(t["all_day"]), "recurring": False,
            "rrule": None, "reminders": reminders, "effective_reminders": [] if t["done"] else reminders,
            "color": t["color"] or TASK_COLOR, "url": t["url"], "read_only": False, "done": bool(t["done"]),
            "imported": t["source_calendar_id"] is not None,
        })
    boards = {b["id"]: b for b in db.query("SELECT * FROM boards")}
    lists = {l["id"]: l for l in db.query("SELECT * FROM board_lists")}
    for c in _range_rows("cards", range_start, range_end):
        lst = lists.get(c["list_id"])
        board = boards.get(lst["board_id"]) if lst else None
        if not board:
            continue
        start, end = due_range(c["due"], c["all_day"])
        out.append({
            "id": f"card:{c['id']}", "kind": "card", "card_id": c["id"], "board_id": board["id"],
            "board_name": board["name"], "list_name": lst["name"], "event_id": None, "calendar_id": None,
            "title": c["title"], "description": c["description"], "location": "", "start": start, "end": end,
            "due": c["due"], "all_day": bool(c["all_day"]), "recurring": False, "rrule": None,
            "reminders": [], "effective_reminders": [], "color": c["label"] or board["color"], "url": None,
            "read_only": False, "done": bool(c["done"]),
        })
    return out


# ---------------------------------------------------------------- assignments

@router.get("/api/assignments")
async def get_assignments():
    cal_names = {c["id"]: c["name"] for c in db.query("SELECT id, name FROM calendars")}
    tasks = [task_out(t, cal_names) for t in db.query(
        "SELECT * FROM tasks WHERE done=0 OR done_at > ? ORDER BY due IS NULL, due", (time.time() - 60 * 86400,))]
    now = datetime.now(UTC)
    feed = []
    cal_ids = {c["id"] for c in db.query("SELECT id FROM calendars WHERE assignments=1")}
    if cal_ids:
        for occ in list_occurrences(now - timedelta(days=60), now + timedelta(days=200), visible_only=False):
            if occ["calendar_id"] not in cal_ids:
                continue
            title, course = occ["title"], occ.get("calendar_name", "")
            m = CANVAS_COURSE.match(title)
            if m:
                title, course = m.group(1) or title, m.group(2)
            feed.append({
                "kind": "event", "id": occ["id"], "event_id": occ["event_id"], "calendar_id": occ["calendar_id"],
                "done_key": occ["done_key"], "title": title, "notes": occ["description"], "course": course,
                "color": occ["color"], "due": occ["start"], "all_day": occ["all_day"], "done": occ["done"],
                "url": occ["url"],
            })
    return {"tasks": tasks, "feed": feed}


def _task_values(body: dict, existing: dict | None = None) -> dict:
    merged = {**(existing or {}), **body}
    due, all_day = clean_due(merged.get("due"), merged.get("all_day"))
    reminders = merged.get("reminders") or []
    if isinstance(reminders, str):
        reminders = json.loads(reminders)
    done = 1 if merged.get("done") else 0
    return {
        "title": (merged.get("title") or "").strip()[:500] or "(No title)",
        "notes": (merged.get("notes") or "")[:20000],
        "course": (merged.get("course") or "").strip()[:100],
        "color": merged.get("color") or None,
        "due": due, "all_day": all_day, "done": done,
        "done_at": (existing or {}).get("done_at") if done and (existing or {}).get("done") else (time.time() if done else None),
        "reminders": json.dumps(sorted({int(m) for m in reminders if int(m) >= 0})),
        "updated_at": time.time(),
    }


@router.post("/api/tasks")
async def create_task(request: Request):
    values = _task_values(await request.json())
    values["created_at"] = time.time()
    tid = db.execute(f"INSERT INTO tasks({','.join(values)}) VALUES({','.join('?' * len(values))})",
                     list(values.values()))
    return {"id": tid}


@router.patch("/api/tasks/{task_id}")
async def edit_task(task_id: int, request: Request):
    existing = db.one("SELECT * FROM tasks WHERE id=?", (task_id,))
    if not existing:
        raise HTTPException(404)
    body = await request.json()
    if existing["source_calendar_id"] is not None:
        # Title, due date and course come from the feed and would be overwritten on the next sync.
        for k in ("title", "due", "all_day", "course"):
            body.pop(k, None)
    values = _task_values(body, existing)
    db.execute(f"UPDATE tasks SET {','.join(k + '=?' for k in values)} WHERE id=?", list(values.values()) + [task_id])
    return {"ok": True}


@router.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int):
    t = db.one("SELECT source_calendar_id FROM tasks WHERE id=?", (task_id,))
    if t and t["source_calendar_id"] is not None:
        raise HTTPException(400, "This assignment comes from a subscribed calendar and would come back on the next "
                                 "sync. Mark it complete instead.")
    db.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    return {"ok": True}


@router.post("/api/event-done")
async def set_event_done(request: Request):
    body = await request.json()
    cal_id, key = int(body.get("calendar_id", 0)), str(body.get("key", ""))
    if not key or not db.one("SELECT id FROM calendars WHERE id=?", (cal_id,)):
        raise HTTPException(400, "Unknown event")
    if body.get("done"):
        db.execute("INSERT OR REPLACE INTO event_done(calendar_id, key, done_at) VALUES(?,?,?)",
                   (cal_id, key, time.time()))
    else:
        db.execute("DELETE FROM event_done WHERE calendar_id=? AND key=?", (cal_id, key))
    return {"ok": True}


# ---------------------------------------------------------------- boards

def _next_pos(table: str, column: str, parent_id: int) -> float:
    row = db.one(f"SELECT MAX(position) p FROM {table} WHERE {column}=?", (parent_id,))
    return (row["p"] or 0) + 1024


@router.get("/api/boards")
async def get_boards():
    boards = db.query(
        "SELECT b.*, (SELECT COUNT(*) FROM cards c JOIN board_lists l ON l.id=c.list_id WHERE l.board_id=b.id) cards "
        "FROM boards b ORDER BY position, id")
    return {"boards": [{"id": b["id"], "name": b["name"], "color": b["color"], "cards": b["cards"]} for b in boards]}


@router.post("/api/boards")
async def create_board(request: Request):
    body = await request.json()
    name = (body.get("name") or "").strip()[:100] or "Untitled board"
    pos = (db.one("SELECT MAX(position) p FROM boards")["p"] or 0) + 1024
    bid = db.execute("INSERT INTO boards(name, color, position, created_at) VALUES(?,?,?,?)",
                     (name, body.get("color") or "#0b8043", pos, time.time()))
    for i, list_name in enumerate(DEFAULT_LISTS):
        db.execute("INSERT INTO board_lists(board_id, name, position) VALUES(?,?,?)", (bid, list_name, (i + 1) * 1024))
    return {"id": bid}


@router.get("/api/boards/{board_id}")
async def get_board(board_id: int):
    board = db.one("SELECT * FROM boards WHERE id=?", (board_id,))
    if not board:
        raise HTTPException(404, "Board not found")
    lists = db.query("SELECT * FROM board_lists WHERE board_id=? ORDER BY position, id", (board_id,))
    cards = db.query("SELECT c.* FROM cards c JOIN board_lists l ON l.id=c.list_id WHERE l.board_id=? "
                     "ORDER BY c.position, c.id", (board_id,))
    by_list: dict[int, list] = {}
    for c in cards:
        by_list.setdefault(c["list_id"], []).append(card_out(c))
    return {
        "board": {"id": board["id"], "name": board["name"], "color": board["color"]},
        "lists": [{"id": l["id"], "name": l["name"], "position": l["position"], "cards": by_list.get(l["id"], [])}
                  for l in lists],
    }


@router.patch("/api/boards/{board_id}")
async def edit_board(board_id: int, request: Request):
    body = await request.json()
    fields = {}
    if "name" in body:
        fields["name"] = str(body["name"]).strip()[:100] or "Untitled board"
    if "color" in body:
        fields["color"] = str(body["color"])[:20]
    if "position" in body:
        fields["position"] = float(body["position"])
    if fields:
        db.execute(f"UPDATE boards SET {','.join(k + '=?' for k in fields)} WHERE id=?",
                   list(fields.values()) + [board_id])
    return {"ok": True}


@router.delete("/api/boards/{board_id}")
async def delete_board(board_id: int):
    db.execute("DELETE FROM boards WHERE id=?", (board_id,))
    return {"ok": True}


@router.post("/api/boards/{board_id}/lists")
async def create_list(board_id: int, request: Request):
    if not db.one("SELECT id FROM boards WHERE id=?", (board_id,)):
        raise HTTPException(404, "Board not found")
    body = await request.json()
    name = (body.get("name") or "").strip()[:100] or "Untitled list"
    lid = db.execute("INSERT INTO board_lists(board_id, name, position) VALUES(?,?,?)",
                     (board_id, name, _next_pos("board_lists", "board_id", board_id)))
    return {"id": lid}


@router.patch("/api/lists/{list_id}")
async def edit_list(list_id: int, request: Request):
    body = await request.json()
    fields = {}
    if "name" in body:
        fields["name"] = str(body["name"]).strip()[:100] or "Untitled list"
    if "position" in body:
        fields["position"] = float(body["position"])
    if fields:
        db.execute(f"UPDATE board_lists SET {','.join(k + '=?' for k in fields)} WHERE id=?",
                   list(fields.values()) + [list_id])
    return {"ok": True}


@router.delete("/api/lists/{list_id}")
async def delete_list(list_id: int):
    db.execute("DELETE FROM board_lists WHERE id=?", (list_id,))
    return {"ok": True}


def _card_values(body: dict, existing: dict | None = None) -> dict:
    merged = {**(existing or {}), **body}
    due, all_day = clean_due(merged.get("due"), merged.get("all_day"))
    return {
        "title": (merged.get("title") or "").strip()[:500] or "(No title)",
        "description": (merged.get("description") or "")[:20000],
        "label": merged.get("label") or None,
        "due": due, "all_day": all_day, "done": 1 if merged.get("done") else 0,
        "updated_at": time.time(),
    }


@router.post("/api/lists/{list_id}/cards")
async def create_card(list_id: int, request: Request):
    if not db.one("SELECT id FROM board_lists WHERE id=?", (list_id,)):
        raise HTTPException(404, "List not found")
    values = _card_values(await request.json())
    values.update(list_id=list_id, position=_next_pos("cards", "list_id", list_id), created_at=time.time())
    cid = db.execute(f"INSERT INTO cards({','.join(values)}) VALUES({','.join('?' * len(values))})",
                     list(values.values()))
    return {"id": cid}


@router.patch("/api/cards/{card_id}")
async def edit_card(card_id: int, request: Request):
    existing = db.one("SELECT * FROM cards WHERE id=?", (card_id,))
    if not existing:
        raise HTTPException(404)
    body = await request.json()
    values = _card_values(body, existing)
    if "list_id" in body:
        target = db.one("SELECT board_id FROM board_lists WHERE id=?", (int(body["list_id"]),))
        if not target:
            raise HTTPException(400, "List not found")
        values["list_id"] = int(body["list_id"])
    if "position" in body:
        values["position"] = float(body["position"])
    elif "list_id" in body and values["list_id"] != existing["list_id"]:
        values["position"] = _next_pos("cards", "list_id", values["list_id"])
    db.execute(f"UPDATE cards SET {','.join(k + '=?' for k in values)} WHERE id=?",
               list(values.values()) + [card_id])
    return {"ok": True}


@router.delete("/api/cards/{card_id}")
async def delete_card(card_id: int):
    db.execute("DELETE FROM cards WHERE id=?", (card_id,))
    return {"ok": True}

"""Configuration loaded from environment variables (and an optional .env file)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.environ.get("CAL_DATA_DIR", ROOT / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "calendar.db"

# Public URL the app is reachable at, used for OAuth redirect URIs.
BASE_URL = os.environ.get("CAL_BASE_URL", "http://localhost:8080").rstrip("/")
HOST = os.environ.get("CAL_HOST", "0.0.0.0")
PORT = int(os.environ.get("CAL_PORT", "8080"))

# Optional: if set, this password is used instead of first-run setup.
PASSWORD = os.environ.get("CAL_PASSWORD", "")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")

MS_CLIENT_ID = os.environ.get("MS_CLIENT_ID", "")
MS_CLIENT_SECRET = os.environ.get("MS_CLIENT_SECRET", "")
MS_TENANT = os.environ.get("MS_TENANT", "common")

# Contact for web push (required by the spec), e.g. mailto:you@example.com
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@localhost")

SYNC_INTERVAL_MINUTES = int(os.environ.get("CAL_SYNC_INTERVAL", "15"))
# How far back / forward remote calendars are pulled.
SYNC_PAST_DAYS = int(os.environ.get("CAL_SYNC_PAST_DAYS", "90"))
SYNC_FUTURE_DAYS = int(os.environ.get("CAL_SYNC_FUTURE_DAYS", "400"))

"""
Centralized configuration management.
Reads all settings from environment variables (via .env file).
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _required_setting(name: str) -> str:
    value = os.getenv(name)
    if not value or not value.strip():
        raise RuntimeError(f"{name} must be set in the environment or backend/.env")
    return value.strip()


# ─── Database ────────────────────────────────────────────────────────────────
DATABASE_URL: str = _required_setting("DATABASE_URL")

# ─── JWT / Auth ───────────────────────────────────────────────────────────────
SECRET_KEY: str = _required_setting("SECRET_KEY")
if SECRET_KEY == "change-this-in-production":
    raise RuntimeError("Replace the default SECRET_KEY with a private key")
ALGORITHM: str = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

# ─── CORS ────────────────────────────────────────────────────────────────────
# Comma-separated list of allowed origins, e.g. "http://localhost:3000,http://localhost:8081"
_raw_origins: str = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:8081,http://127.0.0.1:8081,http://localhost:3000",
)
ALLOWED_ORIGINS: list[str] = [origin.strip() for origin in _raw_origins.split(",") if origin.strip()]

# Development only: also accept any private-LAN http origin (phone on the same Wi-Fi),
# so changing networks does not require editing ALLOWED_ORIGINS. Never allowed in production.
ALLOW_LAN_ORIGINS: bool = (
    os.getenv("APP_ENV") != "production"
    and os.getenv("ALLOW_LAN_ORIGINS", "").strip().lower() in {"1", "true", "yes"}
)
LAN_ORIGIN_REGEX: str | None = (
    r"^http://(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|localhost|127\.0\.0\.1)(:\d{1,5})?$"
    if ALLOW_LAN_ORIGINS else None
)

if os.getenv('APP_ENV') == 'production':
    from urllib.parse import urlsplit
    if len(SECRET_KEY) < 32 or SECRET_KEY.startswith(('replace-', 'change-this')):
        raise RuntimeError('Configure a strong server-only SECRET_KEY before production startup')
    def _public_origin(origin):
        try:
            parts=urlsplit(origin)
            return parts.scheme=='https' and bool(parts.hostname) and not (parts.username or parts.password or parts.query or parts.fragment or parts.path or '*' in origin) and parts.hostname!='localhost' and not parts.hostname.endswith(('.local','.localhost','.internal','.test'))
        except ValueError:return False
    if not ALLOWED_ORIGINS or not all(_public_origin(origin) for origin in ALLOWED_ORIGINS):
        raise RuntimeError('Production ALLOWED_ORIGINS must contain exact HTTPS frontend origins')

_raw_admin_ids = os.getenv("ADMIN_USER_IDS", "")
try:
    ADMIN_USER_IDS: frozenset[int] = frozenset(
        int(value.strip()) for value in _raw_admin_ids.split(",") if value.strip()
    )
except ValueError as exc:
    raise RuntimeError("ADMIN_USER_IDS must be a comma-separated list of integer user IDs") from exc

# ─── Translation ─────────────────────────────────────────────────────────────
TRANSLATION_API_URL: str | None = os.getenv("TRANSLATION_API_URL")
TRANSLATION_API_KEY: str | None = os.getenv("TRANSLATION_API_KEY")

# ─── Pagination defaults ─────────────────────────────────────────────────────
DEFAULT_PAGE_SIZE: int = 20
MAX_PAGE_SIZE: int = 100

# Mount this directory as persistent storage when running the backend container.
UPLOAD_DIR = os.getenv("UPLOAD_DIR") or str(Path(__file__).resolve().parents[1] / "uploads")

# HTTP map requests only read this snapshot; an explicitly enabled sync job writes it.
OSM_CACHE_PATH = os.getenv("OSM_CACHE_PATH") or str(Path(__file__).resolve().parents[1] / "cache" / "osm-poi-v2.json")

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

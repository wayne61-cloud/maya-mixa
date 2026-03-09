import csv
import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import smtplib
import sqlite3
import threading
import time
from collections import deque
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus, urlencode, urlparse

import httpx
import librosa
import numpy as np
import soundfile as sf
import websocket
from fastapi import FastAPI, HTTPException, Query
from fastapi import Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from mutagen import File as MutagenFile
from openai import OpenAI
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "maya.db"
INDEX_PATH = BASE_DIR / "index.html"
APP_JS_PATH = BASE_DIR / "app.js"
ASSETS_DIR = BASE_DIR / "assets"
AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".aiff", ".ogg", ".m4a", ".aac"}
AUTH_SESSION_TTL_SECONDS = int(os.getenv("MAYA_AUTH_TTL_SECONDS", str(60 * 60 * 24 * 30)))
PASSWORD_PBKDF2_ITERATIONS = 210000
PASSWORD_RESET_TTL_SECONDS = int(os.getenv("MAYA_PASSWORD_RESET_TTL_SECONDS", str(60 * 30)))
APP_ENV = os.getenv("MAYA_ENV", "development").strip().lower()
ALLOW_DEBUG_RESET_TOKEN = (
    os.getenv("MAYA_ALLOW_DEBUG_RESET_TOKEN", "false").strip().lower() in {"1", "true", "yes", "on"}
    and APP_ENV != "production"
)
PUBLIC_APP_URL = os.getenv("MAYA_PUBLIC_APP_URL", "").strip()
SMTP_HOST = os.getenv("MAYA_SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("MAYA_SMTP_PORT", "587"))
SMTP_USER = os.getenv("MAYA_SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("MAYA_SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("MAYA_SMTP_FROM", SMTP_USER or "noreply@maya-mixa.local")
SMTP_USE_TLS = os.getenv("MAYA_SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes", "on"}
SMTP_USE_SSL = os.getenv("MAYA_SMTP_USE_SSL", "false").strip().lower() in {"1", "true", "yes", "on"}
ENABLE_LIBRARY_SCAN = os.getenv(
    "MAYA_ENABLE_LIBRARY_SCAN",
    "false" if APP_ENV == "production" else "true",
).strip().lower() in {"1", "true", "yes", "on"}
LIBRARY_SCAN_ROOT = os.getenv("MAYA_LIBRARY_SCAN_ROOT", "").strip()
LIBRARY_SCAN_MAX_FILES = max(1, int(os.getenv("MAYA_LIBRARY_SCAN_MAX_FILES", "400")))
ALLOW_NULL_ORIGIN = os.getenv(
    "MAYA_ALLOW_NULL_ORIGIN",
    "false" if APP_ENV == "production" else "true",
).strip().lower() in {"1", "true", "yes", "on"}
RAW_CORS_ORIGINS = os.getenv("MAYA_CORS_ORIGINS", "").strip()
DEFAULT_AUTH_SECRET = "maya-mixa-dev-secret-change-me"
AUTH_SECRET = os.getenv("MAYA_AUTH_SECRET", DEFAULT_AUTH_SECRET)
BOOTSTRAP_ADMIN_ENABLED = os.getenv(
    "MAYA_BOOTSTRAP_ADMIN",
    "false" if APP_ENV == "production" else "true",
).strip().lower() in {"1", "true", "yes", "on"}
BOOTSTRAP_ADMIN_LOGIN = os.getenv("MAYA_BOOTSTRAP_ADMIN_LOGIN", "admin").strip().lower()
BOOTSTRAP_ADMIN_PASSWORD = os.getenv("MAYA_BOOTSTRAP_ADMIN_PASSWORD", "admin")
BOOTSTRAP_ADMIN_DISPLAY = os.getenv("MAYA_BOOTSTRAP_ADMIN_DISPLAY", "Administrator").strip() or "Administrator"
BOOTSTRAP_ADMIN_DJ_NAME = os.getenv("MAYA_BOOTSTRAP_ADMIN_DJ_NAME", "Admin").strip() or "Admin"
OAUTH_STATE_TTL_SECONDS = max(60, int(os.getenv("MAYA_OAUTH_STATE_TTL_SECONDS", "600")))
GOOGLE_OAUTH_CLIENT_ID = os.getenv("MAYA_GOOGLE_CLIENT_ID", "").strip()
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv("MAYA_GOOGLE_CLIENT_SECRET", "").strip()
GOOGLE_OAUTH_REDIRECT_URI = os.getenv("MAYA_GOOGLE_REDIRECT_URI", "").strip()
APPLE_OAUTH_CLIENT_ID = os.getenv("MAYA_APPLE_CLIENT_ID", "").strip()
APPLE_OAUTH_CLIENT_SECRET = os.getenv("MAYA_APPLE_CLIENT_SECRET", "").strip()
APPLE_OAUTH_REDIRECT_URI = os.getenv("MAYA_APPLE_REDIRECT_URI", "").strip()
AUTH_PASSWORDLESS = os.getenv("MAYA_AUTH_PASSWORDLESS", "true").strip().lower() in {"1", "true", "yes", "on"}
SEED_NEW_USER_LIBRARY = os.getenv("MAYA_SEED_NEW_USER_LIBRARY", "false").strip().lower() in {"1", "true", "yes", "on"}
SEED_BOOTSTRAP_ADMIN_LIBRARY = (
    os.getenv("MAYA_SEED_BOOTSTRAP_ADMIN_LIBRARY", "true").strip().lower() in {"1", "true", "yes", "on"}
)


def parse_cors_origins() -> List[str]:
    origins: List[str] = []
    if RAW_CORS_ORIGINS:
        origins.extend([item.strip() for item in RAW_CORS_ORIGINS.split(",") if item.strip()])
    elif APP_ENV != "production":
        origins.extend(
            [
                "http://127.0.0.1:4173",
                "http://localhost:4173",
                "http://127.0.0.1:8765",
                "http://localhost:8765",
            ]
        )
    if PUBLIC_APP_URL:
        parsed = urlparse(PUBLIC_APP_URL.rstrip("/"))
        if parsed.scheme and parsed.netloc:
            origins.append(f"{parsed.scheme}://{parsed.netloc}")
        else:
            origins.append(PUBLIC_APP_URL.rstrip("/"))
    if ALLOW_NULL_ORIGIN:
        origins.append("null")
    return sorted(set(origins))


ALLOWED_CORS_ORIGINS = parse_cors_origins()

DEFAULT_LIBRARY_TEMPLATES: List[Dict[str, Any]] = [
    {
        "title": "Honeyline Pressure",
        "artist": "Maya Hive",
        "album": "Hive Protocol",
        "duration": 404.2,
        "bpm": 124.0,
        "musical_key": "A minor",
        "camelot_key": "8A",
        "energy": 6.8,
        "note": 7.3,
        "genre": "melodic techno",
        "tags": ["warmup", "hypnotic", "hive-groove"],
        "features": {"bass": 6.9, "melodic": 7.8, "percussion": 6.4, "brightness": 6.8, "groove": 7.0, "danceability": 7.2, "key_confidence": 0.88, "analysis_confidence": 0.92, "rms_mean": 0.0551, "onset_mean": 1.9132, "rolloff_mean": 6152.0},
    },
    {
        "title": "Nectar Drive",
        "artist": "ANNA",
        "album": "Peak Hive",
        "duration": 386.5,
        "bpm": 126.0,
        "musical_key": "E minor",
        "camelot_key": "9A",
        "energy": 7.9,
        "note": 8.1,
        "genre": "techno",
        "tags": ["peak-time", "driving", "club"],
        "features": {"bass": 8.2, "melodic": 6.2, "percussion": 7.9, "brightness": 6.1, "groove": 7.1, "danceability": 8.0, "key_confidence": 0.91, "analysis_confidence": 0.94, "rms_mean": 0.0734, "onset_mean": 2.4718, "rolloff_mean": 6910.0},
    },
    {
        "title": "Wax Corridor",
        "artist": "Charlotte de Witte",
        "album": "Nocturnal Cells",
        "duration": 372.0,
        "bpm": 127.0,
        "musical_key": "D minor",
        "camelot_key": "7A",
        "energy": 8.4,
        "note": 8.3,
        "genre": "hard techno",
        "tags": ["warehouse", "raw", "peak-time"],
        "features": {"bass": 8.8, "melodic": 5.0, "percussion": 8.7, "brightness": 5.4, "groove": 6.8, "danceability": 8.4, "key_confidence": 0.84, "analysis_confidence": 0.9, "rms_mean": 0.0811, "onset_mean": 2.8832, "rolloff_mean": 7342.0},
    },
    {
        "title": "Queen Spiral",
        "artist": "Joris Voorn",
        "album": "Worker Signals",
        "duration": 418.8,
        "bpm": 125.0,
        "musical_key": "A minor",
        "camelot_key": "8A",
        "energy": 7.4,
        "note": 7.7,
        "genre": "melodic techno",
        "tags": ["journey", "atmospheric", "rolling"],
        "features": {"bass": 7.4, "melodic": 7.1, "percussion": 7.0, "brightness": 7.2, "groove": 7.4, "danceability": 7.8, "key_confidence": 0.9, "analysis_confidence": 0.93, "rms_mean": 0.0624, "onset_mean": 2.1113, "rolloff_mean": 6592.0},
    },
    {
        "title": "Hexa Bloom",
        "artist": "Anyma",
        "album": "Hive Future",
        "duration": 401.1,
        "bpm": 126.0,
        "musical_key": "B minor",
        "camelot_key": "10A",
        "energy": 8.0,
        "note": 8.2,
        "genre": "melodic techno",
        "tags": ["cinematic", "dark", "euphoric"],
        "features": {"bass": 8.0, "melodic": 7.5, "percussion": 7.2, "brightness": 7.9, "groove": 7.3, "danceability": 8.0, "key_confidence": 0.89, "analysis_confidence": 0.95, "rms_mean": 0.0702, "onset_mean": 2.3045, "rolloff_mean": 7055.0},
    },
    {
        "title": "Comb Resonance",
        "artist": "Richie Hawtin",
        "album": "Modular Colony",
        "duration": 356.4,
        "bpm": 128.0,
        "musical_key": "F# minor",
        "camelot_key": "11A",
        "energy": 8.6,
        "note": 8.5,
        "genre": "hard techno",
        "tags": ["acid", "percussive", "tool"],
        "features": {"bass": 8.9, "melodic": 4.7, "percussion": 9.0, "brightness": 5.2, "groove": 6.6, "danceability": 8.6, "key_confidence": 0.81, "analysis_confidence": 0.89, "rms_mean": 0.0837, "onset_mean": 3.0401, "rolloff_mean": 7480.0},
    },
    {
        "title": "Amber Drift",
        "artist": "Peggy Gou",
        "album": "Night Nectar",
        "duration": 367.2,
        "bpm": 123.0,
        "musical_key": "G minor",
        "camelot_key": "6A",
        "energy": 6.5,
        "note": 7.0,
        "genre": "progressive house",
        "tags": ["warmup", "groove", "deep"],
        "features": {"bass": 6.7, "melodic": 6.9, "percussion": 6.1, "brightness": 6.9, "groove": 7.2, "danceability": 7.1, "key_confidence": 0.87, "analysis_confidence": 0.91, "rms_mean": 0.0535, "onset_mean": 1.7442, "rolloff_mean": 6020.0},
    },
    {
        "title": "Hive Collapse",
        "artist": "Amelie Lens",
        "album": "Swarm Afterhours",
        "duration": 390.7,
        "bpm": 129.0,
        "musical_key": "C# minor",
        "camelot_key": "12A",
        "energy": 8.8,
        "note": 8.7,
        "genre": "hard techno",
        "tags": ["peak-time", "industrial", "warehouse"],
        "features": {"bass": 9.0, "melodic": 4.8, "percussion": 9.2, "brightness": 5.0, "groove": 6.4, "danceability": 8.8, "key_confidence": 0.8, "analysis_confidence": 0.88, "rms_mean": 0.0874, "onset_mean": 3.2285, "rolloff_mean": 7605.0},
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def validate_email(email: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_login_identifier(identifier: str) -> bool:
    value = normalize_email(identifier or "")
    if not value:
        return False
    if AUTH_PASSWORDLESS:
        return bool(re.match(r"^[a-z0-9._@-]{3,80}$", value))
    return validate_email(value)


def hash_password(password: str, salt_hex: Optional[str] = None) -> Tuple[str, str]:
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_PBKDF2_ITERATIONS,
    )
    return digest.hex(), salt.hex()


def verify_password(password: str, stored_hash_hex: str, stored_salt_hex: str) -> bool:
    candidate_hash, _ = hash_password(password, stored_salt_hex)
    return hmac.compare_digest(candidate_hash, stored_hash_hex)


def build_session_token() -> str:
    return "mmx_" + secrets.token_urlsafe(48)


def build_reset_token() -> str:
    return "mmx_reset_" + secrets.token_urlsafe(48)


def token_hash(raw_token: str) -> str:
    return hashlib.sha256((AUTH_SECRET + "::" + raw_token).encode("utf-8")).hexdigest()


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(raw: str) -> bytes:
    padded = raw + ("=" * ((4 - len(raw) % 4) % 4))
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def build_oauth_state(provider: str) -> str:
    payload = {
        "provider": provider,
        "nonce": secrets.token_urlsafe(12),
        "exp": int(time.time()) + OAUTH_STATE_TTL_SECONDS,
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = hmac.new(AUTH_SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return f"{_b64url_encode(raw)}.{signature}"


def validate_oauth_state(provider: str, state: str) -> bool:
    parts = (state or "").split(".", 1)
    if len(parts) != 2:
        return False
    raw_part, signature = parts
    try:
        raw = _b64url_decode(raw_part)
    except Exception:
        return False
    expected = hmac.new(AUTH_SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return False
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return False
    if payload.get("provider") != provider:
        return False
    expires_at = int(payload.get("exp", 0))
    return expires_at > int(time.time())


def decode_jwt_payload(jwt_token: str) -> Dict[str, Any]:
    parts = (jwt_token or "").split(".")
    if len(parts) < 2:
        return {}
    try:
        payload = _b64url_decode(parts[1]).decode("utf-8")
        data = json.loads(payload)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def resolve_app_base_url(request: Request) -> str:
    if PUBLIC_APP_URL:
        return PUBLIC_APP_URL.rstrip("/")
    parsed = urlparse(str(request.base_url))
    return f"{parsed.scheme}://{parsed.netloc}"


def oauth_provider_config(provider: str, request: Request) -> Dict[str, Any]:
    provider = provider.lower().strip()
    base_url = resolve_app_base_url(request)
    if provider == "google":
        callback = GOOGLE_OAUTH_REDIRECT_URI or f"{base_url}/api/auth/oauth/google/callback"
        return {
            "provider": "google",
            "configured": bool(GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET),
            "client_id": GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
            "redirect_uri": callback,
        }
    if provider == "apple":
        callback = APPLE_OAUTH_REDIRECT_URI or f"{base_url}/api/auth/oauth/apple/callback"
        return {
            "provider": "apple",
            "configured": bool(APPLE_OAUTH_CLIENT_ID and APPLE_OAUTH_CLIENT_SECRET),
            "client_id": APPLE_OAUTH_CLIENT_ID,
            "client_secret": APPLE_OAUTH_CLIENT_SECRET,
            "redirect_uri": callback,
        }
    return {"provider": provider, "configured": False, "client_id": "", "client_secret": "", "redirect_uri": ""}


def oauth_frontend_redirect(request: Request, auth_token: str = "", provider: str = "", error: str = "") -> str:
    base_url = resolve_app_base_url(request)
    params: Dict[str, str] = {}
    if auth_token:
        params["auth_token"] = auth_token
    if provider:
        params["oauth_provider"] = provider
    if error:
        params["oauth_error"] = error
    if not params:
        return f"{base_url}/"
    return f"{base_url}/?{urlencode(params)}"


def send_password_reset_email(to_email: str, reset_token: str, dj_name: str = "") -> Tuple[bool, str]:
    if not SMTP_HOST:
        return False, "SMTP not configured"

    reset_link = ""
    if PUBLIC_APP_URL:
        separator = "&" if "?" in PUBLIC_APP_URL else "?"
        reset_link = f"{PUBLIC_APP_URL}{separator}reset_token={quote_plus(reset_token)}"

    body_lines = [
        f"Bonjour {dj_name or 'DJ'},",
        "",
        "Voici votre demande de réinitialisation de mot de passe Maya Mixa.",
        f"Ce lien/code expire dans {int(PASSWORD_RESET_TTL_SECONDS / 60)} minutes.",
        "",
    ]
    if reset_link:
        body_lines.append(f"Lien de reset: {reset_link}")
    body_lines.append(f"Code de reset: {reset_token}")
    body_lines.extend(
        [
            "",
            "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.",
            "",
            "Maya Mixa Security",
        ]
    )
    body = "\n".join(body_lines)

    message = EmailMessage()
    message["Subject"] = "Maya Mixa - Réinitialisation de mot de passe"
    message["From"] = SMTP_FROM
    message["To"] = to_email
    message.set_content(body)

    try:
        if SMTP_USE_SSL:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
                if SMTP_USER:
                    smtp.login(SMTP_USER, SMTP_PASSWORD)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
                smtp.ehlo()
                if SMTP_USE_TLS:
                    smtp.starttls()
                    smtp.ehlo()
                if SMTP_USER:
                    smtp.login(SMTP_USER, SMTP_PASSWORD)
                smtp.send_message(message)
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)

    return True, "sent"


class RateLimiter:
    def __init__(self) -> None:
        self._events: Dict[str, List[float]] = {}
        self._lock = threading.Lock()

    def allow(self, bucket: str, key: str, max_hits: int, window_seconds: int) -> Tuple[bool, int]:
        now = time.time()
        compound = f"{bucket}:{key}"
        with self._lock:
            existing = [ts for ts in self._events.get(compound, []) if now - ts < window_seconds]
            if len(existing) >= max_hits:
                retry_after = max(1, int(window_seconds - (now - existing[0])))
                self._events[compound] = existing
                return False, retry_after
            existing.append(now)
            self._events[compound] = existing
        return True, 0


rate_limiter = RateLimiter()


def enforce_rate_limit(bucket: str, key: str, max_hits: int, window_seconds: int) -> None:
    allowed, retry_after = rate_limiter.allow(bucket, key, max_hits=max_hits, window_seconds=window_seconds)
    if not allowed:
        raise HTTPException(status_code=429, detail=f"Too many requests. Retry in {retry_after}s")


def parse_title_artist_from_filename(path: Path) -> Tuple[str, str]:
    stem = path.stem
    if " - " in stem:
        left, right = stem.split(" - ", 1)
        return right.strip() or stem, left.strip() or "Unknown Artist"
    return stem, "Unknown Artist"


def compute_sha1(path: Path, block_size: int = 65536) -> str:
    sha1 = hashlib.sha1()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(block_size)
            if not chunk:
                break
            sha1.update(chunk)
    return sha1.hexdigest()


class Database:
    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self._init_schema()

    def _column_exists(self, table: str, column: str) -> bool:
        rows = self.conn.execute(f"PRAGMA table_info({table})").fetchall()
        for row in rows:
            if row["name"] == column:
                return True
        return False

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        if not self._column_exists(table, column):
            self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def _profiles_has_global_name_unique(self) -> bool:
        indices = self.conn.execute("PRAGMA index_list(profiles)").fetchall()
        for idx in indices:
            if int(idx["unique"]) != 1:
                continue
            name = idx["name"]
            cols = self.conn.execute(f"PRAGMA index_info({name})").fetchall()
            col_names = [col["name"] for col in cols]
            if col_names == ["name"]:
                return True
        return False

    def _migrate_profiles_scope(self) -> None:
        if not self._profiles_has_global_name_unique():
            self.conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_name ON profiles(user_id, name)"
            )
            return

        self.conn.execute("PRAGMA foreign_keys = OFF")
        try:
            self.conn.execute("DROP TABLE IF EXISTS profiles_new")
            self.conn.execute(
                """
                CREATE TABLE profiles_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    preferences_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    user_id INTEGER,
                    FOREIGN KEY(user_id) REFERENCES users(id),
                    UNIQUE(user_id, name)
                )
                """
            )
            self.conn.execute(
                """
                INSERT INTO profiles_new (id, name, description, preferences_json, created_at, user_id)
                SELECT id, name, description, preferences_json, created_at, user_id
                FROM profiles
                """
            )
            self.conn.execute("DROP TABLE profiles")
            self.conn.execute("ALTER TABLE profiles_new RENAME TO profiles")
            self.conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_name ON profiles(user_id, name)"
            )
        finally:
            self.conn.execute("PRAGMA foreign_keys = ON")

    def _init_schema(self) -> None:
        with self.lock:
            cur = self.conn.cursor()
            cur.executescript(
                """
                PRAGMA journal_mode=WAL;

                CREATE TABLE IF NOT EXISTS tracks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_path TEXT UNIQUE NOT NULL,
                    file_hash TEXT NOT NULL,
                    title TEXT NOT NULL,
                    artist TEXT NOT NULL,
                    album TEXT,
                    duration REAL NOT NULL,
                    bpm REAL NOT NULL,
                    musical_key TEXT NOT NULL,
                    camelot_key TEXT,
                    energy REAL NOT NULL,
                    note REAL NOT NULL,
                    genre TEXT NOT NULL,
                    tags TEXT NOT NULL,
                    features_json TEXT NOT NULL,
                    analyzed_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS profiles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    preferences_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    user_id INTEGER,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    profile_id INTEGER,
                    name TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    status TEXT NOT NULL,
                    FOREIGN KEY(profile_id) REFERENCES profiles(id)
                );

                CREATE TABLE IF NOT EXISTS plays (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER,
                    track_id INTEGER,
                    source TEXT NOT NULL,
                    played_at TEXT NOT NULL,
                    extra_json TEXT NOT NULL,
                    FOREIGN KEY(session_id) REFERENCES sessions(id),
                    FOREIGN KEY(track_id) REFERENCES tracks(id)
                );

                CREATE TABLE IF NOT EXISTS transitions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER,
                    track_a_id INTEGER NOT NULL,
                    track_b_id INTEGER NOT NULL,
                    compatibility REAL NOT NULL,
                    difficulty TEXT NOT NULL,
                    analysis_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(session_id) REFERENCES sessions(id),
                    FOREIGN KEY(track_a_id) REFERENCES tracks(id),
                    FOREIGN KEY(track_b_id) REFERENCES tracks(id)
                );

                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS external_tracks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    source_track_id TEXT NOT NULL,
                    source_url TEXT,
                    title TEXT NOT NULL,
                    artist TEXT NOT NULL,
                    version TEXT,
                    duration REAL,
                    bpm REAL,
                    musical_key TEXT,
                    camelot_key TEXT,
                    energy REAL,
                    note REAL,
                    genre TEXT,
                    tags TEXT,
                    mood_tags TEXT,
                    confidence REAL,
                    metadata_json TEXT NOT NULL,
                    intelligence_json TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(source, source_track_id)
                );

                CREATE TABLE IF NOT EXISTS external_lists (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    external_track_id INTEGER NOT NULL,
                    list_name TEXT NOT NULL,
                    note TEXT,
                    action TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(external_track_id) REFERENCES external_tracks(id)
                );

                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    password_salt TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    dj_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'dj',
                    status TEXT NOT NULL DEFAULT 'active',
                    preferences_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login_at TEXT
                );

                CREATE TABLE IF NOT EXISTS auth_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token_hash TEXT UNIQUE NOT NULL,
                    user_agent TEXT,
                    ip_address TEXT,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    revoked_at TEXT,
                    last_seen_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    token_hash TEXT UNIQUE NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    used_at TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );

                CREATE TABLE IF NOT EXISTS user_tracks (
                    user_id INTEGER NOT NULL,
                    track_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(user_id, track_id),
                    FOREIGN KEY(user_id) REFERENCES users(id),
                    FOREIGN KEY(track_id) REFERENCES tracks(id)
                );

                CREATE TABLE IF NOT EXISTS oauth_identities (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    provider TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    email TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(provider, subject),
                    FOREIGN KEY(user_id) REFERENCES users(id)
                );
                """
            )

            self._ensure_column("profiles", "user_id", "INTEGER")
            self._ensure_column("sessions", "user_id", "INTEGER")
            self._ensure_column("plays", "user_id", "INTEGER")
            self._ensure_column("transitions", "user_id", "INTEGER")
            self._ensure_column("events", "user_id", "INTEGER")
            self._ensure_column("external_lists", "user_id", "INTEGER")
            self._migrate_profiles_scope()

            self.conn.commit()

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        data = dict(row)
        if "features_json" in data:
            data["features"] = json.loads(data["features_json"])
            del data["features_json"]
        if "analysis_json" in data:
            data["analysis"] = json.loads(data["analysis_json"])
            del data["analysis_json"]
        if "metadata_json" in data:
            data["metadata"] = json.loads(data["metadata_json"])
            del data["metadata_json"]
        if "intelligence_json" in data:
            data["intelligence"] = json.loads(data["intelligence_json"])
            del data["intelligence_json"]
        if "payload_json" in data:
            data["payload"] = json.loads(data["payload_json"])
            del data["payload_json"]
        if "preferences_json" in data:
            data["preferences"] = json.loads(data["preferences_json"])
            del data["preferences_json"]
        if "extra_json" in data:
            data["extra"] = json.loads(data["extra_json"])
            del data["extra_json"]
        if "tags" in data and isinstance(data["tags"], str):
            data["tags"] = [part for part in data["tags"].split("|") if part]
        if "mood_tags" in data and isinstance(data["mood_tags"], str):
            data["mood_tags"] = [part for part in data["mood_tags"].split("|") if part]
        return data

    def create_user(
        self,
        email: str,
        password_hash_hex: str,
        password_salt_hex: str,
        display_name: str,
        dj_name: str,
        role: str = "dj",
        status: str = "active",
        preferences: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        with self.lock:
            now = now_iso()
            cur = self.conn.execute(
                """
                INSERT INTO users (
                    email, password_hash, password_salt, display_name, dj_name,
                    role, status, preferences_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalize_email(email),
                    password_hash_hex,
                    password_salt_hex,
                    display_name.strip(),
                    dj_name.strip() or display_name.strip(),
                    role,
                    status,
                    json.dumps(preferences or {}),
                    now,
                    now,
                ),
            )
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
            return self._row_to_dict(row)

    def get_user(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self.lock:
            row = self.conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return self._row_to_dict(row) if row else None

    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            row = self.conn.execute("SELECT * FROM users WHERE lower(email)=lower(?)", (normalize_email(email),)).fetchone()
            return self._row_to_dict(row) if row else None

    def get_oauth_identity(self, provider: str, subject: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            row = self.conn.execute(
                "SELECT * FROM oauth_identities WHERE provider = ? AND subject = ?",
                (provider.strip().lower(), subject.strip()),
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def upsert_oauth_identity(self, provider: str, subject: str, user_id: int, email: str = "") -> Dict[str, Any]:
        provider_norm = provider.strip().lower()
        subject_norm = subject.strip()
        with self.lock:
            now = now_iso()
            existing = self.conn.execute(
                "SELECT id FROM oauth_identities WHERE provider = ? AND subject = ?",
                (provider_norm, subject_norm),
            ).fetchone()
            if existing:
                self.conn.execute(
                    """
                    UPDATE oauth_identities
                    SET user_id = ?, email = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (user_id, normalize_email(email) if email else "", now, int(existing["id"])),
                )
                identity_id = int(existing["id"])
            else:
                cur = self.conn.execute(
                    """
                    INSERT INTO oauth_identities (provider, subject, user_id, email, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (provider_norm, subject_norm, user_id, normalize_email(email) if email else "", now, now),
                )
                identity_id = int(cur.lastrowid)
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM oauth_identities WHERE id = ?", (identity_id,)).fetchone()
            return self._row_to_dict(row)

    def list_users(self, query: str = "", limit: int = 200) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM users"
        params: Tuple[Any, ...]
        if query.strip():
            q = f"%{query.strip().lower()}%"
            sql += " WHERE lower(email) LIKE ? OR lower(display_name) LIKE ? OR lower(dj_name) LIKE ?"
            params = (q, q, q)
        else:
            params = ()
        sql += " ORDER BY id DESC LIMIT ?"
        params = params + (limit,)
        with self.lock:
            rows = self.conn.execute(sql, params).fetchall()
            return [self._row_to_dict(row) for row in rows]

    def update_user_profile(
        self,
        user_id: int,
        display_name: str,
        dj_name: str,
        preferences: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        with self.lock:
            self.conn.execute(
                """
                UPDATE users
                SET display_name = ?, dj_name = ?, preferences_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    display_name.strip(),
                    dj_name.strip() or display_name.strip(),
                    json.dumps(preferences or {}),
                    now_iso(),
                    user_id,
                ),
            )
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return self._row_to_dict(row)

    def update_user_role_status(self, user_id: int, role: Optional[str], status: Optional[str]) -> Dict[str, Any]:
        with self.lock:
            existing = self.conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not existing:
                raise ValueError("User not found")
            next_role = role or existing["role"]
            next_status = status or existing["status"]
            self.conn.execute(
                "UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?",
                (next_role, next_status, now_iso(), user_id),
            )
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return self._row_to_dict(row)

    def update_user_password(self, user_id: int, password_hash_hex: str, password_salt_hex: str) -> None:
        with self.lock:
            self.conn.execute(
                "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?",
                (password_hash_hex, password_salt_hex, now_iso(), user_id),
            )
            self.conn.commit()

    def touch_user_login(self, user_id: int) -> None:
        with self.lock:
            self.conn.execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (now_iso(), now_iso(), user_id))
            self.conn.commit()

    def create_auth_session(self, user_id: int, hashed_token: str, user_agent: str = "", ip_address: str = "") -> Dict[str, Any]:
        with self.lock:
            created = now_iso()
            expires_at = datetime.fromtimestamp(time.time() + AUTH_SESSION_TTL_SECONDS, tz=timezone.utc).isoformat()
            cur = self.conn.execute(
                """
                INSERT INTO auth_sessions (
                    user_id, token_hash, user_agent, ip_address, created_at, expires_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, hashed_token, user_agent[:500], ip_address[:100], created, expires_at, created),
            )
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM auth_sessions WHERE id = ?", (cur.lastrowid,)).fetchone()
            return self._row_to_dict(row)

    def get_auth_session(self, hashed_token: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            row = self.conn.execute(
                """
                SELECT * FROM auth_sessions
                WHERE token_hash = ?
                ORDER BY id DESC LIMIT 1
                """,
                (hashed_token,),
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def touch_auth_session(self, session_id: int) -> None:
        with self.lock:
            self.conn.execute("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?", (now_iso(), session_id))
            self.conn.commit()

    def revoke_auth_session(self, hashed_token: str) -> None:
        with self.lock:
            self.conn.execute("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?", (now_iso(), hashed_token))
            self.conn.commit()

    def revoke_user_sessions(self, user_id: int, except_token_hash: str = "") -> None:
        with self.lock:
            if except_token_hash:
                self.conn.execute(
                    "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND token_hash != ? AND revoked_at IS NULL",
                    (now_iso(), user_id, except_token_hash),
                )
            else:
                self.conn.execute(
                    "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                    (now_iso(), user_id),
                )
            self.conn.commit()

    def create_password_reset_token(self, user_id: int, hashed_token: str) -> Dict[str, Any]:
        with self.lock:
            self.conn.execute(
                "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
                (now_iso(), user_id),
            )
            created = now_iso()
            expires_at = datetime.fromtimestamp(time.time() + PASSWORD_RESET_TTL_SECONDS, tz=timezone.utc).isoformat()
            cur = self.conn.execute(
                """
                INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, hashed_token, created, expires_at),
            )
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM password_reset_tokens WHERE id = ?", (cur.lastrowid,)).fetchone()
            return self._row_to_dict(row)

    def get_password_reset_token(self, hashed_token: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            row = self.conn.execute(
                """
                SELECT * FROM password_reset_tokens
                WHERE token_hash = ?
                ORDER BY id DESC LIMIT 1
                """,
                (hashed_token,),
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def mark_password_reset_token_used(self, token_id: int) -> None:
        with self.lock:
            self.conn.execute("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", (now_iso(), token_id))
            self.conn.commit()

    def link_user_track(self, user_id: int, track_id: int) -> None:
        with self.lock:
            self.conn.execute(
                """
                INSERT OR IGNORE INTO user_tracks (user_id, track_id, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, track_id, now_iso()),
            )
            self.conn.commit()

    def unlink_virtual_default_tracks(self, user_id: int) -> int:
        with self.lock:
            cur = self.conn.execute(
                """
                DELETE FROM user_tracks
                WHERE user_id = ?
                  AND track_id IN (
                    SELECT id FROM tracks WHERE file_path LIKE 'virtual://maya-default-library/%'
                  )
                """,
                (user_id,),
            )
            self.conn.commit()
            return int(cur.rowcount or 0)

    def upsert_track(self, track: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            now = now_iso()
            existing = self.conn.execute(
                "SELECT id, created_at FROM tracks WHERE file_path = ?",
                (track["file_path"],),
            ).fetchone()
            if existing:
                self.conn.execute(
                    """
                    UPDATE tracks
                    SET file_hash = ?, title = ?, artist = ?, album = ?, duration = ?, bpm = ?,
                        musical_key = ?, camelot_key = ?, energy = ?, note = ?, genre = ?, tags = ?,
                        features_json = ?, analyzed_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        track["file_hash"],
                        track["title"],
                        track["artist"],
                        track.get("album") or "",
                        track["duration"],
                        track["bpm"],
                        track["musical_key"],
                        track.get("camelot_key") or "",
                        track["energy"],
                        track["note"],
                        track["genre"],
                        "|".join(track.get("tags", [])),
                        json.dumps(track["features"]),
                        now,
                        now,
                        existing["id"],
                    ),
                )
                track_id = existing["id"]
            else:
                cur = self.conn.execute(
                    """
                    INSERT INTO tracks (
                        file_path, file_hash, title, artist, album, duration, bpm, musical_key,
                        camelot_key, energy, note, genre, tags, features_json, analyzed_at,
                        created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        track["file_path"],
                        track["file_hash"],
                        track["title"],
                        track["artist"],
                        track.get("album") or "",
                        track["duration"],
                        track["bpm"],
                        track["musical_key"],
                        track.get("camelot_key") or "",
                        track["energy"],
                        track["note"],
                        track["genre"],
                        "|".join(track.get("tags", [])),
                        json.dumps(track["features"]),
                        now,
                        now,
                        now,
                    ),
                )
                track_id = cur.lastrowid

            self.conn.commit()
            row = self.conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
            return self._row_to_dict(row)

    def get_track(self, track_id: int, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                row = self.conn.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)).fetchone()
            else:
                row = self.conn.execute(
                    """
                    SELECT t.*
                    FROM tracks t
                    JOIN user_tracks ut ON ut.track_id = t.id
                    WHERE t.id = ? AND ut.user_id = ?
                    LIMIT 1
                    """,
                    (track_id, user_id),
                ).fetchone()
            return self._row_to_dict(row) if row else None

    def get_track_by_path(self, file_path: str, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                row = self.conn.execute("SELECT * FROM tracks WHERE file_path = ?", (file_path,)).fetchone()
            else:
                row = self.conn.execute(
                    """
                    SELECT t.*
                    FROM tracks t
                    JOIN user_tracks ut ON ut.track_id = t.id
                    WHERE t.file_path = ? AND ut.user_id = ?
                    LIMIT 1
                    """,
                    (file_path, user_id),
                ).fetchone()
            return self._row_to_dict(row) if row else None

    def find_track(self, title: str, artist: str, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                row = self.conn.execute(
                    """
                    SELECT * FROM tracks
                    WHERE lower(title) = lower(?) AND lower(artist) = lower(?)
                    ORDER BY id DESC LIMIT 1
                    """,
                    (title, artist),
                ).fetchone()
            else:
                row = self.conn.execute(
                    """
                    SELECT t.*
                    FROM tracks t
                    JOIN user_tracks ut ON ut.track_id = t.id
                    WHERE lower(t.title) = lower(?) AND lower(t.artist) = lower(?) AND ut.user_id = ?
                    ORDER BY t.id DESC LIMIT 1
                    """,
                    (title, artist, user_id),
                ).fetchone()
            return self._row_to_dict(row) if row else None

    def list_tracks(self, query: str = "", limit: int = 200, user_id: Optional[int] = None) -> List[Dict[str, Any]]:
        params: Tuple[Any, ...] = ()
        where_parts: List[str] = []
        if user_id is None:
            sql = "SELECT t.* FROM tracks t"
        else:
            sql = "SELECT t.* FROM tracks t JOIN user_tracks ut ON ut.track_id = t.id"
            where_parts.append("ut.user_id = ?")
            params += (user_id,)

        if query:
            where_parts.append("(lower(t.title) LIKE ? OR lower(t.artist) LIKE ? OR lower(t.genre) LIKE ? OR lower(t.tags) LIKE ?)")
            q = f"%{query.lower()}%"
            params += (q, q, q, q)

        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)
        sql += " ORDER BY t.updated_at DESC LIMIT ?"
        params += (limit,)
        with self.lock:
            rows = self.conn.execute(sql, params).fetchall()
            return [self._row_to_dict(row) for row in rows]

    def find_external_track(self, source: str, source_track_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            row = self.conn.execute(
                "SELECT * FROM external_tracks WHERE source = ? AND source_track_id = ?",
                (source, source_track_id),
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def upsert_external_track(self, item: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            now = now_iso()
            existing = self.conn.execute(
                "SELECT id, created_at FROM external_tracks WHERE source = ? AND source_track_id = ?",
                (item["source"], item["source_track_id"]),
            ).fetchone()

            tags = "|".join(item.get("tags", []))
            mood_tags = "|".join(item.get("mood_tags", []))

            if existing:
                self.conn.execute(
                    """
                    UPDATE external_tracks
                    SET source_url = ?, title = ?, artist = ?, version = ?, duration = ?, bpm = ?,
                        musical_key = ?, camelot_key = ?, energy = ?, note = ?, genre = ?, tags = ?,
                        mood_tags = ?, confidence = ?, metadata_json = ?, intelligence_json = ?,
                        last_seen_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        item.get("source_url") or "",
                        item["title"],
                        item["artist"],
                        item.get("version") or "",
                        item.get("duration"),
                        item.get("bpm"),
                        item.get("musical_key") or "",
                        item.get("camelot_key") or "",
                        item.get("energy"),
                        item.get("note"),
                        item.get("genre") or "",
                        tags,
                        mood_tags,
                        item.get("confidence"),
                        json.dumps(item.get("metadata", {})),
                        json.dumps(item.get("intelligence", {})),
                        now,
                        now,
                        existing["id"],
                    ),
                )
                external_id = existing["id"]
            else:
                cur = self.conn.execute(
                    """
                    INSERT INTO external_tracks (
                        source, source_track_id, source_url, title, artist, version, duration, bpm,
                        musical_key, camelot_key, energy, note, genre, tags, mood_tags, confidence,
                        metadata_json, intelligence_json, last_seen_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item["source"],
                        item["source_track_id"],
                        item.get("source_url") or "",
                        item["title"],
                        item["artist"],
                        item.get("version") or "",
                        item.get("duration"),
                        item.get("bpm"),
                        item.get("musical_key") or "",
                        item.get("camelot_key") or "",
                        item.get("energy"),
                        item.get("note"),
                        item.get("genre") or "",
                        tags,
                        mood_tags,
                        item.get("confidence"),
                        json.dumps(item.get("metadata", {})),
                        json.dumps(item.get("intelligence", {})),
                        now,
                        now,
                        now,
                    ),
                )
                external_id = cur.lastrowid

            self.conn.commit()
            row = self.conn.execute("SELECT * FROM external_tracks WHERE id = ?", (external_id,)).fetchone()
            return self._row_to_dict(row)

    def get_external_track(self, external_id: int) -> Optional[Dict[str, Any]]:
        with self.lock:
            row = self.conn.execute("SELECT * FROM external_tracks WHERE id = ?", (external_id,)).fetchone()
            return self._row_to_dict(row) if row else None

    def list_external_tracks(self, query: str = "", limit: int = 50) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM external_tracks"
        params: Tuple[Any, ...]
        if query:
            q = f"%{query.lower()}%"
            sql += " WHERE lower(title) LIKE ? OR lower(artist) LIKE ? OR lower(genre) LIKE ? OR lower(tags) LIKE ?"
            params = (q, q, q, q)
        else:
            params = ()
        sql += " ORDER BY last_seen_at DESC LIMIT ?"
        params = params + (limit,)
        with self.lock:
            rows = self.conn.execute(sql, params).fetchall()
            return [self._row_to_dict(row) for row in rows]

    def add_external_list_item(
        self,
        external_track_id: int,
        list_name: str,
        action: str = "save",
        note: str = "",
        user_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        with self.lock:
            cur = self.conn.execute(
                """
                INSERT INTO external_lists (external_track_id, list_name, note, action, created_at, user_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (external_track_id, list_name, note, action, now_iso(), user_id),
            )
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM external_lists WHERE id = ?", (cur.lastrowid,)).fetchone()
            return dict(row)

    def list_external_list_items(self, list_name: str = "", limit: int = 200, user_id: Optional[int] = None) -> List[Dict[str, Any]]:
        with self.lock:
            where = []
            params: List[Any] = []
            if list_name:
                where.append("lower(l.list_name) = lower(?)")
                params.append(list_name)
            if user_id is not None:
                where.append("l.user_id = ?")
                params.append(user_id)

            sql = """
                SELECT l.*, e.title, e.artist, e.bpm, e.camelot_key, e.genre, e.note
                FROM external_lists l
                JOIN external_tracks e ON e.id = l.external_track_id
            """
            if where:
                sql += " WHERE " + " AND ".join(where)
            sql += " ORDER BY l.id DESC LIMIT ?"
            params.append(limit)
            rows = self.conn.execute(sql, tuple(params)).fetchall()
            return [dict(row) for row in rows]

    def add_transition(
        self,
        session_id: Optional[int],
        track_a_id: int,
        track_b_id: int,
        analysis: Dict[str, Any],
        user_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        with self.lock:
            cur = self.conn.execute(
                """
                INSERT INTO transitions (
                    session_id, track_a_id, track_b_id, compatibility, difficulty, analysis_json, created_at, user_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session_id,
                    track_a_id,
                    track_b_id,
                    analysis["compatibility"],
                    analysis["difficulty"],
                    json.dumps(analysis),
                    now_iso(),
                    user_id,
                ),
            )
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM transitions WHERE id = ?", (cur.lastrowid,)).fetchone()
            return self._row_to_dict(row)

    def add_play(
        self,
        session_id: Optional[int],
        track_id: Optional[int],
        source: str,
        extra: Dict[str, Any],
        user_id: Optional[int] = None,
    ) -> None:
        with self.lock:
            self.conn.execute(
                """
                INSERT INTO plays (session_id, track_id, source, played_at, extra_json, user_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (session_id, track_id, source, now_iso(), json.dumps(extra), user_id),
            )
            self.conn.commit()

    def add_event(self, event_type: str, payload: Dict[str, Any], user_id: Optional[int] = None) -> None:
        with self.lock:
            self.conn.execute(
                "INSERT INTO events (event_type, payload_json, created_at, user_id) VALUES (?, ?, ?, ?)",
                (event_type, json.dumps(payload), now_iso(), user_id),
            )
            self.conn.commit()

    def list_events(self, limit: int = 30, user_id: Optional[int] = None) -> List[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                rows = self.conn.execute(
                    "SELECT * FROM events ORDER BY id DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            else:
                rows = self.conn.execute(
                    "SELECT * FROM events WHERE user_id = ? ORDER BY id DESC LIMIT ?",
                    (user_id, limit),
                ).fetchall()
            return [self._row_to_dict(row) for row in rows]

    def top_played_tracks(self, user_id: Optional[int] = None, limit: int = 6) -> List[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                rows = self.conn.execute(
                    """
                    SELECT t.id, t.title, t.artist, t.bpm, t.camelot_key, t.note, t.energy, t.genre, COUNT(*) AS play_count
                    FROM plays p
                    JOIN tracks t ON t.id = p.track_id
                    WHERE p.track_id IS NOT NULL
                    GROUP BY t.id, t.title, t.artist, t.bpm, t.camelot_key, t.note, t.energy, t.genre
                    ORDER BY play_count DESC, MAX(p.id) DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            else:
                rows = self.conn.execute(
                    """
                    SELECT t.id, t.title, t.artist, t.bpm, t.camelot_key, t.note, t.energy, t.genre, COUNT(*) AS play_count
                    FROM plays p
                    JOIN tracks t ON t.id = p.track_id
                    WHERE p.track_id IS NOT NULL AND p.user_id = ?
                    GROUP BY t.id, t.title, t.artist, t.bpm, t.camelot_key, t.note, t.energy, t.genre
                    ORDER BY play_count DESC, MAX(p.id) DESC
                    LIMIT ?
                    """,
                    (user_id, limit),
                ).fetchall()
            return [dict(row) for row in rows]

    def create_profile(self, name: str, description: str, preferences: Dict[str, Any], user_id: Optional[int] = None) -> Dict[str, Any]:
        with self.lock:
            cur = self.conn.execute(
                "INSERT INTO profiles (name, description, preferences_json, created_at, user_id) VALUES (?, ?, ?, ?, ?)",
                (name, description, json.dumps(preferences), now_iso(), user_id),
            )
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM profiles WHERE id = ?", (cur.lastrowid,)).fetchone()
            return self._row_to_dict(row)

    def list_profiles(self, user_id: Optional[int] = None) -> List[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                rows = self.conn.execute("SELECT * FROM profiles ORDER BY id DESC").fetchall()
            else:
                rows = self.conn.execute("SELECT * FROM profiles WHERE user_id = ? ORDER BY id DESC", (user_id,)).fetchall()
            return [self._row_to_dict(row) for row in rows]

    def get_profile(self, profile_id: int, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                row = self.conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
            else:
                row = self.conn.execute("SELECT * FROM profiles WHERE id = ? AND user_id = ?", (profile_id, user_id)).fetchone()
            return self._row_to_dict(row) if row else None

    def start_session(self, name: str, profile_id: Optional[int], user_id: Optional[int] = None) -> Dict[str, Any]:
        with self.lock:
            if user_id is None:
                self.conn.execute("UPDATE sessions SET status = 'ended', ended_at = ? WHERE status = 'active'", (now_iso(),))
            else:
                self.conn.execute(
                    "UPDATE sessions SET status = 'ended', ended_at = ? WHERE status = 'active' AND user_id = ?",
                    (now_iso(), user_id),
                )
            cur = self.conn.execute(
                "INSERT INTO sessions (profile_id, name, started_at, status, user_id) VALUES (?, ?, ?, 'active', ?)",
                (profile_id, name, now_iso(), user_id),
            )
            self.conn.commit()
            row = self.conn.execute("SELECT * FROM sessions WHERE id = ?", (cur.lastrowid,)).fetchone()
            return dict(row)

    def end_session(self, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                row = self.conn.execute("SELECT * FROM sessions WHERE status = 'active' ORDER BY id DESC LIMIT 1").fetchone()
            else:
                row = self.conn.execute(
                    "SELECT * FROM sessions WHERE status = 'active' AND user_id = ? ORDER BY id DESC LIMIT 1",
                    (user_id,),
                ).fetchone()
            if not row:
                return None
            self.conn.execute("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?", (now_iso(), row["id"]))
            self.conn.commit()
            done = self.conn.execute("SELECT * FROM sessions WHERE id = ?", (row["id"],)).fetchone()
            return dict(done)

    def current_session(self, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                row = self.conn.execute("SELECT * FROM sessions WHERE status = 'active' ORDER BY id DESC LIMIT 1").fetchone()
            else:
                row = self.conn.execute(
                    "SELECT * FROM sessions WHERE status = 'active' AND user_id = ? ORDER BY id DESC LIMIT 1",
                    (user_id,),
                ).fetchone()
            return dict(row) if row else None

    def get_session(self, session_id: int, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self.lock:
            if user_id is None:
                row = self.conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
            else:
                row = self.conn.execute("SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id)).fetchone()
            return dict(row) if row else None

    def history_summary(self, user_id: Optional[int] = None) -> Dict[str, Any]:
        with self.lock:
            if user_id is None:
                transitions = self.conn.execute("SELECT compatibility FROM transitions").fetchall()
                plays_count = self.conn.execute("SELECT COUNT(*) AS c FROM plays").fetchone()["c"]
                events_count = self.conn.execute("SELECT COUNT(*) AS c FROM events").fetchone()["c"]
                external_saved_count = self.conn.execute("SELECT COUNT(*) AS c FROM external_lists").fetchone()["c"]
            else:
                transitions = self.conn.execute("SELECT compatibility FROM transitions WHERE user_id = ?", (user_id,)).fetchall()
                plays_count = self.conn.execute("SELECT COUNT(*) AS c FROM plays WHERE user_id = ?", (user_id,)).fetchone()["c"]
                events_count = self.conn.execute("SELECT COUNT(*) AS c FROM events WHERE user_id = ?", (user_id,)).fetchone()["c"]
                external_saved_count = self.conn.execute("SELECT COUNT(*) AS c FROM external_lists WHERE user_id = ?", (user_id,)).fetchone()["c"]
            transitions_count = len(transitions)
            avg_compat = float(np.mean([row["compatibility"] for row in transitions])) if transitions else 0.0
            return {
                "averageCompatibility": round(avg_compat, 2),
                "transitionsCount": transitions_count,
                "playsCount": plays_count,
                "eventsCount": events_count,
                "externalSavedCount": external_saved_count,
            }

    def export_session_bundle(self, session_id: int, user_id: Optional[int] = None) -> Dict[str, Any]:
        with self.lock:
            if user_id is None:
                session_row = self.conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
            else:
                session_row = self.conn.execute("SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id)).fetchone()
            if not session_row:
                raise ValueError("Session not found")
            session = dict(session_row)

            transitions_rows = self.conn.execute(
                """
                SELECT t.*, ta.title AS track_a_title, ta.artist AS track_a_artist,
                       tb.title AS track_b_title, tb.artist AS track_b_artist
                FROM transitions t
                JOIN tracks ta ON ta.id = t.track_a_id
                JOIN tracks tb ON tb.id = t.track_b_id
                WHERE t.session_id = ?
                ORDER BY t.id ASC
                """,
                (session_id,),
            ).fetchall()

            plays_rows = self.conn.execute(
                """
                SELECT p.*, tr.title AS track_title, tr.artist AS track_artist
                FROM plays p
                LEFT JOIN tracks tr ON tr.id = p.track_id
                WHERE p.session_id = ?
                ORDER BY p.id ASC
                """,
                (session_id,),
            ).fetchall()

            return {
                "session": session,
                "transitions": [
                    {
                        "id": row["id"],
                        "compatibility": row["compatibility"],
                        "difficulty": row["difficulty"],
                        "trackA": f"{row['track_a_artist']} - {row['track_a_title']}",
                        "trackB": f"{row['track_b_artist']} - {row['track_b_title']}",
                        "createdAt": row["created_at"],
                        "analysis": json.loads(row["analysis_json"]),
                    }
                    for row in transitions_rows
                ],
                "plays": [
                    {
                        "id": row["id"],
                        "source": row["source"],
                        "track": f"{row['track_artist'] or 'Unknown'} - {row['track_title'] or 'Unknown'}",
                        "playedAt": row["played_at"],
                        "extra": json.loads(row["extra_json"]),
                    }
                    for row in plays_rows
                ],
            }


class AIService:
    def __init__(self) -> None:
        self.openai_model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        self.local_model = "maya-audio-ml-v2"
        self.client: Optional[OpenAI] = None
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            self.client = OpenAI(api_key=api_key)

    @property
    def remote_enabled(self) -> bool:
        return self.client is not None

    def status(self, test_remote: bool = False) -> Dict[str, Any]:
        status = {
            "localModel": self.local_model,
            "localModelActive": True,
            "openaiEnabled": self.remote_enabled,
            "openaiModel": self.openai_model if self.remote_enabled else None,
            "openaiConnected": False,
            "openaiMessage": "OPENAI_API_KEY not configured",
        }
        if not self.remote_enabled:
            return status

        if not test_remote:
            status["openaiConnected"] = True
            status["openaiMessage"] = "Configured (connection not ping-tested)"
            return status

        try:
            response = self.client.responses.create(
                model=self.openai_model,
                input="Reply with: ok",
                max_output_tokens=4,
            )
            text = (response.output_text or "").strip().lower()
            status["openaiConnected"] = "ok" in text
            status["openaiMessage"] = f"Ping response: {text or 'empty'}"
        except Exception as exc:  # noqa: BLE001
            status["openaiConnected"] = False
            status["openaiMessage"] = f"Ping failed: {exc}"
        return status

    def transition_tips(self, track_a: Dict[str, Any], track_b: Dict[str, Any], analysis: Dict[str, Any]) -> List[str]:
        local_tips = list(analysis.get("coach", []))
        if not self.remote_enabled:
            return local_tips

        try:
            prompt = {
                "trackA": {
                    "title": track_a["title"],
                    "artist": track_a["artist"],
                    "bpm": track_a["bpm"],
                    "key": track_a["camelot_key"] or track_a["musical_key"],
                    "energy": track_a["energy"],
                },
                "trackB": {
                    "title": track_b["title"],
                    "artist": track_b["artist"],
                    "bpm": track_b["bpm"],
                    "key": track_b["camelot_key"] or track_b["musical_key"],
                    "energy": track_b["energy"],
                },
                "compatibility": analysis["compatibility"],
                "difficulty": analysis["difficulty"],
                "breakdown": analysis["breakdown"],
            }

            response = self.client.responses.create(
                model=self.openai_model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            "You are Maya Mixa live transition coach. Return exactly 3 concise coaching tips, "
                            "one per line. No numbering."
                        ),
                    },
                    {"role": "user", "content": json.dumps(prompt)},
                ],
                max_output_tokens=180,
                temperature=0.2,
            )
            lines = [line.strip("- •\t ") for line in (response.output_text or "").splitlines() if line.strip()]
            if lines:
                return lines[:3] + local_tips[:2]
        except Exception:
            pass
        return local_tips

    def external_track_estimate(self, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.remote_enabled:
            return None

        try:
            response = self.client.responses.create(
                model=self.openai_model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            "You are an assistant for DJs. Return strict JSON with keys: "
                            "bpm (number), camelot_key (string), musical_key (string), energy (number 1-10), "
                            "note (number 1-10), genre (string), tags (array of strings), mood_tags (array of strings), "
                            "confidence (number 0-1). Keep confidence low if unsure."
                        ),
                    },
                    {"role": "user", "content": json.dumps(metadata)},
                ],
                temperature=0.1,
                max_output_tokens=260,
            )
            text = (response.output_text or "").strip()
            if not text:
                return None
            start = text.find("{")
            end = text.rfind("}")
            if start < 0 or end < 0 or end <= start:
                return None
            payload = json.loads(text[start : end + 1])
            return {
                "bpm": float(payload.get("bpm", 0.0)) if payload.get("bpm") is not None else None,
                "camelot_key": str(payload.get("camelot_key", "")).strip(),
                "musical_key": str(payload.get("musical_key", "")).strip(),
                "energy": clamp(float(payload.get("energy", 0.0)), 1.0, 10.0),
                "note": clamp(float(payload.get("note", 0.0)), 1.0, 10.0),
                "genre": str(payload.get("genre", "")).strip(),
                "tags": [str(tag) for tag in payload.get("tags", []) if str(tag).strip()],
                "mood_tags": [str(tag) for tag in payload.get("mood_tags", []) if str(tag).strip()],
                "confidence": clamp(float(payload.get("confidence", 0.0)), 0.0, 1.0),
            }
        except Exception:
            return None


class AudioAnalyzer:
    NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    CAMELOT_MAP = {
        "Ab minor": "1A", "G# minor": "1A", "Eb minor": "2A", "D# minor": "2A",
        "Bb minor": "3A", "A# minor": "3A", "F minor": "4A", "C minor": "5A",
        "G minor": "6A", "D minor": "7A", "A minor": "8A", "E minor": "9A",
        "B minor": "10A", "F# minor": "11A", "Gb minor": "11A", "C# minor": "12A", "Db minor": "12A",
        "B major": "1B", "F# major": "2B", "Gb major": "2B", "Db major": "3B", "C# major": "3B",
        "Ab major": "4B", "G# major": "4B", "Eb major": "5B", "D# major": "5B", "Bb major": "6B",
        "A# major": "6B", "F major": "7B", "C major": "8B", "G major": "9B", "D major": "10B",
        "A major": "11B", "E major": "12B",
    }

    def __init__(self, ai_service: AIService) -> None:
        self.ai_service = ai_service

    def _read_metadata(self, path: Path) -> Tuple[str, str, str]:
        title, artist = parse_title_artist_from_filename(path)
        album = ""
        try:
            meta = MutagenFile(str(path), easy=True)
            if meta:
                title = (meta.get("title") or [title])[0]
                artist = (meta.get("artist") or [artist])[0]
                album = (meta.get("album") or [""])[0]
        except Exception:
            pass
        return title, artist, album

    def _detect_key(self, y_harmonic: np.ndarray, sr: int) -> Tuple[str, str, float]:
        chroma = librosa.feature.chroma_cqt(y=y_harmonic, sr=sr)
        chroma_vector = np.mean(chroma, axis=1)

        best_score = -10.0
        best_note = "C"
        best_mode = "major"

        for root in range(12):
            profile_major = np.roll(self.MAJOR_PROFILE, root)
            profile_minor = np.roll(self.MINOR_PROFILE, root)
            score_major = float(np.corrcoef(chroma_vector, profile_major)[0, 1])
            score_minor = float(np.corrcoef(chroma_vector, profile_minor)[0, 1])
            if score_major > best_score:
                best_score = score_major
                best_note = self.NOTE_NAMES[root]
                best_mode = "major"
            if score_minor > best_score:
                best_score = score_minor
                best_note = self.NOTE_NAMES[root]
                best_mode = "minor"

        key_name = f"{best_note} {best_mode}"
        camelot = self.CAMELOT_MAP.get(key_name, "")
        return key_name, camelot, clamp((best_score + 1.0) * 0.5, 0.0, 1.0)

    def _infer_genre_and_tags(self, bpm: float, energy: float, melodic: float, bass: float, brightness: float) -> Tuple[str, List[str]]:
        tags: List[str] = []

        if bpm >= 129 and energy >= 7.5:
            genre = "hard techno"
            tags.extend(["peak-time", "warehouse", "raw"])
        elif melodic >= 7.0 and bpm <= 126:
            genre = "melodic techno"
            tags.extend(["journey", "atmospheric", "emotional"])
        elif 122 <= bpm <= 126 and energy < 6.9:
            genre = "progressive house"
            tags.extend(["warmup", "groove", "deep"])
        else:
            genre = "techno"
            tags.extend(["driving", "main-room"])

        if bass >= 8:
            tags.append("sub-heavy")
        if brightness >= 7:
            tags.append("bright")
        if energy >= 8.3:
            tags.append("high-energy")
        if melodic >= 8:
            tags.append("melodic")

        unique_tags = sorted(set(tags))
        return genre, unique_tags

    def analyze_file(self, path: Path) -> Dict[str, Any]:
        title, artist, album = self._read_metadata(path)
        y, sr = librosa.load(str(path), sr=22050, mono=True, duration=420.0)
        if y.size == 0:
            raise ValueError("Empty audio payload")

        duration = float(sf.info(str(path)).duration)
        tempo = float(librosa.feature.tempo(y=y, sr=sr, aggregate=np.median)[0])
        y_harmonic, y_percussive = librosa.effects.hpss(y)

        rms = librosa.feature.rms(y=y)[0]
        onset_strength = librosa.onset.onset_strength(y=y_percussive, sr=sr)
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr)[0]

        n_fft = 2048
        spectrum = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=512))
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
        low_mask = (freqs >= 20) & (freqs <= 180)
        bass_ratio = float(np.mean(spectrum[low_mask]) / (np.mean(spectrum) + 1e-9))

        chroma = librosa.feature.chroma_cqt(y=y_harmonic, sr=sr)
        melodic_density = float(np.mean(np.std(chroma, axis=1)))

        musical_key, camelot_key, key_confidence = self._detect_key(y_harmonic, sr)

        energy = clamp(float(np.mean(rms) * 120), 1.0, 10.0)
        bass = clamp(bass_ratio * 10.5, 1.0, 10.0)
        percussion = clamp(float(np.mean(onset_strength) / 3.8), 1.0, 10.0)
        melodic = clamp(melodic_density * 40, 1.0, 10.0)
        brightness = clamp(float(np.mean(centroid) / 1000), 1.0, 10.0)
        groove = clamp(float(np.std(onset_strength) / 6), 1.0, 10.0)
        danceability = clamp((tempo / 128.0) * 4.4 + percussion * 0.36 + groove * 0.35, 1.0, 10.0)

        note = clamp(
            energy * 0.25 + bass * 0.2 + percussion * 0.18 + melodic * 0.22 + danceability * 0.15,
            1.0,
            10.0,
        )

        genre, tags = self._infer_genre_and_tags(tempo, energy, melodic, bass, brightness)

        confidence = clamp((key_confidence * 0.35 + min(1.0, np.mean(rms) * 8) * 0.25 + min(1.0, np.std(onset_strength) / 8) * 0.4), 0.0, 1.0)

        return {
            "file_path": str(path),
            "file_hash": compute_sha1(path),
            "title": title,
            "artist": artist,
            "album": album,
            "duration": round(duration, 2),
            "bpm": round(tempo, 2),
            "musical_key": musical_key,
            "camelot_key": camelot_key,
            "energy": round(energy, 2),
            "note": round(note, 2),
            "genre": genre,
            "tags": tags,
            "features": {
                "bass": round(bass, 2),
                "melodic": round(melodic, 2),
                "percussion": round(percussion, 2),
                "brightness": round(brightness, 2),
                "groove": round(groove, 2),
                "danceability": round(danceability, 2),
                "key_confidence": round(float(key_confidence), 3),
                "analysis_confidence": round(float(confidence), 3),
                "rms_mean": round(float(np.mean(rms)), 6),
                "onset_mean": round(float(np.mean(onset_strength)), 6),
                "rolloff_mean": round(float(np.mean(rolloff)), 2),
            },
        }


class MusicMetadataHub:
    ITUNES_ENDPOINT = "https://itunes.apple.com/search"
    DEEZER_ENDPOINT = "https://api.deezer.com/search"
    MUSICBRAINZ_ENDPOINT = "https://musicbrainz.org/ws/2/recording"

    def __init__(self) -> None:
        self.timeout = 8.0

    def search(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        if not query.strip():
            return []
        source_count = 3
        per_source_limit = max(5, min(40, int(np.ceil(limit / source_count)) + 4))
        sources = [
            self._search_itunes(query, limit=per_source_limit),
            self._search_deezer(query, limit=per_source_limit),
            self._search_musicbrainz(query, limit=per_source_limit),
        ]

        merged: List[Dict[str, Any]] = []
        seen_ids = set()
        seen_titles = set()

        if not any(sources):
            return []

        max_rows = max(len(rows) for rows in sources)
        for idx in range(max_rows):
            for source_rows in sources:
                if idx >= len(source_rows):
                    continue
                row = source_rows[idx]
                key = f"{row['source']}::{row['source_track_id']}"
                if key in seen_ids:
                    continue
                signature = "|".join(
                    [
                        re.sub(r"[^a-z0-9]+", "", str(row.get("artist") or "").lower()),
                        re.sub(r"[^a-z0-9]+", "", str(row.get("title") or "").lower()),
                        re.sub(r"[^a-z0-9]+", "", str(row.get("version") or "").lower()),
                    ]
                )
                if signature and signature in seen_titles:
                    continue
                seen_ids.add(key)
                if signature:
                    seen_titles.add(signature)
                merged.append(row)
                if len(merged) >= limit:
                    return merged
        return merged

    def search_itunes_catalog(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        return self._search_itunes(query, limit=limit)

    def _search_itunes(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        try:
            with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
                response = client.get(
                    self.ITUNES_ENDPOINT,
                    params={"term": query, "entity": "song", "limit": max(5, min(limit, 50))},
                    headers={"User-Agent": "MayaMixa/2.3"},
                )
                response.raise_for_status()
                payload = response.json()
        except Exception:
            return []

        rows = []
        for item in payload.get("results", []):
            track_id = str(item.get("trackId") or item.get("collectionId") or "")
            if not track_id:
                continue
            title = (item.get("trackName") or item.get("trackCensoredName") or "").strip()
            artist = (item.get("artistName") or "").strip()
            if not title:
                continue
            version = ""
            collection = item.get("collectionName") or ""
            if collection and collection.lower() not in title.lower():
                version = collection

            rows.append(
                {
                    "source": "itunes",
                    "source_track_id": track_id,
                    "source_url": item.get("trackViewUrl") or "",
                    "title": title,
                    "artist": artist or "Unknown Artist",
                    "version": version,
                    "duration": round((item.get("trackTimeMillis") or 0) / 1000.0, 2) if item.get("trackTimeMillis") else None,
                    "genre": (item.get("primaryGenreName") or "").strip().lower(),
                    "metadata": {
                        "album": item.get("collectionName") or "",
                        "preview_url": item.get("previewUrl") or "",
                        "release_date": item.get("releaseDate") or "",
                        "raw_genre": item.get("primaryGenreName") or "",
                    },
                }
            )
        return rows

    def _search_deezer(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        try:
            with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
                response = client.get(
                    self.DEEZER_ENDPOINT,
                    params={"q": query, "limit": max(5, min(limit, 50))},
                    headers={"User-Agent": "MayaMixa/2.5"},
                )
                response.raise_for_status()
                payload = response.json()
        except Exception:
            return []

        rows: List[Dict[str, Any]] = []
        for item in payload.get("data", []):
            track_id = str(item.get("id") or "")
            if not track_id:
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            artist_payload = item.get("artist") or {}
            artist = str(artist_payload.get("name") or "").strip() or "Unknown Artist"
            album_payload = item.get("album") or {}
            rows.append(
                {
                    "source": "deezer",
                    "source_track_id": track_id,
                    "source_url": item.get("link") or "",
                    "title": title,
                    "artist": artist,
                    "version": str(album_payload.get("title") or "").strip(),
                    "duration": float(item.get("duration")) if item.get("duration") else None,
                    "genre": "electronic" if "techno" in query.lower() or "house" in query.lower() else "",
                    "metadata": {
                        "album": album_payload.get("title") or "",
                        "preview_url": item.get("preview") or "",
                        "rank": item.get("rank"),
                        "explicit_lyrics": item.get("explicit_lyrics", False),
                    },
                }
            )
        return rows

    def _search_musicbrainz(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        try:
            with httpx.Client(timeout=self.timeout, follow_redirects=True) as client:
                response = client.get(
                    self.MUSICBRAINZ_ENDPOINT,
                    params={"query": query, "fmt": "json", "limit": max(5, min(limit, 30))},
                    headers={"User-Agent": "MayaMixa/2.5 (support@maya-mixa.local)"},
                )
                response.raise_for_status()
                payload = response.json()
        except Exception:
            return []

        rows: List[Dict[str, Any]] = []
        for item in payload.get("recordings", []):
            track_id = str(item.get("id") or "").strip()
            if not track_id:
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            artist_credit = item.get("artist-credit") or []
            artist = ""
            if artist_credit and isinstance(artist_credit, list):
                first_credit = artist_credit[0] or {}
                artist = str(first_credit.get("name") or "").strip()
            artist = artist or "Unknown Artist"
            releases = item.get("releases") or []
            release_title = ""
            if releases and isinstance(releases, list):
                release_title = str((releases[0] or {}).get("title") or "").strip()
            tags_payload = item.get("tags") or []
            tag_values = [str(tag.get("name") or "").strip().lower() for tag in tags_payload if isinstance(tag, dict)]
            rows.append(
                {
                    "source": "musicbrainz",
                    "source_track_id": track_id,
                    "source_url": f"https://musicbrainz.org/recording/{quote_plus(track_id)}",
                    "title": title,
                    "artist": artist,
                    "version": release_title,
                    "duration": round(float(item.get("length", 0)) / 1000.0, 2) if item.get("length") else None,
                    "genre": next((tag for tag in tag_values if tag in {"techno", "house", "electronic", "trance"}), ""),
                    "metadata": {
                        "album": release_title,
                        "tag_count": len(tag_values),
                        "tags": tag_values[:10],
                        "disambiguation": item.get("disambiguation") or "",
                    },
                }
            )
        return rows


class ExternalTrackIntelligence:
    GENRE_BPM_HINTS = {
        "techno": 127.0,
        "melodic techno": 125.0,
        "hard techno": 131.0,
        "house": 124.0,
        "progressive house": 123.0,
        "trance": 132.0,
        "electronic": 126.0,
    }

    def __init__(self, ai_service: AIService) -> None:
        self.ai_service = ai_service

    @staticmethod
    def _stable_number(seed: str, min_val: float, max_val: float) -> float:
        digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()
        ratio = int(digest[:8], 16) / 0xFFFFFFFF
        return min_val + (max_val - min_val) * ratio

    def _heuristic_profile(self, meta: Dict[str, Any]) -> Dict[str, Any]:
        genre_hint = (meta.get("genre") or "electronic").lower()
        base_bpm = None
        for genre_key, bpm in self.GENRE_BPM_HINTS.items():
            if genre_key in genre_hint:
                base_bpm = bpm
                break
        if base_bpm is None:
            base_bpm = 126.0

        seed = f"{meta.get('artist','')}-{meta.get('title','')}-{meta.get('source_track_id','')}"
        bpm = round(self._stable_number(seed + "bpm", base_bpm - 4.0, base_bpm + 4.0), 2)
        energy = round(self._stable_number(seed + "energy", 5.4, 8.9), 2)
        note = round(self._stable_number(seed + "note", 5.6, 8.7), 2)

        camelot_candidates = ["6A", "7A", "8A", "9A", "10A", "8B", "9B", "10B"]
        camelot = camelot_candidates[int(self._stable_number(seed + "key", 0, len(camelot_candidates) - 0.001))]
        musical = "Unknown"
        if camelot.endswith("A"):
            musical = "Minor"
        elif camelot.endswith("B"):
            musical = "Major"

        tags = []
        if "techno" in genre_hint:
            tags.extend(["club", "4x4", "dj-tool"])
        if energy >= 8.0:
            tags.append("peak-time")
        if energy <= 6.2:
            tags.append("warmup")

        mood_tags = ["dark" if energy >= 7.4 else "groovy", "driving" if bpm >= 126 else "rolling"]

        bass = clamp(energy + 0.8, 1, 10)
        melodic = clamp(11 - energy, 1, 10)
        percussion = clamp((bpm - 118) / 2.0, 1, 10)
        brightness = clamp(melodic * 0.9, 1, 10)
        groove = clamp((percussion + melodic) / 2.0, 1, 10)
        danceability = clamp((bpm / 128.0) * 4.4 + percussion * 0.36 + groove * 0.35, 1, 10)

        return {
            "bpm": bpm,
            "camelot_key": camelot,
            "musical_key": musical,
            "energy": energy,
            "note": note,
            "genre": genre_hint or "electronic",
            "tags": sorted(set(tags)),
            "mood_tags": sorted(set(mood_tags)),
            "confidence": 0.52,
            "features": {
                "bass": round(bass, 2),
                "melodic": round(melodic, 2),
                "percussion": round(percussion, 2),
                "brightness": round(brightness, 2),
                "groove": round(groove, 2),
                "danceability": round(danceability, 2),
                "analysis_confidence": 0.52,
                "source": "heuristic",
            },
        }

    def enrich(self, meta: Dict[str, Any], deep: bool = False) -> Dict[str, Any]:
        heuristic = self._heuristic_profile(meta)
        if not deep:
            return heuristic

        estimated = self.ai_service.external_track_estimate(meta)
        if not estimated:
            heuristic["features"]["source"] = "heuristic-fallback"
            return heuristic

        bpm = estimated.get("bpm") or heuristic["bpm"]
        energy = estimated.get("energy") or heuristic["energy"]
        note = estimated.get("note") or heuristic["note"]

        bass = clamp(energy + 0.7, 1, 10)
        melodic = clamp(10.5 - energy, 1, 10)
        percussion = clamp((bpm - 118) / 2.2, 1, 10)
        brightness = clamp((melodic + 1.5), 1, 10)
        groove = clamp((percussion + melodic) / 2.0, 1, 10)
        danceability = clamp((bpm / 128.0) * 4.4 + percussion * 0.36 + groove * 0.35, 1, 10)

        return {
            "bpm": round(float(bpm), 2),
            "camelot_key": estimated.get("camelot_key") or heuristic["camelot_key"],
            "musical_key": estimated.get("musical_key") or heuristic["musical_key"],
            "energy": round(float(energy), 2),
            "note": round(float(note), 2),
            "genre": estimated.get("genre") or heuristic["genre"],
            "tags": sorted(set(estimated.get("tags") or heuristic["tags"])),
            "mood_tags": sorted(set(estimated.get("mood_tags") or heuristic["mood_tags"])),
            "confidence": round(float(estimated.get("confidence") or 0.62), 3),
            "features": {
                "bass": round(bass, 2),
                "melodic": round(melodic, 2),
                "percussion": round(percussion, 2),
                "brightness": round(brightness, 2),
                "groove": round(groove, 2),
                "danceability": round(danceability, 2),
                "analysis_confidence": round(float(estimated.get("confidence") or 0.62), 3),
                "source": "openai-estimate",
            },
        }


def parse_camelot(camelot: str) -> Optional[Tuple[int, str]]:
    match = re.match(r"^(\d{1,2})([AB])$", camelot.strip(), re.IGNORECASE)
    if not match:
        return None
    num = int(match.group(1))
    mode = match.group(2).upper()
    return num, mode


def harmonic_score(key_a: str, key_b: str) -> float:
    a = parse_camelot(key_a)
    b = parse_camelot(key_b)
    if not a or not b:
        return 0.45

    if a == b:
        return 1.0

    num_a, mode_a = a
    num_b, mode_b = b
    clockwise = (num_a % 12) + 1
    anticlockwise = ((num_a + 10) % 12) + 1

    if num_a == num_b and mode_a != mode_b:
        return 0.9
    if mode_a == mode_b and (num_b == clockwise or num_b == anticlockwise):
        return 0.86
    if mode_a != mode_b and (num_b == clockwise or num_b == anticlockwise):
        return 0.74
    return 0.38


def analyze_transition(track_a: Dict[str, Any], track_b: Dict[str, Any], ai_service: AIService) -> Dict[str, Any]:
    bpm_a = float(track_a.get("bpm") or 0.0)
    bpm_b = float(track_b.get("bpm") or 0.0)
    if bpm_a <= 0:
        bpm_a = 124.0
    if bpm_b <= 0:
        bpm_b = 124.0

    bpm_diff = abs(bpm_a - bpm_b)
    bpm_score = clamp(1.0 - (bpm_diff / 8.0), 0.22, 1.0)

    key_score = harmonic_score(track_a.get("camelot_key", ""), track_b.get("camelot_key", ""))

    energy_a = float(track_a.get("energy") or 5.5)
    energy_b = float(track_b.get("energy") or 5.5)
    energy_score = clamp(1.0 - abs((energy_b - energy_a) - 0.45) / 4.2, 0.3, 1.0)

    fa = track_a.get("features") or {}
    fb = track_b.get("features") or {}
    vec_a = np.array(
        [
            float(fa.get("bass", 5.0)),
            float(fa.get("melodic", 5.0)),
            float(fa.get("percussion", 5.0)),
            float(fa.get("brightness", 5.0)),
            float(fa.get("groove", 5.0)),
        ],
        dtype=np.float64,
    )
    vec_b = np.array(
        [
            float(fb.get("bass", 5.0)),
            float(fb.get("melodic", 5.0)),
            float(fb.get("percussion", 5.0)),
            float(fb.get("brightness", 5.0)),
            float(fb.get("groove", 5.0)),
        ],
        dtype=np.float64,
    )
    similarity = float(np.dot(vec_a, vec_b) / ((np.linalg.norm(vec_a) * np.linalg.norm(vec_b)) + 1e-9))
    timbre_score = clamp(similarity, 0.2, 1.0)

    score = clamp(bpm_score * 0.31 + key_score * 0.28 + energy_score * 0.22 + timbre_score * 0.19, 0.05, 1.0)
    compatibility = round(score * 100, 2)
    difficulty = "easy" if compatibility >= 86 else "medium" if compatibility >= 72 else "hard"

    duration_a = float(track_a.get("duration") or 360.0)
    start_b = max(18, int(duration_a * 0.42))
    phrase_16 = max(8, int((16 * 60) / bpm_a))
    mix_point = min(int(duration_a - 8), start_b + phrase_16)
    drop_align = mix_point + max(8, int((16 * 60) / bpm_b))

    coach = []
    if bpm_score < 0.7:
        coach.append("Large tempo gap: lock kick transients first, then blend EQ.")
    else:
        coach.append("Tempo lanes align: use a short beatmatch entry.")

    if key_score < 0.72:
        coach.append("Harmonic tension is high: keep overlap short and filtered.")
    else:
        coach.append("Harmonic relation is clean: melodic overlap is safe.")

    if energy_score < 0.7:
        coach.append("Energy handoff is uneven: use percussion-first transition.")
    else:
        coach.append("Energy flow is balanced: full-spectrum handoff is safe.")

    coach.append(f"Start B at ~{start_b}s, commit mix around {mix_point}s, align drop near {drop_align}s.")

    result = {
        "compatibility": compatibility,
        "difficulty": difficulty,
        "mixPoints": {
            "startB": start_b,
            "mixPoint": mix_point,
            "dropAlign": drop_align,
        },
        "breakdown": {
            "bpm": round(bpm_score * 100, 1),
            "key": round(key_score * 100, 1),
            "energy": round(energy_score * 100, 1),
            "timbre": round(timbre_score * 100, 1),
        },
        "coach": coach,
        "ai": {
            "localModel": ai_service.local_model,
            "openaiUsed": False,
        },
    }

    remote_tips = ai_service.transition_tips(track_a, track_b, result)
    if remote_tips and remote_tips != coach:
        result["coach"] = remote_tips
        result["ai"]["openaiUsed"] = True
    return result


def external_track_to_runtime(external: Dict[str, Any]) -> Dict[str, Any]:
    intelligence = external.get("intelligence") or {}
    features = intelligence.get("features") or {}
    return {
        "id": external.get("id"),
        "title": external.get("title"),
        "artist": external.get("artist"),
        "duration": external.get("duration") or 360.0,
        "bpm": external.get("bpm") or 124.0,
        "musical_key": external.get("musical_key") or "",
        "camelot_key": external.get("camelot_key") or "",
        "energy": external.get("energy") or 5.8,
        "note": external.get("note") or 6.0,
        "genre": external.get("genre") or "electronic",
        "tags": external.get("tags") or [],
        "features": {
            "bass": float(features.get("bass", 5.0)),
            "melodic": float(features.get("melodic", 5.0)),
            "percussion": float(features.get("percussion", 5.0)),
            "brightness": float(features.get("brightness", 5.0)),
            "groove": float(features.get("groove", 5.0)),
            "danceability": float(features.get("danceability", 5.0)),
            "analysis_confidence": float(features.get("analysis_confidence", external.get("confidence") or 0.5)),
        },
    }


class SeratoBridge:
    def __init__(self, db: Database, analyzer: AudioAnalyzer, user_id: Optional[int] = None) -> None:
        self.db = db
        self.analyzer = analyzer
        self.user_id = user_id
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.worker: Optional[threading.Thread] = None
        self.config: Dict[str, Any] = {}
        self.state: Dict[str, Any] = {
            "status": "disconnected",
            "mode": "none",
            "lastError": "",
            "lastSeen": None,
            "deckA": None,
            "deckB": None,
        }
        self.history_offsets: Dict[str, int] = {}

    def get_state(self) -> Dict[str, Any]:
        with self.lock:
            return json.loads(json.dumps(self.state))

    def connect(self, mode: str, ws_url: str = "", history_path: str = "", feed_path: str = "") -> Dict[str, Any]:
        self.disconnect()
        with self.lock:
            self.config = {
                "mode": mode,
                "ws_url": ws_url,
                "history_path": history_path,
                "feed_path": feed_path,
            }
            self.state["mode"] = mode
            self.state["status"] = "connecting"
            self.state["lastError"] = ""

        if mode == "push":
            with self.lock:
                self.state["status"] = "connected"
            self.db.add_event(
                "serato.connect",
                {"mode": mode, "ws_url": ws_url, "history_path": history_path, "feed_path": feed_path},
                user_id=self.user_id,
            )
            return self.get_state()

        self.stop_event.clear()
        self.worker = threading.Thread(target=self._run, daemon=True)
        self.worker.start()
        self.db.add_event(
            "serato.connect",
            {"mode": mode, "ws_url": ws_url, "history_path": history_path, "feed_path": feed_path},
            user_id=self.user_id,
        )
        return self.get_state()

    def disconnect(self) -> Dict[str, Any]:
        self.stop_event.set()
        if self.worker and self.worker.is_alive():
            self.worker.join(timeout=1.0)
        with self.lock:
            self.state["status"] = "disconnected"
            self.state["mode"] = "none"
        return self.get_state()

    def _run(self) -> None:
        mode = self.config.get("mode")
        try:
            if mode == "websocket":
                self._run_websocket_mode(self.config.get("ws_url", ""))
            elif mode == "history":
                self._run_history_mode(self.config.get("history_path", ""))
            elif mode == "feed_file":
                self._run_feed_file_mode(self.config.get("feed_path", ""))
            elif mode == "push":
                while not self.stop_event.is_set():
                    time.sleep(0.5)
            else:
                raise ValueError("Unsupported bridge mode")
        except Exception as exc:  # noqa: BLE001
            with self.lock:
                self.state["status"] = "error"
                self.state["lastError"] = str(exc)
            self.db.add_event("serato.error", {"error": str(exc), "mode": mode}, user_id=self.user_id)

    def _set_connected(self) -> None:
        with self.lock:
            self.state["status"] = "connected"

    def _touch_seen(self) -> None:
        with self.lock:
            self.state["lastSeen"] = now_iso()

    def _run_websocket_mode(self, ws_url: str) -> None:
        if not ws_url:
            raise ValueError("ws_url is required for websocket mode")

        self._set_connected()

        def on_message(_: Any, message: str) -> None:
            try:
                payload = json.loads(message)
                self._handle_payload(payload, source="websocket")
            except Exception as exc:  # noqa: BLE001
                self.db.add_event("serato.payload_error", {"error": str(exc), "raw": message[:500]}, user_id=self.user_id)

        def on_error(_: Any, error: Any) -> None:
            with self.lock:
                self.state["lastError"] = str(error)

        ws_app = websocket.WebSocketApp(ws_url, on_message=on_message, on_error=on_error)

        while not self.stop_event.is_set():
            ws_app.run_forever(ping_interval=20, ping_timeout=10)
            if self.stop_event.is_set():
                break
            time.sleep(2)

    def _run_history_mode(self, history_path: str) -> None:
        if not history_path:
            raise ValueError("history_path is required for history mode")

        base = Path(history_path).expanduser()
        if not base.exists():
            raise ValueError(f"History path does not exist: {base}")

        self._set_connected()

        while not self.stop_event.is_set():
            files = sorted([p for p in base.rglob("*") if p.is_file()], key=lambda x: x.stat().st_mtime, reverse=True)
            if not files:
                time.sleep(2)
                continue
            latest = files[0]
            offset = self.history_offsets.get(str(latest), 0)
            with latest.open("r", errors="ignore") as handle:
                handle.seek(offset)
                new_content = handle.read()
                self.history_offsets[str(latest)] = handle.tell()

            lines = [line.strip() for line in new_content.splitlines() if line.strip()]
            for line in lines:
                self._parse_history_line(line)

            time.sleep(1.2)

    def _run_feed_file_mode(self, feed_path: str) -> None:
        if not feed_path:
            raise ValueError("feed_path is required for feed_file mode")

        file_path = Path(feed_path).expanduser()
        self._set_connected()
        last_mtime = 0.0

        while not self.stop_event.is_set():
            if not file_path.exists():
                time.sleep(1)
                continue
            stat = file_path.stat()
            if stat.st_mtime <= last_mtime:
                time.sleep(0.6)
                continue
            last_mtime = stat.st_mtime
            payload = json.loads(file_path.read_text())
            self._handle_payload(payload, source="feed_file")
            time.sleep(0.4)

    def _parse_history_line(self, line: str) -> None:
        payload: Dict[str, Any] = {}

        try:
            maybe_json = json.loads(line)
            if isinstance(maybe_json, dict):
                self._handle_payload(maybe_json, source="history")
                return
        except Exception:
            pass

        artist = ""
        title = ""
        if " - " in line:
            left, right = line.split(" - ", 1)
            artist = left.strip()
            title = right.strip()
        else:
            title = line[:200]
            artist = "Unknown Artist"

        payload["deck"] = "A"
        payload["track"] = {
            "title": title,
            "artist": artist,
        }
        self._handle_payload(payload, source="history")

    def _handle_payload(self, payload: Dict[str, Any], source: str) -> None:
        self._touch_seen()

        if "deckA" in payload or "deckB" in payload:
            if payload.get("deckA"):
                self._update_deck("A", payload["deckA"], source)
            if payload.get("deckB"):
                self._update_deck("B", payload["deckB"], source)
            return

        deck_name = payload.get("deck", "A")
        track = payload.get("track", payload)
        self._update_deck(deck_name, track, source)

    def ingest_payload(self, payload: Dict[str, Any], source: str = "push") -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("Payload must be an object")
        with self.lock:
            if self.state.get("status") in {"disconnected", "error"}:
                self.state["status"] = "connected"
            if self.state.get("mode") in {"none", ""}:
                self.state["mode"] = "push"
        self._handle_payload(payload, source=source or "push")
        return self.get_state()

    def _update_deck(self, deck: str, incoming: Dict[str, Any], source: str) -> None:
        track_path = str(incoming.get("path") or incoming.get("file_path") or "").strip()
        title = str(incoming.get("title") or incoming.get("name") or "").strip()
        artist = str(incoming.get("artist") or "Unknown Artist").strip()
        bpm = incoming.get("bpm")
        key = incoming.get("key")
        position = float(incoming.get("position") or 0.0)

        track_obj: Optional[Dict[str, Any]] = None

        if track_path:
            if self.user_id is not None:
                track_obj = self.db.get_track_by_path(track_path, user_id=self.user_id)
            else:
                track_obj = self.db.get_track_by_path(track_path)
            if not track_obj:
                track_obj = self.db.get_track_by_path(track_path)
            if not track_obj and Path(track_path).exists():
                analyzed = self.analyzer.analyze_file(Path(track_path))
                track_obj = self.db.upsert_track(analyzed)
            if track_obj and self.user_id is not None:
                self.db.link_user_track(self.user_id, int(track_obj["id"]))

        if not track_obj and title:
            if self.user_id is not None:
                track_obj = self.db.find_track(title, artist, user_id=self.user_id)
            else:
                track_obj = self.db.find_track(title, artist)
            if not track_obj:
                track_obj = self.db.find_track(title, artist)
            if track_obj and self.user_id is not None:
                self.db.link_user_track(self.user_id, int(track_obj["id"]))

        payload = {
            "title": title or (track_obj["title"] if track_obj else "Unknown Track"),
            "artist": artist or (track_obj["artist"] if track_obj else "Unknown Artist"),
            "bpm": float(bpm if bpm is not None else (track_obj["bpm"] if track_obj else 0.0)),
            "key": key or (track_obj["camelot_key"] or track_obj["musical_key"] if track_obj else ""),
            "position": round(position, 2),
            "path": track_path,
            "track_id": track_obj["id"] if track_obj else None,
            "note": track_obj["note"] if track_obj else None,
            "energy": track_obj["energy"] if track_obj else None,
        }

        deck_key = "deckA" if deck.upper() == "A" else "deckB"
        with self.lock:
            previous = self.state.get(deck_key)
            changed = not previous or previous.get("track_id") != payload.get("track_id") or previous.get("title") != payload.get("title")
            self.state[deck_key] = payload

        if changed:
            current_session = self.db.current_session(user_id=self.user_id)
            session_id = current_session["id"] if current_session else None
            self.db.add_play(
                session_id,
                payload.get("track_id"),
                f"serato:{source}:{deck_key}",
                payload,
                user_id=self.user_id,
            )
            self.db.add_event("serato.track_change", {"deck": deck_key, "payload": payload}, user_id=self.user_id)


class SeratoBridgeManager:
    def __init__(self, db: Database, analyzer: AudioAnalyzer) -> None:
        self.db = db
        self.analyzer = analyzer
        self.lock = threading.Lock()
        self.bridges: Dict[int, SeratoBridge] = {}

    @staticmethod
    def _empty_state() -> Dict[str, Any]:
        return {
            "status": "disconnected",
            "mode": "none",
            "lastError": "",
            "lastSeen": None,
            "deckA": None,
            "deckB": None,
        }

    def _get_or_create(self, user_id: int) -> SeratoBridge:
        with self.lock:
            bridge = self.bridges.get(user_id)
            if bridge is None:
                bridge = SeratoBridge(self.db, self.analyzer, user_id=user_id)
                self.bridges[user_id] = bridge
            return bridge

    def connect(self, user_id: int, mode: str, ws_url: str = "", history_path: str = "", feed_path: str = "") -> Dict[str, Any]:
        bridge = self._get_or_create(user_id)
        return bridge.connect(mode=mode, ws_url=ws_url, history_path=history_path, feed_path=feed_path)

    def disconnect(self, user_id: int) -> Dict[str, Any]:
        with self.lock:
            bridge = self.bridges.get(user_id)
        if not bridge:
            return self._empty_state()
        return bridge.disconnect()

    def get_state(self, user_id: int) -> Dict[str, Any]:
        with self.lock:
            bridge = self.bridges.get(user_id)
        if not bridge:
            return self._empty_state()
        return bridge.get_state()

    def ingest(self, user_id: int, payload: Dict[str, Any], source: str = "push") -> Dict[str, Any]:
        bridge = self._get_or_create(user_id)
        return bridge.ingest_payload(payload, source=source)


def resolve_library_scan_path(raw_path: str) -> Path:
    path = Path(raw_path).expanduser().resolve()
    if LIBRARY_SCAN_ROOT:
        root = Path(LIBRARY_SCAN_ROOT).expanduser().resolve()
        try:
            path.relative_to(root)
        except ValueError:
            raise HTTPException(
                status_code=403,
                detail=f"Path must be inside configured scan root: {root}",
            )
    return path


class LibraryScanJobManager:
    def __init__(self, db: Database, analyzer: AudioAnalyzer) -> None:
        self.db = db
        self.analyzer = analyzer
        self.lock = threading.Lock()
        self.cv = threading.Condition(self.lock)
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.queue: deque[Tuple[str, int, str, bool, int]] = deque()
        self.worker = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker.start()

    def _snapshot(self, job: Dict[str, Any]) -> Dict[str, Any]:
        return json.loads(json.dumps(job))

    def create_job(self, user_id: int, path: str, recursive: bool, limit: int) -> Dict[str, Any]:
        job_id = "scan_" + secrets.token_urlsafe(8)
        job = {
            "id": job_id,
            "user_id": user_id,
            "status": "queued",
            "path": path,
            "recursive": bool(recursive),
            "limit": int(limit),
            "created_at": now_iso(),
            "started_at": None,
            "ended_at": None,
            "message": "Queued",
            "processed": 0,
            "candidates": 0,
            "analyzed": 0,
            "errors_count": 0,
            "errors": [],
            "truncated": False,
        }
        with self.cv:
            self.jobs[job_id] = job
            self.queue.append((job_id, user_id, path, bool(recursive), int(limit)))
            self.cv.notify()
            return self._snapshot(job)

    def get_job(self, user_id: int, job_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or int(job["user_id"]) != int(user_id):
                return None
            return self._snapshot(job)

    def _worker_loop(self) -> None:
        while True:
            with self.cv:
                while not self.queue:
                    self.cv.wait()
                job_id, user_id, path, recursive, limit = self.queue.popleft()
            self._run_job(job_id, user_id, path, recursive, limit)

    def _run_job(self, job_id: str, user_id: int, path: str, recursive: bool, limit: int) -> None:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return
            job["status"] = "running"
            job["started_at"] = now_iso()
            job["message"] = "Scanning audio files..."

        try:
            scan_path = Path(path)
            candidates: List[Path] = []
            if scan_path.is_file():
                if scan_path.suffix.lower() in AUDIO_EXTENSIONS:
                    candidates.append(scan_path)
            else:
                iterator = scan_path.rglob("*") if recursive else scan_path.glob("*")
                for entry in iterator:
                    if entry.is_file() and entry.suffix.lower() in AUDIO_EXTENSIONS:
                        candidates.append(entry)

            candidates = sorted(candidates)
            if limit > 0:
                candidates = candidates[:limit]

            truncated = False
            if len(candidates) > LIBRARY_SCAN_MAX_FILES:
                candidates = candidates[:LIBRARY_SCAN_MAX_FILES]
                truncated = True

            analyzed_count = 0
            errors: List[Dict[str, Any]] = []

            with self.lock:
                job = self.jobs.get(job_id)
                if not job:
                    return
                job["candidates"] = len(candidates)
                job["truncated"] = truncated
                job["message"] = "Analyzing tracks..."

            for idx, file_path in enumerate(candidates, start=1):
                try:
                    existing = self.db.get_track_by_path(str(file_path))
                    file_hash = compute_sha1(file_path)
                    if existing and existing["file_hash"] == file_hash:
                        self.db.link_user_track(user_id, int(existing["id"]))
                        analyzed_count += 1
                    else:
                        track_data = self.analyzer.analyze_file(file_path)
                        saved = self.db.upsert_track(track_data)
                        self.db.link_user_track(user_id, int(saved["id"]))
                        analyzed_count += 1
                except Exception as exc:  # noqa: BLE001
                    errors.append({"file": str(file_path), "error": str(exc)})

                if idx == len(candidates) or idx % 5 == 0:
                    with self.lock:
                        job = self.jobs.get(job_id)
                        if not job:
                            return
                        job["processed"] = idx
                        job["analyzed"] = analyzed_count
                        job["errors_count"] = len(errors)
                        job["errors"] = errors[:50]

            with self.lock:
                job = self.jobs.get(job_id)
                if not job:
                    return
                job["status"] = "completed"
                job["ended_at"] = now_iso()
                job["processed"] = len(candidates)
                job["analyzed"] = analyzed_count
                job["errors_count"] = len(errors)
                job["errors"] = errors[:50]
                job["message"] = "Scan completed"

            self.db.add_event(
                "library.scan",
                {
                    "path": path,
                    "count": len(candidates),
                    "analyzed": analyzed_count,
                    "errors": len(errors),
                    "job_id": job_id,
                    "truncated": truncated,
                },
                user_id=user_id,
            )
        except Exception as exc:  # noqa: BLE001
            with self.lock:
                job = self.jobs.get(job_id)
                if job:
                    job["status"] = "failed"
                    job["ended_at"] = now_iso()
                    job["message"] = str(exc)
            self.db.add_event("library.scan_error", {"job_id": job_id, "error": str(exc)}, user_id=user_id)


ai_service = AIService()
analyzer = AudioAnalyzer(ai_service)
db = Database(DB_PATH)
serato_bridges = SeratoBridgeManager(db, analyzer)
scan_jobs = LibraryScanJobManager(db, analyzer)
music_hub = MusicMetadataHub()
external_intelligence = ExternalTrackIntelligence(ai_service)


def build_default_track_payload(template: Dict[str, Any], index: int) -> Dict[str, Any]:
    artist_slug = re.sub(r"[^a-z0-9]+", "-", str(template.get("artist") or "").strip().lower()).strip("-")
    title_slug = re.sub(r"[^a-z0-9]+", "-", str(template.get("title") or "").strip().lower()).strip("-")
    slug = "-".join(part for part in [artist_slug, title_slug] if part) or f"seed-{index}"
    virtual_path = f"virtual://maya-default-library/{slug}.mp3"
    features = dict(template.get("features") or {})
    features.setdefault("analysis_confidence", 0.9)
    return {
        "file_path": virtual_path,
        "file_hash": hashlib.sha1(virtual_path.encode("utf-8")).hexdigest(),
        "title": str(template.get("title") or f"Track {index}"),
        "artist": str(template.get("artist") or "Unknown Artist"),
        "album": str(template.get("album") or "Maya Default Crate"),
        "duration": float(template.get("duration") or 360.0),
        "bpm": float(template.get("bpm") or 124.0),
        "musical_key": str(template.get("musical_key") or "A minor"),
        "camelot_key": str(template.get("camelot_key") or "8A"),
        "energy": float(template.get("energy") or 6.5),
        "note": float(template.get("note") or 7.0),
        "genre": str(template.get("genre") or "techno"),
        "tags": [str(tag) for tag in template.get("tags", []) if str(tag).strip()],
        "features": features,
    }


def ensure_default_library_for_user(user_id: int) -> Dict[str, Any]:
    try:
        existing = db.list_tracks(limit=1, user_id=user_id)
    except Exception:
        existing = []
    if existing:
        return {"seeded": False, "count": len(existing)}

    created = 0
    for idx, template in enumerate(DEFAULT_LIBRARY_TEMPLATES, start=1):
        payload = build_default_track_payload(template, idx)
        track = db.upsert_track(payload)
        db.link_user_track(user_id, int(track["id"]))
        created += 1

    if created:
        db.add_event("library.seed_default", {"count": created}, user_id=user_id)
    return {"seeded": created > 0, "count": created}


def enforce_user_library_seed_policy(user: Dict[str, Any]) -> Dict[str, Any]:
    user_id = int(user["id"])
    role = str(user.get("role") or "dj").strip().lower()
    if role == "admin":
        if SEED_BOOTSTRAP_ADMIN_LIBRARY:
            return ensure_default_library_for_user(user_id)
        removed = db.unlink_virtual_default_tracks(user_id)
        if removed:
            db.add_event("library.seed_removed", {"count": removed, "policy": "admin_seed_disabled"}, user_id=user_id)
        return {"seeded": False, "removed": removed, "count": len(db.list_tracks(limit=1, user_id=user_id))}

    if SEED_NEW_USER_LIBRARY:
        return ensure_default_library_for_user(user_id)

    removed = db.unlink_virtual_default_tracks(user_id)
    if removed:
        db.add_event("library.seed_removed", {"count": removed, "policy": "new_user_seed_disabled"}, user_id=user_id)
    return {"seeded": False, "removed": removed, "count": len(db.list_tracks(limit=1, user_id=user_id))}


class ScanRequest(BaseModel):
    path: str = Field(..., description="Directory or file path")
    recursive: bool = True
    limit: int = 0


class TransitionRequest(BaseModel):
    track_a_id: int
    track_b_id: int


class ProfileRequest(BaseModel):
    name: str
    description: str = ""
    preferences: Dict[str, Any] = Field(default_factory=dict)


class SessionStartRequest(BaseModel):
    name: str = "Live Session"
    profile_id: Optional[int] = None


class SeratoConnectRequest(BaseModel):
    mode: str = Field(..., description="websocket | history | feed_file | push")
    ws_url: str = ""
    history_path: str = ""
    feed_path: str = ""


class SeratoPushRequest(BaseModel):
    payload: Dict[str, Any] = Field(default_factory=dict)
    source: str = "push"


class ExternalSaveRequest(BaseModel):
    list_name: str = "wishlist"
    action: str = "save"
    note: str = ""


class AuthRegisterRequest(BaseModel):
    email: str
    password: str = ""
    display_name: str
    dj_name: str = ""


class AuthLoginRequest(BaseModel):
    email: str
    password: str = ""


class AuthChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AuthForgotPasswordRequest(BaseModel):
    email: str


class AuthResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class AuthProfileUpdateRequest(BaseModel):
    display_name: str
    dj_name: str = ""
    preferences: Dict[str, Any] = Field(default_factory=dict)


class AdminUserUpdateRequest(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None


app = FastAPI(title="Maya Mixa Backend", version="2.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def apply_security_headers(request: Request, call_next: Any) -> Response:
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline'; "
        "connect-src 'self' http: https: ws: wss:; "
        "frame-ancestors 'none'"
    )
    return response


def to_public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user.get("display_name", ""),
        "dj_name": user.get("dj_name", ""),
        "role": user.get("role", "dj"),
        "status": user.get("status", "active"),
        "preferences": user.get("preferences", {}),
        "created_at": user.get("created_at"),
        "updated_at": user.get("updated_at"),
        "last_login_at": user.get("last_login_at"),
    }


def extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return parts[1].strip()


def get_current_user(authorization: Optional[str] = Header(default=None, alias="Authorization")) -> Dict[str, Any]:
    raw_token = extract_bearer_token(authorization)
    hashed = token_hash(raw_token)
    session = db.get_auth_session(hashed)
    if not session:
        raise HTTPException(status_code=401, detail="Session not found")
    if session.get("revoked_at"):
        raise HTTPException(status_code=401, detail="Session revoked")
    try:
        expires_at = parse_iso(session["expires_at"])
    except Exception:
        raise HTTPException(status_code=401, detail="Session invalid")
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get_user(int(session["user_id"]))
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=403, detail="User inactive")
    db.touch_auth_session(int(session["id"]))
    user["_session_token_hash"] = hashed
    return user


def require_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def create_auth_session_for_user(user: Dict[str, Any], request: Request) -> str:
    token = build_session_token()
    hashed = token_hash(token)
    db.create_auth_session(
        user_id=int(user["id"]),
        hashed_token=hashed,
        user_agent=request.headers.get("user-agent", ""),
        ip_address=(request.client.host if request.client else ""),
    )
    db.touch_user_login(int(user["id"]))
    return token


def ensure_user_from_oauth(provider: str, subject: str, email: str, display_name: str = "") -> Dict[str, Any]:
    provider_norm = provider.strip().lower()
    subject_norm = (subject or "").strip()
    email_norm = normalize_email(email or "")

    if subject_norm:
        identity = db.get_oauth_identity(provider_norm, subject_norm)
        if identity:
            user = db.get_user(int(identity["user_id"]))
            if user:
                return user

    user = db.get_user_by_email(email_norm) if email_norm else None
    if not user:
        if not email_norm:
            synthetic = f"{provider_norm}_{subject_norm or secrets.token_hex(6)}@oauth.maya-mixa.local"
            email_norm = normalize_email(synthetic)
        role = "admin" if len(db.list_users(limit=1)) == 0 else "dj"
        raw_password = "oauth_" + secrets.token_urlsafe(24)
        pw_hash, pw_salt = hash_password(raw_password)
        user = db.create_user(
            email=email_norm,
            password_hash_hex=pw_hash,
            password_salt_hex=pw_salt,
            display_name=display_name.strip() or email_norm.split("@")[0],
            dj_name=display_name.strip() or email_norm.split("@")[0],
            role=role,
            status="active",
            preferences={"authProvider": provider_norm, "oauthLinked": True},
        )
        try:
            db.create_profile(
                name=f"{user.get('dj_name') or user.get('display_name') or 'DJ'} Default",
                description=f"Default profile ({provider_norm} OAuth)",
                preferences={"genres": ["techno"], "energyTarget": 7.5},
                user_id=int(user["id"]),
            )
        except sqlite3.IntegrityError:
            pass

    if subject_norm:
        db.upsert_oauth_identity(
            provider=provider_norm,
            subject=subject_norm,
            user_id=int(user["id"]),
            email=email_norm or user.get("email", ""),
        )
    enforce_user_library_seed_policy(user)
    return user


def ensure_bootstrap_admin_account() -> None:
    if not BOOTSTRAP_ADMIN_ENABLED:
        return

    login_id = normalize_email(BOOTSTRAP_ADMIN_LOGIN or "admin")
    if not login_id:
        login_id = "admin"
    password = BOOTSTRAP_ADMIN_PASSWORD or "admin"
    pw_hash, pw_salt = hash_password(password)

    existing = db.get_user_by_email(login_id)
    if existing:
        db.update_user_password(int(existing["id"]), pw_hash, pw_salt)
        db.update_user_role_status(int(existing["id"]), role="admin", status="active")
        db.update_user_profile(
            user_id=int(existing["id"]),
            display_name=BOOTSTRAP_ADMIN_DISPLAY,
            dj_name=BOOTSTRAP_ADMIN_DJ_NAME,
            preferences=existing.get("preferences", {}),
        )
        if SEED_BOOTSTRAP_ADMIN_LIBRARY:
            ensure_default_library_for_user(int(existing["id"]))
        else:
            db.unlink_virtual_default_tracks(int(existing["id"]))
        db.add_event("auth.admin_bootstrap", {"email": login_id, "status": "updated"}, user_id=int(existing["id"]))
        return

    created = db.create_user(
        email=login_id,
        password_hash_hex=pw_hash,
        password_salt_hex=pw_salt,
        display_name=BOOTSTRAP_ADMIN_DISPLAY,
        dj_name=BOOTSTRAP_ADMIN_DJ_NAME,
        role="admin",
        status="active",
        preferences={"bootstrapAdmin": True},
    )
    try:
        db.create_profile(
            name=f"{BOOTSTRAP_ADMIN_DJ_NAME} Default",
            description="Administrator profile",
            preferences={"genres": ["techno"], "energyTarget": 7.5},
            user_id=int(created["id"]),
        )
    except sqlite3.IntegrityError:
        pass
    if SEED_BOOTSTRAP_ADMIN_LIBRARY:
        ensure_default_library_for_user(int(created["id"]))
    db.add_event("auth.admin_bootstrap", {"email": login_id, "status": "created"}, user_id=int(created["id"]))


def get_current_local_track(user_id: Optional[int] = None, bridge_state: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    if bridge_state is None:
        if user_id is None:
            return None
        bridge_state = serato_bridges.get_state(int(user_id))
    deck_a = bridge_state.get("deckA") or {}
    track_id = deck_a.get("track_id")
    if track_id:
        track = db.get_track(int(track_id), user_id=user_id)
        if track:
            return track
        global_track = db.get_track(int(track_id))
        if global_track and user_id is not None:
            db.link_user_track(user_id, int(track_id))
            return db.get_track(int(track_id), user_id=user_id) or global_track
    return None


def resolve_track_for_user(track_id: int, user_id: int, allow_link: bool = False) -> Optional[Dict[str, Any]]:
    owned = db.get_track(track_id, user_id=user_id)
    if owned:
        return owned
    global_track = db.get_track(track_id)
    if global_track and allow_link:
        db.link_user_track(user_id, track_id)
        return db.get_track(track_id, user_id=user_id) or global_track
    return None


def upsert_external_from_metadata(meta: Dict[str, Any], deep: bool = False) -> Dict[str, Any]:
    enriched = external_intelligence.enrich(meta, deep=deep)
    item = {
        "source": meta["source"],
        "source_track_id": str(meta["source_track_id"]),
        "source_url": meta.get("source_url") or "",
        "title": meta["title"],
        "artist": meta.get("artist") or "Unknown Artist",
        "version": meta.get("version") or "",
        "duration": meta.get("duration"),
        "bpm": enriched.get("bpm"),
        "musical_key": enriched.get("musical_key") or "",
        "camelot_key": enriched.get("camelot_key") or "",
        "energy": enriched.get("energy"),
        "note": enriched.get("note"),
        "genre": enriched.get("genre") or meta.get("genre") or "electronic",
        "tags": enriched.get("tags", []),
        "mood_tags": enriched.get("mood_tags", []),
        "confidence": enriched.get("confidence"),
        "metadata": {
            **(meta.get("metadata") or {}),
            "source": meta["source"],
            "source_track_id": str(meta["source_track_id"]),
        },
        "intelligence": {
            "features": enriched.get("features", {}),
            "deep": deep,
        },
    }
    return db.upsert_external_track(item)


def score_external_against_library(
    external_track: Dict[str, Any],
    limit: int = 5,
    user_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    local_tracks = db.list_tracks(limit=2000, user_id=user_id)
    runtime_external = external_track_to_runtime(external_track)
    scored = []
    for local in local_tracks:
        analysis = analyze_transition(local, runtime_external, ai_service)
        scored.append(
            {
                "track": local,
                "compatibility": analysis["compatibility"],
                "difficulty": analysis["difficulty"],
                "analysis": analysis,
            }
        )
    scored.sort(key=lambda row: row["compatibility"], reverse=True)
    return scored[:limit]


def session_elapsed_seconds(session: Optional[Dict[str, Any]]) -> int:
    if not session:
        return 0
    started_raw = str(session.get("started_at") or "").strip()
    if not started_raw:
        return 0
    try:
        started = parse_iso(started_raw)
        return max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
    except Exception:
        return 0


def build_profile_ai_tips(
    summary: Dict[str, Any],
    top_tracks: List[Dict[str, Any]],
    favorites: List[Dict[str, Any]],
    session: Optional[Dict[str, Any]],
) -> List[str]:
    tips: List[str] = []
    avg = float(summary.get("averageCompatibility") or 0.0)
    transitions_count = int(summary.get("transitionsCount") or 0)
    plays_count = int(summary.get("playsCount") or 0)

    if avg >= 88:
        tips.append("Ton flow harmonique est solide: garde des transitions longues sur les morceaux mélodiques.")
    elif avg >= 74:
        tips.append("Compatibilité correcte: verrouille la clé en priorité avant d’ouvrir les EQ médiums.")
    else:
        tips.append("Compatibilité basse: privilégie les transitions percussion-first et réduis le recouvrement.")

    if transitions_count < 5:
        tips.append("Analyse au moins 5 transitions pour stabiliser les recommandations IA du set.")
    else:
        tips.append(f"Tu as {transitions_count} transitions analysées: le modèle peut proposer des fenêtres de mix plus précises.")

    if top_tracks:
        lead = top_tracks[0]
        tips.append(
            f"Track signature actuel: {lead.get('artist', 'Unknown')} - {lead.get('title', 'Unknown')} ({int(lead.get('play_count') or 0)} plays)."
        )
    else:
        tips.append("Aucune track jouée dans cette session: lance le bridge Serato pour activer l’apprentissage live.")

    if favorites:
        tips.append("Tes favoris sont prêts: teste-les avec ‘Matches For Current Track’ avant le peak-time.")
    else:
        tips.append("Ajoute des morceaux en wishlist/prep crate pour personnaliser le moteur de set building.")

    if session:
        elapsed = session_elapsed_seconds(session)
        if elapsed >= 60 * 60:
            tips.append("Session longue détectée: prévois un reset énergétique progressif toutes les 45-60 minutes.")
        else:
            tips.append("Session en cours: garde 2 alternatives deck B en buffer pour éviter les trous de mix.")
    elif plays_count > 0:
        tips.append("Aucune session active. Démarre une session live pour historiser automatiquement tes choix DJ.")
    else:
        tips.append("Commence par jouer 2-3 tracks pour alimenter les recommandations personnalisées.")

    return tips[:6]


@app.get("/")
def root() -> FileResponse:
    return FileResponse(INDEX_PATH)


@app.get("/app.js")
def app_js() -> FileResponse:
    return FileResponse(APP_JS_PATH)


@app.get("/assets/{asset_path:path}")
def assets(asset_path: str) -> FileResponse:
    base = ASSETS_DIR.resolve()
    target = (ASSETS_DIR / asset_path).resolve()
    try:
        target.relative_to(base)
    except Exception:
        raise HTTPException(status_code=404, detail="Asset not found")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(target)


@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "timestamp": now_iso(),
        "db": str(DB_PATH),
        "tracks": len(db.list_tracks(limit=10000)),
        "externalTracks": len(db.list_external_tracks(limit=10000)),
    }


@app.get("/api/cloud/status")
def cloud_status(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    user_events = db.list_events(limit=1, user_id=user_id)
    user_tracks_count = len(db.list_tracks(limit=5000, user_id=user_id))
    persistent_target = APP_ENV == "production"
    data_path = str(DB_PATH)
    cloud_ready = bool(DB_PATH.exists())
    return {
        "cloud": {
            "environment": APP_ENV,
            "dbPath": data_path,
            "dbExists": cloud_ready,
            "persistentTarget": persistent_target,
            "renderDiskPathExpected": "/app/data/maya.db",
            "userTracksCount": user_tracks_count,
            "lastUserEventAt": user_events[0]["created_at"] if user_events else None,
        }
    }


@app.get("/api/ai/status")
def ai_status(test_remote: bool = Query(default=False)) -> Dict[str, Any]:
    return ai_service.status(test_remote=test_remote)


@app.get("/api/auth/config")
def auth_config() -> Dict[str, Any]:
    return {
        "auth": {
            "passwordless": AUTH_PASSWORDLESS,
            "identifierLabel": "ID de connexion DJ" if AUTH_PASSWORDLESS else "Email",
            "passwordRecoveryEnabled": not AUTH_PASSWORDLESS,
        }
    }


@app.post("/api/auth/register")
def auth_register(payload: AuthRegisterRequest, request: Request) -> Dict[str, Any]:
    login_id = normalize_email(payload.email)
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit("auth_register_ip", client_ip, max_hits=20, window_seconds=60)
    enforce_rate_limit("auth_register_email", login_id or "unknown", max_hits=5, window_seconds=60 * 10)
    if not validate_login_identifier(login_id):
        if AUTH_PASSWORDLESS:
            raise HTTPException(status_code=400, detail="Invalid login id")
        raise HTTPException(status_code=400, detail="Invalid email")
    if not AUTH_PASSWORDLESS and len(payload.password or "") < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name is required")
    dj_name = payload.dj_name.strip() or display_name
    if db.get_user_by_email(login_id):
        raise HTTPException(status_code=409, detail="Login already registered")

    role = "admin" if len(db.list_users(limit=1)) == 0 else "dj"
    registration_password = payload.password or ""
    if AUTH_PASSWORDLESS:
        registration_password = "pwless_" + secrets.token_urlsafe(24)
    pw_hash, pw_salt = hash_password(registration_password)
    try:
        user = db.create_user(
            email=login_id,
            password_hash_hex=pw_hash,
            password_salt_hex=pw_salt,
            display_name=display_name,
            dj_name=dj_name,
            role=role,
            status="active",
            preferences={"genres": ["techno", "melodic techno"], "energyTarget": 7.5},
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Login already registered")

    try:
        db.create_profile(
            name=f"{dj_name} Default",
            description="Personal default profile",
            preferences={"genres": ["techno", "melodic techno"], "energyTarget": 7.5},
            user_id=user["id"],
        )
    except sqlite3.IntegrityError:
        pass
    enforce_user_library_seed_policy(user)

    token = build_session_token()
    hashed = token_hash(token)
    db.create_auth_session(
        user_id=user["id"],
        hashed_token=hashed,
        user_agent=request.headers.get("user-agent", ""),
        ip_address=(request.client.host if request.client else ""),
    )
    db.touch_user_login(user["id"])
    db.add_event("auth.register", {"email": login_id, "role": role, "passwordless": AUTH_PASSWORDLESS}, user_id=user["id"])
    user = db.get_user(user["id"]) or user
    return {"token": token, "user": to_public_user(user)}


@app.post("/api/auth/login")
def auth_login(payload: AuthLoginRequest, request: Request) -> Dict[str, Any]:
    login_id = normalize_email(payload.email)
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit("auth_login_ip", client_ip, max_hits=30, window_seconds=60)
    enforce_rate_limit("auth_login_email", login_id or "unknown", max_hits=10, window_seconds=60 * 5)
    user = db.get_user_by_email(login_id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("status") != "active":
        raise HTTPException(status_code=403, detail="User inactive")
    if not AUTH_PASSWORDLESS and not verify_password(payload.password or "", user["password_hash"], user["password_salt"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    enforce_user_library_seed_policy(user)

    token = build_session_token()
    hashed = token_hash(token)
    db.create_auth_session(
        user_id=user["id"],
        hashed_token=hashed,
        user_agent=request.headers.get("user-agent", ""),
        ip_address=(request.client.host if request.client else ""),
    )
    db.touch_user_login(user["id"])
    db.add_event("auth.login", {"email": login_id, "passwordless": AUTH_PASSWORDLESS}, user_id=user["id"])
    user = db.get_user(user["id"]) or user
    return {"token": token, "user": to_public_user(user)}


@app.get("/api/auth/oauth/providers")
def auth_oauth_providers(request: Request) -> Dict[str, Any]:
    google = oauth_provider_config("google", request)
    apple = oauth_provider_config("apple", request)
    return {
        "providers": {
            "google": {
                "configured": bool(google["configured"]),
                "start_url": "/api/auth/oauth/google/start",
            },
            "apple": {
                "configured": bool(apple["configured"]),
                "start_url": "/api/auth/oauth/apple/start",
            },
        }
    }


@app.get("/api/auth/oauth/{provider}/start")
def auth_oauth_start(provider: str, request: Request) -> RedirectResponse:
    provider_norm = provider.strip().lower()
    if provider_norm not in {"google", "apple"}:
        raise HTTPException(status_code=404, detail="Unknown OAuth provider")

    config = oauth_provider_config(provider_norm, request)
    if not config["configured"]:
        raise HTTPException(status_code=503, detail=f"{provider_norm.title()} OAuth is not configured")

    state_token = build_oauth_state(provider_norm)
    if provider_norm == "google":
        params = {
            "client_id": config["client_id"],
            "redirect_uri": config["redirect_uri"],
            "response_type": "code",
            "scope": "openid email profile",
            "state": state_token,
            "prompt": "select_account",
        }
        target = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    else:
        params = {
            "client_id": config["client_id"],
            "redirect_uri": config["redirect_uri"],
            "response_type": "code id_token",
            "response_mode": "form_post",
            "scope": "name email",
            "state": state_token,
            "nonce": secrets.token_urlsafe(12),
        }
        target = "https://appleid.apple.com/auth/authorize?" + urlencode(params)
    return RedirectResponse(target, status_code=302)


@app.api_route("/api/auth/oauth/{provider}/callback", methods=["GET", "POST"])
async def auth_oauth_callback(
    provider: str,
    request: Request,
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
) -> RedirectResponse:
    provider_norm = provider.strip().lower()
    if provider_norm not in {"google", "apple"}:
        raise HTTPException(status_code=404, detail="Unknown OAuth provider")

    incoming_code = (code or "").strip()
    incoming_state = (state or "").strip()
    incoming_error = (error or "").strip()
    if request.method.upper() == "POST":
        form = await request.form()
        incoming_code = incoming_code or str(form.get("code", "")).strip()
        incoming_state = incoming_state or str(form.get("state", "")).strip()
        incoming_error = incoming_error or str(form.get("error", "")).strip()

    if incoming_error:
        redirect_url = oauth_frontend_redirect(request, error=f"{provider_norm}:{incoming_error}")
        return RedirectResponse(redirect_url, status_code=302)
    if not incoming_code or not incoming_state:
        redirect_url = oauth_frontend_redirect(request, error=f"{provider_norm}:missing_code_or_state")
        return RedirectResponse(redirect_url, status_code=302)
    if not validate_oauth_state(provider_norm, incoming_state):
        redirect_url = oauth_frontend_redirect(request, error=f"{provider_norm}:invalid_state")
        return RedirectResponse(redirect_url, status_code=302)

    config = oauth_provider_config(provider_norm, request)
    if not config["configured"]:
        redirect_url = oauth_frontend_redirect(request, error=f"{provider_norm}:not_configured")
        return RedirectResponse(redirect_url, status_code=302)

    try:
        with httpx.Client(timeout=12, follow_redirects=True) as http:
            if provider_norm == "google":
                token_response = http.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": incoming_code,
                        "client_id": config["client_id"],
                        "client_secret": config["client_secret"],
                        "redirect_uri": config["redirect_uri"],
                        "grant_type": "authorization_code",
                    },
                )
                token_response.raise_for_status()
                token_payload = token_response.json()
                id_claims = decode_jwt_payload(str(token_payload.get("id_token") or ""))
                email = normalize_email(str(id_claims.get("email") or ""))
                name = str(id_claims.get("name") or "").strip()
                subject = str(id_claims.get("sub") or "").strip()

                if (not email or not subject) and token_payload.get("access_token"):
                    userinfo_response = http.get(
                        "https://openidconnect.googleapis.com/v1/userinfo",
                        headers={"Authorization": f"Bearer {token_payload['access_token']}"},
                    )
                    userinfo_response.raise_for_status()
                    profile = userinfo_response.json()
                    if not email:
                        email = normalize_email(str(profile.get("email") or ""))
                    if not name:
                        name = str(profile.get("name") or "").strip()
                    if not subject:
                        subject = str(profile.get("sub") or "").strip()
            else:
                token_response = http.post(
                    "https://appleid.apple.com/auth/token",
                    data={
                        "code": incoming_code,
                        "client_id": config["client_id"],
                        "client_secret": config["client_secret"],
                        "redirect_uri": config["redirect_uri"],
                        "grant_type": "authorization_code",
                    },
                )
                token_response.raise_for_status()
                token_payload = token_response.json()
                id_claims = decode_jwt_payload(str(token_payload.get("id_token") or ""))
                email = normalize_email(str(id_claims.get("email") or ""))
                name = str(id_claims.get("name") or "").strip()
                subject = str(id_claims.get("sub") or "").strip()
    except Exception:
        redirect_url = oauth_frontend_redirect(request, error=f"{provider_norm}:token_exchange_failed")
        return RedirectResponse(redirect_url, status_code=302)

    if not email and not subject:
        redirect_url = oauth_frontend_redirect(request, error=f"{provider_norm}:missing_identity")
        return RedirectResponse(redirect_url, status_code=302)

    user = ensure_user_from_oauth(provider_norm, subject=subject, email=email, display_name=name)
    if user.get("status") != "active":
        redirect_url = oauth_frontend_redirect(request, error=f"{provider_norm}:user_inactive")
        return RedirectResponse(redirect_url, status_code=302)

    auth_token = create_auth_session_for_user(user, request)
    db.add_event(
        "auth.oauth_login",
        {"provider": provider_norm, "user_id": int(user["id"]), "email": user.get("email", "")},
        user_id=int(user["id"]),
    )
    redirect_url = oauth_frontend_redirect(request, auth_token=auth_token, provider=provider_norm)
    return RedirectResponse(redirect_url, status_code=302)


@app.post("/api/auth/forgot-password")
def auth_forgot_password(payload: AuthForgotPasswordRequest, request: Request) -> Dict[str, Any]:
    if AUTH_PASSWORDLESS:
        raise HTTPException(status_code=400, detail="Password recovery disabled in passwordless mode")
    generic_message = "If this email exists, a reset message was sent."
    email = normalize_email(payload.email or "")
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit("auth_forgot_ip", client_ip, max_hits=20, window_seconds=60)
    enforce_rate_limit("auth_forgot_email", email or "unknown", max_hits=6, window_seconds=60 * 10)
    if not email or not validate_email(email):
        return {"ok": True, "message": generic_message}

    user = db.get_user_by_email(email)
    if not user or user.get("status") != "active":
        return {"ok": True, "message": generic_message}

    raw_reset_token = build_reset_token()
    hashed = token_hash(raw_reset_token)
    db.create_password_reset_token(int(user["id"]), hashed)
    sent, delivery_message = send_password_reset_email(email, raw_reset_token, user.get("dj_name", ""))
    db.add_event(
        "auth.forgot_password",
        {"email": email, "email_sent": bool(sent), "delivery_message": delivery_message},
        user_id=int(user["id"]),
    )

    if sent or not ALLOW_DEBUG_RESET_TOKEN:
        return {"ok": True, "message": generic_message}
    return {"ok": True, "message": generic_message, "debug_reset_token": raw_reset_token, "delivery": "debug"}


@app.post("/api/auth/reset-password")
def auth_reset_password(payload: AuthResetPasswordRequest, request: Request) -> Dict[str, Any]:
    if AUTH_PASSWORDLESS:
        raise HTTPException(status_code=400, detail="Password reset disabled in passwordless mode")
    token = (payload.token or "").strip()
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit("auth_reset_ip", client_ip, max_hits=20, window_seconds=60)
    enforce_rate_limit("auth_reset_token", token[:24] if token else "missing", max_hits=6, window_seconds=60 * 10)
    if not token:
        raise HTTPException(status_code=400, detail="Reset token is required")
    if len(payload.new_password or "") < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    hashed = token_hash(token)
    reset_row = db.get_password_reset_token(hashed)
    if not reset_row:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    if reset_row.get("used_at"):
        raise HTTPException(status_code=400, detail="Reset token already used")
    try:
        expires_at = parse_iso(str(reset_row["expires_at"]))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset token expired")

    user = db.get_user(int(reset_row["user_id"]))
    if not user or user.get("status") != "active":
        raise HTTPException(status_code=403, detail="User inactive")

    pw_hash, pw_salt = hash_password(payload.new_password)
    db.update_user_password(int(user["id"]), pw_hash, pw_salt)
    db.revoke_user_sessions(int(user["id"]))
    db.mark_password_reset_token_used(int(reset_row["id"]))
    db.add_event("auth.reset_password", {"user_id": user["id"]}, user_id=int(user["id"]))
    return {"ok": True, "message": "Password reset successful"}


@app.get("/api/auth/me")
def auth_me(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return {"user": to_public_user(user)}


@app.post("/api/auth/logout")
def auth_logout(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    hashed = user.get("_session_token_hash")
    if hashed:
        db.revoke_auth_session(hashed)
    db.add_event("auth.logout", {"user_id": user["id"]}, user_id=user["id"])
    return {"ok": True}


@app.post("/api/auth/change-password")
def auth_change_password(payload: AuthChangePasswordRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if AUTH_PASSWORDLESS:
        raise HTTPException(status_code=400, detail="Password changes disabled in passwordless mode")
    enforce_rate_limit("auth_change_password_user", str(user["id"]), max_hits=8, window_seconds=60 * 10)
    if not verify_password(payload.current_password or "", user["password_hash"], user["password_salt"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password or "") < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="New password must be different")

    pw_hash, pw_salt = hash_password(payload.new_password)
    db.update_user_password(user["id"], pw_hash, pw_salt)
    db.revoke_user_sessions(user["id"], except_token_hash=user.get("_session_token_hash", ""))
    db.add_event("auth.change_password", {"user_id": user["id"]}, user_id=user["id"])
    return {"ok": True}


@app.put("/api/auth/profile")
def auth_update_profile(payload: AuthProfileUpdateRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="display_name is required")
    updated = db.update_user_profile(
        user_id=user["id"],
        display_name=display_name,
        dj_name=payload.dj_name,
        preferences=payload.preferences,
    )
    db.add_event("auth.update_profile", {"user_id": user["id"]}, user_id=user["id"])
    return {"user": to_public_user(updated)}


@app.get("/api/auth/users")
def auth_list_users(query: str = "", limit: int = 100, _: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    rows = db.list_users(query=query, limit=max(1, min(limit, 500)))
    return {"users": [to_public_user(row) for row in rows]}


@app.patch("/api/auth/users/{target_user_id}")
def auth_update_user(target_user_id: int, payload: AdminUserUpdateRequest, _: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    role = payload.role.strip() if payload.role else None
    status = payload.status.strip() if payload.status else None
    if role and role not in {"admin", "dj"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    if status and status not in {"active", "disabled"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    try:
        updated = db.update_user_role_status(target_user_id, role=role, status=status)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found")
    return {"user": to_public_user(updated)}


@app.post("/api/library/scan")
def scan_library(payload: ScanRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if not ENABLE_LIBRARY_SCAN:
        raise HTTPException(status_code=403, detail="Library scan is disabled in this environment")

    raw_path = (payload.path or "").strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="Path is required")

    input_path = resolve_library_scan_path(raw_path)
    if not input_path.exists():
        raise HTTPException(status_code=404, detail=f"Path does not exist: {input_path}")

    job = scan_jobs.create_job(
        user_id=int(user["id"]),
        path=str(input_path),
        recursive=bool(payload.recursive),
        limit=max(0, int(payload.limit)),
    )
    return {"job": job}


@app.get("/api/library/scan/jobs/{job_id}")
def library_scan_job_status(job_id: str, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    job = scan_jobs.get_job(int(user["id"]), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Scan job not found")
    return {"job": job}


@app.get("/api/library/tracks")
def list_tracks(query: str = "", limit: int = 200, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return {"tracks": db.list_tracks(query=query, limit=limit, user_id=int(user["id"]))}


@app.post("/api/library/apple/sync")
def sync_apple_catalog(
    seeds_limit: int = Query(default=12, ge=1, le=30),
    per_query_limit: int = Query(default=4, ge=1, le=12),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = int(user["id"])
    local_tracks = db.list_tracks(limit=max(10, seeds_limit), user_id=user_id)
    queries: List[str] = []
    for track in local_tracks[:seeds_limit]:
        artist = str(track.get("artist") or "").strip()
        title = str(track.get("title") or "").strip()
        query = " ".join(part for part in [artist, title] if part).strip()
        if query:
            queries.append(query)

    if not queries:
        fallback = str(user.get("dj_name") or user.get("display_name") or "melodic techno")
        queries = [f"{fallback} techno", "melodic techno", "peak time techno"]

    discovered = 0
    updated_ids = set()
    for query in queries:
        rows = music_hub.search_itunes_catalog(query, limit=per_query_limit)
        for item in rows:
            try:
                saved = upsert_external_from_metadata(item, deep=False)
                updated_ids.add(int(saved["id"]))
                discovered += 1
            except Exception:
                continue

    db.add_event(
        "library.apple_sync",
        {
            "queries": len(queries),
            "discovered": discovered,
            "uniqueExternalTracks": len(updated_ids),
        },
        user_id=user_id,
    )
    return {
        "ok": True,
        "queriesUsed": queries,
        "discovered": discovered,
        "uniqueExternalTracks": len(updated_ids),
        "source": "itunes-catalog",
    }


@app.get("/api/library/tracks/{track_id}")
def get_track(track_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    track = resolve_track_for_user(track_id, int(user["id"]), allow_link=True)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


@app.get("/api/search/unified")
def search_unified(q: str = Query(default="", min_length=1), limit: int = 20, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    local = db.list_tracks(query=q, limit=max(1, min(limit, 80)), user_id=user_id)

    external_rows: List[Dict[str, Any]] = []
    discovered = music_hub.search(q, limit=max(1, min(limit, 40)))
    for item in discovered:
        try:
            external_rows.append(upsert_external_from_metadata(item, deep=False))
        except Exception:
            continue

    if not external_rows:
        external_rows = db.list_external_tracks(query=q, limit=max(1, min(limit, 40)))

    current_track = get_current_local_track(user_id=user_id)
    enriched_rows = []
    for row in external_rows:
        entry = dict(row)
        if current_track:
            runtime = external_track_to_runtime(row)
            analysis = analyze_transition(current_track, runtime, ai_service)
            entry["current_track_compatibility"] = analysis["compatibility"]
            entry["current_track_difficulty"] = analysis["difficulty"]
        else:
            entry["current_track_compatibility"] = None
            entry["current_track_difficulty"] = None
        enriched_rows.append(entry)

    enriched_rows.sort(key=lambda r: (r.get("current_track_compatibility") or 0), reverse=True)

    return {
        "query": q,
        "local": local,
        "global": enriched_rows[:limit],
    }


@app.get("/api/external/lists")
def external_lists(
    list_name: str = "",
    limit: int = 200,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    return {"items": db.list_external_list_items(list_name=list_name, limit=limit, user_id=int(user["id"]))}


@app.get("/api/external/{external_id}")
def external_track_detail(
    external_id: int,
    deep: bool = False,
    matches_limit: int = 5,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = int(user["id"])
    row = db.get_external_track(external_id)
    if not row:
        raise HTTPException(status_code=404, detail="External track not found")

    if deep:
        metadata = {
            **dict(row.get("metadata") or {}),
            "source": row["source"],
            "source_track_id": row["source_track_id"],
            "source_url": row.get("source_url") or "",
            "title": row["title"],
            "artist": row["artist"],
            "version": row.get("version") or "",
            "duration": row.get("duration"),
            "bpm": row.get("bpm"),
            "musical_key": row.get("musical_key") or "",
            "camelot_key": row.get("camelot_key") or "",
            "genre": row.get("genre"),
        }
        row = upsert_external_from_metadata(metadata, deep=True)

    current_track = get_current_local_track(user_id=user_id)
    current_analysis = None
    if current_track:
        current_analysis = analyze_transition(current_track, external_track_to_runtime(row), ai_service)

    matches = score_external_against_library(row, limit=matches_limit, user_id=user_id)
    return {
        "external": row,
        "currentTrack": current_track,
        "currentCompatibility": current_analysis,
        "libraryMatches": matches,
    }


@app.get("/api/external/{external_id}/matches")
def external_track_matches(external_id: int, limit: int = 8, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    row = db.get_external_track(external_id)
    if not row:
        raise HTTPException(status_code=404, detail="External track not found")
    return {"matches": score_external_against_library(row, limit=limit, user_id=int(user["id"]))}


@app.get("/api/external/{external_id}/similar")
def external_track_similar(external_id: int, limit: int = 10, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    row = db.get_external_track(external_id)
    if not row:
        raise HTTPException(status_code=404, detail="External track not found")

    query = f"{row['artist']} {row['title']}"
    discovered = music_hub.search(query, limit=max(5, min(limit * 2, 30)))
    results = []
    for item in discovered:
        if item["source"] == row["source"] and str(item["source_track_id"]) == str(row["source_track_id"]):
            continue
        try:
            saved = upsert_external_from_metadata(item, deep=False)
            results.append(saved)
        except Exception:
            continue
        if len(results) >= limit:
            break
    return {"similar": results}


@app.post("/api/external/{external_id}/save")
def external_track_save(
    external_id: int,
    payload: ExternalSaveRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    row = db.get_external_track(external_id)
    if not row:
        raise HTTPException(status_code=404, detail="External track not found")
    user_id = int(user["id"])
    saved = db.add_external_list_item(
        external_track_id=external_id,
        list_name=(payload.list_name or "wishlist").strip() or "wishlist",
        action=(payload.action or "save").strip() or "save",
        note=payload.note or "",
        user_id=user_id,
    )
    db.add_event(
        "external.save",
        {
            "external_track_id": external_id,
            "title": row["title"],
            "artist": row["artist"],
            "list_name": payload.list_name,
            "action": payload.action,
        },
        user_id=user_id,
    )
    return {"saved": saved, "track": row}


@app.get("/api/recommendations/{track_id}")
def recommendations(track_id: int, limit: int = 6, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    current = resolve_track_for_user(track_id, user_id, allow_link=True)
    if not current:
        raise HTTPException(status_code=404, detail="Current track not found")

    tracks = db.list_tracks(limit=2000, user_id=user_id)
    candidates = [t for t in tracks if t["id"] != track_id]
    scored = []
    for candidate in candidates:
        analysis = analyze_transition(current, candidate, ai_service)
        scored.append(
            {
                "track": candidate,
                "compatibility": analysis["compatibility"],
                "difficulty": analysis["difficulty"],
                "breakdown": analysis["breakdown"],
            }
        )

    scored.sort(key=lambda item: item["compatibility"], reverse=True)
    return {"recommendations": scored[:limit]}


@app.post("/api/transition/analyze")
def transition_analyze(payload: TransitionRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    track_a = resolve_track_for_user(payload.track_a_id, user_id, allow_link=True)
    track_b = resolve_track_for_user(payload.track_b_id, user_id, allow_link=True)
    if not track_a or not track_b:
        raise HTTPException(status_code=404, detail="Track A or B not found")

    analysis = analyze_transition(track_a, track_b, ai_service)
    session = db.current_session(user_id=user_id)
    session_id = session["id"] if session else None
    saved = db.add_transition(session_id, track_a["id"], track_b["id"], analysis, user_id=user_id)
    db.add_event(
        "transition.analyze",
        {
            "trackA": track_a["title"],
            "trackB": track_b["title"],
            "compatibility": analysis["compatibility"],
            "difficulty": analysis["difficulty"],
        },
        user_id=user_id,
    )
    return {
        "transition": saved,
        "analysis": analysis,
        "trackA": track_a,
        "trackB": track_b,
    }


@app.get("/api/history/summary")
def history_summary(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    summary = db.history_summary(user_id=user_id)
    summary["events"] = db.list_events(limit=12, user_id=user_id)
    return summary


@app.get("/api/account/dashboard")
def account_dashboard(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    summary = db.history_summary(user_id=user_id)
    session = db.current_session(user_id=user_id)
    elapsed_seconds = session_elapsed_seconds(session)
    top_tracks = db.top_played_tracks(user_id=user_id, limit=6)
    favorites = db.list_external_list_items(list_name="wishlist", limit=10, user_id=user_id)
    prep_crate = db.list_external_list_items(list_name="prep_crate", limit=10, user_id=user_id)
    tips = build_profile_ai_tips(summary, top_tracks, favorites, session)
    cloud = cloud_status(user=user)["cloud"]
    return {
        "profile": to_public_user(user),
        "summary": summary,
        "session": {
            "active": bool(session),
            "name": session.get("name") if session else "",
            "startedAt": session.get("started_at") if session else None,
            "elapsedSeconds": elapsed_seconds,
            "elapsedLabel": f"{elapsed_seconds // 3600:02d}:{(elapsed_seconds % 3600) // 60:02d}:{elapsed_seconds % 60:02d}",
        },
        "favorites": {
            "wishlist": favorites,
            "prepCrate": prep_crate,
        },
        "topTracks": top_tracks,
        "aiTips": tips,
        "cloud": cloud,
    }


@app.get("/api/history/events")
def history_events(limit: int = 30, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return {"events": db.list_events(limit=limit, user_id=int(user["id"]))}


@app.get("/api/profiles")
def profiles(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return {"profiles": db.list_profiles(user_id=int(user["id"]))}


@app.post("/api/profiles")
def create_profile(payload: ProfileRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    try:
        profile = db.create_profile(payload.name, payload.description, payload.preferences, user_id=int(user["id"]))
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Profile name already exists")
    return profile


@app.get("/api/sessions/current")
def current_session(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return {"session": db.current_session(user_id=int(user["id"]))}


@app.post("/api/sessions/start")
def start_session(payload: SessionStartRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    if payload.profile_id is not None and not db.get_profile(payload.profile_id, user_id=user_id):
        raise HTTPException(status_code=404, detail="Profile not found")
    session = db.start_session(payload.name, payload.profile_id, user_id=user_id)
    db.add_event("session.start", session, user_id=user_id)
    return session


@app.post("/api/sessions/end")
def end_session(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    session = db.end_session(user_id=user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active session")
    db.add_event("session.end", session, user_id=user_id)
    return session


@app.get("/api/serato/capabilities")
def serato_capabilities() -> Dict[str, Any]:
    return {
        "modes": [
            {
                "mode": "websocket",
                "ready": True,
                "requires": ["ws_url", "local bridge/feed from Serato runtime"],
                "realTime": True,
            },
            {
                "mode": "history",
                "ready": True,
                "requires": ["history_path", "access to local Serato history files"],
                "realTime": False,
            },
            {
                "mode": "feed_file",
                "ready": True,
                "requires": ["feed_path", "JSON writer from your local adapter"],
                "realTime": True,
            },
            {
                "mode": "push",
                "ready": True,
                "requires": ["POST /api/serato/push payloads from local DJ runtime"],
                "realTime": True,
            },
        ],
        "nativeSeratoPlugin": False,
        "note": "Maya Mixa expects a local adapter/runtime feed for Serato deck telemetry. For cloud use push mode.",
    }


@app.post("/api/serato/connect")
def serato_connect(payload: SeratoConnectRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if payload.mode not in {"websocket", "history", "feed_file", "push"}:
        raise HTTPException(status_code=400, detail="mode must be websocket, history, feed_file, or push")
    user_id = int(user["id"])
    state = serato_bridges.connect(user_id, payload.mode, payload.ws_url, payload.history_path, payload.feed_path)
    db.add_event("serato.connect_user", {"mode": payload.mode}, user_id=int(user["id"]))
    return state


@app.post("/api/serato/disconnect")
def serato_disconnect(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    state = serato_bridges.disconnect(user_id)
    db.add_event("serato.disconnect", state, user_id=user_id)
    return state


@app.get("/api/serato/status")
def serato_status(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return serato_bridges.get_state(int(user["id"]))


@app.post("/api/serato/push")
def serato_push(payload: SeratoPushRequest, user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    if not isinstance(payload.payload, dict) or not payload.payload:
        raise HTTPException(status_code=400, detail="payload is required")
    state = serato_bridges.ingest(user_id, payload.payload, source=(payload.source or "push")[:40])
    return {"ok": True, "state": state}


@app.get("/api/live/coach")
def live_coach(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = int(user["id"])
    bridge = serato_bridges.get_state(user_id)
    deck_a = bridge.get("deckA") or {}
    deck_b = bridge.get("deckB") or {}

    track_a = resolve_track_for_user(int(deck_a["track_id"]), user_id, allow_link=True) if deck_a.get("track_id") else None
    track_b = resolve_track_for_user(int(deck_b["track_id"]), user_id, allow_link=True) if deck_b.get("track_id") else None

    if not track_a:
        raise HTTPException(status_code=404, detail="Deck A track not available")

    if not track_b:
        recs = []
        all_tracks = db.list_tracks(limit=2000, user_id=user_id)
        for local in all_tracks:
            if local["id"] == track_a["id"]:
                continue
            analysis = analyze_transition(track_a, local, ai_service)
            recs.append((analysis["compatibility"], local, analysis))
        recs.sort(key=lambda row: row[0], reverse=True)
        if recs:
            track_b = recs[0][1]
        else:
            raise HTTPException(status_code=404, detail="No candidate track for deck B")

    analysis = analyze_transition(track_a, track_b, ai_service)
    position = float(deck_a.get("position") or 0.0)
    start_b = float(analysis["mixPoints"]["startB"])
    mix_point = float(analysis["mixPoints"]["mixPoint"])
    drop_align = float(analysis["mixPoints"]["dropAlign"])

    action = "prepare"
    message = "Prepare deck B and pre-cue."
    countdown = int(round(start_b - position))

    if countdown > 8:
        action = "prepare"
        message = f"In {countdown}s launch deck B."
    elif countdown > 0:
        action = "launch_b"
        message = f"Launch deck B in {countdown}s."
    elif position <= mix_point:
        action = "blend"
        message = f"Blend now for {max(4, int(mix_point - position))}s."
    elif position <= drop_align:
        action = "drop_align"
        message = "Align drop now."
    else:
        action = "handoff_done"
        message = "Handoff window passed. Reset for next transition."

    return {
        "action": action,
        "message": message,
        "countdown": countdown,
        "position": position,
        "analysis": analysis,
        "trackA": track_a,
        "trackB": track_b,
        "ai": {
            "localModel": ai_service.local_model,
            "openaiEnabled": ai_service.remote_enabled,
        },
    }


@app.get("/api/export/session/{session_id}.json")
def export_session_json(session_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> JSONResponse:
    try:
        bundle = db.export_session_bundle(session_id, user_id=int(user["id"]))
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")
    return JSONResponse(content=bundle)


@app.get("/api/export/session/{session_id}.csv")
def export_session_csv(session_id: int, user: Dict[str, Any] = Depends(get_current_user)) -> Response:
    try:
        bundle = db.export_session_bundle(session_id, user_id=int(user["id"]))
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["section", "timestamp", "track_a", "track_b", "compatibility", "difficulty", "source", "track"])

    for transition in bundle["transitions"]:
        writer.writerow(
            [
                "transition",
                transition["createdAt"],
                transition["trackA"],
                transition["trackB"],
                transition["compatibility"],
                transition["difficulty"],
                "",
                "",
            ]
        )

    for play in bundle["plays"]:
        writer.writerow(["play", play["playedAt"], "", "", "", "", play["source"], play["track"]])

    csv_content = output.getvalue()
    headers = {"Content-Disposition": f"attachment; filename=maya-session-{session_id}.csv"}
    return Response(content=csv_content, media_type="text/csv", headers=headers)


@app.get("/api/export/current.json")
def export_current_json(user: Dict[str, Any] = Depends(get_current_user)) -> JSONResponse:
    user_id = int(user["id"])
    session = db.current_session(user_id=user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active session")
    try:
        bundle = db.export_session_bundle(int(session["id"]), user_id=user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")
    return JSONResponse(content=bundle)


@app.get("/api/export/current.csv")
def export_current_csv(user: Dict[str, Any] = Depends(get_current_user)) -> Response:
    session = db.current_session(user_id=int(user["id"]))
    if not session:
        raise HTTPException(status_code=404, detail="No active session")
    return export_session_csv(int(session["id"]), user=user)


@app.on_event("startup")
def startup_seed() -> None:
    ensure_bootstrap_admin_account()
    db.add_event("app.startup", {"timestamp": now_iso(), "ai": ai_service.status(test_remote=False)})

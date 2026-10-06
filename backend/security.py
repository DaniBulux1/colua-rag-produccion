from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from .config import settings
from .db import connection

_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16)
COOKIE_NAME = "colua_session"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def password_is_strong(password: str) -> bool:
    return len(password) >= 10 and any(c.isalpha() for c in password) and any(c.isdigit() for c in password)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_dpi(dpi: str) -> str:
    return hmac.new(settings.dpi_pepper.encode(), dpi.encode(), hashlib.sha256).hexdigest()


def hash_identifier(value: str) -> str:
    """HMAC para identificadores operativos (p. ej. IP) sin guardarlos en claro."""
    return hmac.new(settings.app_secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def create_session(user_id: int, remember: bool) -> tuple[str, str, datetime]:
    raw_token = secrets.token_urlsafe(48)
    csrf = secrets.token_urlsafe(32)
    delta = timedelta(days=settings.remember_session_days) if remember else timedelta(hours=settings.session_hours)
    expires = datetime.now(timezone.utc) + delta
    with connection() as conn:
        conn.execute(
            "INSERT INTO sessions(user_id, token_hash, csrf_token, expires_at) VALUES (%s,%s,%s,%s)",
            (user_id, hash_session_token(raw_token), csrf, expires),
        )
        conn.commit()
    return raw_token, csrf, expires


def delete_session(raw_token: str | None) -> None:
    if not raw_token:
        return
    with connection() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash=%s", (hash_session_token(raw_token),))
        conn.commit()


def get_session_user(raw_token: str | None):
    if not raw_token:
        return None
    with connection() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.username, u.name, u.email, u.phone, u.role, u.agency_id, u.profile_image,
                   u.active, u.must_change_password, a.name AS agency, s.csrf_token,
                   s.id AS session_id
            FROM sessions s
            JOIN users u ON u.id=s.user_id
            LEFT JOIN agencies a ON a.id=u.agency_id
            WHERE s.token_hash=%s AND s.expires_at>NOW() AND u.active=TRUE
            """,
            (hash_session_token(raw_token),),
        ).fetchone()
        if row:
            conn.execute("UPDATE sessions SET last_seen_at=NOW() WHERE id=%s", (row["session_id"],))
            conn.commit()
        return row


def create_portal_sso_handoff(user_id: int) -> tuple[str, datetime]:
    """Crea un código de un solo uso para pasar del portal Firebase al frontend RAG."""
    raw_token = secrets.token_urlsafe(48)
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.portal_sso_minutes)
    with connection() as conn:
        conn.execute("DELETE FROM portal_sso_handoffs WHERE expires_at < NOW() OR used_at IS NOT NULL")
        conn.execute(
            "INSERT INTO portal_sso_handoffs(user_id, token_hash, expires_at) VALUES (%s,%s,%s)",
            (user_id, hash_session_token(raw_token), expires),
        )
        conn.commit()
    return raw_token, expires


def consume_portal_sso_handoff(raw_token: str) -> int | None:
    """Consume atómicamente un código SSO y devuelve el user_id asociado."""
    if not raw_token:
        return None
    token_hash = hash_session_token(raw_token)
    with connection() as conn:
        row = conn.execute(
            """
            UPDATE portal_sso_handoffs
               SET used_at = NOW()
             WHERE id = (
                SELECT id
                  FROM portal_sso_handoffs
                 WHERE token_hash=%s
                   AND used_at IS NULL
                   AND expires_at > NOW()
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED
             )
            RETURNING user_id
            """,
            (token_hash,),
        ).fetchone()
        conn.commit()
        return int(row["user_id"]) if row else None

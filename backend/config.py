from __future__ import annotations

from dataclasses import dataclass
import os
from dotenv import load_dotenv

load_dotenv()


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Falta la variable de entorno obligatoria: {name}")
    return value


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "si", "sí", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str = _required("DATABASE_URL")
    app_secret_key: str = _required("APP_SECRET_KEY")
    dpi_pepper: str = _required("DPI_PEPPER")
    cookie_secure: bool = _bool("COOKIE_SECURE", True)
    session_hours: int = int(os.getenv("SESSION_HOURS", "8"))
    remember_session_days: int = int(os.getenv("REMEMBER_SESSION_DAYS", "30"))

    admin_username: str = os.getenv("ADMIN_USERNAME", "admin").strip().lower() or "admin"
    admin_bootstrap_password: str = os.getenv("ADMIN_BOOTSTRAP_PASSWORD", "")
    admin_name: str = os.getenv("ADMIN_NAME", "Administrador COLUA")

    openai_api_key: str = _required("OPENAI_API_KEY")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    embedding_dimensions: int = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))
    rag_top_k: int = int(os.getenv("RAG_TOP_K", "5"))
    rag_min_score: float = float(os.getenv("RAG_MIN_SCORE", "0.28"))

    llm_provider: str = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    llm_fallback_provider: str = os.getenv("LLM_FALLBACK_PROVIDER", "none").strip().lower()
    openai_chat_model: str = os.getenv("OPENAI_CHAT_MODEL", "gpt-5.6-luna")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "").strip()
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
    max_output_tokens: int = int(os.getenv("MAX_OUTPUT_TOKENS", "650"))

    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))
    allowed_origins: tuple[str, ...] = tuple(
        x.strip() for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()
    )

    # Integración segura con COLUA Web (Firebase Authentication)
    firebase_project_id: str = os.getenv("FIREBASE_PROJECT_ID", "colua-info").strip()
    portal_default_agency_id: str = os.getenv("PORTAL_DEFAULT_AGENCY_ID", "central").strip() or "central"

    # URL pública del frontend RAG. Se usa para el traspaso SSO hacia precalificación.
    public_app_url: str = os.getenv("PUBLIC_APP_URL", "http://127.0.0.1:8000").strip().rstrip("/")
    portal_sso_minutes: int = int(os.getenv("PORTAL_SSO_MINUTES", "5"))


settings = Settings()

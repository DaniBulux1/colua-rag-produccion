from __future__ import annotations

from contextlib import contextmanager
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from .config import settings

pool = ConnectionPool(
    conninfo=settings.database_url,
    min_size=1,
    max_size=12,
    kwargs={"row_factory": dict_row},
    open=False,
)


@contextmanager
def connection():
    with pool.connection() as conn:
        yield conn


def init_db() -> None:
    pool.open(wait=True)
    with connection() as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS agencies (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                department TEXT NOT NULL DEFAULT '',
                phones JSONB NOT NULL DEFAULT '[]'::jsonb,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                username VARCHAR(60) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name VARCHAR(140) NOT NULL,
                email VARCHAR(160),
                phone VARCHAR(20),
                role VARCHAR(20) NOT NULL CHECK (role IN ('asociado','asesor','administrador')),
                agency_id TEXT REFERENCES agencies(id),
                dpi_hash TEXT UNIQUE,
                dpi_last4 VARCHAR(4),
                profile_image TEXT,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(160);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128);
            ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS ux_users_firebase_uid
                ON users(firebase_uid) WHERE firebase_uid IS NOT NULL AND firebase_uid <> '';
            CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower
                ON users((LOWER(email))) WHERE email IS NOT NULL AND email <> '';
            CREATE UNIQUE INDEX IF NOT EXISTS ux_one_advisor_per_agency
                ON users(agency_id) WHERE role='asesor' AND active=TRUE;

            CREATE TABLE IF NOT EXISTS sessions (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash CHAR(64) UNIQUE NOT NULL,
                csrf_token TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS ix_sessions_expiry ON sessions(expires_at);

            CREATE TABLE IF NOT EXISTS portal_sso_handoffs (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash CHAR(64) UNIQUE NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_portal_sso_handoffs_expiry
                ON portal_sso_handoffs(expires_at);

            CREATE TABLE IF NOT EXISTS login_attempts (
                id BIGSERIAL PRIMARY KEY,
                username VARCHAR(160) NOT NULL,
                client_hash CHAR(64) NOT NULL,
                success BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            ALTER TABLE login_attempts ALTER COLUMN username TYPE VARCHAR(160);
            CREATE INDEX IF NOT EXISTS ix_login_attempts_username
                ON login_attempts(username, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_login_attempts_client
                ON login_attempts(client_hash, created_at DESC);

            CREATE TABLE IF NOT EXISTS prequalifications (
                id BIGSERIAL PRIMARY KEY,
                code VARCHAR(30) UNIQUE NOT NULL,
                user_id BIGINT NOT NULL REFERENCES users(id),
                agency_id TEXT NOT NULL REFERENCES agencies(id),
                phone VARCHAR(20) NOT NULL,
                contact_preference VARCHAR(20) NOT NULL,
                income NUMERIC(14,2) NOT NULL,
                employment TEXT NOT NULL,
                tenure_months INTEGER NOT NULL,
                debts NUMERIC(14,2) NOT NULL,
                available NUMERIC(14,2) NOT NULL,
                requested_amount NUMERIC(14,2) NOT NULL,
                purpose TEXT NOT NULL,
                arrears BOOLEAN NOT NULL,
                debt_ratio NUMERIC(8,2) NOT NULL,
                preliminary_result TEXT NOT NULL,
                workflow_status VARCHAR(30) NOT NULL DEFAULT 'pendiente',
                advisor_notes TEXT NOT NULL DEFAULT '',
                assigned_advisor_id BIGINT REFERENCES users(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_prequal_agency ON prequalifications(agency_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_prequal_user ON prequalifications(user_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS prequalification_history (
                id BIGSERIAL PRIMARY KEY,
                prequalification_id BIGINT NOT NULL REFERENCES prequalifications(id) ON DELETE CASCADE,
                user_id BIGINT REFERENCES users(id),
                action TEXT NOT NULL,
                status VARCHAR(30),
                note TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS chat_sessions (
                id UUID PRIMARY KEY,
                user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id BIGSERIAL PRIMARY KEY,
                chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
                role VARCHAR(12) NOT NULL CHECK (role IN ('user','assistant')),
                content TEXT NOT NULL,
                provider VARCHAR(30),
                model VARCHAR(100),
                sources JSONB NOT NULL DEFAULT '[]'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_chat_messages_session ON chat_messages(chat_session_id, id);

            CREATE TABLE IF NOT EXISTS rag_documents (
                id BIGSERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT '',
                filename TEXT NOT NULL,
                checksum CHAR(64) UNIQUE NOT NULL,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS rag_chunks (
                id BIGSERIAL PRIMARY KEY,
                document_id BIGINT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding vector({settings.embedding_dimensions}) NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(document_id, chunk_index)
            );
            CREATE INDEX IF NOT EXISTS ix_rag_chunks_hnsw
                ON rag_chunks USING hnsw (embedding vector_cosine_ops);

            CREATE TABLE IF NOT EXISTS llm_usage (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
                chat_session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
                provider VARCHAR(30) NOT NULL,
                model VARCHAR(100) NOT NULL,
                operation VARCHAR(30) NOT NULL,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                latency_ms INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.commit()


def close_db() -> None:
    pool.close()

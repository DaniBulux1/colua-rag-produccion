from __future__ import annotations

import base64
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import settings
from .db import connection, init_db, close_db
from .security import (
    COOKIE_NAME,
    create_session,
    delete_session,
    get_session_user,
    hash_dpi,
    hash_identifier,
    hash_password,
    password_is_strong,
    verify_password,
    create_portal_sso_handoff,
    consume_portal_sso_handoff,
)
from .rag_service import answer as rag_answer
from .firebase_auth import verify_firebase_id_token

logger = logging.getLogger("colua")

BASE_DIR = Path(__file__).resolve().parent.parent
ASSET_DIR = BASE_DIR / "assets"

AGENCIES = [
    ("plaza-colua","Agencia Plaza COLUA","Sololá",["7762 3608","7762 3180"]),
    ("el-calvario","Agencia El Calvario","Sololá",["4931 5495"]),
    ("el-carmen","Agencia El Carmen","Sololá",["7762 3984"]),
    ("central","Agencia Central","Sololá",["7795 7795"]),
    ("corporativa","Agencia Corporativa","Sololá",["7795 7795"]),
    ("los-encuentros","Agencia Los Encuentros","Sololá",["5829 2086"]),
    ("panajachel","Agencia Panajachel","Sololá",["4930 4278"]),
    ("santiago-atitlan","Agencia Santiago Atitlán","Sololá",["7721 7979","4921 5160"]),
    ("san-pedro","Agencia San Pedro","Sololá",["4921 3887","7721 8061"]),
    ("san-juan","Agencia San Juan","Sololá",["4038 4692"]),
    ("santa-clara","Agencia Santa Clara","Sololá",["4928 2887","7927 1939"]),
    ("santa-lucia","Agencia Santa Lucía","Sololá",["7722 1519"]),
    ("novillero","Agencia Novillero","Sololá",["4928 1377","4921 8753"]),
    ("nahuala","Agencia Nahualá","Sololá",["7755 9604","7755 9719"]),
    ("santa-catarina","Agencia Santa Catarina","Sololá",["4921 6226"]),
    ("guineales","Agencia Guineales","Sololá",["7795 7795"]),
    ("la-esperanza","Agencia La Esperanza","Totonicapán",["4931 7422"]),
    ("la-concordia","Agencia La Concordia","Totonicapán",["4214 3136"]),
    ("quiche","Agencia El Quiché","Quiché",["7822 9157"]),
    ("chichicastenango","Agencia Chichicastenango","Quiché",["4930 1377","4023 8077"]),
    ("joyabaj","Agencia Joyabaj","Quiché",["7755 9577","7755 9398"]),
    ("zacualpa","Agencia Zacualpa","Quiché",["5829 3158"]),
    ("santo-tomas-la-union","Agencia Santo Tomás La Unión","Suchitepéquez",["7872 8526"]),
]

WORKFLOW_STATUSES = {"pendiente","en_revision","contactado","derivado","cerrado"}

app = FastAPI(title="COLUA RAG API", version="4.0")
if settings.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET","POST","PATCH","DELETE"],
        allow_headers=["Content-Type","X-CSRF-Token","Authorization"],
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
        "base-uri 'self'; form-action 'self'"
    )
    if settings.cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


def _serialize_user(row: dict) -> dict:
    return {
        "id": row["id"], "username": row["username"], "name": row["name"],
        "email": row.get("email") or "", "phone": row.get("phone") or "",
        "role": row["role"], "agencyId": row.get("agency_id") or "",
        "agency": row.get("agency") or "", "profileImage": row.get("profile_image") or "",
        "mustChangePassword": bool(row.get("must_change_password")),
    }


def _seed_agencies_and_admin() -> None:
    with connection() as conn:
        for aid,name,department,phones in AGENCIES:
            conn.execute(
                """INSERT INTO agencies(id,name,department,phones) VALUES (%s,%s,%s,%s::jsonb)
                   ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,department=EXCLUDED.department,phones=EXCLUDED.phones""",
                (aid,name,department,json.dumps(phones,ensure_ascii=False)),
            )
        admin = conn.execute("SELECT id FROM users WHERE username=%s", (settings.admin_username,)).fetchone()
        if not admin:
            if not settings.admin_bootstrap_password:
                raise RuntimeError(
                    "No existe el administrador y falta ADMIN_BOOTSTRAP_PASSWORD. "
                    "Configura una contraseña temporal segura para el primer arranque."
                )
            if not password_is_strong(settings.admin_bootstrap_password):
                raise RuntimeError("ADMIN_BOOTSTRAP_PASSWORD debe tener al menos 10 caracteres, letras y números.")
            conn.execute(
                """INSERT INTO users(username,password_hash,name,role,must_change_password)
                   VALUES (%s,%s,%s,'administrador',TRUE)""",
                (settings.admin_username, hash_password(settings.admin_bootstrap_password), settings.admin_name),
            )
        conn.commit()


@app.on_event("startup")
def startup() -> None:
    init_db()
    _seed_agencies_and_admin()


@app.on_event("shutdown")
def shutdown() -> None:
    close_db()


def current_user(request: Request) -> dict:
    row = get_session_user(request.cookies.get(COOKIE_NAME))
    if not row:
        raise HTTPException(401, "Sesión no válida o expirada.")
    return dict(row)


def require_csrf(request: Request, user: dict = Depends(current_user)) -> dict:
    csrf = request.headers.get("X-CSRF-Token", "")
    if not csrf or not secrets.compare_digest(csrf, str(user.get("csrf_token", ""))):
        raise HTTPException(403, "Token CSRF inválido.")
    return user


def require_admin(user: dict = Depends(require_csrf)) -> dict:
    if user["role"] != "administrador":
        raise HTTPException(403, "Acceso reservado para administración.")
    return user


def require_staff(user: dict = Depends(require_csrf)) -> dict:
    if user["role"] not in {"administrador","asesor"}:
        raise HTTPException(403, "Acceso reservado para personal autorizado.")
    return user


def _get_or_create_portal_user(claims: dict) -> dict:
    """Vincula de forma segura un UID de Firebase con el usuario interno del RAG."""
    firebase_uid = str(claims.get("uid") or claims.get("sub") or "").strip()
    email = str(claims.get("email") or "").strip().lower()
    display_name = str(claims.get("name") or "").strip()

    if not firebase_uid:
        raise HTTPException(401, "Identidad de Firebase inválida.")

    if not display_name:
        display_name = email.split("@", 1)[0] if email else "Asociado COLUA"

    username = f"fb_{firebase_uid}"[:60]

    with connection() as conn:
        row = conn.execute(
            """SELECT u.*,a.name AS agency
               FROM users u LEFT JOIN agencies a ON a.id=u.agency_id
               WHERE u.firebase_uid=%s
               LIMIT 1""",
            (firebase_uid,),
        ).fetchone()

        if not row and email and claims.get("email_verified") is True:
            row = conn.execute(
                """SELECT u.*,a.name AS agency
                   FROM users u LEFT JOIN agencies a ON a.id=u.agency_id
                   WHERE LOWER(COALESCE(u.email,''))=%s
                   LIMIT 1""",
                (email,),
            ).fetchone()

            if row and row.get("firebase_uid") and row["firebase_uid"] != firebase_uid:
                raise HTTPException(409, "Ese correo ya está vinculado a otra identidad de Firebase.")
            # No vincular una identidad Firebase con cuentas privilegiadas del RAG.
            # Las cuentas administrativas y de agencias mantienen su propio acceso.
            if row and row["role"] != "asociado":
                raise HTTPException(409, "El correo pertenece a una cuenta interna. Solicita una vinculación autorizada.")

            if row:
                conn.execute(
                    """UPDATE users
                          SET firebase_uid=%s,
                              email=COALESCE(NULLIF(email,''),%s),
                              updated_at=NOW()
                        WHERE id=%s""",
                    (firebase_uid, email or None, row["id"]),
                )
                conn.commit()
                row = conn.execute(
                    """SELECT u.*,a.name AS agency
                       FROM users u LEFT JOIN agencies a ON a.id=u.agency_id
                       WHERE u.id=%s""",
                    (row["id"],),
                ).fetchone()

        if not row and email:
            existing_email = conn.execute(
                "SELECT id FROM users WHERE LOWER(COALESCE(email,''))=%s LIMIT 1",
                (email,),
            ).fetchone()
            if existing_email:
                raise HTTPException(409, "No se puede vincular automáticamente esta cuenta. Verifica tu correo o contacta soporte.")

        if not row:
            agency = conn.execute(
                "SELECT id FROM agencies WHERE id=%s AND active=TRUE",
                (settings.portal_default_agency_id,),
            ).fetchone()
            agency_id = agency["id"] if agency else None

            created = conn.execute(
                """INSERT INTO users(
                        username,password_hash,name,email,role,agency_id,firebase_uid,active,must_change_password
                    ) VALUES (%s,NULL,%s,%s,'asociado',%s,%s,TRUE,FALSE)
                    RETURNING id""",
                (username, display_name[:140], email or None, agency_id, firebase_uid),
            ).fetchone()
            conn.commit()
            row = conn.execute(
                """SELECT u.*,a.name AS agency
                   FROM users u LEFT JOIN agencies a ON a.id=u.agency_id
                   WHERE u.id=%s""",
                (created["id"],),
            ).fetchone()

        if not row or not row.get("active"):
            raise HTTPException(403, "El usuario vinculado se encuentra inactivo.")

        return dict(row)


def portal_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "").strip()
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(401, "Debes iniciar sesión en COLUA Web.")

    token = auth_header.split(" ", 1)[1].strip()
    try:
        claims = verify_firebase_id_token(token)
    except Exception as exc:
        logger.warning("Token Firebase rechazado: %s", exc)
        raise HTTPException(401, "La sesión de COLUA Web no es válida o expiró.") from exc

    return _get_or_create_portal_user(claims)


def _guest_client_hash(request: Request) -> str:
    """Identificador irreversible para limitar el chat público sin guardar la IP en claro."""
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    address = forwarded or (request.client.host if request.client else "unknown")
    user_agent = request.headers.get("user-agent", "")[:180]
    return hash_identifier(f"guest-chat|{address}|{user_agent}")


def _consume_guest_chat_quota(request: Request, limit: int = 8) -> str:
    client_hash = _guest_client_hash(request)
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    with connection() as conn:
        # Limpieza liviana para que esta tabla no crezca indefinidamente.
        conn.execute("DELETE FROM guest_chat_requests WHERE created_at < NOW() - INTERVAL '24 hours'")
        used = conn.execute(
            "SELECT COUNT(*) AS n FROM guest_chat_requests WHERE client_hash=%s AND created_at >= %s",
            (client_hash, since),
        ).fetchone()["n"]
        if int(used) >= limit:
            raise HTTPException(
                429,
                "Has alcanzado el límite de consultas como visitante. Inicia sesión para continuar y guardar tu historial.",
            )
        conn.execute("INSERT INTO guest_chat_requests(client_hash) VALUES (%s)", (client_hash,))
        conn.commit()
    return client_hash


class LoginIn(BaseModel):
    username: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=1, max_length=200)
    remember: bool = False


class RegisterIn(BaseModel):
    dpi: str
    name: str = Field(min_length=5, max_length=140)
    email: str = Field(default="", max_length=160)
    phone: str = Field(default="", max_length=20)
    agency_id: str
    username: str = Field(min_length=4, max_length=60)
    password: str = Field(min_length=10, max_length=200)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


class PhotoIn(BaseModel):
    profile_image: str = Field(max_length=400_000)


class PrequalIn(BaseModel):
    phone: str
    contact_preference: str

    income: float = Field(gt=0)

    employment: str = Field(
        min_length=3,
        max_length=300
    )

    tenure_months: int = Field(
        ge=0,
        le=720
    )

    debts: float = Field(ge=0)

    expenses: float = Field(
        default=0,
        ge=0
    )

    desired_term_months: int | None = Field(
        default=None,
        ge=1,
        le=360
    )

    requested_amount: float = Field(gt=0)

    purpose: str = Field(
        min_length=3,
        max_length=500
    )

    arrears: bool


class FollowupIn(BaseModel):
    workflow_status: str
    advisor_notes: str = Field(default="", max_length=800)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1200)
    conversation_id: UUID | None = None


class FirebaseHandoffIn(BaseModel):
    code: str = Field(min_length=20, max_length=300)


class AdminCreateUserIn(BaseModel):
    username: str = Field(min_length=4, max_length=60)
    name: str = Field(min_length=3, max_length=140)
    role: str = "asesor"
    agency_id: str | None = None
    temporary_password: str = Field(min_length=10, max_length=200)


class AdminResetPasswordIn(BaseModel):
    new_password: str = Field(min_length=10, max_length=200)


@app.get("/api/health")
def health():
    with connection() as conn:
        docs = conn.execute("SELECT COUNT(*) AS n FROM rag_documents WHERE active=TRUE").fetchone()["n"]
        chunks = conn.execute("SELECT COUNT(*) AS n FROM rag_chunks").fetchone()["n"]
    return {"ok": True, "service": "COLUA Production RAG", "documents": docs, "chunks": chunks, "provider": settings.llm_provider}


@app.get("/api/agencies")
def agencies():
    with connection() as conn:
        rows=conn.execute("SELECT id,name,department,phones FROM agencies WHERE active=TRUE ORDER BY name").fetchall()
    return {"ok":True,"agencies":[dict(r) for r in rows]}


@app.get("/api/portal/auth/me")
def portal_auth_me(user: dict = Depends(portal_user)):
    return {"ok": True, "user": _serialize_user(user)}


@app.post("/api/portal/prequalification-link")
def portal_prequalification_link(user: dict = Depends(portal_user)):
    if user["role"] != "asociado":
        raise HTTPException(403, "La precalificación está disponible para asociados.")
    raw_code, expires = create_portal_sso_handoff(user["id"])
    url = f"{settings.public_app_url}/#prequal?sso={raw_code}"
    return {"ok": True, "url": url, "expiresAt": expires.isoformat()}


@app.post("/api/auth/firebase-handoff/consume")
def consume_firebase_handoff(payload: FirebaseHandoffIn, response: Response):
    user_id = consume_portal_sso_handoff(payload.code.strip())
    if not user_id:
        raise HTTPException(401, "El acceso de precalificación expiró o ya fue utilizado.")

    with connection() as conn:
        row = conn.execute(
            """SELECT u.*,a.name AS agency
               FROM users u LEFT JOIN agencies a ON a.id=u.agency_id
               WHERE u.id=%s AND u.active=TRUE""",
            (user_id,),
        ).fetchone()

    if not row:
        raise HTTPException(401, "El usuario ya no está disponible.")

    token, csrf, _ = create_session(row["id"], False)
    response.set_cookie(
        COOKIE_NAME, token, httponly=True, secure=settings.cookie_secure,
        samesite="lax", path="/",
    )
    user = dict(row)
    user["csrf_token"] = csrf
    return {"ok": True, "user": _serialize_user(user), "csrfToken": csrf}


@app.post("/api/auth/register")
def register(payload: RegisterIn):
    dpi=re.sub(r"\D","",payload.dpi)
    username=payload.username.strip().lower()
    email=payload.email.strip().lower()
    phone=re.sub(r"\D","",payload.phone)
    if not re.fullmatch(r"\d{13}",dpi):
        raise HTTPException(400,"El DPI debe contener 13 dígitos.")
    if not re.fullmatch(r"[a-z0-9._-]{4,60}",username):
        raise HTTPException(400,"Usuario inválido.")
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+",email):
        raise HTTPException(400,"Correo electrónico inválido.")
    if phone and len(phone)!=8:
        raise HTTPException(400,"El teléfono debe contener 8 dígitos.")
    if not password_is_strong(payload.password):
        raise HTTPException(400,"La contraseña debe tener al menos 10 caracteres, letras y números.")
    with connection() as conn:
        agency=conn.execute("SELECT id FROM agencies WHERE id=%s AND active=TRUE",(payload.agency_id,)).fetchone()
        if not agency: raise HTTPException(400,"Agencia inválida.")
        if conn.execute("SELECT 1 FROM users WHERE username=%s",(username,)).fetchone():
            raise HTTPException(409,"Ese nombre de usuario ya está registrado.")
        if email and conn.execute("SELECT 1 FROM users WHERE LOWER(email)=%s",(email,)).fetchone():
            raise HTTPException(409,"Ese correo electrónico ya está registrado.")
        dpi_hash=hash_dpi(dpi)
        if conn.execute("SELECT 1 FROM users WHERE dpi_hash=%s",(dpi_hash,)).fetchone():
            raise HTTPException(409,"Ya existe una cuenta asociada a ese DPI.")
        conn.execute(
            """INSERT INTO users(username,password_hash,name,email,phone,role,agency_id,dpi_hash,dpi_last4)
               VALUES (%s,%s,%s,%s,%s,'asociado',%s,%s,%s)""",
            (username,hash_password(payload.password),payload.name.strip(),email or None,phone or None,payload.agency_id,dpi_hash,dpi[-4:]),
        )
        conn.commit()
    return {"ok":True,"message":"Cuenta creada correctamente."}


@app.post("/api/auth/login")
def login(payload: LoginIn, response: Response, request: Request):
    username=payload.username.strip().lower()
    client_host=(request.client.host if request.client else "unknown") or "unknown"
    client_hash=hash_identifier(client_host)
    with connection() as conn:
        # Protección básica contra fuerza bruta persistida en PostgreSQL.
        conn.execute("DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '24 hours'")
        user_failures=conn.execute(
            "SELECT COUNT(*) AS n FROM login_attempts WHERE username=%s AND success=FALSE AND created_at > NOW() - INTERVAL '15 minutes'",
            (username,),
        ).fetchone()["n"]
        client_failures=conn.execute(
            "SELECT COUNT(*) AS n FROM login_attempts WHERE client_hash=%s AND success=FALSE AND created_at > NOW() - INTERVAL '15 minutes'",
            (client_hash,),
        ).fetchone()["n"]
        if user_failures >= 5 or client_failures >= 20:
            conn.commit()
            raise HTTPException(429,"Demasiados intentos de inicio de sesión. Intenta nuevamente en unos minutos.")
        row=conn.execute(
            """SELECT u.*,a.name AS agency FROM users u LEFT JOIN agencies a ON a.id=u.agency_id
               WHERE (u.username=%s OR LOWER(COALESCE(u.email,''))=%s) AND u.active=TRUE""",(username,username)
        ).fetchone()
        valid=bool(row and verify_password(row["password_hash"],payload.password))
        conn.execute(
            "INSERT INTO login_attempts(username,client_hash,success) VALUES (%s,%s,%s)",
            (username,client_hash,valid),
        )
        if valid:
            conn.execute(
                "DELETE FROM login_attempts WHERE username=%s AND client_hash=%s AND success=FALSE",
                (username,client_hash),
            )
        conn.commit()
    if not valid:
        raise HTTPException(401,"Usuario o contraseña incorrectos.")
    token,csrf,expires=create_session(row["id"],payload.remember)
    max_age=settings.remember_session_days*86400 if payload.remember else None
    response.set_cookie(
        COOKIE_NAME,token,httponly=True,secure=settings.cookie_secure,samesite="lax",
        max_age=max_age,path="/",
    )
    user=dict(row); user["csrf_token"]=csrf
    return {"ok":True,"user":_serialize_user(user),"csrfToken":csrf}


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)):
    return {"ok":True,"user":_serialize_user(user),"csrfToken":user["csrf_token"]}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, user: dict = Depends(require_csrf)):
    delete_session(request.cookies.get(COOKIE_NAME))
    response.delete_cookie(COOKIE_NAME,path="/",secure=settings.cookie_secure,samesite="lax")
    return {"ok":True}


@app.post("/api/profile/change-password")
def change_password(payload: PasswordChangeIn, user: dict = Depends(require_csrf)):
    if not password_is_strong(payload.new_password):
        raise HTTPException(400,"La nueva contraseña debe tener al menos 10 caracteres, letras y números.")
    with connection() as conn:
        row=conn.execute("SELECT password_hash FROM users WHERE id=%s",(user["id"],)).fetchone()
        if not row or not verify_password(row["password_hash"],payload.current_password):
            raise HTTPException(400,"La contraseña actual no es correcta.")
        if verify_password(row["password_hash"],payload.new_password):
            raise HTTPException(400,"La nueva contraseña debe ser diferente a la actual.")
        conn.execute(
            "UPDATE users SET password_hash=%s,must_change_password=FALSE,updated_at=NOW() WHERE id=%s",
            (hash_password(payload.new_password),user["id"]),
        )
        conn.execute("DELETE FROM sessions WHERE user_id=%s AND id<>%s",(user["id"],user["session_id"]))
        conn.commit()
    return {"ok":True,"message":"Contraseña actualizada correctamente."}


@app.post("/api/profile/photo")
def update_photo(payload: PhotoIn, user: dict = Depends(require_csrf)):
    image=payload.profile_image.strip()
    if not image.startswith("data:image/jpeg;base64,"):
        raise HTTPException(400,"Formato de fotografía no permitido.")
    try:
        raw=base64.b64decode(image.split(",",1)[1],validate=True)
    except Exception:
        raise HTTPException(400,"La fotografía no es válida.")
    if len(raw)>250_000:
        raise HTTPException(400,"La fotografía optimizada supera 250 KB.")
    with connection() as conn:
        conn.execute("UPDATE users SET profile_image=%s,updated_at=NOW() WHERE id=%s",(image,user["id"]))
        conn.commit()
    return {"ok":True,"profileImage":image}


@app.delete("/api/profile/photo")
def delete_photo(user: dict = Depends(require_csrf)):
    with connection() as conn:
        conn.execute("UPDATE users SET profile_image=NULL,updated_at=NOW() WHERE id=%s",(user["id"],))
        conn.commit()
    return {"ok":True}


def _prequal_row_to_dict(row: dict) -> dict:
    return {
        "dbId":row["id"],"id":row["code"],"username":row["username"],"applicantName":row["applicant_name"],
        "agencyId":row["agency_id"],"agency":row["agency"],"phone":row["phone"],"contactPreference":row["contact_preference"],
        "income":float(row["income"]),"employment":row["employment"],"tenure":row["tenure_months"],
        "debts":float(row["debts"]),"available":float(row["available"]),"requestedAmount":float(row["requested_amount"]),
        "purpose":row["purpose"],"arrears":row["arrears"],"debtRatio":float(row["debt_ratio"]),
        "preliminaryResult":row["preliminary_result"],"workflowStatus":row["workflow_status"],
        "advisorNotes":row["advisor_notes"],"assignedAdvisor":row.get("advisor_username") or "",
        "createdAt":row["created_at"].isoformat(),"updatedAt":row["updated_at"].isoformat(),
    }


@app.post("/api/prequalifications")
def create_prequalification(
    payload: PrequalIn,
    user: dict = Depends(require_csrf)
):
    if user["role"] != "asociado":
        raise HTTPException(
            403,
            "Solo un asociado puede registrar su precalificación."
        )

    if not user.get("agency_id"):
        raise HTTPException(
            400,
            "Tu usuario no tiene una agencia asignada."
        )

    phone = re.sub(r"\D", "", payload.phone)

    if len(phone) != 8:
        raise HTTPException(
            400,
            "El teléfono debe contener 8 dígitos."
        )

    # -------------------------------------------------
    # ANÁLISIS ECONÓMICO ORIENTATIVO
    # -------------------------------------------------

    income = float(payload.income)
    debts = float(payload.debts)
    expenses = float(payload.expenses or 0)

    # Dinero disponible considerando únicamente
    # obligaciones financieras.
    available = max(
        0,
        income - debts
    )

    # Compromisos declarados por el usuario.
    total_commitments = debts + expenses

    # Capacidad restante después de obligaciones
    # y gastos declarados.
    net_capacity = income - total_commitments

    # Porcentaje destinado actualmente a deudas.
    debt_ratio = (
        (debts / income) * 100
        if income > 0
        else 0
    )

    # Porcentaje comprometido considerando
    # deudas + gastos declarados.
    commitment_ratio = (
        (total_commitments / income) * 100
        if income > 0
        else 0
    )

    observations = []

    # -------------------------------------------------
    # OBSERVACIONES
    #
    # Estas reglas NO aprueban ni rechazan créditos.
    # Únicamente describen la información declarada.
    # -------------------------------------------------

    if debts == 0:
        observations.append(
            "No reportaste obligaciones financieras mensuales actuales."
        )
    else:
        observations.append(
            f"Tus obligaciones financieras declaradas representan "
            f"aproximadamente el {debt_ratio:.1f}% de tus ingresos mensuales."
        )

    if expenses > 0:
        observations.append(
            "La capacidad disponible fue calculada considerando "
            "los gastos mensuales que declaraste."
        )

    if net_capacity > 0:
        observations.append(
            f"Después de las obligaciones y gastos declarados, "
            f"queda una disponibilidad aproximada de "
            f"Q{net_capacity:,.2f} mensuales."
        )
    else:
        observations.append(
            "Las obligaciones y gastos mensuales declarados "
            "igualan o superan los ingresos reportados."
        )

    if payload.tenure_months < 6:
        observations.append(
            "La actividad laboral o económica reportada tiene "
            "menos de 6 meses de antigüedad; este dato deberá "
            "ser revisado por un asesor."
        )
    else:
        observations.append(
            f"Reportaste {payload.tenure_months} meses de "
            f"antigüedad en tu actividad laboral o económica actual."
        )

    if payload.arrears:
        observations.append(
            "Reportaste cuotas actualmente en atraso; "
            "esta situación requiere revisión con un asesor."
        )
    else:
        observations.append(
            "No reportaste cuotas de crédito actualmente en atraso."
        )

    if payload.desired_term_months:
        observations.append(
            f"Indicastes un plazo deseado de "
            f"{payload.desired_term_months} meses. "
            f"El plazo definitivo dependerá del producto y "
            f"de la evaluación realizada por COLUA."
        )

    # -------------------------------------------------
    # RESULTADO PRELIMINAR
    # -------------------------------------------------

    if payload.arrears:
        result = (
            "El perfil requiere revisión con un asesor debido "
            "a la información de pago reportada."
        )

    elif net_capacity <= 0:
        result = (
            "El perfil requiere revisión con un asesor porque "
            "los compromisos mensuales declarados consumen la "
            "capacidad disponible reportada."
        )

    elif debts >= income:
        result = (
            "El perfil requiere revisión con un asesor debido "
            "al nivel de obligaciones financieras declarado."
        )

    else:
        result = (
            "La información fue recopilada correctamente y el "
            "perfil puede continuar a revisión institucional."
        )

    # -------------------------------------------------
    # REGISTRO
    # -------------------------------------------------

    with connection() as conn:

        seq = conn.execute(
            """
            SELECT nextval(
                pg_get_serial_sequence(
                    'prequalifications',
                    'id'
                )
            ) AS n
            """
        ).fetchone()["n"]

        code = (
            f"PQ-{datetime.now().year}-{int(seq):05d}"
        )

        row = conn.execute(
            """
            INSERT INTO prequalifications(
                id,
                code,
                user_id,
                agency_id,
                phone,
                contact_preference,
                income,
                employment,
                tenure_months,
                debts,
                available,
                requested_amount,
                purpose,
                arrears,
                debt_ratio,
                preliminary_result
            )
            VALUES (
                %s,%s,%s,%s,%s,%s,%s,%s,
                %s,%s,%s,%s,%s,%s,%s,%s
            )
            RETURNING id
            """,
            (
                seq,
                code,
                user["id"],
                user["agency_id"],
                phone,
                payload.contact_preference,
                payload.income,
                payload.employment.strip(),
                payload.tenure_months,
                payload.debts,
                available,
                payload.requested_amount,
                payload.purpose.strip(),
                payload.arrears,
                debt_ratio,
                result
            )
        ).fetchone()

        conn.execute(
            """
            INSERT INTO prequalification_history(
                prequalification_id,
                user_id,
                action,
                status,
                note
            )
            VALUES (
                %s,
                %s,
                'Solicitud registrada',
                'pendiente',
                %s
            )
            """,
            (
                row["id"],
                user["id"],
                (
                    f"Gastos declarados: Q{expenses:,.2f}. "
                    f"Plazo deseado: "
                    f"{payload.desired_term_months or 'No indicado'} meses. "
                    f"Capacidad restante estimada: "
                    f"Q{net_capacity:,.2f}."
                )
            )
        )

        conn.commit()

    # -------------------------------------------------
    # RESPUESTA PARA EL CHAT
    # -------------------------------------------------

    return {
        "ok": True,
        "code": code,

        "available": round(
            available,
            2
        ),

        "totalCommitments": round(
            total_commitments,
            2
        ),

        "netCapacity": round(
            net_capacity,
            2
        ),

        "debtRatio": round(
            debt_ratio,
            1
        ),

        "commitmentRatio": round(
            commitment_ratio,
            1
        ),

        "preliminaryResult": result,

        "observations": observations
    }


_PREQUAL_SELECT="""
SELECT p.*,u.username,u.name AS applicant_name,a.name AS agency,adv.username AS advisor_username
FROM prequalifications p
JOIN users u ON u.id=p.user_id
JOIN agencies a ON a.id=p.agency_id
LEFT JOIN users adv ON adv.id=p.assigned_advisor_id
"""


@app.get("/api/prequalifications")
def list_prequalifications(user: dict = Depends(current_user)):
    with connection() as conn:
        if user["role"]=="administrador":
            rows=conn.execute(_PREQUAL_SELECT+" ORDER BY p.created_at DESC LIMIT 500").fetchall()
        elif user["role"]=="asesor":
            rows=conn.execute(_PREQUAL_SELECT+" WHERE p.agency_id=%s ORDER BY p.created_at DESC LIMIT 500",(user["agency_id"],)).fetchall()
        else:
            rows=conn.execute(_PREQUAL_SELECT+" WHERE p.user_id=%s ORDER BY p.created_at DESC LIMIT 100",(user["id"],)).fetchall()
    return {"ok":True,"items":[_prequal_row_to_dict(dict(r)) for r in rows]}


@app.get("/api/prequalifications/{code}")
def get_prequalification(code: str, user: dict = Depends(current_user)):
    with connection() as conn:
        row=conn.execute(_PREQUAL_SELECT+" WHERE p.code=%s",(code,)).fetchone()
        if not row: raise HTTPException(404,"Solicitud no encontrada.")
        if user["role"]=="asesor" and row["agency_id"]!=user["agency_id"]: raise HTTPException(403,"Solicitud fuera de tu agencia.")
        if user["role"]=="asociado" and row["user_id"]!=user["id"]: raise HTTPException(403,"Solicitud no autorizada.")
        history=conn.execute(
            """SELECT h.action,h.status,h.note,h.created_at,u.username FROM prequalification_history h
               LEFT JOIN users u ON u.id=h.user_id WHERE h.prequalification_id=%s ORDER BY h.id DESC""",(row["id"],)
        ).fetchall()
    item=_prequal_row_to_dict(dict(row))
    item["history"]=[{"action":h["action"],"status":h["status"],"note":h["note"],"date":h["created_at"].isoformat(),"user":h["username"] or "sistema"} for h in history]
    return {"ok":True,"item":item}


@app.patch("/api/prequalifications/{code}/followup")
def update_followup(code: str, payload: FollowupIn, user: dict = Depends(require_staff)):
    if payload.workflow_status not in WORKFLOW_STATUSES: raise HTTPException(400,"Estado inválido.")
    with connection() as conn:
        row=conn.execute("SELECT id,agency_id,workflow_status,advisor_notes FROM prequalifications WHERE code=%s",(code,)).fetchone()
        if not row: raise HTTPException(404,"Solicitud no encontrada.")
        if user["role"]=="asesor" and row["agency_id"]!=user["agency_id"]: raise HTTPException(403,"Solicitud fuera de tu agencia.")
        action="Seguimiento actualizado"
        if row["workflow_status"]!=payload.workflow_status: action=f"Estado actualizado a {payload.workflow_status}"
        conn.execute(
            """UPDATE prequalifications SET workflow_status=%s,advisor_notes=%s,assigned_advisor_id=%s,updated_at=NOW() WHERE id=%s""",
            (payload.workflow_status,payload.advisor_notes.strip(),user["id"],row["id"]),
        )
        conn.execute(
            """INSERT INTO prequalification_history(prequalification_id,user_id,action,status,note)
               VALUES (%s,%s,%s,%s,%s)""",
            (row["id"],user["id"],action,payload.workflow_status,payload.advisor_notes.strip()),
        )
        conn.commit()
    return {"ok":True}
# =========================================================
# HISTORIAL DE CONVERSACIONES
# =========================================================

@app.get("/api/chat/sessions")
def get_chat_sessions(
    user: dict = Depends(current_user)
):
    """
    Devuelve únicamente las conversaciones
    pertenecientes al usuario autenticado.
    """

    with connection() as conn:

        rows = conn.execute(
            """
            SELECT
                s.id,
                s.created_at,
                s.updated_at,

                (
                    SELECT m.content
                    FROM chat_messages m
                    WHERE m.chat_session_id = s.id
                      AND m.role = 'user'
                    ORDER BY m.created_at ASC, m.id ASC
                    LIMIT 1
                ) AS first_message,

                (
                    SELECT m.content
                    FROM chat_messages m
                    WHERE m.chat_session_id = s.id
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT 1
                ) AS last_message,

                (
                    SELECT COUNT(*)
                    FROM chat_messages m
                    WHERE m.chat_session_id = s.id
                ) AS message_count

            FROM chat_sessions s

            WHERE s.user_id = %s

            ORDER BY
                COALESCE(
                    s.updated_at,
                    s.created_at
                ) DESC

            LIMIT 50
            """,
            (user["id"],)
        ).fetchall()


    conversations = []


    for row in rows:

        first_message = (
            row["first_message"]
            or "Conversación con el asistente"
        ).strip()


        last_message = (
            row["last_message"]
            or ""
        ).strip()


        # Título corto
        title = first_message

        if len(title) > 65:
            title = title[:65].rstrip() + "..."


        # Vista previa
        preview = last_message

        if len(preview) > 100:
            preview = preview[:100].rstrip() + "..."


        conversations.append({
            "id": str(row["id"]),

            "title": title,

            "preview": preview,

            "messageCount": int(
                row["message_count"] or 0
            ),

            "createdAt": (
                row["created_at"].isoformat()
                if row["created_at"]
                else None
            ),

            "updatedAt": (
                row["updated_at"].isoformat()
                if row["updated_at"]
                else (
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None
                )
            )
        })


    return {
        "ok": True,
        "conversations": conversations
    }


# =========================================================
# ABRIR UNA CONVERSACIÓN
# =========================================================

@app.get("/api/chat/sessions/{conversation_id}")
def get_chat_session(
    conversation_id: UUID,
    user: dict = Depends(current_user)
):

    with connection() as conn:

        session = conn.execute(
            """
            SELECT
                id,
                user_id,
                created_at,
                updated_at

            FROM chat_sessions

            WHERE id = %s
              AND user_id = %s

            LIMIT 1
            """,
            (
                conversation_id,
                user["id"]
            )
        ).fetchone()


        if not session:

            raise HTTPException(
                status_code=404,
                detail="La conversación no existe o no pertenece a tu usuario."
            )


        rows = conn.execute(
            """
            SELECT
                id,
                role,
                content,
                created_at

            FROM chat_messages

            WHERE chat_session_id = %s

            ORDER BY
                created_at ASC,
                id ASC
            """,
            (conversation_id,)
        ).fetchall()


    conversation_messages = []


    for row in rows:

        conversation_messages.append({
            "role": row["role"],
            "content": row["content"],
            "createdAt": (
                row["created_at"].isoformat()
                if row["created_at"]
                else None
            )
        })


    return {
        "ok": True,

        "conversationId": str(
            session["id"]
        ),

        "messages": conversation_messages
    }
@app.get("/api/portal/guest/chat/sessions/{conversation_id}")
def portal_guest_get_chat_session(conversation_id: UUID, request: Request):
    guest_hash = _guest_client_hash(request)
    with connection() as conn:
        session = conn.execute(
            "SELECT id,user_id,guest_hash FROM chat_sessions WHERE id=%s LIMIT 1",
            (conversation_id,),
        ).fetchone()
        if not session or session["user_id"] is not None or session.get("guest_hash") != guest_hash:
            raise HTTPException(404, "La conversación de visitante no está disponible.")
        rows = conn.execute(
            """SELECT role,content,created_at
               FROM chat_messages
               WHERE chat_session_id=%s
               ORDER BY created_at ASC,id ASC""",
            (conversation_id,),
        ).fetchall()

    return {
        "ok": True,
        "conversationId": str(session["id"]),
        "messages": [
            {
                "role": row["role"],
                "content": row["content"],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            }
            for row in rows
        ],
    }


@app.post("/api/portal/guest/chat")
def portal_guest_chat(payload: ChatIn, request: Request):
    guest_hash = _consume_guest_chat_quota(request)
    conversation_id = payload.conversation_id or uuid4()

    with connection() as conn:
        session = conn.execute(
            "SELECT id,user_id,guest_hash FROM chat_sessions WHERE id=%s",
            (conversation_id,),
        ).fetchone()
        if session:
            if session["user_id"] is not None or session.get("guest_hash") != guest_hash:
                raise HTTPException(403, "Conversación no autorizada.")
        else:
            conn.execute(
                "INSERT INTO chat_sessions(id,user_id,guest_hash) VALUES (%s,NULL,%s)",
                (conversation_id, guest_hash),
            )

        history = conn.execute(
            "SELECT role,content FROM chat_messages WHERE chat_session_id=%s ORDER BY id DESC LIMIT 8",
            (conversation_id,),
        ).fetchall()
        history = [dict(x) for x in reversed(history)]
        conn.execute(
            "INSERT INTO chat_messages(chat_session_id,user_id,role,content) VALUES (%s,NULL,'user',%s)",
            (conversation_id, payload.message.strip()),
        )
        conn.commit()

    try:
        result = rag_answer(payload.message.strip(), history, None, conversation_id)
    except Exception as exc:
        logger.exception("Fallo al generar respuesta RAG para visitante")
        raise HTTPException(503, "En este momento la información se está procesando. Intenta nuevamente en unos minutos o comunícate con COLUA al +502 7795-7795.") from exc

    # El visitante puede informarse, pero la precalificación siempre exige inicio de sesión.
    result["action"] = None

    with connection() as conn:
        conn.execute(
            """INSERT INTO chat_messages(chat_session_id,user_id,role,content,provider,model,sources)
               VALUES (%s,NULL,'assistant',%s,%s,%s,%s::jsonb)""",
            (
                conversation_id, result["answer"], result["provider"],
                result["model"], json.dumps(result["sources"], ensure_ascii=False),
            ),
        )
        conn.execute("UPDATE chat_sessions SET updated_at=NOW() WHERE id=%s", (conversation_id,))
        conn.commit()

    return {"ok": True, "conversationId": str(conversation_id), "guest": True, **result}


@app.get("/api/portal/chat/sessions/{conversation_id}")
def portal_get_chat_session(conversation_id: UUID, user: dict = Depends(portal_user)):
    with connection() as conn:
        session = conn.execute(
            "SELECT id,user_id FROM chat_sessions WHERE id=%s AND user_id=%s LIMIT 1",
            (conversation_id, user["id"]),
        ).fetchone()
        if not session:
            raise HTTPException(404, "La conversación no existe o no pertenece a tu usuario.")

        rows = conn.execute(
            """SELECT role,content,created_at
               FROM chat_messages
               WHERE chat_session_id=%s
               ORDER BY created_at ASC,id ASC""",
            (conversation_id,),
        ).fetchall()

    return {
        "ok": True,
        "conversationId": str(session["id"]),
        "messages": [
            {
                "role": row["role"],
                "content": row["content"],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            }
            for row in rows
        ],
    }


@app.post("/api/portal/chat")
def portal_chat(payload: ChatIn, user: dict = Depends(portal_user)):
    conversation_id = payload.conversation_id or uuid4()

    with connection() as conn:
        session = conn.execute(
            "SELECT id,user_id FROM chat_sessions WHERE id=%s",
            (conversation_id,),
        ).fetchone()
        if session and session["user_id"] != user["id"]:
            raise HTTPException(403, "Conversación no autorizada.")
        if not session:
            conn.execute(
                "INSERT INTO chat_sessions(id,user_id) VALUES (%s,%s)",
                (conversation_id, user["id"]),
            )

        history = conn.execute(
            "SELECT role,content FROM chat_messages WHERE chat_session_id=%s ORDER BY id DESC LIMIT 8",
            (conversation_id,),
        ).fetchall()
        history = [dict(x) for x in reversed(history)]

        conn.execute(
            "INSERT INTO chat_messages(chat_session_id,user_id,role,content) VALUES (%s,%s,'user',%s)",
            (conversation_id, user["id"], payload.message.strip()),
        )
        conn.commit()

    try:
        result = rag_answer(payload.message.strip(), history, user["id"], conversation_id)
    except Exception as exc:
        logger.exception("Fallo al generar respuesta RAG desde COLUA Web")
        raise HTTPException(503, "En este momento la información se está procesando. Intenta nuevamente en unos minutos o comunícate con COLUA al +502 7795-7795.") from exc

    with connection() as conn:
        conn.execute(
            """INSERT INTO chat_messages(chat_session_id,user_id,role,content,provider,model,sources)
               VALUES (%s,%s,'assistant',%s,%s,%s,%s::jsonb)""",
            (
                conversation_id, user["id"], result["answer"], result["provider"],
                result["model"], json.dumps(result["sources"], ensure_ascii=False),
            ),
        )
        conn.execute("UPDATE chat_sessions SET updated_at=NOW() WHERE id=%s", (conversation_id,))
        conn.commit()

    return {"ok": True, "conversationId": str(conversation_id), **result}


@app.post("/api/chat")
def chat(payload: ChatIn, user: dict = Depends(require_csrf)):
    conversation_id=payload.conversation_id or uuid4()
    with connection() as conn:
        session=conn.execute("SELECT id,user_id FROM chat_sessions WHERE id=%s",(conversation_id,)).fetchone()
        if session and session["user_id"] not in {None,user["id"]}: raise HTTPException(403,"Conversación no autorizada.")
        if not session:
            conn.execute("INSERT INTO chat_sessions(id,user_id) VALUES (%s,%s)",(conversation_id,user["id"]))
        history=conn.execute(
            "SELECT role,content FROM chat_messages WHERE chat_session_id=%s ORDER BY id DESC LIMIT 8",(conversation_id,)
        ).fetchall()
        history=[dict(x) for x in reversed(history)]
        conn.execute(
            "INSERT INTO chat_messages(chat_session_id,user_id,role,content) VALUES (%s,%s,'user',%s)",
            (conversation_id,user["id"],payload.message.strip()),
        )
        conn.commit()
    try:
        result=rag_answer(payload.message.strip(),history,user["id"],conversation_id)
    except Exception as exc:
        logger.exception("Fallo al generar respuesta RAG")
        raise HTTPException(503,"En este momento la información se está procesando. Intenta nuevamente en unos minutos o comunícate con COLUA al +502 7795-7795.") from exc
    with connection() as conn:
        conn.execute(
            """INSERT INTO chat_messages(chat_session_id,user_id,role,content,provider,model,sources)
               VALUES (%s,%s,'assistant',%s,%s,%s,%s::jsonb)""",
            (conversation_id,user["id"],result["answer"],result["provider"],result["model"],json.dumps(result["sources"],ensure_ascii=False)),
        )
        conn.execute("UPDATE chat_sessions SET updated_at=NOW() WHERE id=%s",(conversation_id,))
        conn.commit()
    return {"ok":True,"conversationId":str(conversation_id),**result}


@app.get("/api/analytics/summary")
def analytics(user: dict = Depends(current_user)):
    if user["role"]!="administrador": raise HTTPException(403,"Acceso reservado para administración.")
    with connection() as conn:
        q=conn.execute("SELECT COUNT(*) AS n FROM chat_messages WHERE role='user'").fetchone()["n"]
        sessions=conn.execute("SELECT COUNT(*) AS n FROM chat_sessions").fetchone()["n"]
        preq=conn.execute("SELECT COUNT(*) AS n FROM prequalifications").fetchone()["n"]
        usage=conn.execute("SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens FROM llm_usage").fetchone()
        by_agency=conn.execute("""SELECT a.name,COUNT(*) AS n FROM prequalifications p JOIN agencies a ON a.id=p.agency_id GROUP BY a.name ORDER BY n DESC LIMIT 10""").fetchall()
        recent_queries=conn.execute("""
            SELECT m.created_at,u.username,COALESCE(a.name,'No indicada') AS agency,m.content
            FROM chat_messages m
            LEFT JOIN users u ON u.id=m.user_id
            LEFT JOIN agencies a ON a.id=u.agency_id
            WHERE m.role='user' ORDER BY m.id DESC LIMIT 12
        """).fetchall()
        recent_prequals=conn.execute(_PREQUAL_SELECT+" ORDER BY p.created_at DESC LIMIT 12").fetchall()
    return {
        "ok":True,"totalQueries":q,"totalSessions":sessions,"totalPrequalifications":preq,
        "inputTokens":usage["input_tokens"],"outputTokens":usage["output_tokens"],
        "byAgency":[dict(x) for x in by_agency],
        "recentQueries":[{
            "date":x["created_at"].isoformat(),"user":x["username"] or "anónimo",
            "agency":x["agency"],"topic":"RAG","text":x["content"][:160]
        } for x in recent_queries],
        "recentPrequalifications":[_prequal_row_to_dict(dict(x)) for x in recent_prequals]
    }


@app.get("/api/admin/users")
def admin_users(user: dict = Depends(current_user)):
    if user["role"]!="administrador": raise HTTPException(403,"Acceso reservado para administración.")
    with connection() as conn:
        rows=conn.execute(
            """SELECT u.id,u.username,u.name,u.role,u.agency_id,a.name AS agency,u.active,u.must_change_password,u.created_at
               FROM users u LEFT JOIN agencies a ON a.id=u.agency_id ORDER BY u.role,u.username"""
        ).fetchall()
    return {"ok":True,"users":[dict(x) for x in rows]}


@app.post("/api/admin/users")
def admin_create_user(payload: AdminCreateUserIn, user: dict = Depends(require_admin)):
    username=payload.username.strip().lower()
    if payload.role not in {"asesor","asociado"}: raise HTTPException(400,"Rol no permitido.")
    if not re.fullmatch(r"[a-z0-9._-]{4,60}",username): raise HTTPException(400,"Usuario inválido.")
    if not password_is_strong(payload.temporary_password): raise HTTPException(400,"La contraseña temporal debe tener al menos 10 caracteres, letras y números.")
    if payload.role=="asesor" and not payload.agency_id: raise HTTPException(400,"Un asesor debe tener agencia asignada.")
    with connection() as conn:
        if conn.execute("SELECT 1 FROM users WHERE username=%s",(username,)).fetchone(): raise HTTPException(409,"El usuario ya existe.")
        if payload.agency_id and not conn.execute("SELECT 1 FROM agencies WHERE id=%s AND active=TRUE",(payload.agency_id,)).fetchone(): raise HTTPException(400,"Agencia inválida.")
        if payload.role=="asesor" and conn.execute("SELECT 1 FROM users WHERE role='asesor' AND agency_id=%s AND active=TRUE",(payload.agency_id,)).fetchone():
            raise HTTPException(409,"Esa agencia ya tiene un asesor activo.")
        conn.execute(
            """INSERT INTO users(username,password_hash,name,role,agency_id,must_change_password)
               VALUES (%s,%s,%s,%s,%s,TRUE)""",
            (username,hash_password(payload.temporary_password),payload.name.strip(),payload.role,payload.agency_id),
        )
        conn.commit()
    return {"ok":True,"message":"Usuario creado. Deberá cambiar la contraseña al ingresar."}


@app.post("/api/admin/users/{user_id}/reset-password")
def admin_reset_password(user_id: int, payload: AdminResetPasswordIn, user: dict = Depends(require_admin)):
    if user_id == user["id"]:
        raise HTTPException(400,"Para cambiar tu propia contraseña usa Mi perfil. Si la olvidaste, utiliza manage.py desde el servidor.")
    if not password_is_strong(payload.new_password): raise HTTPException(400,"La contraseña debe tener al menos 10 caracteres, letras y números.")
    with connection() as conn:
        target=conn.execute("SELECT id FROM users WHERE id=%s",(user_id,)).fetchone()
        if not target: raise HTTPException(404,"Usuario no encontrado.")
        conn.execute("UPDATE users SET password_hash=%s,must_change_password=TRUE,updated_at=NOW() WHERE id=%s",(hash_password(payload.new_password),user_id))
        conn.execute("DELETE FROM sessions WHERE user_id=%s",(user_id,))
        conn.commit()
    return {"ok":True,"message":"Contraseña restablecida. El usuario deberá cambiarla al ingresar."}


@app.patch("/api/admin/users/{user_id}/active")
def admin_toggle_active(user_id: int, user: dict = Depends(require_admin)):
    if user_id==user["id"]: raise HTTPException(400,"No puedes desactivar tu propia cuenta.")
    with connection() as conn:
        target=conn.execute("SELECT active,role,agency_id FROM users WHERE id=%s",(user_id,)).fetchone()
        if not target: raise HTTPException(404,"Usuario no encontrado.")
        new_value=not target["active"]
        if new_value and target["role"]=="asesor" and target["agency_id"]:
            other=conn.execute(
                "SELECT id FROM users WHERE role='asesor' AND agency_id=%s AND active=TRUE AND id<>%s",
                (target["agency_id"],user_id),
            ).fetchone()
            if other:
                raise HTTPException(409,"No se puede activar: la agencia ya tiene otro asesor activo.")
        conn.execute("UPDATE users SET active=%s,updated_at=NOW() WHERE id=%s",(new_value,user_id))
        if not new_value: conn.execute("DELETE FROM sessions WHERE user_id=%s",(user_id,))
        conn.commit()
    return {"ok":True,"active":new_value}


@app.get("/")
def index(): return FileResponse(BASE_DIR / "index.html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
@app.get("/app.js")
def javascript(): return FileResponse(BASE_DIR / "app.js", media_type="application/javascript", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
@app.get("/styles.css")
def stylesheet(): return FileResponse(BASE_DIR / "styles.css", media_type="text/css", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
app.mount("/assets", StaticFiles(directory=ASSET_DIR), name="assets")

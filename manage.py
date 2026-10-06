from __future__ import annotations
import argparse
import getpass
import json
import re
from backend.config import settings
from backend.db import pool, connection
from backend.security import hash_password, password_is_strong


def _open_pool():
    pool.open(wait=True)


def reset_admin_password():
    _open_pool()
    try:
        with connection() as conn:
            row=conn.execute("SELECT id FROM users WHERE username=%s",(settings.admin_username,)).fetchone()
            if not row:
                raise SystemExit("No existe el administrador en la base de datos.")
            password=getpass.getpass("Nueva contraseña del administrador: ")
            confirm=getpass.getpass("Confirmar contraseña: ")
            if password!=confirm:
                raise SystemExit("Las contraseñas no coinciden.")
            if not password_is_strong(password):
                raise SystemExit("Usa al menos 10 caracteres, letras y números.")
            conn.execute(
                "UPDATE users SET password_hash=%s,must_change_password=FALSE,updated_at=NOW() WHERE id=%s",
                (hash_password(password),row["id"]),
            )
            conn.execute("DELETE FROM sessions WHERE user_id=%s",(row["id"],))
            conn.commit()
            print("Contraseña del administrador restablecida. Todas sus sesiones previas fueron cerradas.")
    finally:
        pool.close()


def add_agency():
    """Agrega/actualiza una agencia confirmada internamente sin editar código."""
    agency_id=input("Código/slug de agencia (ej. nueva-agencia): ").strip().lower()
    if not re.fullmatch(r"[a-z0-9-]{3,60}",agency_id):
        raise SystemExit("Código inválido. Usa minúsculas, números y guiones.")
    name=input("Nombre oficial: ").strip()
    department=input("Departamento: ").strip()
    phones_raw=input("Teléfonos separados por coma: ").strip()
    phones=[x.strip() for x in phones_raw.split(",") if x.strip()]
    if len(name)<3:
        raise SystemExit("Nombre inválido.")
    _open_pool()
    try:
        with connection() as conn:
            conn.execute(
                """INSERT INTO agencies(id,name,department,phones,active)
                   VALUES (%s,%s,%s,%s::jsonb,TRUE)
                   ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,department=EXCLUDED.department,
                     phones=EXCLUDED.phones,active=TRUE""",
                (agency_id,name,department,json.dumps(phones,ensure_ascii=False)),
            )
            conn.commit()
        print(f"Agencia guardada: {agency_id} · {name}")
    finally:
        pool.close()


if __name__=="__main__":
    parser=argparse.ArgumentParser(description="Herramientas administrativas COLUA")
    parser.add_argument("command",choices=["reset-admin-password","add-agency"])
    args=parser.parse_args()
    if args.command=="reset-admin-password":
        reset_admin_password()
    elif args.command=="add-agency":
        add_agency()

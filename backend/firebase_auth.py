from __future__ import annotations

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token

from .config import settings

_google_request = GoogleAuthRequest()


def verify_firebase_id_token(token: str) -> dict:
    """Verifica el ID token emitido por Firebase Auth para el proyecto COLUA.

    Solo usa las claves públicas oficiales de Google/Firebase; no requiere
    una clave privada de servicio en el servidor.
    """
    if not token:
        raise ValueError("Token de Firebase ausente.")

    claims = id_token.verify_firebase_token(
        token,
        _google_request,
        audience=settings.firebase_project_id,
    )

    uid = str(claims.get("uid") or claims.get("sub") or "").strip()
    if not uid:
        raise ValueError("El token de Firebase no contiene UID.")

    issuer = str(claims.get("iss") or "")
    expected_issuer = f"https://securetoken.google.com/{settings.firebase_project_id}"
    if issuer != expected_issuer:
        raise ValueError("Emisor de Firebase inválido.")

    return claims

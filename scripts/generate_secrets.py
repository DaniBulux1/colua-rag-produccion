"""Genera secretos para configurar el hosting. No modifica archivos."""
import secrets

print("APP_SECRET_KEY=" + secrets.token_urlsafe(48))
print("DPI_PEPPER=" + secrets.token_urlsafe(48))

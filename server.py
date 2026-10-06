"""Entrada de producción/desarrollo para el backend COLUA.

Producción recomendada:
    uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 2

Toda la persistencia operativa se realiza en PostgreSQL; el navegador no guarda datos de negocio.
"""
import uvicorn
from backend.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=False
    )
# Despliegue de producción · COLUA RAG

## Secuencia recomendada

1. Crear una base PostgreSQL administrada con pgvector.
2. Crear las credenciales/API keys de OpenAI y, si se utilizará, Anthropic.
3. Configurar secretos en el hosting.
4. Desplegar el repositorio sin archivo `.env` real.
5. Arrancar una primera vez con `ADMIN_BOOTSTRAP_PASSWORD` configurada.
6. Iniciar sesión con el administrador y cambiar inmediatamente esa contraseña.
7. Eliminar `ADMIN_BOOTSTRAP_PASSWORD` de los secretos del hosting y reiniciar.
8. Cargar documentación aprobada en `knowledge_base/` y ejecutar `python scripts/ingest_knowledge.py` desde un job/terminal autorizada.
9. Crear los asesores desde el panel administrativo, uno por agencia.
10. Validar HTTPS, cookie segura, backup de PostgreSQL, logs y límites de gasto de los proveedores de IA.

## Variables mínimas para OpenAI

```env
DATABASE_URL=postgresql://...
APP_SECRET_KEY=...
DPI_PEPPER=...
COOKIE_SECURE=true
ADMIN_USERNAME=admin
OPENAI_API_KEY=...
LLM_PROVIDER=openai
OPENAI_CHAT_MODEL=gpt-5.6-luna
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

En el primer arranque agrega temporalmente:

```env
ADMIN_BOOTSTRAP_PASSWORD=...
```

Después de cambiar la contraseña del administrador, elimina esa variable.

## Variables para Claude como principal

```env
OPENAI_API_KEY=...          # embeddings RAG
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-5
LLM_FALLBACK_PROVIDER=openai
OPENAI_CHAT_MODEL=gpt-5.6-luna
```

## Health check

```text
GET /api/health
```

Debe devolver `ok: true`, el número de documentos/chunks indexados y el proveedor principal.

Si `documents=0` o `chunks=0`, el chat no tiene conocimiento documental cargado todavía. Ejecuta la ingestión.

## Escalamiento

El `Procfile` utiliza dos workers. Como las sesiones, usuarios y RAG están en PostgreSQL, los workers no dependen de memoria local para los datos de negocio.

Para fotografías de perfil y documentos muy grandes, la siguiente mejora recomendada es un bucket privado (por ejemplo S3) y almacenar en PostgreSQL solo metadatos/rutas. La versión actual guarda la fotografía optimizada en la base para mantenerla centralizada.

## Backups

Configura backups automáticos de PostgreSQL antes de uso real. Deben cubrir como mínimo:

- usuarios;
- agencias;
- sesiones activas según política de retención;
- precalificaciones;
- historial de seguimiento;
- conversaciones y fuentes;
- documentos/chunks RAG;
- métricas de tokens.


## Docker (opcional)

El proyecto incluye `Dockerfile`. Construye la imagen sin incorporar `.env` ni secretos:

```bash
docker build -t colua-rag .
```

En producción inyecta `DATABASE_URL`, claves de IA y demás secretos desde el orquestador/hosting. No uses `--env-file` con un archivo que vaya a quedar dentro de una imagen o repositorio.

El mismo contenedor puede ejecutarse en ECS/Fargate, App Runner, Render, Railway u otra plataforma compatible, apuntando siempre a PostgreSQL/pgvector administrado.

# Integración con COLUA Web Digital

Este backend es la autoridad de autenticación para los asociados que usan el chatbot y la precalificación en COLUA Web Digital.

## Desarrollo local

`.env`:

```env
COOKIE_SECURE=false
ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
```

Iniciar API:

```powershell
python server.py
```

Sincronizar el contenido del proyecto web local con el RAG:

```powershell
python scripts\ingest_colua_web.py --web-root "C:\xampp\htdocs\Colua-Web\web" --ingest
```

El sincronizador extrae texto visible de la SPA, genera `knowledge_base/08_colua_web_local.md` y utiliza el mismo pipeline de embeddings/pgvector existente.

## Identidad compartida

La tabla `users` incorpora correo y teléfono, además de usuario, rol, agencia y hash de DPI. El login puede realizarse por nombre de usuario o correo. La cookie de sesión es HttpOnly y las operaciones de escritura requieren CSRF.

Las tablas `chat_sessions`, `chat_messages` y `prequalifications` ya referencian `users.id`, por lo que la actividad del chatbot queda relacionada con la cuenta que inició sesión en el portal web.

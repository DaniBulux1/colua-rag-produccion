# COLUA · Asistente de precalificación crediticia con RAG en nube

Esta versión deja de usar usuarios, contraseñas, sesiones, precalificaciones o conocimiento RAG almacenado en el navegador. La aplicación está preparada para un despliegue cliente-servidor con:

- **FastAPI** como backend.
- **PostgreSQL + pgvector** como base de datos central y almacén vectorial RAG.
- **Argon2id** para contraseñas.
- Sesiones opacas guardadas en PostgreSQL y cookie **HttpOnly + Secure + SameSite=Lax**.
- Protección **CSRF** para operaciones que modifican datos.
- **OpenAI Embeddings** para búsqueda semántica.
- Generación configurable con **OpenAI** o **Claude (Anthropic)**.
- Fallback opcional entre proveedores de IA, siempre en nube. **No existe fallback RAG local**.
- Usuarios de asesores creados por el administrador, no escritos en JavaScript ni Python.
- Un asesor activo por agencia.
- Precalificaciones y seguimiento filtrados por agencia desde el **servidor**, no solamente desde la interfaz.
- Registro de consumo de tokens y latencia de embeddings/generación.

## 1. Arquitectura

```text
Navegador
   │ HTTPS
   ▼
FastAPI
   ├── Autenticación / sesiones / CSRF
   ├── Precalificación determinista
   ├── Panel de asesores por agencia
   ├── Administración de usuarios
   └── RAG
         │
         ├── OpenAI Embeddings
         │       │
         │       ▼
         │  PostgreSQL + pgvector
         │       │
         │       ▼
         │  Top-K fragmentos
         │
         └── OpenAI Responses API
             o Claude Messages API
                  │
                  ▼
              Respuesta + fuentes
```

La búsqueda RAG no se ejecuta contra archivos locales durante una conversación. Los documentos se **indexan previamente** y sus embeddings quedan guardados en PostgreSQL/pgvector. Los archivos de `knowledge_base/` son únicamente la fuente de ingestión/mantenimiento.

## 2. Usuarios y contraseñas

No hay cuentas de asociados ni asesores escritas en el código.

### Administrador inicial

El único usuario de arranque es el administrador. El nombre por defecto es `admin`, pero **su contraseña no existe en el repositorio**.

En el primer despliegue se configura temporalmente:

```env
ADMIN_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=UnaClaveTemporalSegura123!
```

En el primer inicio del backend:

1. Si el administrador todavía no existe, se crea en PostgreSQL.
2. La contraseña se transforma inmediatamente a un **hash Argon2id**.
3. El usuario queda marcado con `must_change_password=true`.
4. Al iniciar sesión, la interfaz solicita cambiar la contraseña.
5. Después del primer arranque, elimina `ADMIN_BOOTSTRAP_PASSWORD` de las variables del servidor.

Nunca publiques una contraseña real en `.env.example`, GitHub, `app.js` o `backend/*.py`.

### Restablecer la contraseña del administrador

Desde una terminal autorizada del servidor:

```bash
python manage.py reset-admin-password
```

El script solicita la nueva contraseña sin mostrarla en pantalla, actualiza el hash y cierra las sesiones activas del administrador.

### Crear asesores

El administrador ingresa a **Administración → Usuarios**, selecciona una agencia, define un usuario y una contraseña temporal. El backend:

- guarda únicamente el hash;
- obliga al asesor a cambiar la contraseña al iniciar;
- impide tener dos asesores activos para la misma agencia;
- permite restablecer la contraseña posteriormente;
- invalida las sesiones antiguas después de un restablecimiento.

Los asociados pueden crear su propia cuenta desde la interfaz. Su información también se guarda en PostgreSQL.

## 3. Requisitos del servidor

- Python 3.11 o superior.
- PostgreSQL 16+ recomendado.
- Extensión **pgvector** instalada en PostgreSQL.
- HTTPS en producción.
- Cuenta/API key de OpenAI.
- API key de Anthropic solamente si se usará Claude o el fallback de Claude.

El usuario de PostgreSQL utilizado por la aplicación debe poder ejecutar inicialmente:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Si tu proveedor administrado no permite hacerlo desde la aplicación, habilita `vector` una sola vez desde el panel o con un usuario con privilegios suficientes.

## 4. Instalación

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

### Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

En producción es preferible configurar las variables desde el administrador de secretos del hosting y **no crear un `.env` dentro del repositorio desplegado**.

## 5. Variables esenciales

Genera valores aleatorios largos para `APP_SECRET_KEY` y `DPI_PEPPER`. Puedes obtenerlos con `python scripts/generate_secrets.py` y copiarlos al administrador de secretos del hosting.

```env
DATABASE_URL=postgresql://usuario:clave@host:5432/colua
APP_SECRET_KEY=secreto-largo-y-aleatorio
DPI_PEPPER=otro-secreto-largo-y-distinto
COOKIE_SECURE=true

ADMIN_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=SOLO_PARA_EL_PRIMER_ARRANQUE
ADMIN_NAME=Administrador COLUA

OPENAI_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

RAG_TOP_K=5
RAG_MIN_SCORE=0.28
MAX_OUTPUT_TOKENS=650
```

## 6. Elegir OpenAI o Claude para responder

### Opción A · OpenAI como generador principal

```env
LLM_PROVIDER=openai
OPENAI_CHAT_MODEL=gpt-5.6-luna
OPENAI_API_KEY=...

LLM_FALLBACK_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-5
```

`gpt-5.6-luna` es una opción adecuada para alto volumen y costo controlado. Si necesitas mayor capacidad puedes cambiar a `gpt-5.6-terra` o `gpt-5.6-sol` sin modificar el código.

### Opción B · Claude como generador principal

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-5

LLM_FALLBACK_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_CHAT_MODEL=gpt-5.6-luna
```

**Importante:** en esta implementación el motor de recuperación usa **OpenAI Embeddings**, incluso si Claude genera la respuesta. Por lo tanto `OPENAI_API_KEY` sigue siendo obligatoria para indexar documentos y convertir cada consulta en un vector.

Si no deseas fallback entre proveedores:

```env
LLM_FALLBACK_PROVIDER=none
```

Si el proveedor principal falla y no existe un fallback de nube configurado, el chat devuelve un error temporal y **no inventa una respuesta desde datos locales**.

## 7. Cómo alimentar el RAG

Coloca únicamente documentación aprobada por COLUA en:

```text
knowledge_base/
```

Formatos soportados actualmente:

- `.pdf`
- `.md`
- `.txt`

Ejemplos de documentos recomendados:

- requisitos vigentes por producto;
- políticas autorizadas para consulta del asociado;
- preguntas frecuentes;
- información de agencias;
- manuales de productos;
- condiciones y restricciones que sí puedan comunicarse públicamente.

No incluyas información que la institución no autorice enviar al proveedor de IA.

Después ejecuta:

```bash
python scripts/ingest_knowledge.py
```

El proceso realiza:

```text
Documento
   ↓
Extracción de texto
   ↓
Fragmentos (~650 tokens, 100 de solapamiento)
   ↓
OpenAI Embeddings
   ↓
PostgreSQL + pgvector
```

Los documentos con el mismo checksum se omiten. Si reemplazas un archivo por una versión nueva con el mismo nombre, sus fragmentos anteriores se sustituyen.

### Cuándo se consumen tokens

**Durante la indexación:** se consumen tokens de embeddings al convertir los fragmentos en vectores. Normalmente esto ocurre una vez por versión del documento.

**Durante cada pregunta:**

1. La pregunta consume tokens de embeddings para producir el vector de búsqueda.
2. pgvector recupera los fragmentos más cercanos. Esa consulta SQL no consume tokens del LLM.
3. Solo los fragmentos Top-K, el historial reciente y la pregunta se envían a OpenAI o Claude.
4. El modelo consume tokens de entrada y salida al redactar la respuesta.

El backend registra estos datos en `llm_usage`, y el panel administrativo muestra los totales de tokens de entrada y salida.

## 8. Arranque

Primero indexa la documentación. Luego:

```bash
python server.py
```

O directamente:

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

En producción utiliza el comando del `Procfile` o el equivalente de tu plataforma.

Con `COOKIE_SECURE=true` las sesiones requieren HTTPS. Para una prueba estrictamente local puedes establecer temporalmente `COOKIE_SECURE=false`, pero **no lo uses así en producción**.

## 9. Flujo de precalificación

La IA no decide si un crédito se aprueba o rechaza.

```text
Chat RAG                      Precalificación
   │                               │
   ├─ productos                    ├─ ingresos
   ├─ requisitos                   ├─ obligaciones
   ├─ agencias                     ├─ monto solicitado
   ├─ preguntas frecuentes         ├─ empleo / antigüedad
   └─ información autorizada       └─ datos de contacto
                                   │
                                   ▼
                            Cálculos en Python
                                   │
                                   ▼
                          Revisión por asesor
```

Los cálculos básicos son deterministas en Python. El LLM no inventa una tasa, score, monto máximo ni decisión crediticia.

## 10. Separación por agencia

La seguridad no depende del filtro visual de JavaScript.

La página institucional de COLUA indica 24 agencias, mientras que el directorio público consultado actualmente enumera 23 nombres. Por seguridad, el proyecto no inventa la agencia faltante: se incluyen las agencias identificables del directorio y la tabla `agencies` está preparada para incorporar la agencia número 24 en cuanto se confirme internamente su nombre/código exacto. Para agregarla sin editar código ejecuta `python manage.py add-agency` desde una terminal autorizada.

- Un asociado consulta sus propias solicitudes.
- Un asesor recibe del backend únicamente las solicitudes de su agencia.
- Un administrador puede consultar todas.

El backend vuelve a verificar la agencia al abrir y actualizar cada precalificación.

## 11. Datos sensibles

- Contraseñas: Argon2id.
- DPI: no se conserva en texto plano; se guarda HMAC-SHA256 + últimos cuatro dígitos.
- Sesión: token aleatorio, con su hash almacenado en PostgreSQL.
- Cookie: HttpOnly/Secure/SameSite.
- Operaciones de escritura: CSRF.
- OpenAI Responses se invoca con `store=False` en esta aplicación.

Antes del despliegue institucional debe existir aprobación de Seguridad/Legal sobre qué documentación y qué datos pueden enviarse a OpenAI o Anthropic.

## 12. Archivos principales

```text
index.html
styles.css
app.js
server.py
manage.py
requirements.txt
.env.example

backend/
  config.py
  db.py
  security.py
  rag_service.py
  main.py

scripts/
  ingest_knowledge.py

knowledge_base/
  ...documentación aprobada...
```

## 13. Lo que ya no se usa

Esta versión elimina del proyecto operativo:

- cuentas de asesores de demostración;
- contraseñas hardcodeadas;
- `localStorage` y `sessionStorage` para datos de negocio;
- TF-IDF/RAG local;
- respuestas institucionales fijas como fallback del chatbot;
- SQLite como base de producción.


# Base documental para ingestión

Esta carpeta NO es el motor RAG de ejecución. Sirve como origen controlado para indexar documentos hacia PostgreSQL + pgvector.

1. Coloca aquí archivos `.pdf`, `.md` o `.txt` aprobados.
2. Ejecuta `python scripts/ingest_knowledge.py`.
3. Verifica `GET /api/health`.
4. El chatbot recuperará los vectores desde PostgreSQL durante cada consulta.

No incluyas secretos, contraseñas, expedientes personales ni documentación que COLUA no autorice enviar a los proveedores de IA configurados.
    
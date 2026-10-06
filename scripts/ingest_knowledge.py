from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.db import init_db, close_db
from backend.rag_service import ingest_file

ALLOWED={".md",".txt",".pdf"}

if __name__=="__main__":
    init_db()
    try:
        folder=ROOT/"knowledge_base"
        files=[p for p in sorted(folder.iterdir()) if p.is_file() and p.suffix.lower() in ALLOWED and not p.name.startswith("_")]
        if not files:
            raise SystemExit("No hay documentos para indexar en knowledge_base/.")
        for path in files:
            result=ingest_file(path)
            print(f"{path.name}: {result['status']} · {result['chunks']} fragmentos")
    finally:
        close_db()

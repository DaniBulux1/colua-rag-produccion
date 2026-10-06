"""Extrae contenido visible de COLUA Web Digital local y lo incorpora al RAG.

Uso recomendado durante desarrollo:
    python scripts/ingest_colua_web.py --web-root "C:\\ruta\\Colua-Web\\web" --ingest

Sin --ingest solamente genera/actualiza knowledge_base/08_colua_web_local.md.
"""
from __future__ import annotations

import argparse
import html
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in {"script", "style", "svg", "noscript"}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag.lower() in {"script", "style", "svg", "noscript"} and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            text = re.sub(r"\s+", " ", html.unescape(data)).strip()
            if text:
                self.parts.append(text)


def html_to_text(raw: str) -> str:
    parser = VisibleTextParser()
    try:
        parser.feed(raw)
    except Exception:
        pass
    return "\n".join(parser.parts)


def clean_lines(text: str) -> str:
    out: list[str] = []
    seen: set[str] = set()
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip(" \t-|")
        if len(line) < 3:
            continue
        # Descarta fragmentos claramente técnicos que no aportan conocimiento institucional.
        if re.search(r"\b(const|let|function|class|document\.|window\.|addEventListener|querySelector|innerHTML)\b", line):
            continue
        if line.count("{") + line.count("}") >= 2:
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
    return "\n".join(out)


def extract_js_templates(raw: str) -> str:
    blocks: list[str] = []
    # El portal construye la mayoría de secciones visibles con template literals.
    for match in re.finditer(r"`([\s\S]*?)`", raw):
        block = match.group(1)
        if len(block) < 40:
            continue
        block = re.sub(r"\$\{[^{}]*\}", " ", block)
        text = html_to_text(block)
        if text:
            blocks.append(text)
    return "\n".join(blocks)


def collect(web_root: Path) -> list[tuple[str, str]]:
    files = [web_root / "index.html"]
    component_dir = web_root / "js" / "components"
    for name in ["home.js", "sections.js", "noticias.js", "agencias.js", "navbar.js", "sidebar.js"]:
        files.append(component_dir / name)

    sections: list[tuple[str, str]] = []
    for path in files:
        if not path.exists():
            continue
        raw = path.read_text(encoding="utf-8", errors="replace")
        text = html_to_text(raw) if path.suffix.lower() == ".html" else extract_js_templates(raw)
        text = clean_lines(text)
        if text:
            sections.append((path.relative_to(web_root).as_posix(), text))
    return sections


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--web-root", required=True, help="Ruta a la carpeta web/ de Colua-Web")
    parser.add_argument("--output", default=str(BASE_DIR / "knowledge_base" / "08_colua_web_local.md"))
    parser.add_argument("--ingest", action="store_true", help="Además de exportar, genera embeddings y actualiza pgvector")
    args = parser.parse_args()

    web_root = Path(args.web_root).expanduser().resolve()
    if not (web_root / "index.html").exists():
        raise SystemExit(f"No se encontró index.html en: {web_root}")

    sections = collect(web_root)
    if not sections:
        raise SystemExit("No se encontró contenido visible para exportar.")

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    body = [
        "# Contenido de COLUA Web Digital (entorno local)",
        "Fuente: Proyecto local COLUA Web Digital",
        "Actualizado: generado automáticamente desde el frontend local",
        "",
        "Este documento es una instantánea del contenido visible del portal. No sustituye políticas internas ni documentos crediticios aprobados.",
        "",
    ]
    for rel, text in sections:
        body.extend([f"## Fuente web: {rel}", text, ""])
    output.write_text("\n".join(body), encoding="utf-8")
    print(f"Exportado: {output}")
    print(f"Secciones: {len(sections)}")

    if args.ingest:
        from backend.rag_service import ingest_file
        result = ingest_file(output)
        print(f"RAG: {result}")
    else:
        print("Para actualizar pgvector ejecuta nuevamente con --ingest.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

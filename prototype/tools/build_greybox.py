"""Build prototype/index.html from prototype/src/.

The greybox is kept as several source files (src/01_base.js ... src/08_main.js)
so each system is easy to read; this script inlines them, in order, into
src/shell.html. index.html stays a single file that opens straight from disk.

    python prototype/tools/build_greybox.py
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

def main():
    shell = (SRC / "shell.html").read_text(encoding="utf-8")
    parts = sorted(SRC.glob("[0-9][0-9]_*.js"))
    code = "\n".join(f"// ---- {p.name} ----\n" + p.read_text(encoding="utf-8") for p in parts)
    assert "/*@@CODE@@*/" in shell
    html = shell.replace("/*@@CODE@@*/", code)
    html = html.replace("<!-- generated -->", "")
    (ROOT / "index.html").write_text(html, encoding="utf-8")
    print("wrote", ROOT / "index.html", f"({len(parts)} source files, {len(html) // 1024} KB)")

if __name__ == "__main__":
    main()

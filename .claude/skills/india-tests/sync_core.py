"""Copy the shared core block from india_core.py into every india-* script.

A script opts in by holding the two marker lines; everything between them is
replaced by the reference copy. Run after editing india_core.py:

    python3 india-tests/sync_core.py                      # rewrite every india-* script
    python3 india-tests/sync_core.py india-entry/entry.py # rewrite only these files
    python3 india-tests/sync_core.py --check              # exit 1 if any copy drifted
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BEGIN = "# --- india core: begin"
END = "# --- india core: end"


def block(text):
    a = text.index(BEGIN)
    b = text.index(END, a) + len(END)
    return a, b


def reference():
    with open(os.path.join(HERE, "india_core.py"), encoding="utf-8") as fh:
        text = fh.read()
    a, b = block(text)
    return text[a:b]


def scripts():
    for d in sorted(os.listdir(ROOT)):
        if not d.startswith("india-") or d == "india-tests":
            continue
        folder = os.path.join(ROOT, d)
        for f in sorted(os.listdir(folder)):
            if f.endswith(".py"):
                yield os.path.join(folder, f)


def main(argv):
    ref = reference()
    drift = []
    only = [a for a in argv if not a.startswith("--")]
    paths = [p if os.path.isabs(p) else os.path.join(ROOT, p) for p in only] if only else list(scripts())
    for path in paths:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        if BEGIN not in text:
            continue
        a, b = block(text)
        if text[a:b] != ref:
            drift.append(os.path.relpath(path, ROOT))
            if "--check" not in argv:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text[:a] + ref + text[b:])
    for p in drift:
        print(("drifted: " if "--check" in argv else "synced: ") + p)
    return 1 if (drift and "--check" in argv) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

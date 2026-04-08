#!/usr/bin/env python3
"""Replace body: JSON.stringify with stringifyReducerCallBody and strip .toString() on ids."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src" / "hooks"
IMPORT = 'import { stringifyReducerCallBody } from "@lumiere/api-client"\n'
SKIP = {"realtime.ts"}


def add_import(text: str) -> str:
    if "stringifyReducerCallBody" in text:
        return text
    if not text.startswith('"use client"'):
        return IMPORT + text
    # After "use client" and optional block comment, before first `import`
    m = re.search(r'^"use client"\s*\n', text)
    if not m:
        return IMPORT + text
    rest = text[m.end() :]
    # Skip file-level block comments (e.g. workflows.ts)
    cm = re.match(r"(\s*/\*.*?\*/\s*\n)+", rest, re.DOTALL)
    insert = m.end()
    if cm:
        insert += len(cm.group(0))
    return text[:insert] + "\n" + IMPORT + text[insert:]


def strip_to_string_calls(text: str) -> str:
    """Turn `foo.toString()` into `foo` for simple identifiers (SpacetimeDB u64 args)."""
    for _ in range(8):
        nxt = re.sub(
            r"(?<![.\w])([a-zA-Z_][a-zA-Z0-9_]*)\.toString\(\)",
            r"\1",
            text,
        )
        if nxt == text:
            return nxt
        text = nxt
    return text


def main() -> None:
    for path in sorted(ROOT.glob("*.ts")):
        if path.name in SKIP:
            continue
        text = path.read_text()
        if "body: JSON.stringify" not in text:
            continue
        text = add_import(text)
        text = text.replace("body: JSON.stringify(", "body: stringifyReducerCallBody(")
        text = strip_to_string_calls(text)
        path.write_text(text)
        print(path.name)


if __name__ == "__main__":
    main()

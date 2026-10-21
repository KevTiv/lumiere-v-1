#!/usr/bin/env python3
"""Generate HTTP Option metadata from the authoritative STDB TypeScript bindings.

Use .contracts-staging/ts/generated/types.ts, populated by either the STDB SDK
generator or contracts-staging-from-pinned. Never read the frontend proxy file.
The field types retain the wire schema's integer signedness; consumers can
distinguish optional foreign keys from numeric values without losing zero.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re


OBJECT = re.compile(
    r'export const (\w+) = __t\.object\("(\w+)", \{(.*?)\n\}\);', re.S
)
FIELD = re.compile(
    r"^  (\w+): ([^\n]+),$|^  get (\w+)\(\) \{\s*return ([^;]+);\s*\},",
    re.M,
)


def snake_case(name):
    # Keep byte-for-byte parity with stdb-params-json.camelToSnakeIdentifier.
    relation = re.fullmatch(r"(.*)(M2O|M2M|O2M)", name)
    if relation:
        base = re.sub(r"([a-z])(\d)", r"\1_\2", relation[1])
        base = re.sub(r"(\d)([A-Z])", r"\1_\2", base)
        base = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", base)
        return f"{base.lower()}_{relation[2].lower()}"
    name = name.replace("1K", "1k")
    name = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    name = re.sub(r"([a-z])(\d)", r"\1_\2", name)
    name = re.sub(r"(\d)([A-Z])", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()


def builder_type(expression):
    """Parse exactly the generated builders; reject unknown option shapes."""
    expression = expression.strip()
    scalar = re.fullmatch(r"__t\.(\w+)\(\)", expression)
    if scalar:
        return scalar[1]
    container = re.fullmatch(r"__t\.(option|array)\((.*)\)", expression, re.S)
    if container:
        return f"{container[1]}<{builder_type(container[2])}>"
    if re.fullmatch(r"[A-Za-z_]\w*", expression):
        return expression
    raise ValueError(f"unsupported generated type expression: {expression}")


def generate(types_text):
    types = {}
    objects = list(OBJECT.finditer(types_text))
    if not objects or len(objects) != len(re.findall(r"= __t\.object\(", types_text)):
        raise ValueError("unrecognized STDB object declarations in types.ts")
    for obj in objects:
        name, wire_name, body = obj.groups()
        if name != wire_name or name in types:
            raise ValueError(f"duplicate or mismatched object declaration: {name}")
        fields = {}
        option_count = 0
        for field in FIELD.finditer(body):
            plain_name, plain_expr, getter_name, getter_expr = field.groups()
            expression = plain_expr or getter_expr
            if not expression.startswith("__t.option("):
                continue
            option_count += 1
            kind = builder_type(expression)
            fields[snake_case(plain_name or getter_name)] = kind[len("option<"):-1]
        if option_count != body.count("__t.option(") - sum(
            value.count("option<") for value in fields.values()
        ):
            raise ValueError(f"unrecognized optional field in {name}")
        # Empty objects are retained internally to detect duplicate declarations.
        types[name] = fields
    option_types = {name: types[name] for name in sorted(types) if types[name]}
    option_fields = {name: list(fields) for name, fields in option_types.items()}
    return option_fields, option_types


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--types", type=Path, default=root / ".contracts-staging/ts/generated/types.ts")
    parser.add_argument("--out-dir", type=Path, default=root / "frontend/packages/stdb/src")
    parser.add_argument("--check", action="store_true", help="fail on metadata drift without writing")
    args = parser.parse_args()
    raw = args.types.read_bytes()
    fields, types = generate(raw.decode("utf-8"))
    outputs = {
        "stdb-http-option-fields.json": fields,
        "stdb-http-option-types.json": types,
    }
    for name, data in outputs.items():
        content = json.dumps(data, indent=2) + "\n"
        target = args.out_dir / name
        if args.check:
            if not target.is_file() or target.read_text(encoding="utf-8") != content:
                raise SystemExit(f"HTTP Option metadata is stale: {target}; run make generate-stdb-http-option-metadata")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
    print(f"HTTP Option metadata: {len(fields)} objects, {sum(map(len, fields.values()))} fields; source SHA256 {hashlib.sha256(raw).hexdigest()}")


if __name__ == "__main__":
    main()

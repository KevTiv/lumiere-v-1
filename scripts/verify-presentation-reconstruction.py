#!/usr/bin/env python3
"""Compare complete presentation rows after a disposable C7 reconstruction.

Requires STDB_HOST, C7_SOURCE_STDB_TOKEN, STDB_RECONSTRUCTION_READ_TOKEN and
C7_EVIDENCE_DIR. Uses only the named local presentation source/target fixtures.
Run while the source organization is frozen; prints counts/hashes, never tokens
or saved definitions. The generic C7 drill must already have completed.
"""
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def rows(host, module, token, table):
    request = Request(
        f"{host}/v1/database/{module}/sql",
        data=f"SELECT * FROM {table} LIMIT 1001".encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
    )
    with urlopen(request, timeout=30) as response:
        result, = json.load(response)
    names = [field["name"]["some"] for field in result["schema"]["elements"]]
    if len(result["rows"]) > 1000:
        raise SystemExit("disposable fixture exceeds the bounded row limit")
    return [dict(zip(names, row, strict=True)) for row in result["rows"]]


def main():
    host = required("STDB_HOST").rstrip("/")
    parsed = urlsplit(host)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise SystemExit("STDB_HOST must be a loopback HTTP origin")
    evidence = Path(required("C7_EVIDENCE_DIR"))
    coverage = json.loads((evidence / "coverage.json").read_text())
    replay = [json.loads((evidence / name).read_text()) for name in ["resume.json", "repeat.json"]]
    if coverage["organization_id"] != 1 or any(
            not report["verified"] or report["organization_id"] != 1
            or report["watermark"] != coverage["watermark"] for report in replay):
        raise SystemExit("verified resume/repeat evidence at the source watermark is required")
    source_token = required("C7_SOURCE_STDB_TOKEN")
    target_token = required("STDB_RECONSTRUCTION_READ_TOKEN")
    tables = {}
    other_org_rows = 0
    for table in ["presentation_module", "presentation_module_version"]:
        source = rows(host, "lumiere-c7-presentation-source", source_token, table)
        target = rows(host, "lumiere-c7-presentation-target", target_token, table)
        own = sorted([row for row in source if row["organization_id"] == 1], key=lambda row: row["id"])
        other_org_rows += sum(row["organization_id"] != 1 for row in source)
        if not own or any(row["organization_id"] != 1 for row in target):
            raise SystemExit(f"{table}: missing source rows or foreign organization restored")
        if own != sorted(target, key=lambda row: row["id"]):
            raise SystemExit(f"{table}: complete source and target rows differ")
        if table == "presentation_module_version":
            for row in own:
                if hashlib.sha256(row["definition_json"].encode()).hexdigest() != row["definition_hash"]:
                    raise SystemExit("saved definition hash mismatch")
        tables[table] = {"rows": len(own), "complete_rows_sha256": digest(own)}
    if not other_org_rows:
        raise SystemExit("a foreign organization source fixture is required")
    print(json.dumps({"verified": True, "organization_id": 1, "watermark": coverage["watermark"],
                      "tables": tables, "foreign_source_rows_excluded": other_org_rows}, indent=2))


if __name__ == "__main__":
    main()

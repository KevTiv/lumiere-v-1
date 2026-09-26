#!/usr/bin/env python3
"""Generate and ratchet the COV-00A operation ownership census."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_DIR = REPO_ROOT / "lumiere-codegen" / "operation-contracts"
COVERAGE_PATH = REPO_ROOT / "frontend" / "web" / "reports" / "reducer-coverage.json"
JSON_OUTPUT = REPO_ROOT / "docs" / "evidence" / "cov-00a-operation-census.json"
MARKDOWN_OUTPUT = REPO_ROOT / "docs" / "operation-classification-census.md"

VALID_DISPOSITIONS = {
    "primary-workflow",
    "secondary-advanced",
    "horizontal",
    "internal-support",
    "future-disabled",
    "obsolete/duplicate",
}

# Ownership comes from the canonical implementation path recorded in each
# immutable operation contract. Unknown paths fail closed instead of being
# classified from operation-name heuristics.
DOMAIN_OWNERS = {
    "accounting": "COV-08",
    "ai": "GOV/CAP",
    "analytics": "COV-20",
    "crm": "COV-03",
    "data_ops": "COV-22",
    "documents": "COV-18",
    "expenses": "COV-11",
    "fleet": "COV-15",
    "forms": "COV-22",
    "helpdesk": "COV-14",
    "hr": "COV-09",
    "integrations": "COV-23",
    "inventory": "COV-06",
    "iot": "COV-16",
    "manufacturing": "COV-07",
    "projects": "COV-10",
    "proposals": "COV-17",
    "purchasing": "COV-05",
    "sales": "COV-04",
    "subscriptions": "COV-12",
    "workflow": "COV-21",
}

CORE_FILE_OWNERS = {
    "audit.rs": "COV-23",
    "auth.rs": "COV-23",
    "billing.rs": "COV-23",
    "cold_tier_identity.rs": "COV-23",
    "country_pack.rs": "COV-23",
    "messaging.rs": "COV-19",
    "migrations.rs": "COV-23",
    "operational_messaging.rs": "COV-19",
    "organization.rs": "COV-23",
    "permissions.rs": "COV-23",
    "privacy.rs": "COV-23",
    "reconstruction.rs": "COV-23",
    "reference.rs": "COV-23",
    "users.rs": "COV-23",
    "utm.rs": "COV-03",
}

# These are source-backed cross-domain owners where the file's broad domain is
# not the product owner. This is ownership metadata only, not exposure policy.
OPERATION_OWNER_OVERRIDES = {
    "approve_document_processing_job": "COV-18",
    "bill_timesheets": "COV-10",
    "complete_document_processing_job": "COV-18",
    "create_calendar_event": "COV-19",
    "create_document_processing_job": "COV-18",
    "create_pos_terminal": "COV-13",
    "delete_calendar_event": "COV-19",
    "update_calendar_event": "COV-19",
    "update_pos_terminal": "COV-13",
    "upsert_warehouse_geo": "COV-06",
}

HORIZONTAL_OWNERS = {"COV-18", "COV-19", "COV-20", "COV-21", "COV-22"}

# Rust identifiers normalize digit boundaries differently from the immutable
# operation names. Keep the bridge explicit so neither side disappears from
# the reconciled denominator.
REDUCER_NAME_ALIASES = {
    "create_warehouse_3d_zone": "create_warehouse_3_d_zone",
    "delete_warehouse_3d_zone": "delete_warehouse_3_d_zone",
    "run_c0_organization_ownership_backfill": "run_c_0_organization_ownership_backfill",
    "update_warehouse_3d_zone": "update_warehouse_3_d_zone",
    "validate_c0_organization_ownership_backfill": "validate_c_0_organization_ownership_backfill",
}


def load_operations() -> dict[str, dict[str, Any]]:
    operations: dict[str, dict[str, Any]] = {}
    for path in sorted(CONTRACT_DIR.glob("*.json")):
        payload = json.loads(path.read_text())
        for name, contract in payload["operations"].items():
            if name in operations:
                raise ValueError(f"duplicate operation contract: {name}")
            operations[name] = {**contract, "contract_file": path.name}
    return operations


def load_coverage(operations: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    payload = json.loads(COVERAGE_PATH.read_text())
    coverage = {}
    for row in payload["rows"]:
        operation_name = REDUCER_NAME_ALIASES.get(row["reducer"], row["reducer"])
        if operation_name not in operations:
            raise ValueError(f"reducer missing from canonical operation contracts: {row['reducer']}")
        coverage[operation_name] = row
    return coverage


def source_path(evidence: str) -> str | None:
    if evidence.startswith("api-server/src/routes/messaging.rs"):
        return "api-server/src/routes/messaging.rs"
    match = re.search(r"(?:spacetimedb/src/)?([a-z_]+)/([a-z0-9_]+\.rs)", evidence)
    if match:
        return f"{match.group(1)}/{match.group(2)}"
    return None


def owner_for(name: str, contract: dict[str, Any]) -> tuple[str, str]:
    if name in OPERATION_OWNER_OVERRIDES:
        return OPERATION_OWNER_OVERRIDES[name], "explicit cross-domain source owner"

    path = source_path(contract["evidence"])
    if path == "api-server/src/routes/messaging.rs":
        return "COV-19", "authenticated operational-messaging route"
    if path:
        domain, filename = path.split("/", 1)
        if domain == "core":
            owner = CORE_FILE_OWNERS.get(filename)
            if owner:
                return owner, f"canonical source {path}"
        owner = DOMAIN_OWNERS.get(domain)
        if owner:
            return owner, f"canonical source domain {domain}"

    # These three contracts are locked to session exposure and their canonical
    # table/type implementation is inventory/warehouse.rs, despite stale IR
    # evidence text saying the reducer definition is absent.
    if name in {
        "create_warehouse_3_d_zone",
        "delete_warehouse_3_d_zone",
        "update_warehouse_3_d_zone",
    }:
        return "COV-06", "canonical Warehouse3DZone source and query owner"

    if not contract["client_facing"]:
        return "INTERNAL", "contract denies client exposure"
    return "REVIEW", "no canonical source owner matched"


def disposition_for(
    contract: dict[str, Any], owner: str, coverage: dict[str, Any] | None
) -> tuple[str, str]:
    if not contract["client_facing"]:
        return "internal-support", "contract client_facing=false"
    if owner == "REVIEW":
        return "REVIEW", "ownership must be resolved before disposition"

    status = coverage["status"] if coverage else "contract-only"
    classification = coverage["classification"] if coverage else None
    if classification == "import" or owner == "COV-22":
        return "horizontal", "import/forms horizontal owner"
    if status == "reachable-ui":
        if owner in HORIZONTAL_OWNERS:
            return "horizontal", "detected UI caller on horizontal surface"
        return "primary-workflow", "detected UI caller"
    if status in {"hook-only", "command-only", "backend-only", "contract-only"}:
        return "future-disabled", f"no detected UI caller ({status})"
    if status in {"needs-triage", "future-disabled"}:
        return "future-disabled", "no detected UI caller; fail-closed pending module admission"
    if status == "api-only-intentional":
        return "internal-support", "explicit API-only intent"
    if status == "internal-intentional":
        return "internal-support", "explicit internal intent"
    return "REVIEW", f"unhandled coverage status {status}"


def build_rows() -> list[dict[str, Any]]:
    operations = load_operations()
    coverage = load_coverage(operations)
    rows = []
    for name in sorted(operations):
        contract = operations[name]
        owner, owner_basis = owner_for(name, contract)
        reducer_coverage = coverage.get(name)
        disposition, disposition_basis = disposition_for(contract, owner, reducer_coverage)
        rows.append(
            {
                "operation": name,
                "contract_file": contract["contract_file"],
                "semantic_kind": contract["semantic_kind"],
                "client_facing": contract["client_facing"],
                "owner": owner,
                "disposition": disposition,
                "coverage_status": reducer_coverage["status"] if reducer_coverage else "contract-only",
                "reducer": reducer_coverage["reducer"] if reducer_coverage else None,
                "source": source_path(contract["evidence"]),
                "basis": f"{owner_basis}; {disposition_basis}",
            }
        )
    return rows


def validate(rows: list[dict[str, Any]]) -> list[str]:
    failures = []
    for row in rows:
        if row["client_facing"] and row["owner"] in {"", "REVIEW", "uncategorized"}:
            failures.append(f"{row['operation']}: unowned client-facing operation")
        if row["disposition"] not in VALID_DISPOSITIONS:
            failures.append(f"{row['operation']}: invalid disposition {row['disposition']}")
    return failures


def render_json(rows: list[dict[str, Any]]) -> str:
    client_rows = [row for row in rows if row["client_facing"]]
    summary = {
        "total_operations": len(rows),
        "client_facing_operations": len(client_rows),
        "non_client_operations": len(rows) - len(client_rows),
        "unowned_client_facing": sum(row["owner"] == "REVIEW" for row in client_rows),
        "review_required": sum(row["disposition"] == "REVIEW" for row in rows),
        "reconciled_reducer_rows": sum(row["reducer"] is not None for row in rows),
        "contract_only_operations": sum(row["reducer"] is None for row in rows),
        "by_owner": dict(sorted(Counter(row["owner"] for row in rows).items())),
        "by_disposition": dict(sorted(Counter(row["disposition"] for row in rows).items())),
    }
    return json.dumps({"schema_version": 1, "summary": summary, "operations": rows}, indent=2) + "\n"


def render_markdown(rows: list[dict[str, Any]]) -> str:
    payload = json.loads(render_json(rows))
    summary = payload["summary"]
    lines = [
        "# COV-00A operation classification census",
        "",
        "Generated by `scripts/generate-operation-census.py` from the immutable operation contracts and current reducer coverage evidence.",
        "",
        "This artifact classifies operation ownership and current disposition only. It does not admit a route into the first-org exposure denominator; COV-00B owns that decision.",
        "",
        "## Ratchet summary",
        "",
        "| Dimension | Count |",
        "| --- | ---: |",
        f"| Total contract operations | {summary['total_operations']} |",
        f"| Client-facing operations | {summary['client_facing_operations']} |",
        f"| Non-client operations | {summary['non_client_operations']} |",
        f"| Unowned client-facing operations | {summary['unowned_client_facing']} |",
        f"| Review-required rows | {summary['review_required']} |",
        f"| Reconciled Rust reducer rows | {summary['reconciled_reducer_rows']} |",
        f"| Contract-only operations | {summary['contract_only_operations']} |",
        "",
        "### Dispositions",
        "",
        "| Disposition | Count |",
        "| --- | ---: |",
    ]
    lines.extend(f"| `{key}` | {value} |" for key, value in summary["by_disposition"].items())
    lines.extend(["", "### Owners", "", "| Owner | Count |", "| --- | ---: |"])
    lines.extend(f"| `{key}` | {value} |" for key, value in summary["by_owner"].items())
    lines.extend(
        [
            "",
            "## Classification rules",
            "",
            "- Canonical contract evidence paths assign the owner; unknown client-facing paths fail the ratchet.",
            "- A detected UI caller is `primary-workflow` (or `horizontal` for horizontal owners).",
            "- Client-facing operations without a detected UI caller are conservatively `future-disabled`; this does not invent exposure.",
            "- Denied/internal/test operations are `internal-support`.",
            "- COV-00B remains authoritative for route/sidebar/command-palette exposure and Fleet `/map` ownership.",
            "",
            "## Operations",
            "",
            "| Operation | Client | Owner | Disposition | Coverage | Source |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for row in rows:
        source = row["source"] or "contract evidence"
        lines.append(
            f"| `{row['operation']}` | {'yes' if row['client_facing'] else 'no'} | "
            f"`{row['owner']}` | `{row['disposition']}` | `{row['coverage_status']}` | `{source}` |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    rows = build_rows()
    failures = validate(rows)
    json_text = render_json(rows)
    markdown_text = render_markdown(rows)

    if args.check:
        if not JSON_OUTPUT.exists() or JSON_OUTPUT.read_text() != json_text:
            failures.append(f"stale generated census: {JSON_OUTPUT.relative_to(REPO_ROOT)}")
        if not MARKDOWN_OUTPUT.exists() or MARKDOWN_OUTPUT.read_text() != markdown_text:
            failures.append(f"stale generated census: {MARKDOWN_OUTPUT.relative_to(REPO_ROOT)}")
    else:
        JSON_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        JSON_OUTPUT.write_text(json_text)
        MARKDOWN_OUTPUT.write_text(markdown_text)

    if failures:
        print("COV-00A operation census ratchet failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    summary = json.loads(json_text)["summary"]
    print(
        "COV-00A operation census: "
        f"{summary['total_operations']} total, "
        f"{summary['client_facing_operations']} client-facing, "
        f"{summary['unowned_client_facing']} unowned, "
        f"{summary['review_required']} review-required"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

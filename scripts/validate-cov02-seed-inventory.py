#!/usr/bin/env python3
"""Validate the COV-02 seed/persona authority and module-gap inventory."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = REPO_ROOT / "docs" / "evidence" / "cov-02-seed-persona-inventory.json"
COV00D_PATH = REPO_ROOT / "docs" / "evidence" / "cov-00d-lifecycle-evidence.json"

EXPECTED_AUTHORITIES = {
    "dev-demo-seed",
    "e2e-seed-wrapper",
    "browser-admin-bootstrap",
    "pretenant-actor-helper",
    "phase0-fixture-spec",
    "first-org-fixture-manifest",
}
EXPECTED_PERSONAS = {
    "organization-admin",
    "finance-accounting",
    "sales-crm",
    "warehouse-manufacturing",
    "purchasing",
    "hr-project",
    "limited-read-only",
}
VALID_PERSONA_STATUSES = {"defined", "partial", "absent"}
VALID_SEED_STATUSES = {"partial", "absent"}
REQUIRED_NEXT_CONTROLS = {
    "disposable-stack-execution",
    "persona-login-proof",
    "seed-health-capture",
    "iot-baseline",
    "independent-rerun",
}


def require_text(entry: dict[str, Any], field: str, label: str, failures: list[str]) -> None:
    value = entry.get(field)
    if not isinstance(value, str) or not value.strip():
        failures.append(f"{label}: missing {field}")


def require_list(entry: dict[str, Any], field: str, label: str, failures: list[str]) -> list[Any]:
    value = entry.get(field)
    if not isinstance(value, list) or not value:
        failures.append(f"{label}: missing {field}")
        return []
    return value


def validate_evidence(evidence: dict[str, Any], label: str, failures: list[str]) -> None:
    path_value = evidence.get("path")
    markers = evidence.get("markers")
    if not isinstance(path_value, str) or not path_value or Path(path_value).is_absolute():
        failures.append(f"{label}: evidence path must be repository-relative")
        return
    path = REPO_ROOT / path_value
    if not path.is_file():
        failures.append(f"{label}: missing evidence path {path_value!r}")
        return
    if not isinstance(markers, list) or not markers:
        failures.append(f"{label}: evidence markers are required")
        return
    source = path.read_text()
    for marker in markers:
        if not isinstance(marker, str) or not marker:
            failures.append(f"{label}: evidence marker must be non-empty text")
        elif marker not in source:
            failures.append(f"{label}: marker {marker!r} missing from {path_value}")


def validate_inventory(inventory: dict[str, Any], failures: list[str]) -> None:
    authorities = inventory.get("authorities")
    if not isinstance(authorities, list):
        failures.append("authorities must be a list")
        authorities = []
    authority_ids = [item.get("id") for item in authorities if isinstance(item, dict)]
    if len(authority_ids) != len(set(authority_ids)):
        failures.append("duplicate authority ids")
    if set(authority_ids) != EXPECTED_AUTHORITIES:
        failures.append("seed authorities do not match the accepted inventory denominator")

    for authority in authorities:
        if not isinstance(authority, dict):
            failures.append("authority must be an object")
            continue
        label = str(authority.get("id", "<authority>"))
        require_text(authority, "classification", label, failures)
        require_list(authority, "reusable_for", label, failures)
        require_list(authority, "limits", label, failures)
        validate_evidence(authority, label, failures)

    personas = inventory.get("personas")
    if not isinstance(personas, list):
        failures.append("personas must be a list")
        personas = []
    persona_keys = [item.get("key") for item in personas if isinstance(item, dict)]
    if len(persona_keys) != len(set(persona_keys)):
        failures.append("duplicate persona keys")
    if set(persona_keys) != EXPECTED_PERSONAS:
        failures.append("persona inventory must contain the seven required T0 personas")
    authority_id_set = set(authority_ids)
    for persona in personas:
        if not isinstance(persona, dict):
            failures.append("persona must be an object")
            continue
        label = str(persona.get("key", "<persona>"))
        if persona.get("status") not in VALID_PERSONA_STATUSES:
            failures.append(f"{label}: invalid persona status")
        require_text(persona, "gap", label, failures)
        refs = require_list(persona, "evidence_authorities", label, failures)
        unknown = set(refs) - authority_id_set
        if unknown:
            failures.append(f"{label}: unknown evidence authorities {sorted(unknown)}")

    accepted_rows = json.loads(COV00D_PATH.read_text()).get("rows", [])
    expected_modules = {row["id"]: row["surface"] for row in accepted_rows}
    modules = inventory.get("modules")
    if not isinstance(modules, list):
        failures.append("modules must be a list")
        modules = []
    module_ids = [item.get("id") for item in modules if isinstance(item, dict)]
    if len(module_ids) != len(set(module_ids)):
        failures.append("duplicate module ids")
    if set(module_ids) != set(expected_modules):
        failures.append("module inventory must contain exactly the accepted COV-03 through COV-24 owners")

    for module in modules:
        if not isinstance(module, dict):
            failures.append("module must be an object")
            continue
        module_id = str(module.get("id", "<module>"))
        if module.get("surface") != expected_modules.get(module_id):
            failures.append(f"{module_id}: surface does not match accepted COV-00D owner")
        if module.get("seed_status") not in VALID_SEED_STATUSES:
            failures.append(f"{module_id}: invalid seed_status")
        require_list(module, "gaps", module_id, failures)
        if module.get("next_package") != "COV-02C":
            failures.append(f"{module_id}: next_package must be COV-02C")
        for index, evidence in enumerate(require_list(module, "evidence", module_id, failures)):
            if not isinstance(evidence, dict):
                failures.append(f"{module_id}: evidence must be an object")
            else:
                validate_evidence(evidence, f"{module_id}/evidence[{index}]", failures)

    next_slice = inventory.get("minimum_next_slice")
    if not isinstance(next_slice, dict):
        failures.append("minimum_next_slice must be an object")
    else:
        if next_slice.get("id") != "COV-02C":
            failures.append("minimum_next_slice id must be COV-02C")
        require_text(next_slice, "objective", "minimum_next_slice", failures)
        controls = set(require_list(next_slice, "required_controls", "minimum_next_slice", failures))
        if controls != REQUIRED_NEXT_CONTROLS:
            failures.append("minimum_next_slice controls do not match the accepted deterministic fixture boundary")


def main() -> int:
    failures: list[str] = []
    try:
        inventory = json.loads(INVENTORY_PATH.read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(f"COV-02 seed inventory failed: {error}", file=sys.stderr)
        return 1

    if inventory.get("version") != 1:
        failures.append("inventory version must be 1")
    if inventory.get("status") != "implementation-candidate":
        failures.append("inventory status must be implementation-candidate")
    require_text(inventory, "audited_base", "inventory", failures)
    require_text(inventory, "scope", "inventory", failures)
    validate_inventory(inventory, failures)

    if failures:
        print("COV-02 seed inventory failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    modules = inventory["modules"]
    personas = inventory["personas"]
    module_counts = {
        status: sum(1 for row in modules if row["seed_status"] == status)
        for status in sorted(VALID_SEED_STATUSES)
    }
    persona_counts = {
        status: sum(1 for row in personas if row["status"] == status)
        for status in sorted(VALID_PERSONA_STATUSES)
    }
    print(
        "COV-02 seed/persona inventory: "
        f"{len(inventory['authorities'])} authorities, {len(modules)} module owners "
        f"{module_counts}, {len(personas)} personas {persona_counts}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate the COV-00D D/A/O/E evidence matrix and promotion ratchet."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
MATRIX_PATH = REPO_ROOT / "docs" / "evidence" / "cov-00d-lifecycle-evidence.json"
COV00C_PATH = REPO_ROOT / "docs" / "evidence" / "cov-00c-correctness-defects.json"
SURFACE_CATALOG = (
    REPO_ROOT / "frontend" / "packages" / "ui" / "src" / "lib" / "product-surface-catalog.ts"
)

EXPECTED_IDS = {f"COV-{index:02d}" for index in range(3, 25)}
EXPECTED_SURFACES = {
    "COV-03": ["crm"],
    "COV-04": ["sales"],
    "COV-05": ["purchasing"],
    "COV-06": ["inventory"],
    "COV-07": ["manufacturing"],
    "COV-08": ["accounting"],
    "COV-09": ["hr"],
    "COV-10": ["projects", "tasks"],
    "COV-11": ["expenses"],
    "COV-12": ["subscriptions"],
    "COV-13": ["pos"],
    "COV-14": ["helpdesk"],
    "COV-15": ["fleet"],
    "COV-16": ["iot"],
    "COV-17": ["proposals"],
    "COV-18": ["documents"],
    "COV-19": ["calendar", "messages"],
    "COV-20": ["reports"],
    "COV-21": ["approvals", "workflows"],
    "COV-22": [],
    "COV-23": ["settings"],
    "COV-24": ["distributor"],
}
DIMENSIONS = {"D", "A", "O", "E"}
VALID_EVIDENCE_STATUSES = {"proven", "partial", "absent", "not-applicable"}
VALID_FLOORS = {"U0", "U1", "U2", "U3", "U4", "U5"}
VALID_ADMISSIONS = {"enabled", "admin-only", "hidden", "review"}
VALID_OPERATOR_MODES = {"ui-primary", "mixed", "api-driven", "route-only", "absent"}


def fail_non_empty(entry: dict[str, Any], field: str, failures: list[str]) -> None:
    value = entry.get(field)
    if value is None or value == "" or value == []:
        failures.append(f"{entry.get('id', '<entry>')}: missing {field}")


def catalog_exposure(surface_id: str, catalog: str) -> str | None:
    pending = re.search(rf"pendingU5\(\s*\"{re.escape(surface_id)}\"\s*,", catalog)
    if pending:
        return "review"

    explicit = re.search(
        rf"\{{\s*id:\s*\"{re.escape(surface_id)}\"[\s\S]*?"
        r"firstOrgExposure:\s*\"(?P<exposure>enabled|admin-only|hidden|review)\"[\s\S]*?\n\s*\},",
        catalog,
    )
    return explicit.group("exposure") if explicit else None


def evidence_paths(dimension: dict[str, Any]) -> list[str]:
    evidence = dimension.get("evidence", [])
    if not isinstance(evidence, list):
        return []
    return [item.get("path", "") for item in evidence if isinstance(item, dict)]


def validate_matrix(matrix: dict[str, Any], failures: list[str]) -> None:
    rows = matrix.get("rows")
    if not isinstance(rows, list):
        failures.append("rows must be a list")
        return

    ids = [row.get("id") for row in rows if isinstance(row, dict)]
    if len(ids) != len(set(ids)):
        failures.append("duplicate COV ids")
    if set(ids) != EXPECTED_IDS:
        failures.append("matrix must contain exactly COV-03 through COV-24")

    cov00c = json.loads(COV00C_PATH.read_text())
    operator_bypass = set(cov00c["inventories"]["operator_bypass_files"])
    latest_paths = {
        site.split("::", 1)[0]
        for site in cov00c["inventories"]["latest_function_sites"]
    }
    catalog = SURFACE_CATALOG.read_text()

    for row in rows:
        if not isinstance(row, dict):
            failures.append("row must be an object")
            continue
        row_id = row.get("id")
        for field in (
            "surface",
            "primary_lifecycle",
            "current_floor",
            "launch_admission",
            "operator_evidence_mode",
            "dimensions",
            "missing_proof",
            "next_packages",
        ):
            fail_non_empty(row, field, failures)

        surface_ids = row.get("surface_ids")
        if surface_ids != EXPECTED_SURFACES.get(row_id):
            failures.append(
                f"{row_id}: surface_ids must be {EXPECTED_SURFACES.get(row_id)!r}"
            )

        floor = row.get("current_floor")
        admission = row.get("launch_admission")
        operator_mode = row.get("operator_evidence_mode")
        if floor not in VALID_FLOORS:
            failures.append(f"{row_id}: invalid current_floor {floor!r}")
        if admission not in VALID_ADMISSIONS:
            failures.append(f"{row_id}: invalid launch_admission {admission!r}")
        if operator_mode not in VALID_OPERATOR_MODES:
            failures.append(f"{row_id}: invalid operator_evidence_mode {operator_mode!r}")

        for surface_id in surface_ids or []:
            exposure = catalog_exposure(surface_id, catalog)
            if exposure is None:
                failures.append(f"{row_id}: surface {surface_id!r} missing from product catalog")
            elif exposure != admission:
                failures.append(
                    f"{row_id}: matrix admission {admission!r} does not match "
                    f"catalog {surface_id!r} exposure {exposure!r}"
                )

        dimensions = row.get("dimensions")
        if not isinstance(dimensions, dict) or set(dimensions) != DIMENSIONS:
            failures.append(f"{row_id}: dimensions must be exactly D/A/O/E")
            continue

        applicable_complete = True
        for key in sorted(DIMENSIONS):
            dimension = dimensions[key]
            if not isinstance(dimension, dict):
                failures.append(f"{row_id}/{key}: dimension must be an object")
                applicable_complete = False
                continue
            status = dimension.get("status")
            reason = dimension.get("reason")
            if status not in VALID_EVIDENCE_STATUSES:
                failures.append(f"{row_id}/{key}: invalid status {status!r}")
            if not isinstance(reason, str) or not reason.strip():
                failures.append(f"{row_id}/{key}: reason is required")
            paths = evidence_paths(dimension)
            if status in {"proven", "partial"} and not paths:
                failures.append(f"{row_id}/{key}: {status} requires concrete evidence")
            if status not in {"proven", "not-applicable"}:
                applicable_complete = False

            for item in dimension.get("evidence", []):
                if not isinstance(item, dict):
                    failures.append(f"{row_id}/{key}: evidence must be an object")
                    continue
                path_value = item.get("path")
                claim = item.get("claim")
                role = item.get("role")
                if not isinstance(path_value, str) or not (REPO_ROOT / path_value).is_file():
                    failures.append(f"{row_id}/{key}: missing evidence file {path_value!r}")
                if not isinstance(claim, str) or not claim.strip():
                    failures.append(f"{row_id}/{key}: evidence claim is required")
                if key == "O" and role not in {
                    "principal-operator-transition",
                    "partial-operator-transition",
                    "route-or-affordance-only",
                    "api-driven-transition",
                }:
                    failures.append(f"{row_id}/O: evidence role is invalid")

        o_dimension = dimensions["O"]
        if o_dimension.get("status") == "proven":
            if operator_mode != "ui-primary":
                failures.append(f"{row_id}: proven O requires ui-primary mode")
            principal = [
                item
                for item in o_dimension.get("evidence", [])
                if item.get("role") == "principal-operator-transition"
            ]
            if not principal:
                failures.append(f"{row_id}: proven O requires principal operator evidence")
            for item in principal:
                if item.get("path") in operator_bypass:
                    failures.append(
                        f"{row_id}: direct-BFF file cannot be sole proven operator evidence"
                    )
        elif operator_mode == "ui-primary":
            failures.append(f"{row_id}: ui-primary mode requires proven O")

        if dimensions["E"].get("status") == "proven":
            for path_value in evidence_paths(dimensions["E"]):
                if path_value in latest_paths:
                    failures.append(
                        f"{row_id}: latest/newest helper cannot be proven E evidence: {path_value}"
                    )

        if floor in {"U4", "U5"} and not applicable_complete:
            failures.append(f"{row_id}: {floor} claim requires complete applicable D/A/O/E")
        if admission in {"enabled", "admin-only"} and not applicable_complete:
            failures.append(
                f"{row_id}: launch admission requires complete applicable D/A/O/E"
            )


def main() -> int:
    failures: list[str] = []
    try:
        matrix = json.loads(MATRIX_PATH.read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(f"COV-00D evidence ratchet failed: {error}", file=sys.stderr)
        return 1

    if matrix.get("version") != 1:
        failures.append("matrix version must be 1")
    fail_non_empty(matrix, "audited_base", failures)
    if matrix.get("status") != "acceptance-candidate":
        failures.append("matrix status must be acceptance-candidate")

    validate_matrix(matrix, failures)

    if failures:
        print("COV-00D evidence ratchet failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    rows = matrix["rows"]
    counts = {
        key: {
            status: sum(1 for row in rows if row["dimensions"][key]["status"] == status)
            for status in sorted(VALID_EVIDENCE_STATUSES)
        }
        for key in sorted(DIMENSIONS)
    }
    print(
        "COV-00D lifecycle evidence: "
        f"{len(rows)} owners, D={counts['D']}, A={counts['A']}, "
        f"O={counts['O']}, E={counts['E']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

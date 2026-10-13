#!/usr/bin/env python3
"""Fail-closed COV-27 launch-manifest certification ratchet."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = REPO_ROOT / "docs/evidence/cov27-workforce-launch-manifest.json"
LIFECYCLE_PATH = REPO_ROOT / "docs/evidence/cov-00d-lifecycle-evidence.json"
OPERATIONS_PATH = REPO_ROOT / "docs/evidence/cov-00a-operation-census.json"
CATALOG_PATH = REPO_ROOT / "frontend/packages/ui/src/lib/product-surface-catalog.ts"
MODULE_ROUTES = REPO_ROOT / "frontend/web/app/(modules)"

VALID_GATES = {
    "admitted",
    "runtime-pending",
    "evidence-incomplete",
    "blocked-by-visible-stubs",
}
ADMITTED_EXPOSURES = {"enabled", "admin-only"}
VALID_DISPOSITIONS = {
    "primary-workflow",
    "secondary-advanced",
    "horizontal",
    "internal-support",
    "future-disabled",
    "obsolete/duplicate",
}
VISIBLE_STUB_PATTERNS = (
    "stp-stub-",
    "data-visible-stub",
    "VisibleStub",
    "coming soon",
    "not implemented",
    "STP unavailable",
)


def catalog_exposure(surface_id: str, catalog: str) -> str | None:
    pending = re.search(rf'pendingU5\(\s*"{re.escape(surface_id)}"\s*,', catalog)
    if pending:
        return "review"
    explicit = re.search(
        rf'\{{\s*id:\s*"{re.escape(surface_id)}"[\s\S]*?'
        r'firstOrgExposure:\s*"(?P<exposure>enabled|admin-only|hidden|review)"[\s\S]*?\n\s*\},',
        catalog,
    )
    return explicit.group("exposure") if explicit else None


def complete_lifecycle(row: dict[str, Any]) -> bool:
    dimensions = row.get("dimensions", {})
    return row.get("current_floor") == "U5" and all(
        dimensions.get(key, {}).get("status") in {"proven", "not-applicable"}
        for key in ("D", "A", "O", "E")
    )


def scan_visible_stubs(
    repo_root: Path, modules: list[dict[str, Any]]
) -> set[tuple[str, str, str]]:
    hits: set[tuple[str, str, str]] = set()
    for module in modules:
        for surface_id in module.get("surface_ids", []):
            route_root = repo_root / "frontend/web/app/(modules)" / surface_id
            if not route_root.is_dir():
                continue
            for suffix in ("*.ts", "*.tsx"):
                for path in route_root.rglob(suffix):
                    source = path.read_text(errors="replace")
                    lower_source = source.lower()
                    for pattern in VISIBLE_STUB_PATTERNS:
                        matched = pattern.lower() in lower_source
                        if matched:
                            hits.add((module["id"], path.relative_to(repo_root).as_posix(), pattern))
    return hits


def validate(
    manifest: dict[str, Any],
    lifecycle: dict[str, Any],
    operations: dict[str, Any],
    catalog: str,
    repo_root: Path = REPO_ROOT,
) -> list[str]:
    failures: list[str] = []
    if manifest.get("schema_version") != 2:
        failures.append("manifest schema_version must be 2")
    if manifest.get("status") not in {"certification-blocked", "launch-ready"}:
        failures.append("manifest status must be certification-blocked or launch-ready")

    sources = manifest.get("authoritative_sources", {})
    expected_sources = {
        "module_inventory": "docs/evidence/cov-00d-lifecycle-evidence.json",
        "operation_inventory": "docs/evidence/cov-00a-operation-census.json",
        "exposure_catalog": "frontend/packages/ui/src/lib/product-surface-catalog.ts",
    }
    if sources != expected_sources:
        failures.append("authoritative_sources must reference the accepted COV-00A/B/D authorities")

    configured_patterns = manifest.get("ratchet", {}).get("visible_stub_patterns")
    if set(configured_patterns or []) != set(VISIBLE_STUB_PATTERNS):
        failures.append("visible_stub_patterns must match the fail-closed validator patterns")

    lifecycle_rows = lifecycle.get("rows", [])
    expected = {row.get("id"): row for row in lifecycle_rows if isinstance(row, dict)}
    modules = manifest.get("modules")
    if not isinstance(modules, list):
        return failures + ["modules must be a list"]
    ids = [module.get("id") for module in modules if isinstance(module, dict)]
    if len(ids) != len(set(ids)):
        failures.append("manifest contains duplicate module ids")
    if set(ids) != set(expected):
        failures.append("manifest modules must exactly match the COV-00D inventory")

    by_id = {module.get("id"): module for module in modules if isinstance(module, dict)}
    for module_id, lifecycle_row in expected.items():
        module = by_id.get(module_id)
        if not module:
            continue
        if module.get("surface") != lifecycle_row.get("surface"):
            failures.append(f"{module_id}: surface differs from COV-00D")
        if module.get("surface_ids") != lifecycle_row.get("surface_ids"):
            failures.append(f"{module_id}: surface_ids differ from COV-00D")
        gate = module.get("launch_gate")
        if gate not in VALID_GATES:
            failures.append(f"{module_id}: invalid launch_gate {gate!r}")
        blockers = module.get("blockers")
        if gate != "admitted" and (
            not isinstance(blockers, list)
            or not blockers
            or not all(isinstance(item, str) and item.strip() for item in blockers)
        ):
            failures.append(f"{module_id}: non-admitted module requires explicit blockers")

        exposures: list[str] = []
        for surface_id in lifecycle_row.get("surface_ids", []):
            exposure = catalog_exposure(surface_id, catalog)
            if exposure is None:
                failures.append(f"{module_id}: surface {surface_id!r} missing from exposure catalog")
                continue
            exposures.append(exposure)
            if not (repo_root / "frontend/web/app/(modules)" / surface_id / "page.tsx").is_file():
                failures.append(f"{module_id}: route /{surface_id} has no page.tsx")

        lifecycle_ready = complete_lifecycle(lifecycle_row)
        catalog_ready = bool(exposures) and all(value in ADMITTED_EXPOSURES for value in exposures)
        if gate == "admitted" and not lifecycle_ready:
            failures.append(f"{module_id}: admitted requires authoritative U5 D/A/O/E evidence")
        if gate == "admitted" and not catalog_ready:
            failures.append(f"{module_id}: admitted requires enabled/admin-only catalog exposure")
        if catalog_ready and gate != "admitted":
            failures.append(f"{module_id}: exposed catalog surface is not admitted by the launch manifest")
        if gate == "runtime-pending" and not lifecycle_ready:
            failures.append(f"{module_id}: runtime-pending cannot mask a non-U5 evidence gap")

    operation_rows = operations.get("operations")
    if not isinstance(operation_rows, list):
        failures.append("operation census operations must be a list")
        operation_rows = []
    unowned = 0
    review_required = 0
    enabled = 0
    for row in operation_rows:
        if not isinstance(row, dict):
            failures.append("operation census row must be an object")
            continue
        operation = row.get("operation", "<operation>")
        if row.get("client_facing") and row.get("owner") in {None, "", "REVIEW", "uncategorized"}:
            failures.append(f"{operation}: unclassified client-facing operation")
            unowned += 1
        if row.get("disposition") not in VALID_DISPOSITIONS:
            failures.append(f"{operation}: invalid or review-required disposition")
            review_required += 1
        if row.get("client_facing") and row.get("coverage_status") == "reachable-ui":
            enabled += 1
            if row.get("disposition") not in {"primary-workflow", "horizontal", "secondary-advanced"}:
                failures.append(f"{operation}: enabled operation lacks an enabled classification")

    summary = operations.get("summary", {})
    if summary.get("unowned_client_facing") != unowned:
        failures.append("operation census unowned_client_facing summary is stale")
    if summary.get("review_required") != review_required:
        failures.append("operation census review_required summary is stale")
    if summary.get("client_facing_operations") != sum(
        row.get("client_facing") is True for row in operation_rows if isinstance(row, dict)
    ):
        failures.append("operation census client-facing total is stale")
    if enabled == 0:
        failures.append("operation census contains no enabled operations")

    detected_stubs = scan_visible_stubs(repo_root, modules)
    declared_stubs: set[tuple[str, str, str]] = set()
    for module in modules:
        markers = module.get("visible_stub_markers", [])
        if markers and module.get("launch_gate") != "blocked-by-visible-stubs":
            failures.append(f"{module.get('id')}: visible stub marker requires blocked-by-visible-stubs")
        for marker in markers:
            if not isinstance(marker, dict):
                failures.append(f"{module.get('id')}: invalid visible stub marker")
                continue
            declared_stubs.add((module.get("id"), marker.get("path"), marker.get("needle")))
    for hit in sorted(detected_stubs - declared_stubs):
        failures.append(f"{hit[0]}: unclassified visible stub {hit[2]!r} in {hit[1]}")
    for marker in sorted(declared_stubs - detected_stubs):
        failures.append(f"{marker[0]}: stale visible stub classification {marker[2]!r} in {marker[1]}")
    stub_modules = {hit[0] for hit in detected_stubs}
    for module in modules:
        if module.get("launch_gate") == "blocked-by-visible-stubs" and module.get("id") not in stub_modules:
            failures.append(f"{module.get('id')}: visible-stub gate has no detected stub")
        if module.get("launch_gate") == "admitted" and module.get("id") in stub_modules:
            failures.append(f"{module.get('id')}: admitted module contains a visible stub")

    admitted_count = sum(module.get("launch_gate") == "admitted" for module in modules)
    if manifest.get("status") == "launch-ready" and admitted_count != len(modules):
        failures.append("launch-ready requires every target module to be admitted")
    if manifest.get("status") == "certification-blocked" and admitted_count == len(modules):
        failures.append("certification-blocked is stale because every module is admitted")
    return failures


def main() -> int:
    try:
        manifest = json.loads(MANIFEST_PATH.read_text())
        lifecycle = json.loads(LIFECYCLE_PATH.read_text())
        operations = json.loads(OPERATIONS_PATH.read_text())
        catalog = CATALOG_PATH.read_text()
    except (OSError, json.JSONDecodeError) as error:
        print(f"COV-27 launch ratchet failed: {error}", file=sys.stderr)
        return 1

    failures = validate(manifest, lifecycle, operations, catalog)
    if failures:
        print("COV-27 launch ratchet failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    gates = Counter(module["launch_gate"] for module in manifest["modules"])
    enabled = sum(
        row.get("client_facing") is True and row.get("coverage_status") == "reachable-ui"
        for row in operations["operations"]
    )
    print(
        f"COV-27 launch ratchet: {len(manifest['modules'])} modules, "
        f"{enabled} enabled operations classified, gates={dict(sorted(gates.items()))}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

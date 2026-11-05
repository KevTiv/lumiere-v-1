#!/usr/bin/env python3
"""Index alpha history producers without treating source signals as acceptance.

The existing Finance inventory owns Rust parsing, canonical operation loading,
and persistence registration parsing. This index extends its scope to the
current alpha profile and retains explicit gaps for unresolved native sources,
entry paths, permission contracts and runtime evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path("docs/evidence/alpha-history-inventory.json")
PROFILE = "frontend/packages/ui/src/lib/workspace-profile.ts"
SURFACE_CATALOG = "frontend/packages/ui/src/lib/product-surface-catalog.ts"
BOUNDED_TABS = "frontend/web/lib/inventory-workspace-navigation.ts"

# These are source ownership mappings, not admission or authorized read policies.
# The bounded Inventory source files deliberately remain candidates until their
# individual tab/action entry paths have been reviewed.
MODULES = {
    "accounting": {"owner": "COV-08", "domains": ["accounting"]},
    "sales": {"owner": "COV-04", "domains": ["sales"]},
    "crm": {"owner": "COV-03", "domains": ["crm"]},
    "purchasing": {"owner": "COV-05", "domains": ["purchasing"]},
    "reports": {"owner": "COV-20", "domains": ["analytics"]},
    "subscriptions": {"owner": "COV-12", "domains": ["subscriptions"]},
    "expenses": {"owner": "COV-11", "domains": ["expenses"]},
    "products": {"owner": "COV-06", "files": ["inventory/product.rs", "inventory/product_category.rs"]},
    "warehouse": {"owner": "COV-06", "files": [
        "inventory/stock.rs", "inventory/warehouse.rs", "inventory/tracking.rs",
        "inventory/cycle_count.rs", "inventory/warehouse_operations.rs",
        "inventory/stock_correction.rs", "inventory/stock_correction_balance.rs",
        "inventory/replenishment.rs", "inventory/warehouse_sync.rs",
    ]},
    "fleet": {"owner": "COV-15", "domains": ["fleet"]},
    "documents": {"owner": "COV-18", "domains": ["documents"]},
    "calendar": {"owner": "COV-19", "files": ["workflow/calendar.rs"]},
    "tasks": {"owner": "COV-10/COV-21", "files": ["crm/activities.rs"]},
    "approvals": {"owner": "COV-21", "files": [
        "workflow/approvals.rs", "workflow/approval_gate.rs", "workflow/cancellation_repair.rs",
        "workflow/recovery.rs", "workflow/runtime.rs", "workflow/receipts.rs",
    ]},
    "settings": {"owner": "COV-23/COV-22", "domains": ["forms"], "files": [
        "core/access_lifecycle.rs", "core/auth.rs", "core/organization.rs",
        "core/permissions.rs", "core/users.rs", "core/reference.rs",
        "core/country_pack.rs", "core/country_catalog.rs", "core/privacy.rs",
    ]},
    "ai-assistant": {"owner": "GOV/CAP", "files": [
        "ai/action_drafts.rs", "ai/action_draft_runs.rs", "ai/action_draft_proposals.rs",
        "ai/chat.rs", "ai/assistant.rs",
    ]},
    # Overview only projects authorized events; it does not own business writes.
    "overview": {"owner": "COV-25/26", "domains": []},
}
IMPORT_FILES = {
    "accounting_imports.rs": ["accounting"], "sales_imports.rs": ["sales"],
    "crm_imports.rs": ["crm"], "purchasing_imports.rs": ["purchasing"],
    "analytics_imports.rs": ["reports"], "subscription_imports.rs": ["subscriptions"],
    "expenses_imports.rs": ["expenses"], "document_imports.rs": ["documents"],
    "core_imports.rs": ["settings", "products"],
    "inventory_imports.rs": ["products", "warehouse"],
    "import_tracker.rs": ["settings"], "import_mapping_templates.rs": ["settings"],
}
LINKED_COMMUNICATIONS = {"core/messaging.rs", "core/operational_messaging.rs"}
HIDDEN_SALES_FILES = {"sales/pos_config.rs", "sales/pos_transactions.rs"}
PRIVATE_PROVIDERS = ["business_change", "organization_business_change"]
DOMAIN_EVIDENCE = ["subscription_amendment", "workflow_human_task_event", "workflow_decision_event",
                   "workflow_command_receipt", "scheduled_report_run", "document_version"]
MAX_CALL_DEPTH = 6
MAX_CALL_NODES = 256
SERVICE_PATHS = [
    ("source-review-create", "api-server/src/routes/import_reviews/mod.rs", "create", "settings"),
    ("source-review-decision", "api-server/src/routes/import_reviews/mod.rs", "decide", "settings"),
    ("source-review-bulk-decision", "api-server/src/routes/import_reviews/mod.rs", "decide_bulk", "settings"),
    ("source-review-preparation", "api-server/src/routes/import_reviews/tasks.rs", "finish", "settings"),
    ("source-admission", "api-server/src/import_admissions.rs", "record_source_admission", "settings"),
    ("native-import-dispatch", "api-server/src/routes/import.rs", "import_entity_post", "settings"),
    ("native-import-recovery", "api-server/src/routes/import.rs", "read_exact_outcome", "settings"),
    ("review-import-binding", "api-server/src/routes/import_reviews/import_binding.rs", "record_review_binding", "settings"),
    ("review-import-binding-read", "api-server/src/routes/import_reviews/import_binding.rs", "read_review_binding", "settings"),
]


def load_finance(root: Path) -> Any:
    spec = importlib.util.spec_from_file_location(
        "alpha_history_finance_owner", root / "scripts/generate-finance-change-review-inventory.py"
    )
    if spec is None or spec.loader is None:
        raise ValueError("cannot load existing Finance inventory owner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def profile_surfaces(source: str) -> list[str]:
    """Fail closed if the alpha profile shape changes instead of guessing scope."""
    surfaces: set[str] = set()
    for constant in ("FINANCE_MODULES", "ALPHA_MODULES", "FINANCE_SUPPORT"):
        matches = re.findall(rf"\bconst\s+{constant}\s*=\s*new Set\(\[([^]]*)\]\)", source, re.S)
        if len(matches) != 1:
            raise ValueError(f"cannot resolve alpha profile set: {constant}")
        surfaces.update(re.findall(r'"([^"\n]+)"', matches[0]))
    unknown = surfaces - MODULES.keys()
    if unknown:
        raise ValueError(f"unclassified alpha surfaces: {', '.join(sorted(unknown))}")
    return sorted(surfaces)


def modules_for(name: str, source: str | None, visible: list[str]) -> tuple[list[str], str]:
    if not source:
        return [], "source-unresolved"
    path = source.removeprefix("spacetimedb/src/")
    if path in HIDDEN_SALES_FILES:
        return [], "hidden-pos-source"
    domain = path.split("/", 1)[0]
    modules = {module for module, config in MODULES.items()
               if domain in config.get("domains", []) or path in config.get("files", [])}
    relationship = "module-source-candidate"
    if domain == "data_ops":
        modules.update(IMPORT_FILES.get(Path(path).name, []))
        relationship = "import-source-candidate"
        if Path(path).name == "core_imports.rs":
            modules.discard("products")
            if name in {"import_uom_csv", "import_uom_category_csv"}:
                modules.add("products")
        if Path(path).name == "inventory_imports.rs":
            modules.discard("warehouse" if name.startswith(("import_product_", "import_product_csv")) else "products")
        if name in {"import_hr_employee_csv", "import_hr_department_csv"}:
            modules.update(["settings", "expenses"])
            relationship = "reference-import-only"
    if path == "crm/activities.rs" and "calendar_event" in name:
        modules.difference_update({"crm", "tasks"})
        modules.add("calendar")
    if path in LINKED_COMMUNICATIONS:
        if "calendar_event" in name:
            modules.add("calendar")
        elif any(part in name for part in ("activity", "task")):
            modules.add("tasks")
        else:
            modules.update(["documents", "accounting", "sales", "purchasing"])
        relationship = "linked-workflow-only"
    if domain in {"workflow", "ai"}:
        relationship = "linked-workflow-only"
    if domain == "projects" and "task" in name:
        modules.add("tasks")
        relationship = "linked-project-task-only"
    return sorted(modules.intersection(visible)), relationship


def history_status(signal: dict[str, Any]) -> str:
    if signal["status"] == "source-not-resolved":
        return "source-unresolved"
    if signal["trusted_capture_call"]:
        return "trusted-helper-observed-branch-and-fields-unverified"
    if signal.get("guarded_legacy_operations"):
        return "guarded-owner-fallback-no-private-capture"
    if signal.get("unmerged_capture_only_call"):
        return "capture-not-merged-no-private-history"
    if signal.get("standalone_policy_unresolved"):
        return "capture-policy-unresolved-no-private-history"
    if signal["audit_call"]:
        return "audit-only-completeness-and-trust-unverified"
    return "no-direct-history-signal"


def source_signals(finance: Any, definition: dict[str, Any] | None, structs: dict[str, Any],
                   blocked_operations: set[str] | None = None,
                   complete_owners: set[tuple[str, str]] | None = None) -> dict[str, Any]:
    signals = finance.source_signals(definition, structs, blocked_operations, complete_owners)
    adapted = definition is not None and bool(re.search(r"\b(?:write_business_audit|write_private_business_audit)\s*\(", definition["body"]))
    # The adapter records trusted evidence but can only preserve fields supplied
    # by the domain producer. Its presence never upgrades material completeness.
    signals["business_audit_adapter_call"] = adapted
    signals["private_values_adapter_call"] = definition is not None and bool(
        re.search(r"\bwrite_private_business_audit\s*\(", definition["body"]))
    signals["audit_call"] = signals["audit_call"] or adapted or (definition is not None and bool(
        re.search(r"\bwrite_audit_log_v2_returning\s*\(", definition["body"])))
    return signals


def call_names(body: str) -> list[str]:
    # Function-like text inside literals is not a call. The source owner has
    # already removed comments while preserving native source offsets.
    body = re.sub(r'r(#+)?"[\s\S]*?"\1|"(?:\\.|[^"\\])*"', '""', body)
    return sorted(set(re.findall(r"(?<![.\w])(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)\s*\(", body)))


def capture_observation(definition: dict[str, Any] | None, functions: dict[str, Any],
                        finance: Any | None = None, blocked_operations: set[str] | None = None,
                        complete_owners: set[tuple[str, str]] | None = None,
                        dynamic_producers: dict[tuple[str, str], list[str]] | None = None,
                        conditional_owners: dict[tuple[str, str], Any] | None = None,
                        import_scopes: dict[str, list[str]] | None = None) -> dict[str, Any]:
    """Follow bounded, unambiguous source calls, never certify their execution."""
    if definition is None:
        return {"private_providers": [], "import_receipt_signal": False, "legacy_audit_signal": False,
                "domain_evidence_tables": [], "guarded_legacy_operations": [],
                "unmerged_capture_only": False, "unresolved_policy": False,
                "conditional_provider_targets": {},
                "paths": [], "scan_limited": False}
    finance = finance or load_finance(ROOT)
    blocked_operations = blocked_operations or set()
    queue = [(definition, [])]
    visited: set[tuple[str, int]] = set()
    paths = []
    providers: set[str] = set()
    receipts = False
    legacy = False
    domain_evidence: set[str] = set()
    limited = False
    guarded: set[str] = set()
    unmerged = False
    unresolved = False
    conditional_targets = {}
    while queue:
        row, previous = queue.pop(0)
        identity = (row["source"], row["line"])
        if identity in visited:
            continue
        visited.add(identity)
        path = [*previous, f"{row['source']}:{row['line']}"]
        calls = call_names(row["body"])
        signal = finance.source_signals(row, {}, blocked_operations, complete_owners)
        allowed_dynamic = (dynamic_producers or {}).get((row["source"], row.get("function", "")))
        dynamic_safe = allowed_dynamic and not set(allowed_dynamic).intersection(blocked_operations)
        guarded.update(signal["guarded_legacy_operations"])
        unmerged = unmerged or signal["unmerged_capture_only_call"]
        unresolved = unresolved or (signal["standalone_policy_unresolved"] and not dynamic_safe)
        conditional = (conditional_owners or {}).get((row["source"], row.get("function", "")))
        conditional_merged = bool(conditional and finance.merged_evidence_vector(row["body"])
                                  and "record_organization_commit" in calls
                                  and {"source_changes", "audit_matches"}.issubset(calls)
                                  and '"correlation_version"' in row["body"])
        if conditional_merged:
            for table in conditional["targets"]:
                conditional_targets[table] = (import_scopes or {}).get(table, []).copy()
        captured = []
        if signal["trusted_capture_call"] or (signal["standalone_policy_unresolved"] and dynamic_safe):
            captured = PRIVATE_PROVIDERS.copy()
            if "capture_business_change" in calls and not signal["owner_merged_capture_call"] and not {
                "write_business_audit", "write_private_business_audit"}.intersection(calls):
                captured = ["business_change"]
        imported = bool(re.search(r"\.\s*import_job_record\s*\(\s*\)\s*\.\s*insert\s*\(", row["body"]))
        legacy_audit = bool(set(calls).intersection({"write_audit_log", "write_audit_log_v2", "write_audit_log_v2_returning"}))
        domain_tables = sorted(set(DOMAIN_EVIDENCE).intersection(re.findall(
            r"\.\s*(\w+)\s*\(\s*\)\s*\.\s*insert\s*\(", row["body"])))
        legacy = legacy or legacy_audit
        domain_evidence.update(domain_tables)
        if captured or imported or legacy_audit or domain_tables or signal["guarded_legacy_operations"] or signal["unmerged_capture_only_call"] or signal["standalone_policy_unresolved"] or conditional_merged:
            providers.update(captured)
            receipts = receipts or imported
            paths.append({"source_path": path, "private_provider_candidates": captured,
                          "import_receipt_signal": imported, "legacy_audit_signal": legacy_audit,
                          "domain_evidence_tables": domain_tables,
                          "guarded_legacy_operations": signal["guarded_legacy_operations"],
                          "owner_merged_capture_signal": signal["owner_merged_capture_call"],
                          "conditional_owner_targets": conditional["targets"] if conditional_merged else [],
                          "unmerged_capture_only": signal["unmerged_capture_only_call"]})
            # Capturing functions are the boundary: traversing their audit and
            # persistence internals could misattribute unrelated provider calls.
            if captured or imported or signal["guarded_legacy_operations"] or signal["unmerged_capture_only_call"] or signal["standalone_policy_unresolved"] or conditional_merged:
                continue
        if len(path) >= MAX_CALL_DEPTH or len(visited) >= MAX_CALL_NODES:
            limited = True
            continue
        for call in calls:
            targets = functions.get(call, [])
            local = [target for target in targets if target["source"] == row["source"]]
            targets = local if local else targets
            # Ambiguous overloaded names require domain review; do not pick a
            # different module's helper merely because its name matches.
            if len(targets) == 1:
                queue.append((targets[0], path))
    return {"private_providers": sorted(providers), "import_receipt_signal": receipts,
            "legacy_audit_signal": legacy, "domain_evidence_tables": sorted(domain_evidence),
            "guarded_legacy_operations": sorted(guarded), "unmerged_capture_only": unmerged,
            "unresolved_policy": unresolved,
            "conditional_provider_targets": conditional_targets,
            "paths": paths, "scan_limited": limited}


def import_capture_producers(functions: dict[str, Any], parser: Any) -> list[dict[str, Any]]:
    """Describe only the source-validated cases in the typed import owner."""
    rows = functions.get("record_import_created_id", [])
    if len(rows) != 1:
        raise ValueError("typed import capture owner is missing or ambiguous")
    owner = rows[0]
    if not {"write_private_business_audit", "capture_private_business_audit"}.intersection(call_names(owner["body"])):
        return []
    result = []
    for match in re.finditer(r'^\s*"([^"\n]+)"\s*=>\s*\{', owner["body"], re.M):
        opening = match.end() - 1
        end = parser._matching_brace(owner["body"], opening)
        branch = owner["body"][opening + 1:end]
        operation = re.search(r'"(import_\w+)"', branch)
        scope = re.search(r'row\.organization_id,\s*(None|Some\(row\.company_id\)|row\.company_id),', branch)
        if operation is None or scope is None:
            raise ValueError(f"unclassified typed import source scope: {match.group(1)}")
        value = scope.group(1)
        providers = (["organization_business_change"] if value == "None"
                     else ["business_change"] if value.startswith("Some") else PRIVATE_PROVIDERS.copy())
        result.append({
            "operation": operation.group(1), "source_table": match.group(1),
            "private_provider_candidates": providers,
            "scope_signal": "organization-wide-source" if value == "None" else
                            "company-owned-source" if value.startswith("Some") else "source-optional-company",
            "source": owner["source"], "helper": "record_import_created_id",
            "mapping_basis": "validated-native-source-ownership-and-exact-created-record-id",
            "source_provenance_limit": "submitted-import-row-not-original-file-or-review-proof",
            "durability": "staged-private-rows-require-sealed-tracked-import-owner-envelope",
            "certification": "not-certified-by-static-inventory",
        })
    return result


def provider_contracts(root: Path) -> list[dict[str, Any]]:
    native = (root / "spacetimedb/src/core/business_changes.rs").read_text(encoding="utf-8")
    result = []
    for provider in PRIVATE_PROVIDERS:
        if not re.search(rf"\baccessor\s*=\s*{provider}\b", native):
            raise ValueError(f"private capture provider source missing: {provider}")
        result.append({
            "provider": provider, "source": "spacetimedb/src/core/business_changes.rs",
            "scope": "organization-and-company" if provider == "business_change" else "organization-wide-explicit",
            "authority": "native-producer-only-private-evidence",
            "capture_transaction": "same-native-business-transaction",
            "durability": "generated-organization-commit-projection-and-release-proof-required",
            "material_completeness": "per-producer-fields-not-implied-by-provider-presence",
            "runtime_evidence": [],
        })
    return [*result, {
        "provider": "import_review_decision", "source": "api-server/src/routes/import_reviews/mod.rs",
        "scope": "organization-and-company", "authority": "source-review-decision-owner",
        "capture_transaction": "same-postgresql-review-transaction",
        "material_completeness": "source-interpretation-not-native-business-creation",
        "runtime_evidence": [],
    }, {
        "provider": "import_job_record", "source": "spacetimedb/src/data_ops/import_tracker.rs",
        "scope": "organization-with-validated-import-job-company",
        "authority": "exact-import-row-and-created-record-mapping",
        "capture_transaction": "native-import-owner",
        "material_completeness": "import-outcome-not-field-change-evidence-or-original-file-proof",
        "runtime_evidence": [],
    }, {
        "provider": "review_import_binding", "source": "api-server/src/routes/import_reviews/import_binding.rs",
        "scope": "organization-company-actor-request-content-and-import-row",
        "authority": "persisted-confirmed-review-values-and-exact-revision",
        "capture_transaction": "immutable-object-before-native-dispatch-not-distributed-atomicity",
        "material_completeness": "prepared-source-binding-needs-exact-native-outcome-before-creation-claim",
        "runtime_evidence": [],
    }]


def service_paths(root: Path) -> list[dict[str, Any]]:
    result = []
    for identity, source, function, surface in SERVICE_PATHS:
        text = (root / source).read_text(encoding="utf-8")
        match = re.search(rf"\basync\s+fn\s+{function}\s*\(", text)
        if match is None:
            raise ValueError(f"unresolved source/import service path: {source}::{function}")
        result.append({
            "path_id": identity, "surface": surface, "source": source,
            "function": function, "line": text.count("\n", 0, match.start()) + 1,
            "owner": "source-review/import API",
            "authority": "existing-service-owner-not-a-new-native-operation",
            "history_policy": "review-store-or-exact-native-receipt-owner-review-required",
            "source_link_policy": "exact-review-revision-admission-and-import-outcome-required",
            "runtime_evidence": [], "certification": "not-certified-by-static-inventory",
        })
    return result


def build_inventory(root: Path) -> dict[str, Any]:
    finance = load_finance(root)
    parser = finance.load_tool(root, "verify-c2-commit-coverage.py", "alpha_history_commit_owner")
    census = finance.load_tool(root, "generate-operation-census.py", "alpha_history_census_owner")
    contracts = finance.load_contracts(root)
    functions, structs = finance.source_inventory(root, parser)
    typed_imports = import_capture_producers(functions, parser)
    typed_imports_by_operation = {row["operation"]: row for row in typed_imports}
    dynamic_producers = {}
    for row in typed_imports:
        dynamic_producers.setdefault((row["source"], row["helper"]), []).append(row["operation"])
    visible = profile_surfaces((root / PROFILE).read_text(encoding="utf-8"))
    identities = finance.read_json(root, "lumiere-codegen/contract-operation-ids.json")["operations"]
    exposure = {row["name"]: row["exposure"] for row in
                finance.read_json(root, "lumiere-codegen/reducer-exposure.json")["reducers"]}
    commits = finance.commit_registrations(finance.read_json(root, "lumiere-codegen/c2-commit-coverage.json"))
    owner_policy = finance.read_json(root, "lumiere-codegen/business-history-owner-policy.json")
    blocked = finance.validate_history_policy(owner_policy, identities, commits)
    c2 = finance.read_json(root, "lumiere-codegen/c2-commit-coverage.json")
    complete_owners = {(row["source"], row["function"]) for row in c2.get("reducers", [])}
    conditional_owners = {(row["source"], row["function"]): row for row in c2.get("conditional_outcomes", [])}
    import_scopes = {row["source_table"]: row["private_provider_candidates"] for row in typed_imports}
    finance.validate_direct_owner_boundaries(functions, complete_owners, blocked)
    # Apply the census owner's explicit native/canonical spelling bridges.
    native: dict[str, list[dict[str, Any]]] = {}
    for name, definitions in functions.items():
        rows = [row for row in definitions if row["native_reducer"]]
        if rows:
            native.setdefault(census.REDUCER_NAME_ALIASES.get(name, name), []).extend(rows)
    operations = []
    for name in sorted(contracts.keys() | native.keys()):
        contract = contracts.get(name)
        if (contract and contract["semantic_kind"] == "test") or name.startswith(("test_", "run_all_", "run_test_")):
            continue
        definitions = native.get(name, [])
        if len(definitions) > 1:
            raise ValueError(f"ambiguous native source: {name}")
        definition = definitions[0] if definitions else None
        # Native location takes precedence over historical contract evidence.
        path = definition["source"] if definition else census.source_path((contract or {}).get("evidence", ""))
        modules, relationship = modules_for(name, path, visible)
        if not modules:
            continue
        if contract and not identities.get(name):
            raise ValueError(f"missing canonical operation identity: {name}")
        signals = source_signals(finance, definition, structs, blocked, complete_owners)
        observation = capture_observation(definition, functions, finance, blocked, complete_owners, dynamic_producers,
                                          conditional_owners, import_scopes)
        if name in {row["operation"] for row in conditional_owners.values()} and observation["conditional_provider_targets"]:
            # A tracked command has other admitted entity branches. Its exact
            # five-target history contract is never a universal producer grant.
            observation["private_providers"] = []
        typed_import = typed_imports_by_operation.get(name)
        if typed_import and observation["import_receipt_signal"] and observation["private_providers"]:
            observation["private_providers"] = typed_import["private_provider_candidates"].copy()
        status = history_status(signals)
        if not signals["trusted_capture_call"]:
            if observation["conditional_provider_targets"]:
                status = "conditional-typed-import-owner-not-universal-history"
            elif observation["private_providers"]:
                status = "delegated-helper-observed-branch-and-fields-unverified"
            elif observation["guarded_legacy_operations"]:
                status = "guarded-owner-fallback-no-private-capture"
            elif observation["unmerged_capture_only"]:
                status = "capture-not-merged-no-private-history"
            elif observation["unresolved_policy"]:
                status = "capture-policy-unresolved-no-private-history"
            elif status != "no-direct-history-signal":
                pass
            elif observation["import_receipt_signal"]:
                status = "import-receipt-only-no-material-change-evidence"
            elif observation["domain_evidence_tables"]:
                status = "domain-evidence-only-not-shared-private-history"
            elif observation["legacy_audit_signal"]:
                status = "delegated-legacy-audit-no-trusted-capture"
        kind = contract["semantic_kind"] if contract else "uncontracted-native"
        owner = census.owner_for(name, contract)[0] if contract else "source-domain-owner-review-required"
        operations.append({
            "operation": name, "operation_id": identities.get(name), "modules": modules,
            "owner": owner, "kind": kind,
            "source": definition["source"] if definition else None,
            "line": definition["line"] if definition else None,
            "contract_file": contract["contract_file"] if contract else None,
            "exposure": exposure.get(name, "unregistered"),
            "scope_relationship": relationship,
            "admission": "entry-path-review-required-not-proven-by-session-exposure",
            "history_status": status,
            "capture_observation": observation,
            "audit_signal": signals["audit_call"],
            "business_audit_adapter_signal": signals["business_audit_adapter_call"],
            "private_values_adapter_signal": signals["private_values_adapter_call"],
            "owner_merged_capture_signal": signals["owner_merged_capture_call"],
            "before_signal": signals["old_values_recorded"],
            "after_signal": signals["new_values_recorded"],
            "tables_referenced": signals["tables_accessed"],
            "commit_registration_signals": commits.get(name, []),
            "entry_paths_to_verify": ["native-owner", "session-BFF-and-UI" if exposure.get(name) == "session"
                                      else "service-or-operator", "imports-bulk-background-and-assistant"],
            "material_field_policy": "domain-owner-validation-required",
            "source_link_policy": "exact-receipt-and-current-target-authorization-required",
            "capture_start": None,
            "runtime_evidence": [],
            "certification": "not-certified-by-static-inventory",
        })
    paths = {PROFILE, SURFACE_CATALOG, BOUNDED_TABS,
             "scripts/generate-alpha-history-inventory.py", "scripts/generate-finance-change-review-inventory.py",
             "lumiere-codegen/contract-operation-ids.json", "lumiere-codegen/reducer-exposure.json",
             "lumiere-codegen/c2-commit-coverage.json"}
    paths.add("lumiere-codegen/business-history-owner-policy.json")
    paths.update(path.relative_to(root).as_posix() for path in (root / "lumiere-codegen/operation-contracts").glob("*.json"))
    paths.update(row["source"] for row in operations if row["source"])
    paths.update(location.rsplit(":", 1)[0] for row in operations
                 for trace in row["capture_observation"]["paths"] for location in trace["source_path"])
    paths.update({"spacetimedb/src/helpers.rs", "spacetimedb/src/core/business_changes.rs"})
    paths.update(path.relative_to(root).as_posix() for path in (root / "spacetimedb/src/core/business_changes").rglob("*.rs"))
    paths.update(row[1] for row in SERVICE_PATHS)
    return {
        "schema_version": 1,
        "status": "source-coverage-register-not-runtime-acceptance",
        "scope": {
            "profile": "finance-alpha", "surfaces": visible,
            "standalone_hidden": ["inventory", "messages", "journal", "notebook", "pos", "manufacturing",
                                  "helpdesk", "hr", "projects", "proposals", "distributor", "iot"],
            "linked_hidden_records_retain_existing_authority": True,
            "bounded_inventory_tabs_source": BOUNDED_TABS,
        },
        "limits": [
            "Module source candidates include operations whose exact alpha entry path still needs review.",
            "Session exposure, source ownership and legacy audit calls never establish alpha admission or complete history.",
            "Direct helper calls do not prove all branches, fields, delegated helpers or persisted runtime effects.",
            "Guarded standalone writers retain legacy audit until their exact complete owner merges evidence; they are not private capture.",
            "Capture-only vectors and direct CSV staging are not durable history until an exact source outcome includes them.",
            "Conditional tracked import evidence covers only its five declared targets, never every import_csv_tracked branch or universal C2 admission.",
            "Table references include validation reads and do not establish the actual write set.",
            "capture_start stays null and runtime_evidence empty until deployed proof is recorded by the owner.",
            "Standalone hidden modules are not admitted by linked reference or workflow evidence.",
        ],
        "surfaces": [{"surface": module, "owner": MODULES[module]["owner"],
                      "role": "authorized-aggregate-reader" if module == "overview" else "history-owner-or-adapter",
                      "operation_candidates": sum(module in row["modules"] for row in operations)} for module in visible],
        "provider_contracts": provider_contracts(root),
        "complete_owner_policy": owner_policy,
        "typed_import_capture_producers": typed_imports,
        "inputs": [{"path": path, "sha256": hashlib.sha256((root / path).read_bytes()).hexdigest()} for path in sorted(paths)],
        "summary": {
            "operation_candidates": len(operations),
            "by_surface": {module: sum(module in row["modules"] for row in operations) for module in visible},
            "by_history_status": dict(sorted(Counter(row["history_status"] for row in operations).items())),
            "by_surface_and_history_status": {module: dict(sorted(Counter(row["history_status"] for row in operations
                                                   if module in row["modules"]).items())) for module in visible},
            "private_provider_candidates": {provider: sum(provider in row["capture_observation"]["private_providers"]
                                             for row in operations) for provider in PRIVATE_PROVIDERS},
            "import_receipt_candidates": sum(row["capture_observation"]["import_receipt_signal"] for row in operations),
            "conditional_owner_candidates": sum(bool(row["capture_observation"]["conditional_provider_targets"]) for row in operations),
            "direct_registered_owner_merge_candidates": sum(row["owner_merged_capture_signal"] for row in operations),
            "domain_evidence_candidates": {table: sum(table in row["capture_observation"]["domain_evidence_tables"]
                                            for row in operations) for table in DOMAIN_EVIDENCE},
            "without_observed_private_capture_by_surface": {module: [row["operation"] for row in operations
                if module in row["modules"] and not row["capture_observation"]["private_providers"]] for module in visible},
            "by_kind": dict(sorted(Counter(row["kind"] for row in operations).items())),
            "session_exposed_candidates": sum(row["exposure"] == "session" for row in operations),
            "uncontracted_native": sum(row["kind"] == "uncontracted-native" for row in operations),
            "unresolved_native_source": sum(row["source"] is None for row in operations),
            "runtime_certified": 0,
        },
        "service_paths": service_paths(root),
        "operations": operations,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        finance = load_finance(args.root)
        content = finance.render(build_inventory(args.root))
        output = args.root / OUTPUT
        if args.check:
            if not output.exists() or output.read_text(encoding="utf-8") != content:
                raise ValueError(f"stale {OUTPUT}; regenerate with {Path(__file__).name}")
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(content, encoding="utf-8")
        print(f"alpha history inventory {'verified' if args.check else 'generated'}")
        return 0
    except (ValueError, KeyError, OSError) as error:
        print(f"alpha history inventory: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

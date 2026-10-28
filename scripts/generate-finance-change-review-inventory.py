#!/usr/bin/env python3
"""Inventory finance-alpha change-history work without inventing admission.

The immutable operation contracts own identity and exposure metadata owns the
session boundary. Checked-in COV reachability is historical discovery evidence
only. Source observations below are structural signals, never runtime proof.
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
OUTPUT = Path("docs/evidence/finance-alpha-change-review-inventory.json")
MODULES = {
    "Accounting": {"domain": "accounting", "owner": "COV-08", "resources": ["account-moves", "account-move-lines", "account-payments", "payment-transactions", "bank-statements", "bank-statement-lines", "account-periods", "account-assets"]},
    "Sales": {"domain": "sales", "owner": "COV-04", "resources": ["sale-orders", "sale-order-lines"]},
    "CRM": {"domain": "crm", "owner": "COV-03", "resources": ["contacts", "leads", "opportunities"]},
    "Purchasing": {"domain": "purchasing", "owner": "COV-05", "resources": ["purchase-orders", "purchase-order-lines", "purchase-requisitions"]},
    "Reports": {"domain": "analytics", "owner": "COV-20", "resources": ["financial-reports", "report-templates", "scheduled-reports", "dashboards", "dashboard-widgets"]},
    "Subscriptions": {"domain": "subscriptions", "owner": "COV-12", "resources": ["subscriptions", "subscription-plans", "subscription-lines", "subscription-billing-runs"]},
    "Expenses": {"domain": "expenses", "owner": "COV-11", "resources": ["expenses", "expense-sheets", "expense-receipts"]},
}
OWNER_MODULE = {data["owner"]: name for name, data in MODULES.items()}
DOMAIN_MODULE = {data["domain"]: name for name, data in MODULES.items()}
SUPPORT_FILES = {
    "data_ops/accounting_imports.rs": ["Accounting"],
    "data_ops/crm_imports.rs": ["CRM"],
    "data_ops/expenses_imports.rs": ["Expenses"],
    "data_ops/sales_imports.rs": ["Sales"],
    "data_ops/purchasing_imports.rs": ["Purchasing"],
    "data_ops/subscription_imports.rs": ["Subscriptions"],
    "data_ops/analytics_imports.rs": ["Reports"],
    "core/operational_messaging.rs": ["Accounting", "Sales", "Purchasing"],
    "core/messaging.rs": ["Accounting", "Sales", "Purchasing"],
}
WORKFLOW_SUPPORT = {
    "claim_workflow_human_task", "decide_workflow_human_task",
    "add_workflow_human_task_comment", "invalidate_workflow_human_task",
    "cancel_workflow", "resubmit_guarded_workflow_task",
    "repair_cancelled_workflow_tasks",
}
HIDDEN_SALES_FILES = {"pos_config.rs", "pos_transactions.rs"}
REDUCER = re.compile(r"#\[(?:spacetimedb::)?reducer(?:\([^]]*\))?\]\s*(?:#\[[^]]*\]\s*)*pub\s+fn\s+(\w+)\s*\(")
FUNCTION = re.compile(r"\bfn\s+(\w+)(?:\s*<[^{};]*>)?\s*\(")
STRUCT = re.compile(r"\bpub\s+struct\s+(\w+)\s*\{")


def load_tool(root: Path, filename: str, module_name: str) -> Any:
    spec = importlib.util.spec_from_file_location(module_name, root / "scripts" / filename)
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot load existing inventory owner: {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(root: Path, path: str) -> Any:
    return json.loads((root / path).read_text(encoding="utf-8"))


def load_contracts(root: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for path in sorted((root / "lumiere-codegen/operation-contracts").glob("*.json")):
        for name, value in json.loads(path.read_text(encoding="utf-8"))["operations"].items():
            if name in result:
                raise ValueError(f"duplicate canonical operation: {name}")
            result[name] = {**value, "contract_file": path.relative_to(root).as_posix()}
    return result


def source_inventory(root: Path, parser: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    functions: dict[str, list[dict[str, Any]]] = {}
    structs: dict[str, list[dict[str, Any]]] = {}
    for path in sorted((root / "spacetimedb/src").rglob("*.rs")):
        source = path.read_text(encoding="utf-8")
        clean = parser._strip_comments(source)
        native = set(REDUCER.findall(clean))
        relative = path.relative_to(root).as_posix()
        for match in FUNCTION.finditer(clean):
            name = match.group(1)
            opening = clean.find("{", match.end())
            if opening < 0:
                continue
            try:
                end = parser._matching_brace(source, opening)
            except parser.CoverageError:
                continue
            functions.setdefault(name, []).append({
                "source": relative,
                "line": source.count("\n", 0, match.start()) + 1,
                "native_reducer": name in native,
                "signature": clean[match.end():opening],
                "body": clean[opening + 1:end],
            })
        for match in STRUCT.finditer(clean):
            opening = match.end() - 1
            end = parser._matching_brace(source, opening)
            fields = [{"name": field.group(1), "rust_type": field.group(2).strip()}
                      for field in re.finditer(r"\bpub\s+(\w+)\s*:\s*([^\n]+),", clean[opening + 1:end])]
            structs.setdefault(match.group(1), []).append({"source": relative, "fields": fields})
    return functions, structs


def modules_for(name: str, contract: dict[str, Any], census_tool: Any) -> list[str]:
    owner, _ = census_tool.owner_for(name, contract)
    path = census_tool.source_path(contract.get("evidence", ""))
    if path and path.split("/")[0] == "sales" and path.split("/")[-1] in HIDDEN_SALES_FILES:
        return []
    if owner in OWNER_MODULE:
        return [OWNER_MODULE[owner]]
    if path in SUPPORT_FILES:
        return SUPPORT_FILES[path]
    if name in WORKFLOW_SUPPORT:
        return ["Accounting", "Sales", "Purchasing", "Expenses"]
    return []


def commit_registrations(payload: dict[str, Any]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for row in payload.get("reducers", []):
        if row.get("operation"):
            result.setdefault(row["operation"], []).append(f"{row['source']}::{row['function']}")
    for helper in payload.get("dynamic_commit_helpers", []):
        for caller in helper.get("callers", []):
            for operation in caller.get("operations", {}):
                result.setdefault(operation, []).append(f"{helper['source']}::{helper['function']}")
    return {key: sorted(set(values)) for key, values in result.items()}


def source_signals(row: dict[str, Any] | None, structs: dict[str, Any]) -> dict[str, Any]:
    if row is None:
        return {"status": "source-not-resolved", "audit_call": False, "trusted_capture_call": False,
                "capture_coverage": "not-observed", "old_values_recorded": False,
                "new_values_recorded": False, "guarded_action_gate": False, "tables_accessed": [],
                "parameter_products": []}
    body = row["body"]
    products = []
    for product in re.findall(r"\bparams\s*:\s*(\w+)", row["signature"]):
        definitions = structs.get(product, [])
        products.append({"type": product, "definitions": definitions})
    return {
        "status": "structural-only",
        "audit_call": bool(re.search(r"\bwrite_audit_log(?:_v2)?\s*\(", body)),
        "trusted_capture_call": bool(re.search(r"\bcapture_business_change\s*\(", body)),
        "capture_coverage": "partial-control-flow-owner-review-required" if re.search(r"\bcapture_business_change\s*\(", body) else "not-observed",
        "old_values_recorded": bool(re.search(r"\bold_values\s*:\s*Some\s*\(", body)),
        "new_values_recorded": bool(re.search(r"\bnew_values\s*:\s*Some\s*\(", body)),
        "guarded_action_gate": bool(re.search(r"\brequest_guarded_action\s*\(", body)),
        "tables_accessed": sorted(set(re.findall(r"\bctx\s*\.\s*db\s*\.\s*(\w+)\s*\(", body))),
        "parameter_products": products,
    }


def build_inventory(root: Path) -> dict[str, Any]:
    census_tool = load_tool(root, "generate-operation-census.py", "finance_census_owner")
    parser = load_tool(root, "verify-c2-commit-coverage.py", "finance_commit_owner")
    contracts = load_contracts(root)
    identities = read_json(root, "lumiere-codegen/contract-operation-ids.json")["operations"]
    exposure = {row["name"]: row for row in read_json(root, "lumiere-codegen/reducer-exposure.json")["reducers"]}
    legacy = {row["operation"]: row for row in read_json(root, "docs/evidence/cov-00a-operation-census.json")["operations"]}
    commits = commit_registrations(read_json(root, "lumiere-codegen/c2-commit-coverage.json"))
    functions, structs = source_inventory(root, parser)
    operations = []
    names = set(contracts)
    for name, definitions in functions.items():
        if any(definition["native_reducer"] and Path(definition["source"]).parts[2] in DOMAIN_MODULE for definition in definitions):
            names.add(name)
    for name in sorted(names):
        contract = contracts.get(name)
        if contract is not None and contract["semantic_kind"] == "test":
            continue
        definitions = [row for row in functions.get(name, []) if row["native_reducer"]]
        if contract is None:
            if name.startswith(("test_", "run_all_", "run_test_")):
                continue
            module_names = sorted({DOMAIN_MODULE[Path(row["source"]).parts[2]] for row in definitions
                                   if Path(row["source"]).parts[2] in DOMAIN_MODULE
                                   and not (Path(row["source"]).parts[2] == "sales"
                                            and Path(row["source"]).name in HIDDEN_SALES_FILES)})
        else:
            module_names = modules_for(name, contract, census_tool)
        if not module_names:
            if contract and definitions and census_tool.owner_for(name, contract)[0] == "REVIEW":
                if any(Path(row["source"]).parts[2] in DOMAIN_MODULE for row in definitions):
                    raise ValueError(f"unowned finance native operation: {name}")
            continue
        if len(definitions) > 1:
            raise ValueError(f"ambiguous native reducer source: {name}")
        definition = definitions[0] if definitions else None
        semantic = contract["semantic_kind"] if contract else "uncontracted-native"
        command = semantic in {"command", "uncontracted-native"}
        policy = exposure.get(name, {}).get("exposure", "unregistered")
        signal = source_signals(definition, structs)
        legacy_row = legacy.get(name, {})
        candidate = command and name.startswith("update_") and policy == "session"
        if name == "amend_subscription":
            candidate = True
        operations.append({
            "operation": name, "operation_id": identities.get(name), "modules": sorted(module_names),
            "contract_file": contract["contract_file"] if contract else None,
            "semantic_kind": semantic, "client_facing": contract.get("client_facing", False) if contract else False,
            "session_exposure": policy, "idempotency_contract": contract.get("idempotency") if contract else None,
            "source": definition["source"] if definition else None,
            "source_line": definition["line"] if definition else None,
            "contract_source_evidence": contract.get("evidence") if contract else None,
            "legacy_reachability": {"status": legacy_row.get("coverage_status", "not-in-census"),
                                    "authority": "discovery-only-not-current-alpha-admission"},
            "history_disposition": "required-capture-not-certified" if command else "internal-operator-path-review-required",
            "proposal_disposition": "candidate-owner-field-review-required" if candidate else "not-an-initial-edit-proposal",
            "save_policy": "existing-financial-gate" if signal["guarded_action_gate"] else "normal-save-plus-history-no-new-review-policy",
            "source_signals": signal,
            "commit_registration_signals": commits.get(name, []),
            "entry_path_review": ["native-owner", "session-BFF" if policy == "session" else "service-or-denied-boundary",
                                  "imports-bulk-and-jobs-must-use-owner"],
            "certification": "not-certified-by-static-inventory",
        })
    inputs = ["lumiere-codegen/contract-operation-ids.json", "lumiere-codegen/reducer-exposure.json",
              "lumiere-codegen/c2-commit-coverage.json", "docs/evidence/cov-00a-operation-census.json"]
    inputs.extend(path.relative_to(root).as_posix() for path in sorted((root / "lumiere-codegen/operation-contracts").glob("*.json")))
    failures = []
    for row in operations:
        if row["contract_file"] and not row["operation_id"]:
            failures.append(f"missing immutable operation identity: {row['operation']}")
    if failures:
        raise ValueError("; ".join(failures))
    product_catalog: dict[str, Any] = {}
    compact_operations = []
    for row in operations:
        signals = row["source_signals"]
        products = []
        for product in signals["parameter_products"]:
            products.append(product["type"])
            product_catalog[product["type"]] = [
                {"source": definition["source"], "field_names": [field["name"] for field in definition["fields"]]}
                for definition in product["definitions"]
            ]
        audit = ("before-and-after" if signals["old_values_recorded"] and signals["new_values_recorded"]
                 else "before-only" if signals["old_values_recorded"]
                 else "after-only" if signals["new_values_recorded"]
                 else "call-only" if signals["audit_call"] else "not-observed")
        compact = {"operation": row["operation"], "operation_id": row["operation_id"],
                   "modules": row["modules"], "source": row["source"], "line": row["source_line"],
                   "exposure": row["session_exposure"], "audit_signal": audit}
        if row["semantic_kind"] != "command":
            compact["kind"] = row["semantic_kind"]
        if products:
            compact["params"] = products
        if row["legacy_reachability"]["status"] != "reachable-ui":
            compact["legacy_reachability"] = row["legacy_reachability"]["status"]
        if row["proposal_disposition"].startswith("candidate-"):
            compact["proposal"] = "owner-review-required"
        if signals["guarded_action_gate"]:
            compact["existing_guarded_action_signal"] = True
        if signals["trusted_capture_call"]:
            compact["capture_signal"] = "partial-control-flow-owner-review-required"
        if row["commit_registration_signals"]:
            compact["commit_registration_signals"] = row["commit_registration_signals"]
        compact_operations.append(compact)
    return {
        "schema_version": 1,
        "status": "source-inventory-not-feature-certification",
        "product_behavior": "normal-saves-plus-history-review-selected-actions",
        "scope": {"modules": list(MODULES), "basis": "finance-alpha-navigation and canonical source owners",
                  "session_exposure_is_not_UI_admission": True,
                  "excluded_source_families": ["sales/pos_config.rs", "sales/pos_transactions.rs"]},
        "inputs": [{"path": path, "sha256": hashlib.sha256((root / path).read_bytes()).hexdigest()} for path in inputs],
        "limits": ["Checked-in COV reachability is historical discovery, not current enabled UI proof.",
                   "An audit call, Some value or C2 registration does not prove complete/trusted history.",
                   "Tables accessed include validation reads and are not an inferred write set.",
                   "Rust parameter fields describe source inputs, not an approved proposal field allowlist.",
                   "Native functions without canonical contracts remain explicit reconciliation work.",
                   "Runtime UI/native/import/job coverage, policy/retention decisions and history acceptance remain open."],
        "row_defaults": {"kind": "command", "proposal": "not-an-initial-edit-proposal",
                         "legacy_reachability": "reachable-ui-in-legacy-census-only",
                         "history": "required-capture-not-certified-for-commands",
                         "save": "normal-save-plus-history-unless-existing-domain-policy-requires-review",
                         "capture_signal": "not-observed", "commit_registration_signals": [],
                         "certification": "not-certified-by-static-inventory"},
        "signal_semantics": {
            "audit_signal": "Direct reducer body only; delegated capture may exist. Some values do not prove completeness or trust.",
            "capture_signal": "A direct helper call is partial-control-flow evidence, not coverage of every branch or native acceptance.",
            "params": "References into parameter_products; field names are source inputs, never an approved proposal allowlist.",
            "commit_registration_signals": "Existing C2 source registrations only, never proof of complete business history.",
            "entry_paths": "Every row needs native-owner review; session rows additionally need BFF/UI review. Imports, bulk actions and jobs must converge through the same owner.",
        },
        "summary": {"operations": len(operations),
                    "by_module": {name: sum(name in row["modules"] for row in operations) for name in MODULES},
                    "by_semantic_kind": dict(sorted(Counter(row["semantic_kind"] for row in operations).items())),
                    "session_exposed": sum(row["session_exposure"] == "session" for row in operations),
                    "uncontracted_native": sum(row["semantic_kind"] == "uncontracted-native" for row in operations),
                    "unresolved_native_source": sum(row["source"] is None for row in operations),
                    "candidate_edit_proposals": sum(row["proposal_disposition"].startswith("candidate-") for row in operations),
                    "history_certified": 0},
        "module_records": [{"module": name, **metadata,
                            "record_scope": "organization-and-current-source-policy" if name == "CRM" else "organization-company-and-current-source-policy",
                            "proposal_field_allowlist": "owner-validation-required-not-authorized-by-this-inventory"}
                           for name, metadata in MODULES.items()],
        "parameter_products": dict(sorted(product_catalog.items())),
        "operations": compact_operations,
    }


def render(payload: dict[str, Any]) -> str:
    # Keep one row per operation, with product definitions referenced once.
    # This is an evidence index, not another generated contract/schema dump.
    metadata = {key: value for key, value in payload.items() if key != "operations"}
    if "operations" not in payload:
        return json.dumps(metadata, ensure_ascii=False, indent=2) + "\n"
    prefix = json.dumps(metadata, ensure_ascii=False, indent=2).rstrip()[:-1].rstrip()
    rows = ",\n".join("    " + json.dumps(row, ensure_ascii=False, separators=(",", ":"))
                       for row in payload["operations"])
    return prefix + ',\n  "operations": [\n' + rows + "\n  ]\n}\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when checked-in evidence differs")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        content = render(build_inventory(args.root))
        output = args.root / OUTPUT
        if args.check:
            if not output.exists() or output.read_text(encoding="utf-8") != content:
                raise ValueError(f"stale {OUTPUT}; regenerate with {Path(__file__).name}")
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(content, encoding="utf-8")
        print(f"finance change-review inventory {'verified' if args.check else 'generated'}")
        return 0
    except (ValueError, OSError, KeyError) as error:
        print(f"finance change-review inventory: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

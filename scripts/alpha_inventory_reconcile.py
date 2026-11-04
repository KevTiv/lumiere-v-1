#!/usr/bin/env python3
"""Generate review-only proposals from a normalized, company-scoped evidence export."""

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

# The exporter supplies verified namespace and source references from each row.
# Matching keys must be explicit, canonical strings. Missing keys never match.
RULES = {
    "receipt_purchase_line": ("receipt_move", "purchase_line", ("product", "uom", "supplier")),
    "delivery_sales_line": ("delivery_move", "sale_line", ("product", "uom", "customer")),
    "return_original_move": ("return_move", "completed_move", ("product", "uom", "lot")),
    "movement_product": ("stock_move", "product", ("sku",)),
    "supplier_product": ("supplier_item", "product", ("sku",)),
    "sale_customer": ("sale_order", "contact", ("customer_key",)),
    "opportunity_sale": ("converted_opportunity", "sale_order", ("customer",)),
    "expense_receipt": ("expense", "verified_receipt", ("employee", "checksum")),
    "receipt_supplier": ("purchase_order", "contact", ("supplier_key",)),
    "vendor_bill_purchase": ("vendor_bill", "purchase_order", ("supplier", "currency")),
    "invoice_sale": ("customer_invoice", "sale_order", ("customer", "currency")),
    "invoice_subscription": ("subscription_invoice", "subscription", ("customer", "currency")),
    "expense_fleet_intervention": ("vehicle_expense", "fleet_intervention", ("vehicle",)),
    "transfer_fleet_intervention": ("parts_transfer", "fleet_intervention", ("vehicle",)),
    "document_transfer": ("transfer_document", "stock_transfer", ("document_kind",)),
}
QUANTITY_RULES = {"receipt_purchase_line", "delivery_sales_line", "return_original_move"}


def key(record, fields):
    values = tuple(record.get("facts", {}).get(field) for field in fields)
    return values if all(isinstance(value, str) and value.strip() for value in values) else None


def valid_id(value):
    return type(value) is int and value > 0


def fingerprint(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode()).hexdigest()


def reconcile(bundle):
    org, company = bundle["organization_id"], bundle["company_id"]
    if not valid_id(org) or not valid_id(company):
        raise ValueError("organization_id and company_id must be positive integers")
    records = bundle["records"]
    if not isinstance(records, list):
        raise ValueError("records must be a list")
    seen = set()
    by_kind = defaultdict(list)
    for record in records:
        identity = (record["kind"], record["id"])
        scope = (record.get("organization_id"), record.get("company_id"))
        if not all(map(valid_id, scope)) or scope != (org, company):
            raise ValueError("record outside requested company")
        if identity in seen or not valid_id(record["id"]) or not valid_id(record["revision"]):
            raise ValueError("duplicate record or invalid record identity/revision")
        if not isinstance(record.get("facts"), dict):
            raise ValueError("record facts must be an object")
        if not isinstance(record.get("links", {}), dict) or not all(
            map(valid_id, record.get("links", {}).values())
        ):
            raise ValueError("links must contain positive target IDs")
        seen.add(identity)
        by_kind[record["kind"]].append(record)

    proposals = []
    for name, (source_kind, target_kind, attributes) in RULES.items():
        fields = ("namespace", "reference", *attributes)
        targets = defaultdict(list)
        for target in by_kind[target_kind]:
            target_key = key(target, fields)
            if target_key:
                targets[target_key].append(target)
        for source in by_kind[source_kind]:
            source_key = key(source, fields)
            matches = sorted(targets.get(source_key, []), key=lambda row: row["id"])
            linked = source.get("links", {}).get(name)
            if linked is not None:
                if len(matches) == 1 and linked == matches[0]["id"]:
                    continue
                status = "existing_link_conflict"
            elif not source_key:
                status = "missing_evidence"
            elif not matches:
                status = "unmatched"
            elif len(matches) > 1:
                status = "ambiguous"
            elif name in QUANTITY_RULES:
                status = "quantity_reconciliation_required"
            else:
                status = "review_candidate"
            evidence = {"source": fingerprint(source), "targets": [fingerprint(row) for row in matches]}
            proposals.append({
                "rule": name,
                "source": {"kind": source_kind, "id": source["id"], "revision": source["revision"]},
                "targets": [{"kind": target_kind, "id": row["id"], "revision": row["revision"]} for row in matches],
                "status": status,
                "matched_fields": list(fields) if matches else [],
                "evidence": evidence,
                "proposal_key": fingerprint({"rule": name, **evidence}),
            })
    return {"organization_id": org, "company_id": company, "proposals": sorted(
        proposals, key=lambda item: (item["rule"], item["source"]["id"])
    )}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(reconcile(json.loads(args.bundle.read_text())), indent=2))
    except (KeyError, ValueError, TypeError, AttributeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()

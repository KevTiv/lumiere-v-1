#!/usr/bin/env python3
"""Read the historic shop workbook export. Never connect to a live service.

Keep amounts as decimal strings, retain source coordinates, and keep observations
separate from ERP documents. A weekly audit is not a purchase invoice or payment.
"""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path
import re


def compact(value):
    return " ".join(value.split())


def number(value):
    value = value.strip()
    if not value:
        return None
    if "," in value:
        if not re.fullmatch(r"[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?", value):
            return None
        value = value.replace(",", "")
    try:
        result = Decimal(value)
        return str(result) if result.is_finite() else None
    except InvalidOperation:
        return None


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def period(title):
    tokens = re.findall(r"(?<!\d)(\d{1,2})/(\d{1,2})(?:/(\d+))?", title)
    if any(year and len(year) != 4 for _, _, year in tokens):
        return None, "invalid_period_year"
    if len(tokens) == 1 and tokens[0][2]:
        tokens *= 2
    if len(tokens) != 2 or not (tokens[0][2] or tokens[1][2]):
        return None, "missing_or_ambiguous_period"
    first, last = tokens
    try:
        start = date(int(first[2] or last[2]), int(first[1]), int(first[0]))
        end = date(int(last[2] or first[2]), int(last[1]), int(last[0]))
    except ValueError:
        return None, "invalid_period"
    if start > end:
        return None, "reversed_period"
    return {"start": start.isoformat(), "end": end.isoformat()}, None


def source(filename, row):
    return {"file": filename, "row": row}


def file_shop(filename):
    name = filename.upper()
    return next((shop for shop in ["NYABUGOGO", "KICUKIRO", "KIMIRONKO", "ZINIA", "GISIMENT"]
                 if shop in name), None) or ("ZINIA" if "ZIN" in name else None)


def nonempty_rows(rows):
    result = []
    for row in rows:
        cells = [compact(cell) for cell in row]
        while cells and not cells[-1]:
            cells.pop()
        if cells:
            result.append(cells)
    return result


def audit_blocks(filename, rows):
    titles = [(i, next(cell for cell in row if compact(cell).upper().startswith("AUDIT ")))
              for i, row in enumerate(rows)
              if any(compact(cell).upper().startswith("AUDIT ") for cell in row)]
    blocks = []
    for n, (start, title) in enumerate(titles):
        end = titles[n + 1][0] if n + 1 < len(titles) else len(rows)
        block_rows = rows[start:end]
        headers = [(i, r.index("DESCRIPTION")) for i, r in enumerate(block_rows)
                   if "DESCRIPTION" in r and any(compact(c).upper() in {"S I", "SI"} for c in r)]
        if not headers:
            continue
        header, d = headers[0]
        dates, date_issue = period(title)
        shop = file_shop(filename)
        issues = []
        if date_issue:
            issues.append(date_issue)
        if shop == "KIMIRONKO" and "KICUKIRO" in title.upper():
            issues.append("file_and_title_shop_disagree")
        lines, last_product, total_row = [], None, None
        fields = ["opening_quantity", "received_quantity", "available_quantity", "closing_quantity",
                  "consumed_quantity", "cost_unit_price", "consumed_cost", "sold_quantity",
                  "sale_unit_price", "sale_amount"]
        for offset in range(header + 1, len(block_rows)):
            row = block_rows[offset]
            prefix = [compact(c).upper() for c in row[:d + 7]]
            if any(c.startswith("TOTAL") for c in prefix):
                total_row = row
                break
            if any(c.startswith(("DEPAN", "DEPEN", "EXPENSE")) for c in prefix):
                break
            raw_name = compact(row[d]) if len(row) > d else ""
            values = {key: number(row[d + k + 1]) if len(row) > d + k + 1 else None
                      for k, key in enumerate(fields)}
            if not raw_name and any(values[k] is not None for k in ["consumed_cost", "sale_amount"]) and all(
                values[k] is None for k in fields if k not in {"consumed_cost", "sale_amount"}
            ):
                total_row = row
                issues.append("unlabeled_primary_subtotal")
                break
            if raw_name.upper().startswith(("VERSEMENT", "VERF", "VERI", "CASH", "MOMO", "RETOUR HQ", "DIFFERENCE")):
                issues.append("settlement_section_without_primary_subtotal")
                break
            if raw_name:
                last_product = raw_name
            activity = [v for k, v in values.items() if k not in {"cost_unit_price", "sale_unit_price"}]
            if not last_product or not any(v is not None and Decimal(v) != 0 for v in activity):
                continue
            line_issues = []
            if any(len(row) > d + k + 1 and row[d + k + 1].strip() and values[key] is None
                   for k, key in enumerate(fields)):
                line_issues.append("non_numeric_source_cell")
            if not raw_name:
                line_issues.append("description_carried_from_preceding_product")
            qty, price, amount = (values[k] for k in ["sold_quantity", "sale_unit_price", "sale_amount"])
            calculated_sale = str(Decimal(qty) * Decimal(price)) if qty is not None and price is not None else None
            if amount is not None and calculated_sale is not None and abs(Decimal(amount) - Decimal(calculated_sale)) > Decimal("0.01"):
                line_issues.append("sale_quantity_price_mismatch")
            opening, received, closing, consumed = (values[k] for k in
                                                   ["opening_quantity", "received_quantity", "closing_quantity", "consumed_quantity"])
            # Blank source cells remain unknown. They are never silently zero.
            if all(v is not None for v in [opening, received, closing, consumed]):
                if abs(Decimal(opening) + Decimal(received) - Decimal(closing) - Decimal(consumed)) > Decimal("0.0001"):
                    line_issues.append("stock_equation_mismatch")
            if any(v is not None and Decimal(v) < 0 for v in values.values()):
                line_issues.append("negative_source_value")
            lines.append({"source": source(filename, start + offset + 1), "product_label": last_product,
                          "raw_product_label": raw_name or None, **values,
                          "calculated_sale_amount": calculated_sale, "issues": line_issues})
        totals = {}
        if total_row:
            for key, column in [("consumed_cost", d + 7), ("sale_amount", d + 10)]:
                declared = number(total_row[column]) if len(total_row) > column else None
                observed = [line[key] for line in lines if line[key] is not None]
                computed = sum((Decimal(v) for v in observed), Decimal(0))
                totals[key] = {"declared": declared, "sum_of_nonblank_lines": str(computed),
                               "missing_line_values": sum(line[key] is None for line in lines)}
                if declared is not None and abs(Decimal(declared) - computed) > Decimal("0.01"):
                    issues.append(f"{key}_subtotal_mismatch")
        else:
            issues.append("missing_primary_subtotal")
        canonical_lines = [{k: v for k, v in line.items() if k not in {"source", "issues"}}
                           for line in lines]
        block_key = digest([shop, compact(title), canonical_lines, totals])
        blocks.append({"id": f"audit-{block_key[:24]}", "source": source(filename, start + 1),
                       "source_end_row": end, "title": compact(title), "file_shop": shop,
                       "period": dates, "issues": issues, "lines": lines, "totals": totals,
                       "content_hash": digest(nonempty_rows(block_rows)), "data_hash": block_key})
    return blocks


def prepare(folder, output):
    files, blocks, raw_sources = [], [], []
    for path in sorted(folder.glob("*.csv")):
        data = path.read_bytes()
        rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
        raw_sources.append({"file": path.name, "sha256": hashlib.sha256(data).hexdigest(), "rows": rows})
        extracted = audit_blocks(path.name, rows)
        blocks.extend(extracted)
        files.append({"file": path.name, "sha256": hashlib.sha256(data).hexdigest(),
                      "bytes": len(data), "rows": len(rows), "audit_blocks": len(extracted)})
    empty_blocks = [b for b in blocks if not b["lines"]]
    populated_blocks = [b for b in blocks if b["lines"]]
    unique, duplicates = {}, []
    for block in populated_blocks:
        key = block["data_hash"]
        if key in unique:
            original = unique[key]
            duplicates.append({"source": block["source"], "canonical_audit": original["id"],
                               "same_complete_block": original["content_hash"] == block["content_hash"]})
            original.setdefault("duplicate_sources", []).append(block["source"])
            if original["content_hash"] != block["content_hash"]:
                original["issues"].append("same_product_data_different_supplementary_rows")
        else:
            unique[key] = block
    audits = list(unique.values())
    identities = defaultdict(list)
    for block in audits:
        identities[(block["file_shop"], block["title"])].append(block)
    conflicts = []
    for (shop, title), candidates in identities.items():
        if len(candidates) > 1:
            conflicts.append({"shop": shop, "title": title, "audit_ids": [b["id"] for b in candidates]})
            for block in candidates:
                block["issues"].append("conflicting_same_title_audits")
    overlaps = []
    for i, block in enumerate(audits):
        if not block["period"]:
            continue
        for other in audits[i + 1:]:
            if other["file_shop"] != block["file_shop"] or not other["period"]:
                continue
            start = max(block["period"]["start"], other["period"]["start"])
            end = min(block["period"]["end"], other["period"]["end"])
            if start < end:
                overlaps.append({"audit_ids": [block["id"], other["id"]], "start": start, "end": end})
                for candidate in [block, other]:
                    candidate["issues"].append("overlapping_shop_periods")
    by_name = {entry["file"]: entry["rows"] for entry in raw_sources}
    supplements = {}
    for name in ["Sheet1-Table 1.csv", "Sheet2-Table 1.csv", "Sheet3-Table 1.csv",
                 "Sheet5-Table 1.csv", "RAPPOR GISIMENT-Table 1.csv", "Sheet6-Table 1.csv"]:
        supplements[name] = [{"source": source(name, i + 1), "cells": row}
                             for i, row in enumerate(by_name.get(name, [])) if any(c.strip() for c in row)]
    debt_rows = by_name.get("Sheet2-Table 1.csv", [])
    if debt_rows and (len(debt_rows) < 40 or "14/01/2023" not in " ".join(debt_rows[5])):
        raise ValueError("debt snapshot layout/date differs from the reviewed source")
    balances = []
    for kind, lo, hi in [("customer", 8, 14), ("old_customer", 17, 25), ("shop_internal", 28, 31), ("supplier", 35, 39)]:
        if not debt_rows:
            break
        for row_num in range(lo, hi + 1):
            row = debt_rows[row_num - 1]
            balances.append({"id": f"balance-sheet2-{row_num}", "source": source("Sheet2-Table 1.csv", row_num),
                             "as_of": "2023-01-14", "kind": kind, "party_label": row[2],
                             "amount": number(row[3]), "currency": "RWF", "live_obligation": False})
    staff_rows = by_name.get("Sheet3-Table 1.csv", [])
    if staff_rows and (len(staff_rows) < 9 or staff_rows[3][2:4] != ["NAMES", "SHOPS"]):
        raise ValueError("staff reference layout differs from the reviewed source")
    staff = [{"source": source("Sheet3-Table 1.csv", i + 1), "name": row[2], "assignment_label": row[3],
              "employment_start": None, "employment_status": None, "create_login": False}
             for i, row in enumerate(staff_rows) if len(row) > 3 and row[1].isdigit()]
    inventory_rows = by_name.get("Sheet5-Table 1.csv", [])
    if inventory_rows and (len(inventory_rows) < 15 or "05/10/2022" not in " ".join(inventory_rows[6])
                           or inventory_rows[9][3:5] != ["PCS", "KGS"]):
        raise ValueError("inventory snapshot layout/date differs from the reviewed source")
    inventory = [{"source": source("Sheet5-Table 1.csv", i), "as_of": "2022-10-05", "product_label": inventory_rows[i - 1][2],
                  "pieces": number(inventory_rows[i - 1][3]), "kilograms": number(inventory_rows[i - 1][4]),
                  "current_stock": False} for i in range(11, 15)] if inventory_rows else []
    sales_rows = by_name.get("Sheet1-Table 1.csv", [])
    if sales_rows and (len(sales_rows) < 16 or not all(day in " ".join(sales_rows[6]) for day in ["13/06/2022", "18/06/2022"])):
        raise ValueError("customer sales layout/period differs from the reviewed source")
    customer_sales = [{"source": source("Sheet1-Table 1.csv", i), "period": {"start": "2022-06-13", "end": "2022-06-18"},
                       "customer_label": sales_rows[i - 1][2], "quantity": number(sales_rows[i - 1][3]),
                       "unit_price": number(sales_rows[i - 1][4]), "amount": number(sales_rows[i - 1][5]),
                       "comment": sales_rows[i - 1][6], "product": None, "unit": None, "currency": "RWF",
                       "payment_verified": False} for i in range(10, 16)] if sales_rows else []
    issue_counts = Counter()
    for block in audits:
        block["issues"] = sorted(set(block["issues"]))
        issue_counts.update(block["issues"])
        for line in block["lines"]:
            issue_counts.update(line["issues"])
    summary = {"files": len(files), "source_rows": sum(f["rows"] for f in files),
               "audit_blocks": len(blocks), "unique_audit_datasets": len(audits),
               "empty_or_zero_only_audit_blocks": len(empty_blocks),
               "duplicate_audit_datasets": len(duplicates), "conflicting_audit_titles": len(conflicts),
               "overlapping_period_pairs": len(overlaps),
               "audit_product_observations": sum(len(b["lines"]) for b in audits),
               "distinct_product_labels": len({line["product_label"] for b in audits for line in b["lines"]}),
               "staff_references": len(staff), "balance_snapshots": len(balances),
               "inventory_count_lines": len(inventory), "customer_sales_observations": len(customer_sales),
               "issues": dict(sorted(issue_counts.items())), "production_writes": 0}
    proposal = {
        "organization": {"name": "Umunupfu Chicken | Mugisha Farm", "code": "UMUNUPFU_MUGISHA",
                         "timezone": "Africa/Kigali", "currency": "RWF", "source_legal_name": "UMUNOPFU CHICKEN LTD"},
        "mapping": [
            {"source": "company headers", "target": "organization + company + currency + country", "rule": "create tenant-owned references before business records"},
            {"source": "shop labels", "target": "warehouse + stock_location", "rule": "one company, shop-specific warehouses; no inter-shop customer revenue"},
            {"source": "product descriptions", "target": "product_category + uom + product", "rule": "resolve label aliases and units before creating product links; no current prices from old prices"},
            {"source": "customer/supplier names", "target": "contact", "rule": "exact scoped identity matches; no guessed aliases or contact details"},
            {"source": "weekly shop audits", "target": "historic observations and reviewed accounting migration", "rule": "consumed cost is not supplier purchases; do not invent invoices or payments"},
            {"source": "dated balance lists", "target": "historic balance snapshots", "rule": "not current receivables or payables; do not add to historical sales as revenue"},
            {"source": "inventory count", "target": "historic inventory snapshot", "rule": "keep pieces and kilograms separate; do not create current stock"},
            {"source": "staff list", "target": "historic staff references", "rule": "no invented hire dates, active employment or user access"},
            {"source": "blank/undated templates", "target": "source archive", "rule": "not completed transactions"}],
        "activation_gates": ["publish and deploy the exact identity/organization exception after approval",
                             "create organization using the user's verified WorkOS session",
                             "verify the returned organization/company/currency IDs and every scoped relation",
                             "pin WorkOS admission to the new numeric organization ID after creation",
                             "resolve shop/date/unit conflicts before posting accounting or inventory effects",
                             "read all imported records back and repeat without duplicates"],
        "summary": summary, "files": files,
    }
    output.mkdir(parents=True, exist_ok=True)
    for filename, data in [("source-archive.json", raw_sources), ("audit-observations.json", audits),
                           ("empty-audit-blocks.json", [{k: b[k] for k in ["source", "title"]} for b in empty_blocks]),
                           ("duplicate-audits.json", duplicates), ("conflicting-audits.json", conflicts),
                           ("overlapping-periods.json", overlaps), ("supplementary-observations.json", supplements),
                           ("balance-snapshots.json", balances), ("staff-references.json", staff),
                           ("inventory-snapshot.json", inventory), ("customer-sales.json", customer_sales),
                           ("import-proposal.json", proposal)]:
        (output / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return proposal


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not args.source.is_dir() or not list(args.source.glob("*.csv")):
        parser.error("source must be a directory containing CSV files")
    prepare(args.source, args.output)

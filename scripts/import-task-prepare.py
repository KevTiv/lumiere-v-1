#!/usr/bin/env python3
"""Prepare uploaded source files for review. Never execute ERP operations.

The API supplies original bytes over stdin and stores both them and these proposals.
Only bounded, deterministic parsing runs here; cell contents are always data.
"""
import base64
import binascii
import csv
from datetime import date, timedelta
from decimal import DecimalException
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import posixpath
import re
import sys
import zipfile
import zlib
import xml.etree.ElementTree as ET

MAX_FILES = 20
MAX_FILE_BYTES = 5_000_000
MAX_TOTAL_BYTES = 20_000_000
MAX_INPUT_BYTES = 28_000_000
MAX_OUTPUT_BYTES = 7_500_000
MAX_ROWS = 25_000
MAX_CELLS = 100_000
MAX_COLUMNS = 200
MAX_XML_BYTES = 10_000_000
MAX_ZIP_BYTES = 25_000_000
MAX_VALUE = 2000

_spec = importlib.util.spec_from_file_location(
    "farm_preflight", Path(__file__).with_name("farm-history-preflight.py")
)
farm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(farm)


class PreparationError(ValueError):
    """A bounded, user-actionable source problem without source contents."""


def fail(message):
    raise PreparationError(message)


def checked_value(value):
    if len(value.encode("utf-8")) > MAX_VALUE:
        fail("A source cell exceeds the 2,000-byte review limit. Split the source before retrying.")
    return value


def clipped(value, maximum):
    return value.encode("utf-8")[:maximum].decode("utf-8", errors="ignore")


def csv_rows(data):
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        fail("CSV files must use UTF-8 encoding. Save the source as UTF-8 CSV and retry.")
    if "\x00" in text:
        fail("The CSV contains unsupported null characters.")
    try:
        sample = text[:8192]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(io.StringIO(text, newline=""), dialect, strict=True)
        rows = []
        while True:
            start = reader.line_num + 1
            try:
                cells = next(reader)
            except StopIteration:
                break
            rows.append((start, cells))
            if len(rows) > MAX_ROWS:
                fail("The source exceeds the 25,000-row preparation limit. Split the source and retry.")
        return rows
    except csv.Error:
        fail("The CSV is malformed. Check its quoting and save it again.")


def xml_document(archive, name):
    try:
        info = archive.getinfo(name)
    except KeyError:
        fail("The workbook is missing a required XML part.")
    if info.file_size > MAX_XML_BYTES:
        fail("A workbook part exceeds the 10 MB expansion limit.")
    content = archive.read(info)
    if b"\x00" in content or b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
        fail("Workbook XML entity declarations are unsupported.")
    try:
        return ET.fromstring(content)
    except ET.ParseError:
        fail("The workbook contains malformed XML.")


def local_tag(element):
    return element.tag.rsplit("}", 1)[-1]


def xlsx_rows(data):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        fail("The XLSX file is not a valid workbook.")
    with archive:
        entries = archive.infolist()
        if (len(entries) > 1000 or len({entry.filename for entry in entries}) != len(entries)
                or sum(entry.file_size for entry in entries) > MAX_ZIP_BYTES
                or any(entry.flag_bits & 1 for entry in entries)):
            fail("The workbook exceeds safe expansion limits or is encrypted.")
        workbook = xml_document(archive, "xl/workbook.xml")
        sheets = [node for node in workbook.iter() if local_tag(node) == "sheet"]
        if len(sheets) != 1:
            fail("Import one worksheet at a time. Save each worksheet as its own XLSX or CSV file.")
        sheet = sheets[0]
        relationship = next((value for key, value in sheet.attrib.items() if key.endswith("}id")), None)
        relationships = xml_document(archive, "xl/_rels/workbook.xml.rels")
        target = next((node.attrib.get("Target") for node in relationships
                       if node.attrib.get("Id") == relationship and node.attrib.get("TargetMode") != "External"), None)
        if not target:
            fail("The workbook worksheet relationship is invalid.")
        sheet_path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
        if not sheet_path.startswith("xl/worksheets/"):
            fail("The workbook worksheet path is unsupported.")
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(node.itertext()) for node in xml_document(archive, "xl/sharedStrings.xml")
                      if local_tag(node) == "si"]
        document = xml_document(archive, sheet_path)
        rows = []
        previous_row = 0
        for row in document.iter():
            if local_tag(row) != "row":
                continue
            row_number = row.attrib.get("r", str(previous_row + 1))
            if not row_number.isdigit() or not previous_row < int(row_number) <= 1_048_576:
                fail("The workbook has invalid or repeated worksheet row numbers.")
            previous_row = int(row_number)
            cells = []
            for cell in row:
                if local_tag(cell) != "c":
                    continue
                reference = cell.attrib.get("r", "")
                match = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", reference)
                if not match or int(match[2]) != previous_row:
                    fail("The workbook has an invalid cell reference.")
                index = 0
                for letter in match[1]:
                    index = index * 26 + ord(letter) - 64
                if not len(cells) < index <= MAX_COLUMNS:
                    fail("Workbook cells must be ordered within the 200-column limit.")
                cells.extend([""] * (index - len(cells)))
                if any(local_tag(node) == "f" for node in cell):
                    fail("Workbook formulas require review. Export calculated values as CSV and retry.")
                value = next((node.text or "" for node in cell if local_tag(node) == "v"), "")
                kind = cell.attrib.get("t", "n")
                if kind == "s":
                    if not value.isdigit() or int(value) >= len(shared):
                        fail("The workbook has an invalid shared-string reference.")
                    value = shared[int(value)]
                elif kind == "inlineStr":
                    value = "".join(node.text or "" for node in cell.iter() if local_tag(node) == "t")
                elif kind in {"e", "b"}:
                    # Preserve errors and booleans as literal source text, never numbers.
                    value = ("TRUE" if value == "1" else "FALSE") if kind == "b" else value
                cells[-1] = value
            rows.append((previous_row, cells))
            if len(rows) > MAX_ROWS:
                fail("The workbook exceeds the 25,000-row preparation limit.")
        return rows, checked_value(sheet.attrib.get("name", "Worksheet"))


def field(key, value, *, kind="text", required=False, export=False, label=None):
    return {"key": key, "label": label or key.replace("_", " "), "kind": kind,
            "sourceValue": value, "required": required, "export": export}


def proposed_value(value, kind):
    if not value.strip():
        return None
    if kind == "decimal":
        number = farm.number(value)
        return number if number is not None and re.fullmatch(r"-?\d{1,12}(?:\.\d{1,6})?", number) else None
    return value


TARGET_FIELDS = {
    "product": {"name", "internal_reference", "barcode", "sale_price", "cost_price", "uom_id", "uom_po_id", "category_id", "description", "active", "can_be_sold", "can_be_purchased", "type_field", "weight", "volume"},
    "contact": {"name", "first_name", "last_name", "title", "email", "email_secondary", "phone", "mobile", "fax", "website", "street", "street2", "city", "state_code", "zip", "country_code", "tax_id", "company_registry", "industry", "employees_count", "annual_revenue", "notes", "color", "is_customer", "is_vendor", "is_employee", "is_prospect", "is_partner", "type_", "company_id"},
    "stock_location": {"name", "usage", "complete_name", "barcode", "active", "is_scrap"},
}
DECIMALS = {"sale_price", "cost_price", "weight", "volume"}
CHOICES = {"active": ["true", "false"], "is_scrap": ["true", "false"],
           "can_be_sold": ["true", "false"], "can_be_purchased": ["true", "false"],
           "is_customer": ["true", "false"], "is_vendor": ["true", "false"],
           "is_employee": ["true", "false"], "is_prospect": ["true", "false"], "is_partner": ["true", "false"],
           "usage": ["internal", "customer", "supplier", "transit"],
           "type_field": ["product", "service", "consumable"], "type_": ["contact", "company"]}
AUDIT_ISSUES = {
    "duplicate_audit_dataset": "Repeated audit product data appears in more than one report. Review sources before combining totals.",
    "conflicting_same_title_audits": "Reports with the same location and title contain different values. Choose the supported version before combining totals.",
    "overlapping_shop_periods": "Audit periods overlap for the same location. Review their coverage before combining totals.",
    "missing_or_ambiguous_period": "The reporting period is missing or ambiguous.",
    "invalid_period_year": "The reporting year is invalid.",
    "invalid_period": "The reporting period contains an invalid date.",
    "reversed_period": "The reporting period ends before it starts.",
    "file_and_title_shop_disagree": "The filename and report heading identify different locations.",
    "sale_quantity_price_mismatch": "Sold quantity multiplied by unit price does not equal the recorded sale amount.",
    "stock_equation_mismatch": "Opening quantity plus receipts less closing quantity does not equal consumed quantity.",
    "non_numeric_source_cell": "A numeric source cell contains an invalid value; its original text is retained.",
    "description_carried_from_preceding_product": "The product label was carried from the preceding source row and needs confirmation.",
    "negative_source_value": "A source number is negative and needs review.",
    "consumed_cost_subtotal_mismatch": "The reported consumed-cost subtotal differs from the sum of populated source lines.",
    "sale_amount_subtotal_mismatch": "The reported sales subtotal differs from the sum of populated source lines.",
    "missing_primary_subtotal": "The report has no recognized product subtotal.",
    "unlabeled_primary_subtotal": "An unlabeled subtotal was detected and needs review.",
    "settlement_section_without_primary_subtotal": "Settlement entries start before a product subtotal can be identified.",
}


def mapped_field(key, value, required=False):
    result = field(key, value, kind="decimal" if key in DECIMALS else "text", required=required, export=True)
    if key in CHOICES:
        result.update({"kind": "choice", "options": CHOICES[key]})
    return result


def field_proposal(value):
    proposal = proposed_value(value["sourceValue"] or "", value["kind"])
    if value["kind"] == "choice" and proposal not in value["options"]:
        return None
    return proposal


def structured_target(name, headers):
    if "name" not in headers or len(set(headers)) != len(headers):
        return None
    # Sales, balances, snapshots and staff lists must not become current master data.
    if set(headers) & {"quantity", "amount", "balance", "debit", "credit", "date", "sold_quantity", "pieces", "kilograms", "invoice_date", "as_of", "business_date"}:
        return None
    basename = Path(name).stem.lower()
    if set(headers) & {"sale_price", "cost_price", "uom_id", "internal_reference"} or re.search(r"\bproducts?\b", basename):
        return "product"
    if "usage" in headers or re.search(r"\b(?:stock[_ -]?)?locations?\b", basename):
        return "stock_location"
    if set(headers) & {"email", "phone", "mobile"} or re.search(r"\bcontacts?\b", basename):
        return "contact"
    return None


def source_ref(file, row):
    return {"file": file["name"], "row": row, "sha256": file["sha256"],
            "rowBasis": "import_row" if file["sheet"] else "source_line"}


def standard_items(file, headers, target):
    items = []
    for row_number, cells in file["rows"][1:]:
        if not any(value.strip() for value in cells):
            continue
        if len(cells) > len(headers):
            fail("A structured table row has more values than its header. Correct its columns and retry.")
        fields = []
        issues = ["Review the detected mapping and values before creating records."]
        for index, key in enumerate(headers):
            value = cells[index] if index < len(cells) else ""
            known = key in TARGET_FIELDS[target]
            safe_key = key if known else f"source_column_{index + 1}"
            if known:
                fields.append(mapped_field(key, value, required=key == "name" or key in DECIMALS or key in CHOICES))
            else:
                fields.append(field(safe_key, value, label=clipped(key, 200) or f"Column {index + 1}"))
                issues.append(f"Source column {index + 1} is evidence only and is not mapped to a record field.")
        if target == "product":
            for key in ["sale_price", "cost_price", "uom_id", "uom_po_id", "category_id", "active", "can_be_sold", "can_be_purchased"]:
                if not any(value["key"] == key for value in fields):
                    fields.append(mapped_field(key, None, required=True))
            issues.append("Confirm current prices, units and category; historical values are not current prices.")
        if target == "stock_location":
            for key in ["usage", "active", "is_scrap"]:
                if not any(value["key"] == key for value in fields):
                    fields.append(mapped_field(key, None, required=True))
        if target == "contact":
            for key in ["type_", "is_customer", "is_vendor", "is_employee", "is_prospect", "is_partner"]:
                if not any(value["key"] == key for value in fields):
                    fields.append(mapped_field(key, None, required=True))
            issues.append("Confirm the contact type and business roles; missing role flags remain unknown.")
        if file["sheet"]:
            fields.append(field("source_worksheet", file["sheet"]))
        if len(fields) > 32:
            fail("A structured table exceeds the 32-field review limit. Split its columns and retry.")
        proposed = {value["key"]: field_proposal(value) for value in fields}
        for value in fields:
            if value["export"] and any(character in (value["sourceValue"] or "") for character in "\r\n"):
                # The prepared and native importers parse one record per line.
                # Keep original text as evidence instead of changing its meaning.
                proposed[value["key"]] = None
                value["required"] = True
                issues.append("Multiline source text needs a single-line correction for this importer.")
        if any(value["sourceValue"] and proposed[value["key"]] is None for value in fields):
            issues.append("An invalid or unsupported value remains unresolved; the original cell is preserved.")
        label_index = headers.index("name")
        label = cells[label_index] if label_index < len(cells) else ""
        items.append({"key": f"row-{row_number}", "label": clipped(label, 300) or f"Row {row_number}",
                      "source": source_ref(file, row_number), "issue": clipped(" ".join(issues), 2000),
                      "fields": fields, "proposed": proposed})
    return items


def business_date(block):
    period = block["period"]
    if not period:
        return {"precision": "invalid" if "invalid_period" in " ".join(block["issues"]) else "undated",
                "raw": block["title"]}
    try:
        end = (date.fromisoformat(period["end"]) + timedelta(days=1)).isoformat()
    except (ValueError, OverflowError):
        return {"precision": "invalid", "raw": block["title"]}
    return {"precision": "day" if period["start"] == period["end"] else "interval",
            "from": period["start"], "toExclusive": end, "raw": block["title"]}


DATE_HEADERS = {"date", "as_of", "invoice_date", "business_date"}


def source_day(raw, *, day_first=False):
    """Interpret exact ISO dates; locale dates require a verified farm layout."""
    value = raw.strip()
    if not value:
        return {"precision": "undated", "raw": raw}
    try:
        if day_first:
            match = re.fullmatch(r"([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})", value)
            if not match:
                raise ValueError("date format")
            parsed = date(int(match[3]), int(match[2]), int(match[1]))
        else:
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
                raise ValueError("date format")
            parsed = date.fromisoformat(value)
        return {"precision": "day", "from": parsed.isoformat(),
                "toExclusive": (parsed + timedelta(days=1)).isoformat(), "raw": raw}
    except (ValueError, OverflowError):
        return {"precision": "invalid", "raw": raw}


def supplementary_date_facts(file):
    """Retain dates only for the existing preflight's verified source layouts.

    Filenames select a known layout, never a date. Calendar evidence comes from
    the same source headings and column positions checked by farm preflight.
    """
    rows = [cells for _, cells in file["rows"]]
    facts = {}
    name = file["name"]

    def heading_dates(index):
        return re.findall(r"(?<![0-9])(?:[0-9]{1,2}/){2}[0-9]{4}(?![0-9])", " ".join(rows[index]))

    if (name == "Sheet5-Table 1.csv" and len(rows) >= 15
            and rows[9][3:5] == ["PCS", "KGS"]):
        dates = heading_dates(6)
        if len(dates) == 1:
            evidence = source_day(dates[0], day_first=True)
            for number in range(11, 15):
                if len(rows[number - 1]) >= 5 and rows[number - 1][2].strip():
                    facts[number] = (evidence, "historical_inventory_count")
    elif name == "Sheet2-Table 1.csv" and len(rows) >= 40:
        dates = heading_dates(5)
        if len(dates) == 1:
            evidence = source_day(dates[0], day_first=True)
            for lo, hi in [(8, 14), (17, 25), (28, 31), (35, 39)]:
                for number in range(lo, hi + 1):
                    if (len(rows[number - 1]) >= 4 and rows[number - 1][2].strip()
                            and farm.number(rows[number - 1][3]) is not None):
                        facts[number] = (evidence, "historical_balance_snapshot")
    elif name == "Sheet1-Table 1.csv" and len(rows) >= 16:
        dates = heading_dates(6)
        if len(dates) == 2:
            period, issue = farm.period(" ".join(dates))
            evidence = business_date({"period": period, "title": " ".join(dates), "issues": [issue] if issue else []})
            for number in range(10, 16):
                if (len(rows[number - 1]) >= 7 and rows[number - 1][2].strip()
                        and any(farm.number(cell) is not None for cell in rows[number - 1][3:6])):
                    facts[number] = (evidence, "historical_customer_sales_summary")
    return facts


def observation_items(file, blocks, *, inspection_only=False):
    by_record = {line["source"]["row"]: (block, line) for block in blocks for line in block["lines"]}
    items = []
    supplementary = supplementary_date_facts(file)
    first = next(((index, cells) for index, (_, cells) in enumerate(file["rows"], 1)
                  if any(cell.strip() for cell in cells)), (0, []))
    date_columns = [index for index, value in enumerate(first[1])
                    if re.sub(r"[\s-]+", "_", value.strip().lower()) in DATE_HEADERS]
    for record_index, (row_number, cells) in enumerate(file["rows"], start=1):
        if not any(value.strip() for value in cells):
            continue
        raw = json.dumps(cells, ensure_ascii=False, separators=(",", ":"))
        if len(raw.encode("utf-8")) > MAX_VALUE:
            fail("A historical source row exceeds the 2,000-byte review limit. Split its columns and retry.")
        fields = [field("source_cells", raw, required=True)]
        proposed = {"source_cells": raw}
        issues = (["File inspection only: retain this source as evidence; no business-record import was approved."]
                  if inspection_only else
                  ["Historical source observation: review its meaning; do not post it as current stock, debt, or a transaction."])
        label = next((cell for cell in cells if cell.strip()), f"Row {row_number}")
        item = {"key": f"row-{row_number}", "source": source_ref(file, row_number)}
        if date_columns and record_index > first[0]:
            raw_dates = [cells[index] if index < len(cells) else "" for index in date_columns]
            known_dates = set(value.strip() for value in raw_dates if value.strip())
            if len(known_dates) > 1:
                item["businessDate"] = {"precision": "invalid", "raw": clipped("; ".join(raw_dates), MAX_VALUE)}
                issues.append("The row contains conflicting date fields; choose its supported historical date.")
            else:
                item["businessDate"] = source_day(next(iter(known_dates), ""))
            if item["businessDate"]["precision"] == "invalid":
                issues.append("The source date is invalid or ambiguous and remains unresolved; use ISO YYYY-MM-DD.")
        if record_index in supplementary:
            item["businessDate"], kind = supplementary[record_index]
            fields.append(field("observation_kind", kind))
            proposed["observation_kind"] = kind
        if record_index in by_record:
            block, line = by_record[record_index]
            label = line["product_label"]
            issues.extend(AUDIT_ISSUES.get(issue, issue.replace("_", " "))
                          for issue in sorted(set(block["issues"] + line["issues"])))
            fields.extend([field("product_label", line["raw_product_label"]), field("unit", None, required=not inspection_only)])
            proposed.update({"product_label": line["product_label"], "unit": None})
            for key in ["opening_quantity", "received_quantity", "available_quantity", "closing_quantity",
                        "consumed_quantity", "cost_unit_price", "consumed_cost", "sold_quantity", "sale_unit_price", "sale_amount"]:
                # The raw row keeps the original spelling, including invalid numerics.
                value = line[key]
                fields.append(field(key, value, kind="decimal"))
                proposed[key] = proposed_value(value or "", "decimal")
            item["businessDate"] = business_date(block)
        if file["sheet"]:
            fields.append(field("source_worksheet", file["sheet"]))
            proposed["source_worksheet"] = file["sheet"]
        item.update({"label": clipped(label, 300), "issue": clipped(" ".join(issues), 2000), "fields": fields, "proposed": proposed})
        items.append(item)
    return items


def prepare(payload):
    mode = payload.get("mode") if isinstance(payload, dict) else None
    if mode not in {"prepare_import", "inspect_only"}:
        fail("Choose an approved preparation or inspection action before processing source files.")
    files = payload.get("files") if isinstance(payload, dict) else None
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        fail("Choose between 1 and 20 source files.")
    decoded, names = [], set()
    total_bytes = total_rows = total_cells = 0
    for file in files:
        if not isinstance(file, dict) or set(file) != {"fileName", "contentBase64"}:
            fail("Each source needs its original filename and base64 bytes.")
        name, encoded = file["fileName"], file["contentBase64"]
        if (not isinstance(name, str) or not name or len(name.encode("utf-8")) > 300
                or "/" in name or "\\" in name or any(ord(c) < 32 for c in name) or name in names):
            fail("Source filenames must be distinct plain filenames of at most 300 bytes.")
        if not isinstance(encoded, str) or len(encoded) > ((MAX_FILE_BYTES + 2) // 3) * 4:
            fail("A source exceeds the 5 MB file limit.")
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            fail("A source contains invalid base64 bytes.")
        if not data or len(data) > MAX_FILE_BYTES:
            fail("Source files must contain between 1 byte and 5 MB.")
        total_bytes += len(data)
        if total_bytes > MAX_TOTAL_BYTES:
            fail("The source selection exceeds the 20 MB total limit.")
        suffix = Path(name).suffix.lower()
        sheet = None
        if suffix == ".csv":
            rows = csv_rows(data)
        elif suffix == ".xlsx":
            try:
                rows, sheet = xlsx_rows(data)
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OverflowError, EOFError, zlib.error):
                fail("The XLSX workbook could not be read safely. Save it as CSV and retry.")
        else:
            fail("Only CSV and single-sheet XLSX sources are supported.")
        for _, cells in rows:
            if len(cells) > MAX_COLUMNS:
                fail("A source exceeds the 200-column preparation limit.")
            for value in cells:
                checked_value(value)
        total_rows += sum(any(value.strip() for value in cells) for _, cells in rows)
        total_cells += sum(len(cells) for _, cells in rows)
        if total_rows > MAX_ROWS or total_cells > MAX_CELLS:
            fail("The source selection exceeds 25,000 rows or 100,000 cells. Split the selection and retry.")
        names.add(name)
        decoded.append({"name": name, "sha256": hashlib.sha256(data).hexdigest(), "rows": rows, "sheet": sheet})

    all_blocks = []
    for file in decoded:
        file["blocks"] = farm.audit_blocks(file["name"], [cells for _, cells in file["rows"]])
        all_blocks.extend(file["blocks"])
    warnings = []
    for index, block in enumerate(all_blocks):
        for other in all_blocks[:index]:
            issue = None
            if block["data_hash"] == other["data_hash"]:
                issue = "duplicate_audit_dataset"
            elif block["file_shop"] == other["file_shop"] and block["title"] == other["title"]:
                issue = "conflicting_same_title_audits"
            elif (block["file_shop"] is not None and block["file_shop"] == other["file_shop"]
                  and block["period"] and other["period"]
                  and max(block["period"]["start"], other["period"]["start"]) <= min(block["period"]["end"], other["period"]["end"])):
                issue = "overlapping_shop_periods"
            if issue:
                block["issues"].append(issue)
                other["issues"].append(issue)
                warnings.append(AUDIT_ISSUES[issue])
    datasets = []
    for file in decoded:
        # Leading blank CSV rows remain in provenance but do not prevent table detection.
        visible = [(number, cells) for number, cells in file["rows"] if any(value.strip() for value in cells)]
        if not visible:
            fail("A selected source has no nonempty rows to review.")
        headers = [re.sub(r"[\s-]+", "_", value.strip().lower()) for value in visible[0][1]]
        target = None if mode == "inspect_only" or file["blocks"] else structured_target(file["name"], headers)
        if target == "stock_location" and set(headers) & {"parent_id", "location_id", "warehouse_id"}:
            # The prepared-location path deliberately supports only unlinked locations.
            # Preserve linked inputs for review instead of dropping or inventing parents.
            target = None
            warnings.append("Linked location columns require reference review; their rows are retained as source observations.")
        if target == "contact" and "parent_id" in headers:
            target = None
            warnings.append("Parent contact links require reference review; their rows are retained as source observations.")
        if target:
            file["rows"] = visible
            items = standard_items(file, headers, target)
        else:
            target = "source_observation"
            items = observation_items(file, file["blocks"], inspection_only=mode == "inspect_only")
        if not items:
            fail("A selected structured table has no data rows to review.")
        if file["sheet"]:
            warnings.append("XLSX source rows refer to original worksheet row numbers; worksheet names are retained in source fields.")
        for offset in range(0, len(items), 1000):
            title = clipped(file["name"], 160) + (f" · rows {offset + 1}–{min(offset + 1000, len(items))}" if len(items) > 1000 else "")
            datasets.append({"format": "lumiere-import-review/v1", "title": title, "targetEntity": target,
                             "sourceFile": file["name"], "items": items[offset:offset + 1000]})
    result = {"datasets": datasets, "warnings": sorted(set(warnings))}
    if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > MAX_OUTPUT_BYTES:
        fail("Prepared review exceeds the response limit. Import a smaller selection of files.")
    return result


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            fail("The preparation request exceeds the source-selection limit.")
        result = prepare(json.loads(raw))
    except (ValueError, DecimalException) as error:
        message = (str(error) if isinstance(error, PreparationError) else
                   "A source number exceeds supported decimal limits." if isinstance(error, DecimalException) else
                   "The preparation request is not valid JSON." if isinstance(error, json.JSONDecodeError) else
                   "The source contains an invalid or unsupported encoded value.")
        print(json.dumps({"error": message}))
        return 1
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())

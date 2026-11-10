#!/usr/bin/env python3
"""Prepare uploaded source files for review. Never execute ERP operations.

The API supplies original bytes over stdin and stores both them and these proposals.
Only bounded, deterministic parsing runs here; cell contents are always data.
"""
import base64
import binascii
import csv
from collections import Counter, defaultdict
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

_rule_spec = importlib.util.spec_from_file_location(
    "import_preparation_rules", Path(__file__).with_name("import_preparation.py")
)
rules = importlib.util.module_from_spec(_rule_spec)
sys.modules[_rule_spec.name] = rules
_rule_spec.loader.exec_module(rules)

PreparationError = rules.PreparationError


def fail(message):
    raise PreparationError(message)


def checked_value(value):
    if len(value.encode("utf-8")) > MAX_VALUE:
        fail("A source cell exceeds the 2,000-byte review limit. Split the source before retrying.")
    return value


def clipped(value, maximum):
    return value.encode("utf-8")[:maximum].decode("utf-8", errors="ignore")


def csv_reader(text, delimiter):
    return csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)


def csv_delimiter(sample):
    possible = {}
    for delimiter in ",;\t|":
        try:
            header = next((row for row in csv_reader(sample, delimiter) if any(cell.strip() for cell in row)), [])
        except csv.Error:
            continue
        if len(header) > 1:
            possible[delimiter] = header
    recognized = [delimiter for delimiter, header in possible.items()
                  if structured_target("", header_keys(header))]
    if len(recognized) == 1:
        return recognized[0]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        if len(possible) == 1:
            return next(iter(possible))
        if possible:
            fail("Several CSV delimiters fit the header. Save the source with a comma delimiter and retry.")
        return ","


def managed_csv_rows(text, delimiter):
    """Match the preview dialect and retain physical source lines for review."""
    rows, coordinates = [], []
    cells, field = [], []
    state = "start"
    line = row_start = 1
    index = record_start = 0
    while index < len(text):
        character = text[index]
        index += 1
        if character == "\r" and index < len(text) and text[index] == "\n":
            character = "\r\n"
            index += 1
        newline = character in {"\r", "\n", "\r\n"}
        if state == "quoted":
            if character == '"':
                if index < len(text) and text[index] == '"':
                    field.append('"')
                    index += 1
                else:
                    state = "closed"
            else:
                field.append(character)
            line += newline
        elif character == delimiter or newline:
            cells.append("".join(field))
            field.clear()
            state = "start"
            if newline:
                rows.append((row_start, cells))
                coordinates.append((row_start, line))
                cells = []
                line += 1
                row_start = line
                record_start = index
        elif state == "closed":
            if character not in " \t":
                fail(f"CSV record starting at line {row_start} has data after a closing quote.")
        elif character == '"':
            if state != "start":
                fail(f"CSV record starting at line {row_start} has a quote in an unquoted cell.")
            field.clear()
            state = "quoted"
        else:
            field.append(character)
            if character not in " \t":
                state = "unquoted"
        if len(cells) > MAX_COLUMNS or len(rows) > MAX_ROWS:
            fail("The source exceeds the supported CSV row or column limit.")
    if state == "quoted":
        fail(f"CSV record starting at line {row_start} has an unterminated quote.")
    if record_start < len(text):
        rows.append((row_start, cells + ["".join(field)]))
        coordinates.append((row_start, line))
    return rows, coordinates


def csv_rows(data, delimiter=None, selected_encoding=None):
    encoding = selected_encoding or ("utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")
    if selected_encoding == "utf-8":
        encoding = "utf-8-sig"
    elif selected_encoding in {"utf-16le", "utf-16be"} and data.startswith((b"\xff\xfe", b"\xfe\xff")):
        encoding = "utf-16"
    try:
        text = data.decode(encoding)
    except UnicodeDecodeError as error:
        fail(f"CSV encoding is invalid at byte {error.start + 1}. Save the source as UTF-8 CSV and retry.")
    if "\x00" in text:
        fail("The CSV contains unsupported null characters.")
    if selected_encoding is not None:
        return managed_csv_rows(text, delimiter)
    try:
        reader = csv_reader(text, delimiter or csv_delimiter(text[:8192]))
        rows = []
        coordinates = []
        while True:
            start = reader.line_num + 1
            try:
                cells = next(reader)
            except StopIteration:
                break
            rows.append((start, cells))
            coordinates.append((start, reader.line_num))
            if len(rows) > MAX_ROWS:
                fail("The source exceeds the 25,000-row preparation limit. Split the source and retry.")
        return rows, coordinates
    except csv.Error:
        fail(f"CSV record starting at line {start} is malformed. Check its quoting and save it again.")


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


def xlsx_rows(data, selection=None):
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
        if selection:
            sheets = [sheet for sheet in sheets if sheet.attrib.get("name") == selection.sheet_name]
        if len(sheets) != 1:
            fail("The selected worksheet is missing or ambiguous." if selection else
                 "Import one worksheet at a time. Save each worksheet as its own XLSX or CSV file.")
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
        max_column = 0
        for row in document.iter():
            if local_tag(row) != "row":
                continue
            row_number = row.attrib.get("r", str(previous_row + 1))
            if not row_number.isdigit() or not previous_row < int(row_number) <= 1_048_576:
                fail("The workbook has invalid or repeated worksheet row numbers.")
            previous_row = int(row_number)
            selected_row = not selection or selection.includes_row(previous_row)
            cells = []
            previous_column = 0
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
                if not previous_column < index <= (16_384 if selection else MAX_COLUMNS):
                    fail("Workbook cells must be ordered within the column limit.")
                previous_column = index
                max_column = max(max_column, index)
                if selection and (not selected_row or not selection.first_column <= index <= selection.last_column):
                    continue
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
            if selected_row:
                rows.append((previous_row, cells))
            if len(rows) > MAX_ROWS:
                fail("The workbook exceeds the 25,000-row preparation limit.")
        if selection and (previous_row < selection.last_row or max_column < selection.last_column):
            fail("The selected cell range is outside the worksheet.")
        return rows, checked_value(sheet.attrib.get("name", "Worksheet"))


def field(key, value, *, kind="text", required=False, export=False, label=None):
    return {"key": key, "label": label or key.replace("_", " "), "kind": kind,
            "sourceValue": value, "required": required, "export": export}


def proposed_value(value, kind, options=None):
    if not value.strip():
        return None
    if kind == "decimal":
        return rules.parse_decimal(value, options)
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
    "suspicious_audit_period": "This daily/weekly/monthly report spans more than 62 days. Review its year before using the period.",
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


def field_proposal(value, options=None):
    proposal = proposed_value(value["sourceValue"] or "", value["kind"], options)
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


def standard_items(file, headers, target, data_rows, section=None):
    items = []
    for row_number, cells in data_rows:
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
        proposed = {value["key"]: field_proposal(value, file.get("options")) for value in fields}
        if section is not None:
            proposed = {key: rules.apply_text_rules(value, key, section) for key, value in proposed.items()}
            issues.append("The selected preparation recipe proposes these changes; original source values are retained.")
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


def header_keys(cells):
    return [re.sub(r"[\s-]+", "_", value.strip().lower()) for value in cells]


def structured_sections(rows, headers, target):
    sections = []
    data_rows = []
    for number, cells in rows:
        keys = header_keys(cells)
        if len(headers) > 1 and keys == headers:
            continue
        next_target = structured_target("", keys)
        if next_target and data_rows:
            sections.append((target, headers, data_rows))
            target, headers, data_rows = next_target, keys, []
            continue
        if (len(cells) > len(headers)
                or (len(cells) == 1 and len(headers) > 1)
                or next_target
                or keys[0] in {"total", "subtotal", "grand_total"}):
            return [], f"Line {number} may start a different section or control row. Review this source before importing."
        data_rows.append((number, cells))
    if not data_rows:
        return [], None
    sections.append((target, headers, data_rows))
    for target, headers, _ in sections:
        if target == "stock_location" and set(headers) & {"parent_id", "location_id", "warehouse_id"}:
            return [], "Linked location columns require reference review; their rows are retained as source observations."
        if target == "contact" and "parent_id" in headers:
            return [], "Parent contact links require reference review; their rows are retained as source observations."
    return sections, None


def raw_observation(file, number, cells, *, key=None, issue=None):
    raw = json.dumps(cells, ensure_ascii=False, separators=(",", ":"))
    if len(raw.encode("utf-8")) > MAX_VALUE:
        fail("A source section exceeds the 2,000-byte review limit. Select fewer source columns.")
    return {"key": key or f"row-{number}",
            "label": clipped(next((value for value in cells if value.strip()), f"Row {number}"), 300),
            "source": source_ref(file, number),
            "issue": issue or "Review this source evidence before proposing business records.",
            "fields": [field("source_cells", raw, required=True)],
            "proposed": {"source_cells": raw}}


def mapped_observation_items(file, headers, rows, section):
    items = []
    for number, cells in rows:
        item = raw_observation(file, number, cells)
        dates = []
        for column, key in enumerate(headers):
            original = cells[column] if column < len(cells) else ""
            known = key in rules.OBSERVATION_FIELDS
            safe_key = key if known else f"source_column_{section.first_column + column}"
            kind = ("decimal" if key in rules.OBSERVATION_DECIMALS else
                    "date" if key in rules.OBSERVATION_DATES else "text")
            value = field(safe_key, original, kind=kind, required=bool(original.strip()) and kind != "text")
            item["fields"].append(value)
            if kind == "date":
                evidence = source_day(original, order=file["options"].date_order)
                dates.append(evidence)
                candidate = evidence.get("from")
            else:
                candidate = field_proposal(value, file["options"])
            item["proposed"][safe_key] = rules.apply_text_rules(candidate, safe_key, section)
        if file["sheet"]:
            item["fields"].append(field("source_worksheet", file["sheet"]))
            item["proposed"]["source_worksheet"] = file["sheet"]
        if len(item["fields"]) > 32:
            fail("A source section exceeds the 32-field review limit. Select fewer source columns.")
        if dates:
            known_dates = {value.get("from") for value in dates if value["precision"] == "day"}
            if any(value["precision"] == "invalid" for value in dates) or len(known_dates) > 1:
                item["businessDate"] = {"precision": "invalid", "raw": clipped("; ".join(value["raw"] for value in dates), MAX_VALUE)}
                item["issue"] = "Source dates are invalid or conflict; confirm the relevant business date."
            else:
                item["businessDate"] = next((value for value in dates if value["precision"] == "day"), dates[0])
        item["issue"] += " These are historical source facts, not verified settlement, current stock, or posted transactions."
        items.append(item)
    return items


def section_metadata(section, target=None):
    return {"key": section.key, "targetEntity": target or section.target_entity,
            "headerRecord": section.header_record, "firstRecord": section.first_record,
            "lastRecord": section.last_record, "firstColumn": section.first_column,
            "lastColumn": section.last_column, "headerSha256": rules.fingerprint(section.expected_headers)}


def prepare_sections(file, mode, duplicate):
    """Apply only exact, source-bound sections; unselected cells stay in review."""
    options = file["options"]
    batches = []
    claimed = defaultdict(set)
    file["sections"] = []
    for section in options.sections:
        if section.last_record > len(file["rows"]):
            fail("A prepared section exceeds this source. Review the changed layout.")
        header = file["rows"][section.header_record - 1][1]
        actual = header[section.first_column - 1:section.last_column]
        if actual != list(section.expected_headers):
            fail("A section header differs from the approved layout. Review its mapping before reusing the recipe.")
        normalized = header_keys(actual)
        headers = [section.header_map.get(original, normalized[index]) for index, original in enumerate(actual)]
        if len(set(headers)) != len(headers):
            fail("A section has duplicate mapped headers. Select distinct columns before continuing.")
        known_fields = rules.OBSERVATION_FIELDS if section.target_entity == "source_observation" else TARGET_FIELDS[section.target_entity]
        if any(target not in known_fields for target in section.header_map.values()):
            fail("A header mapping uses a field outside the selected preparation contract.")
        if any(rule["field"] not in headers for rule in (*section.aliases, *section.transforms)):
            fail("A text rule refers to a field outside its selected source section.")
        if any(key not in headers or key not in known_fields for key in section.identity_fields):
            fail("Business identity fields must be explicitly mapped in the source section.")
        if section.target_entity != "source_observation" and "name" not in headers:
            fail("The selected master-data section needs an explicit name column.")
        if ((section.target_entity == "stock_location" and set(headers) & {"parent_id", "location_id", "warehouse_id"})
                or (section.target_entity == "contact" and "parent_id" in headers)):
            fail("Linked master-data columns need a registered reference resolver before native preparation.")
        target = "source_observation" if mode == "inspect_only" or duplicate else section.target_entity
        file["sections"].append(section_metadata(section, target))
        claimed[section.header_record].update(range(section.first_column, section.last_column + 1))
        rows = []
        for record in range(section.first_record, section.last_record + 1):
            number, full_cells = file["rows"][record - 1]
            cells = full_cells[section.first_column - 1:section.last_column]
            if len(section.expected_headers) > 1 and cells == list(section.expected_headers):
                claimed[record].update(range(section.first_column, section.last_column + 1))
                continue
            if not any(value.strip() for value in cells):
                continue
            # Control totals remain evidence. They must never become an extra
            # product/contact or another financial transaction.
            if header_keys(cells)[0] in {"total", "subtotal", "grand_total"}:
                continue
            claimed[record].update(range(section.first_column, section.last_column + 1))
            rows.append((number, cells))
        if mode == "inspect_only" or duplicate:
            items = [raw_observation(file, number, cells) for number, cells in rows]
        elif target == "source_observation":
            items = mapped_observation_items(file, headers, rows, section)
        else:
            items = standard_items(file, headers, target, rows, section)
        for item in items:
            item["key"] = f"{section.key}-{item['key']}"
            if section.identity_fields and mode != "inspect_only" and not duplicate:
                record = file["record_numbers"][item["source"]["row"]]
                start, end = file["coordinates"][record - 1]
                file["identities"].append({
                    "namespace": section.identity_namespace, "targetEntity": target,
                    "identityFields": list(section.identity_fields),
                    "identityValues": [item["proposed"].get(key) for key in section.identity_fields],
                    "facts": {key: value for key, value in item["proposed"].items()
                              if key not in {"source_cells", "source_worksheet"}},
                    "source": {"fileName": file["name"], "sourceSha256": file["sha256"],
                               "record": record, "rowStart": start, "rowEnd": end,
                               "sectionKey": section.key, "itemKey": item["key"]},
                })
        if items:
            batches.append((target, items))
    remaining = []
    for record, (number, cells) in enumerate(file["rows"], 1):
        unselected = [value if column not in claimed[record] else "" for column, value in enumerate(cells, 1)]
        if any(value.strip() for value in unselected):
            remaining.append(raw_observation(file, number, unselected, key=f"unselected-row-{number}",
                                             issue="These cells are outside the selected data sections or contain control totals. They remain source evidence for review."))
    if remaining:
        batches.append(("source_observation", remaining))
    notes = ["Prepared sections preserve all unselected source cells as evidence. No business records were created."]
    if duplicate:
        notes.append("Another selected file contains the same bytes. Both originals are retained for evidence review.")
    if not batches:
        fail("The selected sections contain no data records to review.")
    blank_count = sum(not any(value.strip() for value in cells) for _, cells in file["rows"])
    reviewed_rows = {item["source"]["row"] for _, items in batches for item in items}
    header_count = sum(any(value.strip() for value in cells) and number not in reviewed_rows for number, cells in file["rows"])
    return batches, notes, blank_count, header_count


def automatic_section(file, key, target, items, headers=None):
    records = [file["record_numbers"][item["source"]["row"]] for item in items]
    first = min(records)
    last = max(records)
    matching_headers = [record for record, (_, cells) in enumerate(file["rows"][:first - 1], 1)
                        if headers is not None and header_keys(cells) == headers]
    return {"key": key, "targetEntity": target, "headerRecord": matching_headers[-1] if matching_headers else None,
            "firstRecord": first, "lastRecord": last, "firstColumn": 1,
            "lastColumn": max((len(file["rows"][record - 1][1]) for record in records), default=0),
            "headerSha256": rules.fingerprint(file["rows"][matching_headers[-1] - 1][1]) if matching_headers else None}


def layout_fingerprint(file):
    """Pin original headers and section starts, allowing an export to grow in rows."""
    sections = []
    for section in file["sections"]:
        sections.append({key: section[key] for key in (
            "key", "targetEntity", "headerRecord", "firstRecord", "firstColumn", "lastColumn", "headerSha256")})
    return rules.fingerprint({"worksheet": file["sheet"], "sections": sections})


def file_coverage(file, batches):
    item_keys = defaultdict(list)
    for _, items in batches:
        for item in items:
            item_keys[item["source"]["row"]].append(item["key"])
    records = []
    for index, ((number, cells), (start, end)) in enumerate(zip(file["rows"], file["coordinates"]), 1):
        disposition = "review" if item_keys[number] else "header" if any(value.strip() for value in cells) else "blank"
        sections = [section["key"] for section in file["sections"]
                    if section["headerRecord"] == index or section["firstRecord"] <= index <= section["lastRecord"]]
        records.append({"record": index, "rowStart": start, "rowEnd": end, "columns": len(cells),
                        "sectionKeys": sections, "disposition": disposition, "itemKeys": item_keys[number]})
    counts = Counter(record["disposition"] for record in records)
    return {"fileName": file["name"], "sourceSha256": file["sha256"], "byteCount": file["byte_count"],
            "status": "prepared", "worksheet": file["sheet"], "recordCount": len(records),
            "reviewRecords": counts["review"], "blankRecords": counts["blank"], "headerRecords": counts["header"],
            "records": records, "sections": file["sections"], "layoutSha256": layout_fingerprint(file), "error": None}


def reconcile_report_periods(files):
    """Compare report versions/coverage without treating summary rows as transactions."""
    reports = [(file, block) for file in files for block in file["blocks"]]
    result = []
    for index, (file, block) in enumerate(reports):
        for other_file, other in reports[:index]:
            status = None
            if block["content_hash"] == other["content_hash"]:
                status = "same_record"
            elif block["shop"] is not None and block["shop"] == other["shop"]:
                if block["title"] == other["title"]:
                    status = "conflicting_version"
                elif (block["period"] and other["period"]
                      and max(block["period"]["start"], other["period"]["start"]) <= min(block["period"]["end"], other["period"]["end"])):
                    status = "overlapping_period"
            if status is None:
                continue
            sources = []
            for selected_file, selected_block in ((other_file, other), (file, block)):
                record = selected_block["source"]["row"]
                start, end = selected_file["coordinates"][record - 1]
                sources.append({"fileName": selected_file["name"], "sourceSha256": selected_file["sha256"],
                                "record": record, "rowStart": start, "rowEnd": end,
                                "sectionKey": "table-1", "itemKey": f"row-{start}"})
            result.append({"status": status,
                           "identitySha256": rules.fingerprint({"kind": "report_coverage", "shop": block["shop"],
                                                                "sources": sources}), "sources": sources})
            if len(result) > 5000:
                fail("Too many overlapping report versions were selected. Review a smaller group of source versions.")
    return result


def prepare_managed_selection(file, mode, duplicate):
    selection = file["options"].managed_selection
    rows = [(number, cells) for number, cells in file["rows"] if any(value.strip() for value in cells)]
    header_number = file["selection_header"]
    header = next((cells for number, cells in rows if number == header_number), [])
    data = [(number, cells) for number, cells in rows if number != header_number]
    if not data:
        fail("The selected source cells contain no data rows to review.")
    headers = header_keys(header)
    target = None if mode == "inspect_only" or duplicate or not header else structured_target("", headers)
    notes = ["Only the selected source cells were prepared for review."]
    if target:
        sections, issue = structured_sections(data, headers, target)
        if sections and len(sections) == 1 and sections[0][0] == target:
            items = standard_items(file, headers, target, sections[0][2])
            section = automatic_section(file, "selected-range", target, items, headers)
        else:
            if issue:
                notes.append(issue)
            target = None
    if not target:
        target = "source_observation"
        items = [raw_observation(file, number, cells,
                                 issue="Review this source evidence; no business-record import was approved."
                                 if mode == "inspect_only" else None)
                 for number, cells in data]
        section = automatic_section(file, "selected-range", target, items)
    section.update({"firstColumn": selection.first_column, "lastColumn": selection.last_column})
    file["sections"] = [section]
    return [(target, items)], notes, len(file["rows"]) - len(rows), len(rows) - len(items)


def prepare_file(file, mode, duplicate):
    if file.get("options") and file["options"].managed_selection:
        return prepare_managed_selection(file, mode, duplicate)
    if file.get("options") and file["options"].sections:
        return prepare_sections(file, mode, duplicate)
    visible = [(number, cells) for number, cells in file["rows"] if any(value.strip() for value in cells)]
    if not visible:
        fail("A selected source has no nonempty rows to review.")
    headers = header_keys(visible[0][1])
    target = None if mode == "inspect_only" or file["blocks"] or duplicate else structured_target(file["name"], headers)
    notes = []
    if duplicate:
        notes.append("Another selected file contains the same bytes. Both originals are retained for evidence review.")
    if target:
        sections, issue = structured_sections(visible[1:], headers, target)
        if sections:
            batches = [(entity, standard_items(file, keys, entity, rows)) for entity, keys, rows in sections]
            file["sections"] = [automatic_section(file, f"table-{index}", entity, items, keys)
                                for index, ((entity, keys, _), (_, items)) in enumerate(zip(sections, batches), 1)]
        elif issue:
            notes.append(issue)
            batches = [("source_observation", observation_items(file, file["blocks"]))]
        else:
            fail("A selected structured table has no data rows to review.")
    else:
        batches = [("source_observation", observation_items(file, file["blocks"], inspection_only=mode == "inspect_only"))]
    if not file["sections"]:
        file["sections"] = [automatic_section(file, f"table-{index}", target, items)
                            for index, (target, items) in enumerate(batches, 1) if items]
    if file["sheet"]:
        notes.append("XLSX source rows refer to original worksheet row numbers.")
    blank_count = len(file["rows"]) - len(visible)
    header_count = len(visible) - sum(len(items) for _, items in batches)
    return batches, notes, blank_count, header_count


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


DATE_HEADERS = {"date", "as_of", "invoice_date", "business_date", "count_date", "balance_date", "source_count_date"}


def source_day(raw, *, day_first=False, order="iso"):
    """Locale dates require a reviewed option or an already verified farm layout."""
    return rules.parse_date(raw, "dmy" if day_first else order)


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
    # Use the same tail interpretation as offline recovery, retaining every raw
    # row here. The API owns revisions and human confirmation of all proposals.
    tail_items = {}
    tail_dates = {}
    if blocks and not inspection_only:
        observations, _ = farm.supplemental_observations(
            [{"file": file["name"], "sha256": file["sha256"],
              "rows": [cells for _, cells in file["rows"]]}], blocks
        )
        for dataset in farm.supplemental_review_datasets(observations):
            for item in dataset["items"]:
                tail_items[item["source"]["row"]] = item
        by_id = {block["id"]: block for block in blocks}
        tail_dates = {observation["source"]["row"]: business_date(by_id[observation["audit_id"]])
                      for observation in observations}
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
                options = file.get("options")
                item["businessDate"] = source_day(next(iter(known_dates), ""), order=options.date_order if options else "iso")
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
        if record_index in tail_items:
            tail = tail_items[record_index]
            issues.append(tail["issue"])
            item["businessDate"] = tail_dates[record_index]
            for value in tail["fields"]:
                # source_cells already holds the complete original row.
                if value["key"].startswith("source_text_"):
                    continue
                fields.append(value)
                candidate = tail["proposed"][value["key"]]
                proposed[value["key"]] = (proposed_value(candidate or "", "decimal")
                                           if value["kind"] == "decimal" else candidate)
        if file["sheet"]:
            fields.append(field("source_worksheet", file["sheet"]))
            proposed["source_worksheet"] = file["sheet"]
        item.update({"label": clipped(label, 300), "issue": clipped(" ".join(issues), 2000), "fields": fields, "proposed": proposed})
        items.append(item)
    return items


def source_rows(name, data, options=None):
    suffix = Path(name).suffix.lower()
    sheet = None
    selection = options.managed_selection if options else None
    selection_header = None
    if suffix == ".csv":
        if selection and (selection.encoding is None or options.delimiter is None):
            fail("An exact CSV selection requires the viewer encoding and delimiter.")
        rows, coordinates = csv_rows(data, options.delimiter if options else None,
                                     selection.encoding if selection else None)
        if selection:
            if (selection.last_row > len(rows)
                    or selection.last_column > max((len(cells) for _, cells in rows), default=0)):
                fail("The selected cell range is outside the CSV.")
            indices = [index for index in range(len(rows)) if selection.includes_row(index + 1)]
            selection_header = rows[selection.header_row - 1][0] if selection.header_row else None
            rows = [rows[index] for index in indices]
            coordinates = [coordinates[index] for index in indices]
    elif suffix == ".xlsx":
        try:
            if selection and (selection.encoding or options.delimiter):
                fail("CSV parsing options cannot be applied to a worksheet.")
            rows, sheet = xlsx_rows(data, selection)
            coordinates = [(number, number) for number, _ in rows]
            selection_header = selection.header_row if selection else None
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, OverflowError, EOFError, zlib.error):
            fail("The XLSX workbook could not be read safely. Save it as CSV and retry.")
    else:
        fail("Only CSV and XLSX sources are supported.")
    if selection:
        start, end = selection.first_column - 1, selection.last_column
        rows = [(number, (cells[start:end] + [""] * (end - start))[:end - start])
                for number, cells in rows]
    for number, cells in rows:
        if len(cells) > MAX_COLUMNS:
            fail(f"Source row {number} exceeds the 200-column preparation limit.")
        for value in cells:
            checked_value(value)
    return rows, sheet, coordinates, selection_header


def prepare(payload):
    mode = payload.get("mode") if isinstance(payload, dict) else None
    if not isinstance(mode, str) or mode not in {"prepare_import", "inspect_only"}:
        fail("Choose an approved preparation or inspection action before processing source files.")
    files = payload.get("files") if isinstance(payload, dict) else None
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        fail("Choose between 1 and 20 source files.")
    rules.object_keys(payload, {"mode", "files", "preparation"}, {"mode", "files"}, "Preparation request")
    preparation = payload.get("preparation")
    file_options = rules.parse_preparation(preparation)
    decoded, names, errors = [], set(), {}
    originals = []
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
        names.add(name)
        digest = hashlib.sha256(data).hexdigest()
        options = file_options.get(name)
        if options is not None and options.source_sha256 != digest:
            fail("Preparation options refer to different source bytes. Review this version before continuing.")
        originals.append({"fileName": name, "sourceSha256": digest, "byteCount": len(data)})
        try:
            rows, sheet, coordinates, selection_header = source_rows(name, data, options)
        except PreparationError as error:
            errors[name] = str(error)
            continue
        total_rows += sum(any(value.strip() for value in cells) for _, cells in rows)
        total_cells += sum(len(cells) for _, cells in rows)
        if total_rows > MAX_ROWS or total_cells > MAX_CELLS:
            fail("The source selection exceeds 25,000 rows or 100,000 cells. Split the selection and retry.")
        decoded.append({"name": name, "sha256": digest, "byte_count": len(data), "rows": rows,
                        "sheet": sheet, "coordinates": coordinates, "options": options, "selection_header": selection_header,
                        "record_numbers": {number: index for index, (number, _) in enumerate(rows, 1)},
                        "sections": [], "identities": []})
    if set(file_options) - names:
        fail("Preparation options refer to a source outside this selection.")

    all_blocks = []
    for file in decoded:
        file["blocks"] = ([] if file["options"] and file["options"].managed_selection else
                          farm.audit_blocks(file["name"], [cells for _, cells in file["rows"]]))
        all_blocks.extend(file["blocks"])
    warnings = set()
    for index, block in enumerate(all_blocks):
        for other in all_blocks[:index]:
            issue = None
            if block["data_hash"] == other["data_hash"]:
                issue = "duplicate_audit_dataset"
            elif block["shop"] == other["shop"] and block["title"] == other["title"]:
                issue = "conflicting_same_title_audits"
            elif (block["shop"] is not None and block["shop"] == other["shop"]
                  and block["period"] and other["period"]
                  and max(block["period"]["start"], other["period"]["start"]) <= min(block["period"]["end"], other["period"]["end"])):
                issue = "overlapping_shop_periods"
            if issue:
                block["issues"].append(issue)
                other["issues"].append(issue)
                warnings.add(AUDIT_ISSUES[issue])
    prepared_files = []
    hashes = Counter(file["sha256"] for file in decoded)
    for file in decoded:
        try:
            batches, notes, blanks, headers = prepare_file(file, mode, hashes[file["sha256"]] > 1)
            expected_layout = file["options"].expected_layout_sha256 if file["options"] else None
            if expected_layout is not None and layout_fingerprint(file) != expected_layout:
                fail("The source headers or section layout differ from this recipe. Review the changed layout before reusing its rules.")
        except PreparationError as error:
            errors[file["name"]] = str(error)
            continue
        for note in notes:
            warnings.add(f'{file["name"]} — {note}')
        warnings.add(f'{file["name"]} — {len(file["rows"])} source records: '
                     f'{sum(len(items) for _, items in batches)} for review, {blanks} blank, {headers} headers.')
        prepared_files.append((file, batches))

    reconciliation = rules.reconcile_identities([record for file, _ in prepared_files for record in file["identities"]])
    if mode != "inspect_only":
        reconciliation.extend(reconcile_report_periods([file for file, _ in prepared_files if not (file.get("options") and file["options"].sections)]))
    uncertain_identities = {(source["fileName"], source["itemKey"])
                            for decision in reconciliation for source in decision["sources"]}
    if reconciliation:
        counts = Counter(decision["status"] for decision in reconciliation)
        for status, count in sorted(counts.items()):
            warnings.add(f"Business identity review: {count} {status.replace('_', ' ')} group(s). Affected rows remain evidence until their identity is resolved.")
    datasets, coverage_files = [], {}
    for file, prepared_batches in prepared_files:
        batches = []
        for target, items in prepared_batches:
            ready, held = [], []
            for item in items:
                if (file["name"], item["key"]) in uncertain_identities:
                    item["issue"] = clipped("Resolve the repeated, conflicting or missing business identity before creating records. " + item["issue"], 2000)
                    for value in item["fields"]:
                        value["export"] = False
                    (ready if target == "source_observation" else held).append(item)
                else:
                    ready.append(item)
            if ready:
                batches.append((target, ready))
            if held:
                batches.append(("source_observation", held))
        coverage_files[file["name"]] = file_coverage(file, batches)
        for section, (target, items) in enumerate(batches, 1):
            for offset in range(0, len(items), 1000):
                title = clipped(file["name"], 130 if len(batches) > 1 else 160)
                if len(batches) > 1:
                    title += f" · table {section}"
                if len(items) > 1000:
                    title += f" · rows {offset + 1}–{min(offset + 1000, len(items))}"
                datasets.append({"format": "lumiere-import-review/v1", "title": title, "targetEntity": target,
                                 "sourceFile": file["name"], "items": items[offset:offset + 1000]})
    if not datasets and not decoded:
        fail("; ".join(f"{name} — {error}" for name, error in errors.items())[:1000])
    warnings.update(f"{name} — held. {error}" for name, error in errors.items())
    coverage = {"version": 1, "complete": not errors, "files": [], "reconciliation": reconciliation}
    for original in originals:
        name = original["fileName"]
        coverage["files"].append(coverage_files.get(name) or {
            **original, "status": "held", "worksheet": None, "recordCount": None,
            "reviewRecords": 0, "blankRecords": 0, "headerRecords": 0,
            "records": [], "sections": [], "layoutSha256": None, "error": errors[name],
        })
    receipt = {"version": 1, "engineVersion": "lumiere-import-preparation/2",
               "sourceFingerprint": rules.fingerprint([{key: source[key] for key in ("fileName", "sourceSha256")} for source in originals]),
               "optionsSha256": rules.fingerprint(preparation),
               "outputSha256": rules.fingerprint({"datasets": datasets, "coverage": coverage}),
               "recipe": preparation.get("recipe") if preparation else None,
               "semantics": "deterministic_review_proposals"}
    result = {"datasets": datasets, "warnings": sorted(warnings), "coverage": coverage, "preparationReceipt": receipt}
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

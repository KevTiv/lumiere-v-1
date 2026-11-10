"""Bounded, reproducible import rules. These rules only prepare review proposals."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
import hashlib
import json
import re
from typing import Any


class PreparationError(ValueError):
    """An actionable preparation error which contains no source cell values."""


def fingerprint(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def object_keys(value: Any, allowed: set[str], required: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) - allowed or not required <= set(value):
        raise PreparationError(f"{label} contains missing or unsupported options.")
    return value


def bounded_text(value: Any, maximum: int, label: str) -> str:
    if (not isinstance(value, str) or not value or len(value.encode("utf-8")) > maximum
            or any(ord(character) < 32 for character in value)):
        raise PreparationError(f"{label} must be bounded text without control characters.")
    return value


def positive_int(value: Any, maximum: int, label: str) -> int:
    if type(value) is not int or not 1 <= value <= maximum:
        raise PreparationError(f"{label} is outside the supported range.")
    return value


def field_key(value: Any) -> str:
    if (not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,99}", value)
            or value in {"constructor", "prototype"}):
        raise PreparationError("A preparation field name is invalid.")
    return value


# Deliberately excludes IDs, money, quantities, dates, status and approval fields.
# Localized numbers/dates have their own strict rules; aliases never convert units.
TEXT_RULE_FIELDS = frozenset({
    "name", "description", "internal_reference", "barcode", "first_name", "last_name",
    "title", "email", "email_secondary", "phone", "mobile", "fax", "website", "street",
    "street2", "city", "state_code", "zip", "country_code", "tax_id", "company_registry",
    "industry", "notes", "complete_name", "product_label", "category", "counterparty",
    "document_reference", "external_reference", "currency", "business_interpretation",
})
OBSERVATION_DECIMALS = frozenset({"amount", "quantity", "pieces", "kilograms", "debit", "credit"})
OBSERVATION_DATES = frozenset({"date", "business_date", "as_of", "invoice_date", "count_date", "balance_date"})
OBSERVATION_FIELDS = frozenset({
    "description", "name", "product_label", "category", "counterparty", "document_reference",
    "external_reference", "currency", "unit", "reported_method", "reported_destination",
    "business_interpretation", "observation_kind", "debit_account_id", "credit_account_id", "currency_id",
}) | OBSERVATION_DECIMALS | OBSERVATION_DATES


@dataclass(frozen=True)
class Section:
    key: str
    header_record: int
    first_record: int
    last_record: int
    target_entity: str
    expected_headers: tuple[str, ...]
    header_map: dict[str, str]
    aliases: tuple[dict[str, str], ...]
    transforms: tuple[dict[str, str], ...]
    first_column: int
    last_column: int
    identity_namespace: str | None
    identity_fields: tuple[str, ...]


@dataclass(frozen=True)
class FilePreparation:
    file_name: str
    source_sha256: str
    delimiter: str | None
    decimal_separator: str | None
    grouping_separator: str
    date_order: str
    sections: tuple[Section, ...]
    expected_layout_sha256: str | None = None


def parse_section(value: Any) -> Section:
    allowed = {"key", "headerRecord", "firstRecord", "lastRecord", "targetEntity",
               "expectedHeaders", "headerMap", "aliases", "transforms", "firstColumn",
               "lastColumn", "identityNamespace", "identityFields"}
    row = object_keys(value, allowed, {"key", "headerRecord", "firstRecord", "lastRecord",
                                     "targetEntity", "expectedHeaders"}, "A source section")
    key = bounded_text(row["key"], 64, "Section identity")
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]*", key):
        raise PreparationError("Section identity must use letters, digits, underscores or hyphens.")
    header = positive_int(row["headerRecord"], 25_000, "Header record")
    first = positive_int(row["firstRecord"], 25_000, "First source record")
    last = positive_int(row["lastRecord"], 25_000, "Last source record")
    if not header < first <= last:
        raise PreparationError("A section needs a header before its ordered data records.")
    target = row["targetEntity"]
    if not isinstance(target, str) or target not in {"product", "contact", "stock_location", "source_observation"}:
        raise PreparationError("This destination requires a registered preparation contract.")
    headers = row["expectedHeaders"]
    if (not isinstance(headers, list) or not 1 <= len(headers) <= 200
            or any(not isinstance(item, str) or len(item.encode("utf-8")) > 2000 for item in headers)):
        raise PreparationError("A section needs its exact bounded source headers.")
    start_column = positive_int(row.get("firstColumn", 1), 200, "First source column")
    end_column = positive_int(row.get("lastColumn", start_column + len(headers) - 1), 200,
                              "Last source column")
    if end_column - start_column + 1 != len(headers):
        raise PreparationError("Section columns must match its expected source headers.")
    mapping = row.get("headerMap", {})
    if not isinstance(mapping, dict) or len(mapping) > 200 or not set(mapping) <= set(headers):
        raise PreparationError("Header mappings must name columns from the reviewed section.")
    for target_field in mapping.values():
        field_key(target_field)
    if len(set(mapping.values())) != len(mapping):
        raise PreparationError("Several source columns cannot silently replace the same field.")
    aliases = row.get("aliases", [])
    transforms = row.get("transforms", [])
    if not isinstance(aliases, list) or len(aliases) > 100 or not isinstance(transforms, list) or len(transforms) > 100:
        raise PreparationError("A section exceeds the bounded alias or transform limit.")
    seen_aliases: set[tuple[str, str]] = set()
    for alias in aliases:
        object_keys(alias, {"field", "from", "to"}, {"field", "from", "to"}, "An alias")
        if field_key(alias["field"]) not in TEXT_RULE_FIELDS:
            raise PreparationError("Aliases may only suggest text labels; amounts, units, identities and states require explicit review.")
        bounded_text(alias["from"], 2000, "Alias source")
        bounded_text(alias["to"], 2000, "Alias proposal")
        identity = (alias["field"], alias["from"])
        if identity in seen_aliases:
            raise PreparationError("Competing aliases need a separate review decision.")
        seen_aliases.add(identity)
    for transform in transforms:
        object_keys(transform, {"field", "operation"}, {"field", "operation"}, "A transform")
        if (field_key(transform["field"]) not in TEXT_RULE_FIELDS
                or not isinstance(transform["operation"], str)
                or transform["operation"] not in {"trim", "uppercase", "lowercase"}):
            raise PreparationError("Only reviewed text trimming and letter-case transforms are supported.")
    identity_fields = row.get("identityFields", [])
    namespace = row.get("identityNamespace")
    if (not isinstance(identity_fields, list) or len(identity_fields) > 8
            or any(not isinstance(item, str) for item in identity_fields)
            or len(set(identity_fields)) != len(identity_fields)):
        raise PreparationError("A business identity needs at most eight distinct fields.")
    for item in identity_fields:
        field_key(item)
    if bool(identity_fields) != (namespace is not None):
        raise PreparationError("An explicit identity namespace and its fields must be selected together.")
    if namespace is not None:
        bounded_text(namespace, 200, "Identity namespace")
    return Section(key, header, first, last, target, tuple(headers), dict(mapping), tuple(aliases),
                   tuple(transforms), start_column, end_column, namespace, tuple(identity_fields))


def parse_preparation(value: Any) -> dict[str, FilePreparation]:
    if value is None:
        return {}
    body = object_keys(value, {"version", "recipe", "files"}, {"version", "files"}, "Preparation")
    if type(body["version"]) is not int or body["version"] != 1:
        raise PreparationError("This preparation version is unsupported.")
    recipe = body.get("recipe")
    if recipe is not None:
        object_keys(recipe, {"key", "version"}, {"key", "version"}, "A preparation recipe")
        bounded_text(recipe["key"], 100, "Recipe key")
        positive_int(recipe["version"], 2_147_483_647, "Recipe version")
    files = body["files"]
    if not isinstance(files, list) or len(files) > 20:
        raise PreparationError("Preparation supports up to 20 file configurations.")
    result = {}
    for value in files:
        row = object_keys(value, {"fileName", "sourceSha256", "delimiter", "decimalSeparator",
                                 "groupingSeparator", "dateOrder", "sections", "expectedLayoutSha256"},
                          {"fileName", "sourceSha256"}, "File preparation")
        name = bounded_text(row["fileName"], 300, "Prepared filename")
        digest = row["sourceSha256"]
        if name in result or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise PreparationError("File preparation needs one exact source hash per filename.")
        layout = row.get("expectedLayoutSha256")
        if layout is not None and (not isinstance(layout, str) or not re.fullmatch(r"[a-f0-9]{64}", layout)):
            raise PreparationError("A reused source layout needs its exact structural fingerprint.")
        delimiter = row.get("delimiter")
        decimal = row.get("decimalSeparator")
        grouping = row.get("groupingSeparator", "none")
        order = row.get("dateOrder", "iso")
        if delimiter is not None and (not isinstance(delimiter, str) or delimiter not in {",", ";", "\t", "|"}):
            raise PreparationError("Choose a supported CSV delimiter.")
        if decimal is not None and (not isinstance(decimal, str) or decimal not in {".", ","}):
            raise PreparationError("Choose a supported decimal separator.")
        if (not isinstance(grouping, str) or grouping not in {".", ",", " ", "none"} or grouping == decimal
                or (decimal is None and grouping != "none")):
            raise PreparationError("Grouping needs a distinct, explicit decimal separator.")
        if not isinstance(order, str) or order not in {"iso", "dmy", "mdy"}:
            raise PreparationError("Choose ISO, day/month/year or month/day/year dates.")
        source_sections = row.get("sections", [])
        if not isinstance(source_sections, list) or len(source_sections) > 50:
            raise PreparationError("File preparation supports up to 50 reviewed sections.")
        sections = tuple(parse_section(section) for section in source_sections)
        if len({section.key for section in sections}) != len(sections):
            raise PreparationError("Section identities must be distinct within a file.")
        for index, section in enumerate(sections):
            for previous in sections[:index]:
                rows_overlap = max(section.header_record, previous.header_record) <= min(section.last_record, previous.last_record)
                columns_overlap = max(section.first_column, previous.first_column) <= min(section.last_column, previous.last_column)
                if rows_overlap and columns_overlap:
                    raise PreparationError("Source sections cannot reuse the same source cells.")
        result[name] = FilePreparation(name, digest, delimiter, decimal, grouping, order, sections, layout)
    return result


def parse_decimal(raw: str, options: FilePreparation | None = None) -> str | None:
    """Return an exact fixed-point value only under the approved locale, never round."""
    value = raw.strip()
    if not value:
        return None
    decimal = options.decimal_separator if options and options.decimal_separator else "."
    grouping = options.grouping_separator if options else "none"
    sign = "-" if value.startswith("-") else ""
    unsigned = value[1:] if value.startswith(("-", "+")) else value
    parts = unsigned.split(decimal)
    if len(parts) > 2:
        return None
    whole = parts[0]
    fraction = parts[1] if len(parts) == 2 else ""
    if len(parts) == 2 and not re.fullmatch(r"[0-9]{1,6}", fraction):
        return None
    if grouping != "none" and grouping in whole:
        if not re.fullmatch(r"[0-9]{1,3}(?:" + re.escape(grouping) + r"[0-9]{3})+", whole):
            return None
        whole = whole.replace(grouping, "")
    if not re.fullmatch(r"[0-9]+", whole):
        return None
    whole = whole.lstrip("0") or "0"
    if len(whole) > 12:
        return None
    fraction = fraction.rstrip("0")
    if whole == "0" and not fraction:
        sign = ""
    return sign + whole + ("." + fraction if fraction else "")


def parse_date(raw: str, order: str = "iso") -> dict[str, str]:
    value = raw.strip()
    if not value:
        return {"precision": "undated", "raw": raw}
    try:
        if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            parsed = date.fromisoformat(value)
        elif order in {"dmy", "mdy"}:
            match = re.fullmatch(r"([0-9]{1,2})([/.-])([0-9]{1,2})\2([0-9]{4})", value)
            if not match:
                raise ValueError("date format")
            first, second, year = int(match[1]), int(match[3]), int(match[4])
            parsed = date(year, second if order == "dmy" else first, first if order == "dmy" else second)
        else:
            raise ValueError("date order requires review")
        return {"precision": "day", "from": parsed.isoformat(),
                "toExclusive": (parsed + timedelta(days=1)).isoformat(), "raw": raw}
    except (ValueError, OverflowError):
        return {"precision": "invalid", "raw": raw}


def apply_text_rules(value: str | None, field: str, section: Section) -> str | None:
    if value is None:
        return None
    candidate = value
    for rule in section.transforms:
        if rule["field"] == field:
            candidate = {"trim": str.strip, "uppercase": str.upper, "lowercase": str.lower}[rule["operation"]](candidate)
    for rule in section.aliases:
        if rule["field"] == field and rule["from"] == candidate:
            candidate = rule["to"]
            break
    if len(candidate.encode("utf-8")) > 2000:
        raise PreparationError("A transformed value exceeds the source review field limit.")
    return candidate


def reconcile_identities(records: list[dict]) -> list[dict]:
    """Classify reviewed stable keys across exports. This never authorizes a merge."""
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    result = []
    for record in records:
        values = record["identityValues"]
        if any(value is None or not str(value).strip() for value in values):
            result.append({"status": "missing_identity", "identitySha256": None,
                           "sources": [record["source"]]})
            continue
        identity = fingerprint({"namespace": record["namespace"], "fields": record["identityFields"], "values": values})
        grouped[(record["targetEntity"], identity)].append(record)
    for (_, identity), matches in sorted(grouped.items()):
        if len(matches) < 2:
            continue
        same = len({fingerprint(record["facts"]) for record in matches}) == 1
        result.append({"status": "same_record" if same else "conflicting_version",
                       "identitySha256": identity,
                       "sources": [record["source"] for record in matches]})
    return sorted(result, key=lambda item: (item["status"], item["identitySha256"] or "", fingerprint(item["sources"])))

"""Source facts and review proposals for mixed-language shop reports.

This module never calls a provider, database or ERP reducer. Classifications are
proposals, not accounting treatment, payment verification or stock movements.
"""

from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
import unicodedata


def compact(value):
    return " ".join(value.split())


def normalized(value):
    return " ".join(re.findall(r"[^\W_]+", "".join(
        char for char in unicodedata.normalize("NFKD", value.casefold())
        if not unicodedata.combining(char)
    )))


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


# Exact phrase matches are explainable suggestions. Unknown phrases stay notes.
SEMANTIC_PHRASES = {
    "stock_condition": ("inkoko zifite ikibazo",),
    "transfer_note": ("retour hq", "retour au siege", "transfert",),
    "settlement_note": ("versement", "verf", "veri", "cash", "momo", "payement cheq", "paiement cheque"),
    "expense": ("depenses", "depense", "depanses", "expenses", "expense", "amafaranga yakoreshejwe"),
}
EXPENSE_CATEGORIES = {
    "rent": ("loyer", "ubukode"),
    "transport": ("transport", "transportation", "ubwikorezi"),
    "water": ("eau", "amazi", "water"),
    "electricity": ("electricite", "umuriro", "electricity"),
    "staff_payment": ("salaire", "umushahara", "salary"),
}


def contains_phrase(text, phrase):
    return f" {phrase} " in f" {text} "


def is_expense_heading(text):
    label = normalized(text)
    return label.startswith(("depen", "depan", "expense")) or label == "amafaranga yakoreshejwe"


def interpret_note(text, section=None):
    """Return inspectable proposals without asserting their business effects."""
    label = normalized(text)
    for kind, phrases in SEMANTIC_PHRASES.items():
        match = next((phrase for phrase in phrases if contains_phrase(label, phrase)), None)
        if match:
            return {"kind": kind, "matched_phrase": match, "category": None,
                    "requires_confirmation": True, "payment_verified": False}
    for category, phrases in EXPENSE_CATEGORIES.items():
        match = next((phrase for phrase in phrases if contains_phrase(label, phrase)), None)
        if match:
            return {"kind": "expense", "matched_phrase": match, "category": category,
                    "requires_confirmation": True, "payment_verified": False}
    return {"kind": "expense" if section == "expense" else "note", "matched_phrase": None,
            "category": None, "requires_confirmation": True, "payment_verified": False}


def payment_note(text):
    label = normalized(text)
    if any(contains_phrase(label, phrase) for phrase in ("payement cheq", "paiement cheque", "cheque")):
        return {"reported_method": "cheque", "reported_terms": None, "reported_destination": None,
                "payment_verified": False, "source_text": text}
    if label == "credit":
        return {"reported_method": None, "reported_terms": "credit", "reported_destination": None,
                "payment_verified": False, "source_text": text}
    if contains_phrase(label, "momo"):
        return {"reported_method": "mobile_money", "reported_terms": None,
                "reported_destination": "HQ" if contains_phrase(label, "hq") else None,
                "payment_verified": False, "source_text": text}
    return {"reported_method": None, "reported_terms": None, "reported_destination": None,
            "payment_verified": False, "source_text": text}


def date_proposals(title, previous=None, following=None):
    """A mistyped year may have one nearby correction; never change the source."""
    tokens = re.findall(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4})(?!\d)", title)
    if len(tokens) != 2:
        return []
    candidates = []
    for year in sorted({tokens[0][2], tokens[1][2]}):
        try:
            start, end = [date(int(year), int(month), int(day)) for day, month, _ in tokens]
        except ValueError:
            continue
        if not 0 <= (end - start).days <= 31:
            continue
        # At least one reliable neighbour must corroborate the replacement.
        neighbours = []
        if previous:
            neighbours.append(0 <= (start - date.fromisoformat(previous["end"])).days <= 8)
        if following:
            neighbours.append(0 <= (date.fromisoformat(following["start"]) - end).days <= 8)
        if not neighbours or not all(neighbours):
            continue
        candidates.append({"start": start.isoformat(), "end": end.isoformat(),
                           "reason": "same-year dates align with neighbouring report periods",
                           "requires_confirmation": True})
    return candidates


def review_field(key, label, value, kind="text", required=False, proposed=None, options=None):
    field = {"key": key, "label": label, "kind": kind, "sourceValue": value,
             "required": required, "export": False}
    if options is not None:
        field["options"] = options
    return field, value if proposed is None else proposed


def supplemental_observations(raw_sources, blocks):
    """Keep every populated row accountable, including unrecognized footnotes.

    Exact report copies share observations. Equal product data with different
    supplementary rows does not collapse their expenses or settlement notes.
    """
    by_file = defaultdict(list)
    for block in blocks:
        by_file[block["source"]["file"]].append(block)
    observations, coverage, copies = [], [], {}
    for entry in raw_sources:
        filename, rows = entry["file"], entry["rows"]
        disposition = {}
        for block in by_file[filename]:
            lo, hi = block["source"]["row"], block["source_end_row"]
            original = copies.get(block["content_hash"])
            if original:
                for row in range(lo, hi + 1):
                    disposition[row] = {"disposition": "duplicate_report", "canonical_source": original}
                continue
            copies[block["content_hash"]] = block["source"]
            product_rows = {line["source"]["row"] for line in block["lines"]}
            section = None
            for row_number in range(lo, hi + 1):
                cells = rows[row_number - 1]
                populated = [(index, value) for index, value in enumerate(cells) if value.strip()]
                if not populated:
                    disposition[row_number] = {"disposition": "blank"}
                    continue
                if row_number in product_rows:
                    disposition[row_number] = {"disposition": "product_observation"}
                    continue
                if row_number == block.get("primary_total_row"):
                    disposition[row_number] = {"disposition": "summary_only"}
                    continue
                if row_number < block["supplementary_start_row"]:
                    disposition[row_number] = {"disposition": "report_structure_or_inactive_product"}
                    continue
                text = " | ".join(value for _, value in populated)
                if any(normalized(value).startswith("total") for _, value in populated):
                    disposition[row_number] = {"disposition": "summary_only"}
                    continue
                if len(populated) == 1 and is_expense_heading(text):
                    section = "expense"
                    disposition[row_number] = {"disposition": "section_heading"}
                    continue
                interpreted = interpret_note(text, section)
                if interpreted["kind"] == "expense":
                    section = "expense"
                elif interpreted["kind"] in ("settlement_note", "transfer_note"):
                    section = None
                label_cells = [(index, value) for index, value in populated if number(value) is None]
                first_text = label_cells[0][0] if label_cells else -1
                amounts = [(index, number(value)) for index, value in populated
                           if index > first_text and number(value) is not None]
                # Multiple numeric cells might be quantities, prices or totals.
                # Preserve all candidates; do not choose an amount by position.
                amount = amounts[0][1] if len(amounts) == 1 else None
                identifier = "supplement-" + digest([entry["sha256"], row_number])[:24]
                observations.append({"id": identifier, "source": {"file": filename, "row": row_number,
                                     "sha256": entry["sha256"]}, "cells": cells, "source_text": text,
                                     "audit_id": block["id"], "period": block["period"],
                                     "shop": block.get("shop") or block["file_shop"],
                                     "interpretation": interpreted, "amount": amount,
                                     "numeric_candidates": [{"column": index + 1, "value": value}
                                                            for index, value in amounts],
                                     "payment_note": payment_note(text)})
                disposition[row_number] = {"disposition": "source_observation", "observation_id": identifier}
        # Rows outside recognized audit blocks remain explicit, not discarded.
        for index, cells in enumerate(rows, 1):
            if index not in disposition:
                disposition[index] = {"disposition": "unclassified" if any(c.strip() for c in cells) else "blank"}
            coverage.append({"source": {"file": filename, "row": index, "sha256": entry["sha256"]},
                             "nonempty_cells": sum(bool(c.strip()) for c in cells), **disposition[index]})
    return observations, coverage


def utf8_chunks(text, maximum):
    """Keep characters intact while respecting the review API's byte limits."""
    chunk, size = [], 0
    for character in text:
        width = len(character.encode("utf-8"))
        if size + width > maximum:
            yield "".join(chunk)
            chunk, size = [], 0
        chunk.append(character)
        size += width
    if chunk:
        yield "".join(chunk)


def supplemental_review_datasets(observations):
    """Emit documents accepted by the existing revisioned source-review owner."""
    datasets, items = [], []
    for observation in observations:
        text = observation["source_text"]
        if len(text.encode("utf-8")) > 24_000:
            # The archive and coverage ledger retain this row in full. It needs
            # a smaller operator-selected section rather than a truncated review.
            continue
        interpretation = observation["interpretation"]
        fields, proposed = [], {}

        def add(key, label, original, kind="text", required=False, value=None):
            field, proposal = review_field(key, label, original, kind, required, value)
            fields.append(field)
            proposed[key] = proposal

        for index, chunk in enumerate(utf8_chunks(text, 1800), 1):
            add(f"source_text_{index}", f"Original row text {index}", chunk, required=True)
        add("observation_kind", "Proposed historical observation type", None,
            required=True, value=interpretation["kind"])
        add("category", "Proposed category", None, value=interpretation["category"])
        add("amount", "Recorded amount (RWF; verify its meaning)", observation["amount"], "decimal")
        add("shop", "Proposed business location", None, value=observation["shop"])
        if observation["period"]:
            add("period_start", "Report period start", observation["period"]["start"], "date")
            add("period_end", "Report period end", observation["period"]["end"], "date")
        note = observation["payment_note"]
        add("reported_method", "Reported payment method (unverified)", None, value=note["reported_method"])
        add("reported_terms", "Reported credit terms", None, value=note["reported_terms"])
        add("reported_destination", "Reported settlement destination (unverified)", None,
            value=note["reported_destination"])
        add("business_interpretation", "Meaning and supporting evidence", None)
        issue = "Review this historical source observation. It does not create a payment, invoice, expense posting or stock movement."
        if len(observation["numeric_candidates"]) > 1:
            issue += " Multiple numeric cells are preserved in the original text; the amount is unresolved."
        if interpretation["matched_phrase"]:
            issue += f" Proposed classification matched '{interpretation['matched_phrase']}'."
        item = {"key": observation["id"], "label": next(utf8_chunks(text, 300)), "source": observation["source"],
                "issue": issue, "fields": fields, "proposed": proposed}
        candidate = {"format": "lumiere-import-review/v1", "title": "Additional historic report observations",
                     "targetEntity": "source_observation", "sourceFile": "CONTROLE SHOP source archive", "items": items + [item]}
        if items and (len(items) == 1000 or len(json.dumps(candidate, ensure_ascii=False).encode()) > 3_800_000):
            candidate["items"] = items
            datasets.append(candidate)
            items = []
        items.append(item)
    if items:
        datasets.append({"format": "lumiere-import-review/v1", "title": "Additional historic report observations",
                         "targetEntity": "source_observation", "sourceFile": "CONTROLE SHOP source archive", "items": items})
    return datasets


def coverage_summary(coverage):
    populated = [row for row in coverage if row["nonempty_cells"]]
    return {"populated_rows": len(populated), "nonempty_cells": sum(row["nonempty_cells"] for row in populated),
            "dispositions": dict(sorted(Counter(row["disposition"] for row in populated).items())),
            "unclassified_rows": sum(row["disposition"] == "unclassified" for row in populated)}


def alias_proposals(labels):
    """Suggest reviewed company aliases; do not merge identities or prices."""
    groups = {
        "sausage": {"sosiso", "sososo"},
        "tilapia": {"tilapia", "fish trapia", "fish tirapia"},
        "tilapia fillet": {"tirapia fillet", "fillet tirapia", "fillet de tillapia"},
        "steak fillet": {"steak fillet", "steak fllet", "steak fille"},
    }
    result = []
    for candidate, variants in groups.items():
        matches = sorted({label for label in labels if normalized(label) in variants})
        if matches:
            result.append({"candidate_name": candidate, "source_labels": matches,
                           "requires_confirmation": True, "merge_records": False,
                           "convert_quantities": False, "set_current_prices": False})
    unresolved = sorted({label for label in labels if normalized(label) in {"live", "liva", "liver", "river", "fillet"}})
    return {"proposals": result, "labels_requiring_context": unresolved}

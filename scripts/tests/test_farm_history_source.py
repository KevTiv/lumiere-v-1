"""Synthetic report fixtures: no tenant records or private source files."""
import contextlib
import csv
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).parents[1]
sys.path.insert(0, str(SCRIPTS))
from farm_history_source import alias_proposals, interpret_note, payment_note, supplemental_review_datasets

spec = importlib.util.spec_from_file_location("farm_source_preflight", SCRIPTS / "farm-history-preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

HEADER = ["N/S", "DESCRIPTION", "S I", "ENTRE", "TOTAL", "SF", "QTES S", "PU", "TOTAL", "QTES S", "PU", "TOTAL"]
PRODUCT = ["1", "CHICKEN", "10", "2", "12", "4", "8", "100", "800", "8", "150", "1200"]
TOTAL = ["", "TOTAL", "", "", "", "", "", "", "800", "", "", "1200"]


def report(title="AUDIT ZINIA 1/1/2023-7/1/2023", tail=None):
    return [[title], HEADER, PRODUCT, TOTAL] + (tail or [])


class SourceObservationTests(unittest.TestCase):
    def prepare(self, files):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        source, output = root / "source", root / "output"
        source.mkdir()
        for name, rows in files.items():
            with (source / name).open("w", newline="", encoding="utf-8") as stream:
                csv.writer(stream).writerows(rows)
        with contextlib.redirect_stdout(io.StringIO()):
            proposal = preflight.prepare(source, output)
        return source, output, proposal

    def test_all_expense_settlement_and_unknown_sections_are_retained(self):
        rows = [[], ["Company heading"]] + report(tail=[
            ["DÉPENSES"], ["Transport", "500"], ["Ubukode", "1000"],
            ["MOMO HQ", "2000"], ["unrecognized local note", "5", "100"], [],
        ])
        _, output, proposal = self.prepare({"ZINIA.csv": rows})
        observations = json.loads((output / "additional-observations.json").read_text())
        self.assertEqual([item["interpretation"]["kind"] for item in observations],
                         ["expense", "expense", "settlement_note", "note"])
        self.assertEqual(observations[0]["amount"], "500")
        self.assertEqual(observations[1]["interpretation"]["category"], "rent")
        self.assertIsNone(observations[-1]["amount"])
        self.assertEqual(len(observations[-1]["numeric_candidates"]), 2)
        self.assertFalse(observations[2]["payment_note"]["payment_verified"])
        coverage = json.loads((output / "source-coverage.json").read_text())
        self.assertEqual(len(coverage), len(rows))
        self.assertEqual(sum(row["nonempty_cells"] for row in coverage), sum(bool(cell.strip()) for row in rows for cell in row))
        self.assertEqual(coverage[0]["disposition"], "blank")
        self.assertEqual(coverage[1]["disposition"], "unclassified")
        self.assertEqual(proposal["summary"]["production_writes"], 0)

    def test_large_source_rows_are_chunked_or_explicitly_left_for_section_selection(self):
        _, output, proposal = self.prepare({"ZINIA.csv": report(tail=[["é" * 2500], ["é" * 12500]])})
        observations = json.loads((output / "additional-observations.json").read_text())
        datasets = supplemental_review_datasets(observations)
        self.assertEqual(sum(len(dataset["items"]) for dataset in datasets), 1)
        item = datasets[0]["items"][0]
        originals = [field["sourceValue"] for field in item["fields"] if field["key"].startswith("source_text_")]
        self.assertEqual("".join(originals), "é" * 2500)
        self.assertTrue(all(len(value.encode("utf-8")) <= 1800 for value in originals))
        self.assertLessEqual(len(item["fields"]), 32)
        self.assertEqual(len(observations[-1]["source_text"].encode("utf-8")), 25000)
        self.assertLessEqual(len(item["label"].encode("utf-8")), 300)
        coverage = json.loads((output / "source-coverage.json").read_text())
        self.assertTrue(any(row["disposition"] == "review_size_limit_requires_section_selection" for row in coverage))
        self.assertIsNone(payment_note("not credit")["reported_terms"])

    def test_equal_product_data_does_not_drop_different_expense_rows(self):
        _, output, proposal = self.prepare({
            "ZINIA.csv": report(tail=[["DEPENSES"], ["Transport", "500"]]),
            "audit special zinia.csv": report(tail=[["DEPENSES"], ["Transport", "700"]]),
        })
        observations = json.loads((output / "additional-observations.json").read_text())
        self.assertEqual({item["amount"] for item in observations}, {"500", "700"})
        self.assertEqual(proposal["summary"]["unique_audit_datasets"], 1)
        self.assertEqual(proposal["summary"]["duplicate_audit_datasets"], 1)
        audits = json.loads((output / "audit-observations.json").read_text())
        self.assertIn("same_product_data_different_supplementary_rows", audits[0]["issues"])

    def test_complete_report_copies_share_observations_without_losing_source_coverage(self):
        rows = report(tail=[["MOMO HQ", "1200"]])
        _, output, _ = self.prepare({"ZINIA.csv": rows, "audit special zinia.csv": rows})
        observations = json.loads((output / "additional-observations.json").read_text())
        self.assertEqual(len(observations), 1)
        coverage = json.loads((output / "source-coverage.json").read_text())
        self.assertEqual(sum(row["disposition"] == "duplicate_report" for row in coverage), len(rows))

    def test_long_year_typo_has_a_review_proposal_and_does_not_poison_overlaps(self):
        rows = report("AUDIT ZINIA 26/12/2022-01/01/2023")
        rows += report("AUDIT ZINIA 02/01/2022-08/01/2023", [["MOMO HQ", "1200"]])
        rows += report("AUDIT ZINIA 09/01/2023-15/01/2023")
        _, output, proposal = self.prepare({"ZINIA.csv": rows})
        audits = json.loads((output / "audit-observations.json").read_text())
        suspect = audits[1]
        self.assertEqual(suspect["title"], "AUDIT ZINIA 02/01/2022-08/01/2023")
        self.assertIsNone(suspect["period"])
        self.assertEqual(suspect["period_proposals"][0]["start"], "2023-01-02")
        self.assertTrue(suspect["period_proposals"][0]["requires_confirmation"])
        self.assertEqual(proposal["summary"]["overlapping_period_pairs"], 0)
        additional = json.loads((output / "additional-observations.json").read_text())
        self.assertIsNone(additional[0]["period"], "an expense cannot inherit a guessed correction")

    def test_explicit_shop_heading_retains_filename_and_inference_reason(self):
        block = preflight.audit_blocks("kimironko.csv", report("AUDIT KICUKIRO 1/1/2023-7/1/2023"))[0]
        self.assertEqual(block["shop"], "KICUKIRO")
        self.assertEqual(block["file_shop"], "KIMIRONKO")
        self.assertEqual(block["shop_basis"], "explicit_report_heading")
        self.assertIn("file_and_title_shop_disagree", block["issues"])

    def test_review_output_keeps_proposals_unconfirmed_and_unknown_amounts_unknown(self):
        _, output, _ = self.prepare({"ZINIA.csv": report(tail=[["MOMO HQ", "3", "400"]])})
        dataset = json.loads(next((output / "additional-source-reviews").glob("*.json")).read_text())
        self.assertEqual(dataset["targetEntity"], "source_observation")
        item = dataset["items"][0]
        self.assertNotIn("state", item)
        self.assertRegex(item["source"]["sha256"], r"^[0-9a-f]{64}$")
        kind = next(field for field in item["fields"] if field["key"] == "observation_kind")
        self.assertIsNone(kind["sourceValue"])
        self.assertIsNone(item["proposed"]["amount"])
        self.assertNotIn("payment_verified", item["proposed"])
        self.assertLessEqual(len(item["fields"]), 32)

    def test_regeneration_is_identical_and_no_stale_generated_review_survives(self):
        source, output, _ = self.prepare({"ZINIA.csv": report(tail=[["Transport", "500"]])})
        before = {str(path.relative_to(output)): path.read_bytes() for path in output.rglob("*") if path.is_file()}
        with contextlib.redirect_stdout(io.StringIO()):
            preflight.prepare(source, output)
        self.assertEqual(before, {str(path.relative_to(output)): path.read_bytes() for path in output.rglob("*") if path.is_file()})
        (output / "additional-source-reviews" / "operator-note.json").write_text("{}")
        with (source / "ZINIA.csv").open("w", newline="") as stream:
            csv.writer(stream).writerows(report())
        with contextlib.redirect_stdout(io.StringIO()):
            preflight.prepare(source, output)
        self.assertEqual(list((output / "additional-source-reviews").glob("additional-source-*.json")), [])
        self.assertTrue((output / "additional-source-reviews" / "operator-note.json").exists())

    def test_language_hints_never_invent_payments_units_or_entity_merges(self):
        self.assertEqual(payment_note("PAYEMENT CHEQ")["reported_method"], "cheque")
        self.assertEqual(payment_note("PAIEMENT CHÈQUE")["reported_method"], "cheque")
        self.assertEqual(payment_note("CREDIT")["reported_terms"], "credit")
        self.assertFalse(payment_note("MOMO HQ")["payment_verified"])
        self.assertEqual(interpret_note("INKOKO ZIFITE IKIBAZO")["kind"], "stock_condition")
        self.assertEqual(interpret_note("unknown local words")["kind"], "note")
        aliases = alias_proposals(["SOSISO", "SOSOSO", "RIVER", "FILLET"])
        self.assertEqual(aliases["proposals"][0]["source_labels"], ["SOSISO", "SOSOSO"])
        self.assertFalse(aliases["proposals"][0]["merge_records"])
        self.assertEqual(aliases["labels_requiring_context"], ["FILLET", "RIVER"])


if __name__ == "__main__":
    unittest.main()

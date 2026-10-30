import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import csv

spec = importlib.util.spec_from_file_location("farm_preflight", Path(__file__).parents[1] / "farm-history-preflight.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

HEADER = ["N/S", "DESCRIPTION", "S I", "ENTRE", "TOTAL", "SF", "QTES S", "PU", "TOTAL", "QTES S", "PU", "TOTAL"]
LINE = ["1", "CHICKEN", "10", "2", "12", "4", "8", "100", "800", "8", "150", "1200"]
TOTAL = ["", "TOTAL", "", "", "", "", "", "", "800", "", "", "1200"]


class PreflightTests(unittest.TestCase):
    def test_dates_preserve_exact_day_and_reject_invalid_source(self):
        self.assertEqual(module.period("AUDIT SHOP 2/10/-24/10/2021")[0], {"start": "2021-10-02", "end": "2021-10-24"})
        self.assertEqual(module.period("AUDIT SHOP 15/04/2024")[0], {"start": "2024-04-15", "end": "2024-04-15"})
        self.assertIsNone(module.period("AUDIT SHOP 13/12-12/19/2021")[0])
        self.assertIsNone(module.period("AUDIT SHOP 2/11-7/1/2021")[0])
        self.assertIsNone(module.period("AUDIT SHOP 2/11-7/11")[0])
        self.assertEqual(module.period("AUDIT SHOP 2/11/20222-7/11/2022")[1], "invalid_period_year")

    def test_decimal_source_does_not_turn_blank_or_invalid_into_zero(self):
        self.assertEqual(module.number("1,234.567"), "1234.567")
        self.assertEqual(module.number("0"), "0")
        for value in ["", "#REF!", "NaN", "Infinity", "1,2,3"]:
            self.assertIsNone(module.number(value))

    def test_unlabeled_subtotal_and_settlements_are_not_products(self):
        total = TOTAL.copy()
        total[1] = ""
        block = module.audit_blocks("ZINIA.csv", [["AUDIT ZINIA 1/1/2022-7/1/2022"], HEADER, LINE, total, ["", "CASH", "1200"]])[0]
        self.assertEqual(len(block["lines"]), 1)
        self.assertEqual(block["totals"]["sale_amount"]["declared"], "1200")
        self.assertIn("unlabeled_primary_subtotal", block["issues"])

    def test_price_only_template_rows_are_not_activity(self):
        row = ["1", "CHICKEN", "", "", "0", "", "0", "100", "0", "0", "150", "0"]
        block = module.audit_blocks("ZINIA.csv", [["AUDIT ZINIA 1/1/2022-7/1/2022"], HEADER, row, TOTAL])[0]
        self.assertEqual(block["lines"], [])

    def test_continuation_keeps_source_reference_and_parent_label(self):
        continuation = ["", "", "", "", "0", "", "0", "", "", "2", "200", "400"]
        block = module.audit_blocks("ZINIA.csv", [["AUDIT ZINIA 1/1/2022-7/1/2022"], HEADER, LINE, continuation, TOTAL])[0]
        self.assertEqual(block["lines"][1]["product_label"], "CHICKEN")
        self.assertEqual(block["lines"][1]["source"]["row"], 4)
        self.assertIsNone(block["lines"][1]["raw_product_label"])
        self.assertIn("sale_amount_subtotal_mismatch", block["issues"])

    def test_duplicate_files_are_collapsed_and_rerun_is_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            for name in ["ZINIA.csv", "audit special zinia.csv"]:
                with (source / name).open("w", newline="") as handle:
                    csv.writer(handle).writerows([["AUDIT ZINIA 1/1/2022-7/1/2022"], HEADER, LINE, TOTAL])
            output = root / "output"
            with contextlib.redirect_stdout(io.StringIO()):
                module.prepare(source, output)
                first = {p.name: p.read_bytes() for p in output.iterdir()}
                module.prepare(source, output)
            self.assertEqual(first, {p.name: p.read_bytes() for p in output.iterdir()})
            summary = json.loads((output / "import-proposal.json").read_text())["summary"]
            self.assertEqual(summary["unique_audit_datasets"], 1)
            self.assertEqual(summary["duplicate_audit_datasets"], 1)
            self.assertEqual(summary["production_writes"], 0)

    def test_same_title_different_values_are_retained_and_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            for name, amount in [("ZINIA.csv", "1200"), ("audit special zinia.csv", "1300")]:
                row = LINE.copy()
                row[-1] = amount
                with (source / name).open("w", newline="") as handle:
                    csv.writer(handle).writerows([["AUDIT ZINIA 1/1/2022-7/1/2022"], HEADER, row, TOTAL])
            with contextlib.redirect_stdout(io.StringIO()):
                result = module.prepare(source, root / "output")
            self.assertEqual(result["summary"]["unique_audit_datasets"], 2)
            self.assertEqual(result["summary"]["conflicting_audit_titles"], 1)


if __name__ == "__main__":
    unittest.main()

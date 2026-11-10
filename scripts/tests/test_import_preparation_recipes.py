"""Real worker cases for repeatable preparation, source accounting and identity review."""

import base64
import copy
import hashlib
import json
import subprocess
import sys
import unittest

from test_import_task_prepare import SCRIPT, csv_source, module, source, workbook


def config(file, **options):
    return {"fileName": file["fileName"],
            "sourceSha256": hashlib.sha256(base64.b64decode(file["contentBase64"])).hexdigest(),
            **options}


def section(key, headers, *, target="source_observation", first=2, last=2, **options):
    return {"key": key, "headerRecord": 1, "firstRecord": first, "lastRecord": last,
            "targetEntity": target, "expectedHeaders": headers, **options}


def prepare(files, options=None, *, mode="prepare_import"):
    payload = {"mode": mode, "files": files}
    if options is not None:
        payload["preparation"] = {"version": 1, "files": options}
    return module.prepare(payload)


class PreparationRecipeTests(unittest.TestCase):
    def test_coverage_accounts_for_blank_headers_multiline_and_sparse_worksheet_records(self):
        file = source("contacts.csv", '\nname,email\n"Alice\nExample",alice@example.test\nname,email\nBob,bob@example.test\n')
        result = prepare([file])
        coverage = result["coverage"]
        self.assertTrue(coverage["complete"])
        row = coverage["files"][0]
        self.assertEqual((row["recordCount"], row["reviewRecords"], row["blankRecords"], row["headerRecords"]), (5, 2, 1, 2))
        self.assertEqual([(record["record"], record["rowStart"], record["rowEnd"], record["disposition"])
                          for record in row["records"]],
                         [(1, 1, 1, "blank"), (2, 2, 2, "header"), (3, 3, 4, "review"),
                          (4, 5, 5, "header"), (5, 6, 6, "review")])
        self.assertEqual(row["records"][2]["itemKeys"], ["row-3"])
        data = workbook('<row r="3"><c r="A3" t="inlineStr"><is><t>name</t></is></c></row>'
                        '<row r="9"><c r="A9" t="inlineStr"><is><t>Tea</t></is></c></row>')
        sheet = prepare([source("products.xlsx", data)])["coverage"]["files"][0]
        self.assertEqual(sheet["worksheet"], "Sheet 1")
        self.assertEqual([(record["record"], record["rowStart"]) for record in sheet["records"]], [(1, 3), (2, 9)])

    def test_managed_csv_preserves_selected_dialect_values_and_physical_lines(self):
        contents = 'private;name;email;hidden\r\nignored;Before;outside;secret\r\nignore; "Café\r\nShop" ;a@example.test;also hidden\r\n'
        file = source("data.csv", contents.encode("windows-1252"))
        selection = {"documentId": "81", "versionId": "93", "current": False,
                     "sheetName": "CSV", "firstRow": 3, "lastRow": 3,
                     "firstColumn": 2, "lastColumn": 3, "headerRow": 1,
                     "encoding": "windows-1252"}
        result = prepare([file], [config(file, delimiter=";", managedSelection=selection)])
        batch, = result["datasets"]
        self.assertEqual(batch["targetEntity"], "contact")
        item, = batch["items"]
        self.assertEqual(item["source"]["row"], 3)
        self.assertEqual(item["source"]["sha256"], config(file)["sourceSha256"])
        self.assertEqual(item["fields"][0]["sourceValue"], "Café\r\nShop")
        self.assertNotIn("outside", json.dumps(batch))
        self.assertNotIn("also hidden", json.dumps(batch))
        file_coverage = result["coverage"]["files"][0]
        self.assertEqual([(row["rowStart"], row["rowEnd"]) for row in file_coverage["records"]],
                         [(1, 1), (3, 4)])
        self.assertEqual(file_coverage["sections"][0]["firstColumn"], 2)

    def test_managed_workbook_uses_exact_sheet_and_leaves_formulas_outside_selection(self):
        contents = workbook('<row r="2"><c r="A2"><f>NOW()</f></c>'
                            '<c r="B2" t="inlineStr"><is><t>chosen</t></is></c></row>'
                            '<row r="9"><c r="A9" t="inlineStr"><is><t>outside</t></is></c></row>',
                            sheet_count=2)
        file = source("two-sheets.xlsx", contents)
        selection = {"documentId": "81", "versionId": "93", "current": True,
                     "sheetName": "Sheet 1", "firstRow": 2, "lastRow": 2,
                     "firstColumn": 2, "lastColumn": 2}
        result = prepare([file], [config(file, managedSelection=selection)])
        batch, = result["datasets"]
        self.assertEqual(batch["targetEntity"], "source_observation")
        self.assertEqual(batch["items"][0]["source"]["row"], 2)
        self.assertEqual(batch["items"][0]["proposed"]["source_cells"], '["chosen"]')
        self.assertEqual(result["coverage"]["files"][0]["worksheet"], "Sheet 1")
        with self.assertRaisesRegex(module.PreparationError, "missing or ambiguous"):
            prepare([file], [config(file, managedSelection={**selection, "sheetName": "Missing"})])

    def test_held_file_has_exact_original_identity_and_never_claims_record_coverage(self):
        broken = source("broken.csv", 'name,email\n"unfinished')
        result = prepare([broken, source("contacts.csv", "name,email\nAlice,a@example.test\n")])
        self.assertFalse(result["coverage"]["complete"])
        held = result["coverage"]["files"][0]
        self.assertEqual(held["status"], "held")
        self.assertIsNone(held["recordCount"])
        self.assertEqual(held["records"], [])
        self.assertEqual(held["sourceSha256"], config(broken)["sourceSha256"])
        self.assertEqual(held["byteCount"], len(base64.b64decode(broken["contentBase64"])))
        self.assertIn("line 2", held["error"])

    def test_decimal_locale_is_explicit_exact_and_does_not_fill_missing_master_facts(self):
        file = source("products.csv", "name;sale_price;cost_price\nTea;1.234,50;800,1250\nCoffee;12.34,50;1,0000001\n")
        raw = prepare([file])["datasets"][0]["items"][0]
        self.assertIsNone(raw["proposed"]["sale_price"])
        result = prepare([file], [config(file, decimalSeparator=",", groupingSeparator=".")])
        tea, coffee = result["datasets"][0]["items"]
        self.assertEqual(tea["proposed"]["sale_price"], "1234.5")
        self.assertEqual(tea["proposed"]["cost_price"], "800.125")
        self.assertEqual(next(field for field in tea["fields"] if field["key"] == "sale_price")["sourceValue"], "1.234,50")
        self.assertIsNone(coffee["proposed"]["sale_price"])
        self.assertIsNone(coffee["proposed"]["cost_price"])
        for field in ("uom_id", "category_id", "active", "can_be_sold"):
            self.assertIsNone(tea["proposed"][field])

    def test_ambiguous_date_order_requires_a_source_bound_choice(self):
        file = source("history.csv", "name,date,amount\nAlice,03/04/2022,10\n")
        original = prepare([file])["datasets"][0]["items"][1]
        self.assertEqual(original["businessDate"]["precision"], "invalid")
        day_first = prepare([file], [config(file, dateOrder="dmy")])
        month_first = prepare([file], [config(file, dateOrder="mdy")])
        self.assertEqual(day_first["datasets"][0]["items"][1]["businessDate"]["from"], "2022-04-03")
        self.assertEqual(month_first["datasets"][0]["items"][1]["businessDate"]["from"], "2022-03-04")
        self.assertEqual(day_first["preparationReceipt"]["sourceFingerprint"], month_first["preparationReceipt"]["sourceFingerprint"])
        self.assertNotEqual(day_first["preparationReceipt"]["optionsSha256"], month_first["preparationReceipt"]["optionsSha256"])
        self.assertNotEqual(day_first["preparationReceipt"]["outputSha256"], month_first["preparationReceipt"]["outputSha256"])

    def test_reviewed_mixed_language_meaning_is_repeatable_without_verifying_payment(self):
        file = source("expenses.csv", "Itariki;Igikorwa;Amafaranga;Uburyo\n03/04/2022; umuriro ;1.234,50;MOMO\n")
        selection = section("expenses", ["Itariki", "Igikorwa", "Amafaranga", "Uburyo"],
                            headerMap={"Itariki": "business_date", "Igikorwa": "category", "Amafaranga": "amount", "Uburyo": "reported_method"},
                            transforms=[{"field": "category", "operation": "trim"}],
                            aliases=[{"field": "category", "from": "umuriro", "to": "electricity"}])
        options = config(file, dateOrder="dmy", decimalSeparator=",", groupingSeparator=".", sections=[selection])
        result = prepare([file], [options])
        item = result["datasets"][0]["items"][0]
        self.assertEqual(result["datasets"][0]["targetEntity"], "source_observation")
        self.assertEqual(item["proposed"]["amount"], "1234.5")
        self.assertEqual(item["proposed"]["category"], "electricity")
        self.assertEqual(item["proposed"]["reported_method"], "MOMO")
        self.assertEqual(item["businessDate"]["from"], "2022-04-03")
        self.assertNotIn("payment_verified", item["proposed"])
        self.assertNotIn("currency", item["proposed"])
        self.assertTrue(all(not field["export"] for field in item["fields"]))
        self.assertEqual(next(field for field in item["fields"] if field["key"] == "category")["sourceValue"], " umuriro ")
        self.assertEqual(result, prepare([file], [options]))

    def test_side_by_side_sections_preserve_unselected_cells_and_control_totals(self):
        file = csv_source("mixed.csv", [
            ["name", "email", "", "name", "usage"],
            ["Alice", "alice@example.test", "unmapped note", "Shop", "internal"],
            ["TOTAL", "20", "", "stock note", ""],
            ["Outside the selected sections"],
        ])
        options = config(file, sections=[
            section("contacts", ["name", "email"], target="contact", firstColumn=1, lastColumn=2),
            section("locations", ["name", "usage"], target="stock_location", firstColumn=4, lastColumn=5),
        ])
        result = prepare([file], [options])
        self.assertEqual([batch["targetEntity"] for batch in result["datasets"]], ["contact", "stock_location", "source_observation"])
        evidence = [json.loads(item["proposed"]["source_cells"]) for item in result["datasets"][-1]["items"]]
        self.assertIn(["", "", "unmapped note", "", ""], evidence)
        self.assertIn(["TOTAL", "20", "", "stock note", ""], evidence)
        self.assertIn(["Outside the selected sections"], evidence)
        row = result["coverage"]["files"][0]
        self.assertEqual((row["recordCount"], row["reviewRecords"], row["headerRecords"]), (4, 3, 1))
        self.assertEqual(len(row["records"][1]["itemKeys"]), 3)
        self.assertEqual(row["records"][1]["sectionKeys"], ["contacts", "locations"])
        self.assertEqual([(item["firstColumn"], item["lastColumn"]) for item in row["sections"]], [(1, 2), (4, 5)])

    def test_single_column_section_does_not_drop_a_value_equal_to_its_header(self):
        file = source("products.csv", "name\nname\nTea\n")
        result = prepare([file], [config(file, sections=[section("products", ["name"], target="product", last=3)])])
        self.assertEqual([item["label"] for item in result["datasets"][0]["items"]], ["name", "Tea"])

    def test_stale_source_options_and_changed_headers_never_reuse_a_recipe_silently(self):
        file = source("contacts.csv", "name,email\nAlice,a@example.test\n")
        with self.assertRaisesRegex(module.PreparationError, "different source bytes"):
            prepare([file], [{**config(file), "sourceSha256": "f" * 64}])
        options = config(file, sections=[section("contacts", ["name", "phone"], target="contact")])
        result = prepare([file, source("products.csv", "name,sale_price\nTea,10\n")], [options])
        self.assertFalse(result["coverage"]["complete"])
        self.assertEqual(result["coverage"]["files"][0]["status"], "held")
        self.assertIn("differs from the approved layout", result["coverage"]["files"][0]["error"])
        self.assertEqual([batch["sourceFile"] for batch in result["datasets"]], ["products.csv"])

    def test_reused_layout_accepts_changed_rows_but_holds_header_drift_with_receipt(self):
        original = source("products.csv", "name;sale_price\nTea;1,50\n")
        first = prepare([original], [config(original, decimalSeparator=",")])
        layout = first["coverage"]["files"][0]["layoutSha256"]
        changed = source("products-next.csv", "name;sale_price\nTea;2,50\nCoffee;3,00\n")
        replay = prepare([changed], [config(changed, decimalSeparator=",", expectedLayoutSha256=layout)])
        self.assertTrue(replay["coverage"]["complete"])
        self.assertEqual(len(replay["datasets"][0]["items"]), 2)
        self.assertEqual(replay["coverage"]["files"][0]["layoutSha256"], layout)
        drift = source("products-drift.csv", "NAME;sale_price\nTea;2,50\n")
        held = prepare([drift], [config(drift, decimalSeparator=",", expectedLayoutSha256=layout)])
        self.assertFalse(held["coverage"]["complete"])
        self.assertEqual(held["datasets"], [])
        self.assertEqual(held["coverage"]["files"][0]["status"], "held")
        self.assertIn("differ from this recipe", held["coverage"]["files"][0]["error"])
        self.assertEqual(held["preparationReceipt"]["semantics"], "deterministic_review_proposals")

    def test_unsupported_rules_overlapping_sections_and_invalid_shapes_fail_closed(self):
        file = source("products.csv", "name,sale_price\nTea,10\n")
        product = section("products", ["name", "sale_price"], target="product")
        invalid = [
            {"groupingSeparator": ","},
            {"decimalSeparator": ",", "groupingSeparator": ","},
            {"decimalSeparator": []}, {"dateOrder": {}}, {"delimiter": []},
            {"sections": [product, {**product, "key": "duplicate"}]},
            {"sections": [{**product, "identityFields": [{}]}]},
            {"sections": [{**product, "targetEntity": []}]},
            {"sections": [{**product, "aliases": [{"field": "sale_price", "from": "10", "to": "20"}]}]},
            {"sections": [{**product, "aliases": [{"field": "unit", "from": "pieces", "to": "kilograms"}]}]},
            {"sections": [{**product, "transforms": [{"field": "name", "operation": "eval"}]}]},
            {"sections": [{**product, "headerMap": {"name": "name", "sale_price": "name"}}]},
        ]
        for options in invalid:
            with self.subTest(options=options), self.assertRaises(module.PreparationError):
                prepare([file], [config(file, **options)])
        with self.assertRaises(module.PreparationError):
            prepare([file], mode=[])

    def test_inspection_does_not_apply_semantic_recipe_or_emit_native_fields(self):
        file = source("history.csv", "description,amount\nUmuriro,100\n")
        options = config(file, sections=[section("history", ["description", "amount"],
                         aliases=[{"field": "description", "from": "Umuriro", "to": "Electricity"}])])
        result = prepare([file], [options], mode="inspect_only")
        item = result["datasets"][0]["items"][0]
        self.assertEqual(result["datasets"][0]["targetEntity"], "source_observation")
        self.assertEqual(set(item["proposed"]), {"source_cells"})
        self.assertIn("Umuriro", item["proposed"]["source_cells"])

    def test_changed_exports_compare_declared_business_identity_and_hold_conflicting_rows(self):
        first = source("products-old.csv", "name,internal_reference,sale_price\nTea,0001,10\nCoffee,0002,15\n")
        second = source("products-new.csv", "name;internal_reference;sale_price\nTea;0001;12\nCoffee;0002;15\nNew tea;1;10\nUnknown;;9\n")
        headers = ["name", "internal_reference", "sale_price"]
        options = [config(file, sections=[section("products", headers, target="product", last=last,
                          identityNamespace="legacy-products", identityFields=["internal_reference"])])
                   for file, last in [(first, 3), (second, 5)]]
        result = prepare([first, second], options)
        statuses = [row["status"] for row in result["coverage"]["reconciliation"]]
        self.assertCountEqual(statuses, ["same_record", "conflicting_version", "missing_identity"])
        native = [item for batch in result["datasets"] if batch["targetEntity"] == "product" for item in batch["items"]]
        self.assertEqual([item["proposed"]["internal_reference"] for item in native], ["1"])
        self.assertEqual(sum(len(batch["items"]) for batch in result["datasets"]), 6)
        self.assertEqual([entry["reviewRecords"] for entry in result["coverage"]["files"]], [2, 4])
        for batch in result["datasets"]:
            if batch["targetEntity"] == "source_observation":
                self.assertTrue(all(not field["export"] for item in batch["items"] for field in item["fields"]))

    def test_identity_namespaces_do_not_match_unrelated_source_systems(self):
        first = source("one.csv", "name,internal_reference\nTea,A\n")
        second = source("two.csv", "name;internal_reference\nCoffee;A\n")
        options = [config(file, sections=[section("products", ["name", "internal_reference"], target="product",
                         identityNamespace=namespace, identityFields=["internal_reference"])])
                   for file, namespace in [(first, "system-one"), (second, "system-two")]]
        result = prepare([first, second], options)
        self.assertEqual(result["coverage"]["reconciliation"], [])
        self.assertEqual([batch["targetEntity"] for batch in result["datasets"]], ["product", "product"])

    def test_report_period_overlap_is_structured_and_never_implies_transaction_identity(self):
        header = ["DESCRIPTION", "SI", "ENTRE", "TOTAL", "SF", "QTES S", "PU", "TOTAL", "QTES S", "PU", "TOTAL"]
        row = ["CHICKEN", "10", "2", "12", "4", "8", "100", "800", "8", "150", "1200"]
        first = csv_source("ZINIA.csv", [["AUDIT ZINIA 1/1/2022-7/1/2022"], header, row])
        second = csv_source("ZINIA-later.csv", [["AUDIT ZINIA 7/1/2022-10/1/2022"], header, row])
        result = prepare([first, second])
        self.assertEqual([item["status"] for item in result["coverage"]["reconciliation"]], ["overlapping_period"])
        self.assertTrue(all(batch["targetEntity"] == "source_observation" for batch in result["datasets"]))
        self.assertEqual(len(result["datasets"]), 2)

    def test_recipe_version_and_canonical_receipts_survive_isolated_worker_replay(self):
        file = source("products.csv", "name;sale_price\nTea;1,50\n")
        payload = {"mode": "prepare_import", "files": [file], "preparation": {
            "version": 1, "recipe": {"key": "shop-export", "version": 4},
            "files": [config(file, decimalSeparator=",")],
        }}
        expected = module.prepare(payload)
        result = subprocess.run([sys.executable, "-B", "-I", str(SCRIPT)], input=json.dumps(payload),
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), expected)
        receipt = expected["preparationReceipt"]
        self.assertEqual(receipt["recipe"], {"key": "shop-export", "version": 4})
        payload = copy.deepcopy(payload)
        payload["preparation"]["recipe"]["version"] = 5
        changed = module.prepare(payload)["preparationReceipt"]
        self.assertNotEqual(changed["optionsSha256"], receipt["optionsSha256"])
        self.assertEqual(changed["sourceFingerprint"], receipt["sourceFingerprint"])


if __name__ == "__main__":
    unittest.main()

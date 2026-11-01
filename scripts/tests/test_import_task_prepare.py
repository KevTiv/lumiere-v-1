import base64
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock
import zipfile


SCRIPT = Path(__file__).parents[1] / "import-task-prepare.py"
spec = importlib.util.spec_from_file_location("import_task_prepare", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def source(name, contents):
    data = contents.encode() if isinstance(contents, str) else contents
    return {"fileName": name, "contentBase64": base64.b64encode(data).decode()}


def csv_source(name, rows):
    output = io.StringIO(newline="")
    csv.writer(output).writerows(rows)
    return source(name, output.getvalue())


def workbook(rows_xml, *, sheet_count=1, shared_strings=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        sheets = "".join(f'<sheet name="Sheet {number}" sheetId="{number}" r:id="rId{number}"/>'
                         for number in range(1, sheet_count + 1))
        archive.writestr("xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets + "</sheets></workbook>")
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", "<worksheet><sheetData>" + rows_xml + "</sheetData></worksheet>")
        if shared_strings:
            archive.writestr("xl/sharedStrings.xml", shared_strings)
    return output.getvalue()


class PreparationTests(unittest.TestCase):
    def prepare(self, *files):
        return module.prepare({"mode": "prepare_import", "files": list(files)})

    def test_inspection_mode_never_emits_business_import_proposals(self):
        contents = "name,sale_price,cost_price\nSausage,4800,3000\n"
        result = module.prepare({"mode": "inspect_only", "files": [source("products.csv", contents)]})
        self.assertTrue(result["datasets"])
        for dataset in result["datasets"]:
            self.assertEqual(dataset["targetEntity"], "source_observation")
            for item in dataset["items"]:
                self.assertTrue(all(not value["export"] for value in item["fields"]))
                self.assertIn("no business-record import was approved", item["issue"])
                self.assertEqual(item["source"]["sha256"], hashlib.sha256(contents.encode()).hexdigest())

    def test_preparation_rejects_unknown_and_freeform_modes(self):
        for mode in ["other", "import everything now", "", None, 7]:
            with self.subTest(mode=mode):
                with self.assertRaises(module.PreparationError):
                    module.prepare({"mode": mode, "files": [source("products.csv", "name\nSausage\n")]})
        with self.assertRaises(module.PreparationError):
            module.prepare({"files": [source("products.csv", "name\nSausage\n")]})

    def test_csv_preserves_original_hash_and_physical_starting_line(self):
        contents = '\ufeffname,email\r\n"Alice\nExample",alice@example.test\r\nBob,bob@example.test\r\n'
        result = self.prepare(source("contacts.csv", contents))
        batch = result["datasets"][0]
        self.assertEqual(batch["targetEntity"], "contact")
        self.assertEqual([item["source"]["row"] for item in batch["items"]], [2, 4])
        self.assertEqual(batch["items"][0]["source"]["sha256"], hashlib.sha256(contents.encode()).hexdigest())
        self.assertEqual(batch["items"][0]["source"]["rowBasis"], "source_line")
        self.assertEqual(batch["items"][0]["fields"][0]["sourceValue"], "Alice\nExample")
        self.assertIsNone(batch["items"][0]["proposed"]["name"])
        self.assertTrue(batch["items"][0]["fields"][0]["required"])
        self.assertIn("Multiline source text needs a single-line correction", batch["items"][0]["issue"])

    def test_multiline_optional_exported_text_requires_explicit_correction(self):
        original = 'name,email,notes,unmapped\r\nAlice,alice@example.test,"Original\r\nnotes","Original\r\nevidence"\r\nBob,bob@example.test,ordinary,text\r\n'
        batch = self.prepare(source("contacts.csv", original))["datasets"][0]
        first, second = batch["items"]
        self.assertEqual(first["source"]["sha256"], hashlib.sha256(original.encode()).hexdigest())
        self.assertEqual(second["source"]["row"], 5)
        note = next(field for field in first["fields"] if field["key"] == "notes")
        self.assertEqual(note["sourceValue"], "Original\r\nnotes")
        self.assertTrue(note["required"])
        self.assertIsNone(first["proposed"]["notes"])
        self.assertEqual(first["proposed"]["source_column_4"], "Original\r\nevidence")
        self.assertEqual(second["proposed"]["notes"], "ordinary")

    def test_product_mapping_keeps_unknown_prices_and_missing_references(self):
        result = self.prepare(source("products.csv", "name,sale_price,cost_price\nSausage,4800,\n"))
        item = result["datasets"][0]["items"][0]
        self.assertEqual(result["datasets"][0]["targetEntity"], "product")
        self.assertEqual(item["proposed"]["sale_price"], "4800")
        for key in ["cost_price", "uom_id", "uom_po_id", "category_id"]:
            self.assertIsNone(item["proposed"][key])
            self.assertTrue(next(field for field in item["fields"] if field["key"] == key)["required"])

    def test_invalid_decimal_stays_in_source_and_proposal_is_unknown(self):
        item = self.prepare(source("products.csv", "name,sale_price,cost_price\nSausage,NaN,1e3\n"))["datasets"][0]["items"][0]
        self.assertIsNone(item["proposed"]["sale_price"])
        self.assertIsNone(item["proposed"]["cost_price"])
        self.assertEqual(item["fields"][1]["sourceValue"], "NaN")

    def test_location_mapping_and_unknown_columns_are_retained_without_export(self):
        item = self.prepare(source("locations.csv", "name,usage,local comment\nShop,internal,Reviewed\n"))["datasets"][0]
        self.assertEqual(item["targetEntity"], "stock_location")
        unknown = item["items"][0]["fields"][2]
        self.assertEqual(unknown["sourceValue"], "Reviewed")
        self.assertFalse(unknown["export"])

    def test_prepared_location_required_choices_and_linked_source_handling(self):
        batch = self.prepare(source("locations.csv", "name,usage,active,is_scrap\nShop,internal,true,false\n"))["datasets"][0]
        item = batch["items"][0]
        self.assertEqual(batch["targetEntity"], "stock_location")
        self.assertEqual({field["key"] for field in item["fields"] if field["export"]}, {"name", "usage", "active", "is_scrap"})
        self.assertEqual(item["proposed"]["active"], "true")
        unresolved = self.prepare(source("locations.csv", "name,usage\nShop,view\n"))["datasets"][0]["items"][0]
        for key in ["usage", "active", "is_scrap"]:
            self.assertIsNone(unresolved["proposed"][key])
            field = next(field for field in unresolved["fields"] if field["key"] == key)
            self.assertTrue(field["required"])
            self.assertEqual(field["kind"], "choice")
        linked = self.prepare(source("locations.csv", "name,usage,parent_id\nShop,internal,42\n"))
        self.assertEqual(linked["datasets"][0]["targetEntity"], "source_observation")
        self.assertIn("42", linked["datasets"][0]["items"][1]["proposed"]["source_cells"])
        self.assertTrue(linked["warnings"])

    def test_prepared_product_active_and_operating_flags_are_explicit(self):
        item = self.prepare(source("products.csv", "name,sale_price,cost_price\nSausage,4800,100\n"))["datasets"][0]["items"][0]
        for key in ["active", "can_be_sold", "can_be_purchased"]:
            field = next(field for field in item["fields"] if field["key"] == key)
            self.assertEqual(field["kind"], "choice")
            self.assertEqual(field["options"], ["true", "false"])
            self.assertTrue(field["required"])
            self.assertIsNone(item["proposed"][key])

    def test_prepared_contact_roles_are_explicit_and_parent_links_retained(self):
        item = self.prepare(source("contacts.csv", "name,email\nAlice,alice@example.test\n"))["datasets"][0]["items"][0]
        for key in ["type_", "is_customer", "is_vendor", "is_employee", "is_prospect", "is_partner"]:
            field = next(field for field in item["fields"] if field["key"] == key)
            self.assertTrue(field["required"])
            self.assertEqual(field["kind"], "choice")
            self.assertIsNone(item["proposed"][key])
        linked = self.prepare(source("contacts.csv", "name,email,parent_id\nAlice,alice@example.test,42\n"))
        self.assertEqual(linked["datasets"][0]["targetEntity"], "source_observation")
        self.assertTrue(linked["warnings"])

    def test_historical_customer_sales_and_inventory_do_not_become_live_records(self):
        result = self.prepare(source("contacts.csv", "name,email,amount\nAlice,alice@example.test,600\n"),
                              source("products.csv", "name,kilograms,as_of\nChicken,4,2022-10-05\n"))
        self.assertEqual([batch["targetEntity"] for batch in result["datasets"]], ["source_observation"] * 2)
        self.assertIn("600", result["datasets"][0]["items"][1]["proposed"]["source_cells"])

    def test_generic_historical_dates_have_explicit_precision_and_unknowns(self):
        for header in ["date", "as_of", "invoice_date", "business_date"]:
            with self.subTest(header=header):
                batch = self.prepare(source("history.csv", f"name,{header},amount\nAlice,2022-10-05,400\nBob,2022-02-29,100\nCarol,,200\nDavid,05/10/2022,300\n"))["datasets"][0]
                items = batch["items"]
                self.assertEqual(batch["targetEntity"], "source_observation")
                self.assertEqual(items[1]["businessDate"], {"precision": "day", "from": "2022-10-05", "toExclusive": "2022-10-06", "raw": "2022-10-05"})
                self.assertEqual(items[2]["businessDate"], {"precision": "invalid", "raw": "2022-02-29"})
                self.assertEqual(items[3]["businessDate"], {"precision": "undated", "raw": ""})
                self.assertEqual(items[4]["businessDate"], {"precision": "invalid", "raw": "05/10/2022"})
                self.assertNotIn("businessDate", items[0])

    def test_conflicting_date_columns_do_not_choose_an_arbitrary_date(self):
        item = self.prepare(source("history.csv", "name,date,as_of\nAlice,2022-10-05,2023-01-14\n"))["datasets"][0]["items"][1]
        self.assertEqual(item["businessDate"]["precision"], "invalid")
        self.assertNotIn("from", item["businessDate"])

    def test_farm_inventory_date_requires_verified_layout_and_source_heading(self):
        rows = [[""] for _ in range(15)]
        rows[6] = ["INVENTORY COUNT", "05/10/2022"]
        rows[9] = ["", "", "DESCRIPTION", "PCS", "KGS"]
        rows[10] = ["", "", "CHICKEN", "8", "4"]
        batch = self.prepare(csv_source("Sheet5-Table 1.csv", rows))["datasets"][0]
        item = next(item for item in batch["items"] if item["source"]["row"] == 11)
        self.assertEqual(item["businessDate"], {"precision": "day", "from": "2022-10-05", "toExclusive": "2022-10-06", "raw": "05/10/2022"})
        self.assertEqual(item["proposed"]["observation_kind"], "historical_inventory_count")
        self.assertEqual(batch["targetEntity"], "source_observation")
        rows[9] = ["", "", "DESCRIPTION", "UNKNOWN", "UNKNOWN"]
        item = next(item for item in self.prepare(csv_source("Sheet5-Table 1.csv", rows))["datasets"][0]["items"] if item["source"]["row"] == 11)
        self.assertNotIn("businessDate", item)

    def test_farm_balance_date_is_read_from_heading_and_not_filename(self):
        rows = [[""] for _ in range(40)]
        rows[5] = ["DEBTS AS AT", "14/01/2023"]
        rows[7] = ["", "", "Alice", "400"]
        item = next(item for item in self.prepare(csv_source("Sheet2-Table 1.csv", rows))["datasets"][0]["items"] if item["source"]["row"] == 8)
        self.assertEqual(item["businessDate"]["from"], "2023-01-14")
        self.assertEqual(item["proposed"]["observation_kind"], "historical_balance_snapshot")
        rows[5] = ["DEBTS AS AT", "31/02/2023"]
        item = next(item for item in self.prepare(csv_source("Sheet2-Table 1.csv", rows))["datasets"][0]["items"] if item["source"]["row"] == 8)
        self.assertEqual(item["businessDate"]["precision"], "invalid")
        rows[5] = ["DEBTS AS AT"]
        item = next(item for item in self.prepare(csv_source("Sheet2-Table 1.csv", rows))["datasets"][0]["items"] if item["source"]["row"] == 8)
        self.assertNotIn("businessDate", item)

    def test_farm_sales_summary_keeps_period_instead_of_an_invoice_date(self):
        rows = [[""] for _ in range(16)]
        rows[6] = ["CUSTOMER SALES", "13/06/2022", "18/06/2022"]
        rows[9] = ["", "", "Alice", "8", "600", "4800", "not settled"]
        batch = self.prepare(csv_source("Sheet1-Table 1.csv", rows))["datasets"][0]
        item = next(item for item in batch["items"] if item["source"]["row"] == 10)
        self.assertEqual(item["businessDate"]["precision"], "interval")
        self.assertEqual(item["businessDate"]["from"], "2022-06-13")
        self.assertEqual(item["businessDate"]["toExclusive"], "2022-06-19")
        self.assertEqual(item["proposed"]["observation_kind"], "historical_customer_sales_summary")
        self.assertEqual(batch["targetEntity"], "source_observation")

    def test_farm_audit_dates_quantities_and_raw_cells_are_preserved(self):
        rows = [["AUDIT ZINIA 1/1/2022-7/1/2022"],
                ["N/S", "DESCRIPTION", "S I", "ENTRE", "TOTAL", "SF", "QTES S", "PU", "TOTAL", "QTES S", "PU", "TOTAL"],
                ["1", "SAUSAGE", "10", "2", "12", "4", "8", "", "", "8", "600", "4800"],
                ["", "TOTAL", "", "", "", "", "", "", "", "", "", "4800"]]
        result = self.prepare(csv_source("ZINIA.csv", rows))
        item = result["datasets"][0]["items"][2]
        self.assertEqual(item["businessDate"], {"precision": "interval", "from": "2022-01-01", "toExclusive": "2022-01-08", "raw": rows[0][0]})
        self.assertEqual(item["proposed"]["sold_quantity"], "8")
        self.assertEqual(item["proposed"]["sale_unit_price"], "600")
        self.assertIsNone(item["proposed"]["unit"])
        self.assertIsNone(item["proposed"]["cost_unit_price"])
        self.assertEqual(json.loads(item["proposed"]["source_cells"]), rows[2])

    def test_duplicate_conflicting_and_overlapping_farm_files_remain_visible(self):
        header = ["DESCRIPTION", "SI", "ENTRE", "TOTAL", "SF", "QTES S", "PU", "TOTAL", "QTES S", "PU", "TOTAL"]
        row = ["CHICKEN", "10", "2", "12", "4", "8", "100", "800", "8", "150", "1200"]
        rows = [["AUDIT ZINIA 1/1/2022-7/1/2022"], header, row]
        conflict = [*row[:-1], "1300"]
        result = self.prepare(csv_source("ZINIA.csv", rows), csv_source("ZINIA-copy.csv", rows),
                              csv_source("ZINIA-conflict.csv", [rows[0], header, conflict]),
                              csv_source("ZINIA-overlap.csv", [["AUDIT ZINIA 7/1/2022-10/1/2022"], header, row]))
        self.assertEqual(len(result["datasets"]), 4)
        self.assertEqual(result["warnings"], sorted(module.AUDIT_ISSUES[key] for key in
                         ["conflicting_same_title_audits", "duplicate_audit_dataset", "overlapping_shop_periods"]))

    def test_xlsx_preserves_sparse_worksheet_rows_and_shared_strings(self):
        data = workbook('<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="inlineStr"><is><t>email</t></is></c></row>'
                        '<row r="9"><c r="A9" t="inlineStr"><is><t>Alice</t></is></c><c r="B9" t="inlineStr"><is><t>alice@example.test</t></is></c></row>',
                        shared_strings="<sst><si><t>name</t></si></sst>")
        item = self.prepare(source("contacts.xlsx", data))["datasets"][0]["items"][0]
        self.assertEqual(item["source"]["row"], 9)
        self.assertEqual(item["source"]["rowBasis"], "import_row")
        self.assertEqual(item["proposed"]["source_worksheet"], "Sheet 1")
        self.assertEqual(item["source"]["sha256"], hashlib.sha256(data).hexdigest())

    def test_xlsx_formulas_multi_sheet_and_entity_declarations_are_rejected(self):
        sources = [workbook('<row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row>'), workbook("", sheet_count=2)]
        for data in sources:
            with self.subTest(data=len(data)), self.assertRaises(module.PreparationError):
                self.prepare(source("source.xlsx", data))
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("xl/workbook.xml", '<!DOCTYPE x [<!ENTITY data "secret">]><workbook>&data;</workbook>')
        with self.assertRaises(module.PreparationError):
            self.prepare(source("source.xlsx", data.getvalue()))

    def test_csv_semicolon_and_blank_leading_rows(self):
        batch = self.prepare(source("contacts.csv", "\nname;email\nAlice;alice@example.test\n"))["datasets"][0]
        self.assertEqual(batch["targetEntity"], "contact")
        self.assertEqual(batch["items"][0]["source"]["row"], 3)

    def test_datasets_are_chunked_without_losing_rows(self):
        batch = self.prepare(source("contacts.csv", "name,email\n" + "Alice,alice@example.test\n" * 1001))["datasets"]
        self.assertEqual([len(value["items"]) for value in batch], [1000, 1])
        self.assertEqual(batch[1]["items"][0]["source"]["row"], 1002)

    def test_preparation_is_deterministic(self):
        files = [source("products.csv", "name,sale_price\nEgg,100\n"), source("history.csv", "OLD BALANCES\nAlice,400\n")]
        self.assertEqual(self.prepare(*files), self.prepare(*files))

    def test_file_name_encoding_and_selection_validation(self):
        for file in [source("../source.csv", "a"), source("source.pdf", "a"), source("source.csv", b"\xff"),
                     {"fileName": "source.csv", "contentBase64": "!not-base64!"}, source("source.csv", "")]:
            with self.subTest(name=file["fileName"]), self.assertRaises(module.PreparationError):
                self.prepare(file)
        file = source("source.csv", "a")
        with self.assertRaises(module.PreparationError):
            self.prepare(file, file)
        with self.assertRaises(module.PreparationError):
            self.prepare(*[source(f"source-{i}.csv", "a") for i in range(21)])

    def test_cell_row_expansion_and_output_limits_fail_before_partial_results(self):
        cases = [source("source.csv", "x" * 2001), source("source.csv", '"unterminated'),
                 source("source.csv", "\x00")]
        for file in cases:
            with self.subTest(length=len(file["contentBase64"])), self.assertRaises(module.PreparationError):
                self.prepare(file)
        with mock.patch.object(module, "MAX_OUTPUT_BYTES", 20), self.assertRaises(module.PreparationError):
            self.prepare(source("source.csv", "one,two\n"))
        with mock.patch.object(module, "MAX_ROWS", 2), self.assertRaises(module.PreparationError):
            self.prepare(source("source.csv", "one\ntwo\nthree\n"))
        with mock.patch.object(module, "MAX_FILE_BYTES", 2), self.assertRaises(module.PreparationError):
            self.prepare(source("source.csv", "three"))
        with mock.patch.object(module, "MAX_TOTAL_BYTES", 4), self.assertRaises(module.PreparationError):
            self.prepare(source("a.csv", "one"), source("b.csv", "two"))

    def test_cli_protocol_returns_json_and_never_echoes_invalid_source(self):
        result = subprocess.run([sys.executable, "-B", "-I", str(SCRIPT)], input=json.dumps({"mode": "prepare_import", "files": [source("contacts.csv", "name,email\nAlice,alice@example.test\n")]}),
                                text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["datasets"][0]["targetEntity"], "contact")
        invalid = subprocess.run([sys.executable, str(SCRIPT)], input="private source data", text=True, capture_output=True, check=False)
        self.assertEqual(invalid.returncode, 1)
        self.assertEqual(invalid.stderr, "")
        self.assertEqual(json.loads(invalid.stdout), {"error": "The preparation request is not valid JSON."})


if __name__ == "__main__":
    unittest.main()

"""Exercise selected worksheets through the saved import preparation CLI."""

import base64
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest
from xml.sax.saxutils import escape

from test_workbook_extract import NS, PKG, RID, workbook


SCRIPT = Path(__file__).resolve().parents[1] / "import-task-prepare.py"
SHEETS = ("Ventes Kimironko", "Ibyagurishijwe Zinia")
FILENAME = "Shop sales — avril 2024.xlsx"


def audit_sheet(shop, day, sale_headers, lines, subtotal):
    rows = [
        (2, [f"AUDIT {shop} {day}/4/2024 Frw"]),
        (6, ["N/S", "Description", "S I", "ENTRÉE", "TOTAL", "SF",
             "QTES S", "PU", "TOTAL", *sale_headers]),
        (11, ["1", lines[0][0], "", "", "", "", "", "", "", *lines[0][1:]]),
        (13, ["2", lines[1][0], "", "", "", "", "", "", "", *lines[1][1:]]),
        (16, ["", "TOTAL", "", "", "", "", "", "", "", "", "", subtotal]),
        (20, ["", "DÉPENSES"]),
        (21, ["", "Ubukode", "2 000"]),
    ]
    xml = []
    for number, values in rows:
        cells = [f'<c r="{chr(ord("A") + index)}{number}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
                 for index, value in enumerate(values) if value]
        xml.append(f'<row r="{number}">{"".join(cells)}</row>')
    return f'<worksheet xmlns="{NS}"><sheetData>{"".join(xml)}</sheetData></worksheet>'


def shop_workbook():
    kimironko = audit_sheet("KIMIRONKO", 12, ("Ingano yagurishijwe", "Prix unitaire", "Amafaranga yose"),
                            [("INKOKO", "8,125", "4 000", "32 500"),
                             ("Œufs", "2,5", "1 200,02", "3 000,05")], "35 500,06")
    zinia = audit_sheet("ZINIA", 13, ("Sold quantity", "Prix unitaire", "Montant"),
                        [("Brochette d’inkoko", "1,25", "8 000,36", "10 000,45"),
                         ("Amagi", "3", "1 000", "2 999,50")], "12 999,95")
    sheets = "".join(f'<sheet name="{name}" sheetId="{index}" r:id="rId{index}"/>'
                     for index, name in enumerate(SHEETS, 1))
    relationships = "".join(f'<Relationship Id="rId{i}" Type="{RID}/worksheet" Target="worksheets/sheet{i}.xml"/>'
                            for i in range(1, len(SHEETS) + 1))
    return workbook(kimironko, workbook_xml=f'<workbook xmlns="{NS}" xmlns:r="{RID}"><sheets>{sheets}</sheets></workbook>',
                    extra={"xl/_rels/workbook.xml.rels": f'<Relationships xmlns="{PKG}">{relationships}</Relationships>',
                           "xl/worksheets/sheet2.xml": zinia})


@unittest.skipUnless(sys.platform == "linux", "Linux workbook worker")
class ShopSalesWorkbookAcceptanceTests(unittest.TestCase):
    def prepare(self, payload, mode="prepare_import"):
        process = subprocess.run([sys.executable, "-B", str(SCRIPT)],
                                 input=json.dumps({**payload, "mode": mode}),
                                 capture_output=True, text=True, timeout=15, check=False)
        self.assertEqual(process.returncode, 0, process.stdout or process.stderr)
        return json.loads(process.stdout)

    def test_selected_sheets_reconcile_exact_amounts_and_keep_holds(self):
        data = shop_workbook()
        checksum = hashlib.sha256(data).hexdigest()
        payload = {"files": [{"fileName": FILENAME, "contentBase64": base64.b64encode(data).decode()}]}
        scan = self.prepare(payload)
        self.assertEqual(scan["datasets"], [])
        selection, = scan["coverage"]["files"]
        self.assertEqual((selection["status"], selection["availableWorksheets"]), ("held", list(SHEETS)))
        payload["preparation"] = {"version": 1, "files": [{
            "fileName": FILENAME, "sourceSha256": checksum, "worksheetNames": list(SHEETS),
            "decimalSeparator": ",", "groupingSeparator": " ", "dateOrder": "dmy",
        }]}

        prepared = self.prepare(payload)
        self.assertEqual({batch["targetEntity"] for batch in prepared["datasets"]}, {"source_observation"})
        self.assertEqual({file["worksheet"]: [record["rowStart"] for record in file["records"]]
                          for file in prepared["coverage"]["files"]},
                         {sheet: [2, 6, 11, 13, 16, 20, 21] for sheet in SHEETS})
        items = [item for batch in prepared["datasets"] for item in batch["items"]]
        by_source = {(item["source"]["sheet"], item["source"]["row"]): item for item in items}
        eligible = {source: item for source, item in by_source.items()
                    if item["proposed"].get("observation_kind") == "historical_shop_sale"}
        self.assertEqual(set(eligible), {(SHEETS[0], 11), (SHEETS[0], 13), (SHEETS[1], 11)})
        amount = Decimal(0)
        expected = {
            (SHEETS[0], 11): ("KIMIRONKO", "2024-04-12", "INKOKO", "8.125", "4000", "32500", "32 500"),
            (SHEETS[0], 13): ("KIMIRONKO", "2024-04-12", "Œufs", "2.5", "1200.02", "3000.05", "3 000,05"),
            (SHEETS[1], 11): ("ZINIA", "2024-04-13", "Brochette d’inkoko", "1.25", "8000.36", "10000.45", "10 000,45"),
        }
        for source, (shop, day, product, quantity, price, total, raw_total) in expected.items():
            with self.subTest(source=source):
                item = eligible[source]
                self.assertEqual(item["source"]["sha256"], checksum)
                self.assertTrue(item["source"]["multiWorksheet"])
                self.assertEqual(item["businessDate"]["from"], day)
                facts = item["proposed"]
                self.assertEqual((facts["shop"], facts["sale_date"], facts["product_label"],
                                  facts["sold_quantity"], facts["sale_unit_price"], facts["sale_amount"],
                                  facts["currency_code"], facts["source_unit"]),
                                 (shop, day, product, quantity, price, total, "RWF", None))
                original_total = next(field for field in item["fields"] if field["key"] == "sale_amount")
                self.assertEqual((original_total["sourceColumn"], original_total["sourceValue"]), (12, raw_total))
                amount += Decimal(facts["sale_amount"])

        self.assertEqual(amount, Decimal("45500.50"))
        held = by_source[(SHEETS[1], 13)]
        self.assertIn("does not equal the recorded sale amount", held["issue"])
        subtotal = by_source[(SHEETS[0], 16)]
        self.assertEqual(Decimal(subtotal["proposed"]["reported_sales_subtotal"]), Decimal("35500.06"))
        self.assertEqual(Decimal(subtotal["proposed"]["source_sales_line_sum"]), Decimal("35500.05"))
        self.assertEqual(Decimal(subtotal["proposed"]["sales_subtotal_difference"]), Decimal("0.01"))

        replay = self.prepare(payload)
        self.assertEqual(prepared, replay)
        inspected = self.prepare(payload, mode="inspect_only")
        self.assertFalse(any(item["proposed"].get("observation_kind") == "historical_shop_sale"
                             for batch in inspected["datasets"] for item in batch["items"]))


if __name__ == "__main__":
    unittest.main()

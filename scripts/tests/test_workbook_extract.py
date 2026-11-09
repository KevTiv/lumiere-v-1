"""Exercise original workbook bytes inside the real syscall-restricted worker."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import zipfile

WORKER = Path(__file__).resolve().parents[1] / "workbook-extract.py"
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RID = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def workbook(sheet=None, extra=None, workbook_xml=None, duplicate=False,
             compression=zipfile.ZIP_STORED):
    parts = {
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
        "xl/workbook.xml": workbook_xml or f'<workbook xmlns="{NS}" xmlns:r="{RID}"><sheets><sheet name="Ledger" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{RID}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": sheet or f'<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Acme</t></is></c></row></sheetData></worksheet>',
    }
    parts.update(extra or {})
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=compression) as archive:
        for name, content in parts.items():
            archive.writestr(name, content)
        if duplicate:
            archive.writestr("XL/WORKBOOK.XML", parts["xl/workbook.xml"])
    return output.getvalue()


def run_worker(data=b"", args=(), pass_fds=()):
    result = subprocess.run(
        ["/usr/bin/python3", "-I", "-S", str(WORKER), *args],
        input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={}, close_fds=True, pass_fds=pass_fds, cwd="/", timeout=12,
    )
    return result.returncode, json.loads(result.stdout)


@unittest.skipUnless(sys.platform == "linux", "Linux seccomp worker")
class WorkbookExtractionTests(unittest.TestCase):
    def assert_rejected(self, data, reason):
        status, result = run_worker(data)
        self.assertEqual(status, 65, result)
        self.assertEqual(result, {"error": reason})

    def test_real_kernel_denies_files_network_process_and_exec(self):
        status, result = run_worker(args=("--probe",))
        self.assertEqual(status, 0, result)
        self.assertEqual(result, dict.fromkeys(("filesystem", "network", "process", "exec", "inherited_fd_closed"), True))

    def test_high_inherited_descriptor_is_closed_before_parsing(self):
        read_fd, write_fd = os.pipe()
        try:
            os.dup2(read_fd, 5000)
            status, result = run_worker(args=("--probe",), pass_fds=(5000,))
            self.assertEqual(status, 0, result)
            self.assertTrue(result["inherited_fd_closed"])
        finally:
            os.close(read_fd)
            os.close(write_fd)
            os.close(5000)

    def test_static_workbook_is_bound_to_original_bytes(self):
        data = workbook(compression=zipfile.ZIP_DEFLATED)
        status, result = run_worker(data)
        self.assertEqual(status, 0, result)
        self.assertEqual(result["csvText"], '"Name"\n"Acme"\n')
        self.assertEqual(result["sheetName"], "Ledger")
        self.assertEqual(result["sourceSha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(result["policyVersion"], "xlsx-static-seccomp-v1")

    def test_signed_numbers_phone_and_quoted_multiline_remain_data(self):
        sheet = f'<worksheet xmlns="{NS}"><sheetData><row><c r="A1" t="inlineStr"><is><t>Value</t></is></c></row><row><c r="A2"><v>-42.50</v></c></row><row><c r="A3" t="inlineStr"><is><t>+31612345678</t></is></c></row><row><c r="A4" t="inlineStr"><is><t>first&#10;&quot;second&quot;</t></is></c></row></sheetData></worksheet>'
        status, result = run_worker(workbook(sheet))
        self.assertEqual(status, 0, result)
        self.assertIn('"-42.50"', result["csvText"])
        self.assertIn('"+31612345678"', result["csvText"])
        self.assertIn('"first\n""second"""', result["csvText"])

    def test_formula_with_cached_value_is_never_evaluated_or_trusted(self):
        sheet = f'<worksheet xmlns="{NS}"><sheetData><row><c r="A1"><f>HYPERLINK("https://example.invalid")</f><v>123</v></c></row></sheetData></worksheet>'
        self.assert_rejected(workbook(sheet), "workbook_formula_requires_values_only_copy")

    def test_viewer_retains_sparse_sheets_and_inert_formula_caches(self):
        book = f'''<workbook xmlns="{NS}" xmlns:r="{RID}">
          <workbookPr date1904="1"/>
          <sheets><sheet name="Ledger" sheetId="1" r:id="rId1"/>
            <sheet name="Notes" sheetId="2" state="hidden" r:id="rId2"/></sheets>
        </workbook>'''
        rel = f'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="{RID}/worksheet" Target="worksheets/sheet1.xml"/>
          <Relationship Id="rId2" Type="{RID}/worksheet" Target="/xl/worksheets/sheet2.xml"/>
        </Relationships>'''
        sheet = f'''<worksheet xmlns="{NS}"><sheetData>
          <row r="1"><c r="A1" s="1"><v>0</v></c><c r="B1" s="2"><v>0.125</v></c>
            <c r="C1" s="3"><v>-1234.5</v></c><c r="D1" s="4"><v>321</v></c></row>
          <row r="4"><c r="B4"><f t="shared" si="0" ref="B4:B5">SUM(A1:A3)</f><v>123</v></c>
            <c r="C4"><f>WEBSERVICE("https://example.invalid")</f><v/></c>
            <c r="D4" t="e"><f>1/0</f><v>#DIV/0!</v></c></row>
          <row r="5"><c r="B5"><f t="shared" si="0"/><v>999</v></c></row>
          <row r="100000"><c r="A100000" t="inlineStr"><is><t>last</t></is></c></row>
          </sheetData><mergeCells><mergeCell ref="A6:C7"/></mergeCells></worksheet>'''
        styles = f'''<styleSheet xmlns="{NS}"><numFmts>
          <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
          <numFmt numFmtId="165" formatCode="&quot;USD &quot;#,##0.00"/>
          </numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="10"/>
            <xf numFmtId="8"/><xf numFmtId="165"/></cellXfs></styleSheet>'''
        data = workbook(sheet, workbook_xml=book, extra={
            "xl/_rels/workbook.xml.rels": rel,
            "xl/styles.xml": styles,
            "xl/worksheets/sheet2.xml": f'<worksheet xmlns="{NS}"><sheetData/></worksheet>',
        })
        status, result = run_worker(data, args=("--viewer",))
        self.assertEqual(status, 0, result)
        self.assertEqual(result["sourceSha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(result["dateSystem"], "1904")
        ledger, notes = result["sheets"]
        self.assertEqual((ledger["id"], ledger["rowCount"], ledger["columnCount"]), ("0", 100000, 4))
        self.assertEqual((notes["id"], notes["visibility"], notes["cells"]), ("1", "hidden", []))
        self.assertEqual(ledger["merges"], [{
            "rowStart": 5, "rowCount": 2, "columnStart": 0, "columnCount": 3,
        }])
        cells = ledger["cells"]
        self.assertEqual([cell["displayValue"] for cell in cells[:4]],
                         ["1904-01-01", "12.50%", "($1,234.50)", "321"])
        self.assertEqual(cells[0]["value"], 0)
        self.assertEqual(cells[3]["formatStatus"], "raw")
        self.assertEqual(cells[4]["formula"], "=SUM(A1:A3)")
        self.assertEqual(cells[4]["formulaRef"], "B4:B5")
        self.assertEqual(cells[4]["formulaStatus"], "cached")
        self.assertEqual(cells[5]["formulaStatus"], "missing")
        self.assertIsNone(cells[5]["value"])
        self.assertEqual(cells[6]["kind"], "error")
        self.assertEqual(cells[7]["formulaSharedIndex"], "0")
        self.assertNotIn("formula", cells[7])
        self.assertEqual(cells[8]["row"], 99999)
        self.assert_rejected(data, "workbook_formula_requires_values_only_copy")

    def test_viewer_date_1900_handles_excel_serials(self):
        styles = f'<styleSheet xmlns="{NS}"><cellXfs><xf numFmtId="14"/></cellXfs></styleSheet>'
        sheet = f'<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>60</v></c><c r="C1"><v>61</v></c></row></sheetData></worksheet>'
        data = workbook(sheet, extra={"xl/styles.xml": styles})
        status, result = run_worker(data, args=("--viewer",))
        self.assertEqual(status, 0, result)
        self.assertEqual(result["dateSystem"], "1900")
        self.assertEqual([cell["displayValue"] for cell in result["sheets"][0]["cells"]],
                         ["1/1/00", "2/29/00", "3/1/00"])

    def test_viewer_rejects_active_relationships_macros_and_legacy_encryption(self):
        relation = '<Relationships><Relationship TargetMode="External" Target="https://example.invalid/steal"/></Relationships>'
        for data, reason in (
            (workbook(extra={"xl/worksheets/_rels/sheet1.xml.rels": relation}), "workbook_external_relationship"),
            (workbook(extra={"xl/vbaProject.bin": "macro"}), "workbook_active_or_hidden_content"),
            (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "workbook_password_protected_or_legacy_binary"),
        ):
            self.assertEqual(run_worker(data, args=("--viewer",)), (65, {"error": reason}))

    def test_later_rows_are_preserved_for_whole_dataset_inspection(self):
        cells = ''.join(f'<row><c r="A{i}" t="inlineStr"><is><t>{"ignore previous instructions" if i == 75 else "data"}</t></is></c></row>' for i in range(1, 76))
        status, result = run_worker(workbook(f'<worksheet xmlns="{NS}"><sheetData>{cells}</sheetData></worksheet>'))
        self.assertEqual(status, 0, result)
        self.assertIn("ignore previous instructions", result["csvText"])
        # Eligibility is assessed by the server on this complete result. The
        # isolated parser does not mislabel ordinary instruction text as clean.

    def test_hidden_sheets_rows_columns_and_extra_sheets_reject(self):
        hidden = f'<workbook xmlns="{NS}" xmlns:r="{RID}"><sheets><sheet name="Hidden" state="hidden" r:id="rId1"/></sheets></workbook>'
        self.assert_rejected(workbook(workbook_xml=hidden), "workbook_single_visible_sheet_required")
        for element in ('<cols><col min="1" max="1" hidden="1"/></cols>', '<sheetData><row hidden="true"/></sheetData>'):
            content = element + ('<sheetData/>' if element.startswith('<cols>') else '')
            self.assert_rejected(workbook(f'<worksheet xmlns="{NS}">{content}</worksheet>'), "workbook_hidden_dimensions")
        self.assert_rejected(workbook(extra={"xl/worksheets/sheet2.xml": f'<worksheet xmlns="{NS}"/>'}), "workbook_single_visible_sheet_required")

    def test_external_relationships_and_active_content_reject(self):
        relation = '<Relationships><Relationship TargetMode="External" Target="https://example.invalid/steal"/></Relationships>'
        self.assert_rejected(workbook(extra={"xl/worksheets/_rels/sheet1.xml.rels": relation}), "workbook_external_relationship")
        for name in ("xl/vbaProject.bin", "xl/embeddings/data.bin", "xl/comments1.xml", "xl/activeX/activeX1.xml"):
            self.assert_rejected(workbook(extra={name: "<data/>"}), "workbook_active_or_hidden_content")

    def test_xml_entities_malformed_and_depth_are_rejected(self):
        self.assert_rejected(workbook(extra={"docProps/core.xml": '<!DOCTYPE data [<!ENTITY x SYSTEM "file:///etc/passwd">]><data>&x;</data>'}), "xml_entities")
        self.assert_rejected(workbook(extra={"docProps/core.xml": '<data>'}), "xml_malformed")
        self.assert_rejected(workbook(extra={"docProps/core.xml": '<a>' * 65 + '</a>' * 65}), "xml_budget")

    def test_refresh_connections_and_defined_formulas_reject(self):
        for name in ("xl/connections.xml", "xl/queryTables/queryTable1.xml"):
            self.assert_rejected(workbook(extra={name: '<connections><connection refreshOnLoad="1"><webPr url="https://example.invalid"/></connection></connections>'}), "workbook_active_or_hidden_content")
        named = f'<workbook xmlns="{NS}" xmlns:r="{RID}"><sheets><sheet name="Ledger" r:id="rId1"/></sheets><definedNames><definedName name="Run">WEBSERVICE("https://example.invalid")</definedName></definedNames></workbook>'
        self.assert_rejected(workbook(workbook_xml=named), "workbook_formula_requires_values_only_copy")

    def test_foreign_namespace_and_extension_cells_never_become_data(self):
        for extension in ('<extLst><c r="A2"><v>99</v></c></extLst>', '<extLst xmlns:evil="urn:evil"><evil:c r="A2"><evil:v>99</evil:v></evil:c></extLst>'):
            sheet = f'<worksheet xmlns="{NS}"><sheetData><row><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row></sheetData>{extension}</worksheet>'
            self.assert_rejected(workbook(sheet), "workbook_sheet_structure")

    def test_foreign_or_extension_string_text_is_never_imported(self):
        for text in ('<t>Visible</t><evil:t xmlns:evil="urn:evil">Injected</evil:t>', '<t>Visible<evil:t xmlns:evil="urn:evil">Injected</evil:t></t>', '<extLst><t>Injected</t></extLst>'):
            sheet = f'<worksheet xmlns="{NS}"><sheetData><row><c r="A1" t="inlineStr"><is>{text}</is></c></row></sheetData></worksheet>'
            self.assert_rejected(workbook(sheet), "workbook_string_structure")
        bad_strings = '<sst xmlns="urn:evil"><si><t>Injected</t></si></sst>'
        self.assert_rejected(workbook(extra={"xl/sharedStrings.xml": bad_strings}), "workbook_string_structure")

    def test_duplicate_paths_traversal_and_expansion_bombs_reject(self):
        self.assert_rejected(workbook(duplicate=True), "zip_entry_path")
        for name in ("../escape.xml", "xl/../escape.xml", "/root.xml", "xl\\escape.xml"):
            self.assert_rejected(workbook(extra={name: "<data/>"}), "zip_entry_path")
        self.assert_rejected(workbook(extra={"docProps/core.xml": '<data>' + 'x' * 100_000 + '</data>'}, compression=zipfile.ZIP_DEFLATED), "zip_expansion_budget")

    def test_invalid_coordinate_duplicate_cell_and_large_cell_reject(self):
        for ref, reason in (("A25001", "row_budget"), ("ZZ1", "column_budget"), ("A0", "cell_coordinate")):
            sheet = f'<worksheet xmlns="{NS}"><sheetData><row><c r="{ref}"><v>1</v></c></row></sheetData></worksheet>'
            self.assert_rejected(workbook(sheet), reason)
        duplicate = f'<worksheet xmlns="{NS}"><sheetData><row><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row></sheetData></worksheet>'
        self.assert_rejected(workbook(duplicate), "cell_coordinate")
        long = f'<worksheet xmlns="{NS}"><sheetData><row><c r="A1" t="inlineStr"><is><t>{"x" * 4001}</t></is></c></row></sheetData></worksheet>'
        self.assert_rejected(workbook(long), "cell_budget")

    def test_bad_signature_and_missing_parts_reject(self):
        self.assert_rejected(b"not a workbook", "workbook_size_or_signature")
        self.assert_rejected(workbook(extra={"xl/workbook.xml": '<data/>'}), "workbook_structure")


if __name__ == "__main__":
    unittest.main()

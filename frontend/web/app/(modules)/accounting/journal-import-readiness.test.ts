import assert from "node:assert/strict";
import test from "node:test";
import { journalImportReadinessAction } from "./journal-import-readiness";

test("general-entry files use journal readiness, including the backend's default Entry type", () => {
  assert.equal(journalImportReadinessAction(["ref_"], [["source-a"]]), "journal-import");
  assert.equal(journalImportReadinessAction(["move_type"], [["entry"], [" Entry "], [""]]), "journal-import");
});

test("invoice, bill, mixed, unknown, empty and ambiguous files retain full import requirements", () => {
  for (const kind of ["out_invoice", "in_invoice", "out_refund", "in_refund", "out_receipt", "in_receipt", "unknown"]) {
    assert.equal(journalImportReadinessAction(["move_type"], [["entry"], [kind]]), "import");
  }
  assert.equal(journalImportReadinessAction(["move_type"], []), "import");
  assert.equal(journalImportReadinessAction(["move_type", "move_type"], [["entry", "out_invoice"]]), "import");
});

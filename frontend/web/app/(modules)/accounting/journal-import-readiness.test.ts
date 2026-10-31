import assert from "node:assert/strict";
import test from "node:test";
import { journalImportReadinessAction, journalLineImportReadinessAction } from "./journal-import-readiness";

test("general-entry files use journal readiness, including the backend's default Entry type", () => {
  assert.equal(journalImportReadinessAction(["ref_"], [["source-a"]]), "journal-import");
  assert.equal(journalImportReadinessAction(["move_type"], [["entry"], [" Entry "], [""]]), "journal-import");
});

test("standalone general lines require exactly one draft parent in the active company", () => {
  const move = { id: 9n, companyId: 3n, moveType: { tag: "Entry" }, state: { tag: "Draft" } };
  const classify = (moves: typeof move[]) => journalLineImportReadinessAction(["move_id"], [["9"]], moves, 3n);
  assert.equal(classify([move]), "journal-import");
  assert.equal(classify([]), "import");
  assert.equal(classify([move, move]), "import");
  assert.equal(classify([{ ...move, companyId: 4n }]), "import");
  for (const kind of ["OutInvoice", "InInvoice", "OutRefund", "InRefund", "unknown"]) {
    assert.equal(classify([{ ...move, moveType: { tag: kind } }]), "import");
  }
  assert.equal(classify([{ ...move, state: { tag: "Posted" } }]), "import");
  assert.equal(journalLineImportReadinessAction(["move_id"], [["9"], ["10"]], [move], 3n), "import");
  assert.equal(journalLineImportReadinessAction(["move_id", "move_id"], [["9", "9"]], [move], 3n), "import");
  assert.equal(journalLineImportReadinessAction(["move_id"], [], [move], 3n), "import");
});

test("invoice, bill, mixed, unknown, empty and ambiguous files retain full import requirements", () => {
  for (const kind of ["out_invoice", "in_invoice", "out_refund", "in_refund", "out_receipt", "in_receipt", "unknown"]) {
    assert.equal(journalImportReadinessAction(["move_type"], [["entry"], [kind]]), "import");
  }
  assert.equal(journalImportReadinessAction(["move_type"], []), "import");
  assert.equal(journalImportReadinessAction(["move_type", "move_type"], [["entry", "out_invoice"]]), "import");
});

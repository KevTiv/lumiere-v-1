import assert from "node:assert/strict"
import test from "node:test"
import {
  reduceImportSourceAdmission,
  sourceAdmissionForScope,
} from "./import-source-admission"

test("source replacement and reset cannot retain the previous file's admission", () => {
  const admitted = reduceImportSourceAdmission(null, {
    type: "source",
    scopeKey: "actor:org:company",
    id: "a".repeat(32),
  })
  assert.equal(
    sourceAdmissionForScope(admitted, "actor:org:company"),
    "a".repeat(32),
  )
  const replaced = reduceImportSourceAdmission(admitted, {
    type: "source",
    scopeKey: "actor:org:company",
    id: "b".repeat(32),
  })
  assert.equal(
    sourceAdmissionForScope(replaced, "actor:org:company"),
    "b".repeat(32),
  )
  assert.equal(
    reduceImportSourceAdmission(admitted, {
      type: "source",
      scopeKey: "actor:org:company",
    }),
    null,
  )
  assert.equal(reduceImportSourceAdmission(admitted, { type: "reset" }), null)
})

test("scope changes clear origin admission while mapping edits within the scope retain it", () => {
  const admitted = reduceImportSourceAdmission(null, {
    type: "source",
    scopeKey: "a:1:2",
    id: "a".repeat(32),
  })
  assert.equal(
    reduceImportSourceAdmission(admitted, { type: "scope", scopeKey: "a:1:2" }),
    admitted,
  )
  for (const scopeKey of ["b:1:2", "a:2:2", "a:1:3"]) {
    assert.equal(sourceAdmissionForScope(admitted, scopeKey), undefined)
    assert.equal(
      reduceImportSourceAdmission(admitted, { type: "scope", scopeKey }),
      null,
    )
  }
  assert.throws(() =>
    reduceImportSourceAdmission(null, {
      type: "source",
      scopeKey: "a:1:2",
      id: "not-an-admission",
    }),
  )
})

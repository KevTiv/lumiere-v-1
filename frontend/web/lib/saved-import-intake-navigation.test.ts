import assert from "node:assert/strict"
import test from "node:test"
import { readSavedImportGoal, savedImportIntakeHref } from "./saved-import-intake-navigation"

test("a module deep link opens the shared file intake with an admitted preparation suggestion", () => {
  assert.equal(savedImportIntakeHref(), "/settings?section=imports#start-import")
  const href = new URL(savedImportIntakeHref("stock_location"), "https://example.invalid")
  assert.equal(href.pathname, "/settings")
  assert.equal(href.hash, "#start-import")
  assert.equal(readSavedImportGoal(href.search), "stock_location")
  assert.equal(href.searchParams.has("importTask"), false)
})

test("unknown or competing destinations do not seed a preparation", () => {
  for (const search of ["", "?importGoal=constructor", "?importGoal=shop_sales", "?importGoal=product&importGoal=contact"]) {
    assert.equal(readSavedImportGoal(search), undefined)
  }
})

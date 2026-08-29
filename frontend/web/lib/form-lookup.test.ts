import assert from "node:assert/strict"
import test from "node:test"

import { paymentJournalRowsToSelectOptions } from "./form-lookup"

test("payment journal options include only reducer-compatible journal types", () => {
  const options = paymentJournalRowsToSelectOptions([
    { id: 1n, code: "SAL", name: "Sales", type: { tag: "Sale" } },
    { id: 2n, code: "BNK", name: "Bank", type: { bank: [] } },
    { id: 3n, code: "CSH", name: "Cash", type_: "Cash" },
    { id: 4n, code: "CHK", name: "Check", type: { tag: "Check" } },
    { id: 5n, code: "GEN", name: "General", type: { general: [] } },
  ])

  assert.deepEqual(options, [
    { value: "2", label: "BNK — Bank" },
    { value: "3", label: "CSH — Cash" },
    { value: "4", label: "CHK — Check" },
  ])
})

import assert from "node:assert/strict"
import test from "node:test"
import { candidates, summarize, withheldNotice } from "./withheld-run-candidates.mjs"

const schema = { elements: ["id", "organization_id", "company_id", "summary"].map((some) => ({ name: { some } })) }
const notice = withheldNotice()

test("only completed-run summaries that start with the withheld notice are candidates", () => {
  const rows = [
    [4100, 1, 2, [0, `${notice}: reason`]],
    [4101, 1, 2, [0, "Stock is 4 units"]],
    [4102, 1, 3, [0, `${notice}.`]],
    [4103, 1, 2, [1, []]],
  ]
  const list = candidates({ schema, rows }, notice)
  assert.deepEqual(list.map((c) => c.runId), [4100, 4102])
  assert.deepEqual(summarize(list), { total: 2, groups: { "1/2": [4100], "1/3": [4102] } })
  assert.ok(!JSON.stringify(list).includes("reason"))
})

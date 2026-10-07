import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildStatementRows,
  buildStatementTree,
  journalItemsHref,
  type StatementTreeLine,
} from "./statement-tree"

function line(p: Partial<StatementTreeLine> & { id: string }): StatementTreeLine {
  return {
    sequence: Number(p.id),
    name: `L${p.id}`,
    accountId: null,
    lineType: "income",
    parentId: null,
    level: 0,
    isLeaf: true,
    amount: 0,
    comparisonAmount: 0,
    ...p,
  }
}

describe("buildStatementRows", () => {
  it("nests by parentId with header and subtotal rows", () => {
    const rows = buildStatementRows([
      line({ id: "1", name: "Revenue", isLeaf: false, amount: 150 }),
      line({ id: "2", parentId: "1", level: 1, accountId: "40", amount: 100 }),
      line({ id: "3", parentId: "1", level: 1, accountId: "41", amount: 50 }),
      line({ id: "4", name: "Net income", lineType: "netincome", amount: 150 }),
    ])
    assert.deepEqual(
      rows.map((r) => [r.kind, r.depth, r.label, r.amount]),
      [
        ["section", 0, "Revenue", null],
        ["line", 1, "L2", 100],
        ["line", 1, "L3", 50],
        ["subtotal", 0, "Total Revenue", 150],
        ["total", 0, "Net income", 150],
      ],
    )
    assert.equal(rows[1]!.accountId, "40")
  })

  it("derives a missing section subtotal from its children", () => {
    const rows = buildStatementRows([
      line({ id: "1", name: "Costs", isLeaf: false, amount: 0 }),
      line({ id: "2", parentId: "1", amount: 10 }),
      line({ id: "3", parentId: "1", amount: 5 }),
    ])
    assert.equal(rows.at(-1)!.amount, 15)
  })

  it("infers nesting from level when no parent ids exist, ordered by sequence", () => {
    const rows = buildStatementRows([
      line({ id: "9", sequence: 3, level: 1, amount: 2 }),
      line({ id: "7", sequence: 1, level: 0, name: "Assets", isLeaf: false }),
      line({ id: "8", sequence: 2, level: 1, amount: 3 }),
    ])
    assert.deepEqual(rows.map((r) => [r.kind, r.depth]), [
      ["section", 0],
      ["line", 1],
      ["line", 1],
      ["subtotal", 0],
    ])
    assert.equal(rows.at(-1)!.amount, 5)
  })

  it("keeps every line once for cycles and orphans", () => {
    const roots = buildStatementTree([
      line({ id: "1", parentId: "2" }),
      line({ id: "2", parentId: "1" }),
      line({ id: "3", parentId: "99" }),
    ])
    const ids: string[] = []
    const walk = (ns: typeof roots) => ns.forEach((n) => (ids.push(n.line.id), walk(n.children)))
    walk(roots)
    assert.deepEqual(ids.sort(), ["1", "2", "3"])
  })

  it("returns no rows for no lines", () => {
    assert.deepEqual(buildStatementRows([]), [])
  })
})

describe("journalItemsHref", () => {
  it("links to the move-lines tab filtered by account", () => {
    assert.equal(journalItemsHref("12"), "/accounting?tab=move-lines&filter=accountId%3A12")
  })
  it("returns null without an account id", () => {
    assert.equal(journalItemsHref(null), null)
    assert.equal(journalItemsHref("abc"), null)
  })
})

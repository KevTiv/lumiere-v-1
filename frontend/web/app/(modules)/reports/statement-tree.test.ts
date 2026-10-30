import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildStatementRows,
  buildStatementTree,
  collapsibleSectionKeys,
  formatStatementAmount,
  formatStatementPercent,
  journalItemsHref,
  statementVariance,
  visibleStatementRows,
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
  const report = { id: "1", companyId: "7", dateFrom: "2026-10-01", dateTo: "2026-10-31", targetMove: "posted", filterAccountIds: [], filterAnalyticAccountIds: [], filterPartnerIds: [], filterJournalIds: [] }
  it("links to the move-lines tab with the reviewed report scope", () => {
    const params = new URL(journalItemsHref("12", report, "/reports?report=1")!, "https://lumiere.invalid").searchParams
    assert.equal(params.get("tab"), "move-lines")
    assert.equal(params.get("statementAccount"), "12")
    assert.equal(params.get("statementReport"), "1")
    assert.equal(params.get("companyId"), "7")
  })
  it("returns null without an account id", () => {
    assert.equal(journalItemsHref(null, report, "/reports"), null)
    assert.equal(journalItemsHref("abc", report, "/reports"), null)
  })
})

describe("formatStatementAmount", () => {
  it("brackets negatives and follows the currency's decimals", () => {
    assert.equal(formatStatementAmount(-1200, "en-US"), "(1,200.00)")
    assert.equal(formatStatementAmount(1200, "en-US", "RWF"), "1,200")
    assert.equal(formatStatementAmount(1200.5, "en-US", "USD"), "1,200.50")
    assert.equal(formatStatementAmount(-0.001, "en-US"), "0.00")
  })
})

describe("statementVariance", () => {
  it("returns the change and its percent of the comparison", () => {
    assert.deepEqual(statementVariance({ amount: 150, comparisonAmount: 100 }), { amount: 50, percent: 50 })
    assert.deepEqual(statementVariance({ amount: 50, comparisonAmount: -100 }), { amount: 150, percent: 150 })
  })
  it("has no percent against a zero comparison and no variance on headers", () => {
    assert.deepEqual(statementVariance({ amount: 10, comparisonAmount: 0 }), { amount: 10, percent: null })
    assert.equal(statementVariance({ amount: null, comparisonAmount: null }), null)
    assert.equal(formatStatementPercent(null), "—")
    assert.equal(formatStatementPercent(-12.34, "en-US"), "(12.3%)")
  })
})

describe("visibleStatementRows", () => {
  const rows = buildStatementRows([
    line({ id: "1", name: "Revenue", lineType: "section" }),
    line({ id: "2", name: "Sales", parentId: "1", level: 1, amount: 100 }),
    line({ id: "3", name: "Fees", parentId: "1", level: 1, amount: 20 }),
    line({ id: "4", name: "Costs", lineType: "section" }),
    line({ id: "5", name: "Rent", parentId: "4", level: 1, amount: 30 }),
  ])
  it("hides a collapsed section's lines but keeps its header and subtotal", () => {
    const shown = visibleStatementRows(rows, new Set(["s-1"]))
    assert.deepEqual(shown.map((r) => r.key), ["s-1", "t-1", "s-4", "l-5", "t-4"])
  })
  it("shows everything when nothing is collapsed", () => {
    assert.equal(visibleStatementRows(rows, new Set()).length, rows.length)
    assert.deepEqual(collapsibleSectionKeys(rows), ["s-1", "s-4"])
  })
})

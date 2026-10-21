/**
 * Pure helper: statement lines (profit and loss / balance sheet / cash flow) -> an indented
 * display table with section headers and subtotals. No React, no I/O.
 */

export interface StatementTreeLine {
  readonly id: string
  readonly sequence: number
  readonly name: string
  readonly accountId: string | null
  /** Lower-case token without separators, e.g. "netincome", "total", "subtotal". */
  readonly lineType: string
  readonly parentId: string | null
  readonly level: number
  readonly isLeaf: boolean
  readonly amount: number
  readonly comparisonAmount: number
}

export type StatementRowKind = "section" | "line" | "subtotal" | "total"

export interface StatementDisplayRow {
  readonly key: string
  readonly lineId: string
  readonly kind: StatementRowKind
  readonly depth: number
  readonly label: string
  /** null on section header rows (their figure is on the matching subtotal row). */
  readonly amount: number | null
  readonly comparisonAmount: number | null
  readonly accountId: string | null
}

export interface StatementNode {
  readonly line: StatementTreeLine
  readonly children: StatementNode[]
}

const TOTAL_TYPES = new Set(["total", "grossprofit", "operatingincome", "netincome", "netcashflow"])
const SUBTOTAL_TYPES = new Set(["subtotal"])

function compareLines(a: StatementTreeLine, b: StatementTreeLine): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence
  const ai = Number(a.id)
  const bi = Number(b.id)
  return Number.isFinite(ai) && Number.isFinite(bi) ? ai - bi : a.id.localeCompare(b.id)
}

/**
 * Build the parent/child forest. Parenting uses `parentId` when it points at a line in the set;
 * if no line carries any usable parent, nesting is inferred from `level` over `sequence` order.
 * Cycles and orphans become roots, so every line appears exactly once.
 */
export function buildStatementTree(lines: readonly StatementTreeLine[]): StatementNode[] {
  const sorted = [...lines].sort(compareLines)
  const byId = new Map<string, StatementNode>()
  for (const line of sorted) byId.set(line.id, { line, children: [] })

  const anyParent = sorted.some((l) => l.parentId != null && byId.has(l.parentId))
  const roots: StatementNode[] = []

  if (anyParent) {
    // Detect cycles: walk up; if we revisit, break the link.
    const parentOf = new Map<string, string | null>()
    for (const l of sorted) {
      parentOf.set(l.id, l.parentId != null && l.parentId !== l.id && byId.has(l.parentId) ? l.parentId : null)
    }
    for (const l of sorted) {
      const seen = new Set<string>([l.id])
      let cur = parentOf.get(l.id) ?? null
      while (cur != null) {
        if (seen.has(cur)) {
          parentOf.set(l.id, null)
          break
        }
        seen.add(cur)
        cur = parentOf.get(cur) ?? null
      }
    }
    for (const l of sorted) {
      const node = byId.get(l.id)!
      const p = parentOf.get(l.id)
      if (p) byId.get(p)!.children.push(node)
      else roots.push(node)
    }
    return roots
  }

  const stack: StatementNode[] = []
  for (const l of sorted) {
    const node = byId.get(l.id)!
    while (stack.length > 0 && stack[stack.length - 1]!.line.level >= l.level) stack.pop()
    if (stack.length > 0) stack[stack.length - 1]!.children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

/** A section's subtotal: its own amount when the report supplied one, else the sum of its children. */
function nodeAmounts(node: StatementNode): { amount: number; comparison: number } {
  if (node.children.length === 0) {
    return { amount: node.line.amount, comparison: node.line.comparisonAmount }
  }
  if (node.line.amount !== 0 || node.line.comparisonAmount !== 0) {
    return { amount: node.line.amount, comparison: node.line.comparisonAmount }
  }
  let amount = 0
  let comparison = 0
  for (const child of node.children) {
    const c = nodeAmounts(child)
    amount += c.amount
    comparison += c.comparison
  }
  return { amount, comparison }
}

function leafKind(line: StatementTreeLine): StatementRowKind {
  if (TOTAL_TYPES.has(line.lineType)) return "total"
  if (SUBTOTAL_TYPES.has(line.lineType)) return "subtotal"
  return "line"
}

/** Flatten into display rows: header, children, then a "Total <name>" subtotal for each section. */
export function flattenStatement(
  nodes: readonly StatementNode[],
  subtotalLabel: (name: string) => string = (name) => `Total ${name}`,
): StatementDisplayRow[] {
  const rows: StatementDisplayRow[] = []
  const walk = (node: StatementNode, depth: number) => {
    const { line } = node
    if (node.children.length === 0) {
      rows.push({
        key: `l-${line.id}`,
        lineId: line.id,
        kind: leafKind(line),
        depth,
        label: line.name,
        amount: line.amount,
        comparisonAmount: line.comparisonAmount,
        accountId: line.accountId,
      })
      return
    }
    rows.push({
      key: `s-${line.id}`,
      lineId: line.id,
      kind: "section",
      depth,
      label: line.name,
      amount: null,
      comparisonAmount: null,
      accountId: null,
    })
    for (const child of node.children) walk(child, depth + 1)
    const sums = nodeAmounts(node)
    rows.push({
      key: `t-${line.id}`,
      lineId: line.id,
      kind: TOTAL_TYPES.has(line.lineType) ? "total" : "subtotal",
      depth,
      label: subtotalLabel(line.name),
      amount: sums.amount,
      comparisonAmount: sums.comparison,
      accountId: null,
    })
  }
  for (const root of nodes) walk(root, 0)
  return rows
}

export function buildStatementRows(
  lines: readonly StatementTreeLine[],
  subtotalLabel?: (name: string) => string,
): StatementDisplayRow[] {
  return flattenStatement(buildStatementTree(lines), subtotalLabel)
}

/** Drill-down href into the Accounting journal items tab (`move-lines`) for one account. */
export function journalItemsHref(accountId: string | null): string | null {
  if (accountId == null || !/^\d+$/.test(accountId)) return null
  return `/accounting?tab=move-lines&filter=${encodeURIComponent(`accountId:${accountId}`)}`
}

export function formatStatementAmount(value: number, locale?: string): string {
  return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

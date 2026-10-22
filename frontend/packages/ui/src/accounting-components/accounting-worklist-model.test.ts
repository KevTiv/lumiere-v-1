import { describe, expect, it } from "vitest"
import {
  accountingWorklistKey,
  accountingWorklistRow,
  EMPTY_WORKLIST,
  readAccountingWorklistPreferences,
  saveAccountingWorklist,
  scopedAccountingMoves,
  worklistId,
  worklistTimestamp,
  WORKLIST_COLUMNS,
} from "./accounting-worklist-model"
import type { AccountMove } from "../lib/accounting-types"
import { compareCellValues } from "../lib/entity-table-engine"

const scope = { organizationId: 1n, companyId: "2", userId: "user:one" }
const move: AccountMove = {
  id: "9007199254740993",
  organizationId: 1n,
  companyId: 2n,
  name: "INV-1",
  state: "Posted",
  paymentState: "NotPaid",
  amountTotal: 100,
  amountResidual: 50,
  currencyId: 7n,
}

describe("accounting worklist boundaries", () => {
  it("retains exact u64 identity and rejects rounded, malformed, zero, or overflowing IDs", () => {
    expect(worklistId("9007199254740993")).toBe("9007199254740993")
    expect(worklistId(18446744073709551615n)).toBe("18446744073709551615")
    for (const id of [
      9007199254740992,
      0,
      -1,
      "01",
      "1_000",
      " 1 ",
      "18446744073709551616",
      null,
    ])
      expect(worklistId(id)).toBeNull()
    expect(
      compareCellValues("9007199254740993", "9007199254740992")
    ).toBeGreaterThan(0)
  })

  it("self-scopes organization and company; absent/redacted scope is never current scope", () => {
    const foreign = { ...move, id: "2", companyId: 3n }
    const foreignOrg = { ...move, id: "3", organizationId: 9n }
    const redacted = { ...move, id: "4", companyId: undefined }
    expect(
      scopedAccountingMoves([move, foreign, foreignOrg, redacted], scope)
    ).toEqual([move])
    expect(scopedAccountingMoves([move])).toEqual([])
  })

  it("separates browser preference namespaces by organization, user, company and kind", () => {
    const key = accountingWorklistKey(scope, "invoice")
    expect(key).toBe("lumiere:accounting-worklist:v1:1:2:user%3Aone:invoice")
    expect(
      accountingWorklistKey({ ...scope, companyId: 3 }, "invoice")
    ).not.toBe(key)
    expect(
      accountingWorklistKey({ ...scope, userId: "user:two" }, "invoice")
    ).not.toBe(key)
    expect(accountingWorklistKey(scope, "bill")).not.toBe(key)
    expect(
      accountingWorklistKey({ ...scope, userId: null }, "invoice")
    ).toBeNull()
    expect(
      accountingWorklistKey({ ...scope, organizationId: "" }, "invoice")
    ).toBeNull()
  })

  it("sanitizes stored filters and columns, excluding record IDs, scope and selection", () => {
    const parsed = readAccountingWorklistPreferences({
      version: 1,
      current: {
        search: "needle",
        filters: {
          id: move.id,
          companyId: "99",
          organizationId: "88",
          status: "paid",
          currencyId: "7",
          queue: "open",
        },
        hiddenColumns: ["name", "amountTotal", "secret"],
      },
      saved: [
        {
          name: "  Paid  ",
          filters: { status: "paid", id: move.id },
          hiddenColumns: ["dueDate"],
        },
        { name: "paid" },
      ],
      selectedIds: [move.id],
      rows: [move],
    })
    expect(parsed.current).toEqual({
      search: "needle",
      filters: { status: "paid", currencyId: "7", queue: "open" },
      hiddenColumns: ["amountTotal"],
    })
    expect(parsed.saved).toEqual([
      {
        name: "Paid",
        search: "",
        filters: { status: "paid", currencyId: "", queue: "" },
        hiddenColumns: ["dueDate"],
      },
    ])
    expect(JSON.stringify(parsed)).not.toContain(move.id)
    expect(
      readAccountingWorklistPreferences({
        version: 99,
        current: parsed.current,
      }).current
    ).toEqual(EMPTY_WORKLIST)
    expect(
      readAccountingWorklistPreferences({
        version: 1,
        current: { hiddenColumns: WORKLIST_COLUMNS },
      }).current.hiddenColumns
    ).toEqual([])
  })

  it("saves column-only named views and replaces case-insensitive names without mutation", () => {
    const first = saveAccountingWorklist([], " Compact ", {
      ...EMPTY_WORKLIST,
      hiddenColumns: ["partner"],
    })
    expect(first[0]?.hiddenColumns).toEqual(["partner"])
    expect(
      saveAccountingWorklist(first, "compact", {
        ...EMPTY_WORKLIST,
        search: "updated",
      })
    ).toHaveLength(1)
    expect(first[0]?.search).toBe("")
    expect(saveAccountingWorklist(first, " ", EMPTY_WORKLIST)).toEqual(first)
  })

  it("does not infer balances or status from redacted payments, amounts or invalid dates", () => {
    const valid = accountingWorklistRow(move, "invoice", "Euro")
    expect(valid.status).toBe("sent")
    expect(
      accountingWorklistRow(
        { ...move, paymentState: undefined },
        "invoice",
        "Euro"
      ).status
    ).toBe("unavailable")
    expect(
      accountingWorklistRow(
        { ...move, amountResidual: undefined },
        "invoice",
        "Euro"
      ).status
    ).toBe("unavailable")
    const redacted = accountingWorklistRow(
      { ...move, amountTotal: NaN, amountResidual: Infinity, state: undefined },
      "invoice",
      "Euro"
    )
    expect(redacted.amountTotal).toBeUndefined()
    expect(redacted.amountResidual).toBeUndefined()
    expect(redacted.status).toBe("unavailable")
    expect(
      worklistTimestamp({ microsSinceUnixEpoch: "not-a-date" })
    ).toBeUndefined()
    expect(
      worklistTimestamp({ microsSinceUnixEpoch: 9007199254740992 })
    ).toBeUndefined()
    expect(worklistTimestamp({ microsSinceUnixEpoch: 1751328000000000n })).toBe(
      1751328000000
    )
  })
})

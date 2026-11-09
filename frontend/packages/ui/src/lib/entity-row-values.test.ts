import { describe, expect, it } from "vitest"
import {
  displayEntityValue,
  entityEnumTag,
  entityScalarText,
  formatEntityReference,
  formatTimestampLike,
  getRowField,
  humanizeEnumValue,
  statusTone,
  unwrapEntityValue,
} from "./entity-row-values"

describe("entity display compatibility adapters", () => {
  it("keeps PascalCase aliases and exact null precedence", () => {
    expect(getRowField({ display_name: "Alice" }, "DisplayName")).toBe("Alice")
    expect(
      getRowField({ displayName: null, display_name: "Alice" }, "displayName"),
    ).toBeNull()
    expect(
      getRowField(Object.create({ display_name: "inherited" }), "displayName"),
    ).toBeUndefined()
  })

  it("keeps explicit milliseconds and exact integer microsecond truncation", () => {
    expect(formatTimestampLike(1_725_494_400_000)?.toISOString()).toBe(
      "2024-09-05T00:00:00.000Z",
    )
    expect(formatTimestampLike("2024-09-05T00:00:00.000Z")?.getTime()).toBe(
      1_725_494_400_000,
    )
    expect(
      formatTimestampLike({
        microsSinceUnixEpoch: "9007199254740999",
      })?.getTime(),
    ).toBe(9_007_199_254_740)
    expect(formatTimestampLike({ microsSinceUnixEpoch: "invalid" })).toBeNull()
    expect(formatTimestampLike(new Date("invalid"))).toBeNull()
  })
})

describe("typed display inputs", () => {
  it("decodes tagged, string and SATS enums without treating other values as status", () => {
    expect(entityEnumTag({ tag: "Partial" })).toBe("Partial")
    expect(entityEnumTag({ some: { notPaid: [] } })).toBe("NotPaid")
    expect(entityEnumTag({ some: { partial: {} } })).toBe("Partial")
    expect(entityEnumTag("InPayment")).toBe("InPayment")
    expect(entityEnumTag({ none: [] })).toBeNull()
    expect(entityEnumTag({ tag: {} })).toBeNull()
    expect(entityEnumTag({ state: "Paid" })).toBeNull()
    expect(entityEnumTag(false)).toBeNull()
  })

  it("preserves scalar zero and false while keeping null and objects out of text", () => {
    expect(entityScalarText({ some: 0 })).toBe("0")
    expect(entityScalarText(false)).toBe("false")
    expect(entityScalarText(null)).toBeNull()
    expect(entityScalarText({ value: 0 })).toBeNull()
  })

  it("uses saved and live labels before a precise ID; omits absent and invalid IDs", () => {
    const id = "18446744073709551615"
    const labels = new Map([[id, " Current partner "]])
    expect(
      formatEntityReference(id, { labels, label: " Saved partner " }),
    ).toBe("Saved partner")
    expect(
      formatEntityReference({ some: BigInt(id) }, { labels, label: " " }),
    ).toBe("Current partner")
    expect(formatEntityReference(id)).toBe(`#${id}`)
    expect(formatEntityReference({ none: [] })).toBe("—")
    expect(formatEntityReference(undefined)).toBe("—")
    expect(formatEntityReference("undefined")).toBe("—")
    expect(formatEntityReference(Number(id))).toBe("—")
  })
})

describe("unwrapEntityValue", () => {
  it("unwraps enum tags and options", () => {
    expect(unwrapEntityValue({ tag: "Posted" })).toBe("Posted")
    expect(unwrapEntityValue({ some: { tag: "Paid" } })).toBe("Paid")
    expect(unwrapEntityValue({ none: [] })).toBeNull()
    expect(unwrapEntityValue("plain")).toBe("plain")
  })
})

describe("humanizeEnumValue", () => {
  it("turns internal values into readable labels", () => {
    expect(humanizeEnumValue("in_progress")).toBe("In progress")
    expect(humanizeEnumValue("new")).toBe("New")
    expect(humanizeEnumValue("NotPaid")).toBe("Not paid")
    expect(humanizeEnumValue("Posted")).toBe("Posted")
    expect(humanizeEnumValue("Over-billed")).toBe("Over-billed")
    expect(humanizeEnumValue("USD")).toBe("USD")
    expect(humanizeEnumValue("In payment")).toBe("In payment")
  })
})

describe("statusTone", () => {
  it("gives the same word the same tone everywhere", () => {
    expect(statusTone("Done")).toBe("success")
    expect(statusTone("NotPaid")).toBe("warning")
    expect(statusTone("cancelled")).toBe("destructive")
    expect(statusTone("Closed")).toBe("secondary")
    expect(statusTone("Matched")).toBeNull()
  })
})

describe("displayEntityValue", () => {
  it("never renders an object as [object Object]", () => {
    expect(displayEntityValue({ tag: "OutInvoice" })).toBe("OutInvoice")
    expect(displayEntityValue({ some: "ref-1" })).toBe("ref-1")
    expect(displayEntityValue({ none: [] })).toBe("")
    const micros = { microsSinceUnixEpoch: 1_700_000_000_000_000 }
    expect(displayEntityValue(micros)).toBe(
      new Date(1_700_000_000_000).toLocaleString(),
    )
  })
})

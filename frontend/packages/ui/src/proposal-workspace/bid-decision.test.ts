import { describe, expect, it } from "vitest"

import { parseBidDecisionInput } from "./bid-decision"

describe("parseBidDecisionInput", () => {
  it("accepts a bid or no-bid choice with a trimmed rationale", () => {
    expect(parseBidDecisionInput({ decision: "bid", rationale: "  Strong fit  " })).toEqual({
      decision: "bid",
      rationale: "Strong fit",
    })
    expect(parseBidDecisionInput({ decision: "no_bid", rationale: "Out of scope" })?.decision).toBe("no_bid")
  })

  it("rejects a blank rationale, an unknown choice and a cancelled dialog", () => {
    expect(parseBidDecisionInput({ decision: "bid", rationale: "   " })).toBeNull()
    expect(parseBidDecisionInput({ decision: "undecided", rationale: "Later" })).toBeNull()
    expect(parseBidDecisionInput({ rationale: "Why" })).toBeNull()
    expect(parseBidDecisionInput(null)).toBeNull()
  })
})

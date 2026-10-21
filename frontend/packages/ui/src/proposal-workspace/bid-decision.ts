export type BidDecisionChoice = "bid" | "no_bid"

export interface BidDecisionInput {
  decision: BidDecisionChoice
  rationale: string
}

/**
 * `record_proposal_bid_decision` takes `bid`, `no_bid` or `undecided` and rejects a blank
 * rationale. The dialog records a final choice, so only `bid` and `no_bid` are accepted here.
 */
export function parseBidDecisionInput(values: Record<string, unknown> | null | undefined): BidDecisionInput | null {
  if (values == null) return null
  const decision = String(values.decision ?? "").trim()
  const rationale = String(values.rationale ?? "").trim()
  if ((decision !== "bid" && decision !== "no_bid") || rationale === "") return null
  return { decision, rationale }
}

import { describe, expect, it } from "vitest"
import type { ChatMessageSourceRef } from "./ai-chat-types"
import { followUpAnchorLabels } from "./follow-up-anchors"

const live = (label: string, extra: Partial<ChatMessageSourceRef> = {}): ChatMessageSourceRef => ({
  kind: "live", trust: "authoritative", entity_type: "account_move", entity_id: "1", label, ...extra,
})

describe("follow-up anchor labels", () => {
  it("lists only live sources flagged as coming from the previous answer", () => {
    const sources = [
      live("Invoice #123", { from_anchor: true }),
      live("Contact #9"),
      { kind: "passage", trust: "retrieved", from_anchor: true } as ChatMessageSourceRef,
      live("Invoice #123", { from_anchor: true }),
    ]
    expect(followUpAnchorLabels(sources)).toEqual({ labels: ["Invoice #123"], more: 0 })
  })
  it("caps the visible labels and counts the rest", () => {
    const sources = ["A", "B", "C", "D"].map(name => live(name, { from_anchor: true }))
    expect(followUpAnchorLabels(sources, 2)).toEqual({ labels: ["A", "B"], more: 2 })
  })
  it("returns nothing when no source was anchored", () => {
    expect(followUpAnchorLabels([live("Invoice #1")])).toEqual({ labels: [], more: 0 })
    expect(followUpAnchorLabels(undefined)).toEqual({ labels: [], more: 0 })
  })
})

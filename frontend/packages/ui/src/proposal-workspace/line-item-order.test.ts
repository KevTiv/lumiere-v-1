import { describe, expect, it } from "vitest"

import { moveLineItemOrder, proposalLineItemsInOrder } from "./line-item-order"

const rows = [
  { id: 3n, proposalId: 1n, sequence: 30 },
  { id: 1n, proposalId: 1n, sequence: 10 },
  { id: 9n, proposalId: 2n, sequence: 5 },
  { id: 2n, proposalId: 1n, sequence: 20 },
  { id: 4n, proposalId: 1n, sequence: 40 },
]

describe("proposalLineItemsInOrder", () => {
  it("keeps this proposal's items ordered by sequence then id", () => {
    expect(proposalLineItemsInOrder(rows, 1).map((r) => String(r.id))).toEqual(["1", "2", "3", "4"])
    expect(
      proposalLineItemsInOrder(
        [
          { id: 8n, proposalId: 1n, sequence: 0 },
          { id: 5n, proposalId: 1n, sequence: 0 },
        ],
        1n,
      ).map((r) => String(r.id)),
    ).toEqual(["5", "8"])
  })
})

describe("moveLineItemOrder", () => {
  const own = proposalLineItemsInOrder(rows, 1)

  it("returns the complete id set with the item moved up or down", () => {
    expect(moveLineItemOrder(own, ["1", "2", "3", "4"], "3", "up")).toEqual(["1", "3", "2", "4"])
    expect(moveLineItemOrder(own, ["1", "2", "3", "4"], "2", "down")).toEqual(["1", "3", "2", "4"])
  })

  it("swaps with the visible neighbour and leaves hidden items in place", () => {
    // Items 1 and 3 are in the open section; 2 and 4 belong to others.
    expect(moveLineItemOrder(own, ["1", "3"], "3", "up")).toEqual(["3", "2", "1", "4"])
    expect(moveLineItemOrder(own, ["1", "3"], "1", "down")).toEqual(["3", "2", "1", "4"])
  })

  it("never drops or duplicates an id", () => {
    const result = moveLineItemOrder(own, ["1", "2", "3", "4"], "4", "up")
    expect([...(result ?? [])].sort()).toEqual(["1", "2", "3", "4"])
  })

  it("returns null at the ends or for an unknown item", () => {
    expect(moveLineItemOrder(own, ["1", "2", "3", "4"], "1", "up")).toBeNull()
    expect(moveLineItemOrder(own, ["1", "2", "3", "4"], "4", "down")).toBeNull()
    expect(moveLineItemOrder(own, ["1", "2"], "3", "up")).toBeNull()
    expect(moveLineItemOrder([], [], "1", "up")).toBeNull()
  })
})

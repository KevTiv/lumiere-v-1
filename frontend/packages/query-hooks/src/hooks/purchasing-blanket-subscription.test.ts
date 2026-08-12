import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const SOURCE = readFileSync(
  fileURLToPath(new URL("./purchasing.ts", import.meta.url)),
  "utf8",
)

function hookBody(name: string): string {
  const start = SOURCE.indexOf(`export function ${name}(`)
  assert.notEqual(start, -1, `${name} not found`)
  const next = SOURCE.indexOf("\nexport function ", start + 1)
  return SOURCE.slice(start, next === -1 ? SOURCE.length : next)
}

function invalidatedResources(name: string): string[] {
  const body = hookBody(name)
  const match = body.match(/invalidateResourceQueries\(qc, organizationId, \[([\s\S]*?)\]\)/)
  assert.ok(match, `${name} must use subscription-aware invalidation`)
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1])
}

describe("blanket purchase subscription plumbing", () => {
  it("provides named subscription-aware read hooks", () => {
    for (const [hook, resource] of [
      ["usePurchaseBlanketOrders", "purchase-blanket-orders"],
      ["usePurchaseBlanketOrderLines", "purchase-blanket-order-lines"],
      ["usePurchaseBlanketReleases", "purchase-blanket-releases"],
    ]) {
      assert.match(hookBody(hook), new RegExp(`useSubscriptionAwareQuery\\("${resource}"`))
    }
  })

  it("invalidates every HTTP fallback list changed by create and release", () => {
    assert.deepEqual(invalidatedResources("useCreatePurchaseBlanketOrder"), [
      "purchase-blanket-orders",
      "purchase-blanket-order-lines",
    ])
    assert.deepEqual(invalidatedResources("useReleaseBlanketToPo"), [
      "purchase-orders",
      "purchase-orders-to-approve",
      "purchase-order-lines",
      "purchase-blanket-orders",
      "purchase-blanket-order-lines",
      "purchase-blanket-releases",
    ])
  })
})

import assert from "node:assert/strict"
import test from "node:test"

import { productsQueryOptions } from "./inventory/products"

test("manufacturing consumers can require an authoritative product refresh on mount", () => {
  const seed = [{ id: 41n, name: "Freshly created product" }]
  const options = productsQueryOptions(7n, seed as never[], { authoritativeOnMount: true })

  assert.deepEqual(options.queryKey, ["products", "7"])
  assert.equal(options.initialData, seed)
  assert.equal(options.refetchOnMount, "always")
})

test("ordinary product consumers retain the shared stale-time policy", () => {
  const options = productsQueryOptions(7n)

  assert.equal(options.staleTime, 30_000)
  assert.equal(options.refetchOnMount, undefined)
})

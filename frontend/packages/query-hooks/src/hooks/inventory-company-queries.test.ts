import assert from "node:assert/strict"
import { test } from "node:test"
import { QueryClient } from "@tanstack/react-query"
import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import { inventoryInitialData, inventoryListQueryOptions } from "./inventory/shared"
import {
  replenishmentRulesQueryOptions,
  stockMovesQueryOptions,
  stockPickingsQueryOptions,
  stockQuantsQueryOptions,
} from "./inventory/stock-operations"
import { stockProductionSerialsQueryOptions } from "./inventory/traceability"

test("inventory lists and workflow readback use separate caches for two operating companies", async (context) => {
  const requests: string[] = []
  context.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input)
    const companyId = Number(url.searchParams.get("companyId"))
    assert.ok(companyId === 12 || companyId === 25, url.href)
    requests.push(url.pathname)
    return Response.json({ data: [{ id: companyId, companyId }] })
  })
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://api.test" }))
  const queryClient = new QueryClient()
  try {
    const sources = [
      stockQuantsQueryOptions,
      stockPickingsQueryOptions,
      stockMovesQueryOptions,
      stockProductionSerialsQueryOptions,
      replenishmentRulesQueryOptions,
      (organizationId: bigint, companyId: bigint) =>
        inventoryListQueryOptions("warehouses", organizationId, "Warehouse read failed", companyId),
    ]
    for (const options of sources) {
      const first = options(8n, 12n)
      const second = options(8n, 25n)
      assert.deepEqual(first.queryKey.slice(0, 2), second.queryKey.slice(0, 2))
      assert.notDeepEqual(first.queryKey, second.queryKey)
      // Both results must come from their own query even while the first is fresh.
      const firstRows = await queryClient.fetchQuery<unknown[]>(first)
      const secondRows = await queryClient.fetchQuery<unknown[]>(second)
      assert.deepEqual(firstRows, [{ id: 12, companyId: 12 }])
      assert.deepEqual(secondRows, [{ id: 25, companyId: 25 }])
      assert.deepEqual(queryClient.getQueryData(first.queryKey), firstRows)
    }
    assert.equal(requests.length, sources.length * 2)
  } finally {
    queryClient.clear()
    registerLumiereApiClient(null)
  }
})

test("legacy inventory data can seed its list but cannot seed either selected company", () => {
  const legacy = [{ id: 1, companyId: 12 }]
  assert.equal(inventoryInitialData(legacy), legacy)
  assert.equal(inventoryInitialData(legacy, 12n), undefined)
  assert.equal(inventoryInitialData(legacy, 25n), undefined)
  assert.deepEqual(stockQuantsQueryOptions(8n).queryKey, ["stock-quants", "8"])
})

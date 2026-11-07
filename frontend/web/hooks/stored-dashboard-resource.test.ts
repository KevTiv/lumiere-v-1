import assert from "node:assert/strict"
import test from "node:test"

import { fetchStoredDashboardResource } from "./stored-dashboard-resource"
import { STORED_DASHBOARD_RESOURCE_SCOPES } from "./stored-dashboard-resource-scope.generated"
import {
  StoredDashboardSourceQueryError,
  storedDashboardSourceIssue,
} from "./stored-dashboard-source-state"

type Fetcher = Parameters<typeof fetchStoredDashboardResource>[0]

test("cursor pages preserve exact IDs, selected company and request cancellation scope", async () => {
  const controller = new AbortController()
  const requests: Array<{ url: URL; signal?: AbortSignal | null }> = []
  const fetcher: Fetcher = async (url, init) => {
    requests.push({
      url: new URL(url, "https://erp.test"),
      signal: init?.signal,
    })
    return requests.length === 1
      ? Response.json({
          data: [
            {
              id: "9007199254740993",
              partnerId: "18446744073709551615",
              companyId: "9007199254740993",
            },
          ],
          next_cursor: "opaque+/=&? cursor",
          has_more: true,
        })
      : Response.json({
          data: [{ id: "9007199254740994", companyId: "9007199254740993" }],
          nextCursor: null,
          hasMore: false,
          complete: true,
        })
  }
  const result = await fetchStoredDashboardResource(fetcher, "sale-orders", {
    companyId: "9007199254740993",
    signal: controller.signal,
  })
  assert.deepEqual(result, {
    rows: [
      {
        id: "9007199254740993",
        partnerId: "18446744073709551615",
        companyId: "9007199254740993",
      },
      { id: "9007199254740994", companyId: "9007199254740993" },
    ],
    complete: true,
  })
  assert.equal(requests.length, 2)
  assert.equal(requests[0]!.url.pathname, "/api/query/sale-orders")
  assert.equal(requests[0]!.url.searchParams.get("cursor"), null)
  assert.equal(
    requests[1]!.url.searchParams.get("cursor"),
    "opaque+/=&? cursor",
  )
  for (const request of requests) {
    assert.equal(request.url.searchParams.get("companyId"), "9007199254740993")
    assert.equal(request.signal, controller.signal)
  }
})

test("explicit incomplete coverage never becomes an empty or complete source", async () => {
  for (const envelope of [
    { data: [], hasMore: true },
    { data: [], has_more: true },
    { data: [], complete: false },
    { data: [{ id: "1" }], complete: false, nextCursor: "" },
  ]) {
    const result = await fetchStoredDashboardResource(
      async () => Response.json(envelope),
      "sale-orders",
    )
    assert.equal(result.complete, false)
    assert.deepEqual(result.rows, envelope.data)
  }
  assert.deepEqual(
    await fetchStoredDashboardResource(
      async () => Response.json({ data: [] }),
      "sale-orders",
    ),
    { rows: [], complete: true },
  )
})

test("row and page bounds retain partial coverage rather than reporting full totals", async () => {
  const tooMany = Array.from({ length: 20_001 }, (_, index) => ({
    id: String(index + 1),
  }))
  const cappedRows = await fetchStoredDashboardResource(
    async () => Response.json({ data: tooMany }),
    "sale-orders",
  )
  assert.equal(cappedRows.rows.length, 20_000)
  assert.equal(cappedRows.complete, false)
  assert.equal(cappedRows.incompleteReason, "read-limit")
  let page = 0
  const cappedPages = await fetchStoredDashboardResource(async () => {
    page += 1
    return Response.json({
      data: [{ id: String(page) }],
      nextCursor: `cursor-${page}`,
    })
  }, "sale-orders")
  assert.equal(page, 40)
  assert.equal(cappedPages.rows.length, 40)
  assert.equal(cappedPages.complete, false)
  assert.equal(cappedPages.incompleteReason, "read-limit")
})

test("denial on any cursor page rejects the source instead of returning earlier rows", async () => {
  for (const status of [401, 403, 503]) {
    let calls = 0
    await assert.rejects(
      fetchStoredDashboardResource(async () => {
        calls += 1
        return calls === 1
          ? Response.json({ data: [{ id: "1" }], nextCursor: "next" })
          : Response.json({ error: "Read is unavailable" }, { status })
      }, "sale-orders"),
      (error: unknown) => {
        assert.ok(error instanceof StoredDashboardSourceQueryError)
        assert.equal(error.status, status)
        assert.equal(error.resource, "sale-orders")
        assert.equal(
          storedDashboardSourceIssue(error)?.kind,
          status === 503 ? "query-error" : "denied",
        )
        return true
      },
    )
    assert.equal(calls, 2)
  }
})

test("invalid or repeated cursors stop pagination without presenting a complete dataset", async () => {
  for (const cursor of [42, {}, [], "x".repeat(4097)]) {
    await assert.rejects(
      fetchStoredDashboardResource(
        async () => Response.json({ data: [], nextCursor: cursor }),
        "sale-orders",
      ),
      /invalid pagination cursor/,
    )
  }
  for (const metadata of [
    { hasMore: "false" },
    { has_more: 0 },
    { complete: null },
  ]) {
    await assert.rejects(
      fetchStoredDashboardResource(
        async () => Response.json({ data: [], ...metadata }),
        "sale-orders",
      ),
      /invalid pagination cursor or coverage flag/,
    )
  }
  let calls = 0
  await assert.rejects(
    fetchStoredDashboardResource(async () => {
      calls += 1
      return Response.json({ data: [], nextCursor: "repeated" })
    }, "sale-orders"),
    /invalid pagination cursor/,
  )
  assert.equal(calls, 2)
})

test("malformed data and invalid JSON are explicit query failures", async () => {
  for (const payload of [
    null,
    [],
    {},
    { data: {} },
    { data: [null] },
    { data: [1] },
    { data: [[]] },
  ]) {
    await assert.rejects(
      fetchStoredDashboardResource(
        async () => Response.json(payload),
        "sale-orders",
      ),
      /returned invalid data/,
    )
  }
  await assert.rejects(
    fetchStoredDashboardResource(async () => new Response("{"), "sale-orders"),
    /returned invalid data/,
  )
})

test("aborted requests do not start or continue cursor reads", async () => {
  const before = new AbortController()
  before.abort()
  let calls = 0
  const fetcher: Fetcher = async () => {
    calls += 1
    return Response.json({ data: [] })
  }
  await assert.rejects(
    fetchStoredDashboardResource(fetcher, "sale-orders", {
      signal: before.signal,
    }),
    { name: "AbortError" },
  )
  assert.equal(calls, 0)

  const between = new AbortController()
  await assert.rejects(
    fetchStoredDashboardResource(
      async () => {
        calls += 1
        between.abort()
        return Response.json({ data: [{ id: "1" }], nextCursor: "next" })
      },
      "sale-orders",
      { signal: between.signal },
    ),
    { name: "AbortError" },
  )
  assert.equal(calls, 1)
})

test("fetch and response-body cancellation remain cancellation errors", async () => {
  const abort = new DOMException("Read cancelled", "AbortError")
  await assert.rejects(
    fetchStoredDashboardResource(async () => {
      throw abort
    }, "sale-orders"),
    (error) => error === abort,
  )
  const response = Response.json({ data: [] })
  response.json = async () => {
    throw abort
  }
  await assert.rejects(
    fetchStoredDashboardResource(async () => response, "sale-orders"),
    (error) => error === abort,
  )
})

test("company-bound models exclude other companies using generated table metadata", async () => {
  const rows = [
    { id: "1", companyId: 12 },
    { id: "2", companyId: "13" },
    { id: "3", company_id: "12" },
    { id: "4", companyId: "12", company_id: 12 },
  ]
  for (const resource of [
    "projects",
    "tasks",
    "employees",
    "subscriptions",
    "sale-orders",
    "iot-devices",
  ]) {
    assert.equal(
      STORED_DASHBOARD_RESOURCE_SCOPES[resource],
      "company",
      resource,
    )
    const result = await fetchStoredDashboardResource(
      async () => Response.json({ data: rows }),
      resource,
      { companyId: "12" },
    )
    assert.deepEqual(
      result,
      { rows: [rows[0], rows[2], rows[3]], complete: true },
      resource,
    )
  }
})

test("explicit nullable company scope remains shared but absent scope is not inferred to be shared", async () => {
  for (const resource of [
    "contacts",
    "dashboard-widgets",
    "account-account-types",
    "product-categories",
    "analytics-metrics",
  ]) {
    assert.equal(
      STORED_DASHBOARD_RESOURCE_SCOPES[resource],
      "optional-company",
      resource,
    )
    const rows = [
      { id: "1", companyId: null },
      { id: "2", company_id: 12 },
      { id: "3", companyId: 13 },
    ]
    const complete = await fetchStoredDashboardResource(
      async () => Response.json({ data: rows }),
      resource,
      { companyId: "12" },
    )
    assert.deepEqual(
      complete,
      { rows: rows.slice(0, 2), complete: true },
      resource,
    )
    const redacted = await fetchStoredDashboardResource(
      async () => Response.json({ data: [...rows, { id: "4" }] }),
      resource,
      { companyId: "12" },
    )
    assert.deepEqual(
      redacted,
      {
        rows: rows.slice(0, 2),
        complete: false,
        incompleteReason: "company-scope",
      },
      resource,
    )
  }
})

test("invalid, conflicting, redacted and rounded company IDs cannot contribute to totals", async () => {
  const exact = { id: "1", companyId: "9007199254740993" }
  const invalid = [
    { id: "2" },
    { id: "3", companyId: null },
    { id: "4", companyId: "09007199254740993" },
    { id: "5", companyId: Number("9007199254740993") },
    { id: "6", companyId: "18446744073709551616" },
    { id: "7", companyId: { some: "9007199254740993" } },
    { id: "8", companyId: -1 },
    { id: "9", companyId: "9007199254740993", company_id: "9007199254740994" },
  ]
  for (const row of invalid) {
    const result = await fetchStoredDashboardResource(
      async () => Response.json({ data: [exact, row] }),
      "projects",
      { companyId: "9007199254740993" },
    )
    assert.deepEqual(result, {
      rows: [exact],
      complete: false,
      incompleteReason: "company-scope",
    })
  }
  let page = 0
  const paged = await fetchStoredDashboardResource(
    async () =>
      Response.json(
        ++page === 1
          ? { data: [invalid[0]], nextCursor: "next" }
          : { data: [exact] },
      ),
    "projects",
    { companyId: "9007199254740993" },
  )
  assert.deepEqual(paged, {
    rows: [exact],
    complete: false,
    incompleteReason: "company-scope",
  })
})

test("declared global, organization and native owner/parent reads retain native semantics", async () => {
  const rows = [{ id: "1" }, { id: "2", companyId: 13 }]
  for (const resource of [
    "roles",
    "companies",
    "account-payment-term-lines",
    "my-employee",
    "user-organization",
  ]) {
    assert.equal(STORED_DASHBOARD_RESOURCE_SCOPES[resource], "native", resource)
    assert.deepEqual(
      await fetchStoredDashboardResource(
        async () => Response.json({ data: rows }),
        resource,
        { companyId: "12" },
      ),
      { rows, complete: true },
      resource,
    )
  }
  assert.deepEqual(
    await fetchStoredDashboardResource(
      async () => Response.json({ data: rows }),
      "projects",
    ),
    { rows, complete: true },
  )
})

test("scope filtering still counts discarded rows toward the bounded read budget", async () => {
  const foreign = Array.from({ length: 20_000 }, (_, index) => ({
    id: String(index),
    companyId: 13,
  }))
  let calls = 0
  const result = await fetchStoredDashboardResource(
    async () => {
      calls += 1
      return Response.json({ data: foreign, nextCursor: "next" })
    },
    "projects",
    { companyId: "12" },
  )
  assert.deepEqual(result, {
    rows: [],
    complete: false,
    incompleteReason: "read-limit",
  })
  assert.equal(calls, 1)
  assert.deepEqual(
    await fetchStoredDashboardResource(
      async () => Response.json({ data: [{ id: "1", companyId: 13 }] }),
      "projects",
      { companyId: "12" },
    ),
    { rows: [], complete: true },
  )
})

test("unknown metadata or invalid selected scope never attests a company total", async () => {
  const fetcher: Fetcher = async () =>
    Response.json({ data: [{ id: "1", companyId: 12 }] })
  for (const resource of [
    "intercompany-rules",
    "intercompany-transactions",
    "landed-cost-lines",
    "pos-sessions",
  ]) {
    assert.equal(
      STORED_DASHBOARD_RESOURCE_SCOPES[resource],
      "unknown",
      resource,
    )
    assert.deepEqual(
      await fetchStoredDashboardResource(fetcher, resource, {
        companyId: "12",
      }),
      { rows: [], complete: false, incompleteReason: "company-scope" },
      resource,
    )
  }
  for (const [resource, selected] of [
    ["unknown-resource", "12"],
    ["projects", "012"],
    ["projects", ""],
    ["projects", "12.0"],
  ]) {
    assert.deepEqual(
      await fetchStoredDashboardResource(fetcher, resource!, {
        companyId: selected,
      }),
      { rows: [], complete: false, incompleteReason: "company-scope" },
    )
  }
})

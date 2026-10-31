import { expect, test, type Page } from "@playwright/test"
import { parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
import type {
  ReviewDetail,
  ReviewHistory,
  ReviewRow,
} from "../lib/import-review-model"
import type { ReviewDecision } from "../lib/import-review-uncertainty"

function source(id = "11"): ReviewRow {
  const values = {
    quantity: null,
    unit_price: "4800",
    amount: "4800",
    sale_price: "4800",
    cost_price: null,
    source_unit: null,
    stored_unit: "kg",
    category_id: "12",
    uom_id: "13",
    uom_po_id: "13",
    metadata: "{}",
  }
  return {
    id,
    source: {
      key: `sausage-${id}`,
      label: "Synthetic sausage",
      source: { file: "historic-shop.csv", row: 8, sha256: "a".repeat(64) },
      issue: "Actual weight, original quantity unit and cost are unknown.",
      fields: [
        {
          key: "quantity",
          label: "Recorded quantity / proposed weight",
          kind: "decimal",
          sourceValue: "8",
          required: true,
        },
        {
          key: "unit_price",
          label: "Recorded price / proposed price (RWF)",
          kind: "decimal",
          sourceValue: "600",
          required: true,
        },
        {
          key: "amount",
          label: "Total (RWF)",
          kind: "decimal",
          sourceValue: "4800",
          required: true,
        },
        {
          key: "sale_price",
          label: "Product sale price (RWF)",
          kind: "decimal",
          sourceValue: "600",
          required: true,
        },
        {
          key: "cost_price",
          label: "Cost (RWF)",
          kind: "decimal",
          sourceValue: null,
          required: true,
        },
        {
          key: "source_unit",
          label: "Original quantity unit",
          kind: "text",
          sourceValue: null,
          required: true,
          export: false,
        },
        {
          key: "stored_unit",
          label: "Stored unit",
          kind: "choice",
          sourceValue: null,
          required: true,
          options: ["kg", "unit"],
          export: false,
        },
        {
          key: "category_id",
          label: "Category reference",
          kind: "text",
          sourceValue: null,
          required: true,
        },
        {
          key: "uom_id",
          label: "Unit reference",
          kind: "text",
          sourceValue: null,
          required: true,
        },
        {
          key: "uom_po_id",
          label: "Purchase unit reference",
          kind: "text",
          sourceValue: null,
          required: true,
        },
        {
          key: "metadata",
          label: "Import evidence",
          kind: "text",
          sourceValue: null,
          required: false,
        },
      ],
      proposed: { ...values },
    },
    values,
    confirmedFields: [],
    state: "needs_review",
    revision: 1,
    reason: null,
    reviewedAt: null,
    reviewedBy: null,
  }
}

async function mockReview(
  page: Page,
  initial: ReviewRow[],
  options: { stale?: boolean; loseBulkReply?: boolean } = {},
) {
  const items = new Map(initial.map((item) => [item.id, item]))
  const history: ReviewHistory[] = []
  const requests: string[] = []
  const receipts = new Map<string, string>()
  let writes = 0
  let bulkReplies = 0
  let readGate: Promise<void> | undefined
  let readsDenied = false
  const detail = (): ReviewDetail => ({
    id: "1",
    title: "Historic source review",
    targetEntity: "product",
    sourceFile: "farm-review.json",
    items: [...items.values()],
    history: history.slice().reverse().slice(0, 100),
  })
  const apply = (decision: ReviewDecision) => {
    const before = items.get(decision.itemId)!
    const item = {
      ...before,
      values: decision.values,
      confirmedFields: decision.confirmedFields,
      state: decision.state,
      reason: decision.reason,
      revision: before.revision + 1,
      reviewedBy: "ab".repeat(32),
      reviewedAt: "2026-10-31T12:00:00Z",
    }
    items.set(item.id, item)
    history.push({
      itemId: item.id,
      revision: item.revision,
      values: item.values,
      confirmedFields: item.confirmedFields,
      state: item.state,
      reason: item.reason,
      actor: item.reviewedBy,
      createdAt: item.reviewedAt,
      previousValues: before.values,
      previousConfirmedFields: before.confirmedFields,
      previousState: before.state,
    })
    writes++
    return item
  }
  const problem = (decision: ReviewDecision) => {
    const item = items.get(decision.itemId)
    if (!item || options.stale || decision.expectedRevision !== item.revision)
      return "This item changed. Reload the saved review before applying your correction."
    const missing = item.source.fields.find(
      (field) => field.required && !decision.values[field.key],
    )
    return decision.state === "confirmed" && missing
      ? `${missing.label} is required before confirmation`
      : null
  }
  await page.route("**/api/query/**", (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith("product-categories")
      ? [{ id: 12, organizationId: 8001, name: "Historic products" }]
      : path.endsWith("uoms")
        ? [
            {
              id: 13,
              organizationId: 8001,
              name: "Kilogram",
              symbol: "kg",
              categoryId: 1,
            },
            {
              id: 14,
              organizationId: 8001,
              name: "Unit",
              symbol: "unit",
              categoryId: 2,
            },
            {
              id: 15,
              organizationId: 8002,
              name: "Foreign unit",
              symbol: "kg",
              categoryId: 1,
            },
          ]
        : []
    return route.fulfill({ json: { data } })
  })
  await page.route("**/api/import-reviews**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === "GET") {
      if (readGate) await readGate
      if (readsDenied)
        return route.fulfill({
          status: 403,
          json: {
            error: "Full administrative access is required for source review.",
          },
        })
    }
    if (path.endsWith("/history"))
      return route.fulfill({
        json: {
          history: history
            .filter((entry) => entry.itemId === path.split("/").at(-2))
            .reverse(),
          nextBeforeRevision: null,
        },
      })
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as ReviewDecision
      const decision = { ...body, itemId: path.split("/").at(-1)! }
      const issue = problem(decision)
      if (issue)
        return route.fulfill({
          status: issue.startsWith("This item") ? 409 : 400,
          json: { error: issue },
        })
      return route.fulfill({ json: { item: apply(decision), replayed: false } })
    }
    if (path.endsWith("/decisions")) {
      const raw = route.request().postData()!
      requests.push(raw)
      const body = route.request().postDataJSON() as {
        decisions: ReviewDecision[]
        requestKey: string
      }
      const receipt = receipts.get(body.requestKey)
      if (receipt && receipt !== raw)
        return route.fulfill({
          status: 409,
          json: { error: "Request changed" },
        })
      if (!receipt) {
        const issue = body.decisions.map(problem).find(Boolean)
        if (issue) return route.fulfill({ status: 409, json: { error: issue } })
        for (const decision of body.decisions) apply(decision)
        receipts.set(body.requestKey, raw)
      }
      if (options.loseBulkReply && bulkReplies++ === 0)
        return route.abort("failed")
      return route.fulfill({
        json: {
          results: body.decisions.map((decision) => ({
            item: items.get(decision.itemId),
            replayed: !!receipt,
          })),
        },
      })
    }
    if (path.endsWith("/1")) return route.fulfill({ json: detail() })
    const rows = [...items.values()]
    return route.fulfill({
      json: {
        data: [
          {
            id: "1",
            title: "Historic source review",
            targetEntity: "product",
            sourceFile: "farm-review.json",
            total: rows.length,
            pending: rows.filter((item) => item.state === "needs_review")
              .length,
            confirmed: rows.filter((item) => item.state === "confirmed").length,
            excluded: rows.filter((item) => item.state === "excluded").length,
          },
        ],
      },
    })
  })
  return {
    items,
    history,
    requests,
    writes: () => writes,
    holdReadsUntilDenied: () => {
      let release!: () => void
      readGate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        readsDenied = true
        readGate = undefined
        release()
      }
    },
  }
}

function editor(page: Page) {
  return page.getByRole("region", {
    name: "Review Synthetic sausage",
    exact: true,
  })
}

test("confirming a proposed price preserves unknown weight, original unit and cost after refresh", async ({
  page,
}, testInfo) => {
  const next = source("12")
  next.source.label = "Next unresolved product"
  const server = await mockReview(page, [source(), next])
  await page.goto("/import-review")
  const firstRow = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Synthetic sausage", exact: true }),
  })
  await firstRow
    .getByRole("button", { name: "Review and correct", exact: true })
    .click()
  const panel = editor(page)
  await expect(
    panel
      .getByRole("row")
      .filter({ hasText: "Recorded quantity / proposed weight *" })
      .getByRole("cell")
      .nth(1),
  ).toHaveText("8")
  await panel
    .getByRole("combobox", { name: "Unit for corrected prices", exact: true })
    .click()
  await page.getByRole("option", { name: "unit", exact: true }).click()
  await expect(
    panel.getByLabel("Recorded quantity / proposed weight", { exact: true }),
  ).toHaveValue("")
  await expect(
    panel.getByLabel("Recorded price / proposed price (RWF)", { exact: true }),
  ).toHaveValue("4800")
  await panel
    .getByRole("combobox", { name: "Unit for corrected prices", exact: true })
    .click()
  await page.getByRole("option", { name: "kg", exact: true }).click()
  await panel
    .getByRole("checkbox", {
      name: "Confirm Recorded price / proposed price (RWF)",
      exact: true,
    })
    .check()
  await panel
    .getByLabel("Reason or supporting evidence")
    .fill(
      "Confirmed 4800 RWF per kg; weight, original unit and cost remain unknown",
    )
  await panel
    .getByRole("button", { name: "Save and next item", exact: true })
    .click()
  await expect(panel).not.toBeVisible()
  const nextEditor = page.getByRole("region", {
    name: "Review Next unresolved product",
    exact: true,
  })
  await expect(nextEditor).toBeVisible()
  await nextEditor.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.reload()
  await firstRow
    .getByRole("button", { name: "Review and correct", exact: true })
    .click()
  await expect(
    editor(page).getByRole("checkbox", {
      name: "Confirm Recorded price / proposed price (RWF)",
      exact: true,
    }),
  ).toBeChecked()
  for (const label of [
    "Recorded quantity / proposed weight",
    "Original quantity unit",
    "Cost (RWF)",
  ])
    await expect(editor(page).getByLabel(label, { exact: true })).toHaveValue(
      "",
    )
  await expect(
    page.getByRole("button", {
      name: "Continue import (0 confirmed)",
      exact: true,
    }),
  ).toBeDisabled()
  await page.screenshot({
    path: testInfo.outputPath("partial-price-confirmation.png"),
    fullPage: true,
  })
  expect(server.items.get("11")?.state).toBe("needs_review")
  expect(server.items.get("11")?.confirmedFields).toEqual(["unit_price"])
  expect(server.items.get("11")?.source.fields[0].sourceValue).toBe("8")
  expect(server.writes()).toBe(1)
  const denyReads = server.holdReadsUntilDenied()
  try {
    await page.getByRole("button", { name: "Change review actor" }).click()
    await expect(editor(page)).not.toBeVisible()
    await expect(
      page.getByRole("cell", { name: "Synthetic sausage", exact: true }),
    ).toHaveCount(0)
  } finally {
    denyReads()
  }
  await expect(
    page.getByText(
      "Full administrative access is required for source review.",
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    page.getByRole("cell", { name: "Synthetic sausage", exact: true }),
  ).toHaveCount(0)
})

test("complete-row confirmation requires explicit values and named product references", async ({
  page,
}) => {
  const server = await mockReview(page, [source()])
  await page.goto("/import-review")
  await page
    .getByRole("button", { name: "Review and correct", exact: true })
    .click()
  const panel = editor(page)
  await expect(
    panel.getByRole("combobox", { name: "Product category", exact: true }),
  ).toContainText("Historic products")
  await expect(
    panel.getByRole("combobox", { name: "Product catalog unit", exact: true }),
  ).toContainText("Kilogram (kg)")
  await panel.getByRole("combobox", { name: "Status", exact: true }).click()
  await page
    .getByRole("option", {
      name: "Confirm all entered values and complete this row",
      exact: true,
    })
    .click()
  await panel
    .getByLabel("Reason or supporting evidence")
    .fill("Verified source with owner")
  await panel.getByRole("button", { name: "Save review", exact: true }).click()
  await expect(panel.getByRole("alert")).toHaveText(
    "Recorded quantity / proposed weight is required before confirmation",
  )
  await panel
    .getByLabel("Recorded quantity / proposed weight", { exact: true })
    .fill("1")
  await panel.getByLabel("Cost (RWF)", { exact: true }).fill("3000")
  await panel.getByLabel("Original quantity unit", { exact: true }).fill("pack")
  await panel.getByRole("combobox", { name: "Status", exact: true }).click()
  await page
    .getByRole("option", {
      name: "Confirm all entered values and complete this row",
      exact: true,
    })
    .click()
  await panel.getByRole("button", { name: "Save review", exact: true }).click()
  await expect(panel).not.toBeVisible()
  await page
    .getByRole("button", { name: "Continue import (1 confirmed)", exact: true })
    .click()
  await expect(page.getByTestId("reviewed-csv")).toContainText("1,4800,4800")
  await expect(page.getByTestId("reviewed-csv")).toContainText("source_file")
  expect(server.items.get("11")?.source.fields[0].sourceValue).toBe("8")
})

test("stale inline saves retain entered values and never report success", async ({
  page,
}) => {
  const item = source()
  item.source.fields.find((field) => field.key === "stored_unit")!.sourceValue =
    "kg"
  const server = await mockReview(page, [item], { stale: true })
  await page.goto("/import-review")
  await page
    .getByRole("button", { name: "Review and correct", exact: true })
    .click()
  const panel = editor(page)
  await panel
    .getByLabel("Recorded quantity / proposed weight", { exact: true })
    .fill("1")
  await panel
    .getByRole("combobox", { name: "Product catalog unit", exact: true })
    .click()
  await expect(
    page.getByRole("option", { name: "Unit (unit)", exact: true }),
  ).not.toBeVisible()
  await expect(
    page.getByRole("option", { name: "Foreign unit (kg)", exact: true }),
  ).not.toBeVisible()
  await page.getByRole("option", { name: "Kilogram (kg)", exact: true }).click()
  await panel.getByRole("button", { name: "Save review", exact: true }).click()
  await expect(panel.getByRole("alert")).toHaveText(
    "This item changed. Reload the saved review before applying your correction.",
  )
  await expect(
    panel.getByLabel("Recorded quantity / proposed weight", { exact: true }),
  ).toHaveValue("1")
  expect(server.writes()).toBe(0)
})

test("838 rows support bulk preview exceptions, safe retry, refresh and per-row undo", async ({
  page,
}) => {
  const rows = Array.from({ length: 838 }, (_, index) => {
    const item = source(String(index + 1))
    item.source.label = `Synthetic product ${index + 1}`
    item.source.source.file = `farm-${String((index % 15) + 1).padStart(2, "0")}.csv`
    item.source.source.row = index + 2
    return item
  })
  rows[1].values.unit_price = "4600"
  rows[1].confirmedFields = ["unit_price"]
  const server = await mockReview(page, rows, { loseBulkReply: true })
  await page.goto("/import-review")
  await page
    .getByRole("combobox", { name: "Group by issue", exact: true })
    .click()
  await expect(
    page.getByRole("option", {
      name: "Unknown: Recorded quantity / proposed weight (838)",
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole("option", { name: "All issues", exact: true }).click()
  await page
    .getByRole("button", { name: "Select all 838 matching rows", exact: true })
    .click()
  const bulk = page.getByRole("region", {
    name: "Bulk corrections",
    exact: true,
  })
  await bulk
    .getByRole("combobox", { name: "Field to correct", exact: true })
    .click()
  await page
    .getByRole("option", {
      name: "Recorded price / proposed price (RWF)",
      exact: true,
    })
    .click()
  await bulk.getByLabel("New value", { exact: true }).fill("4900")
  await bulk
    .getByLabel("Bulk correction reason", { exact: true })
    .fill("Confirmed supplier price for these rows only")
  await bulk
    .getByRole("button", { name: "Preview affected rows", exact: true })
    .click()
  await expect(
    bulk.getByText("837 rows will change; 1 exceptions stay unchanged.", {
      exact: true,
    }),
  ).toBeVisible()
  await bulk
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "Synthetic product 1", exact: true }),
    })
    .getByRole("button", { name: "Leave unchanged", exact: true })
    .click()
  await bulk
    .getByRole("button", { name: "Apply to 836 rows", exact: true })
    .click()
  await expect(
    bulk.getByRole("button", {
      name: "Retry same review submission",
      exact: true,
    }),
  ).toBeVisible()
  await bulk
    .getByRole("button", { name: "Retry same review submission", exact: true })
    .click()
  await expect(bulk).not.toBeVisible()
  expect(server.requests).toHaveLength(2)
  expect(server.requests[0]).toBe(server.requests[1])
  expect(server.writes()).toBe(836)
  expect(server.items.get("1")?.revision).toBe(1)
  expect(server.items.get("2")?.values.unit_price).toBe("4600")
  expect(server.items.get("3")?.values.quantity).toBeNull()
  expect(server.items.get("3")?.values.cost_price).toBeNull()
  await page.reload()
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Synthetic product 3", exact: true }),
  })
  await row.getByRole("button", { name: "History", exact: true }).click()
  await page.getByText("This row’s decision history", { exact: true }).click()
  await page
    .getByRole("button", { name: "Undo latest correction", exact: true })
    .click()
  await expect.poll(() => server.items.get("3")?.revision).toBe(3)
  expect(server.items.get("3")?.values.unit_price).toBe("4800")
  expect(server.items.get("3")?.confirmedFields).toEqual([])
  expect(server.items.get("3")?.source.source.file).toBe("farm-03.csv")
  expect(server.items.get("3")?.source.source.row).toBe(4)
  expect(server.items.get("3")?.source.fields[1].sourceValue).toBe("600")
})

async function importHandoffFixture(
  page: Page,
  options: { deferAnalysis?: boolean } = {},
) {
  const item: ReviewRow = {
    ...source(),
    values: {
      ...source().values,
      quantity: "1",
      unit_price: "4800",
      amount: "4800",
      sale_price: "4800",
      cost_price: "3000",
      source_unit: "pack",
    },
    state: "confirmed",
    revision: 2,
    reason: "Confirmed source values",
  }
  const detail: ReviewDetail = {
    id: "1",
    title: "Confirmed source",
    targetEntity: "product",
    sourceFile: "historic-shop.csv",
    items: [item],
    history: [],
  }
  const analyses: Array<{
    targetEntity: string
    headers: string[]
    csvText: string
  }> = []
  const imports: Array<{
    requestId: string
    csvData: string
    fileName: string
    params: { companyId: string; currencyId: string }
  }> = []
  const lookups: string[] = []
  let releaseAnalysis = () => {}
  let releaseImport = () => {}
  const analysisGate = new Promise<void>((resolve) => {
    releaseAnalysis = resolve
  })
  const importGate = new Promise<void>((resolve) => {
    releaseImport = resolve
  })
  if (!options.deferAnalysis) releaseAnalysis()
  const safety = { findings: [], blocked_cell_count: 0, is_safe_for_ai: true }
  await page.route("**/api/query/**", (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith("/companies")
      ? [
          {
            id: 9001,
            organizationId: 8001,
            name: "Fixture company",
            currencyId: 9102,
          },
        ]
      : path.endsWith("/product-categories")
        ? [{ id: 12, organizationId: 8001, name: "Historic products" }]
        : path.endsWith("/uoms")
          ? [
              {
                id: 13,
                organizationId: 8001,
                name: "Kilogram",
                symbol: "kg",
                categoryId: 1,
              },
            ]
          : []
    return route.fulfill({ json: { data } })
  })
  await page.route("**/api/import-reviews**", (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith("/1")
        ? detail
        : {
            data: [
              {
                id: "1",
                title: detail.title,
                pending: 0,
                total: 1,
                confirmed: 1,
                excluded: 0,
                targetEntity: "product",
                sourceFile: detail.sourceFile,
              },
            ],
          },
    }),
  )
  await page.route("**/api/ai/import/analyze", async (route) => {
    const body = route.request().postDataJSON() as (typeof analyses)[number]
    analyses.push(body)
    await analysisGate
    const target = (header: string) =>
      header === "price"
        ? "sale_price"
        : header === "cost"
          ? "cost_price"
          : header
    await route.fulfill({
      json: {
        target_entity: body.targetEntity,
        mappings: body.headers
          .filter((header) => !header.startsWith("_"))
          .map((header) => ({
            source_column: header,
            target_field: target(header),
            confidence: 1,
            required: ["name", "sale_price", "cost_price"].includes(
              target(header),
            ),
          })),
        unmapped_source_columns: body.headers.filter((header) =>
          header.startsWith("_"),
        ),
        unmapped_target_fields: [],
        metadata_suggestions: [],
        structure: {
          column_count: body.headers.length,
          sample_row_count: 1,
          duplicate_headers: [],
          empty_columns: [],
          delimiter_hint: ",",
        },
        safety,
        warnings: [],
      },
    })
  })
  await page.route("**/api/ai/import/preview", (route) => {
    const body = route.request().postDataJSON() as {
      targetEntity: string
      headers: string[]
      rows: string[][]
      mapping: Record<string, string>
    }
    return route.fulfill({
      json: {
        target_entity: body.targetEntity,
        rows: body.rows.map((row) =>
          Object.fromEntries(
            body.headers.flatMap((header, index) =>
              body.mapping[header] && body.mapping[header] !== "__skip__"
                ? [[body.mapping[header], row[index]]]
                : [],
            ),
          ),
        ),
        validation_errors: [],
        safety,
        warnings: [],
      },
    })
  })
  await page.route("**/api/import/product**", async (route) => {
    if (route.request().method() === "POST") {
      imports.push(route.request().postDataJSON())
      await importGate
      return route.abort("connectionreset")
    }
    lookups.push(new URL(route.request().url()).pathname)
    return route.fulfill({
      status: 404,
      json: {
        error:
          "This submission is not visible yet. Retry the same import request to recover its result.",
      },
    })
  })
  await page.goto("/import-review")
  await page
    .getByRole("button", { name: "Open import handoff fixture" })
    .click()
  await page
    .getByRole("button", {
      name: "Confirmed source (0 to review)",
      exact: true,
    })
    .click()
  const continuation = page.getByRole("button", {
    name: "Continue import (1 confirmed)",
    exact: true,
  })
  await expect(continuation).toBeEnabled()
  const wizard = page.getByTestId("guided-import-wizard")
  await wizard.getByTestId("guided-import-entity").click()
  await page.getByRole("option", { name: "Products", exact: true }).click()
  const file = wizard.getByTestId("guided-import-file")
  await file.setInputFiles({
    name: "draft-products.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,price,cost\nDraft product,12.50,8.25"),
  })
  await expect(
    wizard.getByTestId("guided-import-source-summary"),
  ).toContainText("draft-products.csv")
  return {
    wizard,
    file,
    continuation,
    analyses,
    imports,
    lookups,
    releaseAnalysis,
    releaseImport,
  }
}

test("review handoff keeps the selected file and edited mapping on cancel, and replaces only a confirmed idle draft", async ({
  page,
}) => {
  const fixture = await importHandoffFixture(page)
  const { wizard, file, continuation } = fixture
  try {
    await wizard
      .getByRole("button", { name: "Analyze with AI", exact: true })
      .click()
    const mapping = wizard.getByTestId("guided-import-mapping")
    await expect(mapping).toBeVisible()
    const price = mapping
      .getByRole("cell", { name: "price", exact: true })
      .locator("..")
      .getByRole("combobox")
    await price.click()
    await page.getByRole("option", { name: "metadata", exact: true }).click()
    await continuation.click()
    const confirmation = page.getByTestId("confirm-dialog")
    await expect(confirmation).toContainText(
      "Your current file, mapping and preview will be replaced",
    )
    await page.getByTestId("confirm-dialog-cancel").click()
    await expect(confirmation).toBeHidden()
    expect(
      await file.evaluate(
        (input) => (input as HTMLInputElement).files?.[0]?.name,
      ),
    ).toBe("draft-products.csv")
    await expect(price).toContainText("metadata")
    await expect(
      wizard.getByTestId("guided-import-source-summary"),
    ).toContainText("draft-products.csv")
    expect(fixture.analyses).toHaveLength(1)
    expect(fixture.imports).toEqual([])

    await continuation.click()
    await page.getByTestId("confirm-dialog-confirm").click()
    await expect(
      wizard.getByTestId("guided-import-source-summary"),
    ).toContainText("reviewed-1.csv")
    expect(
      await file.evaluate((input) => (input as HTMLInputElement).files?.length),
    ).toBe(0)
    await expect(mapping).toBeHidden()
    await wizard
      .getByRole("button", { name: "Analyze with AI", exact: true })
      .click()
    await expect(mapping).toBeVisible()
    expect(fixture.analyses).toHaveLength(2)
    expect(fixture.analyses[1]!.csvText).toContain("4800")
    expect(fixture.analyses[1]!.csvText).not.toContain("Draft product")
    expect(fixture.analyses[1]!.headers).toEqual(
      expect.arrayContaining(["sale_price", "cost_price", "_review_item_id"]),
    )
    expect(fixture.imports).toEqual([])
  } finally {
    fixture.releaseAnalysis()
    fixture.releaseImport()
    await page.unrouteAll({ behavior: "wait" })
  }
})

test("review handoff cannot replace a busy or unknown import and explicit recovery keeps the same request identity", async ({
  page,
}) => {
  const fixture = await importHandoffFixture(page, { deferAnalysis: true })
  const { wizard, file, continuation } = fixture
  try {
    await wizard
      .getByRole("button", { name: "Analyze with AI", exact: true })
      .click()
    await expect.poll(() => fixture.analyses.length).toBe(1)
    await expect(continuation).toBeDisabled()
    await expect(
      page.getByTestId("import-review-handoff-status"),
    ).toContainText("Please wait")
    fixture.releaseAnalysis()
    await expect(wizard.getByTestId("guided-import-mapping")).toBeVisible()
    await expect(continuation).toBeEnabled()
    await wizard
      .getByRole("button", { name: "Preview import", exact: true })
      .click()
    await expect(wizard.getByTestId("guided-import-preview")).toBeVisible()
    await wizard.getByRole("button", { name: "Import", exact: true }).click()
    await expect.poll(() => fixture.imports.length).toBe(1)
    const submitted = fixture.imports[0]!
    expect(submitted.requestId).toMatch(/^[a-f0-9]{32}$/)
    expect(submitted.params).toEqual({ companyId: "9001", currencyId: "9102" })
    const submittedCsv = parseCsvText(submitted.csvData)
    expect(submittedCsv.rows).toHaveLength(1)
    expect(
      Object.fromEntries(
        submittedCsv.headers.map((header, index) => [
          header,
          submittedCsv.rows[0]![index],
        ]),
      ),
    ).toEqual({
      name: "Draft product",
      sale_price: "12.50",
      cost_price: "8.25",
    })
    await expect(continuation).toBeDisabled()
    await expect(
      page.getByTestId("import-review-handoff-status"),
    ).toContainText("Please wait")
    await expect(page.getByTestId("confirm-dialog")).toBeHidden()
    expect(
      await file.evaluate(
        (input) => (input as HTMLInputElement).files?.[0]?.name,
      ),
    ).toBe("draft-products.csv")

    fixture.releaseImport()
    const check = wizard.getByRole("button", {
      name: "Check import result",
      exact: true,
    })
    await expect(check).toBeEnabled()
    await expect(continuation).toBeDisabled()
    await expect(
      page.getByTestId("import-review-handoff-status"),
    ).toContainText("Check the current import result")
    await check.click()
    await expect.poll(() => fixture.lookups.length).toBe(1)
    expect(fixture.lookups[0]).toBe(
      `/api/import/product/requests/${submitted.requestId}`,
    )
    await expect(check).toBeEnabled()
    await expect(continuation).toBeDisabled()
    await wizard
      .getByRole("button", { name: "Retry same submission", exact: true })
      .click()
    await expect.poll(() => fixture.imports.length).toBe(2)
    expect(fixture.imports[1]).toEqual(submitted)
    await expect(check).toBeEnabled()
    await expect(continuation).toBeDisabled()
    await expect(
      wizard.getByTestId("guided-import-source-summary"),
    ).toContainText("draft-products.csv")
    await expect(page.getByTestId("confirm-dialog")).toBeHidden()
  } finally {
    fixture.releaseAnalysis()
    fixture.releaseImport()
    await page.unrouteAll({ behavior: "wait" })
  }
})

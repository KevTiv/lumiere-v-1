import { createHash } from "node:crypto"
import { expect, test, type Locator, type Page } from "@playwright/test"
import type { ChatImportReviewedRecords } from "@lumiere/ui/lib/import-task-status"
import type { ChatImportTask as Task } from "../lib/chat-import-task"

// Production chat/task components, synthetic HTTP only. Original private farm
// files and deployed backend behavior are separate acceptance requirements.
type DecisionBody = {
  companyId: number; decisionId: string; expectedRevision: number;
  optionId: "prepare_import" | "inspect_only" | "other"; otherText?: string;
}

async function mockTasks(page: Page, options: {
  losePostReply?: boolean
  loseDecisionReply?: boolean
  seedPendingTask?: boolean
  waitForScan?: Promise<void>
  reviewedRecords?: () => ChatImportReviewedRecords | undefined
} = {}) {
  const tasks = new Map<string, Task>()
  const pending = ({
    requestId, companyId, conversationKey, files,
  }: {
    requestId: string; companyId: number; conversationKey: string
    files: { fileName: string; contentBase64: string }[]
  }): Task => ({
    requestId,
    companyId: String(companyId),
    conversationKey,
    status: "awaiting_decision",
    decision: {
      id: `${requestId}:purpose`, revision: 1, status: "pending",
      question: "How would you like to use these files?", allowOther: true,
      options: [{ id: "prepare_import", label: "Prepare an import for review" }, { id: "inspect_only", label: "Inspect files only" }],
      selectedOptionId: null, otherText: null, decisionId: null,
    },
    decisionReceipt: null,
    decisionHistory: [],
    createdAt: "2026-11-01T10:00:00Z",
    warnings: [],
    error: null,
    files: files.map((file, ordinal) => {
      const bytes = Buffer.from(file.contentBase64, "base64")
      return { ordinal, fileName: file.fileName, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
    }),
    reviews: [],
  })
  if (options.seedPendingTask) {
    const task = pending({
      requestId: "a".repeat(32), companyId: 9001, conversationKey: "fixture-import-conversation",
      files: [{ fileName: "synthetic-farm-1.csv", contentBase64: Buffer.from("name\nEggs").toString("base64") }],
    })
    tasks.set(task.requestId, task)
  }
  const requests = {
    posts: 0, exactReads: 0, decisionReads: 0, preparations: 0, inspections: 0, businessWrites: 0,
    decisionPosts: [] as DecisionBody[], hideStoredTasks: false, savedReads: 0, body: null as Record<string, unknown> | null,
  }
  await page.route("**/api/import-tasks**", async route => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/v1\//, "/api/")
    if (route.request().method() === "POST" && path.endsWith("/decision")) {
      const task = tasks.get(path.split("/")[3])
      const body = route.request().postDataJSON() as DecisionBody
      requests.decisionPosts.push(body)
      if (!task || requests.hideStoredTasks || task.companyId !== String(body.companyId)) return route.fulfill({ status: 403, json: { error: "This decision belongs to another actor or company." } })
      const replay = task.decisionHistory.find(receipt => receipt.decisionId === body.decisionId)
      if (replay) return route.fulfill({ json: { ...task, decisionReceipt: replay } })
      if (body.expectedRevision !== task.decision.revision) return route.fulfill({ status: 409, json: { error: "The question changed." } })
      if (body.optionId === "other" && !body.otherText?.trim()) return route.fulfill({ status: 400, json: { error: "Enter your instructions." } })
      const revision = body.expectedRevision + 1
      const receipt = { decisionId: body.decisionId, optionId: body.optionId, otherText: body.otherText ?? null, revision, createdAt: "2026-11-01T10:01:00Z" }
      task.decision = {
        ...task.decision, revision, status: body.optionId === "other" ? "pending" : "approved",
        selectedOptionId: body.optionId, otherText: body.otherText ?? null, decisionId: body.decisionId,
      }
      task.decisionReceipt = receipt
      task.decisionHistory.push(receipt)
      if (body.optionId !== "other") {
        if (body.optionId === "prepare_import") requests.preparations += 1
        else requests.inspections += 1
        task.status = body.optionId === "prepare_import" ? "needs_review" : "inspection_ready"
        task.reviews = [{ id: "71", title: body.optionId === "prepare_import" ? "Synthetic farm history" : "Synthetic file inspection", targetEntity: "source_observation", total: 15, pending: 15, confirmed: 0, excluded: 0 }]
        task.warnings = ["Synthetic historical quantities require review; no current stock was created."]
      }
      if (options.loseDecisionReply) return route.abort("failed")
      return route.fulfill({ json: task })
    }
    if (route.request().method() === "POST" && path === "/api/import-tasks") {
      requests.posts += 1
      const body = route.request().postDataJSON() as {
        requestId: string; companyId: number; conversationKey: string;
        files: { fileName: string; contentBase64: string }[];
        initialMode?: "inspect_only" | "prepare_import"
      }
      requests.body = body
      const task = pending(body)
      if (body.initialMode) {
        const receipt = {
          decisionId: "d".repeat(32), optionId: body.initialMode, otherText: null,
          revision: 2, createdAt: "2026-11-01T10:00:00Z",
        }
        task.status = "saved"
        task.decision = { ...task.decision, revision: 2, status: "approved", selectedOptionId: body.initialMode, decisionId: receipt.decisionId }
        task.decisionReceipt = receipt
        task.decisionHistory.push(receipt)
      }
      tasks.set(task.requestId, task)
      if (options.losePostReply) return route.abort("failed")
      return route.fulfill({ json: task })
    }
    if (route.request().method() === "GET" && path === "/api/import-tasks") {
      const conversationKey = url.searchParams.get("conversationKey")
      if (!conversationKey) requests.savedReads += 1
      return route.fulfill({ json: { tasks: requests.hideStoredTasks ? [] : [...tasks.values()].filter(task => task.companyId === url.searchParams.get("companyId") && (!conversationKey || task.conversationKey === conversationKey)), nextCursor: null } })
    }
    const requestId = path.split("/")[3]
    const task = tasks.get(requestId)
    requests.exactReads += 1
    if (path.includes("/workflow") && route.request().method() !== "GET") {
      requests.businessWrites += 1
      return route.fulfill({ status: 500, json: { error: "Source preparation must not dispatch ERP workflow actions" } })
    }
    if (!task || requests.hideStoredTasks || task.companyId !== url.searchParams.get("companyId")) return route.fulfill({ status: 404, json: { error: "Not found" } })
    if (path.endsWith("/resume") && route.request().method() === "POST") {
      await options.waitForScan
      if (task.status === "saved") {
        const preparing = task.decision.selectedOptionId === "prepare_import"
        if (preparing) requests.preparations += 1
        else requests.inspections += 1
        task.status = preparing ? "needs_review" : "inspection_ready"
        task.reviews = [{
          id: "71", title: preparing ? "Synthetic farm history" : "Synthetic file inspection",
          targetEntity: "source_observation", total: 15, pending: 15, confirmed: 0, excluded: 0,
        }]
      }
      return route.fulfill({ json: task })
    }
    if (path.includes("/workflow")) {
      if (!path.endsWith("/workflow")) return route.fulfill({ status: 404, json: { error: "No saved proposal request" } })
      return route.fulfill({ json: {
        version: 1, organizationId: "8001", companyId: task.companyId, requestId: task.requestId,
        capabilities: [], proposals: [], nativeResults: [], nativeResultsMore: false,
        reviewedRecords: options.reviewedRecords?.(),
      } })
    }
    const decisionId = url.searchParams.get("decisionId")
    if (decisionId) {
      requests.decisionReads += 1
      const receipt = task.decisionHistory.find(receipt => receipt.decisionId === decisionId)
      return receipt ? route.fulfill({ json: { ...task, decisionReceipt: receipt } }) : route.fulfill({ status: 404, json: { error: "Decision not accepted" } })
    }
    return route.fulfill({ json: { ...task, organizationId: "8001" } })
  })
  await page.route("**/api/import/*", route => {
    if (route.request().method() === "POST") requests.businessWrites += 1
    return route.fulfill({ status: 500, json: { error: "Preparation must not import records" } })
  })
  await page.route("**/api/import-recipes**", route => route.request().method() === "GET"
    ? route.fulfill({ json: { recipes: [] } })
    : route.fulfill({ status: 500, json: { error: "No recipe mutation is expected in this fixture" } }))
  return requests
}

async function openChat(page: Page) {
  await page.goto("/chat-import")
  await expect(page.getByTestId("erp-ai-chat-attach")).toBeEnabled()
  await expect(page.getByTestId("erp-ai-chat-input")).toHaveValue("")
}

async function dropCsvFiles(page: Page, count = 1) {
  await page.getByTestId("erp-ai-chat-panel").evaluate((panel, fileCount) => {
    const transfer = new DataTransfer()
    for (let index = 0; index < fileCount; index += 1) {
      transfer.items.add(new File(["date,description,quantity,amount\n2022-10-01,Sausage,8,4800\n"], `synthetic-farm-${index + 1}.csv`, { type: "text/csv" }))
    }
    panel.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, count)
}

async function approvePreparation(page: Page) {
  await page.getByRole("button", { name: "Approve preparation", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review Synthetic farm history", exact: true })).toBeVisible()
}

async function expectPanelBelowImportTabs(workspace: Locator, stage: string) {
  const tabs = workspace.getByRole("tablist", { name: "Import task stages" })
  const panel = workspace.getByRole("tabpanel", { name: stage, exact: true })
  await expect(panel).toBeVisible()
  await expect.poll(async () => {
    const [tabBounds, panelBounds] = await Promise.all([
      tabs.boundingBox(),
      panel.boundingBox(),
    ])
    return tabBounds && panelBounds
      ? panelBounds.y - (tabBounds.y + tabBounds.height)
      : Number.NEGATIVE_INFINITY
  }).toBeGreaterThanOrEqual(0)
}

async function mockSourceReview(page: Page, inspection = false) {
  await page.route("**/api/query/**", route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith("/companies") ? [{ id: 9001, organizationId: 8001, name: "Synthetic farm company", currencyId: 1 }] : []
    return route.fulfill({ json: { data } })
  })
  await page.route("**/api/bootstrap/currencies", route => route.fulfill({ json: { data: [{ id: "1", code: "RWF", decimalPlaces: 0 }] } }))
  const review = {
    id: "71", title: inspection ? "Synthetic file inspection" : "Synthetic farm history", targetEntity: "source_observation", sourceFile: "synthetic-farm-1.csv",
    total: 1, pending: inspection ? 0 : 1, confirmed: inspection ? 1 : 0, excluded: 0,
  }
  const source = {
    key: "historical-row-2", label: "Synthetic historical sausage",
    source: { file: "synthetic-farm-1.csv", row: 2, sha256: "a".repeat(64), rowBasis: "source_line" },
    issue: "Historical observation: actual weight remains unknown.",
    fields: [{ key: "quantity", label: "Recorded quantity", kind: "decimal", sourceValue: "8", required: false, export: false }],
    proposed: { quantity: inspection ? "8" : null },
  }
  await page.route("**/api/import-reviews**", route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith("/history")) return route.fulfill({ json: { history: [], nextBeforeRevision: null } })
    if (path.endsWith("/71")) return route.fulfill({ json: {
      ...review, history: [], items: [{
        id: "711", source, values: source.proposed, confirmedFields: inspection ? ["quantity"] : [], state: inspection ? "confirmed" : "needs_review",
        revision: inspection ? 2 : 1, reason: inspection ? "Verified observation only" : null, reviewedBy: inspection ? "ab".repeat(32) : null, reviewedAt: inspection ? "2026-11-01T10:05:00Z" : null,
      }],
    } })
    return route.fulfill({ json: { data: [review] } })
  })
}

test("an older file task can still wait for manual preparation or inspection", async ({ page }) => {
  const requests = await mockTasks(page, { seedPendingTask: true })
  await openChat(page)
  const card = page.getByTestId("chat-decision-card")
  await expect(card.getByRole("heading", { name: "How would you like to use these files?", exact: true })).toBeVisible()
  await expect(card.getByRole("radio", { name: "Other", exact: true })).toBeVisible()
  await expect(card.getByRole("button", { name: "Submit answer", exact: true })).toBeDisabled()
  await card.getByRole("radio", { name: "Prepare an import for review", exact: true }).check()
  await expect(card.getByRole("button", { name: "Approve preparation", exact: true })).toBeEnabled()
  expect(requests.posts).toBe(0)
  expect(requests.decisionPosts).toHaveLength(0)
  expect(requests.preparations).toBe(0)
  expect(requests.inspections).toBe(0)
  expect(requests.businessWrites).toBe(0)
})

test("refresh restores the pending question without uploading or processing again", async ({ page }) => {
  const requests = await mockTasks(page, { seedPendingTask: true })
  await openChat(page)
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toBeVisible()
  await expect(page.getByTestId("chat-decision-card").getByRole("heading", { name: "How would you like to use these files?", exact: true })).toBeVisible()
  expect(requests.posts).toBe(0)
  expect(requests.decisionPosts).toHaveLength(0)
  expect(requests.preparations).toBe(0)
  expect(requests.businessWrites).toBe(0)
})

test("a lost POST reply checks the exact task instead of submitting twice", async ({ page }) => {
  const requests = await mockTasks(page, { losePostReply: true })
  await openChat(page)
  await dropCsvFiles(page)
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toBeVisible()
  expect(requests.posts).toBe(1)
  expect(requests.exactReads).toBeGreaterThanOrEqual(1)
  await page.reload()
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toBeVisible()
  expect(requests.posts).toBe(1)
})

test("switching company hides the previous task and leaves no automatic import", async ({ page }) => {
  const requests = await mockTasks(page)
  await openChat(page)
  await dropCsvFiles(page)
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Change import company", exact: true }).click()
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toHaveCount(0)
  await expect(page.getByTestId("chat-decision-card")).toHaveCount(0)
  await expect(page.getByTestId("erp-ai-chat-attach")).toBeEnabled()
  expect(requests.posts).toBe(1)
  expect(requests.decisionPosts).toHaveLength(0)
  expect(requests.businessWrites).toBe(0)
})

test("unsupported files report an error before making an upload request", async ({ page }) => {
  const requests = await mockTasks(page)
  await openChat(page)
  await page.getByTestId("erp-ai-chat-file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Not a spreadsheet") })
  await expect(page.getByTestId("erp-ai-chat-panel").getByRole("alert")).toContainText("notes.txt is not a CSV or XLSX file.")
  expect(requests.posts).toBe(0)
  expect(requests.businessWrites).toBe(0)
})

test("changing actor discards the previous actor's task cards", async ({ page }) => {
  const requests = await mockTasks(page, { seedPendingTask: true })
  await openChat(page)
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toBeVisible()
  await page.getByTestId("chat-decision-card").getByRole("radio", { name: "Other", exact: true }).check()
  await page.getByRole("textbox", { name: "Tell us what you want to do", exact: true }).fill("Do not reuse this actor's answer")
  // The simulated backend resolves the next session to a different actor and
  // returns only that actor's tasks. Actual authorization is covered server-side.
  requests.hideStoredTasks = true
  await page.getByRole("button", { name: "Change import actor", exact: true }).click()
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toHaveCount(0)
  await expect(page.getByTestId("chat-decision-card")).toHaveCount(0)
  await expect(page.getByTestId("erp-ai-chat-attach")).toBeEnabled()
  expect(requests.posts).toBe(0)
  expect(requests.decisionPosts).toHaveLength(0)
})

test("a prepared task opens its exact source in the existing review workspace", async ({ page }) => {
  const requests = await mockTasks(page)
  await mockSourceReview(page)
  await openChat(page)
  await dropCsvFiles(page)
  await approvePreparation(page)
  await page.getByRole("button", { name: "Review Synthetic farm history", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Review source and prepare import", exact: true })).toBeVisible()
  await expectPanelBelowImportTabs(dialog.getByTestId("saved-import-workspace"), "Decisions")
  const row = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "Synthetic historical sausage", exact: true }) })
  await expect(row).toContainText("Historical observation: actual weight remains unknown.")
  await row.getByRole("button", { name: "Review and correct", exact: true }).click()
  await expect(dialog.getByRole("region", { name: "Review Synthetic historical sausage", exact: true })).toContainText("8")
  expect(requests.posts).toBe(1)
  expect(requests.decisionPosts).toHaveLength(1)
  expect(requests.preparations).toBe(1)
  expect(requests.businessWrites).toBe(0)
})

test("Shop Sales approves only ready rows and reopens exact verified records from a new chat", async ({ page }) => {
  let reviewedRecords: ChatImportReviewedRecords | undefined
  const requests = await mockTasks(page, { reviewedRecords: () => reviewedRecords })
  await mockSourceReview(page)

  const item = (id: string, sheet: string, product: string, price: string, amount: string, row = 11) => {
    const values = {
      shop: sheet === "Ventes Kimironko" ? "KIMIRONKO" : "ZINIA",
      sale_date: "2024-04-12", currency_code: "RWF", product_label: product,
      sold_quantity: "2", sale_unit_price: price, sale_amount: amount,
    }
    const fields = Object.entries(values).map(([key, sourceValue]) => ({
      key, label: key.replaceAll("_", " "), kind: "text", sourceValue, required: true, export: false,
    }))
    return {
      id, revision: 3, state: "confirmed", values, confirmedFields: Object.keys(values),
      reason: null, reviewedBy: "ab".repeat(32), reviewedAt: "2026-11-01T10:05:00Z",
      source: {
        key: `shop-${id}`, label: product, fields, proposed: values,
        issue: "Reviewed historical quantity and price.",
        source: { file: "synthetic-farm-1.xlsx", row, sheet, multiWorksheet: true, sha256: "a".repeat(64), rowBasis: "import_row" },
      },
    }
  }
  const sales = [
    item("711", "Ventes Kimironko", "Inkoko", "16250", "32500"),
    item("712", "Ibyagurishijwe Zinia", "Brochette", "5000.225", "10000.45"),
    item("713", "Ibyagurishijwe Zinia", "Doubtful amount", "1500", "2999.50", 13),
  ]
  const review = {
    id: "71", title: "Synthetic farm history", targetEntity: "source_observation",
    sourceFile: "synthetic-farm-1.xlsx", total: 3, pending: 0, confirmed: 3, excluded: 0,
    items: sales, history: [], reviewOperations: [{
      key: "shop_sales_backfill", version: 1, label: "Shop sales", destination: "/sales?tab=shop-sales",
      itemIds: sales.map(row => row.id), reviewedRecord: {
        dispatch: "shop_sales", inputs: [], previewFields: [
          { key: "product", label: "Product" }, { key: "amount", label: "Total" }, { key: "currency", label: "Currency" },
        ],
      },
    }],
  }
  await page.route(/\/api\/import-reviews\/71(?:\?|$)/, route => route.fulfill({ json: review }))
  const previewDigests = ["c".repeat(64), "d".repeat(64)]
  const recordIds = ["9007199254740993", "62"]
  const commands: unknown[] = []
  await page.route("**/api/import-reviews/71/module-backfill", route => {
    const request = route.request().postDataJSON()
    commands.push(request)
    if (request.preview) return route.fulfill({ json: { results: [
      ...sales.slice(0, 2).map((row, index) => ({
        itemId: row.id, status: "ready", digest: previewDigests[index],
        periodStart: row.values.sale_date, periodEnd: row.values.sale_date,
        facts: { product: row.values.product_label, amount: row.values.sale_amount, currency: "RWF" },
        recordId: index ? recordIds[index] : undefined,
      })),
      { itemId: "713", status: "held", reason: "Quantity times price differs from the source amount." },
    ] } })
    reviewedRecords = {
      counts: { verified: 2, alreadyPresent: 1 },
      records: sales.slice(0, 2).map((row, index) => ({
        id: recordIds[index]!, module: "shop_sales", periodStart: row.values.sale_date,
        displayLabel: row.values.product_label,
      })),
      more: false,
    }
    return route.fulfill({ json: { results: sales.slice(0, 2).map((row, index) => ({
      itemId: row.id, status: index ? "matched" : "saved", recordId: recordIds[index],
    })) } })
  })

  await openChat(page)
  await page.getByTestId("erp-ai-chat-file-input").setInputFiles({
    name: review.sourceFile,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("Simulated workbook bytes. Real workbook parsing is verified separately."),
  })
  await approvePreparation(page)
  await page.getByRole("button", { name: "Review Synthetic farm history", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Preview shop sales" }).click()
  await expect(dialog.getByText("Quantity times price differs from the source amount.", { exact: false })).toBeVisible()
  await expect(dialog.getByText("Total 10000.45", { exact: false })).toBeVisible()
  expect(commands).toEqual([{
    companyId: 9001, module: "shop_sales", preview: true,
    rows: sales.map(row => ({ itemId: row.id, revision: row.revision })),
  }])
  await dialog.getByRole("button", { name: "Save and verify 2 records" }).click()
  await expect(dialog.getByText("1 saved · 1 matched existing records", { exact: false })).toBeVisible()
  await expect(dialog.getByRole("link", { name: "Inkoko", exact: true })).toHaveAttribute(
    "href", new RegExp(`^/sales\\?tab=shop-sales&backfillCompany=9001&backfillRecord=${recordIds[0]}&backfillTask=[a-f0-9]{32}$`),
  )
  expect(commands[1]).toEqual({
    companyId: 9001, module: "shop_sales", preview: false,
    rows: sales.slice(0, 2).map((row, index) => ({ itemId: row.id, revision: row.revision, expectedDigest: previewDigests[index] })),
  })

  await page.goto("/chat-import?thread=sales-follow-up")
  await page.getByRole("button", { name: "Continue saved import", exact: true }).click()
  await dialog.getByRole("button", { name: "Open saved task", exact: true }).click()
  await dialog.getByRole("tab", { name: "ERP results", exact: true }).click()
  await expect(dialog.getByText("2 verified ERP records", { exact: false })).toBeVisible()
  await dialog.getByText("Exact ERP records", { exact: true }).click()
  await expect(dialog.getByRole("link", { name: /Inkoko/ })).toHaveAttribute(
    "href", `/sales?tab=shop-sales&backfillCompany=9001&backfillRecord=${recordIds[0]}`,
  )
  expect(commands).toHaveLength(2)
  expect(requests.posts).toBe(1)
  expect(requests.businessWrites).toBe(0)
  await expect(page.getByTestId("chat-text-requests")).toHaveText("0")
})

test("saved import stages sit above their panels in the narrow Settings workspace", async ({ page }) => {
  const requests = await mockTasks(page)
  await mockSourceReview(page)
  await openChat(page)
  await dropCsvFiles(page)
  await approvePreparation(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/chat-import?surface=settings")
  const savedTasks = page.getByRole("region", { name: "Saved import tasks" })
  await savedTasks.getByRole("button", { name: "Open saved task", exact: true }).click()

  const workspace = page.getByTestId("saved-import-workspace")
  const tabs = workspace.getByRole("tablist", { name: "Import task stages" })
  await expectPanelBelowImportTabs(workspace, "Sources")
  for (const stage of ["Decisions", "ERP preview", "ERP results"]) {
    await tabs.getByRole("tab", { name: stage, exact: true }).click()
    await expectPanelBelowImportTabs(workspace, stage)
  }
  expect(requests.businessWrites).toBe(0)
})

test("Other requires instructions and preserves the paused question after receipt and refresh", async ({ page }) => {
  const requests = await mockTasks(page, { seedPendingTask: true })
  await openChat(page)
  const card = page.getByTestId("chat-decision-card")
  await card.getByRole("radio", { name: "Other", exact: true }).check()
  const answer = page.getByRole("textbox", { name: "Tell us what you want to do", exact: true })
  await answer.fill("   ")
  await expect(card.getByRole("button", { name: "Send instructions", exact: true })).toBeDisabled()
  const instructions = "Check the historical location labels with me before processing."
  await answer.fill(instructions)
  expect(requests.decisionPosts).toHaveLength(0)
  await card.getByRole("button", { name: "Send instructions", exact: true }).click()
  await expect(page.getByText(instructions, { exact: true })).toBeVisible()
  await expect(page.getByTestId("chat-decision-card")).toBeVisible()
  expect(requests.decisionPosts).toHaveLength(1)
  expect(requests.preparations).toBe(0)
  expect(requests.inspections).toBe(0)
  await page.reload()
  await expect(page.getByText(instructions, { exact: true })).toBeVisible()
  await expect(page.getByTestId("chat-decision-card")).toBeVisible()
  expect(requests.posts).toBe(0)
  expect(requests.decisionPosts).toHaveLength(1)
  expect(requests.preparations).toBe(0)
  expect(requests.businessWrites).toBe(0)
})

test("explicit preparation approval recovers a lost reply using one decision identity", async ({ page }) => {
  const requests = await mockTasks(page, { loseDecisionReply: true })
  await openChat(page)
  await dropCsvFiles(page)
  await approvePreparation(page)
  expect(requests.decisionPosts).toHaveLength(1)
  expect(requests.decisionPosts[0].optionId).toBe("prepare_import")
  expect(requests.decisionPosts[0].expectedRevision).toBe(2)
  expect(requests.decisionPosts[0].decisionId).toMatch(/^[0-9a-f]{32}$/)
  expect(requests.decisionReads).toBeGreaterThanOrEqual(1)
  expect(requests.preparations).toBe(1)
  await page.reload()
  await expect(page.getByRole("button", { name: "Review Synthetic farm history", exact: true })).toBeVisible()
  await expect(page.getByTestId("chat-decision-card")).toHaveCount(0)
  expect(requests.posts).toBe(1)
  expect(requests.decisionPosts).toHaveLength(1)
  expect(requests.preparations).toBe(1)
  expect(requests.businessWrites).toBe(0)
})

test("automatic inspection keeps even confirmed observations out of the import continuation", async ({ page }) => {
  const requests = await mockTasks(page)
  await mockSourceReview(page, true)
  await openChat(page)
  await dropCsvFiles(page)
  await page.getByRole("button", { name: "View inspection Synthetic file inspection", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Inspect saved source files", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /Continue import/ })).toHaveCount(0)
  expect(requests.decisionPosts).toHaveLength(0)
  expect(requests.inspections).toBe(1)
  expect(requests.preparations).toBe(0)
  expect(requests.businessWrites).toBe(0)
})


test("plain drop saves an exact task link, inspects, and reopens in a new chat", async ({ page }) => {
  let finishScan!: () => void
  const waitForScan = new Promise<void>(resolve => { finishScan = resolve })
  const requests = await mockTasks(page, { waitForScan })
  await mockSourceReview(page, true)
  await openChat(page)
  await page.getByTestId("erp-ai-chat-input").fill("Keep this unsent note")
  await dropCsvFiles(page, 15)
  const link = page.getByRole("link", { name: "Open this task in Data import", exact: true })
  try {
    await expect(link).toHaveAttribute("href", /importTask=[0-9a-f]{32}&importCompany=9001&importView=sources/)
    expect(requests.inspections).toBe(0)
  } finally {
    finishScan()
  }
  await expect(page.getByRole("button", { name: "View inspection Synthetic file inspection" })).toBeVisible()
  await expect(page.getByTestId("erp-ai-chat-input")).toHaveValue("Keep this unsent note")
  await expect(page.getByTestId("chat-text-requests")).toHaveText("0")

  await page.goto("/chat-import?thread=another-conversation")
  await page.getByRole("button", { name: "Continue saved import", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Open saved task", exact: true }).click()
  await expect(dialog.getByTestId("saved-import-workspace")).toBeVisible()
  await expect(dialog.getByRole("tab", { name: "ERP preview" })).toBeDisabled()

  expect(requests.posts).toBe(1)
  expect(requests.savedReads).toBe(1)
  expect(requests.inspections).toBe(1)
  expect(requests.preparations).toBe(0)
  expect(requests.businessWrites).toBe(0)
})

test("a direct chat instruction starts preparation, preserving the unsent text", async ({ page }) => {
  const requests = await mockTasks(page)
  await openChat(page)
  await page.getByTestId("erp-ai-chat-input").fill("Please backfill these shop sales")
  await dropCsvFiles(page)
  await expect(page.getByRole("button", { name: "Review Synthetic farm history" })).toBeVisible()
  await expect(page.getByTestId("erp-ai-chat-input")).toHaveValue("Please backfill these shop sales")
  await expect(page.getByTestId("chat-text-requests")).toHaveText("0")
  expect(requests.body?.initialMode).toBe("prepare_import")
  expect(requests.preparations).toBe(1)
  expect(requests.inspections).toBe(0)
  expect(requests.businessWrites).toBe(0)
})

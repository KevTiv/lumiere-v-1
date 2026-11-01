import { createHash } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import type { ChatImportTask as Task } from "../lib/chat-import-task"

// Production chat/task components, synthetic HTTP only. Original private farm
// files and deployed backend behavior are separate acceptance requirements.
type DecisionBody = {
  companyId: number; decisionId: string; expectedRevision: number;
  optionId: "prepare_import" | "inspect_only" | "other"; otherText?: string;
}

async function mockTasks(page: Page, options: { losePostReply?: boolean; loseDecisionReply?: boolean } = {}) {
  const tasks = new Map<string, Task>()
  const requests = {
    posts: 0, exactReads: 0, decisionReads: 0, preparations: 0, inspections: 0, businessWrites: 0,
    decisionPosts: [] as DecisionBody[], hideStoredTasks: false, body: null as Record<string, unknown> | null,
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
      }
      requests.body = body
      const task: Task = {
        requestId: body.requestId,
        companyId: String(body.companyId),
        conversationKey: body.conversationKey,
        status: "awaiting_decision",
        decision: {
          id: `${body.requestId}:purpose`, revision: 1, status: "pending",
          question: "How would you like to use these files?", allowOther: true,
          options: [{ id: "prepare_import", label: "Prepare an import for review" }, { id: "inspect_only", label: "Inspect files only" }],
          selectedOptionId: null, otherText: null, decisionId: null,
        },
        decisionReceipt: null,
        decisionHistory: [],
        createdAt: "2026-11-01T10:00:00Z",
        warnings: [],
        error: null,
        files: body.files.map((file, ordinal) => {
          const bytes = Buffer.from(file.contentBase64, "base64")
          return { ordinal, fileName: file.fileName, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }
        }),
        reviews: [],
      }
      tasks.set(task.requestId, task)
      if (options.losePostReply) return route.abort("failed")
      return route.fulfill({ json: task })
    }
    if (route.request().method() === "GET" && path === "/api/import-tasks") {
      return route.fulfill({ json: { tasks: requests.hideStoredTasks ? [] : [...tasks.values()].filter(task => task.companyId === url.searchParams.get("companyId") && task.conversationKey === url.searchParams.get("conversationKey")) } })
    }
    const requestId = path.split("/")[3]
    const task = tasks.get(requestId)
    requests.exactReads += 1
    if (!task || task.companyId !== url.searchParams.get("companyId")) return route.fulfill({ status: 404, json: { error: "Not found" } })
    const decisionId = url.searchParams.get("decisionId")
    if (decisionId) {
      requests.decisionReads += 1
      const receipt = task.decisionHistory.find(receipt => receipt.decisionId === decisionId)
      return receipt ? route.fulfill({ json: { ...task, decisionReceipt: receipt } }) : route.fulfill({ status: 404, json: { error: "Decision not accepted" } })
    }
    return route.fulfill({ json: task })
  })
  await page.route("**/api/import/*", route => {
    if (route.request().method() === "POST") requests.businessWrites += 1
    return route.fulfill({ status: 500, json: { error: "Preparation must not import records" } })
  })
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
  const card = page.getByTestId("chat-decision-card")
  await card.getByRole("radio", { name: "Prepare an import for review", exact: true }).check()
  await card.getByRole("button", { name: "Approve preparation", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review Synthetic farm history", exact: true })).toBeVisible()
}

async function mockSourceReview(page: Page, inspection = false) {
  await page.route("**/api/query/**", route => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith("/companies") ? [{ id: 9001, organizationId: 8001, name: "Synthetic farm company", currencyId: 1 }] : []
    return route.fulfill({ json: { data } })
  })
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

test("dropping fifteen CSVs only saves originals and asks before any processing", async ({ page }) => {
  const requests = await mockTasks(page)
  await openChat(page)
  await page.getByTestId("erp-ai-chat-input").fill("Keep this unsent note")
  await dropCsvFiles(page, 15)
  await expect(page.getByText("synthetic-farm-15.csv", { exact: true })).toBeVisible()
  const card = page.getByTestId("chat-decision-card")
  await expect(card.getByRole("heading", { name: "How would you like to use these files?", exact: true })).toBeVisible()
  await expect(card.getByRole("radio", { name: "Other", exact: true })).toBeVisible()
  await expect(card.getByRole("button", { name: "Submit answer", exact: true })).toBeDisabled()
  await card.getByRole("radio", { name: "Prepare an import for review", exact: true }).check()
  await expect(card.getByRole("button", { name: "Approve preparation", exact: true })).toBeEnabled()
  await expect(page.getByRole("button", { name: "Review Synthetic farm history", exact: true })).toHaveCount(0)
  await expect(page.getByTestId("erp-ai-chat-input")).toHaveValue("Keep this unsent note")
  await expect(page.getByTestId("chat-text-requests")).toHaveText("0")
  expect(requests.posts).toBe(1)
  expect(requests.body?.files).toHaveLength(15)
  expect(requests.decisionPosts).toHaveLength(0)
  expect(requests.preparations).toBe(0)
  expect(requests.inspections).toBe(0)
  expect(requests.businessWrites).toBe(0)
})

test("refresh restores the pending question without uploading or processing again", async ({ page }) => {
  const requests = await mockTasks(page)
  await openChat(page)
  await dropCsvFiles(page)
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("synthetic-farm-1.csv", { exact: true })).toBeVisible()
  await expect(page.getByTestId("chat-decision-card").getByRole("heading", { name: "How would you like to use these files?", exact: true })).toBeVisible()
  expect(requests.posts).toBe(1)
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
  await page.getByTestId("chat-decision-card").getByRole("radio", { name: "Prepare an import for review", exact: true }).check()
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
  const requests = await mockTasks(page)
  await openChat(page)
  await dropCsvFiles(page)
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
  expect(requests.posts).toBe(1)
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
  const row = dialog.getByRole("row").filter({ has: page.getByRole("cell", { name: "Synthetic historical sausage", exact: true }) })
  await expect(row).toContainText("Historical observation: actual weight remains unknown.")
  await row.getByRole("button", { name: "Review and correct", exact: true }).click()
  await expect(dialog.getByRole("region", { name: "Review Synthetic historical sausage", exact: true })).toContainText("8")
  expect(requests.posts).toBe(1)
  expect(requests.decisionPosts).toHaveLength(1)
  expect(requests.preparations).toBe(1)
  expect(requests.businessWrites).toBe(0)
})

test("Other requires instructions and preserves the paused question after receipt and refresh", async ({ page }) => {
  const requests = await mockTasks(page)
  await openChat(page)
  await dropCsvFiles(page)
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
  expect(requests.posts).toBe(1)
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
  expect(requests.decisionPosts[0].expectedRevision).toBe(1)
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

test("inspection approval keeps even confirmed observations out of the import continuation", async ({ page }) => {
  const requests = await mockTasks(page)
  await mockSourceReview(page, true)
  await openChat(page)
  await dropCsvFiles(page)
  const card = page.getByTestId("chat-decision-card")
  await card.getByRole("radio", { name: "Inspect files only", exact: true }).check()
  expect(requests.inspections).toBe(0)
  await card.getByRole("button", { name: "Approve inspection", exact: true }).click()
  await page.getByRole("button", { name: "View inspection Synthetic file inspection", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Inspect saved source files", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /Continue import/ })).toHaveCount(0)
  expect(requests.decisionPosts).toHaveLength(1)
  expect(requests.inspections).toBe(1)
  expect(requests.preparations).toBe(0)
  expect(requests.businessWrites).toBe(0)
})

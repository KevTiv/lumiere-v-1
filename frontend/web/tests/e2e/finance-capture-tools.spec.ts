import { createHash } from "node:crypto"
import { expect, test, type Page, type Request } from "@playwright/test"
import type { ExpenseCaptureOutboxItem } from "../../lib/expense-capture-outbox"
import {
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

interface CaptureRow {
  id?: unknown
  organizationId?: unknown
  organization_id?: unknown
  companyId?: unknown
  company_id?: unknown
  employeeId?: unknown
  employee_id?: unknown
  clientRequestId?: unknown
  client_request_id?: unknown
  attachmentIds?: unknown
  attachment_ids?: unknown
  hasReceipt?: unknown
  has_receipt?: unknown
  storageKey?: unknown
  storage_key?: unknown
  contentHash?: unknown
  content_hash?: unknown
}
interface CaptureCommand {
  params: {
    client_request_id?: unknown
    employee_id?: unknown
    company_id?: unknown
    attachment_ids?: unknown
    storage_key?: unknown
    content_hash?: unknown
  }
}
interface CompletedUpload {
  url: string
  objectKey: string
  checksum: string
  fileSize: number
}

// Only unwrap the generated Option representation. IDs remain exact strings.
function wireValue(value: unknown): unknown {
  if (value && typeof value === "object" && "some" in value) return value.some
  if (value && typeof value === "object" && "none" in value) return undefined
  return value
}
function exactId(value: unknown): string {
  const raw = wireValue(value)
  if (typeof raw === "number") expect(Number.isSafeInteger(raw)).toBeTruthy()
  expect(typeof raw === "string" || typeof raw === "number").toBeTruthy()
  const id = String(raw)
  expect(id).toMatch(/^[1-9]\d*$/)
  return id
}
async function rows(
  page: Page,
  resource: "expenses" | "expense-receipts",
): Promise<CaptureRow[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} authorized query`).toBeTruthy()
  const body = (await response.json()) as { data?: CaptureRow[] }
  expect(Array.isArray(body.data)).toBeTruthy()
  return body.data!
}
function requestKey(row: CaptureRow): string {
  return String(row.clientRequestId ?? row.client_request_id ?? "")
}
async function queuedCapture(
  page: Page,
  organizationId: string,
  requestId: string,
) {
  return page.evaluate(
    ({ organizationId, requestId }) => {
      const deviceId = localStorage.getItem("lumiere.expense-capture-device-id")
      if (!deviceId) throw new Error("Capture device identity is missing")
      const items = JSON.parse(
        localStorage.getItem(
          `lumiere.expense-capture-outbox.${organizationId}.${deviceId}`,
        ) ?? "[]",
      ) as ExpenseCaptureOutboxItem[]
      const matches = items.filter((item) => item.clientRequestId === requestId)
      if (matches.length !== 1)
        throw new Error(
          `Expected one queued request identity, found ${matches.length}`,
        )
      return matches[0]!
    },
    { organizationId, requestId },
  )
}
async function selectSeededChoice(page: Page, testId: string): Promise<string> {
  await page.locator(`[data-testid="${testId}"]:visible`).click()
  const choice = page
    .locator('[role="listbox"]:visible')
    .getByRole("option", { disabled: false })
    .first()
  await expect(choice).toBeVisible()
  const id = exactId(await choice.getAttribute("data-value"))
  await choice.click()
  return id
}
function tinyPdf(): Buffer {
  const parts = ["%PDF-1.4\n"]
  const offsets = [0]
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 72] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  const text = "BT /F1 12 Tf 12 36 Td (Receipt fixture) Tj ET\n"
  objects.push(
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`,
  )
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(parts.join("")))
    parts.push(`${i + 1} 0 obj\n${object}\nendobj\n`)
  })
  const xref = Buffer.byteLength(parts.join(""))
  parts.push(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join(
        "",
      )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  )
  return Buffer.from(parts.join(""))
}
const receipts = [
  {
    kind: "PNG",
    name: "capture-receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQaPj/HwAFAgKfdqhGyQAAAABJRU5ErkJggg==",
      "base64",
    ),
  },
  {
    kind: "PDF",
    name: "capture-receipt.pdf",
    mimeType: "application/pdf",
    buffer: tinyPdf(),
  },
] as const

test.describe(
  "Expense receipt capture tools",
  { tag: ["@dev-fixture", "@cov11"] },
  () => {
    for (const receipt of receipts) {
      test(`uploads a real ${receipt.kind} receipt through capture and retains one exact expense after refresh`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(120_000)
        const organizationId = String(await fetchSessionOrganizationId(page))
        const companyId = String(await fetchDefaultCompanyId(page))
        const expenseWrites: Request[] = [],
          receiptWrites: Request[] = []
        page.on("request", (request) => {
          if (request.method() !== "POST") return
          if (matchesOperationResponse(request, "create_expense"))
            expenseWrites.push(request)
          if (matchesOperationResponse(request, "create_expense_receipt"))
            receiptWrites.push(request)
        })
        await gotoModule(page, "/expenses?tab=operations", "expenses")
        const panel = page.locator(
          '[data-testid="expenses-capture-panel"]:visible',
        )
        await expect(panel).toBeVisible()
        const employeeId = await selectSeededChoice(
          page,
          "expenses-capture-employee",
        )
        await selectSeededChoice(page, "expenses-capture-pricelist")
        await page
          .getByTestId("expenses-capture-name")
          .fill(`Receipt capture ${receipt.kind}`)
        await panel.getByTestId("expenses-capture-amount").fill("12.34")
        await panel.getByTestId("expenses-capture-file").setInputFiles({
          name: receipt.name,
          mimeType: receipt.mimeType,
          buffer: receipt.buffer,
        })
        const preview = panel.getByTestId("expense-capture-attachment-preview")
        await expect(preview).toContainText(receipt.name)
        if (receipt.kind === "PNG") {
          const image = preview.getByRole("img", {
            name: "Selected receipt",
            exact: true,
          })
          await expect(image).toBeVisible()
          await expect
            .poll(() =>
              image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
            )
            .toBe(1)
        } else {
          await expect(
            preview.locator('object[type="application/pdf"][data^="blob:"]'),
          ).toBeVisible()
        }
        await preview.screenshot({
          path: testInfo.outputPath(
            `capture-${receipt.kind.toLowerCase()}-preview.png`,
          ),
        })
        const completedPromise = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname ===
              "/api/documents/blobs/complete",
        )
        const createPromise = page.waitForRequest(
          (request) =>
            request.method() === "POST" &&
            matchesOperationResponse(request, "create_expense"),
        )
        await panel.getByTestId("expenses-capture-submit").click()
        const completedResponse = await completedPromise
        expect(completedResponse.ok()).toBeTruthy()
        const completed = (await completedResponse.json()) as CompletedUpload
        const command = (await createPromise).postDataJSON() as CaptureCommand
        const clientRequestId = wireValue(command.params.client_request_id)
        expect(typeof clientRequestId).toBe("string")
        expect(clientRequestId).toMatch(/^exp-cap-/)
        const key = clientRequestId as string
        await expect(
          panel.getByTestId("expenses-capture-status"),
        ).toContainText(/Expense \d+ is confirmed in the saved records/, {
          timeout: 30_000,
        })
        expect(expenseWrites).toHaveLength(1)
        expect(receiptWrites).toHaveLength(1)
        const receiptCommand =
          receiptWrites[0]!.postDataJSON() as CaptureCommand
        const receiptRequestId = wireValue(
          receiptCommand.params.client_request_id,
        )
        expect(typeof receiptRequestId).toBe("string")
        const queued = await queuedCapture(page, organizationId, key)
        expect(queued.syncState).toBe("synced")
        expect(queued.receipt?.state).toBe("attached")
        expect(queued.companyId).toBe(companyId)
        expect(queued.payload.employeeId).toBe(employeeId)
        expect(queued.receipt?.clientRequestId).toBe(receiptRequestId)
        const receiptId = exactId(queued.receipt?.receiptId)
        const expenseId = exactId(queued.expenseId)
        const checksum = createHash("sha256")
          .update(receipt.buffer)
          .digest("hex")
        expect(completed.checksum).toBe(checksum)
        expect(completed.fileSize).toBe(receipt.buffer.length)
        expect(completed.objectKey).toMatch(
          new RegExp(`^org-${organizationId}/[a-zA-Z0-9_-]+/[a-f0-9]{32}$`),
        )
        expect(completed.objectKey).not.toMatch(/^capture:/)
        expect(queued.receipt?.uploaded?.objectKey).toBe(completed.objectKey)
        expect(queued.receipt?.uploaded?.checksum).toBe(checksum)
        expect(wireValue(receiptCommand.params.storage_key)).toBe(
          completed.objectKey,
        )
        expect(wireValue(receiptCommand.params.content_hash)).toBe(checksum)
        expect(exactId(command.params.company_id)).toBe(companyId)
        expect(exactId(command.params.employee_id)).toBe(employeeId)
        expect(
          (command.params.attachment_ids as unknown[]).map(exactId),
        ).toEqual([receiptId])
        const verifySaved = async () => {
          const expense = (await rows(page, "expenses")).filter(
            (row) => requestKey(row) === key,
          )
          const storedReceipt = (await rows(page, "expense-receipts")).filter(
            (row) => requestKey(row) === receiptRequestId,
          )
          expect(expense).toHaveLength(1)
          expect(storedReceipt).toHaveLength(1)
          expect(exactId(expense[0]!.id)).toBe(expenseId)
          expect(exactId(storedReceipt[0]!.id)).toBe(receiptId)
          for (const row of [expense[0]!, storedReceipt[0]!]) {
            expect(exactId(row.organizationId ?? row.organization_id)).toBe(
              organizationId,
            )
            expect(exactId(row.companyId ?? row.company_id)).toBe(companyId)
            expect(exactId(row.employeeId ?? row.employee_id)).toBe(employeeId)
          }
          expect(expense[0]!.hasReceipt ?? expense[0]!.has_receipt).toBe(true)
          expect(
            (
              (expense[0]!.attachmentIds ??
                expense[0]!.attachment_ids) as unknown[]
            ).map(exactId),
          ).toEqual([receiptId])
          expect(
            storedReceipt[0]!.storageKey ?? storedReceipt[0]!.storage_key,
          ).toBe(completed.objectKey)
          expect(
            storedReceipt[0]!.contentHash ?? storedReceipt[0]!.content_hash,
          ).toBe(checksum)
        }
        await verifySaved()
        const download = await page.request.get(completed.url)
        expect(download.ok()).toBeTruthy()
        expect(await download.body()).toEqual(receipt.buffer)
        await panel.screenshot({
          path: testInfo.outputPath(
            `capture-${receipt.kind.toLowerCase()}-confirmed.png`,
          ),
        })
        await page.reload()
        await expect(panel).toBeVisible()
        await expect(
          page.getByTestId("expenses-capture-item-synced"),
        ).toHaveCount(0)
        expect(await queuedCapture(page, organizationId, key)).toEqual(queued)
        await verifySaved()
        expect(expenseWrites).toHaveLength(1)
        expect(receiptWrites).toHaveLength(1)
      })
    }
  },
)

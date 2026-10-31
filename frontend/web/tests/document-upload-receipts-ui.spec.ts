import { expect, test } from "@playwright/test"
import type { DocumentUploadReceipt } from "../lib/document-upload-receipts"

test("file and document stay saved when indexing fails, and reload retries only indexing", async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  let receipt: DocumentUploadReceipt | null = null
  let reservations = 0
  let uploads = 0
  let registrations = 0
  let indexAttempts = 0
  await page.route("**/api/documents/blobs/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith("/receipt")) return route.fulfill(receipt ? { json: receipt } : { status: 404, json: { error: "Not reserved" } })
    if (url.pathname.endsWith("/presign")) {
      reservations++
      const body = request.postDataJSON()
      receipt = {
        submissionId: body.submissionId, objectKey: `org-7/default/${"d".repeat(32)}`,
        url: `/api/documents/blobs/object/7/default/${"d".repeat(32)}`,
        fileName: body.fileName, fileSize: String(body.contentLength), mimetype: body.contentType,
        checksum: body.checksum, fileSaved: false, bytesUploaded: false,
        registration: body.registration, registrationState: "unconfirmed", documentId: null, indexing: "pending",
      }
      return route.fulfill({ json: { objectKey: receipt.objectKey, uploadUrl: receipt.url.replace("/object/", "/upload/"), publicUrl: receipt.url, completed: false } })
    }
    if (request.method() === "PUT") {
      uploads++
      receipt!.bytesUploaded = true
      return route.fulfill({ status: 204 })
    }
    if (url.pathname.endsWith("/complete")) {
      receipt!.fileSaved = true
      return route.fulfill({ json: { ...receipt, fileSize: Number(receipt!.fileSize) } })
    }
    return route.fulfill({ status: 400 })
  })
  await page.route("**/fixture/register-document", async (route) => {
    registrations++
    const body = route.request().postDataJSON()
    expect(body.url).toBe(receipt!.url)
    expect(JSON.parse(body.metadata).uploadSubmissionId).toBe(receipt!.submissionId)
    receipt!.documentId = "99"
    receipt!.registrationState = "registered"
    return route.fulfill({ json: { resource: "documents", id: "99" } })
  })
  await page.route("**/api/ai/evidence/ingestion/documents", async (route) => {
    indexAttempts++
    expect(route.request().postDataJSON().documentId).toBe("99")
    receipt!.indexing = indexAttempts === 1 ? "failed" : "queued"
    return route.fulfill(indexAttempts === 1 ? { status: 503, json: { error: "Embedding service unavailable" } } : { json: { documentId: 99 } })
  })
  await page.goto("/document-receipts")
  await page.getByLabel("Source file").setInputFiles({ name: "farm-history.csv", mimeType: "text/csv", buffer: Buffer.from("product,quantity,total\nSausage,8,4800\n") })
  await expect(page.getByText("Document saved", { exact: true })).toBeVisible()
  await expect(page.getByText("File saved", { exact: true })).toBeVisible()
  await expect(page.getByText("Document registered", { exact: true })).toBeVisible()
  await expect(page.getByText("AI indexing failed", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("AI indexing failed", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Retry indexing", exact: true }).click()
  await expect(page.getByText("AI indexing pending · queued", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Open document" })).toHaveAttribute("href", "/documents/99")
  expect(reservations).toBe(1)
  expect(uploads).toBe(1)
  expect(registrations).toBe(1)
  expect(indexAttempts).toBe(2)
  // Selecting the same source after a lost UI acknowledgement finds its receipt.
  await page.getByLabel("Source file").setInputFiles({ name: "farm-history.csv", mimeType: "text/csv", buffer: Buffer.from("product,quantity,total\nSausage,8,4800\n") })
  await expect(page.getByText("Document saved", { exact: true })).toBeVisible()
  expect(uploads).toBe(1)
  expect(registrations).toBe(1)
  expect(indexAttempts).toBe(2)
  await page.screenshot({ path: testInfo.outputPath("document-receipt-index-recovery.png"), fullPage: true })
})

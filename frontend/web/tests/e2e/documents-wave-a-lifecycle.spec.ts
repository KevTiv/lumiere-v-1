import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  callReducerBffResult,
  expectNoAppError,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  selectEntityRowByText,
  smokeName,
} from "./helpers"

/**
 * Documents Wave A — upload form requires a file; attach panel surfaces on sales chatter.
 * Full blob+reducer e2e needs running api-server + STDB; this smoke validates UI contracts.
 */
test.describe("documents wave A lifecycle", () => {
  test("documents module exposes file upload on create form", async ({ page }) => {
    await page.goto("/documents")
    await expect(page.getByRole("heading", { name: /documents/i }).first()).toBeVisible({
      timeout: 60_000,
    })

    const uploadBtn = page.getByRole("button", { name: /upload document|new document/i }).first()
    if (await uploadBtn.isVisible().catch(() => false)) {
      await uploadBtn.click()
      await expect(page.locator('input[type="file"]').first()).toBeVisible({ timeout: 15_000 })
    } else {
      // Tab create action
      const docsTab = page.getByRole("tab", { name: /^documents$/i }).first()
      if (await docsTab.isVisible().catch(() => false)) {
        await docsTab.click()
      }
      const createBtn = page.getByRole("button", { name: /upload|create|new/i }).first()
      await createBtn.click()
      await expect(page.locator('input[type="file"]').first()).toBeVisible({ timeout: 15_000 })
    }
  })
})

/**
 * DOC-009: document upload → attach to a record → legal hold.
 *
 * Backend:
 * - `create_document` (spacetimedb/src/documents/documents.rs) registers a document
 *   with optional `res_model` + `res_id` — there is no separate `attach_document`
 *   reducer; attachment is encoded directly in the create params and validated
 *   against `ALLOWED_RES_MODELS` + an org-scoped FK check (DOC-001/DOC-002).
 * - `apply_document_legal_hold` (spacetimedb/src/documents/legal_hold.rs) inserts an
 *   active `DocumentLegalHold` row requiring a non-empty reason.
 * - `delete_document` refuses to soft-delete a document under an active legal hold
 *   ("Cannot delete a document under legal hold"), which this spec uses as the
 *   enforcement assertion since no dedicated `document-legal-holds` BFF query exists.
 *
 * The UI's create form requires a real blob upload (presign + complete), so the
 * upload/attach/hold steps go through the reducer BFF directly — matching the
 * pattern in accounting-post-reconcile.spec.ts — while the UI assertion stays
 * focused on the uploaded document surfacing in the documents tab.
 */

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

const DOC_MIMETYPE = "text/plain"
const DOC_CHECKSUM = "a".repeat(64)
const DOC_URL = "s3://lumiere-docs-test/smoke-doc-009.txt"
const DOC_FILE_SIZE = 42

async function fetchFirstAttachableContactId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/contacts")
  if (!res.ok()) throw new Error(`contacts query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
  const row = (json.data ?? []).find((c) => scalarQueryId(c.id) != null)
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error("no attachable contact in seed data")
  return id
}

async function fetchDocumentIdByName(page: Page, name: string): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/documents")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
      const row = (json.data ?? []).find((d) => String(d.name ?? "") === name)
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`document not found in query: ${name}`)
}

async function fetchDocumentRow(page: Page, documentId: number) {
  const res = await page.request.get("/api/query/documents")
  if (!res.ok()) throw new Error(`documents query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Record<string, unknown>[] }
  return (json.data ?? []).find((d) => scalarQueryId(d.id) === documentId)
}

test.describe("DOC-009 document upload → attach → legal hold", { tag: "@p0" }, () => {
  test("registers a document attached to a contact and applies a legal hold", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const contactId = await fetchFirstAttachableContactId(page)

    const docName = smokeName("doc009")

    await callReducerBff(page, "create_document", [
      organizationId,
      some(companyId),
      {
        name: docName,
        description: some("DOC-009 smoke document"),
        file_name: `${docName}.txt`,
        file_size: DOC_FILE_SIZE,
        mimetype: DOC_MIMETYPE,
        url: DOC_URL,
        checksum: DOC_CHECKSUM,
        folder_id: none,
        res_model: some("contact"),
        res_id: some(contactId),
        partner_id: some(contactId),
        tag_ids: [],
        is_favorite: false,
        index_content: some("DOC-009 smoke index content"),
        classification_id: none,
        retention_days: none,
        fiscal_kind: none,
        residency_region: none,
        metadata: none,
      },
    ])

    const documentId = await fetchDocumentIdByName(page, docName)

    await expect
      .poll(
        async () => {
          const row = await fetchDocumentRow(page, documentId)
          if (!row) return null
          const resModel = String(row.resModel ?? row.res_model ?? "")
          const resId = scalarQueryId(row.resId ?? row.res_id)
          return { resModel, resId }
        },
        { timeout: 30_000 },
      )
      .toEqual({ resModel: "contact", resId: contactId })

    await callReducerBff(page, "apply_document_legal_hold", [
      organizationId,
      documentId,
      { reason: `DOC-009 legal hold ${docName}`, metadata: none },
    ])

    const deleteAttempt = await callReducerBffResult(page, "delete_document", [
      organizationId,
      documentId,
    ])
    expect(deleteAttempt.ok).toBe(false)
    expect(deleteAttempt.error ?? "").toMatch(/legal hold/i)

    await gotoModule(page, "/documents", "documents")
    await page.getByTestId("module-tab-documents-documents").click()
    await selectEntityRowByText(page, docName)

    await expectNoAppError(page)
  })
})

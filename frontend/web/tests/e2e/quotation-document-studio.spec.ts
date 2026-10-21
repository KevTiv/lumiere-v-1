import { createHash } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { GeneratedQuotationDocument, QuotationDocumentPreview } from "@lumiere/query-hooks/hooks/quotations"
import {
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
  selectModuleTab,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import { provisionActor, withActor } from "./pretenant-support"
import { addLaptopLine, createDraftSaleOrder } from "./sales-order-fixtures"

interface TemplateRow {
  id?: unknown
  name?: string
  companyId?: unknown
  company_id?: unknown
  metadata?: string
}

interface DocumentRow {
  id?: unknown
  resModel?: string
  res_model?: string
  resId?: unknown
  res_id?: unknown
  checksum?: string
  metadata?: string
}

interface DocumentVersionRow {
  documentId?: unknown
  document_id?: unknown
  versionNumber?: number
  version_number?: number
  checksum?: string
  metadata?: string
}

async function savedTemplate(page: Page, companyId: number, name: string): Promise<TemplateRow> {
  let found: TemplateRow | undefined
  await expect.poll(async () => {
    const response = await page.request.get(`/api/query/document-templates?companyId=${companyId}`)
    expect(response.ok()).toBe(true)
    const body = await response.json() as { data?: TemplateRow[] }
    const matches = (body.data ?? []).filter((row) => row.name === name && scalarQueryId(row.companyId ?? row.company_id) === companyId)
    expect(matches.length).toBeLessThanOrEqual(1)
    found = matches[0]
    return scalarQueryId(found?.id)
  }, { timeout: 30_000 }).not.toBeNull()
  if (!found) throw new Error("The newly created layout could not be read back")
  return found
}

async function renameTemplate(page: Page, companyId: number, templateId: number, name: string) {
  const request = stdbBffCommandPost("update_document_template", {
    companyId, templateId,
    params: stdbParamsToJson({ name }, "UpdateDocumentTemplateParams"),
  })
  const response = await page.request.post(request.urlPath, {
    headers: { "Content-Type": "application/json" }, data: request.init.body as string,
  })
  expect(response.ok(), await response.text()).toBe(true)
  await savedTemplate(page, companyId, name)
}

test.describe("Visual quotation document output", { tag: ["@p0", "@document-studio"] }, () => {
  test("a normal staff member previews and saves a quotation, stale previews fail, and saved bytes survive template edits", async ({ page, browser }) => {
    test.setTimeout(360_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const orderId = await createDraftSaleOrder(page, smokeName("Studio quotation"))
    await addLaptopLine(page, orderId, "2")
    await callReducerBff(page, "compute_so_totals", [orderId])

    const name = smokeName("Quotation layout")
    await gotoModule(page, "/documents?tab=document-templates", "documents")
    await selectModuleTab(page, "documents", "document-templates")
    await page.getByTestId("entity-action-design-document-template").click()
    const designer = page.getByRole("dialog", { name: "Design a template", exact: true })
    await designer.getByLabel("Template type", { exact: true }).selectOption("document")
    await designer.getByLabel("Start with", { exact: true }).selectOption("quotation")
    await designer.getByLabel("Name", { exact: true }).fill(name)
    await expect(designer.getByRole("button", { name: "Save template", exact: true })).toBeEnabled()
    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "create_document_template")),
      designer.getByRole("button", { name: "Save template", exact: true }).click(),
    ])
    expect(createResponse.ok()).toBe(true)
    await expect(designer).toBeHidden()
    const template = await savedTemplate(page, companyId, name)
    const templateId = scalarQueryId(template.id)
    expect(templateId).not.toBeNull()
    const templateProject = JSON.parse(template.metadata ?? "null")
    expect(templateProject.documentDesigner.kind).toBe("document")
    expect(JSON.stringify(templateProject)).toContain("{{quotation.line_items}}")

    const staff = await provisionActor(page, "quotation-author", [
      "module:sales:read", "module:documents:read",
      "company:read", "contact:read", "sale_order:read", "sale_order_line:read",
      "document_template:read", "document:read", "document:create", "document_version:read",
    ], companyId)
    await withActor(browser, staff, async (staffPage) => {
      await gotoModule(staffPage, "/sales?tab=orders", "sales")
      await selectModuleTab(staffPage, "sales", "orders")
      await selectEntityRowById(staffPage, orderId)
      await staffPage.getByTestId("entity-action-quotation-document").click()
      const dialog = staffPage.getByTestId("quotation-document-dialog")
      await dialog.getByLabel("Document layout", { exact: true }).selectOption(String(templateId))
      const previewPath = `/api/documents/quotations/${orderId}/preview`
      const [previewResponse] = await Promise.all([
        staffPage.waitForResponse((response) => new URL(response.url()).pathname === previewPath),
        dialog.getByRole("button", { name: "Preview quotation", exact: true }).click(),
      ])
      expect(previewResponse.ok(), await previewResponse.text()).toBe(true)
      const initial = await previewResponse.json() as QuotationDocumentPreview
      expect(initial.orderId).toBe(String(orderId))
      expect(initial.templateId).toBe(String(templateId))
      const frame = dialog.frameLocator('iframe[title="Quotation document preview"]')
      await expect(frame.getByRole("heading", { name: "Acme Corporation", exact: true })).toBeVisible()
      await expect(frame.locator(".quotation-lines tbody tr")).toHaveCount(1)
      await expect(frame.locator(".quotation-lines")).toContainText("Lumiere Dev Laptop")
      expect(await dialog.locator("iframe").getAttribute("sandbox")).toBe("")

      // A real concurrent author edit invalidates the exact reviewed revision.
      const changedName = `${name} revised`
      await renameTemplate(page, companyId, templateId!, changedName)
      const rejected = await staffPage.request.post(`/api/documents/quotations/${orderId}/generate`, {
        data: { companyId: String(companyId), templateId: String(templateId), expectedRevision: initial.revision },
      })
      expect(rejected.status()).toBe(409)

      const [refreshedResponse] = await Promise.all([
        staffPage.waitForResponse((response) => new URL(response.url()).pathname === previewPath),
        dialog.getByRole("button", { name: "Refresh preview", exact: true }).click(),
      ])
      expect(refreshedResponse.ok()).toBe(true)
      const refreshed = await refreshedResponse.json() as QuotationDocumentPreview
      expect(refreshed.revision).not.toBe(initial.revision)
      const [generatedResponse] = await Promise.all([
        staffPage.waitForResponse((response) => new URL(response.url()).pathname === `/api/documents/quotations/${orderId}/generate`, { timeout: 90_000 }),
        dialog.getByRole("button", { name: "Save quotation PDF", exact: true }).click(),
      ])
      expect(generatedResponse.ok(), await generatedResponse.text()).toBe(true)
      const generated = await generatedResponse.json() as GeneratedQuotationDocument
      expect(generated.revision).toBe(refreshed.revision)
      expect(generated.downloadUrl).toMatch(new RegExp(`^/api/documents/blobs/object/${organizationId}/`))
      await expect(dialog.getByText("The PDF is saved in Documents and attached to this quotation.", { exact: true })).toBeVisible()

      const download = await staffPage.request.get(generated.downloadUrl)
      expect(download.ok()).toBe(true)
      const bytes = await download.body()
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-")
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(generated.checksum)
      const documents = await staffPage.request.get(`/api/query/documents?companyId=${companyId}`)
      expect(documents.ok()).toBe(true)
      const document = ((await documents.json()) as { data: DocumentRow[] }).data.find((row) => String(row.id) === generated.documentId)
      expect(document).toBeDefined()
      expect(document!.resModel ?? document!.res_model).toBe("sale_order")
      expect(scalarQueryId(document!.resId ?? document!.res_id)).toBe(orderId)
      expect(document!.checksum).toBe(generated.checksum)
      const provenance = JSON.parse(document!.metadata ?? "null").generatedQuotation
      expect(provenance.revision).toBe(refreshed.revision)
      expect(provenance.templateId).toBe(String(templateId))
      expect(provenance.templateSnapshot.documentDesigner.kind).toBe("document")
      const versions = await staffPage.request.get(`/api/query/document-versions?companyId=${companyId}`)
      expect(versions.ok(), await versions.text()).toBe(true)
      const initialVersion = ((await versions.json()) as { data: DocumentVersionRow[] }).data.find((row) =>
        String(row.documentId ?? row.document_id) === generated.documentId &&
        (row.versionNumber ?? row.version_number) === 1)
      expect(initialVersion).toBeDefined()
      expect(initialVersion!.checksum).toBe(generated.checksum)
      expect(JSON.parse(initialVersion!.metadata ?? "null").generatedQuotation).toEqual(provenance)

      await renameTemplate(page, companyId, templateId!, `${name} after export`)
      await staffPage.reload()
      const originalDownload = await staffPage.request.get(generated.downloadUrl)
      expect(originalDownload.ok()).toBe(true)
      expect(createHash("sha256").update(await originalDownload.body()).digest("hex")).toBe(generated.checksum)
      const savedVersions = await staffPage.request.get(`/api/query/document-versions?companyId=${companyId}`)
      expect(savedVersions.ok()).toBe(true)
      const preservedVersion = ((await savedVersions.json()) as { data: DocumentVersionRow[] }).data.find((row) =>
        String(row.documentId ?? row.document_id) === generated.documentId &&
        (row.versionNumber ?? row.version_number) === 1)
      expect(preservedVersion?.metadata).toBe(initialVersion!.metadata)
      // Caller remains an ordinary staff actor and cannot modify template definitions.
      const update = stdbBffCommandPost("update_document_template", { companyId, templateId: templateId!, params: stdbParamsToJson({ isActive: false }, "UpdateDocumentTemplateParams") })
      const denied = await staffPage.request.post(update.urlPath, { headers: { "Content-Type": "application/json" }, data: update.init.body as string })
      expect(denied.ok()).toBe(false)
    })
  })
})

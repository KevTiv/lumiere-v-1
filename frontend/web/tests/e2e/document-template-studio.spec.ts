import { chooseSelectOptionByTriggerValue } from "./helpers-legacy"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { DocumentTemplateRow } from "@lumiere/query-hooks/hooks/templates"

import {
  fetchDefaultCompanyId,
  fillField,
  gotoModule,
  openEntityCreate,
  reloadSettled,
  scalarQueryId,
  selectEntityRowById,
  selectModuleTab,
  smokeName,
  submitForm,
} from "./helpers"
import { postGeneratedOperation, postGeneratedOperationOk } from "./generated-operation"
import { matchesOperationResponse } from "./operation-response"
import { provisionActor, withActor } from "./pretenant-support"

// Provisioned actors have ordinary company-bound memberships, never the seeded
// administrator's authority. No route mocks, editor-instance injection or skips.
const BUSINESS_READ = [
  "module:documents:read", "module:crm:read", "company:read",
  "form_config:read", "form_config_field:read", "form_role_config:read",
  "document_template:read", "contact:read", "contact:create", "contact:write",
]
const TEMPLATE_AUTHOR = [...BUSINESS_READ, "document_template:create", "document_template:write"]

type ContactRow = { id: number | string; name?: string; description?: string | null; companyId?: number | string | null; company_id?: number | string | null }
type CompanyRow = { id: number | string; name?: string; currencyId?: number | string; currency_id?: number | string }

async function queryRows<T>(page: Page, path: string): Promise<T[]> {
  const response = await page.request.get(path)
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true)
  const result = await response.json() as { data?: T[] }
  expect(Array.isArray(result.data), `${path} must return data rows`).toBe(true)
  return result.data!
}

async function templates(page: Page): Promise<DocumentTemplateRow[]> {
  return queryRows<DocumentTemplateRow>(page, "/api/query/document-templates")
}

function templateBody(row: DocumentTemplateRow): string {
  return row.bodyHtml ?? row.body_html ?? ""
}

function templateActive(row: DocumentTemplateRow): boolean {
  return row.isActive ?? row.is_active ?? false
}

function templateCompany(row: DocumentTemplateRow): number | null {
  const value = row.companyId !== undefined ? row.companyId : row.company_id
  if (value === null) return null
  const companyId = scalarQueryId(value)
  if (companyId === null) throw new Error("Template returned without an explicit company scope")
  return companyId
}

async function templateNamed(page: Page, name: string): Promise<DocumentTemplateRow> {
  await expect.poll(async () => (await templates(page)).filter((row) => row.name === name).length, { timeout: 30_000 }).toBe(1)
  const row = (await templates(page)).find((item) => item.name === name)
  if (!row) throw new Error(`Template disappeared: ${name}`)
  return row
}

async function templateById(page: Page, id: number | string): Promise<DocumentTemplateRow> {
  const row = (await templates(page)).find((item) => String(item.id) === String(id))
  if (!row) throw new Error(`Template not available in this session: ${id}`)
  return row
}

async function assertOrdinarySession(page: Page, identity: string, canWriteTemplates: boolean) {
  const response = await page.request.get("/api/session/field-access")
  expect(response.ok(), await response.text()).toBe(true)
  const access = await response.json() as {
    identityHex: string
    fieldAccess: { isSuperuser: boolean; rolePermissions: string[] }
  }
  expect(access.identityHex.replace(/^0x/i, "")).toBe(identity)
  expect(access.fieldAccess.isSuperuser).toBe(false)
  expect(access.fieldAccess.rolePermissions).not.toContain("*:*")
  expect(access.fieldAccess.rolePermissions.includes("document_template:write")).toBe(canWriteTemplates)
}

async function openTemplates(page: Page): Promise<Locator> {
  await gotoModule(page, "/documents?tab=document-templates", "documents")
  await selectModuleTab(page, "documents", "document-templates")
  const panel = page.getByTestId("module-panel-documents-document-templates")
  await expect(panel.getByRole("textbox", { name: "Search records", exact: true })).toBeVisible()
  return panel
}

async function chooseTemplate(page: Page, row: DocumentTemplateRow): Promise<Locator> {
  const panel = page.getByTestId("module-panel-documents-document-templates")
  await panel.getByRole("textbox", { name: "Search records", exact: true }).fill(row.name ?? "")
  await selectEntityRowById(page, row.id)
  return panel
}

async function saveDesigner(page: Page, dialog: Locator, button: string, operation: "create_document_template" | "update_document_template") {
  const saved = page.waitForResponse((response) => matchesOperationResponse(response, operation), { timeout: 30_000 })
  await dialog.getByRole("button", { name: button, exact: true }).click()
  const response = await saved
  expect(response.ok(), await response.text()).toBe(true)
  await expect(dialog).toBeHidden({ timeout: 20_000 })
}

async function editCanvasHeading(page: Page, dialog: Locator, text: string) {
  await expect(dialog.getByTestId("document-template-designer")).toHaveAttribute("data-ready", "true")
  const canvas = page.frameLocator('iframe[title="Template design canvas"]')
  await canvas.locator("h2").first().click()
  const editText = dialog.getByRole("button", { name: "Edit text", exact: true })
  await expect(editText).toBeEnabled()
  await editText.click()
  const editable = canvas.getByRole("textbox", { name: "Editing selected block text", exact: true })
  await expect(editable).toBeEditable()
  await editable.fill(text)
  await editable.press("Escape")
  await expect(canvas.locator("h2").first()).toHaveText(text)
}

async function setTemplateActive(page: Page, row: DocumentTemplateRow, active: boolean) {
  const panel = await chooseTemplate(page, row)
  const response = page.waitForResponse((result) => matchesOperationResponse(result, "update_document_template"), { timeout: 30_000 })
  await panel.getByTestId(`entity-action-${active ? "reactivate" : "deactivate"}-document-template`).click()
  if (!active) {
    const confirm = page.getByTestId("entity-action-confirm")
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "Deactivate", exact: true }).click()
  }
  const result = await response
  expect(result.ok(), await result.text()).toBe(true)
  await expect.poll(async () => templateActive(await templateById(page, row.id))).toBe(active)
}

async function openContactEditor(page: Page): Promise<Locator> {
  await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
  const modal = page.getByTestId("form-modal-new-contact")
  await expect(modal.getByTestId("form-field-description")).toHaveAttribute("contenteditable", "true")
  return modal
}

async function reloadContactDescription(page: Page, contact: ContactRow): Promise<Locator> {
  await reloadSettled(page)
  await selectModuleTab(page, "crm", "contacts")
  await page.getByTestId("module-panel-crm-contacts").getByRole("textbox", { name: "Search records", exact: true }).fill(contact.name ?? "")
  await selectEntityRowById(page, contact.id)
  await page.getByTestId("entity-action-edit-contact-details").click()
  const editor = page.getByTestId("form-modal-edit-contact-details").getByTestId("form-field-description")
  await expect(editor).toHaveAttribute("contenteditable", "true")
  return editor
}

async function openTemplatePicker(page: Page, modal: Locator, search: string) {
  await modal.getByRole("button", { name: "Insert text template", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search text templates", exact: true }).fill(search)
}

function fixtureTemplate(name: string) {
  return {
    name, model: "document", reportType: "lumiere-rich-text-template-v1", bodyHtml: `<p>${name}</p>`,
    isDefault: false, isActive: true,
    metadata: JSON.stringify({ documentDesigner: {
      schemaVersion: 1, engine: "grapesjs", kind: "rich-text",
      project: { assets: [], styles: [], pages: [{ frames: [{ component: {
        type: "wrapper", components: [{ type: "text", tagName: "p", content: name }],
      } }] }] },
    } }),
  }
}

test.describe("Document template studio", { tag: ["@p0", "@document-templates"] }, () => {
  // Bound individual actions so a blocked control retains its locator/call log.
  test.use({ actionTimeout: 30_000, navigationTimeout: 45_000 })

  test("ordinary staff author, manage and reuse formatted text in a persisted CRM modal", async ({ browser, page: owner }) => {
    test.setTimeout(300_000)
    const companyId = await fetchDefaultCompanyId(owner)
    const author = await provisionActor(owner, "template-author", TEMPLATE_AUTHOR, companyId)
    const name = smokeName("studio-text")
    const heading = `Project scope ${name}`
    const editedHeading = `Agreed scope ${name}`
    const editedName = `${name} edited`
    const copyName = `${name} duplicate`
    const contactName = smokeName("template-customer")
    const customerNote = `Customer-specific note ${contactName}`
    const followupNote = `Updated after reopening ${contactName}`

    await withActor(browser, author, async (page) => {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await assertOrdinarySession(page, author.identityHex, true)
      const panel = await openTemplates(page)
      await panel.getByTestId("entity-action-design-document-template").click()
      let dialog = page.getByRole("dialog", { name: "Design a template", exact: true })
      await expect(dialog.getByTestId("document-template-designer")).toBeVisible()
      await dialog.getByLabel("Name", { exact: true }).fill(name)
      await chooseSelectOptionByTriggerValue(
        page,
        dialog.getByLabel("Start with", { exact: true }),
        "scope",
      )
      const canvas = page.frameLocator('iframe[title="Template design canvas"]')
      await expect(canvas.locator("h2")).toHaveText("Scope of work")
      await expect(canvas.locator("ul li")).toHaveCount(3)
      await editCanvasHeading(page, dialog, heading)
      await dialog.getByRole("button", { name: "Table", exact: true }).click()
      await expect(canvas.locator("table")).toHaveCount(1)
      await saveDesigner(page, dialog, "Save template", "create_document_template")

      const created = await templateNamed(page, name)
      expect(templateCompany(created)).toBe(companyId)
      expect(templateActive(created)).toBe(true)
      expect(templateBody(created)).toContain(`<h2>${heading}</h2>`)
      expect(templateBody(created)).toContain("<ul>")
      expect(templateBody(created)).toContain("<table>")
      const metadata = JSON.parse(created.metadata ?? "null") as { documentDesigner?: { engine?: string; kind?: string; schemaVersion?: number } }
      expect(metadata.documentDesigner).toMatchObject({ engine: "grapesjs", kind: "rich-text", schemaVersion: 1 })

      await reloadSettled(page)
      await selectModuleTab(page, "documents", "document-templates")
      await chooseTemplate(page, created)
      await page.getByTestId("entity-action-edit-document-template").click()
      dialog = page.getByRole("dialog", { name: "Edit template", exact: true })
      await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(name)
      await expect(page.frameLocator('iframe[title="Template design canvas"]').locator("h2")).toHaveText(heading)
      await expect(page.frameLocator('iframe[title="Template design canvas"]').locator("table")).toHaveCount(1)
      await dialog.getByLabel("Name", { exact: true }).fill(editedName)
      await editCanvasHeading(page, dialog, editedHeading)
      await saveDesigner(page, dialog, "Save changes", "update_document_template")
      const edited = await templateNamed(page, editedName)
      expect(String(edited.id)).toBe(String(created.id))
      expect(templateBody(edited)).toContain(editedHeading)
      expect(edited.metadata).not.toBe(created.metadata)

      await chooseTemplate(page, edited)
      await page.getByTestId("entity-action-duplicate-document-template").click()
      dialog = page.getByRole("dialog", { name: "Customize a template copy", exact: true })
      await expect(page.frameLocator('iframe[title="Template design canvas"]').locator("h2")).toHaveText(editedHeading)
      await dialog.getByLabel("Name", { exact: true }).fill(copyName)
      await saveDesigner(page, dialog, "Save template copy", "create_document_template")
      const copy = await templateNamed(page, copyName)
      expect(String(copy.id)).not.toBe(String(edited.id))
      expect(templateBody(copy)).toBe(templateBody(edited))
      expect((await templateById(page, edited.id)).metadata).toBe(edited.metadata)

      await setTemplateActive(page, edited, false)
      const inactive = await templateById(page, edited.id)
      expect(inactive.metadata).toBe(edited.metadata)
      expect(templateBody(inactive)).toBe(templateBody(edited))
      let contactModal = await openContactEditor(page)
      await openTemplatePicker(page, contactModal, name)
      await expect(page.getByRole("button", { name: `Insert ${copyName}`, exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: `Insert ${editedName}`, exact: true })).toHaveCount(0)
      await page.keyboard.press("Escape")
      await contactModal.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(contactModal).toBeHidden()

      await openTemplates(page)
      await setTemplateActive(page, edited, true)
      contactModal = await openContactEditor(page)
      await fillField(contactModal, "name", contactName)
      await fillField(contactModal, "email", `${contactName}@example.test`)
      await openTemplatePicker(page, contactModal, editedName)
      await page.getByRole("button", { name: `Insert ${editedName}`, exact: true }).click()
      const editor = contactModal.getByTestId("form-field-description")
      await expect(editor.locator("h2")).toHaveText(editedHeading)
      await expect(editor.locator("ul li")).toHaveCount(3)
      await expect(editor.locator("table")).toHaveCount(1)
      await editor.locator("p").filter({ hasText: "Describe the agreed objectives" }).click()
      await page.keyboard.press("End")
      await page.keyboard.insertText(` ${customerNote}`)
      await expect(editor).toContainText(customerNote)
      const createdContact = page.waitForResponse((response) => matchesOperationResponse(response, "create_contact"), { timeout: 30_000 })
      await submitForm(page, "new-contact")
      const contactResponse = await createdContact
      expect(contactResponse.ok(), await contactResponse.text()).toBe(true)
      await expect.poll(async () => (await queryRows<ContactRow>(page, "/api/query/contacts")).filter((row) => row.name === contactName).length).toBe(1)
      const contact = (await queryRows<ContactRow>(page, "/api/query/contacts")).find((row) => row.name === contactName)
      if (!contact) throw new Error("Created contact did not persist")
      expect(scalarQueryId(contact.companyId ?? contact.company_id)).toBe(companyId)
      expect(contact.description).toContain(`## ${editedHeading}`)
      expect(contact.description).toMatch(/[-*] Deliverables and acceptance criteria/)
      expect(contact.description).toMatch(/\|\s*Item\s*\|\s*Details\s*\|/)
      expect(contact.description).toContain(customerNote)

      let reopened = await reloadContactDescription(page, contact)
      await expect(reopened.locator("h2")).toHaveText(editedHeading)
      await expect(reopened.locator("ul li")).toHaveCount(3)
      await expect(reopened.locator("table")).toHaveCount(1)
      await expect(reopened).toContainText(customerNote)
      await reopened.locator("p").filter({ hasText: customerNote }).click()
      await page.keyboard.press("End")
      await page.keyboard.insertText(` ${followupNote}`)
      const updatedContact = page.waitForResponse((response) => matchesOperationResponse(response, "update_contact_details"), { timeout: 30_000 })
      await Promise.all([
        submitForm(page, "edit-contact-details"),
        updatedContact.then(async (response) => {
          expect(response.ok(), await response.text()).toBe(true)
        }),
      ])
      await expect.poll(async () => (await queryRows<ContactRow>(page, "/api/query/contacts")).find((row) => String(row.id) === String(contact.id))?.description).toContain(followupNote)
      reopened = await reloadContactDescription(page, contact)
      await expect(reopened.locator("h2")).toHaveText(editedHeading)
      await expect(reopened.locator("ul li")).toHaveCount(3)
      await expect(reopened.locator("table")).toHaveCount(1)
      await expect(reopened).toContainText(customerNote)
      await expect(reopened).toContainText(followupNote)
      // Applying and editing a template changes the business record, not the saved template.
      expect(templateBody(await templateById(page, edited.id))).toBe(templateBody(edited))
      expect((await templateById(page, edited.id)).metadata).toBe(edited.metadata)
    })
  })

  test("read-only template users can reuse content while write and foreign-company operations are denied", async ({ browser, page: owner }) => {
    test.setTimeout(240_000)
    const companyId = await fetchDefaultCompanyId(owner)
    const companies = await queryRows<CompanyRow>(owner, "/api/query/companies")
    const primary = companies.find((row) => scalarQueryId(row.id) === companyId)
    const currencyId = scalarQueryId(primary?.currencyId ?? primary?.currency_id)
    if (currencyId === null) throw new Error("Fixture company currency is missing")
    const label = smokeName("template-access")
    const companyName = `${label} company B`
    await postGeneratedOperationOk(owner, "create_company", { params: stdbParamsToJson({
      name: companyName, code: `TC${label.slice(-8)}`, currencyId,
      fiscalYearEndMonth: 12, fiscalYearEndDay: 31, isParent: false,
    }, "CreateCompanyParams") })
    const foreignCompany = (await queryRows<CompanyRow>(owner, "/api/query/companies")).find((row) => row.name === companyName)
    const foreignCompanyId = scalarQueryId(foreignCompany?.id)
    if (foreignCompanyId === null) throw new Error("Isolated second company was not created")
    const author = await provisionActor(owner, "template-access-author", TEMPLATE_AUTHOR, companyId)
    const reader = await provisionActor(owner, "template-access-reader", BUSINESS_READ, companyId)
    const otherAuthor = await provisionActor(owner, "template-company-b", TEMPLATE_AUTHOR, foreignCompanyId)
    const ownName = `${label} own`
    const foreignName = `${label} foreign`
    await withActor(browser, otherAuthor, async (page) => {
      await assertOrdinarySession(page, otherAuthor.identityHex, true)
      await postGeneratedOperationOk(page, "create_document_template", { companyId: foreignCompanyId, params: stdbParamsToJson(fixtureTemplate(foreignName), "CreateDocumentTemplateParams") })
    })
    const foreign = await templateNamed(owner, foreignName)
    let ownId: number | string = 0
    await withActor(browser, author, async (page) => {
      await assertOrdinarySession(page, author.identityHex, true)
      await postGeneratedOperationOk(page, "create_document_template", { companyId, params: stdbParamsToJson(fixtureTemplate(ownName), "CreateDocumentTemplateParams") })
      ownId = (await templateNamed(page, ownName)).id
      const visible = await templates(page)
      expect(visible.some((row) => row.name === ownName)).toBe(true)
      expect(visible.some((row) => row.name === foreignName)).toBe(false)
      const denied = await postGeneratedOperation(page, "update_document_template", {
        templateId: foreign.id, companyId: foreignCompanyId,
        params: stdbParamsToJson({ isActive: false }, "UpdateDocumentTemplateParams"),
      })
      expect(denied.status, denied.error).toBe(403)
      expect(denied.ok).toBe(false)
      const foreignRead = await page.request.get(`/api/query/document-templates?companyId=${foreignCompanyId}`)
      expect(foreignRead.status(), await foreignRead.text()).toBe(403)
    })
    expect(ownId).not.toBe(0)
    const before = await templateById(owner, ownId)
    await withActor(browser, reader, async (page) => {
      await assertOrdinarySession(page, reader.identityHex, false)
      const denied = await postGeneratedOperation(page, "update_document_template", {
        templateId: ownId, companyId,
        params: stdbParamsToJson({ bodyHtml: "<p>Denied edit</p>", isActive: false }, "UpdateDocumentTemplateParams"),
      })
      expect(denied.status, denied.error).toBe(403)
      expect(denied.ok).toBe(false)
      const deniedCreate = await postGeneratedOperation(page, "create_document_template", {
        companyId, params: stdbParamsToJson(fixtureTemplate(`${label} denied`), "CreateDocumentTemplateParams"),
      })
      expect(deniedCreate.status, deniedCreate.error).toBe(403)
      const panel = await openTemplates(page)
      await chooseTemplate(page, before)
      for (const action of ["design", "edit", "duplicate", "deactivate", "reactivate"]) {
        await expect(panel.getByTestId(`entity-action-${action}-document-template`)).toHaveCount(0)
      }
      const modal = await openContactEditor(page)
      await openTemplatePicker(page, modal, label)
      await expect(page.getByRole("button", { name: `Insert ${ownName}`, exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: `Insert ${foreignName}`, exact: true })).toHaveCount(0)
      await page.getByRole("button", { name: `Insert ${ownName}`, exact: true }).click()
      await expect(modal.getByTestId("form-field-description")).toContainText(ownName)
    })
    const after = await templateById(owner, ownId)
    expect(templateActive(after)).toBe(true)
    expect(templateBody(after)).toBe(templateBody(before))
    expect(after.metadata).toBe(before.metadata)
    expect(templateActive(await templateById(owner, foreign.id))).toBe(true)
    expect((await templates(owner)).some((row) => row.name === `${label} denied`)).toBe(false)
  })
})

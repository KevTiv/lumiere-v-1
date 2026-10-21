import { expect, test, type Page } from "@playwright/test"
import {
  chooseSelectOptionByTriggerValue,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  selectModuleTab,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

interface ReportTemplateRow {
  readonly id?: unknown
  readonly name?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly orientation?: unknown
  readonly paperFormat?: unknown
  readonly paper_format?: unknown
  readonly templateContent?: unknown
  readonly template_content?: unknown
}

interface SavedLayout {
  readonly id: number
  readonly organizationId: number
  readonly companyId: number
  readonly orientation: string
  readonly paperFormat: string | null
  readonly templateContent: string | null
}

async function templateRows(page: Page): Promise<ReportTemplateRow[]> {
  const response = await page.request.get("/api/query/report-templates")
  if (!response.ok()) throw new Error(`report template query failed: ${response.status()}`)
  const body = (await response.json()) as { data?: ReportTemplateRow[] }
  if (!Array.isArray(body.data)) throw new Error("report template query returned no row collection")
  return body.data
}

function requiredId(value: unknown, label: string): number {
  const id = scalarQueryId(value)
  if (id == null || !Number.isSafeInteger(id) || id <= 0)
    throw new Error(`${label} has no exact positive ID`)
  return id
}

function nullableString(value: unknown, label: string): string | null {
  if (value == null) return null
  if (typeof value !== "string") throw new Error(`${label} is not an authorized saved string`)
  return value
}

function layoutSnapshot(row: ReportTemplateRow): SavedLayout {
  if (
    typeof row.orientation !== "string" ||
    (!("paperFormat" in row) && !("paper_format" in row)) ||
    (!("templateContent" in row) && !("template_content" in row))
  ) {
    throw new Error("exact template layout fields are unavailable for safe editing and restoration")
  }
  return {
    id: requiredId(row.id, "template"),
    organizationId: requiredId(row.organizationId ?? row.organization_id, "template organization"),
    companyId: requiredId(row.companyId ?? row.company_id, "template company"),
    orientation: row.orientation,
    paperFormat: nullableString(row.paperFormat ?? row.paper_format, "template paper format"),
    templateContent: nullableString(
      row.templateContent ?? row.template_content,
      "template content",
    ),
  }
}

async function savedLayout(page: Page, original: SavedLayout): Promise<SavedLayout> {
  const matches = (await templateRows(page)).filter((row) => scalarQueryId(row.id) === original.id)
  expect(matches, `template ${original.id} must retain one exact identity`).toHaveLength(1)
  const saved = layoutSnapshot(matches[0]!)
  expect(saved.organizationId).toBe(original.organizationId)
  expect(saved.companyId).toBe(original.companyId)
  return saved
}

async function openExactEditor(page: Page, templateId: number) {
  await selectModuleTab(page, "reports", "report-templates")
  const row = page.getByTestId(`entity-row-${templateId}`)
  await expect(row).toContainText("Seed Sales Summary")
  if ((await row.getAttribute("data-state")) !== "selected") await row.click()
  await page.getByTestId("entity-action-edit-tpl").click()
  const modal = page.getByTestId("form-modal-update-report-template")
  await expect(modal.getByTestId("template-layout-editor")).toBeVisible()
  return modal
}

async function revealMarkup(page: Page) {
  const markup = page.getByTestId("template-markup")
  if (!(await markup.isVisible())) {
    await page
      .getByTestId("template-layout-editor")
      .getByRole("button", { name: "Edit markup", exact: true })
      .click()
  }
  await expect(markup).toBeVisible()
  return markup
}

async function closeDraftIfOpen(page: Page) {
  const replacement = page.getByRole("alertdialog", {
    name: "Replace existing markup?",
    exact: true,
  })
  if (await replacement.isVisible())
    await replacement.getByRole("button", { name: "Cancel", exact: true }).click()
  const modal = page.getByTestId("form-modal-update-report-template")
  if (!(await modal.isVisible())) return
  await modal.getByRole("button", { name: "Cancel", exact: true }).click()
  const discard = page.getByTestId("discard-changes-dialog")
  if (await discard.isVisible()) await page.getByTestId("discard-changes-confirm").click()
  await expect(modal).toBeHidden()
}

async function saveThroughEditor(page: Page, expected: SavedLayout, requireOperation = true) {
  const modal = page.getByTestId("form-modal-update-report-template")
  const submit = modal.getByRole("button", { name: "Save template layout", exact: true })
  await expect(submit).toBeEnabled()
  if (requireOperation) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) => matchesOperationResponse(candidate, "update_report_template"),
        { timeout: 30_000 },
      ),
      submit.click(),
    ])
    expect(response.ok()).toBe(true)
  } else {
    // Canonical preflight can resolve an already restored layout without dispatch.
    await submit.click()
  }
  await expect.poll(() => savedLayout(page, expected)).toEqual(expected)
  await expect(modal).toBeHidden()
}

test.describe(
  "Finance saved report layout tools",
  { tag: ["@dev-fixture", "@finance-tools"] },
  () => {
    test("saves sections on the exact seed template, reloads them, and restores its original layout through the UI", async ({
      page,
    }) => {
      test.setTimeout(240_000)
      const organizationId = await fetchSessionOrganizationId(page)
      const companyId = await fetchDefaultCompanyId(page)
      // Capture the original full query row before opening any editor. Names identify only
      // this documented seed fixture; every read and write below uses its exact saved ID.
      const seeds = (await templateRows(page)).filter(
        (row) =>
          row.name === "Seed Sales Summary" &&
          scalarQueryId(row.organizationId ?? row.organization_id) === organizationId &&
          scalarQueryId(row.companyId ?? row.company_id) === companyId,
      )
      expect(seeds, "one scoped Seed Sales Summary fixture is required").toHaveLength(1)
      const originalRow = seeds[0]!
      const original = layoutSnapshot(originalRow)
      expect(["Portrait", "Landscape"]).toContain(original.orientation)
      const heading = smokeName("Saved finance layout")
      const orientation = original.orientation === "Portrait" ? "Landscape" : "Portrait"
      const paperFormat = original.paperFormat === "Letter" ? "A3" : "Letter"

      try {
        await gotoModule(page, "/reports?tab=report-templates", "reports")
        const modal = await openExactEditor(page, original.id)
        const editor = modal.getByTestId("template-layout-editor")
        const markup = await revealMarkup(page)
        await expect(markup).toHaveValue(original.templateContent ?? "")
        // The default seed is legacy HTML. If this isolated fixture was edited earlier,
        // use a local legacy draft while keeping its actual saved fields for restoration.
        const legacy =
          original.templateContent && !original.templateContent.startsWith("<!--lumiere-layout-v1:")
            ? original.templateContent
            : "<h1>Legacy draft before explicit replacement</h1><p>{{original_binding}}</p>"
        if ((await markup.inputValue()) !== legacy) await markup.fill(legacy)
        await editor.getByRole("button", { name: "Build with sections", exact: true }).click()
        const replace = page.getByRole("alertdialog", {
          name: "Replace existing markup?",
          exact: true,
        })
        await expect(replace).toBeVisible()
        expect(await savedLayout(page, original)).toEqual(original)
        await replace.getByRole("button", { name: "Cancel", exact: true }).click()
        await expect(markup).toHaveValue(legacy)
        expect(await savedLayout(page, original)).toEqual(original)
        await editor.getByRole("button", { name: "Build with sections", exact: true }).click()
        await replace.getByRole("button", { name: "Start section layout", exact: true }).click()
        await expect(modal.getByTestId("template-section-0")).toHaveCount(0)
        await editor.getByRole("button", { name: "Add heading", exact: true }).click()
        await modal.getByTestId("template-section-text-0").fill(heading)
        await editor.getByRole("button", { name: "Add document table", exact: true }).click()
        await chooseSelectOptionByTriggerValue(
          page,
          modal.getByTestId("form-field-orientation"),
          orientation,
        )
        await modal.getByTestId("form-field-paperFormat").fill(paperFormat)
        const preview = page.frameLocator('iframe[title="Report template layout preview"]')
        await expect(preview.getByRole("heading", { name: heading, exact: true })).toBeVisible()
        await expect(preview.getByRole("cell", { name: "INV-EXAMPLE", exact: true })).toBeVisible()
        const content = await (await revealMarkup(page)).inputValue()
        expect(content).toContain("<tbody></tbody>")
        for (const example of ["INV-EXAMPLE", "Example customer", "125.00"])
          expect(content).not.toContain(example)
        const desired: SavedLayout = {
          ...original,
          orientation,
          paperFormat,
          templateContent: content,
        }
        await saveThroughEditor(page, desired)
        const persisted = await savedLayout(page, original)
        expect(persisted).toEqual(desired)
        for (const example of ["INV-EXAMPLE", "Example customer", "125.00"])
          expect(persisted.templateContent).not.toContain(example)

        await page.reload()
        await expect(page.getByTestId("module-view-reports")).toHaveAttribute(
          "data-hydrated",
          "true",
        )
        const reopened = await openExactEditor(page, original.id)
        await expect(reopened.getByTestId("template-section-text-0")).toHaveValue(heading)
        await expect(reopened.getByTestId("template-section-1")).toContainText("table")
        await expect(reopened.getByTestId("form-field-paperFormat")).toHaveValue(paperFormat)
        await expect(await revealMarkup(page)).toHaveValue(content)
        expect(await savedLayout(page, original)).toEqual(desired)
        await page.screenshot({
          path: test.info().outputPath("report-template-saved-sections.png"),
          fullPage: true,
        })
      } finally {
        // Restore through the same operator path even if an assertion or readback failed.
        // No direct operation, reducer, or query mutation is used for cleanup.
        await closeDraftIfOpen(page)
        await gotoModule(page, "/reports?tab=report-templates", "reports")
        const restore = await openExactEditor(page, original.id)
        const beforeRestore = await savedLayout(page, original)
        await chooseSelectOptionByTriggerValue(
          page,
          restore.getByTestId("form-field-orientation"),
          original.orientation,
        )
        await restore.getByTestId("form-field-paperFormat").fill(original.paperFormat ?? "")
        await (await revealMarkup(page)).fill(original.templateContent ?? "")
        await saveThroughEditor(
          page,
          original,
          JSON.stringify(beforeRestore) !== JSON.stringify(original),
        )
        expect(await savedLayout(page, original)).toEqual(original)
      }
    })
  },
)

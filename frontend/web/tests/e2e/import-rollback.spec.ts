import { matchesTypedOperationResponse } from "./operation-response"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import {
  expectNoAppError,
  expectRecordAbsentFromQuery,
  fetchContactIdByName,
  gotoModule,
  smokeName,
  waitForImportJobRollbackReady,
} from "./helpers"

async function mockContactImportAssistantAi(page: Page, contactName: string, email: string) {
  await page.route("**/api/ai/import/analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        target_entity: "contact",
        mappings: [
          { source_column: "name", target_field: "name", confidence: 1, required: true },
          { source_column: "email", target_field: "email", confidence: 1, required: false },
        ],
        unmapped_source_columns: [],
        unmapped_target_fields: [],
        metadata_suggestions: [],
        structure: {
          column_count: 2,
          sample_row_count: 1,
          duplicate_headers: [],
          empty_columns: [],
          delimiter_hint: ",",
        },
        safety: { findings: [], blocked_cell_count: 0, is_safe_for_ai: true },
        warnings: [],
        bundle: null,
      }),
    })
  })

  await page.route("**/api/ai/import/preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        target_entity: "contact",
        rows: [{ name: contactName, email }],
        validation_errors: [],
        safety: { findings: [], blocked_cell_count: 0, is_safe_for_ai: true },
        warnings: [],
      }),
    })
  })
}

async function writeContactImportCsv(contactName: string, email: string): Promise<string> {
  const csvPath = path.join(os.tmpdir(), `lumiere-import-rollback-${Date.now()}.csv`)
  fs.writeFileSync(csvPath, `name,email\n${contactName},${email}\n`, "utf8")
  return csvPath
}

test.describe("Import rollback", { tag: ["@phase-4", "@import"] }, () => {
  test("imports contacts then rolls back via import assistant UI", async ({ page }) => {
    test.setTimeout(180_000)

    const contactName = smokeName("import-rollback")
    const email = `${contactName}@example.test`
    const csvPath = await writeContactImportCsv(contactName, email)

    await mockContactImportAssistantAi(page, contactName, email)

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-contacts").click()
    await page.getByTestId("entity-action-csv-contacts").click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await dialog.locator("#import-assistant-file").setInputFiles(csvPath)
    await dialog.getByRole("button", { name: /^Analyze columns$/i }).click()
    await expect(dialog.getByText("name").first()).toBeVisible({ timeout: 30_000 })
    await dialog.getByRole("button", { name: /^Preview import$/i }).click()
    await expect(dialog.getByText(/Preview looks good/i)).toBeVisible({ timeout: 30_000 })

    const [importRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "import_contact_csv") && res.ok(),
        { timeout: 60_000 },
      ),
      dialog.getByRole("button", { name: /^Confirm import$/i }).click(),
    ])
    expect(importRes.ok()).toBe(true)

    await fetchContactIdByName(page, contactName)
    await waitForImportJobRollbackReady(page, "contact")

    const rollbackBtn = dialog.getByRole("button", { name: /^Rollback import$/i })
    await expect(rollbackBtn).toBeVisible({ timeout: 30_000 })

    const [rollbackRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "rollback_import_job") && res.ok(),
        { timeout: 60_000 },
      ),
      dialog.getByRole("button", { name: /^Rollback import$/i }).click(),
    ])
    expect(rollbackRes.ok()).toBe(true)

    await expect(dialog.getByText(/rolled back/i)).toBeVisible({ timeout: 30_000 })
    await expectRecordAbsentFromQuery(page, "/api/query/contacts", (row) => {
      const rowName = String(row.name ?? row.displayName ?? row.display_name ?? "")
      return rowName === contactName
    })
    await expectNoAppError(page)
  })
})

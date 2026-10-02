import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { expect, test, type Page, type Request } from "@playwright/test"

import {
  expectNoAppError,
  fetchSessionOrganizationId,
  gotoModule,
  openFormConfigLeadForm,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-22 — see docs/plan/erp-cov22-form-publish-import-commit-status.md.
// Needs the first-org fixture personas (fixture.reader@example.test) and an HR seed
// with an employee and a payroll structure.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type Row = Record<string, unknown>

async function queryRows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function formSnapshot(page: Page, organizationId: number) {
  const rows = (await queryRows(page, "form-configs")).filter(
    (row) =>
      scalarQueryId(row.organizationId ?? row.organization_id) === organizationId &&
      String(row.moduleId ?? row.module_id) === "crm" &&
      String(row.formId ?? row.form_id) === "new-lead",
  )
  if (rows.length > 1) throw new Error(`expected at most one crm/new-lead config, found ${rows.length}`)
  const row = rows[0]
  return row
    ? {
        id: scalarQueryId(row.id),
        isActive: (row.isActive ?? row.is_active) === true,
        configVersion: Number(row.configVersion ?? row.config_version),
      }
    : null
}

async function payslipImportSnapshot(page: Page, organizationId: number, name: string) {
  const slips = (await queryRows(page, "payslips")).filter(
    (row) => scalarQueryId(row.organizationId ?? row.organization_id) === organizationId && row.name === name,
  )
  const jobs = (await queryRows(page, "import-jobs")).filter(
    (row) =>
      scalarQueryId(row.organizationId ?? row.organization_id) === organizationId &&
      String(row.tableName ?? row.table_name) === "hr_payslip",
  )
  return { payslips: slips.length, jobs: jobs.length }
}

/** Re-post a captured operation request, optionally mutated. */
async function replay(page: Page, request: Request, mutate?: (body: Record<string, unknown>) => void) {
  const url = new URL(request.url())
  const body = JSON.parse(JSON.stringify(request.postDataJSON())) as Record<string, unknown>
  mutate?.(body)
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: body,
  })
}

async function firstId(page: Page, resource: string): Promise<number> {
  const id = scalarQueryId((await queryRows(page, resource))[0]?.id)
  if (!id) throw new Error(`no ${resource} row in session`)
  return id
}

test.describe("COV-22 form publish and idempotent import commit", { tag: ["@cov22"] }, () => {
  test("publishes one form through the UI; a stale replay is rejected and a reader is denied", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    await openFormConfigLeadForm(page)
    const push = page.getByTestId("form-config-push-registry")
    test.skip(
      !(await push.isVisible({ timeout: 10_000 }).catch(() => false)),
      "crm/new-lead is already published in this org; the push action only exists before first publish",
    )
    const organizationId = await fetchSessionOrganizationId(page)
    expect(await formSnapshot(page, organizationId)).toBeNull()

    const [published] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "publish_form_configuration"), {
        timeout: 60_000,
      }),
      push.click(),
    ])
    expect(published.ok()).toBe(true)

    await expect
      .poll(() => formSnapshot(page, organizationId))
      .toMatchObject({ isActive: true, configVersion: 1 })
    const accepted = await formSnapshot(page, organizationId)

    // A replay carrying a stale concurrency token is rejected and changes nothing.
    const stale = await replay(page, published.request(), (body) => {
      const params = body.params as Record<string, unknown> | undefined
      if (!params) throw new Error("publish request has no params")
      params.expected_updated_at_micros = { some: 1 }
    })
    expect(stale.status()).toBe(422)
    expect(await formSnapshot(page, organizationId)).toEqual(accepted)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const readerPage = await readerContext.newPage()
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, published.request())
      expect(denied.status()).toBe(403)
      expect(await formSnapshot(page, organizationId)).toEqual(accepted)
    } finally {
      await readerContext.close()
    }
    await expectNoAppError(page)
  })

  test("imports one payslip file through the UI; replaying the same file is rejected and a reader is denied", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    await gotoModule(page, "/hr", "hr")
    await page.getByTestId("module-tab-hr-payslips").click()
    const organizationId = await fetchSessionOrganizationId(page)
    const employeeId = await firstId(page, "employees")
    const structId = await firstId(page, "payroll-structures")
    const name = smokeName("cov22-payslip")
    const csvPath = path.join(os.tmpdir(), `lumiere-cov22-${Date.now()}.csv`)
    fs.writeFileSync(csvPath, `employee_id,struct_id,name,basic_wage\n${employeeId},${structId},${name},1234\n`, "utf8")

    const before = await payslipImportSnapshot(page, organizationId, name)
    await page.getByTestId("entity-action-csv-payslip").click()
    const modal = page.getByTestId("form-modal-hr-csv-import-payslip")
    await expect(modal).toBeVisible()
    await modal.locator('input[type="file"]').setInputFiles(csvPath)
    const [imported] = await Promise.all([
      page.waitForResponse((res) => matchesOperationResponse(res, "import_hr_payslip_csv"), {
        timeout: 60_000,
      }),
      page.getByTestId("form-submit-hr-csv-import-payslip").click(),
    ])
    expect(imported.ok()).toBe(true)

    await expect
      .poll(() => payslipImportSnapshot(page, organizationId, name))
      .toEqual({ payslips: before.payslips + 1, jobs: before.jobs + 1 })
    const accepted = await payslipImportSnapshot(page, organizationId, name)

    // The identical file is the same import identity: rejected, nothing created.
    const replayed = await replay(page, imported.request())
    expect(replayed.status()).toBe(422)
    expect(await payslipImportSnapshot(page, organizationId, name)).toEqual(accepted)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const readerPage = await readerContext.newPage()
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, imported.request())
      expect(denied.status()).toBe(403)
      expect(await payslipImportSnapshot(page, organizationId, name)).toEqual(accepted)
    } finally {
      await readerContext.close()
    }
    await expectNoAppError(page)
  })
})

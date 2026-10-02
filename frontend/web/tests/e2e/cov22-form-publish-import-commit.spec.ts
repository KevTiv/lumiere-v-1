import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { expect, test, type Page, type Request } from "@playwright/test"

import {
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-22 — see docs/plan/erp-cov22-form-publish-import-commit-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const READER_EMAIL = "fixture.reader@example.test"
const CANDIDATE_FORMS = ["new-opportunity", "new-contact", "new-lead"] as const

type Row = Record<string, unknown>

async function rows(page: Page, path: string): Promise<Row[]> {
  const response = await page.request.get(path)
  if (!response.ok()) throw new Error(`${path} failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

/** Same identity the server records on the job: SHA-256 over table, newline and normalized CSV. */
function contentSha256(table: string, csv: string): string {
  const normalized = csv.replace(/^﻿+/, "").replace(/\r\n/g, "\n").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "")
  return createHash("sha256").update(`${table}\n${normalized}`).digest("hex")
}

function writeCsv(csv: string): string {
  const csvPath = path.join(os.tmpdir(), `lumiere-cov22-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`)
  fs.writeFileSync(csvPath, csv, "utf8")
  return csvPath
}

async function formConfigSnapshots(page: Page, organizationId: number, moduleId: string, formId: string) {
  return (await rows(page, "/api/query/form-configs"))
    .filter(
      (row) =>
        scalarQueryId(row.organizationId ?? row.organization_id) === organizationId
        && String(row.moduleId ?? row.module_id) === moduleId
        && String(row.formId ?? row.form_id) === formId,
    )
    .map((row) => ({
      id: scalarQueryId(row.id),
      organizationId,
      moduleId,
      formId,
      version: scalarQueryId(row.configVersion ?? row.config_version),
      active: (row.isActive ?? row.is_active) !== false,
    }))
}

async function committedJobs(page: Page, sha: string) {
  return (await rows(page, "/api/query/import-jobs"))
    .filter((row) => String(row.tableName ?? row.table_name) === "hr_payslip" && String(row.metadata ?? "").includes(sha))
    .map((row) => ({
      id: scalarQueryId(row.id),
      status: String(row.status),
      importedRows: scalarQueryId(row.importedRows ?? row.imported_rows),
      errorRows: scalarQueryId(row.errorRows ?? row.error_rows),
    }))
}

async function payslipsNamed(page: Page, name: string) {
  return (await rows(page, "/api/query/payslips")).filter((row) => row.name === name).map((row) => scalarQueryId(row.id))
}

async function openPayslipImport(page: Page, csvPath: string) {
  await gotoModule(page, "/hr", "hr")
  await page.getByTestId("module-tab-hr-payslips").click()
  await page.getByTestId("entity-action-csv-payslip").click()
  await expect(page.getByTestId("form-modal-hr-csv-import-payslip")).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("form-field-csvFile").setInputFiles(csvPath)
}

test.describe("COV-22 form publish and idempotent import commit", { tag: ["@p0", "@cov22"] }, () => {
  test("publishing an unpublished form reads back version 1; the reader is denied", async ({ browser, page }) => {
    test.setTimeout(180_000)
    const organizationId = await fetchSessionOrganizationId(page)
    let formId: (typeof CANDIDATE_FORMS)[number] | null = null
    for (const candidate of CANDIDATE_FORMS) {
      if ((await formConfigSnapshots(page, organizationId, "crm", candidate)).length === 0) {
        formId = candidate
        break
      }
    }
    test.skip(formId == null, "every candidate CRM form is already published in this database")

    await gotoModule(page, "/settings")
    await page.getByTestId("settings-section-form-config").click()
    await page.getByTestId("form-config-module-crm").click()
    await page.getByTestId(`form-config-form-${formId}`).click()
    const [published] = await Promise.all([
      page.waitForResponse((candidate) => matchesOperationResponse(candidate, "publish_form_configuration"), { timeout: 90_000 }),
      page.getByTestId("form-config-push-registry").click(),
    ])
    expect(published.ok()).toBe(true)

    // Exact effect: one configuration for the exact (organization, module, form) at version 1.
    await expect.poll(async () => (await formConfigSnapshots(page, organizationId, "crm", formId!)).length).toBe(1)
    const [snapshot] = await formConfigSnapshots(page, organizationId, "crm", formId!)
    expect(snapshot).toMatchObject({ organizationId, moduleId: "crm", formId, version: 1, active: true })

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const readerPage = await readerContext.newPage()
      await signIn(readerPage, READER_EMAIL, PERSONA_PASSWORD)
      expect((await replay(readerPage, published.request())).status()).toBe(403)
      expect(await formConfigSnapshots(page, organizationId, "crm", formId!)).toEqual([snapshot])
    } finally {
      await readerContext.close()
    }
  })

  test("a payslip CSV commits once by content; replays and re-uploads do not duplicate", async ({ browser, page }) => {
    test.setTimeout(300_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)

    // ── Fixtures (setup calls only) ─────────────────────────────────────────
    const tag = smokeName("cov22")
    await callReducerBff(page, "create_payroll_structure", [organizationId, { name: `${tag}-structure`, type_: "employee", is_active: true }])
    const structure = (await rows(page, "/api/query/payroll-structures")).find((row) => row.name === `${tag}-structure`)
    const structureId = scalarQueryId(structure?.id)
    expect(structureId, "payroll structure fixture").toBeGreaterThan(0)
    const employeeId = scalarQueryId((await rows(page, "/api/query/employees"))[0]?.id)
    expect(employeeId, "an employee is required").toBeGreaterThan(0)

    const slipName = `${tag}-slip`
    const header = "employee_id,struct_id,company_id,name,basic_wage"
    const csv = `${header}\n${employeeId},${structureId},${companyId},${slipName},1000\n`
    const sha = contentSha256("hr_payslip", csv)
    expect(await committedJobs(page, sha)).toEqual([])

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const readerPage = await readerContext.newPage()
      await signIn(readerPage, READER_EMAIL, PERSONA_PASSWORD)

      // ── Commit from the visible CSV import ───────────────────────────────
      await openPayslipImport(page, writeCsv(csv))
      const [imported] = await Promise.all([
        page.waitForResponse((candidate) => matchesOperationResponse(candidate, "import_hr_payslip_csv"), { timeout: 60_000 }),
        submitForm(page, "hr-csv-import-payslip"),
      ])
      expect(imported.ok()).toBe(true)
      await expect.poll(async () => (await committedJobs(page, sha)).length).toBe(1)
      const jobs = await committedJobs(page, sha)
      expect(jobs[0]).toMatchObject({ status: "success", importedRows: 1, errorRows: 0 })
      const payslips = await payslipsNamed(page, slipName)
      expect(payslips).toHaveLength(1)

      // ── Replay of the accepted request is a no-op ────────────────────────
      expect((await replay(page, imported.request())).ok()).toBe(true)
      expect(await committedJobs(page, sha)).toEqual(jobs)
      expect(await payslipsNamed(page, slipName)).toEqual(payslips)

      // ── Re-uploading the same file (CRLF variant) from the UI is a no-op ─
      await openPayslipImport(page, writeCsv(csv.replace(/\n/g, "\r\n")))
      await Promise.all([
        page.waitForResponse((candidate) => matchesOperationResponse(candidate, "import_hr_payslip_csv"), { timeout: 60_000 }),
        submitForm(page, "hr-csv-import-payslip"),
      ])
      expect(await committedJobs(page, sha)).toEqual(jobs)
      expect(await payslipsNamed(page, slipName)).toEqual(payslips)

      // ── Different content commits as its own job ─────────────────────────
      const changedName = `${slipName}-2`
      const changed = `${header}\n${employeeId},${structureId},${companyId},${changedName},1000\n`
      await openPayslipImport(page, writeCsv(changed))
      await Promise.all([
        page.waitForResponse((candidate) => matchesOperationResponse(candidate, "import_hr_payslip_csv"), { timeout: 60_000 }),
        submitForm(page, "hr-csv-import-payslip"),
      ])
      await expect.poll(async () => (await committedJobs(page, contentSha256("hr_payslip", changed))).length).toBe(1)
      expect(await payslipsNamed(page, changedName)).toHaveLength(1)
      expect(await payslipsNamed(page, slipName)).toEqual(payslips)

      // ── An import that commits nothing is reported, not assumed ──────────
      const rejected = `${header}\n0,0,${companyId},${tag}-rejected,1\n`
      await openPayslipImport(page, writeCsv(rejected))
      await page.getByTestId("form-submit-hr-csv-import-payslip").click()
      await expect(page.getByTestId("form-modal-hr-csv-import-payslip")).toContainText(/committed no rows/i, { timeout: 30_000 })
      expect(await payslipsNamed(page, `${tag}-rejected`)).toEqual([])
      await page.keyboard.press("Escape")

      // ── Denied reader: 403 and an unchanged snapshot ─────────────────────
      expect((await replay(readerPage, imported.request())).status()).toBe(403)
      expect(await committedJobs(page, sha)).toEqual(jobs)
      expect(await payslipsNamed(page, slipName)).toEqual(payslips)
    } finally {
      await readerContext.close()
    }
  })
})

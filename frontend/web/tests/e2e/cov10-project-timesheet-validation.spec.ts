import { expect, test, type Page, type Request, type Response } from "@playwright/test"

import {
  callReducerBff,
  chooseFirstOption,
  chooseSelectOptionByLabel,
  chooseSelectOptionByValue,
  fetchAccountSelectLabelByInternalType,
  fetchCurrencyIdByCode,
  fetchDefaultCompanyId,
  fetchSalesInvoiceJournalLabel,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  isoDate,
  openEntityCreate,
  scalarQueryId,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import { actorIdentity, canonicalRow, sessionActor } from "./sod-evidence"

// COV-10 — see docs/plan/erp-cov10-project-timesheet-validation-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const VALIDATOR_EMAIL = "fixture.hr-project@example.test"

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function exactId(page: Page, resource: string, match: (row: Row) => boolean, label: string) {
  let id: number | null = null
  await expect
    .poll(async () => {
      const matches = (await rows(page, resource)).filter(match)
      id = matches.length === 1 ? scalarQueryId(matches[0]?.id) : null
      return matches.length
    }, { timeout: 30_000, message: `${label} must resolve to exactly one row` })
    .toBe(1)
  if (id == null) throw new Error(`${label} has no id`)
  return id
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

/**
 * Exact placement of one timesheet in the two server-filtered worklists:
 * `timesheets-to-validate` holds drafts; `timesheets-unbilled` holds
 * validated, billable, not-yet-invoiced entries.
 */
async function worklistSnapshot(page: Page, timesheetId: number) {
  const place = async (resource: string) => {
    const matches = (await rows(page, resource)).filter((row) => scalarQueryId(row.id) === timesheetId)
    if (matches.length > 1) throw new Error(`${resource} returned timesheet ${timesheetId} ${matches.length} times`)
    const row = matches[0]
    if (!row) return null
    return {
      organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
      companyId: scalarQueryId(row.companyId ?? row.company_id),
      validationStatus: String(row.validationStatus ?? row.validation_status ?? ""),
      invoiceId: scalarQueryId(row.timesheetInvoiceId ?? row.timesheet_invoice_id),
    }
  }
  return {
    toValidate: await place("timesheets-to-validate"),
    unbilled: await place("timesheets-unbilled"),
  }
}

async function runTimesheetAction(page: Page, timesheetId: number, actionId: string, reducer: string): Promise<Response> {
  await gotoModule(page, "/projects", "projects")
  await page.getByTestId("module-tab-projects-timesheets").click()
  const timesheetRow = page.getByTestId(`entity-row-${timesheetId}`)
  await expect(timesheetRow).toBeVisible({ timeout: 30_000 })
  await timesheetRow.click()
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeEnabled()
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, reducer), { timeout: 30_000 }),
    action.click(),
  ])
  return response
}

async function billTimesheetThroughUi(page: Page, timesheetId: number): Promise<Response> {
  await gotoModule(page, "/projects", "projects")
  await page.getByTestId("module-tab-projects-timesheets").click()
  const timesheetRow = page.getByTestId(`entity-row-${timesheetId}`)
  await expect(timesheetRow).toBeVisible({ timeout: 30_000 })
  await timesheetRow.click()
  const action = page.getByTestId("entity-action-bill-timesheets")
  await expect(action).toBeEnabled()
  await action.click()
  await expect(page.getByTestId("form-modal-projects-bill-timesheets")).toBeVisible()
  await chooseSelectOptionByLabel(page, "journalId", await fetchSalesInvoiceJournalLabel(page))
  await chooseSelectOptionByLabel(
    page,
    "incomeAccountId",
    await fetchAccountSelectLabelByInternalType(page, "income"),
  )
  await chooseFirstOption(page, "partnerId")
  await fillField(page, "invoiceDate", isoDate())
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, "bill_timesheets"), {
      timeout: 45_000,
    }),
    submitForm(page, "projects-bill-timesheets"),
  ])
  return response
}

async function billingEffect(page: Page, timesheetId: number) {
  const timesheet = await canonicalRow(page, "timesheets", timesheetId)
  const invoiceId = scalarQueryId(
    timesheet.timesheetInvoiceId ?? timesheet.timesheet_invoice_id,
  )
  if (invoiceId == null) return null
  const invoice = await canonicalRow(page, "account-moves", invoiceId)
  return {
    timesheetId,
    invoiceId,
    invoiceOrganizationId: scalarQueryId(invoice.organizationId ?? invoice.organization_id),
    invoiceCompanyId: scalarQueryId(invoice.companyId ?? invoice.company_id),
    invoiceOrigin: String(invoice.invoiceOrigin ?? invoice.invoice_origin ?? ""),
  }
}

test.describe("COV-10 exact timesheet validation / rejection", { tag: ["@p0", "@cov10"] }, () => {
  test("a second person validates and rejects; self-validation, replays and reader are rejected", async ({
    browser,
    page,
  }) => {
    test.setTimeout(300_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")
    const employees = await rows(page, "employees")
    const employeeId = scalarQueryId(
      employees.find((row) => scalarQueryId(row.companyId ?? row.company_id) === companyId)?.id,
    )
    if (employeeId == null) throw new Error("no employee in the default company")

    // This lifecycle owns an active create prerequisite. Merely finding a
    // pricelist row is insufficient: another lifecycle may have archived all
    // existing rows, and the project form intentionally excludes those rows.
    // The public pricelist read model omits companyId, so identify this fixture
    // by its unique name and organization; create_pricelist validates companyId
    // belongs to that organization before inserting it.
    const pricelistName = smokeName("cov10-pricelist")
    await callReducerBff(page, "create_pricelist", [organizationId, {
      companyId,
      name: pricelistName,
      currencyId,
      discountPolicy: { tag: "WithDiscount" },
    }])
    await expect
      .poll(async () => (await rows(page, "pricelists")).filter((row) =>
        row.name === pricelistName
        && scalarQueryId(row.organizationId ?? row.organization_id) === organizationId
        && (row.isActive ?? row.is_active) !== false
        && (row.isActive ?? row.is_active) !== 0,
      ).length, {
        timeout: 30_000,
        message: "COV-10 requires its exact active organization pricelist",
      })
      .toBe(1)

    // ── Operator creation path; the admin is the logger ────────────────────
    const tag = smokeName("cov10")
    const projectName = `${tag}-project`
    await openEntityCreate(page, "/projects", "projects", "projects", "new-project")
    await fillField(page, "name", projectName)
    await chooseFirstOption(page, "pricelistId")
    await submitForm(page, "new-project")
    const projectId = await exactId(page, "projects", (row) => row.name === projectName, "COV-10 project")

    const taskName = `${tag}-task`
    await openEntityCreate(page, "/projects", "projects", "tasks", "new-task")
    await fillField(page, "name", taskName)
    await chooseSelectOptionByLabel(page, "projectId", projectName)
    await fillField(page, "plannedHours", "8")
    await submitForm(page, "new-task")
    const taskId = await exactId(page, "tasks", (row) => row.name === taskName, "COV-10 task")

    const logHours = async (name: string) => {
      await openEntityCreate(page, "/projects", "projects", "timesheets", "log-timesheet")
      await chooseSelectOptionByLabel(page, "projectId", projectName)
      await chooseSelectOptionByLabel(page, "taskId", taskName)
      await chooseSelectOptionByValue(page, "employeeId", employeeId)
      await chooseSelectOptionByValue(page, "currencyId", currencyId)
      await fillField(page, "date", isoDate())
      await fillField(page, "unitAmount", "2")
      await fillField(page, "employeeCost", "50")
      await chooseFirstOption(page, "encodingUomId")
      await fillField(page, "name", name)
      await submitForm(page, "log-timesheet")
      return exactId(page, "timesheets-to-validate", (row) => row.name === name, name)
    }
    const toValidate = await logHours(`${tag}-validate`)
    const toReject = await logHours(`${tag}-reject`)
    const loggerIdentity = await sessionActor(page)
    for (const id of [toValidate, toReject]) {
      const entry = await canonicalRow(page, "timesheets", id)
      expect(actorIdentity(entry.userId ?? entry.user_id)).toBe(loggerIdentity)
    }

    const draft = { organizationId, companyId, validationStatus: "draft", invoiceId: null }
    for (const id of [toValidate, toReject]) {
      expect(await worklistSnapshot(page, id)).toEqual({ toValidate: draft, unbilled: null })
    }

    // Separation of duties through the UI: the logger cannot validate.
    const beforeSelfValidation = await canonicalRow(page, "timesheets", toValidate)
    const selfValidation = await runTimesheetAction(page, toValidate, "validate-timesheets", "validate_timesheets")
    expect(selfValidation.status()).toBe(422)
    expect(await worklistSnapshot(page, toValidate)).toEqual({ toValidate: draft, unbilled: null })
    expect(await canonicalRow(page, "timesheets", toValidate)).toEqual(beforeSelfValidation)

    const validatorContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const validatorPage = await validatorContext.newPage()
    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(validatorPage, VALIDATOR_EMAIL, PERSONA_PASSWORD)
      const validatorIdentity = await sessionActor(validatorPage)
      expect(validatorIdentity).not.toBe(loggerIdentity)

      const validated = await runTimesheetAction(validatorPage, toValidate, "validate-timesheets", "validate_timesheets")
      expect(validated.ok()).toBe(true)
      const validatedEffect = {
        toValidate: null,
        unbilled: { organizationId, companyId, validationStatus: "validated", invoiceId: null },
      }
      await expect.poll(() => worklistSnapshot(page, toValidate), { timeout: 30_000 }).toEqual(validatedEffect)
      const validatedRow = await canonicalRow(page, "timesheets", toValidate)
      expect(actorIdentity(validatedRow.validatedBy ?? validatedRow.validated_by)).toBe(validatorIdentity)
      expect(actorIdentity(validatedRow.userId ?? validatedRow.user_id)).toBe(loggerIdentity)
      const staleValidate = await replay(validatorPage, validated.request())
      expect(staleValidate.status()).toBe(422)
      expect(await worklistSnapshot(page, toValidate)).toEqual(validatedEffect)

      // The logger's admin session completes the commercial handoff through the
      // visible Bill form. Success is the exact persisted timesheet relation and
      // exact scoped accounting move, not a newest-row or toast-only assertion.
      await page.reload({ waitUntil: "domcontentloaded" })
      const billed = await billTimesheetThroughUi(page, toValidate)
      expect(billed.ok()).toBe(true)
      await expect
        .poll(() => billingEffect(page, toValidate), { timeout: 45_000 })
        .toMatchObject({
          timesheetId: toValidate,
          invoiceOrganizationId: organizationId,
          invoiceCompanyId: companyId,
          invoiceOrigin: "Timesheets",
        })
      const exactBillingEffect = await billingEffect(page, toValidate)
      if (exactBillingEffect == null) throw new Error("timesheet billing effect missing after convergence")
      expect(exactBillingEffect.invoiceId).toBeGreaterThan(0)
      expect(await worklistSnapshot(page, toValidate)).toEqual({ toValidate: null, unbilled: null })

      const staleBill = await replay(page, billed.request())
      expect(staleBill.status()).toBe(422)
      expect(await billingEffect(page, toValidate)).toEqual(exactBillingEffect)
      const billedWorklist = { toValidate: null, unbilled: null }

      // A rejected entry leaves the draft worklist and never reaches billing.
      // Its `rejected` state is not projected yet (see the status card).
      const rejected = await runTimesheetAction(validatorPage, toReject, "reject-timesheets", "reject_timesheets")
      expect(rejected.ok()).toBe(true)
      const rejectedEffect = { toValidate: null, unbilled: null }
      await expect.poll(() => worklistSnapshot(page, toReject), { timeout: 30_000 }).toEqual(rejectedEffect)
      const staleReject = await replay(validatorPage, rejected.request())
      expect(staleReject.status()).toBe(422)
      expect(await worklistSnapshot(page, toReject)).toEqual(rejectedEffect)

      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      for (const [request, id, effect] of [
        [validated.request(), toValidate, billedWorklist],
        [rejected.request(), toReject, rejectedEffect],
      ] as const) {
        const beforeDenial = await canonicalRow(page, "timesheets", id)
        const denied = await replay(readerPage, request)
        expect(denied.status()).toBe(403)
        expect(await worklistSnapshot(page, id)).toEqual(effect)
        expect(await canonicalRow(page, "timesheets", id)).toEqual(beforeDenial)
      }
      const beforeBillingDenial = await billingEffect(page, toValidate)
      const deniedBill = await replay(readerPage, billed.request())
      expect(deniedBill.status()).toBe(403)
      expect(await billingEffect(page, toValidate)).toEqual(beforeBillingDenial)
    } finally {
      await readerContext.close()
      await validatorContext.close()
    }
  })
})

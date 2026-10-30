import { expect, request as playwrightRequest, test } from "@playwright/test"

import { bootstrapFixtureAccountSession } from "./fixture-account"
import {
  chooseSelectOptionByTriggerValue,
  expectNoAppError,
  fetchSessionOrganizationId,
  fillField,
  scalarQueryId,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

type CompanyRow = {
  id?: unknown
  organizationId?: unknown
  currencyId?: unknown
  fiscalYearEndMonth?: number
  fiscalYearEndDay?: number
}
type ContactRow = {
  id?: unknown
  organizationId?: unknown
  companyId?: unknown
  name?: string
  email?: string
}

/**
 * AA-02/08: fresh tenant -> deterministic checklist -> canonical CRM form ->
 * saved record -> reload. Trusted setup creates only an organization-less auth
 * account because public registration is disabled. No business records are seeded,
 * no HTTP responses are mocked, and the test never calls an AI provider.
 */
test.describe("Alpha assisted organization activation", { tag: ["@p0", "@aa08", "@unauthenticated"] }, () => {
  test("creates its first contact through the checklist and reads back the exact saved record", async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100"
    const suffix = smokeName("aa08-activation").toLowerCase()
    const password = "Password123$"
    const email = `${suffix}@example.test`
    const authSetup = await playwrightRequest.newContext({ baseURL })
    try {
      await bootstrapFixtureAccountSession(authSetup, email, password)
    } finally {
      await authSetup.dispose()
    }

    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } })
    try {
      const page = await context.newPage()
      let contactCreates = 0
      const aiRequests: string[] = []
      page.on("request", request => {
        if (request.method() === "POST" && matchesOperationResponse({ url: () => request.url() }, "create_contact")) contactCreates++
        const path = new URL(request.url()).pathname
        if (path.startsWith("/api/ai/")) aiRequests.push(path)
      })

      await page.goto("/sign-in")
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/password/i).fill(password)
      await page.getByRole("button", { name: /sign in/i }).click()
      await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/, { timeout: 30_000 })
      await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 })

      const submit = page.locator('form button[type="submit"]')
      await expect(page.locator("#currency")).toBeEnabled({ timeout: 30_000 })
      await expect(submit).toBeDisabled()
      await chooseSelectOptionByTriggerValue(page, page.locator("#currency"), "USD")
      await chooseSelectOptionByTriggerValue(page, page.locator("#timezone"), "Africa/Kigali")
      await page.getByLabel("Month (1–12)", { exact: true }).fill("6")
      await page.getByLabel("Day", { exact: true }).fill("30")
      await page.getByRole("checkbox", { name: "I have checked the base currency, company timezone and fiscal year-end.", exact: true }).check()
      await page.locator("#name").fill(`AA08 ${suffix}`)
      await page.locator("#code").fill(suffix.replace(/[^a-z0-9]/g, "").slice(-8).toUpperCase())
      const [bootstrap] = await Promise.all([
        page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/bootstrap/tenant", { timeout: 60_000 }),
        submit.click(),
      ])
      expect(bootstrap.ok(), `tenant bootstrap HTTP ${bootstrap.status()}`).toBe(true)
      expect(bootstrap.request().postDataJSON()).toMatchObject({
        organization: { timezone: "Africa/Kigali" },
        defaultCompanyCurrencyCode: "USD",
        fiscalYearEndMonth: 6,
        fiscalYearEndDay: 30,
      })
      await expect(page.getByTestId("dashboard-sidebar").first()).toBeVisible({ timeout: 60_000 })
      await expect(page).toHaveURL(/\/overview/, { timeout: 30_000 })

      const organizationId = await fetchSessionOrganizationId(page)
      expect(Number.isSafeInteger(organizationId)).toBe(true)
      expect(organizationId).toBeGreaterThan(0)
      const companies = await page.request.get("/api/query/companies")
      expect(companies.ok()).toBe(true)
      const companyRows = (await companies.json()) as { data?: CompanyRow[] }
      expect(companyRows.data).toHaveLength(1)
      const company = companyRows.data![0]!
      const companyId = scalarQueryId(company.id)
      expect(Number.isSafeInteger(companyId)).toBe(true)
      expect(companyId).toBeGreaterThan(0)
      expect(scalarQueryId(company.organizationId)).toBe(organizationId)
      expect(scalarQueryId(company.currencyId)).not.toBeNull()
      expect(company.fiscalYearEndMonth).toBe(6)
      expect(company.fiscalYearEndDay).toBe(30)
      // The currency owner returns persisted tenant rows after onboarding;
      // organization-less callers receive only the code catalog.
      const currencies = await page.request.get("/api/bootstrap/currencies")
      expect(currencies.ok()).toBe(true)
      const currencyRows = (await currencies.json()) as { data?: Array<{ id?: unknown; code?: string }> }
      expect(currencyRows.data?.filter(row => scalarQueryId(row.id) === scalarQueryId(company.currencyId))).toEqual([
        expect.objectContaining({ code: "USD" }),
      ])

      const contactsBefore = await page.request.get("/api/query/contacts")
      expect(contactsBefore.ok()).toBe(true)
      expect((await contactsBefore.json() as { data?: ContactRow[] }).data).toEqual([])
      const checklist = page.getByTestId("activation-checklist")
      await expect(checklist).toBeVisible()
      await expect(checklist.locator('[data-check="company"]')).toHaveAttribute("data-state", "ready")
      await expect(checklist.locator('[data-check="currency"]')).toHaveAttribute("data-state", "ready")
      await expect(checklist.locator('[data-check="fiscal"]')).toHaveAttribute("data-state", "ready")
      await checklist.getByRole("radio", { name: "Add a contact", exact: true }).check()
      await expect(checklist.locator('[data-check="contact"]')).toHaveAttribute("data-state", "missing")
      const returnUrl = page.url()
      await checklist.getByRole("button", { name: "Add a contact", exact: true }).click()
      await expect(page).toHaveURL(/\/crm\?tab=contacts/)
      await expect(page.getByTestId("module-view-crm")).toBeVisible()
      await page.getByTestId("module-create-crm-contacts").click()
      await expect(page.getByTestId("form-modal-new-contact")).toBeVisible()
      const contactName = `First useful contact ${suffix}`
      const contactEmail = `contact-${suffix}@example.test`
      await fillField(page, "name", contactName)
      await fillField(page, "email", contactEmail)
      const [created] = await Promise.all([
        page.waitForResponse(response => response.request().method() === "POST" && matchesOperationResponse(response, "create_contact"), { timeout: 30_000 }),
        submitForm(page, "new-contact"),
      ])
      expect(created.ok(), `contact creation HTTP ${created.status()}`).toBe(true)

      // Unique explicit user input plus 0 -> 1 cardinality identifies this result;
      // no latest-row or unrelated-record fallback is allowed.
      let savedContacts: ContactRow[] = []
      await expect.poll(async () => {
        const contactsAfter = await page.request.get("/api/query/contacts")
        expect(contactsAfter.ok()).toBe(true)
        savedContacts = ((await contactsAfter.json()) as { data?: ContactRow[] }).data ?? []
        return savedContacts
      }, { timeout: 30_000, message: "the first contact is canonically readable without resubmitting its create" }).toHaveLength(1)
      const saved = savedContacts[0]!
      const savedId = scalarQueryId(saved.id)
      expect(Number.isSafeInteger(savedId)).toBe(true)
      expect(savedId).toBeGreaterThan(0)
      expect(saved.name).toBe(contactName)
      expect(saved.email).toBe(contactEmail)
      expect(scalarQueryId(saved.organizationId)).toBe(organizationId)
      expect(scalarQueryId(saved.companyId)).toBe(companyId)
      expect(contactCreates).toBe(1)

      await page.goto(returnUrl)
      await expect(checklist.locator('[data-check="contact"]')).toHaveAttribute("data-state", "ready", { timeout: 30_000 })
      await page.reload()
      await expect(checklist.locator('[data-check="contact"]')).toHaveAttribute("data-state", "ready", { timeout: 30_000 })
      const reloaded = await page.request.get("/api/query/contacts")
      expect(reloaded.ok()).toBe(true)
      const reloadedContacts = (await reloaded.json()) as { data?: ContactRow[] }
      expect(reloadedContacts.data).toHaveLength(1)
      expect(reloadedContacts.data![0]).toMatchObject({ name: contactName, email: contactEmail })
      expect(scalarQueryId(reloadedContacts.data![0]!.id)).toBe(savedId)
      expect(contactCreates).toBe(1)
      expect(aiRequests).toEqual([])
      await expectNoAppError(page)
      await page.screenshot({ path: testInfo.outputPath("authenticated-activation-first-contact.png"), fullPage: true })
      await testInfo.attach("canonical-first-contact", { body: JSON.stringify({ organizationId, companyId, contactId: savedId, contactCreates }), contentType: "application/json" })
    } finally {
      await context.close()
    }
  })
})

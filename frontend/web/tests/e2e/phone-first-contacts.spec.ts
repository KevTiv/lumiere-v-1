import {
  expect,
  request as playwrightRequest,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"

import {
  callReducerBff,
  callReducerBffResult,
  expectNoAppError,
  fetchContactIdByName,
  fetchSessionOrganizationId,
  fillField,
  openEntityCreate,
  scalarQueryId,
  smokeName,
  submitForm,
} from "./helpers"

const E2E_PASSWORD = "Password123$"
const NORMALIZED_PHONE = "+12025550101"
const FORMATTED_PHONE = "+1 (202) 555-0101"

type QueryRow = Record<string, unknown>

type Tenant = {
  context: BrowserContext
  page: Page
  organizationId: number
  mainCompanyId: number
  branchCompanyId: number
}

function e2eBaseUrl() {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100"
}

function valueAsString(row: QueryRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (value != null) return String(value)
  }
  return ""
}

function valueAsId(row: QueryRow, ...keys: string[]): number | null {
  for (const key of keys) {
    const id = scalarQueryId(row[key])
    if (id != null) return id
  }
  return null
}

function sameId(value: unknown, id: number) {
  return scalarQueryId(value) === id
}

function expectedMask(normalized: string) {
  if (normalized.length <= 7) return "*".repeat(normalized.length)
  return `${normalized.slice(0, 4)}${"*".repeat(normalized.length - 7)}${normalized.slice(-3)}`
}

async function queryRows(page: Page, resource: string): Promise<QueryRow[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()} ${await response.text()}`)
  }
  const body = (await response.json()) as { data?: QueryRow[] }
  return body.data ?? []
}

async function waitForRow(
  page: Page,
  resource: string,
  predicate: (row: QueryRow) => boolean,
  description: string,
): Promise<QueryRow> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const row = (await queryRows(page, resource)).find(predicate)
    if (row) return row
    await page.waitForTimeout(250)
  }
  throw new Error(`Timed out waiting for ${description} in ${resource}`)
}

function createContactParams({
  name,
  companyId,
  phone = null,
  isCustomer = false,
  isVendor = false,
}: {
  name: string
  companyId: number
  phone?: string | null
  isCustomer?: boolean
  isVendor?: boolean
}) {
  return {
    name,
    type: "contact",
    email: null,
    phone,
    mobile: null,
    companyId,
    isCustomer,
    isVendor,
    isEmployee: false,
    isProspect: false,
    isPartner: false,
    customerRank: isCustomer ? 1 : 0,
    supplierRank: isVendor ? 1 : 0,
    displayName: null,
    firstName: null,
    lastName: null,
    title: null,
    emailSecondary: null,
    fax: null,
    website: null,
    street: null,
    street2: null,
    city: null,
    stateCode: null,
    zip: null,
    countryCode: "US",
    taxId: null,
    companyRegistry: null,
    industry: null,
    employeesCount: null,
    annualRevenue: null,
    description: null,
    salespersonId: null,
    assignedUserId: null,
    parentId: null,
    userId: null,
    color: null,
    metadata: null,
  }
}

async function createPhoneIdentity(
  page: Page,
  organizationId: number,
  contactId: number,
  companyId: number,
  rawValue: string,
  kind: "Primary" | "WhatsApp" | "MobileMoney" = "Primary",
) {
  await callReducerBff(page, "create_contact_identity", [
    organizationId,
    {
      contactId,
      companyId,
      kind: { tag: kind },
      rawValue,
      isPreferred: true,
      verificationState: null,
      metadata: null,
    },
  ])
}

async function assignContactRole(
  page: Page,
  organizationId: number,
  contactId: number,
  companyId: number,
  role: "customer" | "supplier",
) {
  await callReducerBff(page, "assign_contact_role", [
    organizationId,
    {
      contactId,
      companyId,
      role,
      activeFrom: null,
      activeUntil: null,
      metadata: null,
    },
  ])
}

async function bootstrapTenant(browser: Browser, label: string): Promise<Tenant> {
  const baseURL = e2eBaseUrl()
  const suffix = smokeName(`phone-first-${label}`)
  const code = `P${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const api = await playwrightRequest.newContext({ baseURL })
  let context: BrowserContext | undefined

  try {
    const signup = await api.post("/api/auth/signup", {
      data: { email: `${suffix}@example.test`, password: E2E_PASSWORD },
    })
    if (!signup.ok()) {
      throw new Error(`tenant signup failed (${signup.status()}): ${await signup.text()}`)
    }

    const bootstrap = await api.post("/api/bootstrap/tenant", {
      data: {
        organization: {
          name: `${suffix} organization`,
          code,
          timezone: "UTC",
          dateFormat: "YYYY-MM-DD",
          language: "en",
          isActive: true,
          description: null,
          logoUrl: null,
          website: null,
          email: null,
          phone: null,
          currencyId: null,
          metadata: JSON.stringify({ fixture: "P1-CONTACT-01", tenant: label }),
        },
        defaultCompanyName: `${suffix} main`,
        defaultCompanyCode: `${code}M`,
        defaultCompanyCurrencyCode: "USD",
        fiscalYearEndMonth: 12,
        fiscalYearEndDay: 31,
        seedFormConfigs: true,
        settings: {
          moduleConfig: null,
          featureFlags: [],
          integrationKeys: null,
          metadata: JSON.stringify({ fixture: "P1-CONTACT-01" }),
        },
      },
    })
    if (!bootstrap.ok()) {
      throw new Error(`tenant bootstrap failed (${bootstrap.status()}): ${await bootstrap.text()}`)
    }

    context = await browser.newContext({
      baseURL,
      storageState: await api.storageState(),
    })
    const page = await context.newPage()
    const organizationId = await fetchSessionOrganizationId(page)
    const mainCompany = await waitForRow(
      page,
      "companies",
      (row) => valueAsString(row, "name") === `${suffix} main`,
      "bootstrapped main company",
    )
    const mainCompanyId = valueAsId(mainCompany, "id")
    const currencyId = valueAsId(mainCompany, "currencyId", "currency_id")
    if (mainCompanyId == null || currencyId == null) {
      throw new Error("bootstrapped main company is missing its id or currency")
    }

    const branchName = `${suffix} branch`
    await callReducerBff(page, "create_company", [
      organizationId,
      {
        name: branchName,
        code: `${code}B`,
        currencyId,
        fiscalYearEndMonth: 12,
        fiscalYearEndDay: 31,
        isParent: false,
        parentId: mainCompanyId,
        taxId: null,
        companyRegistry: null,
        addressStreet: null,
        addressCity: null,
        addressZip: null,
        addressCountryCode: "US",
        metadata: JSON.stringify({ fixture: "P1-CONTACT-01", scope: "branch" }),
      },
    ])
    const branchCompany = await waitForRow(
      page,
      "companies",
      (row) => valueAsString(row, "name") === branchName,
      "branch company",
    )
    const branchCompanyId = valueAsId(branchCompany, "id")
    if (branchCompanyId == null) throw new Error("branch company is missing its id")

    return { context, page, organizationId, mainCompanyId, branchCompanyId }
  } catch (error) {
    await context?.close()
    throw error
  } finally {
    await api.dispose()
  }
}

test.describe("P1-CONTACT-01 phone-first contacts", { tag: ["@p1", "@contacts"] }, () => {
  test("normalizes phone identities, preserves customer/supplier roles, masks display, and isolates scopes", async ({
    browser,
  }) => {
    test.setTimeout(120_000)

    const alpha = await bootstrapTenant(browser, "alpha")
    const beta = await bootstrapTenant(browser, "beta")

    try {
      const customerName = smokeName("contact-customer")
      const duplicateName = smokeName("contact-customer-duplicate")
      const supplierName = smokeName("contact-supplier")

      // The CRM form is the customer-facing creation path. Phone identities and explicit
      // contact roles currently have API-only surfaces, so they are created through typed reducers.
      await openEntityCreate(alpha.page, "/crm", "crm", "contacts", "new-contact")
      await fillField(alpha.page, "name", customerName)
      await fillField(alpha.page, "phone", FORMATTED_PHONE)
      const [customerCreate] = await Promise.all([
        alpha.page.waitForResponse(
          (response) => response.url().includes("/api/call/create_contact") && response.ok(),
          { timeout: 30_000 },
        ),
        submitForm(alpha.page, "new-contact"),
      ])
      expect(customerCreate.ok()).toBe(true)
      const customerId = await fetchContactIdByName(alpha.page, customerName)

      await callReducerBff(alpha.page, "create_contact", [
        alpha.organizationId,
        createContactParams({
          name: duplicateName,
          companyId: alpha.mainCompanyId,
          phone: NORMALIZED_PHONE,
          isCustomer: true,
        }),
      ])
      const duplicateId = await fetchContactIdByName(alpha.page, duplicateName)

      await callReducerBff(alpha.page, "create_contact", [
        alpha.organizationId,
        createContactParams({
          name: supplierName,
          companyId: alpha.mainCompanyId,
          isVendor: true,
        }),
      ])
      const supplierId = await fetchContactIdByName(alpha.page, supplierName)

      // Same raw value and name in the branch company must not leak into the main-company duplicate view.
      await callReducerBff(alpha.page, "create_contact", [
        alpha.organizationId,
        createContactParams({
          name: customerName,
          companyId: alpha.branchCompanyId,
          phone: FORMATTED_PHONE,
          isCustomer: true,
        }),
      ])
      const branchContactRow = await waitForRow(
        alpha.page,
        "contacts",
        (row) =>
          valueAsString(row, "name") === customerName &&
          sameId(row.companyId ?? row.company_id, alpha.branchCompanyId),
        "branch-scoped customer contact",
      )
      const branchContactId = valueAsId(branchContactRow, "id")
      if (branchContactId == null) throw new Error("branch-scoped customer contact is missing its id")

      await createPhoneIdentity(
        alpha.page,
        alpha.organizationId,
        customerId,
        alpha.mainCompanyId,
        FORMATTED_PHONE,
      )
      await createPhoneIdentity(
        alpha.page,
        alpha.organizationId,
        duplicateId,
        alpha.mainCompanyId,
        NORMALIZED_PHONE,
      )
      await createPhoneIdentity(
        alpha.page,
        alpha.organizationId,
        supplierId,
        alpha.mainCompanyId,
        "+12025550201",
        "MobileMoney",
      )
      await createPhoneIdentity(
        alpha.page,
        alpha.organizationId,
        branchContactId,
        alpha.branchCompanyId,
        FORMATTED_PHONE,
      )

      await assignContactRole(alpha.page, alpha.organizationId, customerId, alpha.mainCompanyId, "customer")
      await assignContactRole(alpha.page, alpha.organizationId, duplicateId, alpha.mainCompanyId, "customer")
      await assignContactRole(alpha.page, alpha.organizationId, supplierId, alpha.mainCompanyId, "supplier")

      const customerIdentity = await waitForRow(
        alpha.page,
        "contact-phone-identities",
        (row) => sameId(row.contactId ?? row.contact_id, customerId),
        "customer phone identity",
      )
      const duplicateIdentity = await waitForRow(
        alpha.page,
        "contact-phone-identities",
        (row) => sameId(row.contactId ?? row.contact_id, duplicateId),
        "duplicate candidate phone identity",
      )
      const customerNormalized = valueAsString(
        customerIdentity,
        "normalizedE164",
        "normalized_e164",
        "normalizedE_164",
      )
      const duplicateNormalized = valueAsString(
        duplicateIdentity,
        "normalizedE164",
        "normalized_e164",
        "normalizedE_164",
      )
      const customerMasked = valueAsString(customerIdentity, "displayMasked", "display_masked")

      // The API does not currently reject an existing normalized identity, so this scenario
      // asserts the supported normalization behavior rather than claiming a duplicate guard.
      expect(customerNormalized).toBe(NORMALIZED_PHONE)
      expect(duplicateNormalized).toBe(NORMALIZED_PHONE)
      expect(customerMasked).toBe(expectedMask(NORMALIZED_PHONE))
      expect(customerMasked).not.toContain(NORMALIZED_PHONE.slice(4, -3))

      const contacts = await queryRows(alpha.page, "contacts")
      const customer = contacts.find((row) => sameId(row.id, customerId))
      const supplier = contacts.find((row) => sameId(row.id, supplierId))
      const branchContact = contacts.find((row) => sameId(row.id, branchContactId))
      expect(customer?.isCustomer ?? customer?.is_customer).toBe(true)
      expect(supplier?.isVendor ?? supplier?.is_vendor).toBe(true)
      expect(valueAsId(customer ?? {}, "companyId", "company_id")).toBe(alpha.mainCompanyId)
      expect(valueAsId(branchContact ?? {}, "companyId", "company_id")).toBe(alpha.branchCompanyId)

      const roles = await queryRows(alpha.page, "contact-role-assignments")
      expect(
        roles.some(
          (row) =>
            sameId(row.contactId ?? row.contact_id, customerId) &&
            valueAsString(row, "role") === "customer" &&
            sameId(row.companyId ?? row.company_id, alpha.mainCompanyId),
        ),
      ).toBe(true)
      expect(
        roles.some(
          (row) =>
            sameId(row.contactId ?? row.contact_id, supplierId) &&
            valueAsString(row, "role") === "supplier" &&
            sameId(row.companyId ?? row.company_id, alpha.mainCompanyId),
        ),
      ).toBe(true)

      await expect(alpha.page.getByText(supplierName).first()).toBeVisible({ timeout: 30_000 })
      await alpha.page.getByTestId("module-tab-crm-duplicates").click()
      await expect(alpha.page.getByTestId("crm-duplicates-empty")).toBeVisible({ timeout: 30_000 })

      const foreignCompanyIdentity = await callReducerBffResult(
        alpha.page,
        "create_contact_identity",
        [
          alpha.organizationId,
          {
            contactId: customerId,
            companyId: beta.mainCompanyId,
            kind: { tag: "WhatsApp" },
            rawValue: NORMALIZED_PHONE,
            isPreferred: false,
            verificationState: null,
            metadata: null,
          },
        ],
      )
      expect(foreignCompanyIdentity.ok).toBe(false)
      expect(foreignCompanyIdentity.error ?? "").toMatch(/company does not belong to this organization/i)

      const crossTenantContact = await callReducerBffResult(alpha.page, "create_contact", [
        beta.organizationId,
        createContactParams({
          name: smokeName("cross-tenant-contact"),
          companyId: beta.mainCompanyId,
          isCustomer: true,
        }),
      ])
      expect(crossTenantContact.ok).toBe(false)
      expect(crossTenantContact.error ?? "").toMatch(/not a member of this organization/i)

      const betaContacts = await queryRows(beta.page, "contacts")
      expect(betaContacts.some((row) => valueAsString(row, "name") === customerName)).toBe(false)
      await expectNoAppError(alpha.page)
      await expectNoAppError(beta.page)
    } finally {
      await alpha.context.close()
      await beta.context.close()
    }
  })
})

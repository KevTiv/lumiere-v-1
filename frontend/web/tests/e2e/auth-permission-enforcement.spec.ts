import { createHash, randomBytes } from "node:crypto"

import { expect, test, type Browser, type Page } from "@playwright/test"

import {
  AUTH_STORAGE_PATH,
  callReducerBff,
  expectReducerPermissionDenied,
  fetchFirstPricelistId,
  fetchFulfillmentPickingIdBySaleOrderId,
  fetchOrgPermissionId,
  fetchProductIdByName,
  fetchSessionOrganizationId,
  fetchVendorPartnerIdByName,
  grantPermissionViaSettings,
  revokePermissionViaSettings,
  scalarQueryId,
  signIn,
  smokeName,
  waitForMovePosted,
  waitForPaymentPosted,
} from "./helpers"

/**
 * Permission enforcement E2E for high-risk reducers.
 *
 * Backend: `check_permission` in spacetimedb/src/helpers.rs (Casbin + org_permission +
 * role.permissions). Superusers bypass all checks — tests use a non-superuser invited into
 * a limited role (`organization:read` only).
 *
 * api-server maps reducer permission errors to HTTP 500 today; tests accept 403 OR a body
 * containing "Permission denied".
 */

const SEEDED_CUSTOMER = "Acme Corporation"
const SEEDED_DRAFT_MOVE_NAME = "MISC/2026/DRAFT-01"
const SEEDED_PRODUCT = "Lumiere Dev Laptop"

type LimitedUser = { email: string; password: string }

let limitedUser: LimitedUser
let limitedRoleId: number
let orgId: number

async function fetchRoleIdByName(page: Page, name: string): Promise<number> {
  const res = await page.request.get("/api/query/roles")
  if (!res.ok()) throw new Error(`roles query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
  const row = (json.data ?? []).find((r) => String(r.name ?? "") === name)
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error(`role not found: ${name}`)
  return id
}

async function createLimitedRole(page: Page, roleName: string): Promise<number> {
  const organizationId = await fetchSessionOrganizationId(page)
  await callReducerBff(page, "create_role", [
    organizationId,
    {
      name: roleName,
      description: "E2E limited role — permission enforcement",
      parent_id: null,
      permissions: ["organization:read"],
      is_active: true,
      metadata: null,
    },
  ])
  return fetchRoleIdByName(page, roleName)
}

async function adminIdentityHex(page: Page): Promise<string> {
  const cookies = await page.context().cookies()
  const raw = cookies.find((c) => c.name === "stdb_identity")?.value ?? ""
  const hex = raw.trim().replace(/^0x/i, "")
  if (hex.length !== 64) {
    throw new Error("stdb_identity cookie missing or invalid for invite setup")
  }
  return hex
}

async function provisionLimitedUserViaInvite(
  page: Page,
  organizationId: number,
  roleId: number,
): Promise<LimitedUser> {
  const email = `${smokeName("perm-limited")}@example.test`
  const password = "Password123$"
  const token = randomBytes(32).toString("hex")
  const tokenHash = createHash("sha256").update(token).digest("hex")
  const invitedBy = await adminIdentityHex(page)
  const expiresAtMicros = (Date.now() + 7 * 24 * 60 * 60 * 1000) * 1000

  await callReducerBff(page, "create_user_invite", [
    organizationId,
    roleId,
    email,
    tokenHash,
    invitedBy,
    String(expiresAtMicros),
  ])

  const accept = await page.request.post("/api/auth/accept-invite", {
    data: { token, email, password },
  })
  if (!accept.ok()) {
    const body = await accept.text().catch(() => "")
    throw new Error(`accept-invite failed (${accept.status()}): ${body}`)
  }

  return { email, password }
}

async function withLimitedUserSession(
  browser: Browser,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, limitedUser.email, limitedUser.password)
  try {
    await run(page)
  } finally {
    await context.close()
  }
}

async function fetchDraftMoveIdByName(page: Page, moveName: string): Promise<number> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-moves")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; name?: string; state?: unknown }>
      }
      const row = (json.data ?? []).find(
        (m) =>
          String(m.name ?? "") === moveName &&
          String(m.state ?? "").toLowerCase().includes("draft"),
      )
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`draft account move not found: ${moveName}`)
}

async function fetchDefaultCompanyId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/companies")
  if (!res.ok()) throw new Error(`companies query failed: ${res.status()}`)
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> }
  const id = scalarQueryId(json.data?.[0]?.id)
  if (id == null) throw new Error("no company in seed data")
  return id
}

async function adminCreateDraftPayment(page: Page): Promise<number> {
  const companyId = await fetchDefaultCompanyId(page)
  const partnerId = await fetchVendorPartnerIdByName(page, "Globex Corp")
  const amount = 42.5
  await callReducerBff(
    page,
    "create_payment",
    [
      orgId,
      {
        company_id: companyId,
        payment_type: { tag: "OutBound" },
        partner_type: { tag: "Supplier" },
        partner_id: partnerId,
        amount,
        currency_id: 1,
        date: null,
        journal_id: 1,
        ref_: smokeName("perm-pay"),
        memo: null,
      },
    ],
    { withCompany: true },
  )

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/account-payments")
    if (res.ok()) {
      const json = (await res.json()) as {
        data?: Array<{ id?: unknown; partnerId?: unknown; partner_id?: unknown; state?: unknown }>
      }
      const row = [...(json.data ?? [])]
        .filter((p) => scalarQueryId(p.partnerId ?? p.partner_id) === partnerId)
        .sort((a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0))[0]
      const id = scalarQueryId(row?.id)
      const state = String(row?.state ?? "")
      if (id != null && state.includes("NotPaid")) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error("draft payment not found after create_payment")
}

async function adminPrepareAssignedPicking(page: Page): Promise<number> {
  const companyId = await fetchDefaultCompanyId(page)
  const partnerRes = await page.request.get("/api/query/contacts")
  if (!partnerRes.ok()) throw new Error(`contacts query failed: ${partnerRes.status()}`)
  const contactsJson = (await partnerRes.json()) as {
    data?: Array<{ id?: unknown; name?: string; isCustomer?: boolean }>
  }
  const customer = (contactsJson.data ?? []).find(
    (c) => String(c.name ?? "").includes(SEEDED_CUSTOMER) && c.isCustomer !== false,
  )
  const partnerId = scalarQueryId(customer?.id)
  if (partnerId == null) throw new Error(`customer not found: ${SEEDED_CUSTOMER}`)

  const productId = await fetchProductIdByName(page, SEEDED_PRODUCT)
  const pricelistId = await fetchFirstPricelistId(page)

  await callReducerBff(
    page,
    "create_sale_order",
    [
      orgId,
      {
        company_id: companyId,
        partner_id: partnerId,
        partner_invoice_id: partnerId,
        partner_shipping_id: partnerId,
        pricelist_id: pricelistId,
        currency_id: 1,
        origin: smokeName("perm-so"),
        client_order_ref: null,
        payment_term_id: null,
        fiscal_position_id: null,
        user_id: null,
        team_id: null,
        opportunity_id: null,
        campaign_id: null,
        medium_id: null,
        source_id: null,
        commitment_date: null,
        expected_date: null,
        validity_days: null,
        shipping_policy: null,
        picking_policy: null,
        customer_lead: null,
        is_printed: null,
        is_locked: null,
        is_dropship: null,
        note: null,
      },
    ],
    { withCompany: true },
  )

  const soRes = await page.request.get("/api/query/sale-orders")
  if (!soRes.ok()) throw new Error(`sale-orders query failed: ${soRes.status()}`)
  const soJson = (await soRes.json()) as { data?: Array<{ id?: unknown; partnerId?: unknown; partner_id?: unknown }> }
  const order = [...(soJson.data ?? [])]
    .filter((o) => scalarQueryId(o.partnerId ?? o.partner_id) === partnerId)
    .sort((a, b) => (scalarQueryId(b.id) ?? 0) - (scalarQueryId(a.id) ?? 0))[0]
  const orderId = scalarQueryId(order?.id)
  if (orderId == null) throw new Error("sale order not found after create_sale_order")

  await callReducerBff(
    page,
    "create_sale_order_line",
    [
      orgId,
      orderId,
      {
        product_id: productId,
        product_uom_qty: 1,
        price_unit: 100,
        discount: 0,
        tax_ids: [],
        display_type: null,
        name: null,
        sequence: null,
        customer_lead: null,
        warehouse_id: null,
        route_id: null,
        analytic_account_id: null,
      },
    ],
    { withCompany: true },
  )

  await callReducerBff(page, "confirm_sales_order", [orgId, orderId])

  const pickingId = await fetchFulfillmentPickingIdBySaleOrderId(page, orderId)
  await callReducerBff(
    page,
    "confirm_stock_picking",
    [orgId, pickingId, { company_id: companyId }],
    { withCompany: true },
  )
  await callReducerBff(
    page,
    "assign_stock_picking",
    [orgId, pickingId, { company_id: companyId }],
    { withCompany: true },
  )

  return pickingId
}

async function runPermissionCycle(options: {
  browser: Browser
  adminPage: Page
  reducer: string
  grant: { resource: string; action: string }
  preparePrimary: () => Promise<unknown[]>
  prepareSecondary: () => Promise<unknown[]>
  assertSuccess: (page: Page, args: unknown[]) => Promise<void>
}) {
  const { browser, adminPage, reducer, grant, preparePrimary, prepareSecondary, assertSuccess } =
    options

  const primaryArgs = await preparePrimary()

  await withLimitedUserSession(browser, async (limitedPage) => {
    await expectReducerPermissionDenied(limitedPage, reducer, primaryArgs)
  })

  await grantPermissionViaSettings(adminPage, {
    roleId: limitedRoleId,
    resource: grant.resource,
    action: grant.action,
  })

  await withLimitedUserSession(browser, async (limitedPage) => {
    await callReducerBff(limitedPage, reducer, primaryArgs)
    await assertSuccess(limitedPage, primaryArgs)
  })

  const permissionId = await fetchOrgPermissionId(adminPage, grant.resource)
  await revokePermissionViaSettings(adminPage, permissionId)

  const secondaryArgs = await prepareSecondary()
  await withLimitedUserSession(browser, async (limitedPage) => {
    await expectReducerPermissionDenied(limitedPage, reducer, secondaryArgs)
  })
}

test.describe("Auth permission enforcement", { tag: ["@p0", "@auth-hardening"] }, () => {
  test.describe.configure({ mode: "serial" })

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_STORAGE_PATH })
    const page = await context.newPage()
    orgId = await fetchSessionOrganizationId(page)
    const roleName = smokeName("perm-limited")
    limitedRoleId = await createLimitedRole(page, roleName)
    limitedUser = await provisionLimitedUserViaInvite(page, orgId, limitedRoleId)
    await context.close()
  })

  test("post_account_move is denied without write permission and succeeds after RBAC grant", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000)

    // Seed exposes a single balanced draft misc entry; reuse it for deny → grant → revoke → deny,
    // then grant again before posting (posting consumes the draft).
    const moveId = await fetchDraftMoveIdByName(page, SEEDED_DRAFT_MOVE_NAME)
    const args = [orgId, moveId]

    await withLimitedUserSession(browser, async (limitedPage) => {
      await expectReducerPermissionDenied(limitedPage, "post_account_move", args)
    })

    await grantPermissionViaSettings(page, {
      roleId: limitedRoleId,
      resource: "account_move",
      action: "Write",
    })

    let permissionId = await fetchOrgPermissionId(page, "account_move")
    await revokePermissionViaSettings(page, permissionId)

    await withLimitedUserSession(browser, async (limitedPage) => {
      await expectReducerPermissionDenied(limitedPage, "post_account_move", args)
    })

    await grantPermissionViaSettings(page, {
      roleId: limitedRoleId,
      resource: "account_move",
      action: "Write",
    })

    await withLimitedUserSession(browser, async (limitedPage) => {
      await callReducerBff(limitedPage, "post_account_move", args)
      await waitForMovePosted(limitedPage, moveId)
    })

    permissionId = await fetchOrgPermissionId(page, "account_move")
    await revokePermissionViaSettings(page, permissionId)
  })

  test("validate_stock_picking is denied without write permission and succeeds after RBAC grant", async ({
    browser,
    page,
  }) => {
    test.setTimeout(300_000)

    let primaryPickingId = 0
    let secondaryPickingId = 0
    const companyId = await fetchDefaultCompanyId(page)

    await runPermissionCycle({
      browser,
      adminPage: page,
      reducer: "validate_stock_picking",
      grant: { resource: "stock_picking", action: "Write" },
      preparePrimary: async () => {
        primaryPickingId = await adminPrepareAssignedPicking(page)
        return [orgId, primaryPickingId, { company_id: companyId }]
      },
      prepareSecondary: async () => {
        secondaryPickingId = await adminPrepareAssignedPicking(page)
        return [orgId, secondaryPickingId, { company_id: companyId }]
      },
      assertSuccess: async (limitedPage, args) => {
        const pickingId = Number(args[1])
        await expect
          .poll(
            async () => {
              const res = await limitedPage.request.get("/api/query/stock-pickings")
              if (!res.ok()) return ""
              const json = (await res.json()) as {
                data?: Array<{ id?: unknown; state?: unknown }>
              }
              const row = (json.data ?? []).find((p) => scalarQueryId(p.id) === pickingId)
              return String(row?.state ?? "").toLowerCase()
            },
            { timeout: 30_000 },
          )
          .toBe("done")
      },
    })
  })

  test("post_payment is denied without post permission and succeeds after RBAC grant", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000)

    let primaryPaymentId = 0
    let secondaryPaymentId = 0

    await runPermissionCycle({
      browser,
      adminPage: page,
      reducer: "post_payment",
      grant: { resource: "payment", action: "All" },
      preparePrimary: async () => {
        primaryPaymentId = await adminCreateDraftPayment(page)
        return [orgId, primaryPaymentId]
      },
      prepareSecondary: async () => {
        secondaryPaymentId = await adminCreateDraftPayment(page)
        return [orgId, secondaryPaymentId]
      },
      assertSuccess: async (limitedPage, args) => {
        const paymentId = Number(args[1])
        await waitForPaymentPosted(limitedPage, paymentId)
      },
    })
  })
})

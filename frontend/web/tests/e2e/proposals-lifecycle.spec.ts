/**
 * PRO-007: proposal create → publish (submit) → approve → award → convert to sale order.
 *
 * Setup (customer partner + proposal + line item + bid decision + status walk + award
 * approval) goes through the reducer BFF directly, matching the pattern used in
 * accounting-post-reconcile.spec.ts. The UI interaction under test stays focused on
 * verifying the proposal row is visible and no app error surfaces after conversion.
 */
import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  expectNoAppError,
  fetchContactIdByName,
  fetchCurrencyIdByCode,
  fetchDefaultCompanyId,
  fetchFirstPricelistId,
  fetchFirstWarehouseId,
  fetchProductIdByName,
  fetchProposalIdByTitle,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  selectEntityRowByText,
  smokeName,
} from "./helpers"

const some = <T,>(value: T) => ({ some: value })
const none = { none: [] as [] }

async function createCustomerPartner(
  page: Page,
  organizationId: number,
  name: string,
): Promise<number> {
  await callReducerBff(page, "create_contact", [
    organizationId,
    {
      name,
      type: "contact",
      email: some(`${name.toLowerCase().replace(/\s+/g, "-")}@example.test`),
      phone: none,
      mobile: none,
      company_id: none,
      is_customer: true,
      is_vendor: false,
      is_employee: false,
      is_prospect: false,
      is_partner: false,
      customer_rank: 17,
      supplier_rank: 0,
      display_name: none,
      first_name: none,
      last_name: none,
      title: none,
      email_secondary: none,
      fax: none,
      website: none,
      street: none,
      street2: none,
      city: none,
      state_code: none,
      zip: none,
      country_code: some("US"),
      tax_id: none,
      company_registry: none,
      industry: none,
      employees_count: none,
      annual_revenue: none,
      description: none,
      salesperson_id: none,
      assigned_user_id: none,
      parent_id: none,
      user_id: none,
      color: none,
      metadata: some(JSON.stringify({ test: "pro-007-lifecycle" })),
    },
  ])
  return fetchContactIdByName(page, name)
}

function proposalStateTag(state: unknown): string {
  if (state == null) return ""
  if (typeof state === "string") return state
  if (typeof state === "object" && !Array.isArray(state)) {
    const obj = state as Record<string, unknown>
    if (typeof obj.tag === "string") return obj.tag
  }
  return String(state)
}

test.describe("PRO-007 proposal → publish → convert lifecycle @proposals @p0", () => {
  test("create proposal → publish → approve → award → convert to sale order @p0", async ({ page }) => {
    test.setTimeout(180_000)
    await gotoModule(page, "/proposals", "proposals")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const currencyId = await fetchCurrencyIdByCode(page, "USD")

    const partnerName = smokeName("pro007-partner")
    const partnerId = await createCustomerPartner(page, organizationId, partnerName)

    const productName = "Seeded Product"
    const productId = await fetchProductIdByName(page, productName)
    const warehouseId = await fetchFirstWarehouseId(page)
    const pricelistId = await fetchFirstPricelistId(page)

    const proposalTitle = smokeName("pro007-proposal")
    const nowMicros = Date.now() * 1000
    await callReducerBff(page, "create_proposal", [
      organizationId,
      companyId,
      {
        title: proposalTitle,
        client_name: partnerName,
        currency_id: currencyId,
        value: 7500,
        deadline: some({ __timestamp_micros_since_unix_epoch__: nowMicros + 30 * 86400 * 1_000_000 }),
        description: some("PRO-007 e2e lifecycle proposal"),
        template_id: none,
        partner_id: some(partnerId),
        document_folder_id: none,
        metadata: none,
      },
    ])

    const proposalId = await fetchProposalIdByTitle(page, proposalTitle)
    expect(proposalId).toBeGreaterThan(0)

    await callReducerBff(page, "add_proposal_line_item", [
      organizationId,
      companyId,
      proposalId,
      {
        section_id: none,
        product_id: productId,
        product_name: productName,
        product_variant_id: none,
        description: none,
        quantity: 5,
        price_unit: 1500,
        discount: 0,
        notes: none,
      },
    ])

    await callReducerBff(page, "record_proposal_bid_decision", [
      organizationId,
      companyId,
      proposalId,
      { decision: "bid", rationale: "PRO-007 e2e — bid decision recorded before submit" },
    ])

    await callReducerBff(page, "update_proposal_status", [
      organizationId,
      companyId,
      proposalId,
      "review",
    ])

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/proposals")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Array<{ id?: unknown; status?: unknown }> }
        const row = (json.data ?? []).find((p) => scalarQueryId(p.id) === proposalId)
        return proposalStateTag(row?.status)
      }, { timeout: 45_000 })
      .toMatch(/Review/i)

    await callReducerBff(page, "update_proposal_status", [
      organizationId,
      companyId,
      proposalId,
      "submitted",
    ])

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/proposals")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Array<{ id?: unknown; status?: unknown }> }
        const row = (json.data ?? []).find((p) => scalarQueryId(p.id) === proposalId)
        return proposalStateTag(row?.status)
      }, { timeout: 45_000 })
      .toMatch(/Submitted/i)

    await callReducerBff(page, "approve_proposal", [
      organizationId,
      companyId,
      proposalId,
    ])

    await callReducerBff(page, "update_proposal_status", [
      organizationId,
      companyId,
      proposalId,
      "awarded",
    ])

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/proposals")
        if (!res.ok()) return ""
        const json = (await res.json()) as { data?: Array<{ id?: unknown; status?: unknown }> }
        const row = (json.data ?? []).find((p) => scalarQueryId(p.id) === proposalId)
        return proposalStateTag(row?.status)
      }, { timeout: 45_000 })
      .toMatch(/Awarded/i)

    await callReducerBff(page, "convert_proposal_to_sale_order", [
      organizationId,
      companyId,
      proposalId,
      { warehouse_id: warehouseId, pricelist_id: pricelistId },
    ])

    let saleOrderId = 0
    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/proposals")
        if (!res.ok()) return 0
        const json = (await res.json()) as {
          data?: Array<{
            id?: unknown
            saleOrderId?: unknown
            sale_order_id?: unknown
          }>
        }
        const row = (json.data ?? []).find((p) => scalarQueryId(p.id) === proposalId)
        saleOrderId = scalarQueryId(row?.saleOrderId ?? row?.sale_order_id) ?? 0
        return saleOrderId
      }, { timeout: 45_000 })
      .toBeGreaterThan(0)

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/sale-orders")
        if (!res.ok()) return false
        const json = (await res.json()) as { data?: Array<{ id?: unknown }> }
        return (json.data ?? []).some((o) => scalarQueryId(o.id) === saleOrderId)
      }, { timeout: 45_000 })
      .toBe(true)

    // The setup above goes through the reducer BFF directly, bypassing the
    // UI mutation hooks that call `invalidateQueries` on success — the
    // proposals list query (plain `useQuery`, not subscription-aware) has a
    // 30s staleTime and won't pick up the new row without a fresh fetch.
    // Reload so the module remounts and refetches, matching the pattern in
    // projects-wave-lifecycle.spec.ts.
    await page.reload()
    await gotoModule(page, "/proposals", "proposals")
    await page.getByTestId("module-tab-proposals-proposals").click()
    await selectEntityRowByText(page, proposalTitle)
    await expectNoAppError(page)
  })
})

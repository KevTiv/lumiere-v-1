import { expect, test } from "@playwright/test"
import {
  callReducerBff, callReducerOwner, fetchContactIdByName, fetchDefaultCompanyId, fetchProductIdByName,
  fetchSessionOrganizationId, gotoModule, scalarQueryId, selectEntityRowById, signIn, smokeName, submitForm,
} from "./helpers"
import { clickCanonicalHandoff, openCanonicalHandoffs } from "./cov25-link-navigation"
import { matchesOperationResponse } from "./operation-response"

test.describe("COV-25 proposal sale order link", { tag: ["@p0", "@cov25", "@unauthenticated"] }, () => {
  test("unconverted has none; conversion's exact sale_order_id link survives refresh/back", async ({ page }) => {
    test.setTimeout(300_000)
    await signIn(page, "test@email.com", process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$")
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const companies = await page.request.get("/api/query/companies")
    expect(companies.ok()).toBe(true)
    const company = ((await companies.json()) as { data: Record<string, unknown>[] }).data
      .find((row) => scalarQueryId(row.id) === companyId)
    const currencyId = scalarQueryId(company?.currencyId ?? company?.currency_id)
    if (currencyId == null) throw new Error("Fixture company has no currency")
    const none = { none: [] }
    const some = (value: unknown) => ({ some: value })
    const title = smokeName("cov25-proposal")
    const partnerId = await fetchContactIdByName(page, "Acme Corporation")
    const productId = await fetchProductIdByName(page, "Seeded Product")
    // Source fixture authored by the owner, not the operator who will award it.
    await callReducerOwner("create_proposal", [organizationId, companyId, {
      title, client_name: "Acme Corporation", currency_id: currencyId, value: 10,
      deadline: none, description: none, template_id: none, partner_id: some(partnerId),
      document_folder_id: none, metadata: none,
    }])
    const proposals = async () => {
      const response = await page.request.get("/api/query/proposals")
      expect(response.ok()).toBe(true)
      return ((await response.json()) as { data: Record<string, unknown>[] }).data
    }
    const created = (await proposals()).filter((row) => row.title === title)
    expect(created).toHaveLength(1)
    const proposalId = scalarQueryId(created[0]?.id)
    if (proposalId == null) throw new Error("Source proposal has no ID")
    const source = { module: "proposals", tab: "proposals", id: proposalId }
    const emptySheet = await openCanonicalHandoffs(page, source)
    await expect(emptySheet.getByTestId("proposal-handoff-none")).toBeVisible()
    // Preparation only. Award/conversion remain the existing visible operator actions.
    await callReducerBff(page, "add_proposal_line_item", [organizationId, companyId, proposalId, {
      section_id: none, product_id: productId, product_name: "Seeded Product", product_variant_id: none,
      description: none, quantity: 1, price_unit: 10, discount: 0, notes: none,
    }])
    await callReducerBff(page, "update_proposal_status", [organizationId, companyId, proposalId, "review"])
    await callReducerBff(page, "record_proposal_bid_decision", [organizationId, companyId, proposalId, { decision: "bid", rationale: "COV25 source fixture" }])
    await callReducerBff(page, "update_proposal_status", [organizationId, companyId, proposalId, "submitted"])
    await gotoModule(page, "/proposals", "proposals")
    await page.getByTestId("module-tab-proposals-proposals").click()
    await selectEntityRowById(page, proposalId)
    const statusResponse = page.waitForResponse((candidate) => matchesOperationResponse(candidate, "update_proposal_status"))
    const [awarded] = await Promise.all([
      page.waitForResponse((candidate) => matchesOperationResponse(candidate, "approve_proposal")),
      page.getByTestId("entity-action-award-proposal").click(),
    ])
    expect(awarded.ok()).toBe(true)
    expect((await statusResponse).ok()).toBe(true)
    await gotoModule(page, "/proposals", "proposals")
    await page.getByTestId("module-tab-proposals-proposals").click()
    await selectEntityRowById(page, proposalId)
    await page.getByTestId("entity-action-convert-proposal-order").click()
    await expect(page.getByTestId("form-modal-convert-proposal-order")).toBeVisible()
    const [converted] = await Promise.all([
      page.waitForResponse((candidate) => matchesOperationResponse(candidate, "convert_proposal_to_sale_order")),
      submitForm(page, "convert-proposal-order"),
    ])
    expect(converted.ok()).toBe(true)
    const orderId = async () => {
      const matches = (await proposals()).filter((row) => scalarQueryId(row.id) === proposalId)
      expect(matches).toHaveLength(1)
      return scalarQueryId(matches[0]?.saleOrderId ?? matches[0]?.sale_order_id)
    }
    await expect.poll(orderId).not.toBeNull()
    const saleOrderId = await orderId()
    if (saleOrderId == null) throw new Error("Proposal has no exact sale_order_id")
    const sheet = await openCanonicalHandoffs(page, source)
    await expect(sheet.locator('[data-testid^="proposal-handoff-order-"]')).toHaveCount(1)
    await clickCanonicalHandoff(page, source, `proposal-handoff-order-${saleOrderId}`, { module: "sales", tab: "orders", id: saleOrderId })

    // Adversarial projection proof, not a claim that duplicate primary keys can persist.
    // A corrupted/duplicated canonical read must suppress the 0..1 link, never pick the first row.
    await page.route("**/api/query/sale-orders*", async (route) => {
      const response = await route.fetch()
      const payload = await response.json() as { data: Record<string, unknown>[] }
      const exact = payload.data.filter((row) => scalarQueryId(row.id) === saleOrderId)
      expect(exact).toHaveLength(1)
      await route.fulfill({ response, json: { ...payload, data: [...payload.data, exact[0]!] } })
    })
    try {
      const ambiguous = await openCanonicalHandoffs(page, source)
      await expect(ambiguous.getByTestId("proposal-handoff-invariant_failure")).toBeVisible()
      await expect(ambiguous.locator('[data-testid^="proposal-handoff-order-"]')).toHaveCount(0)
    } finally {
      await page.unroute("**/api/query/sale-orders*")
    }
  })
})

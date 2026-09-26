import { expect, test, type Page, type Request, type Response } from "@playwright/test"

import {
  callReducerBff,
  callReducerOwner,
  fetchContactIdByName,
  fetchDefaultCompanyId,
  fetchProductIdByName,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-17 — see docs/plan/erp-cov17-proposal-approve-convert-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

function statusKey(status: unknown): string {
  if (typeof status === "string") return status.trim().toLowerCase()
  if (status && typeof status === "object" && !Array.isArray(status)) {
    const record = status as Record<string, unknown>
    if (typeof record.tag === "string") return record.tag.toLowerCase()
    const keys = Object.keys(record)
    if (keys.length === 1) return keys[0]!.toLowerCase()
  }
  return ""
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function proposalSnapshot(page: Page, proposalId: number) {
  const matches = (await rows(page, "proposals")).filter((row) => scalarQueryId(row.id) === proposalId)
  if (matches.length !== 1) throw new Error(`expected one proposal ${proposalId}, found ${matches.length}`)
  const row = matches[0]!
  return {
    id: proposalId,
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    status: statusKey(row.status),
    saleOrderId: scalarQueryId(row.saleOrderId ?? row.sale_order_id),
  }
}

/** Exactly one sale order with this id, in the expected scope. */
async function saleOrderScope(page: Page, saleOrderId: number) {
  const matches = (await rows(page, "sale-orders")).filter((row) => scalarQueryId(row.id) === saleOrderId)
  return matches.map((row) => ({
    id: saleOrderId,
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
  }))
}

async function selectProposal(page: Page, proposalId: number) {
  await gotoModule(page, "/proposals", "proposals")
  await page.getByTestId("module-tab-proposals-proposals").click()
  await selectEntityRowById(page, proposalId)
}

/** Select one proposal and click Award; returns the approve response and, if it follows, the status response. */
async function awardViaUi(page: Page, proposalId: number) {
  await selectProposal(page, proposalId)
  const action = page.getByTestId("entity-action-award-proposal")
  await expect(action).toBeEnabled()
  const statusResponse: Promise<Response | null> = page
    .waitForResponse((candidate) => matchesOperationResponse(candidate, "update_proposal_status"), { timeout: 30_000 })
    .catch(() => null)
  const [approve] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, "approve_proposal"), { timeout: 30_000 }),
    action.click(),
  ])
  return { approve, status: approve.ok() ? await statusResponse : null }
}

test.describe("COV-17 exact proposal award and conversion", { tag: ["@p0", "@cov17"] }, () => {
  test("a second person awards and converts; self-approval, replays and reader are rejected", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const company = (await rows(page, "companies")).find((row) => scalarQueryId(row.id) === companyId)
    const currencyId = scalarQueryId(company?.currencyId ?? company?.currency_id)
    if (currencyId == null) throw new Error("default company has no currency")

    // ── Fixtures (setup calls only) ─────────────────────────────────────────
    const tag = smokeName("cov17")
    // A customer partner and one product line make the awarded proposal convertible.
    const partnerName = `${tag} customer`
    await callReducerBff(page, "create_contact", [organizationId, {
      name: partnerName,
      type: "contact",
      email: some(`${tag}@example.test`),
      phone: none,
      mobile: none,
      company_id: none,
      is_customer: true,
      is_vendor: false,
      is_employee: false,
      is_prospect: false,
      is_partner: false,
      customer_rank: 1,
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
      metadata: some(JSON.stringify({ fixture: "COV-17" })),
    }])
    const partnerId = await fetchContactIdByName(page, partnerName)
    const productName = "Seeded Product"
    const productId = await fetchProductIdByName(page, productName)

    const createSubmitted = async (title: string, author: "owner" | "admin") => {
      const args = [organizationId, companyId, {
        title,
        client_name: partnerName,
        currency_id: currencyId,
        value: 2500,
        deadline: none,
        description: none,
        template_id: none,
        partner_id: some(partnerId),
        document_folder_id: none,
        metadata: none,
      }]
      // The owner identity authors proposal A, so the admin is a second person.
      if (author === "owner") await callReducerOwner("create_proposal", args)
      else await callReducerBff(page, "create_proposal", args)
      const created = (await rows(page, "proposals")).filter((row) => row.title === title)
      expect(created).toHaveLength(1)
      const proposalId = scalarQueryId(created[0]?.id)
      if (proposalId == null) throw new Error(`${title} has no id`)
      await callReducerBff(page, "add_proposal_line_item", [organizationId, companyId, proposalId, {
        section_id: none,
        product_id: productId,
        product_name: productName,
        product_variant_id: none,
        description: none,
        quantity: 2,
        price_unit: 1250,
        discount: 0,
        notes: none,
      }])
      await callReducerBff(page, "update_proposal_status", [organizationId, companyId, proposalId, "review"])
      await callReducerBff(page, "record_proposal_bid_decision", [organizationId, companyId, proposalId, {
        decision: "bid",
        rationale: "COV-17 fixture bid decision",
      }])
      await callReducerBff(page, "update_proposal_status", [organizationId, companyId, proposalId, "submitted"])
      return proposalId
    }
    const othersProposal = await createSubmitted(`${tag}-others`, "owner")
    const ownProposal = await createSubmitted(`${tag}-own`, "admin")
    const snapshot = (id: number, status: string) => ({ id, organizationId, companyId, status, saleOrderId: null })
    expect(await proposalSnapshot(page, othersProposal)).toEqual(snapshot(othersProposal, "submitted"))
    expect(await proposalSnapshot(page, ownProposal)).toEqual(snapshot(ownProposal, "submitted"))

    // ── Operator path ───────────────────────────────────────────────────────
    // The author cannot approve their own proposal; it stays Submitted.
    const selfAward = await awardViaUi(page, ownProposal)
    expect(selfAward.approve.status()).toBe(422)
    expect(await proposalSnapshot(page, ownProposal)).toEqual(snapshot(ownProposal, "submitted"))

    // A second person approves and awards.
    const award = await awardViaUi(page, othersProposal)
    expect(award.approve.ok()).toBe(true)
    expect(award.status?.ok()).toBe(true)
    const effect = snapshot(othersProposal, "awarded")
    await expect.poll(() => proposalSnapshot(page, othersProposal), { timeout: 30_000 }).toEqual(effect)

    for (const request of [award.approve.request(), award.status!.request()]) {
      const stale = await replay(page, request)
      expect(stale.status()).toBe(422)
      expect(await proposalSnapshot(page, othersProposal)).toEqual(effect)
    }

    // Convert the awarded proposal through Proposals → Convert to sale order.
    await selectProposal(page, othersProposal)
    const convertAction = page.getByTestId("entity-action-convert-proposal-order")
    await expect(convertAction).toBeEnabled()
    await convertAction.click()
    await expect(page.getByTestId("form-modal-convert-proposal-order")).toBeVisible()
    const [converted] = await Promise.all([
      page.waitForResponse(
        (candidate) => matchesOperationResponse(candidate, "convert_proposal_to_sale_order"),
        { timeout: 30_000 },
      ),
      page.getByTestId("form-submit-convert-proposal-order").click(),
    ])
    expect(converted.ok()).toBe(true)

    // The order resolves only through the proposal's own sale_order_id relation.
    await expect
      .poll(async () => (await proposalSnapshot(page, othersProposal)).saleOrderId, { timeout: 30_000 })
      .not.toBeNull()
    const convertedEffect = await proposalSnapshot(page, othersProposal)
    expect(convertedEffect).toMatchObject({ id: othersProposal, organizationId, companyId, status: "awarded" })
    const saleOrderId = convertedEffect.saleOrderId!
    expect(await saleOrderScope(page, saleOrderId)).toEqual([{ id: saleOrderId, organizationId, companyId }])

    const staleConvert = await replay(page, converted.request())
    expect(staleConvert.status()).toBe(422)
    expect(await proposalSnapshot(page, othersProposal)).toEqual(convertedEffect)
    expect(await saleOrderScope(page, saleOrderId)).toEqual([{ id: saleOrderId, organizationId, companyId }])

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      for (const request of [award.approve.request(), award.status!.request(), converted.request()]) {
        const denied = await replay(readerPage, request)
        expect(denied.status()).toBe(403)
        expect(await proposalSnapshot(page, othersProposal)).toEqual(convertedEffect)
      }
    } finally {
      await readerContext.close()
    }
  })
})

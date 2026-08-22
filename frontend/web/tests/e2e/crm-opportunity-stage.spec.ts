import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  expectFormModalVisible,
  expectNoAppError,
  expectSeededText,
  fetchFirstOpportunityStageId,
  fetchLeadIdByName,
  fetchOpportunityIdByName,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  openEntityCreate,
  scalarQueryId,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
  waitForEntityActionEnabled,
} from "./helpers"

const PROPOSAL_STAGE_LABEL = /Proposal \/ Price Quote/i
const WON_STAGE_LABEL = /^Won$/i

const some = <T,>(value: T) => ({ some: value })
const none = { none: [] as [] }

async function fetchWonOpportunityStageId(page: Page): Promise<number> {
  const res = await page.request.get("/api/query/opportunity-stages")
  if (!res.ok()) throw new Error(`opportunity-stages query failed: ${res.status()}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: unknown; isWon?: boolean; is_won?: boolean }>
  }
  const row = (json.data ?? []).find((s) => s.isWon === true || s.is_won === true)
  const id = scalarQueryId(row?.id)
  if (id == null) throw new Error("no won opportunity stage in seed data")
  return id
}

test.describe("CRM opportunity stage workflow", { tag: "@phase-1" }, () => {
  test("changes opportunity stage before conversion", async ({ page }) => {
    test.setTimeout(120_000)

    const contactName = smokeName("stage-contact")
    const oppName = smokeName("stage-opp")

    await openEntityCreate(page, "/crm", "crm", "contacts", "new-contact")
    await fillField(page, "name", contactName)
    await fillField(page, "email", `${contactName}@example.test`)
    await submitForm(page, "new-contact")
    await expect(page.getByText(contactName).first()).toBeVisible({ timeout: 30_000 })

    await openEntityCreate(page, "/crm", "crm", "opportunities", "new-opportunity")
    await waitForBffQueryMinRows(page, "/api/query/opportunity-stages")
    await fillField(page, "name", oppName)
    await fillField(page, "expectedRevenue", "1500")
    await chooseFirstEnabledOption(page, "stageId")
    const [createOppRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/create_opportunity") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-opportunity"),
    ])
    expect(createOppRes.ok()).toBe(true)

    const readStageId = async (): Promise<number | null> => {
      const res = await page.request.get("/api/query/opportunities")
      if (!res.ok()) return null
      const json = (await res.json()) as {
        data?: Array<{ name?: string; stageId?: number | string; stage_id?: number | string }>
      }
      const row = (json.data ?? []).find((o) => o.name === oppName)
      if (!row) return null
      const raw = row.stageId ?? row.stage_id
      return raw == null ? null : Number(raw)
    }

    await expect.poll(readStageId, { timeout: 30_000 }).toBeGreaterThan(0)
    const initialStageId = await readStageId()
    if (initialStageId == null) throw new Error(`opportunity not found after create: ${oppName}`)

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await selectEntityRowByText(page, oppName)
    await waitForEntityActionEnabled(page, "entity-action-change-stage")
    await page.getByTestId("entity-action-change-stage").click()
    await expect(page.getByTestId("form-modal-change-opportunity-stage")).toBeVisible()
    await chooseSelectOptionByLabel(page, "stageId", PROPOSAL_STAGE_LABEL)
    const [stageRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/update_opportunity") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "change-opportunity-stage"),
    ])
    expect(stageRes.ok()).toBe(true)

    await expect.poll(readStageId, { timeout: 30_000 }).not.toBe(initialStageId)

    await expectNoAppError(page)
  })
})

test.describe("CRM-006 lead → opportunity → won conversion @p0", { tag: "@p0" }, () => {
  test("creates a qualified lead, converts it to an opportunity, then marks it won", async ({
    page,
  }) => {
    test.setTimeout(180_000)

    const organizationId = await fetchSessionOrganizationId(page)
    const stageId = await fetchFirstOpportunityStageId(page)
    const wonStageId = await fetchWonOpportunityStageId(page)
    const leadName = smokeName("conv-lead")
    const opportunityName = `${leadName} - Opportunity`

    await callReducerBff(page, "create_lead", [
      organizationId,
      {
        name: leadName,
        priority: "1",
        state: "qualified",
        expected_revenue: 5000,
        probability: 20,
        tag_ids: [],
        email: some(`${leadName}@example.test`),
        phone: none,
        mobile: none,
        company_name: some(`${leadName} Co`),
        contact_name: some(leadName),
        title: none,
        street: none,
        city: none,
        zip: none,
        country_code: none,
        website: none,
        industry: none,
        source_id: none,
        campaign_id: none,
        medium_id: none,
        referred_by: none,
        description: none,
        user_id: none,
        stage_id: none,
        team_id: none,
        partner_id: none,
        date_deadline: none,
        metadata: none,
      },
    ])

    const leadId = await fetchLeadIdByName(page, leadName)
    expect(leadId).toBeGreaterThan(0)

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-leads").click()
    await waitForBffQueryMinRows(page, "/api/query/opportunity-stages")
    await selectEntityRowByText(page, leadName)
    await waitForEntityActionEnabled(page, "entity-action-convert-lead")
    await page.getByTestId("entity-action-convert-lead").click()
    await expectFormModalVisible(page, "convert-lead")
    await chooseFirstEnabledOption(page, "opportunityStageId")
    const [convertRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/convert_lead_to_customer") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "convert-lead"),
    ])
    expect(convertRes.ok()).toBe(true)

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/leads")
        if (!res.ok()) return ""
        const json = (await res.json()) as {
          data?: Array<{ id?: number; name?: string; state?: string }>
        }
        const row = (json.data ?? []).find((l) => l.name === leadName)
        return String(row?.state ?? "")
      }, { timeout: 30_000 })
      .toMatch(/converted/i)

    await page.reload()
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-opportunities").click()
    await expectSeededText(page, opportunityName, "/api/query/opportunities")
    const opportunityId = await fetchOpportunityIdByName(page, opportunityName)
    expect(opportunityId).toBeGreaterThan(0)

    const readOppStageId = async (): Promise<number | null> => {
      const res = await page.request.get("/api/query/opportunities")
      if (!res.ok()) return null
      const json = (await res.json()) as {
        data?: Array<{ name?: string; stageId?: unknown; stage_id?: unknown }>
      }
      const row = (json.data ?? []).find((o) => o.name === opportunityName)
      if (!row) return null
      return scalarQueryId(row.stageId ?? row.stage_id)
    }

    await expect.poll(readOppStageId, { timeout: 30_000 }).toBe(stageId)

    await selectEntityRowByText(page, opportunityName)
    await waitForEntityActionEnabled(page, "entity-action-change-stage")
    await page.getByTestId("entity-action-change-stage").click()
    await expect(page.getByTestId("form-modal-change-opportunity-stage")).toBeVisible()
    await chooseSelectOptionByLabel(page, "stageId", WON_STAGE_LABEL)
    const [wonRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/call/update_opportunity") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "change-opportunity-stage"),
    ])
    expect(wonRes.ok()).toBe(true)

    await expect.poll(readOppStageId, { timeout: 30_000 }).toBe(wonStageId)

    await expectNoAppError(page)
  })
})

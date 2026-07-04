import { expect, test } from "@playwright/test"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  expectNoAppError,
  fillField,
  gotoModule,
  openEntityCreate,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
  waitForEntityActionEnabled,
} from "./helpers"

const PROPOSAL_STAGE_LABEL = /Proposal \/ Price Quote/i

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

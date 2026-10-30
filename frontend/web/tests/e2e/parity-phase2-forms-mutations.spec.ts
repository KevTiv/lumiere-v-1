import { matchesOperationResponse } from "./operation-response"
import { expect, test, type Request } from "@playwright/test"
import { parseQueryListResponse } from "@lumiere/api-client"
import { moduleTabHref } from "@lumiere/erp-shared/record-links"
import { loseNextResponse } from "./pretenant-support"

import {
  addCustomFormFieldViaSettings,
  deleteCustomFormFieldViaSettings,
  dismissBlockingDialogs,
  expectNoAppError,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  fillField,
  openEntityCreate,
  reloadSettled,
  smokeName,
} from "./helpers"

function customFieldFixture(smokePrefix: string) {
  const fieldSlug = smokeName(smokePrefix)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
  return {
    fieldSlug,
    fieldLabel: `${fieldSlug} label`,
    fieldId: `custom:${fieldSlug}`,
  }
}

test.describe("Parity phase 2 — form config mutations", { tag: ["@p0", "@parity-phase-2"] }, () => {
  test("adds a custom field on the CRM new-lead form configuration", async ({ page }) => {
    test.setTimeout(180_000)

    const { fieldSlug, fieldLabel, fieldId } = customFieldFixture("e2e_notes")

    await addCustomFormFieldViaSettings(page, { fieldKey: fieldSlug, fieldLabel })
    await expect(page.getByTestId(`form-config-field-row-${fieldId}`)).toBeVisible({
      timeout: 30_000,
    })

    await deleteCustomFormFieldViaSettings(page, fieldId)
    await expect(page.getByTestId(`form-config-field-row-${fieldId}`)).toHaveCount(0, {
      timeout: 15_000,
    })

    await expectNoAppError(page)
  })

  test("atomically saves a configured lead and recovers a lost reply without another create", async ({ page }) => {
    test.setTimeout(180_000)
    const { fieldSlug, fieldLabel, fieldId } = customFieldFixture("e2e_eav")
    const leadName = smokeName("eav-lead")
    const customValue = `val-${fieldSlug}`
    await addCustomFormFieldViaSettings(page, { fieldKey: fieldSlug, fieldLabel })
    const organizationId = String(await fetchSessionOrganizationId(page))
    const companyId = String(await fetchDefaultCompanyId(page))
    const actorHex = (await page.context().cookies()).find((cookie) => cookie.name === "stdb_identity")?.value.replace(/^0x/i, "").toLowerCase()
    expect(actorHex).toMatch(/^[0-9a-f]{64}$/)
    const creates: Request[] = []
    const separateFieldWrites: Request[] = []
    const count = (request: Request) => {
      if (request.method() !== "POST") return
      if (matchesOperationResponse(request, "create_lead")) creates.push(request)
      if (matchesOperationResponse(request, "set_record_custom_field_values")) separateFieldWrites.push(request)
    }
    page.on("request", count)
    const rows = async (path: string) => {
      const response = await page.request.get(path)
      expect(response.ok(), `Authorized fixture read: ${path}`).toBe(true)
      return parseQueryListResponse(await response.json())
    }
    try {
      await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
      const modal = page.getByTestId("form-modal-new-lead")
      await fillField(page, "emailFrom", `${leadName}@example.test`)
      await fillField(page, "expectedRevenue", "250")
      await fillField(page, fieldId, customValue)
      await expect(page.getByTestId("form-submit-new-lead")).toBeEnabled()
      // A supported text field is admitted, while a missing required base
      // value must still reject locally and retain the configured input.
      await page.getByTestId("form-submit-new-lead").click()
      await expect(modal.getByTestId("form-field-contactName")).toHaveAttribute("aria-invalid", "true")
      await expect(modal.getByTestId(`form-field-${fieldId}`)).toHaveValue(customValue)
      expect(creates).toEqual([])
      expect((await rows("/api/query/leads")).filter((row) => row.name === leadName)).toEqual([])
      const valuesPath = `/api/query/record-custom-field-values?companyId=${companyId}`
      expect((await rows(valuesPath)).filter((row) => row.fieldKey === fieldId)).toEqual([])

      await fillField(page, "contactName", leadName)
      const dropped = await loseNextResponse(page, "create_lead")
      await page.getByTestId("form-submit-new-lead").click()
      await expect.poll(() => dropped.lost()).toBe(true)
      expect(creates).toHaveLength(1)
      const input = creates[0]!.postDataJSON() as { params: { metadata: { some: string } } }
      const metadata = JSON.parse(input.params.metadata.some) as Record<string, unknown> & {
        __lumiere_create_v1: { company_id: string; operation_key: string }
      }
      expect(metadata[fieldId]).toBe(customValue)
      const attempt = metadata.__lumiere_create_v1
      expect(attempt.company_id).toBe(companyId)
      expect(attempt.operation_key).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
      const receiptPath = `/api/query/lead-creations?${new URLSearchParams({ companyId, operationKey: attempt.operation_key })}`
      // The reply was dropped after the native transaction. Its receipt is the
      // identity authority; names and newest-row ordering never choose a lead.
      await expect.poll(async () => (await rows(receiptPath)).length).toBe(1)
      const receipts = await rows(receiptPath)
      const saved = receipts[0]!
      expect(Object.keys(saved).sort()).toEqual([
        "companyId", "createdAt", "createdBy", "id", "model", "operationKey", "organizationId", "payloadHash", "recordId",
      ])
      expect(saved).toMatchObject({
        id: `${organizationId}:${companyId}:crm_lead:${attempt.operation_key}`,
        organizationId, companyId, model: "crm_lead", operationKey: attempt.operation_key,
      })
      expect(saved.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(String(saved.createdBy).replace(/^0x/i, "").toLowerCase()).toBe(actorHex)
      expect(saved.recordId).toMatch(/^[1-9][0-9]*$/)
      const recordId = String(saved.recordId)
      await expect.poll(async () => ({
        leads: (await rows("/api/query/leads")).filter((row) => String(row.id) === recordId).length,
        values: (await rows(valuesPath)).filter((row) => row.fieldKey === fieldId && String(row.recordId) === recordId).length,
      })).toEqual({ leads: 1, values: 1 })
      const savedEffect = async () => {
        const leads = (await rows("/api/query/leads")).filter((row) => String(row.id) === recordId)
        expect(leads).toHaveLength(1)
        // Lead base rows are organization-shared; receipt and EAV carry the
        // exact operating company. Do not fabricate a lead company column.
        expect(String(leads[0]!.organizationId)).toBe(organizationId)
        expect(leads[0]!.name).toBe(leadName)
        expect(Number(leads[0]!.expectedRevenue)).toBe(250)
        expect((await rows("/api/query/leads")).filter((row) => row.name === leadName).map((row) => String(row.id))).toEqual([recordId])
        const values = (await rows(valuesPath)).filter((row) => row.fieldKey === fieldId)
        expect(values).toHaveLength(1)
        expect(values[0]).toMatchObject({ model: "crm_lead", fieldKey: fieldId })
        expect(String(values[0]!.organizationId)).toBe(organizationId)
        expect(String(values[0]!.companyId)).toBe(companyId)
        expect(String(values[0]!.recordId)).toBe(recordId)
        expect(JSON.parse(String(values[0]!.valueJson))).toBe(customValue)
        return { leadId: recordId, valueId: String(values[0]!.id), valueJson: values[0]!.valueJson }
      }
      const committed = await savedEffect()
      await expect(page.getByTestId("form-submit-new-lead")).toBeEnabled()
      await expect(modal.getByTestId("form-field-contactName")).toHaveValue(leadName)
      await expect(modal.getByTestId(`form-field-${fieldId}`)).toHaveValue(customValue)
      await dismissBlockingDialogs(page)
      await expect(modal).toBeHidden()
      await reloadSettled(page)
      const recovery = page.getByTestId("record-creation-recovery")
      await recovery.getByRole("button", { name: "Review entered values", exact: true }).click()
      const review = page.getByTestId("record-creation-review")
      // Both the lead title and contact-name entry retain this same value.
      await expect(review.getByText(leadName, { exact: true }).first()).toBeVisible()
      await expect(review.getByText(customValue, { exact: true })).toBeVisible()
      await review.getByRole("button", { name: "Check save status", exact: true }).click()
      await expect(review.getByRole("link", { name: "Open saved record in a new tab" })).toHaveAttribute("href", moduleTabHref("crm", "leads", { id: recordId }))
      await review.getByRole("button", { name: "Finish review", exact: true }).click()
      await expect(review).toBeHidden()
      await expect(recovery).toBeHidden()
      expect(await rows(receiptPath)).toEqual(receipts)
      expect(await savedEffect()).toEqual(committed)
      expect(creates).toHaveLength(1)
      expect(separateFieldWrites).toEqual([])
    } finally {
      page.off("request", count)
      await page.unrouteAll({ behavior: "wait" })
      await dismissBlockingDialogs(page)
      await expect(page.getByTestId("form-modal-new-lead")).toBeHidden()
      await deleteCustomFormFieldViaSettings(page, fieldId)
    }
    await expectNoAppError(page)
  })
})

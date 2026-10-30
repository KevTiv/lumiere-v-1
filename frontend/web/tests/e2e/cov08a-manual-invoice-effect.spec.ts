import { reviewInvoiceAccountingChoices } from "../invoice-accounting-choices"
import { randomUUID } from "node:crypto"
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp"

import { expect, test, type Page, type Request } from "@playwright/test"

import {
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  isoDate,
  gotoModule,
  scalarQueryId,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

function numberField(row: Row, camel: string, snake: string): number {
  return Number(row[camel] ?? row[snake])
}

async function chooseFirstPartner(page: Page): Promise<void> {
  await page.getByTestId("create-invoice-partner").click()
  await page.getByRole("option").first().click()
}

async function openManualInvoice(page: Page): Promise<void> {
  // Setup readiness is evaluated from several reads after each navigation.
  // An early click shows a blocking toast; wait for the actual modal to open.
  await expect(async () => {
    await page.getByTestId("accountant-overview").getByRole("button", { name: "New invoice", exact: true }).click()
    await expect(page.getByTestId("create-invoice-modal")).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
}

async function fillManualInvoice(page: Page, description: string): Promise<void> {
  await chooseFirstPartner(page)
  await page.getByTestId("create-invoice-line-description").fill(description)
  await page.getByTestId("create-invoice-line-unit-price").fill("90")
  await reviewInvoiceAccountingChoices(page)
  await expect(page.getByTestId("create-invoice-save-draft")).toBeEnabled()
}

function requestParams(request: Request): Record<string, unknown> {
  const body = request.postDataJSON() as { params?: Record<string, unknown> }
  if (!body.params) throw new Error("manual invoice operation request has no params")
  return body.params
}

function optionValue(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (Object.hasOwn(raw, "some")) return (raw as { some: unknown }).some
    if (Object.hasOwn(raw, "none")) return undefined
  }
  return raw
}
function exactId(raw: unknown): string {
  const scalar = optionValue(raw)
  if (typeof scalar === "number") expect(Number.isSafeInteger(scalar)).toBe(true)
  expect(typeof scalar === "string" || typeof scalar === "number").toBe(true)
  const result = String(scalar)
  expect(result).toMatch(/^[1-9]\d*$/)
  return result
}
function variantTag(raw: unknown): string {
  if (raw && typeof raw === "object") {
    if ("tag" in raw) return String(raw.tag).toLowerCase()
    return (Object.keys(raw)[0] ?? "").toLowerCase()
  }
  return String(raw ?? "").toLowerCase()
}

test.describe(
  "COV-08a exact manual invoice effect",
  { tag: ["@p0", "@cov08", "@cov08a"] },
  () => {
    test("creates one balanced canonical move and resolves an identical UI replay before dispatch", async ({
      page,
    }) => {
      test.setTimeout(180_000)

      const companyId = await fetchDefaultCompanyId(page)
      const description = smokeName("cov08a-manual-invoice")
      const browserRequestUuid = randomUUID()
      const expectedRequestKey = browserRequestUuid.replaceAll("-", "")

      await gotoModule(page, "/accounting", "accounting")
      await page.evaluate((value) => {
        Object.defineProperty(window.crypto, "randomUUID", {
          configurable: true,
          value: () => value,
        })
      }, browserRequestUuid)

      await openManualInvoice(page)
      await fillManualInvoice(page, description)

      const dispatchPromise = page.waitForResponse(
        (response) =>
          matchesOperationResponse(response, "create_manual_account_invoice"),
        { timeout: 30_000 },
      )
      await page.getByTestId("create-invoice-save-draft").click()
      const dispatch = await dispatchPromise
      expect(dispatch.ok()).toBe(true)
      await expect(page.getByTestId("create-invoice-modal")).toBeHidden({
        timeout: 30_000,
      })

      const params = requestParams(dispatch.request())
      expect(params.idempotency_key).toBe(expectedRequestKey)
      expect(scalarQueryId(params.company_id)).toBe(companyId)
      expect(params.lines).toEqual([
        expect.objectContaining({
          name: description,
          quantity: 1,
          price_unit: 90,
          discount: 0,
          tax_ids: [],
        }),
      ])

      const result = await page.request.get(
        `/api/accounting/manual-invoice-results/${companyId}/${expectedRequestKey}`,
      )
      expect(result.ok()).toBe(true)
      const effect = (await result.json()) as {
        data?: { resource?: string; id?: string; href?: string }
      }
      expect(effect.data?.resource).toBe("account-moves")
      const moveId = scalarQueryId(effect.data?.id)
      if (moveId == null) throw new Error("manual invoice result has no move id")
      expect(effect.data?.href).toBe(`/accounting/invoices/${moveId}`)

      await expect(page).toHaveURL(
        new RegExp(`/accounting/invoices/${moveId}$`),
        { timeout: 30_000 },
      )

      await expect
        .poll(
          async () => {
            const move = (await rows(page, "account-moves")).find(
              (row) => scalarQueryId(row.id) === moveId,
            )
            if (!move) return null
            return {
              companyId: scalarQueryId(move.companyId ?? move.company_id),
              amountUntaxed: numberField(move, "amountUntaxed", "amount_untaxed"),
              amountTax: numberField(move, "amountTax", "amount_tax"),
              amountTotal: numberField(move, "amountTotal", "amount_total"),
            }
          },
          { timeout: 30_000 },
        )
        .toEqual({
          companyId,
          amountUntaxed: 90,
          amountTax: 0,
          amountTotal: 90,
        })

      await expect
        .poll(
          async () =>
            (await rows(page, "account-move-lines")).filter(
              (row) => scalarQueryId(row.moveId ?? row.move_id) === moveId,
            ).length,
          { timeout: 30_000 },
        )
        .toBe(2)
      const canonicalLines = (await rows(page, "account-move-lines")).filter(
        (row) => scalarQueryId(row.moveId ?? row.move_id) === moveId,
      )
      expect(canonicalLines).toHaveLength(2)
      expect(
        canonicalLines.reduce(
          (sum, row) => sum + numberField(row, "debit", "debit"),
          0,
        ),
      ).toBeCloseTo(90, 2)
      expect(
        canonicalLines.reduce(
          (sum, row) => sum + numberField(row, "credit", "credit"),
          0,
        ),
      ).toBeCloseTo(90, 2)

      await gotoModule(page, "/accounting", "accounting")
      await page.evaluate((value) => {
        Object.defineProperty(window.crypto, "randomUUID", {
          configurable: true,
          value: () => value,
        })
      }, browserRequestUuid)
      await openManualInvoice(page)
      await fillManualInvoice(page, description)
      let replayDispatches = 0
      const countReplay = (request: Request) => {
        if (matchesOperationResponse(request, "create_manual_account_invoice")) {
          replayDispatches += 1
        }
      }
      page.on("request", countReplay)
      try {
        await page.getByTestId("create-invoice-save-draft").click()
        await expect(page.getByTestId("create-invoice-modal")).toBeHidden({
          timeout: 30_000,
        })
      } finally {
        page.off("request", countReplay)
      }

      expect(replayDispatches).toBe(0)
      const replayResult = await page.request.get(
        `/api/accounting/manual-invoice-results/${companyId}/${expectedRequestKey}`,
      )
      expect(await replayResult.json()).toEqual(effect)
      expect(
        (await rows(page, "account-move-lines")).filter(
          (row) => scalarQueryId(row.moveId ?? row.move_id) === moveId,
        ),
      ).toHaveLength(2)
    })

    test("saves a vendor bill as one exact balanced InInvoice draft and retains it after canonical reload", async ({ page }, testInfo) => {
      test.setTimeout(120_000)
      const [company, organization] = await Promise.all([
        fetchDefaultCompanyId(page), fetchSessionOrganizationId(page),
      ])
      const companyId = exactId(company), organizationId = exactId(organization)
      const description = smokeName("alpha-vendor-bill-effect")
      const invoiceDate = isoDate(), dueDate = isoDate(30)
      const writes: Request[] = []
      page.on("request", (request) => {
        if (request.method() === "POST" && matchesOperationResponse(request, "create_manual_account_invoice")) writes.push(request)
      })
      await gotoModule(page, "/accounting?tab=dashboard", "accounting")
      // This is the active bill entry used by the authoring preview cases.
      await expect(async () => {
        await page.getByTestId("quick-action-create_bill").click()
        await expect(page.getByTestId("create-invoice-modal")).toBeVisible({ timeout: 5_000 })
      }).toPass({ timeout: 60_000 })
      const modal = page.getByTestId("create-invoice-modal")
      await chooseFirstPartner(page)
      await modal.getByTestId("create-invoice-line-description").fill(description)
      await modal.getByLabel("Item 1 quantity", { exact: true }).fill("2")
      await modal.getByTestId("create-invoice-line-unit-price").fill("37.50")
      await reviewInvoiceAccountingChoices(page)
      await modal.locator("#create-invoice-date").fill(invoiceDate)
      await modal.locator("#create-invoice-due-date").fill(dueDate)
      await expect(modal.getByRole("textbox", { name: "Currency", exact: true })).toHaveAttribute("readonly", "")
      await expect(modal.getByTestId("create-invoice-save-draft")).toBeEnabled()
      const dispatchPromise = page.waitForResponse((response) => matchesOperationResponse(response, "create_manual_account_invoice"))
      await modal.getByTestId("create-invoice-save-draft").click()
      const dispatch = await dispatchPromise
      expect(dispatch.ok(), await dispatch.text()).toBe(true)
      await expect(modal).toBeHidden({ timeout: 30_000 })
      expect(writes).toHaveLength(1)
      const params = requestParams(dispatch.request())
      const requestKey = String(params.idempotency_key)
      expect(requestKey).toMatch(/^[a-f0-9]{32}$/)
      expect(exactId(params.company_id)).toBe(companyId)
      expect(variantTag(params.move_type)).toBe("ininvoice")
      expect(params.lines).toEqual([expect.objectContaining({ name: description, quantity: 2, price_unit: 37.5, discount: 0, tax_ids: [] })])
      const resultUrl = `/api/accounting/manual-invoice-results/${companyId}/${requestKey}`
      const result = await page.request.get(resultUrl)
      expect(result.ok()).toBe(true)
      const effect = await result.json() as { data?: { resource?: string; id?: string; href?: string } }
      expect(effect.data?.resource).toBe("account-moves")
      const moveId = exactId(effect.data?.id)
      expect(effect.data?.href).toBe(`/accounting/invoices/${moveId}`)
      await expect(page).toHaveURL(new RegExp(`/accounting/invoices/${moveId}$`), { timeout: 30_000 })
      const verifySaved = async () => {
        const moves = (await rows(page, "account-moves")).filter((row) => exactId(row.id) === moveId)
        expect(moves).toHaveLength(1)
        const move = moves[0]!
        expect(exactId(move.organizationId ?? move.organization_id)).toBe(organizationId)
        expect(exactId(move.companyId ?? move.company_id)).toBe(companyId)
        expect(exactId(move.partnerId ?? move.partner_id)).toBe(exactId(params.partner_id))
        expect(exactId(move.journalId ?? move.journal_id)).toBe(exactId(params.journal_id))
        expect(exactId(move.currencyId ?? move.currency_id)).toBe(exactId(params.currency_id))
        expect(variantTag(move.moveType ?? move.move_type)).toBe("ininvoice")
        expect(variantTag(move.state)).toBe("draft")
        expect(move.postedBefore ?? move.posted_before).toBe(false)
        expect(numberField(move, "amountUntaxed", "amount_untaxed")).toBe(75)
        expect(numberField(move, "amountTax", "amount_tax")).toBe(0)
        expect(numberField(move, "amountTotal", "amount_total")).toBe(75)
        expect(stbTimestampMicros(optionValue(move.invoiceDate ?? move.invoice_date))).toBe(BigInt(Date.parse(invoiceDate)) * 1_000n)
        expect(stbTimestampMicros(optionValue(move.invoiceDateDue ?? move.invoice_date_due))).toBe(BigInt(Date.parse(dueDate)) * 1_000n)
        const lines = (await rows(page, "account-move-lines")).filter((row) => exactId(row.moveId ?? row.move_id) === moveId)
        expect(lines).toHaveLength(2)
        for (const line of lines) {
          expect(exactId(line.organizationId ?? line.organization_id)).toBe(organizationId)
          expect(exactId(line.companyId ?? line.company_id)).toBe(companyId)
        }
        expect(lines.reduce((sum, row) => sum + numberField(row, "debit", "debit"), 0)).toBe(75)
        expect(lines.reduce((sum, row) => sum + numberField(row, "credit", "credit"), 0)).toBe(75)
        const inputLine = (params.lines as Row[])[0]!
        const expense = lines.filter((line) => exactId(line.accountId ?? line.account_id) === exactId(inputLine.account_id))
        const payable = lines.filter((line) => exactId(line.accountId ?? line.account_id) === exactId(params.counterpart_account_id))
        expect(expense).toHaveLength(1)
        expect(payable).toHaveLength(1)
        expect(expense[0]!.name).toBe(description)
        expect(numberField(expense[0]!, "quantity", "quantity")).toBe(2)
        expect(numberField(expense[0]!, "debit", "debit")).toBe(75)
        expect(numberField(payable[0]!, "credit", "credit")).toBe(75)
      }
      await verifySaved()
      await page.reload()
      const overview = page.getByTestId("invoice-financial-overview")
      await expect(overview).toBeVisible()
      await expect(overview.getByTestId("invoice-document")).toContainText(description)
      await expect(overview.getByTestId("invoice-document")).toContainText("Vendor bill")
      await verifySaved()
      const afterReload = await page.request.get(resultUrl)
      expect(await afterReload.json()).toEqual(effect)
      expect(writes).toHaveLength(1)
      await page.screenshot({ path: testInfo.outputPath("vendor-bill-canonical-draft.png") })
    })

  },
)

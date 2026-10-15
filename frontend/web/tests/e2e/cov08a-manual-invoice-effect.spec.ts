import { randomUUID } from "node:crypto"

import { expect, test, type Page, type Request } from "@playwright/test"

import {
  fetchDefaultCompanyId,
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

async function fillManualInvoice(page: Page, description: string): Promise<void> {
  await chooseFirstPartner(page)
  await page.getByTestId("create-invoice-line-description").fill(description)
  await page.getByTestId("create-invoice-line-unit-price").fill("90")
  await expect(page.getByTestId("create-invoice-save-draft")).toBeEnabled()
}

function requestParams(request: Request): Record<string, unknown> {
  const body = request.postDataJSON() as { params?: Record<string, unknown> }
  if (!body.params) throw new Error("manual invoice operation request has no params")
  return body.params
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

      await page.getByTestId("quick-action-create_invoice").click()
      await expect(page.getByTestId("create-invoice-modal")).toBeVisible()
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
      expect(params.idempotencyKey).toBe(expectedRequestKey)
      expect(scalarQueryId(params.companyId)).toBe(companyId)
      expect(params.lines).toEqual([
        expect.objectContaining({
          name: description,
          quantity: 1,
          priceUnit: 90,
          discount: 0,
          taxIds: [],
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
      await page.getByTestId("quick-action-create_invoice").click()
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
  },
)

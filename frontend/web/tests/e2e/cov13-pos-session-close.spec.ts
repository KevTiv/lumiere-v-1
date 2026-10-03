import { expect, test, type Page, type Request } from "@playwright/test"

import {
  callReducerBff,
  chooseSelectOptionByValue,
  fillField,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const some = <T>(value: T) => ({ some: value })
const none = { none: [] as [] }
type Row = Record<string, unknown>

function tagged(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) return String((value as { tag?: unknown }).tag ?? "")
    const keys = Object.keys(value)
    if (keys.length === 1) {
      return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
    }
  }
  return ""
}

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function closedSessionSnapshot(
  page: Page,
  sessionId: number,
  companyId: number,
) {
  const session = (await rows(page, "pos-sessions")).find(
    (row) => scalarQueryId(row.id) === sessionId,
  )
  if (!session) throw new Error(`POS session not found: ${sessionId}`)
  const configId = scalarQueryId(session.configId ?? session.config_id)
  if (configId == null) throw new Error("POS session has no config_id")

  const config = (await rows(page, "pos-configs")).find(
    (row) => scalarQueryId(row.id) === configId,
  )
  if (!config) throw new Error(`POS config not found: ${configId}`)

  return {
    id: sessionId,
    organizationId: scalarQueryId(
      session.organizationId ?? session.organization_id,
    ),
    configId,
    companyId: scalarQueryId(config.companyId ?? config.company_id),
    configOrganizationId: scalarQueryId(
      config.organizationId ?? config.organization_id,
    ),
    state: tagged(session.state),
    orderCount: Number(session.orderCount ?? session.order_count ?? 0),
    closingBalance: Number(
      session.cashRegisterBalanceEndReal ??
        session.cash_register_balance_end_real ??
        0,
    ),
    stopAt: session.stopAt ?? session.stop_at ?? null,
  }
}

test.describe(
  "COV-13 POS session order/payment → close",
  { tag: ["@p0", "@cov13"] },
  () => {
    test("closes the exact scoped session after a paid order and preserves it on stale/denied replay", async ({
      browser,
      page,
    }) => {
      test.setTimeout(240_000)
      await gotoModule(page, "/pos", "pos")

      const configs = await rows(page, "pos-configs")
      const config = configs.find(
        (row) => String(row.name ?? "") === "Front Desk Demo POS",
      )
      const configId = scalarQueryId(config?.id)
      const companyId = scalarQueryId(config?.companyId ?? config?.company_id)
      const organizationId = scalarQueryId(
        config?.organizationId ?? config?.organization_id,
      )
      if (configId == null || companyId == null || organizationId == null) {
        throw new Error("seeded Front Desk Demo POS config is unavailable")
      }

      const beforeIds = new Set(
        (await rows(page, "pos-sessions")).map((row) => scalarQueryId(row.id)),
      )

      await page.getByTestId("pos-tab-admin").click()
      await page.getByRole("button", { name: "Open POS Session" }).click()
      await expect(page.getByTestId("form-modal-pos-open-session")).toBeVisible({
        timeout: 15_000,
      })
      await chooseSelectOptionByValue(page, "configId", configId)
      await fillField(page, "openingBalance", "100")
      await submitForm(page, "pos-open-session")

      let sessionId: number | null = null
      await expect
        .poll(async () => {
          const opened = (await rows(page, "pos-sessions")).find((row) => {
            const id = scalarQueryId(row.id)
            return (
              id != null &&
              !beforeIds.has(id) &&
              scalarQueryId(row.configId ?? row.config_id) === configId &&
              tagged(row.state) === "Opened"
            )
          })
          sessionId = scalarQueryId(opened?.id)
          return sessionId
        })
        .not.toBeNull()
      if (sessionId == null) throw new Error("opened POS session not found")
      const openedSessionId = sessionId

      const product = (await rows(page, "products")).find(
        (row) =>
          scalarQueryId(row.id) != null &&
          scalarQueryId(row.uomId ?? row.uom_id) != null,
      )
      const productId = scalarQueryId(product?.id)
      const uomId = scalarQueryId(product?.uomId ?? product?.uom_id)
      if (productId == null || uomId == null) {
        throw new Error("no POS-capable product/uom is available")
      }

      const paymentMethod = (await rows(page, "pos-payment-methods")).find(
        (row) =>
          scalarQueryId(row.companyId ?? row.company_id) === companyId,
      )
      const paymentMethodId = scalarQueryId(paymentMethod?.id)
      if (paymentMethodId == null) {
        throw new Error("no POS payment method is available for the company")
      }

      const amount = 49.99
      await callReducerBff(page, "create_pos_order", [
        organizationId,
        {
          session_id: openedSessionId,
          partner_id: none,
          lines: [
            {
              product_id: productId,
              qty: 1,
              uom_id: uomId,
              price_unit: amount,
              discount: 0,
              tax_ids: [],
              tax_amount: 0,
              price_extra: 0,
              name: some("COV-13 paid order"),
              full_product_name: some("COV-13 paid order"),
              customer_note: none,
              attribute_value_ids: [],
              is_reward_line: false,
              reward_id: none,
              coupon_id: none,
              refunded_orderline_id: none,
              loyalty_points: none,
            },
          ],
          payments: [
            {
              payment_method_id: paymentMethodId,
              amount,
              transaction_id: some(smokeName("cov13-pos-payment")),
              card_type: none,
              cardholder_name: none,
              card_number: none,
              is_change: false,
              is_tip: false,
            },
          ],
          to_invoice: false,
        },
      ])

      await expect
        .poll(async () => {
          const session = (await rows(page, "pos-sessions")).find(
            (row) => scalarQueryId(row.id) === openedSessionId,
          )
          return Number(session?.orderCount ?? session?.order_count ?? 0)
        })
        .toBeGreaterThanOrEqual(1)

      await gotoModule(page, "/pos", "pos")
      await page.getByTestId("pos-tab-admin").click()
      await page.getByRole("button", { name: "Close POS Session" }).click()
      await expect(page.getByTestId("form-modal-pos-close-session")).toBeVisible({
        timeout: 15_000,
      })
      await chooseSelectOptionByValue(page, "sessionId", sessionId)
      await fillField(page, "closingBalance", "149.99")

      const [closed] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "close_pos_session"),
          { timeout: 45_000 },
        ),
        submitForm(page, "pos-close-session"),
      ])
      expect(closed.ok()).toBe(true)

      await expect
        .poll(async () => {
          const snapshot = await closedSessionSnapshot(
            page,
            openedSessionId,
            companyId,
          )
          return {
            state: snapshot.state,
            closingBalance: snapshot.closingBalance,
            orderCount: snapshot.orderCount,
            companyId: snapshot.companyId,
          }
        })
        .toEqual({
          state: "Closed",
          closingBalance: 149.99,
          orderCount: 1,
          companyId,
        })

      const effect = await closedSessionSnapshot(page, openedSessionId, companyId)
      expect(effect.organizationId).toBe(organizationId)
      expect(effect.configOrganizationId).toBe(organizationId)
      expect(effect.configId).toBe(configId)
      expect(effect.stopAt).not.toBeNull()

      const stale = await replay(page, closed.request())
      expect(stale.status()).toBe(422)
      expect(await closedSessionSnapshot(page, openedSessionId, companyId)).toEqual(
        effect,
      )

      const readerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const readerPage = await readerContext.newPage()
      try {
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        const denied = await replay(readerPage, closed.request())
        expect(denied.status()).toBe(403)
        expect(
          await closedSessionSnapshot(page, openedSessionId, companyId),
        ).toEqual(effect)
      } finally {
        await readerContext.close()
      }
    })
  },
)

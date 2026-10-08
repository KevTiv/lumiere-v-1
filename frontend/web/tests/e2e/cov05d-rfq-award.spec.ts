import { expect, test, type Page } from "@playwright/test"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import {
  fetchCurrencyIdByCode,
  fetchDefaultCompanyId,
  fetchFirstUomId,
  fetchProductIdByName,
  fetchVendorPartnerIdByName,
  gotoModule,
  scalarQueryId,
  scalarQueryString,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type QueryRow = Record<string, unknown>

async function postOperation(
  page: Page,
  request: { urlPath: string; init: RequestInit },
) {
  return page.request.post(request.urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(request.init.body)),
  })
}

async function queryRows(page: Page, resource: string): Promise<QueryRow[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} query status`).toBe(true)
  const body = (await response.json()) as { data?: QueryRow[] }
  return body.data ?? []
}

function rowIds(rows: QueryRow[]): number[] {
  return rows
    .map((row) => scalarQueryId(row.id))
    .filter((id): id is number => id !== null)
}

function singleAddedId(before: number[], after: number[]): number | null {
  const previous = new Set(before)
  const added = after.filter((id) => !previous.has(id))
  return added.length === 1 ? added[0] : null
}

async function waitForSingleAddedId(
  readIds: () => Promise<number[]>,
  before: number[],
): Promise<number> {
  let createdId: number | null = null
  await expect
    .poll(async () => {
      createdId = singleAddedId(before, await readIds())
      return createdId
    })
    .not.toBeNull()
  return createdId!
}

async function fetchExactRfqById(page: Page, rfqId: number): Promise<QueryRow> {
  const matches = (await queryRows(page, "purchase-rfqs")).filter(
    (row) => scalarQueryId(row.id) === rfqId,
  )
  expect(matches).toHaveLength(1)
  return matches[0]
}

test.describe(
  "COV-05d RFQ award",
  { tag: ["@p0", "@cov05", "@unauthenticated"] },
  () => {
    test("purchasing persona awards a submitted bid through the typed dialog", async ({
      browser,
      page,
    }) => {
      test.setTimeout(180_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const currencyId = await fetchCurrencyIdByCode(page, "USD")
      const productId = await fetchProductIdByName(page, "Lumiere Dev Laptop")
      const uomId = await fetchFirstUomId(page)
      const vendorId = await fetchVendorPartnerIdByName(page, "Globex Corp")
      const notes = smokeName("cov05d-rfq")
      const rfqIdsBefore = rowIds(await queryRows(page, "purchase-rfqs"))

      const createRfq = await postOperation(
        page,
        stdbBffCommandPost("create_purchase_rfq", {
          companyId,
          params: stdbParamsToJson(
            {
              requisitionId: null,
              currencyId,
              notes,
              lines: [
                {
                  productId,
                  productUom: uomId,
                  productUomQty: 1,
                  name: notes,
                  sequence: 10,
                },
              ],
              metadata: null,
            },
            "CreatePurchaseRfqParams",
          ),
        }),
      )
      expect(createRfq.ok(), await createRfq.text()).toBe(true)

      const rfqId = await waitForSingleAddedId(
        async () => rowIds(await queryRows(page, "purchase-rfqs")),
        rfqIdsBefore,
      )
      const rfqBefore = await fetchExactRfqById(page, rfqId)
      const rfqName = scalarQueryString(rfqBefore.name)
      expect(rfqName).not.toBe("")
      const bidIdsBefore = rowIds(
        (await queryRows(page, "purchase-rfq-bids")).filter(
          (row) => scalarQueryId(row.rfqId ?? row.rfq_id) === rfqId,
        ),
      )

      const bidNotes = `${notes}-bid`
      const addBid = await postOperation(
        page,
        stdbBffCommandPost("add_purchase_rfq_bid", {
          companyId,
          rfqId,
          params: stdbParamsToJson(
            {
              partnerId: vendorId,
              currencyId,
              priceUnit: 925,
              notes: bidNotes,
            },
            "CreatePurchaseRfqBidParams",
          ),
        }),
      )
      expect(addBid.ok(), await addBid.text()).toBe(true)

      const bidId = await waitForSingleAddedId(
        async () =>
          rowIds(
            (await queryRows(page, "purchase-rfq-bids")).filter(
              (row) => scalarQueryId(row.rfqId ?? row.rfq_id) === rfqId,
            ),
          ),
        bidIdsBefore,
      )

      const purchasingContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const purchasingPage = await purchasingContext.newPage()

      try {
        await signIn(
          purchasingPage,
          "fixture.purchasing@example.test",
          PERSONA_PASSWORD,
        )
        await gotoModule(purchasingPage, "/purchasing", "purchasing")
        await purchasingPage.getByTestId("purchasing-ops-award-rfq-bid").click()

        const dialog = purchasingPage.getByRole("dialog", { name: "Award RFQ bid" })
        await dialog.getByLabel("RFQ").click()
        await purchasingPage
          .getByRole("listbox")
          .getByRole("option", { name: rfqName, exact: true })
          .click()
        await dialog.getByLabel("Submitted bid").click()
        await purchasingPage
          .getByRole("listbox")
          .getByRole("option", { name: new RegExp(`^Bid ${bidId} `) })
          .click()

        const [awardResponse] = await Promise.all([
          purchasingPage.waitForResponse(
            (response) =>
              matchesOperationResponse(response, "award_purchase_rfq_bid"),
            { timeout: 30_000 },
          ),
          dialog.getByRole("button", { name: "Award RFQ bid", exact: true }).click(),
        ])
        expect(awardResponse.ok(), await awardResponse.text()).toBe(true)

        await expect
          .poll(async () => {
            const row = await fetchExactRfqById(page, rfqId)
            return {
              state: scalarQueryString(row.state),
              awardedBidId: scalarQueryId(row.awardedBidId ?? row.awarded_bid_id),
              purchaseOrderId: scalarQueryId(row.purchaseOrderId ?? row.purchase_order_id),
            }
          })
          .toMatchObject({ state: "awarded", awardedBidId: bidId })

        const rfqAfter = await fetchExactRfqById(page, rfqId)
        const purchaseOrderId = scalarQueryId(
          rfqAfter.purchaseOrderId ?? rfqAfter.purchase_order_id,
        )
        expect(purchaseOrderId).not.toBeNull()
        await expect(purchasingPage).toHaveURL((url) => {
          return (
            url.pathname === "/purchasing" &&
            url.searchParams.get("tab") === "orders" &&
            url.searchParams.get("filter") === `id:${purchaseOrderId}`
          )
        })

        const replay = await postOperation(
          purchasingPage,
          stdbBffCommandPost("award_purchase_rfq_bid", {
            companyId,
            rfqId,
            bidId,
          }),
        )
        expect(replay.status()).toBe(422)
        const afterReplay = await fetchExactRfqById(page, rfqId)
        expect(
          scalarQueryId(afterReplay.purchaseOrderId ?? afterReplay.purchase_order_id),
        ).toBe(purchaseOrderId)

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
          const deniedAward = await postOperation(
            readerPage,
            stdbBffCommandPost("award_purchase_rfq_bid", {
              companyId,
              rfqId,
              bidId,
            }),
          )
          expect(deniedAward.status()).toBe(403)
          const afterDenial = await fetchExactRfqById(page, rfqId)
          expect(
            scalarQueryId(
              afterDenial.purchaseOrderId ?? afterDenial.purchase_order_id,
            ),
          ).toBe(purchaseOrderId)
        } finally {
          await readerContext.close()
        }
      } finally {
        await purchasingContext.close()
      }
    })
  },
)

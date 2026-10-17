import { expect, test, type Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import {
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  fetchDefaultCompanyId,
  fillField,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
  selectModuleTab,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import {
  confirmPurchaseOrderViaUi,
  createVendorBillViaUi,
  fetchPurchaseLineReceivedQty,
  fetchPurchaseOrderInvoiceIds,
  fetchPurchaseOrderLineIds,
  fetchPurchaseOrderReceipts,
  fetchPurchaseOrderState,
  fetchVendorBillById,
  receivePurchaseLineViaUi,
} from "./purchasing-order-fixtures"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type Row = Record<string, unknown>

function stateTag(value: unknown): string {
  if (value && typeof value === "object" && "tag" in value) {
    return String((value as { tag: unknown }).tag)
  }
  return String(value ?? "")
}

async function requisitions(page: Page): Promise<Row[]> {
  const response = await page.request.get("/api/query/purchase-requisitions")
  expect(response.ok()).toBe(true)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function requisitionByOrigin(page: Page, origin: string): Promise<Row | undefined> {
  const matches = (await requisitions(page)).filter((row) => row.origin === origin)
  if (matches.length > 1) throw new Error(`Ambiguous requisition origin ${origin}`)
  return matches[0]
}

async function requisitionRequest(
  page: Page,
  reducer:
    | "approve_purchase_requisition"
    | "convert_purchase_requisition_to_po",
  requisitionId: number,
  companyId?: number,
) {
  const { urlPath, init } = stdbBffCommandPost(reducer, {
    requisitionId,
    ...(reducer === "convert_purchase_requisition_to_po"
      ? { companyId: companyId ?? 0 }
      : {}),
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

async function runRequisitionAction(
  page: Page,
  requisitionId: number,
  actionId: "req-submit" | "req-approve" | "req-convert-po",
  reducer:
    | "submit_purchase_requisition"
    | "approve_purchase_requisition"
    | "convert_purchase_requisition_to_po",
) {
  await gotoModule(
    page,
    `/purchasing?tab=requisitions&filter=id:${requisitionId}`,
    "purchasing",
  )
  await selectEntityRowById(page, requisitionId)
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeEnabled({ timeout: 30_000 })
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) => matchesOperationResponse(candidate, reducer),
      { timeout: 30_000 },
    ),
    action.click(),
  ])
  expect(response.ok()).toBe(true)
}

async function replayResponseRequest(page: Page, response: import("@playwright/test").Response) {
  const request = response.request()
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

test.describe(
  "COV-05e requisition to receipt and bill handoff",
  { tag: ["@p0", "@cov05", "@cov05e", "@unauthenticated"] },
  () => {
    test("requester creates/submits, independent buyer approves, and the exact PO reaches receipt and bill", async ({
      browser,
      page,
    }) => {
      test.setTimeout(300_000)

      await signIn(page, "test@email.com", PERSONA_PASSWORD)
      const companyId = await fetchDefaultCompanyId(page)
      const origin = smokeName("cov05e-requisition")
      await gotoModule(page, "/purchasing", "purchasing")
      await selectModuleTab(page, "purchasing", "requisitions")
      await page.getByTestId("module-create-purchasing-requisitions").click()
      await expect(page.getByTestId("form-modal-new-purchase-requisition")).toBeVisible()
      await chooseSelectOptionByLabel(page, "vendorId", "Globex Corp")
      await chooseSelectOptionByLabel(page, "productId", "Lumiere Dev Laptop")
      await chooseFirstEnabledOption(page, "uomId")
      await fillField(page, "quantity", "2")
      await fillField(page, "origin", origin)
      await fillField(page, "description", "COV-05e operator requisition handoff")
      const [created] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "create_purchase_requisition") &&
            response.ok(),
          { timeout: 30_000 },
        ),
        submitForm(page, "new-purchase-requisition"),
      ])
      expect(created.ok()).toBe(true)

      let requisition: Row | undefined
      await expect
        .poll(async () => {
          requisition = await requisitionByOrigin(page, origin)
          return requisition == null ? undefined : stateTag(requisition.state)
        })
        .toBe("Draft")
      const requisitionId = scalarQueryId(requisition?.id)
      if (requisitionId == null) throw new Error("Created requisition has no exact id")

      await runRequisitionAction(
        page,
        requisitionId,
        "req-submit",
        "submit_purchase_requisition",
      )
      await expect
        .poll(async () => stateTag((await requisitionByOrigin(page, origin))?.state))
        .toBe("InProgress")

      // The requester cannot even present approval as an enabled UI action;
      // a direct alternate-client attempt is also rejected by the reducer.
      await gotoModule(
        page,
        `/purchasing?tab=requisitions&filter=id:${requisitionId}`,
        "purchasing",
      )
      await selectEntityRowById(page, requisitionId)
      await expect(page.getByTestId("entity-action-req-approve")).toBeDisabled()
      expect((await requisitionRequest(page, "approve_purchase_requisition", requisitionId)).status()).toBe(422)

      const buyerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const readerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      try {
        const buyerPage = await buyerContext.newPage()
        await signIn(
          buyerPage,
          "fixture.purchasing@example.test",
          PERSONA_PASSWORD,
        )
        await runRequisitionAction(
          buyerPage,
          requisitionId,
          "req-approve",
          "approve_purchase_requisition",
        )
        await expect
          .poll(async () => stateTag((await requisitionByOrigin(page, origin))?.state))
          .toBe("Approved")

        const approvedSnapshot = await requisitionByOrigin(page, origin)
        expect(
          (await requisitionRequest(buyerPage, "approve_purchase_requisition", requisitionId)).status(),
        ).toBe(422)
        expect(await requisitionByOrigin(page, origin)).toEqual(approvedSnapshot)

        // The trusted operation boundary rejects a foreign company scope
        // before the reducer can use it to redirect the conversion.
        expect(
          (await requisitionRequest(
            buyerPage,
            "convert_purchase_requisition_to_po",
            requisitionId,
            companyId + 9_999,
          )).status(),
        ).toBe(403)
        expect(
          (await requisitionByOrigin(page, origin))?.purchaseIds ??
            (await requisitionByOrigin(page, origin))?.purchase_ids ??
            [],
        ).toEqual([])

        await runRequisitionAction(
          buyerPage,
          requisitionId,
          "req-convert-po",
          "convert_purchase_requisition_to_po",
        )

        let purchaseIds: number[] = []
        await expect
          .poll(async () => {
            const row = await requisitionByOrigin(page, origin)
            const raw = row?.purchaseIds ?? row?.purchase_ids
            purchaseIds = Array.isArray(raw)
              ? raw.flatMap((id) => {
                  const parsed = scalarQueryId(id)
                  return parsed == null ? [] : [parsed]
                })
              : []
            return purchaseIds.length
          })
          .toBe(1)
        const [orderId] = purchaseIds
        if (orderId == null) throw new Error("Converted requisition has no PO relation")
        await expect(buyerPage).toHaveURL((url) =>
          url.pathname === "/purchasing" &&
          url.searchParams.get("tab") === "orders" &&
          url.searchParams.get("filter") === `id:${orderId}`,
        )

        const convertedPurchaseIds = [orderId]

        // Lost-response retry is idempotent: it returns the already-committed
        // canonical PO and cannot append or create another order.
        expect(
          (await requisitionRequest(
            buyerPage,
            "convert_purchase_requisition_to_po",
            requisitionId,
            companyId,
          )).ok(),
        ).toBe(true)
        const afterReplay = await requisitionByOrigin(page, origin)
        const relatedAfterReplay = afterReplay?.purchaseIds ?? afterReplay?.purchase_ids
        const replayIds = Array.isArray(relatedAfterReplay)
          ? relatedAfterReplay.flatMap((id) => {
              const parsed = scalarQueryId(id)
              return parsed == null ? [] : [parsed]
            })
          : []
        expect(replayIds).toEqual(convertedPurchaseIds)

        const readerPage = await readerContext.newPage()
        await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
        expect(
          (await requisitionRequest(
            readerPage,
            "convert_purchase_requisition_to_po",
            requisitionId,
            companyId,
          )).status(),
        ).toBe(403)

        expect(await fetchPurchaseOrderState(page, orderId)).toBe("Draft")
        const lineIds = await fetchPurchaseOrderLineIds(page, orderId)
        expect(lineIds).toHaveLength(1)
        const [lineId] = lineIds
        if (lineId == null) throw new Error("Converted PO has no copied line")

        await confirmPurchaseOrderViaUi(buyerPage, orderId)
        const receipts = await fetchPurchaseOrderReceipts(page, orderId)
        expect(receipts).toHaveLength(1)
        await receivePurchaseLineViaUi(buyerPage, lineId)
        await expect
          .poll(() => fetchPurchaseLineReceivedQty(page, lineId), {
            timeout: 30_000,
          })
          .toBe(2)

        expect(await fetchPurchaseOrderInvoiceIds(page, orderId)).toEqual([])
        const billResponse = await createVendorBillViaUi(buyerPage, orderId)
        let billIds: number[] = []
        await expect
          .poll(async () => {
            billIds = await fetchPurchaseOrderInvoiceIds(page, orderId)
            return billIds.length
          })
          .toBe(1)
        const [billId] = billIds
        if (billId == null) throw new Error("PO has no canonical bill relation")
        await expect(buyerPage).toHaveURL((url) =>
          url.pathname === "/accounting" &&
          url.searchParams.get("tab") === "journal-entries" &&
          url.searchParams.get("filter") === `id:${billId}`,
        )
        const bill = await fetchVendorBillById(page, billId)
        expect(bill).toMatchObject({
          id: billId,
          moveType: "InInvoice",
          state: "Draft",
        })
        expect(bill?.amountTotal ?? 0).toBeGreaterThan(0)
        expect((await replayResponseRequest(buyerPage, billResponse)).status()).toBe(422)
        expect(await fetchPurchaseOrderInvoiceIds(page, orderId)).toEqual([billId])
        expect((await replayResponseRequest(readerPage, billResponse)).status()).toBe(403)
        expect(await fetchPurchaseOrderInvoiceIds(page, orderId)).toEqual([billId])
      } finally {
        await readerContext.close()
        await buyerContext.close()
      }
    })
  },
)

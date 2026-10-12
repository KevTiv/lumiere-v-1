import { expect, test, type Locator, type Page, type Response } from "@playwright/test"

import {
  activeTabEntityTable,
  chooseSelectOptionByLabel,
  fillField,
  gotoModule,
  openEntityCreate,
  scalarQueryId,
  scalarQueryString,
  selectEntityRowById,
  selectModuleTab,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const password = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"
const vendorName = "Globex Corp"
const productName = "Lumiere Dev Laptop"
type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource}: ${await response.text()}`).toBe(true)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function exactRow(page: Page, resource: string, match: (row: Row) => boolean) {
  const matches = (await rows(page, resource)).filter(match)
  expect(matches, `exact ${resource} identity`).toHaveLength(1)
  return matches[0]!
}

async function createdRow(page: Page, resource: string, match: (row: Row) => boolean) {
  await expect.poll(async () => (await rows(page, resource)).filter(match).length).toBe(1)
  return exactRow(page, resource, match)
}

function id(row: Row): number {
  const value = scalarQueryId(row.id)
  if (value == null) throw new Error("Missing canonical record ID")
  return value
}

async function replay(page: Page, response: Response) {
  const request = response.request()
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function operation(page: Page, reducer: string, click: () => Promise<unknown>) {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => matchesOperationResponse(candidate, reducer)),
    click(),
  ])
  return response
}

async function selectRow(page: Page, tab: string, recordId: number) {
  await gotoModule(page, "/purchasing", "purchasing")
  await selectModuleTab(page, "purchasing", tab)
  // Focus by the exact identity so pagination and other tests' records do not
  // decide which request the operator selects.
  await page.goto(`/purchasing?tab=${tab}&filter=id:${recordId}`)
  await expect(activeTabEntityTable(page).getByTestId(`entity-row-${recordId}`)).toBeVisible()
  await selectEntityRowById(page, recordId)
}

async function rowAction(page: Page, tab: string, recordId: number, action: string, reducer: string) {
  await selectRow(page, tab, recordId)
  const button = page.getByTestId(`entity-action-${action}`)
  await expect(button).toBeEnabled()
  return operation(page, reducer, () => button.click())
}

async function choose(page: Page, dialog: Locator, label: string, option: string | RegExp) {
  await dialog.getByLabel(label, { exact: true }).click()
  await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click()
}

async function approveIntake(page: Page, intakeId: number) {
  await selectRow(page, "supplier-intakes", intakeId)
  await page.getByTestId("entity-action-si-approve").click()
  const dialog = page.getByRole("dialog", { name: "Approve supplier intake" })
  await expect(dialog).toBeVisible()
  await choose(page, dialog, "Vendor", vendorName)
  return operation(page, "approve_supplier_intake", () =>
    dialog.getByRole("button", { name: "Approve supplier", exact: true }).click())
}

async function state(page: Page, resource: string, recordId: number) {
  const row = await exactRow(page, resource, (candidate) => scalarQueryId(candidate.id) === recordId)
  return scalarQueryString(row.state)
}

test.describe("COV-05e upstream procurement", { tag: ["@p0", "@cov05", "@unauthenticated"] }, () => {
  for (const path of ["rfq", "direct-po"] as const) {
    test(`supplier intake → independent requisition approval → ${path}`, async ({ browser, page }) => {
      test.setTimeout(360_000)
      const approverContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
      const approver = await approverContext.newPage()
      const reader = await readerContext.newPage()
      try {
        await signIn(page, "fixture.purchasing@example.test", password)
        await signIn(approver, "test@email.com", password)
        await signIn(reader, "fixture.reader@example.test", password)
        const key = smokeName(`cov05e-${path}`)
        const vendor = await exactRow(approver, "contacts", (row) => row.name === vendorName)
        const product = await exactRow(approver, "products", (row) => row.name === productName)
        const uomId = scalarQueryId(product.uomId ?? product.uom_id)
        expect(uomId).not.toBeNull()
        const uom = await exactRow(approver, "uoms", (row) => scalarQueryId(row.id) === uomId)
        const uomName = scalarQueryString(uom.name)

        await openEntityCreate(page, "/purchasing", "purchasing", "supplier-intakes", "new-supplier-intake")
        await fillField(page, "companyName", key)
        await fillField(page, "contactName", "Procurement contact")
        await fillField(page, "email", `${key}@example.test`)
        const intakeCreate = await operation(page, "submit_supplier_intake", () => submitForm(page, "new-supplier-intake"))
        expect(intakeCreate.ok(), await intakeCreate.text()).toBe(true)
        const intake = await createdRow(approver, "supplier-intakes", (row) => row.companyName === key)
        const intakeId = id(intake)

        // Even a requester with approve permission cannot approve their own intake.
        const selfIntake = await approveIntake(page, intakeId)
        expect(selfIntake.status()).toBe(422)
        await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/independent approver/i)
        expect(await state(approver, "supplier-intakes", intakeId)).toBe("Submitted")
        await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click()
        const approvedIntake = await approveIntake(approver, intakeId)
        expect(approvedIntake.ok(), await approvedIntake.text()).toBe(true)
        await expect.poll(() => state(approver, "supplier-intakes", intakeId)).toBe("Approved")
        const linkedIntake = await exactRow(approver, "supplier-intakes", (row) => id(row) === intakeId)
        expect(scalarQueryId(linkedIntake.partnerId ?? linkedIntake.partner_id)).toBe(id(vendor))
        expect(linkedIntake.approvedBy ?? linkedIntake.approved_by).not.toEqual(intake.submittedBy ?? intake.submitted_by)
        expect((await replay(approver, approvedIntake)).status()).toBe(422)
        expect((await replay(reader, approvedIntake)).status()).toBe(403)

        await page.reload()
        await openEntityCreate(page, "/purchasing", "purchasing", "requisitions", "new-purchase-requisition")
        await chooseSelectOptionByLabel(page, "vendorId", vendorName)
        await fillField(page, "origin", key)
        await fillField(page, "description", key)
        await chooseSelectOptionByLabel(page, "productId", productName)
        await chooseSelectOptionByLabel(page, "uomId", uomName)
        await fillField(page, "quantity", "7")
        const requisitionCreate = await operation(page, "create_purchase_requisition", () => submitForm(page, "new-purchase-requisition"))
        expect(requisitionCreate.ok(), await requisitionCreate.text()).toBe(true)
        const requisition = await createdRow(approver, "purchase-requisitions", (row) => row.origin === key)
        const reqId = id(requisition)
        const reqLines = (await rows(approver, "purchase-requisition-lines"))
          .filter((row) => scalarQueryId(row.requisitionId ?? row.requisition_id) === reqId)
        expect(reqLines).toHaveLength(1)
        expect(scalarQueryId(reqLines[0]!.productId ?? reqLines[0]!.product_id)).toBe(id(product))
        expect(Number(reqLines[0]!.productUomQty ?? reqLines[0]!.product_uom_qty)).toBe(7)

        const submitted = await rowAction(page, "requisitions", reqId, "req-submit", "submit_purchase_requisition")
        expect(submitted.ok(), await submitted.text()).toBe(true)
        await expect.poll(() => state(approver, "purchase-requisitions", reqId)).toBe("InProgress")
        // Neither an unapproved conversion nor RFQ solicitation is offered.
        await selectRow(page, "requisitions", reqId)
        await expect(page.getByTestId("entity-action-req-convert-po")).toBeDisabled()
        await expect(page.getByTestId("entity-action-req-create-rfq")).toBeDisabled()
        const selfApproval = await rowAction(page, "requisitions", reqId, "req-approve", "approve_purchase_requisition")
        expect(selfApproval.status()).toBe(422)
        expect(await state(approver, "purchase-requisitions", reqId)).toBe("InProgress")
        const approved = await rowAction(approver, "requisitions", reqId, "req-approve", "approve_purchase_requisition")
        expect(approved.ok(), await approved.text()).toBe(true)
        await expect.poll(() => state(approver, "purchase-requisitions", reqId)).toBe("Approved")
        expect((await replay(approver, approved)).status()).toBe(422)
        expect((await replay(reader, approved)).status()).toBe(403)
        const approvedReq = await exactRow(approver, "purchase-requisitions", (row) => id(row) === reqId)
        expect(approvedReq.writeUid ?? approvedReq.write_uid).not.toEqual(requisition.userId ?? requisition.user_id)

        let poId: number
        let rfqId: number | undefined
        await page.reload()
        if (path === "direct-po") {
          const converted = await rowAction(page, "requisitions", reqId, "req-convert-po", "convert_purchase_requisition_to_po")
          expect(converted.ok(), await converted.text()).toBe(true)
          const after = await exactRow(approver, "purchase-requisitions", (row) => id(row) === reqId)
          const purchaseIds = after.purchaseIds ?? after.purchase_ids
          expect(purchaseIds).toHaveLength(1)
          poId = scalarQueryId((purchaseIds as unknown[])[0])!
        } else {
          await selectRow(page, "requisitions", reqId)
          await page.getByTestId("entity-action-req-create-rfq").click()
          const rfqDialog = page.getByRole("dialog", { name: "Create request for quotation" })
          await expect(rfqDialog.getByLabel("Requisition", { exact: true })).toContainText(key)
          await choose(page, rfqDialog, "Product", productName)
          await choose(page, rfqDialog, "Unit of measure", uomName)
          await rfqDialog.getByLabel("Quantity", { exact: true }).fill("7")
          await rfqDialog.getByLabel("Notes", { exact: true }).fill(key)
          const rfqCreate = await operation(page, "create_purchase_rfq", () => rfqDialog.getByRole("button", { name: "Create RFQ", exact: true }).click())
          expect(rfqCreate.ok(), await rfqCreate.text()).toBe(true)
          const rfq = await createdRow(approver, "purchase-rfqs", (row) => row.notes === key && scalarQueryId(row.requisitionId ?? row.requisition_id) === reqId)
          rfqId = id(rfq)
          await selectModuleTab(page, "purchasing", "operations")
          await page.getByTestId("purchasing-ops-add-rfq-bid").click()
          const bidDialog = page.getByRole("dialog", { name: "Add RFQ bid" })
          await choose(page, bidDialog, "RFQ", scalarQueryString(rfq.name))
          await choose(page, bidDialog, "Vendor", vendorName)
          await bidDialog.getByLabel("Unit price", { exact: true }).fill("925")
          await bidDialog.getByLabel("Notes", { exact: true }).fill(key)
          const bidCreate = await operation(page, "add_purchase_rfq_bid", () => bidDialog.getByRole("button", { name: "Add RFQ bid", exact: true }).click())
          expect(bidCreate.ok(), await bidCreate.text()).toBe(true)
          const bid = await createdRow(approver, "purchase-rfq-bids", (row) => row.notes === key && scalarQueryId(row.rfqId ?? row.rfq_id) === rfqId)
          await page.getByTestId("purchasing-ops-award-rfq-bid").click()
          const awardDialog = page.getByRole("dialog", { name: "Award RFQ bid" })
          await choose(page, awardDialog, "RFQ", scalarQueryString(rfq.name))
          await choose(page, awardDialog, "Submitted bid", new RegExp(`^Bid ${id(bid)} `))
          const awarded = await operation(page, "award_purchase_rfq_bid", () => awardDialog.getByRole("button", { name: "Award RFQ bid", exact: true }).click())
          expect(awarded.ok(), await awarded.text()).toBe(true)
          await expect.poll(() => state(approver, "purchase-rfqs", rfqId!)).toBe("awarded")
          const after = await exactRow(approver, "purchase-rfqs", (row) => id(row) === rfqId)
          poId = scalarQueryId(after.purchaseOrderId ?? after.purchase_order_id)!
          expect((await replay(page, awarded)).status()).toBe(422)
        }

        expect(poId).toBeGreaterThan(0)
        await expect(page).toHaveURL((url) => url.pathname === "/purchasing" &&
          url.searchParams.get("tab") === "orders" && url.searchParams.get("filter") === `id:${poId}`)
        await page.reload()
        await expect(activeTabEntityTable(page).getByTestId(`entity-row-${poId}`)).toBeVisible()
        const po = await exactRow(approver, "purchase-orders", (row) => id(row) === poId)
        expect(scalarQueryId(po.partnerId ?? po.partner_id)).toBe(id(vendor))
        expect(po.origin).toBe(path === "rfq" ? `rfq:${rfqId}` : `requisition:${reqId}`)
        const poLines = (await rows(approver, "purchase-order-lines")).filter((row) => scalarQueryId(row.orderId ?? row.order_id) === poId)
        expect(poLines).toHaveLength(1)
        expect(scalarQueryId(poLines[0]!.productId ?? poLines[0]!.product_id)).toBe(id(product))
        expect(scalarQueryId(poLines[0]!.productUom ?? poLines[0]!.product_uom)).toBe(uomId)
        expect(Number(poLines[0]!.productQty ?? poLines[0]!.product_qty)).toBe(7)
        if (path === "rfq") expect(Number(poLines[0]!.priceUnit ?? poLines[0]!.price_unit)).toBe(925)
      } finally {
        await readerContext.close()
        await approverContext.close()
      }
    })
  }
})

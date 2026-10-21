import { expect, test } from "@playwright/test"

import { fetchPaymentIdByExactReference, scalarQueryString, submitForm } from "./helpers"
import { matchesOperationResponse } from "./operation-response"
import { loseNextResponse } from "./pretenant-support"
import {
  createAndPostInvoice,
  createAndPostPayment,
  moveSnapshot,
  openRegisterForm,
  replay,
  rows,
} from "./cov08-support"

/**
 * COV-08 invoice -> payment -> settlement, driven only through operator UI transitions.
 *
 * No compatibility reducer route is used: the invoice is created from the accounting quick
 * action, posted from the invoice document, paid through the payment form, and settled through
 * the register-payment form. The exact accepted requests are then replayed and a reply is lost
 * after commit, to prove identity and recovery of the money effect.
 */

test.describe("COV-08 invoice payment identity and recovery", { tag: ["@p0", "@cov08"] }, () => {
  test("operator settles an invoice; exact payment identity and replays hold", async ({ page }) => {
    test.setTimeout(300_000)
    const moveId = await createAndPostInvoice(page, "cov08-inv")
    const { partnerId, paymentId, reference } = await createAndPostPayment(page, moveId)

    await openRegisterForm(page, paymentId, moveId)
    const [registerResponse] = await Promise.all([
      page.waitForResponse((r) => matchesOperationResponse(r, "register_payment_on_invoice") && r.ok(), {
        timeout: 30_000,
      }),
      submitForm(page, "register-payment-invoices"),
    ])
    await expect
      .poll(() => moveSnapshot(page, moveId), { timeout: 30_000 })
      .toMatchObject({ residual: 0, paymentState: "Paid" })

    // Exact identity: one payment owns the reference, and it is the one that settled the invoice.
    const owners = (await rows(page, "account-payments")).filter(
      (row) => scalarQueryString(row.ref ?? row.ref_) === reference,
    )
    expect(owners).toHaveLength(1)
    expect(await fetchPaymentIdByExactReference(page, partnerId, reference, { state: "Paid" })).toBe(paymentId)

    // Replays of the exact accepted commands change nothing.
    const settled = await moveSnapshot(page, moveId)
    const replayRegister = await replay(page, registerResponse)
    expect(replayRegister.ok(), "settled invoice must refuse the replayed register request").toBe(false)
    expect(await moveSnapshot(page, moveId)).toEqual(settled)
  })

  // create_payment is idempotent on the command's key: an identical replay converges to the same
  // payment, and the same key with different input is rejected. Neither may add a payment.
  test("replaying the accepted create_payment request converges and a conflicting replay is rejected", async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const moveId = await createAndPostInvoice(page, "cov08-dup")
    const { partnerId, paymentId, reference, createResponse, amountTotal } = await createAndPostPayment(page, moveId)
    const owners = async () =>
      (await rows(page, "account-payments")).filter((row) => scalarQueryString(row.ref ?? row.ref_) === reference)
    expect(await owners()).toHaveLength(1)

    const identical = await replay(page, createResponse)
    expect(identical.ok(), "an identical replay converges instead of failing").toBe(true)
    expect(await owners()).toHaveLength(1)

    const body = createResponse.request().postDataJSON() as { params: Record<string, unknown> }
    const conflicting = await page.request.post(new URL(createResponse.url()).pathname, {
      headers: { "Content-Type": "application/json" },
      data: { ...body, params: { ...body.params, amount: Number(amountTotal) + 1 } },
    })
    expect(conflicting.ok(), "the same key with different input must be rejected").toBe(false)

    const after = await owners()
    expect(after).toHaveLength(1)
    expect(await fetchPaymentIdByExactReference(page, partnerId, reference, { state: "Paid" })).toBe(paymentId)
  })

  test("a register-payment reply lost after commit converges once by canonical readback and offers no retry", async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const moveId = await createAndPostInvoice(page, "cov08-lost")
    const { paymentId } = await createAndPostPayment(page, moveId)

    await openRegisterForm(page, paymentId, moveId)
    const injected = await loseNextResponse(page, "register_payment_on_invoice")
    await submitForm(page, "register-payment-invoices")
    await expect.poll(() => injected.lost()).toBe(true)

    await expect
      .poll(() => moveSnapshot(page, moveId), { timeout: 30_000 })
      .toMatchObject({ residual: 0, paymentState: "Paid" })
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0)
    await expect(page.getByText(/Result unknown/i)).toHaveCount(0)
    // The commit happened exactly once: the residual is exactly zero, never overpaid.
    expect((await moveSnapshot(page, moveId)).residual).toBe(0)
  })
})

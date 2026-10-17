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
    const { partnerId, paymentId, reference, createResponse } = await createAndPostPayment(page, moveId)

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
    const replayCreate = await replay(page, createResponse)
    expect(replayCreate.ok(), "the replayed create_payment must not be accepted twice").toBe(false)
    expect(await moveSnapshot(page, moveId)).toEqual(settled)
    expect(
      (await rows(page, "account-payments")).filter((row) => scalarQueryString(row.ref ?? row.ref_) === reference),
    ).toHaveLength(1)
  })

  test("a register-payment reply lost after commit is unknown, converges once, and offers no retry", async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const moveId = await createAndPostInvoice(page, "cov08-lost")
    const { paymentId } = await createAndPostPayment(page, moveId)

    await openRegisterForm(page, paymentId, moveId)
    const injected = await loseNextResponse(page, "register_payment_on_invoice")
    await submitForm(page, "register-payment-invoices")
    await expect(page.getByText(/Result unknown/i).first()).toBeVisible({ timeout: 30_000 })
    expect(injected.lost()).toBe(true)

    await expect
      .poll(() => moveSnapshot(page, moveId), { timeout: 30_000 })
      .toMatchObject({ residual: 0, paymentState: "Paid" })
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0)
    // The commit happened exactly once: the residual is exactly zero, never overpaid.
    expect((await moveSnapshot(page, moveId)).residual).toBe(0)
  })
})

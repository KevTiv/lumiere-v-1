import React from "react"
import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { i18n, resources } from "@lumiere/i18n"
import { CrmInboxDeliveryStatus } from "./crm-inbox-delivery-status"

Object.assign(globalThis, { React })

test("the rendered delivery badge distinguishes queue, acceptance, delivery and failure", async () => {
  await i18n.changeLanguage("en")
  const queued = renderToStaticMarkup(<CrmInboxDeliveryStatus delivery={{ status: "queued" }} />)
  const accepted = renderToStaticMarkup(<CrmInboxDeliveryStatus delivery={{ status: "accepted", providerMessageId: "WA-17" }} />)
  const delivered = renderToStaticMarkup(<CrmInboxDeliveryStatus delivery={{ status: "delivered", providerMessageId: "WA-17" }} />)
  const failed = renderToStaticMarkup(<CrmInboxDeliveryStatus delivery={{ status: "failed", providerMessageId: "WA-18", reason: "<unreachable>" }} />)
  const inconclusive = renderToStaticMarkup(<CrmInboxDeliveryStatus delivery={{ status: "inconclusive" }} />)
  assert.match(queued, /Saved to the local queue/)
  assert.match(accepted, /Provider accepted; delivery is unconfirmed/)
  assert.match(delivered, /Provider confirmed delivery/)
  assert.match(failed, /Provider reported delivery failure/)
  assert.match(failed, /WA-18/)
  assert.match(failed, /&lt;unreachable&gt;/)
  assert.match(inconclusive, /No verified delivery status is available/)
  assert.doesNotMatch(inconclusive, /Provider reference/)
})

test("each CRM locale supplies the queue action and every evidence label", () => {
  for (const locale of ["en", "fr", "rw", "sw"] as const) {
    const { inbox } = resources[locale].translation.crm
    assert.ok(inbox.queueMessage.trim(), locale)
    assert.deepEqual(Object.keys(inbox.delivery), Object.keys(resources.en.translation.crm.inbox.delivery), locale)
    assert.ok(Object.values(inbox.delivery).every((value) => value.trim()), locale)
  }
})

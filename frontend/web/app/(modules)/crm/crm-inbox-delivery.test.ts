import assert from "node:assert/strict"
import test from "node:test"
import { crmInboxDelivery, crmWhatsAppConversation } from "./crm-inbox-delivery"

const scope = { organizationId: 1n, companyId: 2n, contactId: 3n }
const company = { organization_id: "1", company_id: { some: "2" } }
const thread = { ...company, id: "4", contact_id: "3", channel: { tag: "WhatsApp" }, phone_identity_id: { some: "5" } }
const linkedId = "9007199254740993"
const queued = { ...company, id: "6", conversation_id: "4", direction: "outbound", status: "queued" }
const crm = { ...queued, status: "sent", provider_message_id: { some: "whatsapp-6" }, operational_message_id: { some: linkedId } }
const operational = { ...company, id: linkedId, contact_id: "3", channel: { tag: "WhatsApp" }, phone_identity_id: "5", status: { tag: "Sent" } }

test("local queue and drafts do not require or imply provider evidence", () => {
  assert.deepEqual(crmInboxDelivery(queued, thread, [], [], scope), { status: "queued" })
  assert.deepEqual(crmInboxDelivery({ ...queued, status: "draft" }, thread, [], [], scope), { status: "draft" })
  assert.deepEqual(crmInboxDelivery({ ...queued, operational_message_id: "invalid" }, thread, [], [], scope), { status: "inconclusive" })
  assert.deepEqual(crmInboxDelivery({ ...queued, status: "delivered" }, thread, [], [], scope), { status: "inconclusive" })
})

test("provider acceptance and delivery require corroboration of the saved operational status", () => {
  assert.deepEqual(crmInboxDelivery(crm, thread, [crm], [operational], scope), { status: "accepted", providerMessageId: "whatsapp-6" })
  const delivered = { ...crm, status: "delivered" }
  assert.deepEqual(crmInboxDelivery(delivered, thread, [delivered], [operational], scope), { status: "inconclusive" })
  assert.deepEqual(crmInboxDelivery(delivered, thread, [delivered], [{ ...operational, status: { tag: "Delivered" } }], scope), { status: "delivered", providerMessageId: "whatsapp-6" })
})

test("provider failure shows the authorized reason when projected", () => {
  const failed = { ...crm, status: "failed" }
  const failure = { ...operational, status: { tag: "Failed" } }
  assert.deepEqual(crmInboxDelivery(failed, thread, [failed], [{ ...failure, failure_reason: { some: "Recipient not reachable" } }], scope), {
    status: "failed", providerMessageId: "whatsapp-6", reason: "Recipient not reachable",
  })
  assert.deepEqual(crmInboxDelivery(failed, thread, [failed], [failure], scope), {
    status: "failed", providerMessageId: "whatsapp-6", reason: null,
  })
})

test("cross-scope, missing, unsafe and ambiguous provider linkage fail closed", () => {
  for (const row of [
    { ...operational, company_id: "7" },
    { ...operational, organization_id: "7" },
    { ...operational, id: Number(linkedId) },
    { ...operational, contact_id: "7" },
    { ...operational, phone_identity_id: "7" },
    { ...operational, channel: { tag: "Email" } },
  ]) assert.deepEqual(crmInboxDelivery(crm, thread, [crm], [row], scope), { status: "inconclusive" })
  assert.deepEqual(crmInboxDelivery(crm, thread, [{ ...crm, conversation_id: "7" }], [operational], scope), { status: "inconclusive" })
  assert.deepEqual(crmInboxDelivery(crm, thread, [crm, { ...crm, conversation_id: "7" }], [operational], scope), { status: "inconclusive" })
  assert.deepEqual(crmInboxDelivery(crm, thread, [{ ...crm, provider_message_id: undefined }], [operational], scope), { status: "inconclusive" })
  assert.deepEqual(crmInboxDelivery(crm, thread, [crm], [operational, operational], scope), { status: "inconclusive" })
  assert.deepEqual(crmInboxDelivery(crm, thread, [crm], [], scope), { status: "inconclusive" })
  assert.equal(crmWhatsAppConversation({ ...thread, channel: { tag: "Email" } }, scope), false)
})

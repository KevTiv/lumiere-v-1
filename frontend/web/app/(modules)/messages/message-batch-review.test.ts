import assert from "node:assert/strict"
import { test } from "node:test"
import { batchEvidenceComplete, batchExclusions, batchInScope, filterBatchChoices, messageProviderEvidence, messagesForBatch } from "./message-batch-review"

test("recipient search matches authorized labels and details without editing the selection", () => {
  const options = [{ value: "1", label: "Alice", description: "+250 123" }, { value: "2", label: "Alice", description: "+250 456" }]
  assert.deepEqual(filterBatchChoices(options, "456"), [options[1]])
  assert.deepEqual(filterBatchChoices(options, "ALICE"), options)
  assert.deepEqual(filterBatchChoices(options, "missing"), [])
  assert.equal(options.length, 2)
})

test("batch exclusion evidence requires a complete exact creation-time snapshot", () => {
  const excluded = { model: "contact", recordId: "9007199254740993", contactId: "9007199254740993", reason: "channel_opted_out" }
  const batch = { id: "9", organizationId: "1", companyId: "2", excludedCount: "1", metadata: JSON.stringify({ batch_exclusions_v1: [excluded] }) }
  const snapshot = { id: "9", organizationId: "1", companyId: "2", exclusions: [excluded] }
  assert.deepEqual(batchExclusions(batch, [snapshot]), [excluded])
  assert.equal(batchExclusions(batch), null, "arbitrary legacy metadata is not evidence")
  assert.equal(batchExclusions(batch, [{ ...snapshot, companyId: "3" }]), null)
  assert.equal(batchExclusions({ ...batch, excludedCount: "2" }, [snapshot]), null)
  assert.equal(batchExclusions({ excludedCount: "1" }), null)
  assert.equal(batchExclusions({ ...batch, metadata: "bad" }), null)
  assert.equal(batchExclusions(batch, [{ ...snapshot, exclusions: [{ ...excluded, reason: "unknown" }] }]), null)
  assert.equal(batchExclusions({ ...batch, excludedCount: "2" }, [{ ...snapshot, exclusions: [excluded, excluded] }]), null)
  assert.deepEqual(batchExclusions({ excludedCount: "0" }), [])
})

test("provider acceptance is distinct from delivery and requires exact authorized operational linkage", () => {
  const operational = { id: "9007199254740993", organizationId: "1", companyId: "2", status: { tag: "Sent" } }
  const provider = { id: "10", organizationId: "1", companyId: "2", operationalMessageId: operational.id, providerMessageId: "provider-17", direction: "outbound", status: "sent" }
  assert.deepEqual(messageProviderEvidence(operational, [provider], 1n, 2n), { status: "accepted", providerMessageId: "provider-17" })
  assert.equal(messageProviderEvidence(operational, [{ ...provider, status: "delivered" }], 1n, 2n), null)
  assert.deepEqual(messageProviderEvidence({ ...operational, status: { tag: "Delivered" } }, [{ ...provider, status: "delivered" }], 1n, 2n), { status: "delivered", providerMessageId: "provider-17" })
  assert.equal(messageProviderEvidence(operational, [{ ...provider, companyId: "3" }], 1n, 2n), null)
  assert.equal(messageProviderEvidence(operational, [{ ...provider, operationalMessageId: "9007199254740992" }], 1n, 2n), null)
  assert.equal(messageProviderEvidence(operational, [{ ...provider, providerMessageId: undefined }], 1n, 2n), null)
  assert.equal(messageProviderEvidence(operational, [provider, provider], 1n, 2n), null)
  assert.equal(messageProviderEvidence(operational, [], 1n, 2n), null)
})

test("batch review requires exact company/organization identities and does not infer missing scope", () => {
  assert.equal(batchInScope({ organizationId: "1", companyId: "2" }, 1n, 2n), true)
  assert.equal(batchInScope({ organizationId: "1", companyId: null }, 1n, 2n), true)
  assert.equal(batchInScope({ organizationId: "1" }, 1n, 2n), false)
  assert.equal(batchInScope({ organizationId: "1", companyId: "3" }, 1n, 2n), false)
  assert.equal(batchInScope({ organizationId: "3", companyId: "2" }, 1n, 2n), false)
  assert.equal(batchInScope({ organizationId: "1", companyId: "2" }, 1n, 0n), false)
})

test("saved-message evidence joins exact large IDs and excludes foreign or differently scoped rows", () => {
  const batch = { id: "9007199254740993", organizationId: "1", companyId: "2" }
  const saved = { id: "10", organizationId: "1", companyId: "2", contactId: "7", messageBatchId: batch.id, renderedBody: "Exact saved copy" }
  const rows = [saved, { ...saved, id: "11", messageBatchId: "9007199254740992" }, { ...saved, id: "12", companyId: "3" }, { ...saved, id: "13", companyId: null }, { ...saved, id: "14", organizationId: "3" }]
  assert.deepEqual(messagesForBatch(rows, batch, 1n, 2n), [saved])
  assert.equal(batchEvidenceComplete([saved], "1"), true)
  assert.equal(batchEvidenceComplete([saved], "2"), false)
  assert.equal(batchEvidenceComplete([saved], undefined), false)
  assert.equal(batchEvidenceComplete([saved, saved], "2"), false)
  assert.equal(batchEvidenceComplete([{ ...saved, renderedBody: undefined }], "1"), false)
  assert.equal(batchEvidenceComplete([{ ...saved, contactId: undefined }], "1"), false)
})

import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  fetchContactIdByName,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  smokeName,
} from "./helpers"
import {
  CAPABILITIES,
  CAPABILITY_PENDING,
  auditCount,
  callRaw,
  callRawOk,
  expectKnownDefect,
  field,
  idOf,
  none,
  openActorPages,
  pendingContract,
  pollRow,
  pretenantTags,
  provisionActor,
  queryRows,
  requireCapability,
  some,
  tagOf,
  withActor,
  type Actor,
  type ReducerResult,
} from "./pretenant-support"

/**
 * COMMUNICATION / AUTHORITY certification at the operator boundary: two authenticated sessions
 * for separation of duties, simultaneous approvals, and consent changes between preview and
 * approval. Reducer-level cases (callbacks, disorder, immutability, merge, tenancy) live in
 * spacetimedb/tests/pretenant/communications_cert.rs.
 */

const SMS = { sms: [] }

type Scope = { organizationId: number; companyId: number }

async function scope(page: Page): Promise<Scope> {
  return {
    organizationId: await fetchSessionOrganizationId(page),
    companyId: await fetchDefaultCompanyId(page),
  }
}

async function recipient(page: Page, s: Scope, marker: string, phone: string): Promise<number> {
  const name = `${marker} recipient`
  await callReducerBff(page, "create_contact", [
    s.organizationId,
    {
      name,
      type: "person",
      companyId: s.companyId,
      isCustomer: true,
      isVendor: false,
      isEmployee: false,
      isProspect: false,
      isPartner: false,
      customerRank: 1,
      supplierRank: 0,
    },
  ])
  const contactId = await fetchContactIdByName(page, name)
  await callRawOk(page, "create_contact_identity", [
    s.organizationId,
    {
      contact_id: contactId,
      company_id: none,
      kind: { primary: [] },
      raw_value: phone,
      is_preferred: true,
      verification_state: none,
      metadata: some(marker),
    },
  ])
  return contactId
}

async function template(page: Page, s: Scope, marker: string): Promise<number> {
  await callRawOk(page, "create_message_template", [
    s.organizationId,
    {
      company_id: none,
      key: `${marker}-template`,
      name: `${marker} template`,
      locale: "en",
      subject: some(`Reminder ${marker}`),
      body_template: "Hello {{customer_name}}, invoice {{invoice_number}} is due.",
      allowed_variables: ["customer_name", "invoice_number"],
      applicable_channels: [SMS],
      retention_classification: "operational",
      metadata: some(marker),
    },
  ])
  const row = await pollRow(
    page,
    "message-templates",
    (candidate) => String(field(candidate, "subject") ?? "").includes(marker),
    `template ${marker}`,
  )
  const id = idOf(field(row, "id"))
  if (id == null) throw new Error("template has no id")
  return id
}

async function batchStatus(page: Page, batchId: number): Promise<string> {
  const row = (await queryRows(page, "message-batches")).find((candidate) => idOf(field(candidate, "id")) === batchId)
  return tagOf(field(row, "status"))
}

async function children(page: Page, batchId: number) {
  return (await queryRows(page, "operational-messages")).filter(
    (row) => idOf(field(row, "messageBatchId", "message_batch_id")) === batchId,
  )
}

/** Owner seeds recipient + template; `creatorPage` creates the batch. Returns the batch id. */
async function batchCreatedBy(
  ownerPage: Page,
  creatorPage: Page,
  marker: string,
  phone: string,
): Promise<{ batchId: number; contactId: number; s: Scope }> {
  const s = await scope(ownerPage)
  const contactId = await recipient(ownerPage, s, marker, phone)
  const templateId = await template(ownerPage, s, marker)
  await callRawOk(creatorPage, "create_message_batch", [
    s.organizationId,
    {
      company_id: some(s.companyId),
      template_id: templateId,
      channel: SMS,
      subject_model: "contact",
      subject_query: some(marker),
      candidate_contact_ids: [contactId],
      metadata: some(marker),
    },
  ])
  const batch = await pollRow(
    ownerPage,
    "message-batches",
    (row) => idOf(field(row, "templateId", "template_id")) === templateId,
    `batch ${marker}`,
  )
  const batchId = idOf(field(batch, "id"))
  if (batchId == null) throw new Error("batch has no id")
  expect(Number(field(batch, "recipientCount", "recipient_count"))).toBe(1)
  return { batchId, contactId, s }
}

function approveArgs(s: Scope, batchId: number, reason: string) {
  return [s.organizationId, batchId, { approved: true, reason: some(reason) }]
}

/** A permission-denied response means the actor fixture is wrong, not that the invariant holds. */
function requireNotPermissionDenied(result: ReducerResult, who: string): void {
  if (!result.ok && /permission denied/i.test(result.error)) {
    throw new Error(`SETUP ${who} lacks message_batch approval permission: ${result.error}`)
  }
}

test.describe("Pre-tenant communications adversarial", { tag: pretenantTags("@communications") }, () => {
  test.describe.configure({ mode: "serial" })

  let creator: Actor
  let approverA: Actor
  let approverB: Actor

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: "tests/e2e/.auth/user.json" })
    const owner = await context.newPage()
    creator = await provisionActor(owner, "msg-creator", ["message_batch:create", "message_batch:approve"])
    approverA = await provisionActor(owner, "msg-approver-a", ["message_batch:approve"])
    approverB = await provisionActor(owner, "msg-approver-b", ["message_batch:approve"])
    await context.close()
  })

  test("COMM-11-E2E creator holding approve permission cannot approve their own batch", async ({ page, browser }) => {
    test.setTimeout(180_000)
    const marker = smokeName("pt-comm11")
    const selfApproval = await withActor(browser, creator, async (creatorPage) => {
      const created = await batchCreatedBy(page, creatorPage, marker, "+12025550411")
      const result = await callRaw(creatorPage, "review_message_batch", approveArgs(created.s, created.batchId, "self approval"))
      return { ...created, result }
    })
    requireNotPermissionDenied(selfApproval.result, "creator")

    await expectKnownDefect("COMM-11", "batch creator can approve their own batch", async () => {
      expect(selfApproval.result.ok, "creator self-approval must be rejected").toBe(false)
      expect(await batchStatus(page, selfApproval.batchId)).toBe("pendingapproval")
    })
  })

  test("COMM-11-E2E simultaneous independent approvals execute once", async ({ page, browser }) => {
    test.setTimeout(180_000)
    const marker = smokeName("pt-comm11-sim")
    const { batchId, s } = await withActor(browser, creator, (creatorPage) =>
      batchCreatedBy(page, creatorPage, marker, "+12025550412"),
    )
    const approvers = await openActorPages(browser, [approverA, approverB])
    try {
      const results = await Promise.all(
        approvers.pages.map((approverPage, index) =>
          callRaw(approverPage, "review_message_batch", approveArgs(s, batchId, `simultaneous ${index}`)),
        ),
      )
      results.forEach((result, index) => requireNotPermissionDenied(result, `approver ${index}`))
      expect(results.some((result) => result.ok), results.map((r) => r.error).join(" | ")).toBe(true)
    } finally {
      await approvers.close()
    }
    await expect.poll(() => batchStatus(page, batchId)).toBe("approved")
    await expect.poll(() => auditCount(page, "message_batch", batchId, "APPROVE")).toBe(1)
  })

  test("COMM-15-E2E approver retry after a committed approval is idempotent", async ({ page, browser }) => {
    test.setTimeout(180_000)
    const marker = smokeName("pt-comm15")
    const { batchId, s } = await withActor(browser, creator, (creatorPage) =>
      batchCreatedBy(page, creatorPage, marker, "+12025550415"),
    )
    const [first, retry] = await withActor(browser, approverA, async (approverPage) => [
      await callRaw(approverPage, "review_message_batch", approveArgs(s, batchId, "approve")),
      await callRaw(approverPage, "review_message_batch", approveArgs(s, batchId, "approve")),
    ])
    requireNotPermissionDenied(first, "approver")
    expect(first.ok, first.error).toBe(true)
    await expect.poll(() => auditCount(page, "message_batch", batchId, "APPROVE")).toBe(1)
    expect(await batchStatus(page, batchId)).toBe("approved")

    await expectKnownDefect("COMM-15", "approval retry by the approver returns an error", () => {
      expect(retry.ok, `retry should be an idempotent success: ${retry.error}`).toBe(true)
    })
  })

  test("COMM-06-E2E opt-out between preview and approval is revalidated", async ({ page, browser }) => {
    test.setTimeout(180_000)
    const marker = smokeName("pt-comm06")
    const { batchId, contactId, s } = await withActor(browser, creator, (creatorPage) =>
      batchCreatedBy(page, creatorPage, marker, "+12025550406"),
    )
    await callRawOk(page, "set_contact_communication_preference", [s.organizationId, some(s.companyId), contactId, SMS, false])
    const approval = await withActor(browser, approverA, (approverPage) =>
      callRaw(approverPage, "review_message_batch", approveArgs(s, batchId, "after opt-out")),
    )
    requireNotPermissionDenied(approval, "approver")

    await expectKnownDefect("COMM-06", "approval does not revalidate consent", async () => {
      const targeted = (await children(page, batchId)).some(
        (row) =>
          idOf(field(row, "contactId", "contact_id")) === contactId &&
          ["draft", "queued", "copied"].includes(tagOf(field(row, "status"))),
      )
      const approved = (await batchStatus(page, batchId)) === "approved"
      expect(approved && targeted, "approved batch must not target an opted-out contact").toBe(false)
    })
  })

  test("COMM-OUT-01 ambiguous outbound provider timeout yields one provider-visible intent", { tag: CAPABILITY_PENDING }, async ({ page }) => {
    await requireCapability(page, CAPABILITIES.outboundProviderDispatch)
    pendingContract(
      CAPABILITIES.outboundProviderDispatch,
      "COMM-OUT-01",
      "provider accepts, response is lost, caller retries: exactly one provider request per business message (stable provider idempotency key), one timeline effect, an explicit unknown attempt reconciled by callback, never a blind resend",
    )
  })
})

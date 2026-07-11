import { expect, test, type Page } from "@playwright/test"

import {
  callReducerBff,
  fetchContactIdByName,
  fetchSessionOrganizationId,
  smokeName,
} from "./helpers"

type QueryRow = Record<string, unknown>

const SMS = { sms: [] }
const DRAFT = { draft: [] }
const UNVERIFIED = { unverified: [] }

function none() {
  return { none: [] }
}

function some(value: unknown) {
  return { some: value }
}

function rowValue(row: QueryRow, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row) return row[key]
  }
  return undefined
}

function scalarId(value: unknown): number | null {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "") return Number(value)
  if (value && typeof value === "object" && "some" in value) {
    return scalarId((value as { some: unknown }).some)
  }
  return null
}

function enumName(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>
    if (typeof row.tag === "string") return row.tag.toLowerCase()
    const [key] = Object.keys(row)
    if (key) return key.toLowerCase()
  }
  return ""
}

function optionValue(value: unknown): unknown {
  if (value && typeof value === "object" && "some" in value) {
    return (value as { some: unknown }).some
  }
  if (value && typeof value === "object" && "none" in value) return null
  return value
}

function optionIsPresent(value: unknown): boolean {
  return optionValue(value) != null
}

async function queryRows(page: Page, resource: string): Promise<QueryRow[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()} ${await response.text()}`)
  }
  const json = (await response.json()) as { data?: QueryRow[] }
  return json.data ?? []
}

async function waitForRow(
  page: Page,
  resource: string,
  predicate: (row: QueryRow) => boolean,
  description: string,
): Promise<QueryRow> {
  let matched: QueryRow | undefined
  await expect
    .poll(
      async () => {
        matched = (await queryRows(page, resource)).find(predicate)
        return matched !== undefined
      },
      { timeout: 30_000, message: `waiting for ${description}` },
    )
    .toBe(true)
  if (!matched) throw new Error(`Timed out waiting for ${description}`)
  return matched
}

async function callRawReducer(page: Page, reducer: string, args: unknown[]): Promise<void> {
  const response = await page.request.post(`/api/call/${reducer}`, {
    data: args,
    headers: { "Content-Type": "application/json" },
  })
  if (response.ok()) return
  throw new Error(`Reducer ${reducer} failed (${response.status()}): ${await response.text()}`)
}

async function createContact(page: Page, organizationId: number, name: string): Promise<number> {
  await callReducerBff(page, "create_contact", [
    organizationId,
    {
      name,
      type: "person",
      isCustomer: true,
      isVendor: false,
      isEmployee: false,
      isProspect: false,
      isPartner: false,
      customerRank: 1,
      supplierRank: 0,
    },
  ])
  return fetchContactIdByName(page, name)
}

async function createPrimaryPhoneIdentity(
  page: Page,
  organizationId: number,
  contactId: number,
  phone: string,
  marker: string,
): Promise<number> {
  await callRawReducer(page, "create_contact_identity", [
    organizationId,
    {
      contact_id: contactId,
      company_id: none(),
      kind: { primary: [] },
      raw_value: phone,
      is_preferred: true,
      verification_state: some(UNVERIFIED),
      metadata: some(marker),
    },
  ])

  const identity = await waitForRow(
    page,
    "contact-phone-identities",
    (row) => scalarId(rowValue(row, "contactId", "contact_id")) === contactId,
    `phone identity for contact ${contactId}`,
  )
  const identityId = scalarId(rowValue(identity, "id"))
  if (identityId == null) throw new Error("Created phone identity is missing an id")
  return identityId
}

async function createApprovedReminderTemplate(
  page: Page,
  organizationId: number,
  marker: string,
): Promise<number> {
  const key = `${marker}-invoice-reminder`
  await callRawReducer(page, "create_message_template", [
    organizationId,
    {
      company_id: none(),
      key,
      name: `${marker} invoice reminder`,
      locale: "en",
      subject: some("Invoice {{invoice_number}} reminder"),
      body_template: "Hello {{customer_name}}, invoice {{invoice_number}} is due.",
      allowed_variables: ["customer_name", "invoice_number"],
      applicable_channels: [SMS],
      retention_classification: "operational",
      metadata: some(marker),
    },
  ])

  const template = await waitForRow(
    page,
    "message-templates",
    (row) => rowValue(row, "key") === key,
    `template ${key}`,
  )
  expect(String(rowValue(template, "reviewState", "review_state") ?? "").toLowerCase()).toBe(
    "approved",
  )
  expect(rowValue(template, "bodyTemplate", "body_template")).toBe(
    "Hello {{customer_name}}, invoice {{invoice_number}} is due.",
  )

  const templateId = scalarId(rowValue(template, "id"))
  if (templateId == null) throw new Error("Created template is missing an id")
  return templateId
}

function auditActionExists(rows: QueryRow[], tableName: string, recordId: number, action: string): boolean {
  return rows.some(
    (row) =>
      rowValue(row, "tableName", "table_name") === tableName &&
      scalarId(rowValue(row, "recordId", "record_id")) === recordId &&
      String(rowValue(row, "action") ?? "").toUpperCase() === action,
  )
}

test.describe("Operational messaging", { tag: ["@phase-1", "@operational-messaging"] }, () => {
  test("P1-MSG-01 renders an approved invoice reminder, preserves masked recipient display, and audits copy state", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const marker = smokeName("msg-copy")
    const recipientName = `${marker} recipient`
    const recipientPhone = "+15550101001"
    const organizationId = await fetchSessionOrganizationId(page)
    const contactId = await createContact(page, organizationId, recipientName)
    const phoneIdentityId = await createPrimaryPhoneIdentity(
      page,
      organizationId,
      contactId,
      recipientPhone,
      marker,
    )
    const templateId = await createApprovedReminderTemplate(page, organizationId, marker)

    await callRawReducer(page, "create_operational_message", [
      organizationId,
      {
        company_id: none(),
        template_id: templateId,
        contact_id: contactId,
        phone_identity_id: phoneIdentityId,
        channel: SMS,
        subject_model: "account_move",
        subject_id: 1,
        rendered_subject: none(),
        rendered_body: "",
        variables: [
          { key: "customer_name", value: recipientName },
          { key: "invoice_number", value: "INV-E2E-001" },
        ],
        status: DRAFT,
        metadata: some(marker),
      },
    ])

    const message = await waitForRow(
      page,
      "operational-messages",
      (row) =>
        scalarId(rowValue(row, "templateId", "template_id")) === templateId &&
        scalarId(rowValue(row, "contactId", "contact_id")) === contactId &&
        scalarId(rowValue(row, "messageBatchId", "message_batch_id")) === 0,
      `single reminder for ${marker}`,
    )
    const messageId = scalarId(rowValue(message, "id"))
    if (messageId == null) throw new Error("Created operational message is missing an id")

    expect(rowValue(message, "renderedBody", "rendered_body")).toBe(
      `Hello ${recipientName}, invoice INV-E2E-001 is due.`,
    )
    expect(optionValue(rowValue(message, "renderedSubject", "rendered_subject"))).toBe(
      "Invoice INV-E2E-001 reminder",
    )
    expect(enumName(rowValue(message, "status"))).toBe("draft")

    const identity = await waitForRow(
      page,
      "contact-phone-identities",
      (row) => scalarId(rowValue(row, "id")) === phoneIdentityId,
      `masked recipient identity ${phoneIdentityId}`,
    )
    const maskedPhone = String(rowValue(identity, "displayMasked", "display_masked") ?? "")
    expect(maskedPhone).toMatch(/^\+\d{3}\*+\d{3}$/)
    expect(maskedPhone).not.toContain(recipientPhone)

    await callRawReducer(page, "record_message_copied", [organizationId, messageId])

    await expect
      .poll(async () => {
        const row = (await queryRows(page, "operational-messages")).find(
          (candidate) => scalarId(rowValue(candidate, "id")) === messageId,
        )
        return {
          status: enumName(rowValue(row ?? {}, "status")),
          copied: optionIsPresent(rowValue(row ?? {}, "copiedAt", "copied_at")),
        }
      })
      .toEqual({ status: "copied", copied: true })

    await expect
      .poll(async () => {
        const rows = await queryRows(page, "audit-log")
        return {
          created: auditActionExists(rows, "operational_message", messageId, "CREATE"),
          copied: auditActionExists(rows, "operational_message", messageId, "COPIED"),
        }
      })
      .toEqual({ created: true, copied: true })
  })

  test("P1-MSG-02 previews eligible recipients only, then approves and cancels the batch with audit evidence", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const marker = smokeName("msg-batch")
    const organizationId = await fetchSessionOrganizationId(page)
    const eligibleContactId = await createContact(page, organizationId, `${marker} eligible`)
    const optedOutContactId = await createContact(page, organizationId, `${marker} opted-out`)
    const noPhoneContactId = await createContact(page, organizationId, `${marker} no-phone`)
    const eligiblePhoneIdentityId = await createPrimaryPhoneIdentity(
      page,
      organizationId,
      eligibleContactId,
      "+15550101002",
      marker,
    )
    await createPrimaryPhoneIdentity(page, organizationId, optedOutContactId, "+15550101003", marker)
    const templateId = await createApprovedReminderTemplate(page, organizationId, marker)

    await callRawReducer(page, "set_contact_communication_preference", [
      organizationId,
      none(),
      optedOutContactId,
      SMS,
      false,
    ])

    await callRawReducer(page, "create_message_batch", [
      organizationId,
      {
        company_id: none(),
        template_id: templateId,
        channel: SMS,
        subject_model: "account_move",
        subject_query: some(marker),
        candidate_contact_ids: [eligibleContactId, optedOutContactId, noPhoneContactId],
        metadata: some(marker),
      },
    ])

    const batch = await waitForRow(
      page,
      "message-batches",
      (row) => scalarId(rowValue(row, "templateId", "template_id")) === templateId,
      `batch preview for ${marker}`,
    )
    const batchId = scalarId(rowValue(batch, "id"))
    if (batchId == null) throw new Error("Created message batch is missing an id")

    expect(Number(rowValue(batch, "recipientCount", "recipient_count"))).toBe(1)
    expect(Number(rowValue(batch, "excludedCount", "excluded_count"))).toBe(2)
    expect(enumName(rowValue(batch, "status"))).toBe("pendingapproval")
    const previewSampleIds = rowValue(batch, "previewSampleIds", "preview_sample_ids")
    expect(previewSampleIds).toEqual([eligiblePhoneIdentityId])

    const children = (await queryRows(page, "operational-messages")).filter(
      (row) => scalarId(rowValue(row, "messageBatchId", "message_batch_id")) === batchId,
    )
    expect(children).toHaveLength(1)
    expect(scalarId(rowValue(children[0] ?? {}, "contactId", "contact_id"))).toBe(eligibleContactId)
    expect(enumName(rowValue(children[0] ?? {}, "status"))).toBe("draft")

    // The current local fixture has one authenticated actor. This covers lifecycle transitions;
    // independent-approver enforcement needs a second role/session fixture before it can be E2E-proven.
    await callRawReducer(page, "review_message_batch", [
      organizationId,
      batchId,
      { approved: true, reason: some("E2E batch approval") },
    ])

    await expect
      .poll(async () => {
        const row = (await queryRows(page, "message-batches")).find(
          (candidate) => scalarId(rowValue(candidate, "id")) === batchId,
        )
        return {
          status: enumName(rowValue(row ?? {}, "status")),
          approvedAt: optionIsPresent(rowValue(row ?? {}, "approvedAt", "approved_at")),
        }
      })
      .toEqual({ status: "approved", approvedAt: true })

    await callRawReducer(page, "cancel_message_batch", [organizationId, batchId])

    await expect
      .poll(async () => {
        const batchRow = (await queryRows(page, "message-batches")).find(
          (candidate) => scalarId(rowValue(candidate, "id")) === batchId,
        )
        const childRows = (await queryRows(page, "operational-messages")).filter(
          (candidate) => scalarId(rowValue(candidate, "messageBatchId", "message_batch_id")) === batchId,
        )
        return {
          batch: enumName(rowValue(batchRow ?? {}, "status")),
          childrenCancelled:
            childRows.length === 1 && enumName(rowValue(childRows[0] ?? {}, "status")) === "cancelled",
        }
      })
      .toEqual({ batch: "cancelled", childrenCancelled: true })

    await expect
      .poll(async () => {
        const rows = await queryRows(page, "audit-log")
        return {
          created: auditActionExists(rows, "message_batch", batchId, "CREATE"),
          approved: auditActionExists(rows, "message_batch", batchId, "APPROVE"),
          cancelled: auditActionExists(rows, "message_batch", batchId, "CANCEL"),
        }
      })
      .toEqual({ created: true, approved: true, cancelled: true })
  })
})

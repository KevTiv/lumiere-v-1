import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { SESSION_OPERATION_DESCRIPTORS } from "@lumiere/contracts/generated/operation-descriptors"

import { createStdbSdk } from "./sdk"

function operationUrl(operation: keyof typeof SESSION_OPERATION_DESCRIPTORS): string {
  return `/api/operations/${encodeURIComponent(
    SESSION_OPERATION_DESCRIPTORS[operation].contractOperationId,
  )}`
}

test("application SDK binds the contracts-owned generated facade", async () => {
  const source = await readFile(new URL("./sdk.ts", import.meta.url), "utf8")
  assert.match(source, /createGeneratedStdbSdk/)
  assert.doesNotMatch(source, /export interface StdbSdk/)
  assert.doesNotMatch(source, /settings:\s*\{\s*integrations:/)
})

test("accounting SDK targets the immutable typed operation and selected company", async () => {
  let request: { url: string; body: string } | undefined
  const apiFetch = async (url: string, init?: RequestInit) => {
    request = { url, body: String(init?.body) }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  await createStdbSdk(apiFetch).forCompany(42n).accounting.accounts.create({
    code: "1000",
    name: "Cash",
    userTypeId: 1n,
    currencyId: null,
    internalType: null,
    internalGroup: null,
    groupId: null,
    reconcile: false,
    taxIds: [],
    note: null,
    openingDebit: 0,
    openingCredit: 0,
    allowedJournalIds: [],
    nonTrade: false,
    isOffBalance: false,
    metadata: null,
  })

  assert.equal(request?.url, operationUrl("create_account_account"))
  assert.deepEqual(JSON.parse(request?.body ?? "{}"), {
    params: {
      company_id: { some: 42 },
      code: "1000",
      name: "Cash",
      user_type_id: 1,
      currency_id: { none: [] },
      internal_type: null,
      internal_group: null,
      group_id: { none: [] },
      reconcile: false,
      tax_ids: [],
      note: { none: [] },
      opening_debit: 0,
      opening_credit: 0,
      allowed_journal_ids: [],
      non_trade: false,
      is_off_balance: false,
      metadata: { none: [] },
    },
  })
})

test("settings SDK owns integration encoding and immutable operation routing", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const apiFetch = async (url: string, init?: RequestInit) => {
    requests.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response(null, { status: 204 })
  }
  const sdk = createStdbSdk(apiFetch)

  await sdk.settings.integrations.googleDrive.create({
    companyId: 42n,
    name: "Finance drive",
    accountEmail: "finance@example.com",
    accountId: "drive-account",
    credentialsReference: "secret/google-drive",
    syncEnabled: true,
    webhookEnabled: false,
    syncDirection: "Bidirectional",
    conflictPolicy: "PreferRemote",
    syncFrequencyMinutes: 60,
    allowedFileTypes: ["pdf"],
    maxFileSizeMb: 50,
  })
  await sdk.settings.integrations.whatsapp.create({
    name: "Support",
    phoneNumber: "+31000000000",
    phoneNumberId: "phone-id",
    businessAccountId: "business-id",
    displayName: "Support",
    credentialsReference: "secret/whatsapp",
    webhookSecretReference: "secret/whatsapp-webhook",
    messagingEnabled: true,
    notificationsEnabled: true,
    templateMessagingEnabled: true,
    interactiveMessagingEnabled: true,
    defaultLanguage: "en",
    webhookEnabled: false,
    subscribedWebhookEvents: ["messages"],
    dailyMessageLimit: 1000,
    isPrimary: true,
  })
  await sdk.settings.integrations.googleDrive.delete(7n)
  await sdk.forCompany(42n).settings.aiChats.setArchived("chat-1", true)

  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      operationUrl("create_google_drive_connection"),
      operationUrl("create_whatsapp_business_account"),
      operationUrl("delete_integration"),
      operationUrl("archive_ai_chat_session"),
    ],
  )
  assert.equal("organizationId" in requests[0].body, false)
  assert.equal(requests[0].body.companyId, 42)
  assert.deepEqual(requests[0].body.syncDirection, { tag: "Bidirectional" })
  assert.deepEqual(requests[0].body.conflictPolicy, { tag: "PreferRemote" })
  assert.deepEqual(
    (requests[1].body.params as Record<string, unknown>).company_id,
    { none: [] },
  )
  assert.deepEqual(requests[2].body, {
    integrationId: 7,
    integrationType: { tag: "GoogleDrive" },
  })
  assert.deepEqual(requests[3].body, {
    companyId: 42,
    sessionKey: "chat-1",
    archived: true,
  })
})

test("settings SDK surfaces typed API errors", async () => {
  const sdk = createStdbSdk(async () =>
    new Response(JSON.stringify({ message: "integration denied" }), { status: 403 }),
  )

  await assert.rejects(
    sdk.settings.integrations.whatsapp.setPrimary(9n),
    /integration denied/,
  )
})

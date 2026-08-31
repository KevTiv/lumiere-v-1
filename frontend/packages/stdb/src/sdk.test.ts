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

test("application SDK owns the domain facade over generated contract facts", async () => {
  const source = await readFile(new URL("./sdk.ts", import.meta.url), "utf8")
  assert.match(source, /export interface StdbSdk/)
  assert.match(source, /settings:\s*\{\s*readonly integrations:/)
  assert.doesNotMatch(source, /@lumiere\/contracts\/generated\/sdk/)
  assert.doesNotMatch(source, /createGeneratedStdbSdk/)
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

test("organization company SDK decodes the typed read boundary", async () => {
  let requestedUrl = ""
  const sdk = createStdbSdk(async (url) => {
    requestedUrl = url
    return new Response(JSON.stringify({
      data: [{ id: 7, organizationId: 11, name: "Lumiere" }],
    }))
  })

  const companies = await sdk.organization.companies.list()

  assert.equal(requestedUrl, "/api/query/companies")
  assert.deepEqual(companies, [{ id: 7n, organizationId: 11n, name: "Lumiere" }])
})

test("accounting SDK scopes and decodes account projections", async () => {
  let requestedUrl = ""
  const sdk = createStdbSdk(async (url) => {
    requestedUrl = url
    return new Response(JSON.stringify({
      data: [{ id: "9", organizationId: 11, code: "1100", internalType: "Asset" }],
    }))
  })

  const accounts = await sdk.forCompany(42n).accounting.accounts.list()

  assert.equal(requestedUrl, "/api/query/account-accounts?companyId=42")
  assert.deepEqual(accounts, [{
    id: 9n,
    organizationId: 11n,
    code: "1100",
    internalType: { tag: "Asset" },
  }])
})

test("accounting SDK scopes and decodes journal and tax projections", async () => {
  const requestedUrls: string[] = []
  const sdk = createStdbSdk(async (url) => {
    requestedUrls.push(url)
    if (url.includes("account-journals")) {
      return new Response(JSON.stringify({
        data: [{ id: "5", organizationId: 11, code: "BNK1", type: "Bank" }],
      }))
    }
    return new Response(JSON.stringify({
      data: [{ id: 9, organizationId: "11", amount: 21, typeTaxUse: "Sale" }],
    }))
  })

  const companySdk = sdk.forCompany(42n).accounting
  const journals = await companySdk.journals.list()
  const taxes = await companySdk.taxes.list()

  assert.deepEqual(requestedUrls, [
    "/api/query/account-journals?companyId=42",
    "/api/query/account-taxes?companyId=42",
  ])
  assert.deepEqual(journals, [{
    id: 5n,
    organizationId: 11n,
    code: "BNK1",
    type: { tag: "Bank" },
  }])
  assert.deepEqual(taxes, [{
    id: 9n,
    organizationId: 11n,
    amount: 21,
    typeTaxUse: { tag: "Sale" },
  }])
})

test("accounting tax SDK binds selected company for create and update", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const apiFetch = async (url: string, init?: RequestInit) => {
    requests.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response(null, { status: 204 })
  }
  const taxes = createStdbSdk(apiFetch).forCompany(42n).accounting.taxes

  await taxes.create({
    name: "VAT 21%",
    description: null,
    typeTaxUse: { tag: "Sale" },
    amountType: { tag: "Percent" },
    amount: 21,
    active: true,
    priceInclude: false,
    includeBaseAmount: false,
    isBaseAffected: false,
    sequence: 1,
    taxGroupId: null,
    countryId: null,
    countryCode: null,
    tags: [],
    hasNegativeFactor: false,
    invoiceRepartitionLineIds: [],
    refundRepartitionLineIds: [],
    metadata: null,
  })
  await taxes.update(9n, {
    name: "VAT 20%",
    description: undefined,
    typeTaxUse: undefined,
    amount: 20,
    active: undefined,
    priceInclude: undefined,
    includeBaseAmount: undefined,
    isBaseAffected: undefined,
    sequence: undefined,
    taxGroupId: undefined,
    tags: undefined,
    metadata: undefined,
  })

  assert.deepEqual(
    requests.map(({ url }) => url),
    [operationUrl("create_account_tax"), operationUrl("update_account_tax")],
  )
  assert.equal(requests[0].body.companyId, 42)
  assert.equal(requests[1].body.companyId, 42)
  assert.equal(requests[1].body.taxId, 9)
  assert.deepEqual(
    (requests[0].body.params as Record<string, unknown>).type_tax_use,
    { sale: [] },
  )
  assert.deepEqual(
    (requests[1].body.params as Record<string, unknown>).name,
    { some: "VAT 20%" },
  )
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

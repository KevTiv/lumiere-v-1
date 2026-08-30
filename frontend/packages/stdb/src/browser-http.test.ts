import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  SESSION_OPERATION_DESCRIPTORS,
  SESSION_OPERATION_NAMES,
} from "@lumiere/contracts/generated/operation-descriptors"

import { stdbBrowserCommand, stdbBrowserCompatCall } from "./browser-http"
import {
  updateUtmCampaign,
  updateUtmMedium,
  updateUtmSource,
} from "./mutations/crm"
import {
  addUserCustomField,
  deleteUserCustomField,
} from "./mutations/form-config"
import {
  archiveAiChatSession,
  createGoogleDriveConnection,
  createWhatsAppBusinessAccount,
  deleteIntegration,
  deleteWhatsAppBusinessAccount,
  setWhatsAppPrimaryAccount,
  updateGoogleDriveConnection,
  updateWhatsAppBusinessAccount,
} from "./mutations/settings-admin"

test("browser command uses the generated immutable operation ID and named input", async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    assert.equal(
      input,
      `/api/operations/${encodeURIComponent(
        SESSION_OPERATION_DESCRIPTORS.revoke_permission.contractOperationId,
      )}`,
    )
    assert.equal(init?.method, "POST")
    assert.equal(init?.body, JSON.stringify({ permissionId: 7 }))
    return new Response(null, { status: 204 })
  }

  try {
    await stdbBrowserCommand("revoke_permission", { permissionId: 7n })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("compatibility command remains explicit and positional", async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/compat/reducer/create_form_configuration")
    assert.equal(init?.method, "POST")
    assert.equal(
      init?.body,
      JSON.stringify([9, { name: "Lead", description: { none: [] } }]),
    )
    return new Response(null, { status: 204 })
  }

  try {
    await stdbBrowserCompatCall("create_form_configuration", [9n, { name: "Lead" }])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("mutation bridge never sends a session operation through compatibility transport", async () => {
  const sessionOperations = new Set<string>(SESSION_OPERATION_NAMES)
  for (const fileName of ["crm.ts", "form-config.ts", "settings-admin.ts"]) {
    const source = await readFile(new URL(`./mutations/${fileName}`, import.meta.url), "utf8")
    assert.doesNotMatch(source, /\bstdbBrowserCall\s*\(/)
    for (const match of source.matchAll(/stdbBrowserCompatCall\s*\(\s*["']([a-z0-9_]+)["']/g)) {
      assert.equal(
        sessionOperations.has(match[1]),
        false,
        `${match[1]} is session-exposed and must use stdbBrowserCommand`,
      )
    }
  }
})

test("machine-owned integration callbacks are absent from the browser bridge and settings UI", async () => {
  const sources = await Promise.all([
    readFile(new URL("./mutations/settings-admin.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../../web/app/(modules)/settings/settings-client.tsx", import.meta.url),
      "utf8",
    ),
  ])
  const machineCallbacks = [
    "record_google_drive_sync",
    "recordGoogleDriveSync",
    "record_google_drive_sync_error",
    "recordGoogleDriveSyncError",
    "update_integration_status",
    "updateIntegrationStatus",
    "update_whatsapp_verification_status",
    "updateWhatsappVerificationStatus",
    "updateWhatsAppVerificationStatus",
    "record_whatsapp_health_check",
    "recordWhatsappHealthCheck",
    "recordWhatsAppHealthCheck",
    "record_whatsapp_message_sent",
    "recordWhatsappMessageSent",
    "recordWhatsAppMessageSent",
  ]

  for (const source of sources) {
    for (const operation of machineCallbacks) {
      assert.equal(source.includes(operation), false, `${operation} must remain machine-owned`)
    }
  }
})

test("reviewed UTM updates use immutable IDs and named inputs", async () => {
  const previousFetch = globalThis.fetch
  const expected = [
    ["update_utm_campaign", "campaignId"],
    ["update_utm_medium", "mediumId"],
    ["update_utm_source", "sourceId"],
  ] as const
  let call = 0

  globalThis.fetch = async (input, init) => {
    const [operation, idField] = expected[call++]
    assert.equal(
      input,
      `/api/operations/${encodeURIComponent(SESSION_OPERATION_DESCRIPTORS[operation].contractOperationId)}`,
    )
    assert.equal(init?.method, "POST")
    assert.deepEqual(JSON.parse(String(init?.body)), {
      [idField]: 7,
      params: {
        name: { some: "Autumn" },
        is_active: { some: false },
      },
    })
    return new Response(null, { status: 204 })
  }

  try {
    await updateUtmCampaign(99n, 7n, { name: "Autumn", isActive: false })
    await updateUtmMedium(99n, 7n, { name: "Autumn", isActive: false })
    await updateUtmSource(99n, 7n, { name: "Autumn", isActive: false })
    assert.equal(call, expected.length)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("custom field writes use immutable IDs and named inputs", async () => {
  const previousFetch = globalThis.fetch
  const expectedOperations = ["add_user_custom_field", "delete_user_custom_field"] as const
  const requests: Array<{ input: string; body: Record<string, unknown> }> = []

  globalThis.fetch = async (input, init) => {
    requests.push({
      input: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response(null, { status: 204 })
  }

  try {
    await addUserCustomField(99n, {
      configurationId: 7n,
      fieldId: "customer_code",
      name: "customer_code",
      label: "Customer code",
      fieldType: { tag: "Text" },
      description: undefined,
      placeholder: undefined,
      defaultValue: undefined,
      options: [],
      validation: {
        required: false,
        minLength: undefined,
        maxLength: undefined,
        min: undefined,
        max: undefined,
        pattern: undefined,
        message: undefined,
      },
      order: 1,
      width: { tag: "Full" },
    })
    await deleteUserCustomField(99n, 8n)

    assert.equal(requests.length, expectedOperations.length)
    for (const [index, operation] of expectedOperations.entries()) {
      assert.equal(
        requests[index].input,
        `/api/operations/${encodeURIComponent(
          SESSION_OPERATION_DESCRIPTORS[operation].contractOperationId,
        )}`,
      )
    }
    assert.equal(
      (requests[0].body.params as Record<string, unknown>).configuration_id,
      7,
    )
    assert.deepEqual(requests[1].body, { customFieldId: 8 })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("reviewed integration settings use immutable IDs and omit session organization", async () => {
  const previousFetch = globalThis.fetch
  const expectedOperations = [
    "create_google_drive_connection",
    "update_google_drive_connection",
    "delete_integration",
    "create_whatsapp_business_account",
    "update_whatsapp_business_account",
    "delete_whatsapp_business_account",
    "set_whatsapp_primary_account",
    "archive_ai_chat_session",
  ] as const
  const requests: Array<{ input: string; body: Record<string, unknown> }> = []

  globalThis.fetch = async (input, init) => {
    requests.push({
      input: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response(null, { status: 204 })
  }

  try {
    await createGoogleDriveConnection(99n, {
      name: "Finance drive",
      accountEmail: "finance@example.com",
      accountId: "drive-account",
      credentialsReference: "secret/google-drive",
      syncEnabled: true,
      webhookEnabled: false,
      syncDirection: "Bidirectional",
      syncFrequencyMinutes: 60,
      allowedFileTypes: ["pdf"],
      maxFileSizeMb: 50,
    })
    await updateGoogleDriveConnection(99n, 7n, { name: "Finance archive" })
    await deleteIntegration(99n, 7n, "GoogleDrive")
    await createWhatsAppBusinessAccount(99n, {
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
    await updateWhatsAppBusinessAccount(99n, 8n, { name: "Support EU" })
    await deleteWhatsAppBusinessAccount(99n, 8n)
    await setWhatsAppPrimaryAccount(99n, 8n)
    await archiveAiChatSession(99n, 4n, "chat-1", true)

    assert.equal(requests.length, expectedOperations.length)
    for (const [index, operation] of expectedOperations.entries()) {
      assert.equal(
        requests[index].input,
        `/api/operations/${encodeURIComponent(
          SESSION_OPERATION_DESCRIPTORS[operation].contractOperationId,
        )}`,
      )
      assert.equal("organizationId" in requests[index].body, false)
      assert.equal("organization_id" in requests[index].body, false)
    }

    assert.deepEqual(requests[0].body.companyId, null)
    assert.deepEqual(requests[0].body.conflictPolicy, null)
    assert.deepEqual(requests[0].body.syncDirection, { tag: "Bidirectional" })
    assert.deepEqual(requests[2].body, {
      integrationId: 7,
      integrationType: { tag: "GoogleDrive" },
    })
    assert.deepEqual(
      (requests[3].body.params as Record<string, unknown>).company_id,
      { none: [] },
    )
    assert.deepEqual(
      (requests[3].body.params as Record<string, unknown>).webhook_url,
      { none: [] },
    )
    assert.deepEqual(
      (requests[4].body.params as Record<string, unknown>).name,
      { some: "Support EU" },
    )
    assert.deepEqual(requests[7].body, {
      companyId: 4,
      sessionKey: "chat-1",
      archived: true,
    })
  } finally {
    globalThis.fetch = previousFetch
  }
})

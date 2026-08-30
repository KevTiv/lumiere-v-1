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

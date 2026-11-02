import assert from "node:assert/strict"
import test from "node:test"

import { ALPHA_ASSISTANT_CAPABILITIES } from "@lumiere/query-hooks/assistant-actions"
import type { FieldAccessContext } from "@lumiere/stdb/server"
import { serverRagUiActionOffers } from "./rag-ui-actions"

const actor = "a".repeat(64)
function authority(overrides: Partial<FieldAccessContext> = {}) {
  return {
    identityHex: actor,
    organizationId: 7,
    fieldAccess: {
      organizationId: 7,
      identityHex: actor,
      roleId: 2,
      roleName: "sales-reader",
      isSuperuser: false,
      rolePermissions: ["module:sales:read", "sale_order:read"],
      fieldPermissions: [],
      ...overrides,
    } satisfies FieldAccessContext,
  }
}

test("server offers come from the shared catalog and current native permissions", () => {
  const offers = serverRagUiActionOffers(authority())
  assert.ok(offers.some((offer) => offer.capability_key === "sales.order.open"))
  assert.ok(!offers.some((offer) => offer.kind === "open_form"))
  assert.ok(offers.every((offer) => offer.capability_key.startsWith("sales.")))
  for (const offer of offers) {
    const native = ALPHA_ASSISTANT_CAPABILITIES.find(
      (capability) => capability.key === offer.capability_key,
    )
    assert.equal(offer.kind, native?.kind)
    assert.deepEqual(
      Object.keys(offer).sort(),
      native?.entityType
        ? ["capability_key", "entity_type", "kind", "label"]
        : ["capability_key", "kind", "label"],
    )
  }
})

test("form offers require current create permission and organization denials win", () => {
  const access = authority({
    rolePermissions: [
      "module:sales:read",
      "sale_order:read",
      "sale_order:create",
    ],
  })
  assert.ok(
    serverRagUiActionOffers(access).some(
      (offer) => offer.capability_key === "sales.order.create",
    ),
  )
  access.fieldAccess.orgPermissions = [
    { resource: "sale_order", action: "create", allow: false },
  ]
  assert.ok(
    !serverRagUiActionOffers(access).some(
      (offer) => offer.capability_key === "sales.order.create",
    ),
  )
  access.fieldAccess.orgPermissions = [
    { resource: "module:sales", action: "read", allow: false },
  ]
  assert.deepEqual(serverRagUiActionOffers(access), [])
})

test("missing or foreign session policy produces no proposals and no hidden modules are offered", () => {
  assert.deepEqual(
    serverRagUiActionOffers({ identityHex: actor, organizationId: 7 }),
    [],
  )
  assert.deepEqual(
    serverRagUiActionOffers(authority({ identityHex: "b".repeat(64) })),
    [],
  )
  assert.deepEqual(
    serverRagUiActionOffers(authority({ organizationId: 8 })),
    [],
  )
  const all = serverRagUiActionOffers(authority({ isSuperuser: true }))
  assert.equal(all.length, ALPHA_ASSISTANT_CAPABILITIES.length)
  assert.ok(all.length <= 128)
  assert.ok(
    !all.some((offer) =>
      /manufacturing|payroll|rental|gps|execute/.test(offer.capability_key),
    ),
  )
})

test("browser supplied offers and authority cannot change server-owned descriptors", () => {
  const trusted = authority()
  const offers = serverRagUiActionOffers({
    ...trusted,
    ...({
      ui_action_offers: [
        { capability_key: "hidden.execute", href: "/admin", kind: "execute" },
      ],
      permissions: ["*:*"],
    } as object),
  })
  assert.deepEqual(offers, serverRagUiActionOffers(trusted))
})

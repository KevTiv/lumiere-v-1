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

test("trusted current page offers use native read permission and bounded approved widget choices", () => {
  const page = {
    moduleId: "sales",
    pageId: "dashboard",
    widgets: [
      { key: "saved:9007199254740993", label: "Orders by status" },
      { key: "saved:9007199254740993", label: "Duplicate" },
      { key: "saved:01", label: "Invalid identity" },
      { key: "builtin:orders-kpi", label: "Order count" },
      { key: "builtin:../other", label: "Invalid key" },
      { key: "saved:42", label: "control\ncharacter" },
    ],
  }
  const offers = serverRagUiActionOffers(authority(), page)
  const edit = offers.find(
    (offer) => offer.capability_key === "sales.page.edit",
  )!
  const add = offers.find(
    (offer) => offer.capability_key === "sales.widget.add",
  )!
  assert.equal(edit.kind, "edit_page")
  assert.equal(edit.widgets, undefined)
  assert.deepEqual(add.widgets, [page.widgets[0], page.widgets[3]])
  assert.ok(
    !offers.some((offer) => offer.capability_key === "sales.order.create"),
  )
  const denied = authority({
    orgPermissions: [
      { resource: "module:sales", action: "read", allow: false },
    ],
  })
  assert.deepEqual(serverRagUiActionOffers(denied, page), [])
  assert.deepEqual(
    serverRagUiActionOffers({ identityHex: actor, organizationId: 7 }, page),
    [],
  )
  assert.deepEqual(
    serverRagUiActionOffers(authority({ identityHex: "b".repeat(64) }), page),
    [],
  )
})

test("shared module page editing does not expose that module's unsupported business actions", () => {
  const offers = serverRagUiActionOffers(
    authority({ rolePermissions: ["module:projects:read"] }),
    {
      moduleId: "projects",
      widgets: [],
    },
  )
  assert.deepEqual(
    offers.map((offer) => offer.capability_key),
    ["projects.page.edit", "projects.widget.add"],
  )
  assert.ok(!offers.some((offer) => offer.kind === "open_form"))
  const bounded = serverRagUiActionOffers(authority(), {
    moduleId: "sales",
    widgets: Array.from({ length: 80 }, (_, index) => ({
      key: `saved:${index + 1}`,
      label: `Widget ${index + 1}`,
    })),
  }).find((offer) => offer.capability_key === "sales.widget.add")!
  assert.equal(bounded.widgets?.length, 64)
})

import assert from "node:assert/strict"
import test from "node:test"
import {
  dispatchPresentationDestination,
  type PresentationDestination,
} from "./assistant-presentation-dispatcher"

const product: PresentationDestination = {
  kind: "open_inventory_record",
  productId: "18446744073709551615",
}
const importReview: PresentationDestination = {
  kind: "open_import_review",
  taskId: "a".repeat(32),
}
const scope = { actorId: "actor", organizationId: "7", companyId: "4097" }
const reviewHref = "/settings?section=imports&sourceReview=17"

function workspace() {
  const pushes: string[] = []
  const permissionChecks: string[] = []
  const importReads: string[] = []
  let allowed = true
  const context = {
    actionScope: scope,
    scopeKey: "actor:7:4097",
    allowedModules: ["products", "settings"],
    permissionsReady: true,
    checkPermission: (resource: string) => {
      permissionChecks.push(resource)
      return { allowed }
    },
  }
  const ports: Parameters<typeof dispatchPresentationDestination>[1] = {
    current: () => context,
    push: (href) => pushes.push(href),
    reveal: () => undefined,
    navigationGuard: null,
    readImportHref: async (current, taskId) => {
      assert.equal(current, scope)
      importReads.push(taskId)
      return reviewHref
    },
  }
  return {
    ports,
    pushes,
    permissionChecks,
    importReads,
    deny: () => {
      allowed = false
    },
    changeCompany: () => {
      context.scopeKey = "actor:7:4098"
      context.actionScope = { ...scope, companyId: "4098" }
    },
  }
}

test("inventory navigation uses the native exact-record link and reports a request", async () => {
  const { ports, pushes, permissionChecks } = workspace()
  assert.equal(
    await dispatchPresentationDestination(product, ports),
    "requested",
  )
  assert.deepEqual(pushes, [
    "/products?tab=products&filter=id%3A18446744073709551615",
  ])
  assert.deepEqual(new Set(permissionChecks), new Set(["product"]))
})

test("an import review resolves under the active scope and respects the navigation guard", async () => {
  const { ports, pushes, importReads, permissionChecks } = workspace()
  ports.navigationGuard = {
    proceed: (_, declined) => declined?.(),
    register: () => () => undefined,
    changed: () => undefined,
  }
  assert.equal(
    await dispatchPresentationDestination(importReview, ports),
    "cancelled",
  )
  assert.deepEqual(pushes, [])
  assert.deepEqual(importReads, [importReview.taskId])
  assert.deepEqual(new Set(permissionChecks), new Set(["dashboard:settings"]))
  ports.navigationGuard = null
  assert.equal(
    await dispatchPresentationDestination(importReview, ports),
    "requested",
  )
  assert.deepEqual(pushes, [reviewHref])
})

test("scope and permission changes between a request and navigation prevent opening", async () => {
  const scopeChange = workspace()
  scopeChange.ports.readImportHref = async () => {
    scopeChange.changeCompany()
    return reviewHref
  }
  assert.equal(
    await dispatchPresentationDestination(importReview, scopeChange.ports),
    "scope_changed",
  )
  assert.deepEqual(scopeChange.pushes, [])

  const revoke = workspace()
  revoke.ports.navigationGuard = {
    proceed: (open) => {
      revoke.deny()
      open()
    },
    register: () => () => undefined,
    changed: () => undefined,
  }
  assert.equal(
    await dispatchPresentationDestination(product, revoke.ports),
    "denied",
  )
  assert.deepEqual(revoke.pushes, [])
})

test("aborting a pending guard settles the request and prevents a late navigation", async () => {
  const { ports, pushes } = workspace()
  const controller = new AbortController()
  let open: (() => void) | undefined
  ports.navigationGuard = {
    proceed: (perform) => {
      open = perform
    },
    register: () => () => undefined,
    changed: () => undefined,
  }
  const outcome = dispatchPresentationDestination(
    product,
    ports,
    controller.signal,
  )
  assert.equal(typeof open, "function")
  controller.abort()
  assert.equal(await outcome, "cancelled")
  open?.()
  assert.deepEqual(pushes, [])
})

test("bad record and task identifiers cannot reach navigation or the import reader", async () => {
  const { ports, pushes, importReads } = workspace()
  assert.equal(
    await dispatchPresentationDestination(
      { ...product, productId: "18446744073709551616" },
      ports,
    ),
    "unavailable",
  )
  assert.equal(
    await dispatchPresentationDestination(
      { ...importReview, taskId: "../import" },
      ports,
    ),
    "unavailable",
  )
  assert.deepEqual(pushes, [])
  assert.deepEqual(importReads, [])
})

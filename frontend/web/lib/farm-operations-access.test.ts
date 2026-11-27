import assert from "node:assert/strict"
import test from "node:test"
import { buildNavGroups } from "@lumiere/ui/lib/navigation-catalog"
import type { CompanyVerticalPackRow } from "@lumiere/query-hooks/hooks/organization-company"
import { aiWorkspaceScopesForProfile } from "./ai-workspace-scope"
import { farmOperationsAccess, updateFarmOperationsSetting } from "./farm-operations-access"

function pack(companyId: string, enabled: boolean): CompanyVerticalPackRow {
  return { id: "1", companyId, packKey: "farm_operations", enabled, updatedAt: null }
}

const companyId = "42"
const access = {
  companyReady: true,
  companyId,
  permissionsReady: true,
  canRead: true,
  canWriteCompany: true,
  packs: { isPending: false, isError: false, data: [] },
}

test("only a company writer with farm read access can set up an eligible company", () => {
  assert.equal(farmOperationsAccess(access), "setup")
  assert.equal(farmOperationsAccess({ ...access, canWriteCompany: false }), "disabled")
  assert.equal(farmOperationsAccess({ ...access, canRead: false }), "denied")
  assert.equal(farmOperationsAccess({ ...access, companyId: null }), "no-company")
  assert.equal(farmOperationsAccess({
    ...access,
    packs: { ...access.packs, data: [pack("wrong-company", true), pack(companyId, false)] },
  }), "setup")
})

test("readiness, failure and authorization take precedence over a cached enabled pack", () => {
  const configured = { ...access, packs: { ...access.packs, data: [pack(companyId, true)] } }
  assert.equal(farmOperationsAccess({ ...configured, companyReady: false }), "loading")
  assert.equal(farmOperationsAccess({ ...configured, permissionsReady: false }), "loading")
  assert.equal(farmOperationsAccess({ ...configured, packs: { ...configured.packs, isPending: true } }), "loading")
  assert.equal(farmOperationsAccess({ ...configured, canRead: false }), "denied")
  assert.equal(farmOperationsAccess({ ...configured, packs: { ...configured.packs, isError: true } }), "unavailable")
  assert.equal(farmOperationsAccess({
    ...configured, packs: { ...configured.packs, isError: true, error: { status: 403 } },
  }), "denied")
  assert.equal(farmOperationsAccess({ ...configured, canWriteCompany: false }), "enabled")
})

test("holds activation until the readback finds the exact saved company and setting", async () => {
  let saved = false
  const update = (rows: CompanyVerticalPackRow[], error: unknown = null) => updateFarmOperationsSetting({
    companyId,
    enabled: true,
    save: async () => { saved = true },
    read: async () => {
      assert.equal(saved, true)
      return { data: rows, error }
    },
  })

  assert.equal(await update([pack("43", true)]), "unverified")
  assert.equal(await update([pack(companyId, false)]), "unverified")
  assert.equal(await update([pack(companyId, true)], new Error("unavailable")), "unverified")
  assert.equal(await update([pack(companyId, true)]), "verified")
  assert.equal(await updateFarmOperationsSetting({
    companyId,
    enabled: true,
    save: async () => { throw new Error("denied") },
    read: async () => assert.fail("unexpected read after command rejection"),
  }), "save-error")
})

test("a verified company pack reveals Farm Batches in navigation and the assistant", () => {
  function discoverability(data: CompanyVerticalPackRow[]) {
    const status = farmOperationsAccess({
      ...access,
      canWriteCompany: false,
      packs: { ...access.packs, data },
    })
    const farmOperationsEnabled = status === "enabled"
    const nav = buildNavGroups((key) => key, {
      workspaceProfile: "finance-alpha",
      firstOrgProfile: true,
      farmOperationsEnabled,
    }).flatMap((group) => group.items)
    return {
      navigation: nav.some((item) => item.href === "/farm-batches" && item.resource === "farm_batch"),
      assistant: aiWorkspaceScopesForProfile("finance-alpha", farmOperationsEnabled)
        .some((option) => option.value === "module:farm-batches"),
    }
  }
  assert.deepEqual(discoverability([]), { navigation: false, assistant: false })
  assert.deepEqual(discoverability([pack("43", true)]), { navigation: false, assistant: false })
  assert.deepEqual(discoverability([pack(companyId, true)]), { navigation: true, assistant: true })
})

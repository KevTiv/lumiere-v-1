import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { WIZARD_IMPORT_ENTITIES } from "../../frontend/web/lib/import-entities.ts"
import { alphaImportCoverage } from "../../frontend/web/lib/alpha-import-discovery.ts"

const root = new URL("../../", import.meta.url)
const cache = new Map()
function source(path) {
  if (!cache.has(path)) cache.set(path, readFileSync(new URL(path, root), "utf8"))
  return cache.get(path)
}
function checkAnchor({ path, marker }) {
  assert.ok(path && marker, "coverage needs a concrete repository anchor")
  assert.ok(source(path).includes(marker), `${path} lacks ${marker}`)
}

const profile = "frontend/packages/ui/src/lib/workspace-profile.ts"
const catalog = "api-server/src/routes/import_reviews/capabilities.rs"
const registry = "api-server/src/routes/import.rs"

function namesInSet(name) {
  const block = source(profile).match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`))
  assert.ok(block, name)
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

test("every Finance Alpha surface and Settings wizard key has an explicit coverage decision", () => {
  const surfaces = ["FINANCE_MODULES", "ALPHA_MODULES", "FINANCE_SUPPORT"].flatMap(namesInSet).sort()
  const classified = new Set(alphaImportCoverage.map(({ module }) => module))
  for (const operation of alphaImportCoverage) {
    for (const entry of operation.entryPoints) classified.add(entry.surface)
  }
  assert.deepEqual([...classified].sort(), surfaces)
  const wizardTargets = new Map()
  for (const { entryPoints, native } of alphaImportCoverage) {
    for (const { marker, availability } of entryPoints) {
      if (availability !== "wizard_profile") continue
      const key = JSON.parse(marker)
      assert.equal(native.kind, "csv", key)
      assert.ok(!wizardTargets.has(key), key)
      wizardTargets.set(key, native.target)
    }
  }
  const visibleKeys = namesInSet("FINANCE_IMPORT_TARGETS").sort()
  assert.deepEqual([...wizardTargets.keys()].sort(), visibleKeys)
  for (const key of visibleKeys) {
    assert.equal(wizardTargets.get(key), WIZARD_IMPORT_ENTITIES.find(({ wizardKey }) => key === wizardKey)?.tableName, key)
  }
})

test("module CSV toolbar actions and their native registrations have exact coverage anchors", () => {
  const actionSources = [
    "accounting", "crm", "documents", "expenses", "inventory", "purchasing", "reports", "sales",
  ].map((module) => `frontend/web/app/(modules)/${module}/${module}-client.tsx`)
  const actions = new Set(alphaImportCoverage.flatMap(({ entryPoints }) => entryPoints)
    .map(({ path, marker }) => `${path}:${marker}`))
  for (const path of actionSources) {
    for (const [marker] of source(path).matchAll(/setCsvKind\((["'])\w+\1\)/g)) {
      assert.ok(actions.has(`${path}:${marker}`), `Unregistered CSV action ${path}:${marker}`)
    }
  }

  const shapes = { organization: "OrgOnly", organization_currency: "OrgCurrency", company: "OrgCompany" }
  for (const { id, native, entryPoints, evidence } of alphaImportCoverage) {
    for (const anchor of [...entryPoints, ...evidence]) checkAnchor(anchor)
    if (native.gate) checkAnchor(native.gate)
    switch (native.kind) {
      case "csv": {
        const entity = source(registry).split(`table_name: "${native.target}",`)[1]?.split("},")[0]
        assert.ok(entity?.includes(`shape: ImportArgShape::${shapes[native.scope]}`), id)
        break
      }
      case "specialized":
      case "intake":
        checkAnchor(native.anchor)
        break
      case "none":
        assert.equal(entryPoints.length, 0, id)
        break
      default:
        assert.fail(`Unknown native path for ${id}`)
    }
  }
})

test("coverage never treats held operations, catalog presence or baseline code as execution proof", () => {
  assert.equal(new Set(alphaImportCoverage.map(({ id }) => id)).size, alphaImportCoverage.length)
  for (const { id, savedTask, served } of alphaImportCoverage) {
    assert.equal(served, "unverified", id)
    if (savedTask.capability) checkAnchor({ path: catalog, marker: `"${savedTask.capability}"` })
    switch (savedTask.state) {
      case "task_execution":
      case "reviewed_records":
      case "native_preview":
        assert.ok(savedTask.capability, id)
        break
      case "not_connected":
      case "evidence_only":
        assert.ok(savedTask.reason && savedTask.recovery, id)
        assert.equal(savedTask.execute, undefined, id)
        break
      case "intake_or_support":
        assert.ok(savedTask.reason, id)
        break
      default:
        assert.fail(`Unknown saved-task state for ${id}`)
    }
  }
  const keyed = new Map(alphaImportCoverage.map((operation) => [operation.id, operation]))
  assert.equal(keyed.get("historical_expense_journals").savedTask.state, "task_execution")
  assert.equal(keyed.get("product").savedTask.state, "native_preview")
  assert.equal(keyed.get("shop_sales_backfill").savedTask.state, "reviewed_records")
  assert.equal(keyed.get("historical_payments").savedTask.state, "evidence_only")
  assert.equal(keyed.get("bank_statement_staging").savedTask.state, "not_connected")
})

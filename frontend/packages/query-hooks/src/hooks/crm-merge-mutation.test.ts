import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

/**
 * CRM-RI-013: merge/tag/segment mutations must invalidate every changed base,
 * association, projection, and count resource.
 *
 * This package has no React test harness (tests are plain `node:test` over pure
 * functions), so the hook's `onSuccess` cannot be invoked directly. Instead this
 * asserts against the actual source text of `crm.ts`: it extracts the
 * `useMergeContacts` `onSuccess` block and checks the resource keys it passes to
 * `invalidateResourceQueries`. Deleting or renaming an invalidation in the source
 * fails this test, which is the regression CRM-RI-013 is about.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("./crm.ts", import.meta.url)),
  "utf8",
)

/**
 * Every hook source in this package. Invalidation is keyed by resource + org on
 * the shared query client, so a resource invalidated from `crm.ts` may legally
 * be *read* by a hook in another file (e.g. `sale-orders` lives in `sales.ts`).
 */
const ALL_HOOK_SOURCES = readdirSync(fileURLToPath(new URL(".", import.meta.url)))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), "utf8"))
  .join("\n")

/**
 * Resources the `merge_contacts` reducer mutates
 * (`spacetimedb/src/crm/duplicate.rs`): repointed relations, deduplicated
 * associations, and the recomputed `contact_segment.member_count` projection.
 */
const EXPECTED_MERGE_RESOURCES = [
  "activities",
  "contact-phone-identities",
  "contact-relationship-insights",
  "contact-relationships",
  "contact-role-assignments",
  "contact-segments",
  "contacts",
  "crm-conversations",
  "leads",
  "opportunities",
  "sale-orders",
]

/** Extract the `onSuccess` body of a named exported hook from the source text. */
function onSuccessBodyOf(hookName: string): string {
  const start = SOURCE.indexOf(`export function ${hookName}(`)
  assert.notEqual(start, -1, `${hookName} not found in crm.ts`)

  // Bound the search at the next top-level export so we cannot read a
  // neighbouring hook's handler by accident.
  const nextExport = SOURCE.indexOf("\nexport function ", start + 1)
  const hookBody = SOURCE.slice(
    start,
    nextExport === -1 ? SOURCE.length : nextExport,
  )

  const onSuccess = hookBody.indexOf("onSuccess:")
  assert.notEqual(onSuccess, -1, `${hookName} has no onSuccess handler`)
  return hookBody.slice(onSuccess)
}

/** Resource keys passed to `invalidateResourceQueries` within a handler body. */
function invalidatedResources(handlerBody: string): string[] {
  const found = new Set<string>()
  const call =
    /invalidateResourceQueries\(\s*qc\s*,\s*organizationId\s*,\s*\[([^\]]*)\]/g
  for (const match of handlerBody.matchAll(call)) {
    for (const raw of match[1].split(",")) {
      const key = raw.trim().replace(/^['"]|['"]$/g, "")
      if (key) found.add(key)
    }
  }
  return [...found].sort()
}

describe("useMergeContacts invalidation (CRM-RI-013)", () => {
  it("invalidates every resource the merge_contacts reducer mutates", () => {
    const actual = invalidatedResources(onSuccessBodyOf("useMergeContacts"))

    const missing = EXPECTED_MERGE_RESOURCES.filter((r) => !actual.includes(r))
    assert.deepEqual(
      missing,
      [],
      `useMergeContacts fails to invalidate: ${missing.join(", ")}`,
    )
  })

  it("invalidates the association and count resources, not just base records", () => {
    const actual = invalidatedResources(onSuccessBodyOf("useMergeContacts"))

    // The pre-fix bug: merge invalidated only base records, leaving repointed
    // associations and the recomputed segment member_count stale in the UI.
    for (const resource of [
      "contact-phone-identities",
      "contact-role-assignments",
      "contact-relationship-insights",
      "crm-conversations",
      "contact-segments",
    ]) {
      assert.ok(
        actual.includes(resource),
        `merge repoints ${resource} but does not invalidate it`,
      )
    }
  })

  it("only uses resource keys that a read query actually registers", () => {
    const actual = invalidatedResources(onSuccessBodyOf("useMergeContacts"))

    // A key with no registered reader silently invalidates nothing — the exact
    // failure mode CRM-RI-013 describes.
    for (const resource of actual) {
      assert.ok(
        ALL_HOOK_SOURCES.includes(`useSubscriptionAwareQuery("${resource}"`) ||
          ALL_HOOK_SOURCES.includes(`useSubscriptionAwareQuery('${resource}'`) ||
          ALL_HOOK_SOURCES.includes(`"${resource}", rqBigIntKey`) ||
          ALL_HOOK_SOURCES.includes(`'${resource}', rqBigIntKey`),
        `invalidated resource "${resource}" has no read query registered in any hook`,
      )
    }
  })
})

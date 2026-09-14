import { test } from "@playwright/test"

import {
  CAPABILITIES,
  CAPABILITY_PENDING,
  pendingContract,
  pretenantTags,
  requireCapability,
} from "./pretenant-support"

/**
 * STALE STATE / AUTHORITY certification for the presentation IR. Every case requires the open
 * frontend-IR stack (#13 → #19 → #25) and none of it exists on main. When a capability probe
 * succeeds the case executes; until its body is written against the landed contract it fails via
 * pendingContract() instead of passing silently.
 *
 * Existing stack coverage to extend rather than duplicate:
 * - PR #13 crates/presentation-core validation_tests.rs (unknown fields, duplicates, stale
 *   versions, denied fields, component-kind mismatch, budget, malformed JSON).
 * - PR #25 presentation-preview.spec.ts stale save conflict (mocked) and
 *   scripts/check-presentation-draft-http.py (HTTP 409 stale writer).
 */

test.describe("Pre-tenant presentation IR adversarial", { tag: [...pretenantTags("@presentation-ir"), CAPABILITY_PENDING] }, () => {
  test("IR-01 corrupt definitions are rejected with typed errors and persist nothing", async ({ page }) => {
    await requireCapability(page, CAPABILITIES.presentationPreview)
    pendingContract(
      CAPABILITIES.presentationPreview,
      "IR-01",
      "duplicate module/page/node ids, unknown fields/resources/operations, wrong component kind, invalid slot, dangling detail reference, forbidden recursion, unsupported and future schema versions, oversized definition, corrupt snapshot hash, invalid pins each return 4xx and persist nothing; add missing cases to presentation-core validation tests on the stack",
    )
  })

  for (const revocation of [
    "sensitive field permission revoked",
    "resource permission revoked",
    "company membership removed",
    "resource disabled",
    "operation/capability removed",
  ]) {
    test(`IR-02 reopen after ${revocation} reauthorizes at render time`, async ({ page }) => {
      await requireCapability(page, CAPABILITIES.presentationSavedDrafts)
      pendingContract(
        CAPABILITIES.presentationSavedDrafts,
        "IR-02",
        `user saves a module using a permitted resource, admin applies "${revocation}", user reopens: the saved definition stays intact, data is reauthorized on read, the revoked data never renders (including from cache), and the UI shows dependency/permission degradation`,
      )
    })
  }

  test("IR-03 two contexts editing revision N produce one N+1 and an explicit stale conflict", async ({ page }) => {
    await requireCapability(page, CAPABILITIES.presentationSavedDrafts)
    pendingContract(
      CAPABILITIES.presentationSavedDrafts,
      "IR-03",
      "contexts A and B open N; A saves N+1; B saves: B receives a stale-revision conflict, B's unsaved edits remain, reload/retry never overwrites A, exactly one N+1 exists (real browser contexts, not mocked routes)",
    )
  })

  for (const interruption of [
    "company switch",
    "module definition edited",
    "logout and login as another user",
    "permission revoked",
  ]) {
    test(`IR-04 late preview response after ${interruption} is never rendered`, async ({ page }) => {
      await requireCapability(page, CAPABILITIES.presentationCompanySwitch)
      pendingContract(
        CAPABILITIES.presentationCompanySwitch,
        "IR-04",
        `a preview request starts, "${interruption}" happens, the delayed response arrives: it is discarded and never rendered under the new scope/definition/user`,
      )
    })
  }

  test("IR-05 human, harness and import definitions take the identical validation/authorization path", async ({ page }) => {
    await requireCapability(page, CAPABILITIES.harnessGeneratedPresentation)
    pendingContract(
      CAPABILITIES.harnessGeneratedPresentation,
      "IR-05",
      "an equivalent definition produced by the human editor, the AI harness and import/reopen passes the same schema validation, authorization, resource resolution, versioning, publication and rendering, with no AI-trusted shortcut and identical rejection of forbidden content",
    )
  })
})

# UI release-gate repairs — 2026-10-17

Scope: the draft UI stack #218 → #221 → #222. Local results below belong to
the top-stack working branch, not independently tested parent heads or later
automated contracts-pin commits.

## Repairs

- Scope module-panel assertions to the selected module, allowing legitimate
  nested chart and independent workspace panels. Retain canonical destinations.
- Bind late hidden form defaults without discarding user edits; populate the
  manufacturing order toolbar with its live product/BOM lookup configuration.
- Preserve typed, present `Option::None` seller/currency fields as known empty
  while keeping omitted/redacted fields unavailable.
- Return authorized canonical readback fields for requisitions, replenishment,
  manufacturing costs, tax readiness, sales exchange origins, expenses and bank
  matching. Explicit field-policy masks remain authoritative.
- Return the tenant currency's stored rounding factor; do not guess precision.
- Keep interactive purchasing authorization checks while letting the existing
  bounded scheduled-replenishment service refresh its own PO totals/status.
- Restrict active-role bootstrap reads to the authenticated organization.
- Generate WorkOS fixture RSA keys in memory instead of storing a private key.
- Isolate approval/stock/receipt fixtures. Resolve bank fixtures through exact
  company-bound journal items, and keep repeat expense runs distinct under the
  real duplicate-fraud detector.
- Match actual operation transport paths. Test genuinely unknown outcomes by
  withholding canonical verification as well as the write reply. Retain
  no-retry and exactly-once readback assertions.
- Avoid redundant overview loads and after-the-fact optional response waits in
  lead-to-cash; retain form, financial-effect, handoff, dashboard and audit checks.

## Local verification

- Shared UI: 711 tests passed earlier in this repair series.
- API library: 563 passed, 3 existing ignored; repeated after the currency fix.
- Permission/readback policy: 62 passed, including explicit field-mask coverage.
- Accounting/overview/navigation model CI script: 74 passed.
- Bank-link unit checks: 8 passed, including the real typed decoder.
- Production frontend build, web TypeScript and dev-enabled module build passed.
- Correctness census passed; no coverage floor or type-debt baseline was raised.
- The 36-case targeted P0 batch finished with 33 passes and three failures. The
  corrected lead-to-cash case then passed in 2.7 minutes; the final bank/expense
  rerun passed both cases plus authentication in 1.4 minutes. Thus all 36
  distinct batch cases passed across reruns, **not one clean 36/36 current-head
  run**. Fresh configured-stack CI is still required.

Browser execution used an isolated local SpacetimeDB/Postgres stack, built
frontend and system Chromium. It is not a pinned-CI-browser or Railway result.
No assertion was skipped and no timeout budget was increased. The broader
development-fixture navigation run hit loading/hydration timing failures;
it is not counted as passing. A separate built-fixture verification is pending.

## Remaining release gates

- Fresh checks and required review on the actual heads, including bot-updated
  contracts pins. Do not merge over missing or failing gates.
- GitGuardian incident 38282193 requires maintainer classification. The removed
  test key was already present in main history; rewriting only this UI stack
  cannot remove that historical finding. No suppression or dismissal was made.
- PR #222's source branch is watched by Railway. Publishing its frontend changes
  may deploy them; publication is held for the user's deployment choice.
- Preserve compatible contracts and API/UI V1+V2 readers before/with V2 module
  producers. A frontend-only deployment does not release backend fixes.

No merge, Railway deployment, production data mutation or automatic replay was
performed in this repair turn.

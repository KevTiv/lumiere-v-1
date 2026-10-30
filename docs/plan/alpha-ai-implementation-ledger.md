# AI-assisted ERP Alpha implementation ledger

Updated 2026-10-30. Coordinator: Codex. This ledger coordinates AA-00–08;
it does not replace the governing ERP/harness plans, domain owners or release gates.
No package is accepted from code existence or a fixture-only test.

## Refreshed baseline and existing work

Fetched `origin/main` before editing: **3d6f32c23ba4a569f83d752ac0b2257e43799397**.
The initial supplied reference was current before editing. Main later advanced to
**8fee8fd507f948e75be99fb27d0b2344cab6db78** through #317 only; its three
infrastructure files are disjoint from these feature slices. The local testing
branch incorporates that main update. The initial exact-main check readback had
31 completed successful checks, including Rust, contracts drift, frontend,
all six full browser shards, CI/E2E gates and ordered stack release. A successful
release workflow is deployment evidence, not acceptance of the new work here.

| PR | Current state / integration boundary |
| --- | --- |
| #257 | Merged. Preserve governed execution/spend recovery, canonical embeddings and chat workspace. |
| #266 | Merged. Preserve scoped bootstrap, offline skill administration and report workbench; setup does not imply activation. |
| #282 | Merged. Historical report 1.0.5 independent certification and live settled-spend acceptance are recorded; this does not certify newer source bindings. |
| #291 | Merged. Preserve descriptors, queue foundations and disabled budget parking; no production dispatcher may be inferred. |
| #315 | Merged. Preserve Alpha usability, actor/company history and onboarding configuration. |
| #309 | Open at 49355068b8cf783129086c016f917c48dee3a610. Guide implementation and history remain owned there; CI and all P0 shards currently pass. Integrated authenticated guide acceptance is still pending in its status document. Do not duplicate it. |
| #312 | Open at ce7f357f32a8e33ada8d69e41ac0f1a7ba8790b2. CI gate passes; E2E gate fails. Owns broad Alpha translations, including shell, shared chat and Overview. Keep our edits narrow and resolve overlap when integrated. |
| #313 | Open stacked on #312 at 48df6868cd2e559707245f70c75509598594cb51. CI/E2E gates fail. Owns remaining module/mobile translations. |
| #317 | Now merged in 8fee8fd5 during implementation. Three disjoint infrastructure files were incorporated into the local testing branch; no release/CI/manifests authored by this program. |

Main consumes immutable contracts **v0.3.157**. #309 owns the already published
**v0.3.158** guide pin and migration 29. Neither release is rewritten here.
These slices introduce no producer schema/operation change. The coordinator
reserves the only next contract release lane; it stays idle until a justified
producer delta, deterministic generation, immutable publication and consumer pin
can be reviewed together.

## Current-state gap and dependency matrix

Statuses describe work packages, not percentages. REVIEW means source is reviewable;
a focused test is not whole-package acceptance.

| ID | Status | Owner | Branch / PR | Dependencies | Evidence required / current evidence | Blockers and deliberately deferred capabilities |
| --- | --- | --- | --- | --- | --- | --- |
| AA-00 | REVIEW | Coordinator + independent QA | codex/alpha-ai-coordination / #320 | None | Exact baseline/PR/contracts readback; code-derived matrix and exclusive assignments below | Independent ledger source review passed; integrated staging evidence remains a program gate |
| AA-01 | REVIEW | Coordinator; backend worker | codex/alpha-ai-unified-turns / #321; codex/alpha-ai-turn-backend / #319 | AA-00 scoped | Existing server RAG and stream share gated publication. First slice removes duplicate fallback, silent draft failure, incomplete SSE success and shared UI mock financial facts; backend bounds multilingual excerpts safely | Full server-authorized intent/capability routing, clarification contract and finance/form dispatch remain unaccepted; no new execution authority |
| AA-02 | REVIEW | Activation worker | codex/alpha-ai-assisted-activation / #322 | AA-00; later AA-01 | Existing bootstrap currency/timezone/year-end and Accounting readiness reused. First slice reads current scoped ERP state for a deterministic role-aware first-task checklist | Owner first-contact journey passes; complete Sales/Expense prerequisite checks, ordinary-member/language acceptance and sample-data provenance pending |
| AA-03 | BLOCKED | Forms owner (coordinator until assigned) | — | AA-01 accepted contract + certified canonical form owner | Existing contact/order/expense forms and AI form-suggestion path; exact permitted proposals and attachment retention need integrated proof | Cross-module typed bridge not accepted. Do not advertise automatic save, unsupported invoice creation or invented relations |
| AA-04 | BLOCKED | Recovery owner (coordinator until assigned) | — | AA-01/03 | Existing action-draft review, effect lifecycle, expense outbox and run recovery owners | Exact request→draft→command→record readback and interrupted-business-effect E2E pending; no uncertain redispatch |
| AA-05 | BLOCKED | Existing #309 owner; coordinator integration only | #309, no replacement branch | #309 integration + AA-01 | Existing viewer/storage/scoped revision/retrieval implementation and green CI | Authenticated save/reload/new-chat retrieval, revocation/stale edit/restart proof; Explain this error and verified guidance promotion remain separate |
| AA-06 | REVIEW | Qualification worker + independent QA | codex/alpha-ai-skill-qualification / #318 | AA-00 | Collector consistency fixes; 212 Python tests, manifest/catalog checks; independent review of 8422d1b6 passes | Tenant release readback, approved provider profiles/budget/test tenant, independent certification, staged disable/rollback remain blocked externally |
| AA-07 | BLOCKED | Reports/UI owner (coordinator until assigned) | — | AA-01 | Existing owner reports/charts, saved run inspector and artifact/document surfaces | Typed report/record/artifact intents and provenance-preserving normal-user navigation not accepted; arbitrary code/HTML/SQL tools deferred |
| AA-08 | REVIEW | Independent QA | codex/alpha-ai-e2e-acceptance / #323 (one authenticated first-contact spec) | Selected P0 source + provisioned stack | Baseline history/onboarding/pilot helper checks pass; test/evidence inventory below; #318 independently reviewed | Authenticated first-contact test passes on disposable stack. Broader saved-effect/AI/recovery gates remain pending; fixture/typecheck passes cannot close them |

## Source states (distinct from admission)

- Implemented owners: authentication/bootstrap settings, scoped company reads,
  ordinary CRM/Sales/Expense forms, Accounting readiness, governed RAG answer
  admission and stream provenance, draft review, saved run/evidence inspection.
- Partial integration: unified conversational dispatch, organization activation,
  AI form proposal handoff, exact business-effect recovery, structured result
  navigation and the six source-bound skill candidates.
- Disabled/deferred: production budget parking/resume without its admitted
  dispatcher; unrestricted model tools/code/SQL; uncertified capability promotion.
- Missing accepted evidence: current tenant release/certificate readback for the
  candidate versions, approved live-provider usefulness/settled-spend tests,
  integrated guide durability/revocation/restart proof, and full authenticated
  member/action/insight/recovery journeys beyond the accepted owner first-contact path. Individual source implementations
  or local fixtures do not change these admission states.

## Supported-journey readiness by operation

| Journey / module | Existing canonical owner and source evidence | Missing integration / acceptance boundary |
| --- | --- | --- |
| Sign-in → organization/company setup | Onboarding UI, lib/onboarding-config.ts, canonical bootstrap; cov23-operator-lifecycle.spec.ts | Owner setup → checklist → first contact now passes; broader dependency/member/language journeys remain unaccepted |
| Selected record question | ai-ui-context.ts, erp-ai-context.tsx, scoped RAG request and live snapshot owners | Shell preserves module/tab/selection/company. Fresh permission and source revocation need live AI stack acceptance |
| CRM contact/customer | Existing CRM create form, custom-field guard, crm-workflow tests | Existing business form, not certified AI handoff. Exact identity/allowed proposal and return context pending |
| Sales quotation | Existing sale-order forms, canonical create/line/confirmation owners | AI preparation/handoff/readback not accepted; no invoice/posting authority inferred |
| Expense capture/receipt | Existing capture form, receipt upload, outbox, approval/reimbursement owners | Cross-module chat proposal/attachment preservation and actual saved result pending |
| Accounting setup/reports | Existing Accounting readiness and owner report previews/calculations | Checklist links to owner; no duplicated readiness or financial calculator |
| Finance review inputs | Existing finance-review model/form, five closed inputs and governed source API | Shell routing/missing-input questions and live independently promoted versions pending |
| Action draft → business effect | Existing authoritative draft/review/effect owners | Current mvp-ai-action-draft browser test proves approval state, not exact saved Task identity; must extend before completion claim |
| Guides/Documents | #309 private revisions, modal and dedicated reader, reauthorized related references | Keep draft guidance distinct from evidence; #309's remaining acceptance is not closed by green viewer fixtures |
| Reports/charts/artifacts | Normal reports workspace and saved-run evidence inspector | Authorized typed navigation intents and source/currency/basis retention pending |

## Skill release reconciliation

Source candidates: report_analysis **1.0.7**; finance_report_review,
bank_reconciliation_review, period_close_review, expense_evidence_review and
finance_variance_review **1.0.1**. All six have source-bound candidate manifests.
Only historical report **1.0.5** live acceptance is evidenced by #282. No current
tenant catalog/release/certificate/provider readback is available in this session.
All six current active-release states therefore remain **unverified**; candidate
source and the generated skill catalog must not be advertised as availability.
Detailed preparation evidence lives in alpha-ai-skill-qualification-status.md on #318.

## Exclusive ownership and PR plan

All agents use separate worktrees from the same main SHA and commit only their files.
Maximum three implementation workers plus coordinator and independent QA.

| Owner | Exclusive files / boundary | First reviewable delivery |
| --- | --- | --- |
| Coordinator | modules-shell.tsx, erp-ai-context.tsx, shared assistant-turn/UI contracts, generated integration, contract lane, manifests/CI/package registration, additive shared locale entries, this ledger | AA-00 ledger PR; AA-01 presentation coordination PR. No public generated contract expanded in first slice |
| Backend worker | ai-gateway/src/routes/rag.rs only; live snapshot excerpt function/tests, disjoint from #309 guide hunks | Multilingual response panic fix, no prompt/executor/binding changes |
| Activation worker | New Overview activation-checklist model/tests/panel; explicit transfer of minimal overview-client.tsx import/render only | Deterministic current-scope checklist; coordinator integrates locale/test additions |
| Qualification worker | scripts/erp_skill_benchmark.py, its tests, eval README and qualification status | #318, independent against main |
| Independent QA | Independent implementation review; one focused alpha-assisted-activation.spec.ts in an isolated worktree now assigned | Review first slices, then integrated authenticated acceptance. Never author and independently accept the same implementation |
| Existing PR owners | #309 guide history/storage/contract pin; #312/#313 broad translations; #317 infrastructure | No rebase, merge, promotion, deployment or unsolicited comments to their owners |

Stack only after dependencies are stable; independent slices target main. Shared
shell integration with #309 is serialized by the coordinator after its merge.
No automatically merged PR or deployment is authorized.

## Acceptance scenarios and honest gates

1. Run one assistant turn through HTTP rejection, lost reply, incomplete/malformed
   SSE and draft failure. Each dispatched callback runs once, successful draft
   cards survive failed answers, current scope suppresses late results, and EOF
   without terminal metadata never becomes a completed answer.
2. Fresh organization: canonical onboarding settings readback → role-aware
   checklist → normal first contact/order/expense form → exact persisted record.
   Denied/loading/unavailable reads must not be labeled empty or complete.
3. Prepare/edit/review/confirm through an existing owner; exact result readback
   must distinguish draft approval from posting/payment or other business effect.
4. Use the admitted finance skill and fixed owner source; verify saved run,
   independent review, correct evidence and settled spend. Replay is preparation only.
5. Explain an actual bounded ERP error; retain draft/focus, open permitted
   correction/help, save/reopen guide through #309 and verify access changes.
6. Reload/disconnect, switch company/revoke membership, duplicate clicks and
   concurrent review: exact request reconciliation precedes retry; no cross-scope
   text, inherited approval or duplicate effects.
7. AI disabled/provider unavailable/budget exhausted/uncertified release: explicit
   limitation with normal ERP available. No mock financial facts.
8. Exercise 320/390/768/1440px, keyboard and supported Alpha language fallback.
   New copy uses translation keys; complete language-pack review remains separate.

Existing browser owners: cov23-operator-lifecycle.spec.ts (bootstrap/settings and
membership), ai-rag-evidence-access.spec.ts (live gated RAG/revocation),
gov00-governed-execution.spec.ts (provisioned live agent/run/spend),
ai-chat-workspace.spec.ts (four widths/focus/composer without AI calls), and
mvp-ai-action-draft.spec.ts (draft review, insufficient for saved business effect).

At initial QA inspection no local services answered on 3000/3100/8000/8080/8082/
5432/6333 and no saved authentication state existed. Managed environment has no
configured provider secrets, runtime variables or outbound identities. Do not
reuse a production tenant or spend budget implicitly. Build a disposable stack
where feasible; live provider/tenant gates require explicit authorized access.
No skipped prerequisite, static check or in-memory mutation counts as acceptance.

## Checkpoint evidence

- #318 at 8422d1b6: 212 script tests pass; catalog/finance manifests and diff checks
  pass. Independent QA found no blockers and reran all eight collector tests.
  All 21 exact-head hosted checks now pass, including CI/E2E gates and all three P0
  shards. This does not close tenant activation or provider qualification gates.
- AA-01 frontend #321 at 482507e5: ten turn regressions and seven shared UI tests
  pass; full web unit command passes 138 files with no skips. All 11 workspace
  TypeScript checks pass. I18n, type-debt (2261), operation transport, catalog/finance
  manifests and vendored 0.3.157 checks pass. Independent QA found malformed source
  projection could hide a successful draft; validation now occurs inside each
  coordinated attempt and the regression passes. Re-review found no remaining blocker.
- Backend #319 at 8c7b3f43: original UTF-8 panic reproduced, fix preserves the byte
  disclosure limit, all 24 focused RAG tests pass. Formatting, catalog/manifests and
  independent source review pass; no #309 guide hunks duplicated.
- AA-00 #320: independent ledger review found no overclaim or ownership issue; all
  currently reported hosted checks completed without failures (documentation-only
  browser/build skips are not runtime acceptance).
- Local testing branch codex/alpha-ai-integration-review combines #318/#319/#321
  by cherry-pick, without changing main or merging any PR. Frozen install, 212
  script tests, catalog and finance manifest checks pass. AA-02 is now integrated;
  the shared web package test-script conflict retains both test lists. Integrated
  web unit command passes 139 test files, and direct execution passes ten turn and
  eleven activation cases. Combined i18n, type-debt, transport and vendored checks
  pass. The first integrated workspace typecheck was killed with exit 137 during
  concurrent module/API compilation (nine package passes). Build stages are now
  serialized; the final full workspace typecheck now passes all eleven package
  checks with concurrency one (nine cached, two executed; no check disabled).
- AA-02 #322 at 31ae7ce4: eleven model cases, full web suite, web TypeScript and
  source checks pass. Independent QA reran all four synthetic browser cases on the
  committed head at 320/390/768/1440px and inspected the mobile screenshot. The
  actual New contact form does not set customer classification, so first-task
  contact creation and quotation customer prerequisites remain distinct. Screenshots
  and precise limits are committed under docs/plan/alpha-activation-evidence/.
- Docker daemon access is healthy with normal network-enabled sandbox access.
  A dedicated PostgreSQL 16 test container is healthy; isolated SpacetimeDB
  tooling is installed. The development module built serially, passed pinned WASM
  validation and was published to a new local database. Canonical baseline fixtures
  were prepared in the disposable stack; the AA-08 test creates a separate orgless
  account and seeds no business records in its new organization. Native API build
  passed with one job and debug symbols disabled; checksum migrations, API health,
  canonical seven test personas and warmed web sign-in pass. Restart recovered the
  exact existing module/fixture organization without reseeding. The real AA-08
  fresh-tenant/contact test passes (one test, 37.3s) after correcting an initial
  test-only currency route error; that failed attempt created no contact or AI
  request. Exact saved contact scope/identity survive reload, with one create POST
  and zero AI requests. Persisted organization 4098, company 4098 and contact 4097
  were independently confirmed with one bounded synthetic-marker read, no newest-row
  fallback or mutation. Test-only #323 is stacked against the testing branch.
  See [authenticated evidence](alpha-ai-acceptance-evidence/README.md). No existing
  database, production configuration, provider or production tenant has been used.
- Accepted bounded evidence: fresh organization → normal CRM first contact →
  exact canonical record after reload in the disposable development stack. This
  does not accept full AA-02/08 or the AI handoff/recovery/financial/guide journeys.
  No PR merges, production deployments, contract publications,
  live provider dispatches or production business-state mutations performed by this program.

## Latest review checkpoint

- Six draft PRs are published: #318 qualification metrics, #319 RAG UTF-8,
  #320 coordination/evidence, #321 safe turn coordination, #322 activation and
  #323 the test-only authenticated journey (stacked on the integration branch).
- Full integrated workspace TypeScript passes all 11 packages; the finalized
  #323 test branch also passes its full web TypeScript check. The earlier
  concurrent OOM is not counted as a pass; the final serial commands succeeded.
- Integrated web unit command passes 139 files; script suite passes 212 tests;
  focused turn/activation cases pass 10/11 respectively; shared chat passes seven
  cases; the RAG worker's 24 focused cases pass. Four responsive synthetic cases
  pass independently. All relevant transport, locale, source-manifest, type-debt
  and vendored contract checks pass without gate changes.
- Hosted snapshot: #318 passes all 21 checks. #319 has all three P0 shards passed
  with its final E2E aggregator still pending. #321/#322 have remaining Rust,
  frontend and/or browser checks; #323 has image/artifact planning checks pending.
  No failed check was observed on these final heads. Documentation #320 has no
  failing check; docs-only skips do not establish runtime acceptance.
- Next bounded package is server-authorized assistant turn/capability routing,
  followed by the permitted form bridge; do not expose uncertified operations.
  Coordinate the shared shell/guide DTO with #309 and broad translations with
  #312/#313. AA-03/04 remain dependent, #309 owns guide work, and live skill
  certification/provider/production gates require their separately authorized
  access and evidence. No full Alpha completion or promotion is declared.

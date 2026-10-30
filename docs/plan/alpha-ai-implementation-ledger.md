# AI-assisted ERP Alpha implementation ledger

Updated 2026-10-30. Coordinator: Codex. This ledger coordinates AA-00–08;
it does not replace the governing ERP/harness plans, domain owners or release gates.
No package is accepted from code existence or a fixture-only test.

## Refreshed baseline and existing work

Fetched `origin/main` before editing: **3d6f32c23ba4a569f83d752ac0b2257e43799397**.
The supplied reference is still current. GitHub's exact-main check readback has
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
| #317 | Open infrastructure retry follow-up. Reserved release/CI/manifests untouched by this program. |

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
| AA-00 | ACTIVE | Coordinator + independent QA | codex/alpha-ai-coordination | None | Exact baseline/PR/contracts readback; code-derived matrix and exclusive assignments below | Final independent ledger review and integrated staging evidence pending |
| AA-01 | ACTIVE | Coordinator; backend worker | codex/alpha-ai-unified-turns; codex/alpha-ai-turn-backend | AA-00 scoped | Existing server RAG and stream share gated publication. First slice removes duplicate fallback, silent draft failure, incomplete SSE success and shared UI mock financial facts; backend bounds multilingual excerpts safely | Full server-authorized intent/capability routing, clarification contract and finance/form dispatch remain unaccepted; no new execution authority |
| AA-02 | ACTIVE | Activation worker | codex/alpha-ai-assisted-activation | AA-00; later AA-01 | Existing bootstrap currency/timezone/year-end and Accounting readiness reused. First slice reads current scoped ERP state for a deterministic role-aware first-task checklist | Fresh-tenant first-record browser journey; complete Sales/Expense prerequisite checks and sample-data provenance pending |
| AA-03 | BLOCKED | Forms owner (coordinator until assigned) | — | AA-01 accepted contract + certified canonical form owner | Existing contact/order/expense forms and AI form-suggestion path; exact permitted proposals and attachment retention need integrated proof | Cross-module typed bridge not accepted. Do not advertise automatic save, unsupported invoice creation or invented relations |
| AA-04 | BLOCKED | Recovery owner (coordinator until assigned) | — | AA-01/03 | Existing action-draft review, effect lifecycle, expense outbox and run recovery owners | Exact request→draft→command→record readback and interrupted-business-effect E2E pending; no uncertain redispatch |
| AA-05 | BLOCKED | Existing #309 owner; coordinator integration only | #309, no replacement branch | #309 integration + AA-01 | Existing viewer/storage/scoped revision/retrieval implementation and green CI | Authenticated save/reload/new-chat retrieval, revocation/stale edit/restart proof; Explain this error and verified guidance promotion remain separate |
| AA-06 | REVIEW | Qualification worker + independent QA | codex/alpha-ai-skill-qualification / #318 | AA-00 | Collector consistency fixes; 212 Python tests, manifest/catalog checks; independent review of 8422d1b6 passes | Tenant release readback, approved provider profiles/budget/test tenant, independent certification, staged disable/rollback remain blocked externally |
| AA-07 | BLOCKED | Reports/UI owner (coordinator until assigned) | — | AA-01 | Existing owner reports/charts, saved run inspector and artifact/document surfaces | Typed report/record/artifact intents and provenance-preserving normal-user navigation not accepted; arbitrary code/HTML/SQL tools deferred |
| AA-08 | ACTIVE | Independent QA | Read-only review; browser branch not yet assigned | Selected P0 source + provisioned stack | Baseline history/onboarding/pilot helper checks pass; test/evidence inventory below; #318 independently reviewed | No local authenticated services/auth state. Fixture/typecheck passes cannot close canonical saved-result or live-provider gates |

## Supported-journey readiness by operation

| Journey / module | Existing canonical owner and source evidence | Missing integration / acceptance boundary |
| --- | --- | --- |
| Sign-in → organization/company setup | Onboarding UI, lib/onboarding-config.ts, canonical bootstrap; cov23-operator-lifecycle.spec.ts | Setup is implemented; post-bootstrap role-aware dependency/first-record journey needs proof |
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
| Independent QA | Read-only implementation review; future cross-cutting browser test ownership requires assignment | Review first slices, then integrated authenticated acceptance. Never author and independently accept the same implementation |
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
  Hosted CI/E2E/runtime-image checks started; no hosted conclusion claimed yet.
- AA-01 frontend implementation under review: single presentation coordinator,
  complete-stream requirement, explicit partial outcomes and mock removal. Focused
  shared UI: seven tests pass. Full web unit command: 138 test files pass, no skips.
  Remaining checks and independent review recorded at the next checkpoint.
- No new end-to-end journey accepted. No merges, deployments, contract publications,
  live provider dispatches or business-state mutations performed by this program.

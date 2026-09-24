# ERP harness implementation ledger

Status: INITIAL LEDGER — 2026-09-14.
Coordinator plan: [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md).

This is the assignment surface for implementation agents. Architectural semantics remain in `docs/plans`; this ledger converts them into bounded implementation packages.

## 1. Ledger rules

Status values:

```text
TODO       not yet assigned or re-verified
ACTIVE     exactly one current implementation owner
REVIEW     worker returned; coordinator integration/review pending
BLOCKED    prerequisite, defect, contract release, or external proof missing
ACCEPTED   integrated revision + required evidence recorded
DEFERRED   deliberately disabled from the current promotion target
```

Do **not** mark historical/open-PR work `ACCEPTED` merely because similar code exists. The first coordinator pass should inspect the accepted implementation base and convert packages to `ACCEPTED`, `PARTIAL` notes, or narrowed follow-ups without reimplementing delivered work.

Session estimates are planning weights, not promises:

- `0.5` = small focused correction/proof;
- `1` = normal Luna work package;
- `1.5` = larger integration slice;
- `2x` = deliberately two-session package, same responsibility boundary.

Each accepted row must gain an evidence note containing revision, reviewer, tests/runs, contract version if relevant, and remaining deferrals.

## 2. Ownership map

| Prefix | Primary ownership | Must not absorb |
| --- | --- | --- |
| `BASE` | integration baseline, known prod blockers, adversarial harness | new harness architecture |
| `GOV` | canonical agent execution, durable loop, spend/drafts/answer reachability | broad capability expansion |
| `TRACE` | provenance, questions, repair, continuation, session controls, knowledge | provider/runtime redesign |
| `CAP` | generated/scoped capability contracts and skill migration | business rules |
| `ERP` | human business workflows + ADV invariants | AI-only mutation semantics |
| `WPR` | WorkProgram compiler/runtime/certification | sandbox-provider internals |
| `SBX` | sandbox/data/evidence/artifacts/workspace/CLI | ERP authorization ownership |
| `SEC` | HSEC, residency, retention, supply-chain, deployment proof | new business workflows |
| `LEARN` | trace corrections/replay/comparison/org learning | forensic storage platform |
| `INTRO` | causal event capture/index/admin/integrity | model training |
| `ADVAI` | separately admitted specialists/extensions | base-harness requirements |
| `ML` | training governance/datasets/models/promotion | runtime authorization |

## 3. BASE — accepted implementation base and known defects

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `BASE-00` | ACCEPTED | 1 | — | repo/PR inventory, validation only | Reconcile open implementation stacks, docs stacks, current `main`, contract pins, known defects, and exact already-delivered harness gates. Produce no speculative code. | Coordinator has one current-state matrix mapping every package below to delivered/partial/missing evidence and chooses the implementation base revision. **Evidence (2026-09-14):** [`erp-harness-base00-current-state-matrix.md`](./erp-harness-base00-current-state-matrix.md) — accepted base `78b3c2637` (PR #37, contracts v0.3.46); chain tip #45 blocked on operation-history drift; all open PRs reconciled. |
| `BASE-01` | ACCEPTED | 1 | BASE-00 | integration wiring only | Consolidate/rebase the accepted harness implementation stack through the first reviewed capability pin without redesigning it. | One buildable integration head contains the accepted H3/H4/H5/non-progress/capability work; no duplicate competing PR branch is treated as authority. **Evidence (2026-09-14):** PR #47 (harness chain, contracts v0.3.46 pin), #27 (pre-tenant suite), #48 (frontend-IR chain) merged in that order; integration head `a088500cd`; frontend overlap reconciled on the #48 branch (`ff17a293e`/`adb8157a8`); #45 remains the only open chain PR pending operation-history repair. |
| `BASE-02` | ACCEPTED | 0.5 | BASE-01 | codegen/contracts validation | Establish green canonical contract/codegen/release baseline and record the exact immutable contracts version. Fix only baseline drift attributable to integration. | `check-codegen-pinned`, operation history, tenant ownership, storage policy, capability artifact, schema/release compatibility and focused gateway/API checks pass. **Evidence (2026-09-14):** integrated `main` `a088500cd` — CI run 34889586554 success (check-codegen-pinned IR v2 + capability artifact + operation history; Contracts drift schema/release + storage policy; SpacetimeDB check; focused gateway/API suites). Immutable contracts version recorded: **v0.3.46**. Browser E2E failures are BASE-05 scope and recorded there. |
| `BASE-03` | ACCEPTED | 1.5 | BASE-00 | messaging reducers/tests | Repair confirmed communication blockers from the pre-tenant suite: tenant reference crossing, consent/identity recheck, immutable approved content, separation of duties, stale provider callback behavior, number-change behavior. | Previously known communication failures are removed from the known-defect list and pass native/in-module plus focused browser tests. **Evidence (2026-09-24):** PR #88 implementation accepted on PR #89 head `9d0e92c7e`; clean CI run `36054658413` on executable revision `065c45f2f` passed cargo/native/codegen/typecheck, `run_core_operational_messaging_test`, and the complete pre-tenant lane (27 passed, 17 classified prerequisite skips, 0 failed). Focused operational messaging passed 4/4 locally. Reviewer: Codex coordinator evidence review (not human approval). Contracts `v0.3.53`; outbound dispatch and reconstruction remain explicit non-BASE deferrals. |
| `BASE-04` | ACCEPTED | 1.5 | BASE-00 | payments/import parser/reducers/tests | Repair payment post/reversal retry semantics, conflicting idempotency-key replay, money boundary handling chosen by the canonical domain plan, and statement CSV/idempotency defects relevant to pilot workflows. | Correct retries are idempotent, conflicting payload replay rejects, monetary/CSV fixtures pass, no duplicate economic effect occurs. **Evidence (2026-09-24):** #78→#87 implementation accepted on PR #89 head `9d0e92c7e`; clean CI run `36054658413` on executable revision `065c45f2f` passed cargo/native/codegen/typecheck, `run_accounting_payment_management_test`, and the complete pre-tenant lane (27 passed, 17 classified prerequisite skips, 0 failed). Focused bank import passed 2/2 and CSV parser 11/11 locally. Reviewer: Codex coordinator evidence review (not human approval). Contracts `v0.3.53`; future decimal/minor-unit migration remains explicit. |
| `BASE-05` | ACCEPTED | 1.5 | BASE-01, BASE-03, BASE-04 | pre-tenant E2E harness | Run the written `@pretenant` Playwright suite against a seeded integrated stack; repair harness/test setup issues separately from product defects and record all remaining failures. | Browser suite actually executes; capability-gated AI cases activate when prerequisites exist; no unclassified skip or hidden known defect remains for the target promotion. **Evidence (2026-09-24):** PR #89 clean CI run `36054658413` certified executable revision `065c45f2f`: pre-tenant 27 passed/17 classified prerequisite skips/0 failed, P0 89 passed/9 classified live-AI skips/0 failed, aggregate E2E gate passed, and pre-tenant cargo/native/codegen/typecheck gates passed. Reviewer: Codex coordinator evidence review (not human approval). Contracts `v0.3.53`; capability-gated AI/provider/reconstruction work remains deferred to its owning tracks. |

## 4. GOV — canonical governed production execution

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `GOV-00` | TODO | 1.5 | BASE-02 | gateway route/executor adapter | Add one real governed HTTP/skill execution path that creates/resolves the durable run context and calls the existing recorded loop. Do not add another loop. | A low-risk skill reaches `run_recorded_loop` through authenticated server-derived org/actor/company context and persists its run/steps. |
| `GOV-01` | TODO | 1 | GOV-00 | authorized generated-tool view | Resolve effective model-visible capabilities as current authorization ∩ skill/release declarations ∩ reviewed generated entries; narrow row/byte ceilings by actor policy. | Model sees only current authorized tools; organization cannot be model input; company/row bounds narrow correctly; revocation affects the next call. |
| `GOV-02` | TODO | 1 | GOV-00, BASE-02 | spend/provider attempt operations | Provision/use reserve+settle grants, finish operator-safe `outcome_unknown` reconciliation path, and prove dispatch cannot occur without the durable attempt/reservation sequence. | Reserve → attempt → dispatch → result → settle ordering is live; ambiguous results remain non-redispatchable until reconciled; operator action is audited. |
| `GOV-03` | TODO | 1 | GOV-00, GOV-01 | run-correlated action-draft bridge | Route durable-loop mutation proposals through exact run/request-correlated draft creation and approval wait state; remove latest-draft lookup on governed paths. | Draft identity is exact/idempotent; direct mutation is unreachable; stale/replayed draft requests cannot target another run/company. |
| `GOV-04` | TODO | 1 | GOV-00, GOV-01 | candidate-answer admission seam | Implement the minimum shared answer-admission seam needed to prevent candidate prose from being user-facing before structural/evidence validation; design it to be extended by TRACE-06. | Candidate answer has explicit validated/qualified/blocked state; streaming/fallback paths cannot bypass the seam. |
| `GOV-05` | TODO | 1.5 | GOV-00..04 | legacy fence/canonical executor | Make production skill execution deny-by-default outside the one governed executor. Preserve only explicit development compatibility where production startup rejects it. | Every enabled production skill/platform AI route is classified; no generic legacy skill path can bypass policy snapshots, spend, or answer admission. |
| `GOV-06` | TODO | 1.5 | GOV-05, BASE-05, SEC-00, SEC-01 | E2E pilot + operator run inspection | Close P0 with one reviewed inventory read workflow under live generated tools, current authorization, spend accounting, answer gate and run inspection. | Real E2E: 2+ tool calls, bounded result, provider attempt/spend, denial fixtures, no mutation path, inspectable run, rollback/disable control. |

## 5. TRACE — interactive base harness, evidence and knowledge

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `TRACE-00` | TODO | 1.5 | BASE-02 | canonical source/contribution records + release | Implement versioned Source/SourceVersion/SourcePassage/Contribution persistence and generated authorized contracts. Keep original authorship distinct from discussion contribution. | Book/paper, company publication and ERP/policy fixtures round-trip with exact version/passage identity; unknown metadata stays unknown; cross-scope reads deny. |
| `TRACE-01` | TODO | 1.5 | TRACE-00 | claim/decision/component lineage | Persist claims/concepts, decisions, assumptions/adaptations and stable component bindings without hidden reasoning. | Source → passage → claim/concept → decision → component is reconstructable after edit/fork; changed links become review-needed rather than silently inherited. |
| `TRACE-02` | TODO | 1 | GOV-00, TRACE-01 | durable question/reply lifecycle | Add versioned required/optional questions, authorized respondents, waiting-input state, idempotent replies and steering invalidation. | Required question survives reconnect/restart, one current reply resumes dependent work, stale/unauthorized replies deny, reply never grants mutation approval. |
| `TRACE-03` | TODO | 1 | GOV-04 | validator diagnostics/repair | Standardize typed diagnostics bound to candidate/component/version and implement bounded repair attempts that create new candidate versions. | Invalid candidate receives stable diagnostics; repair revalidates; exhausted/persistent failure cannot publish; validator pass does not grant domain approval. |
| `TRACE-04` | TODO | 1.5 | TRACE-01, TRACE-02 | continuation manifest/compaction | Persist authoritative continuation manifests containing objective/constraints/decisions/questions/approvals/effects/candidates/budgets/progress and validate before continuation. | Compaction cannot lose permission/effect/budget/question state; missing authorized refs reload or block; summary text cannot restore authority. |
| `TRACE-05` | TODO | 1.5 | TRACE-02, TRACE-04 | inspect/interrupt/resume/fork/compare controls | Implement typed session controls with event cursors, versions/idempotency, uncertain-effect reconciliation and fresh authorization on resume/fork. | Reconnect/resume causes no duplicate effect; interruption stops new scheduling; fork inherits lineage but not approval/budget reset; candidate revert is not ERP rollback. |
| `TRACE-06` | TODO | 2x | TRACE-00, TRACE-01, TRACE-03, GOV-04 | full claim/evidence gate + inspector | Complete answer/publication validation: server-resolved refs, passage identity, access/applicability, deterministic calculations, material claim coverage/support, qualification/abstention/review; add shared inspector. | Fabricated/irrelevant/stale/unsupported evidence and arithmetic failure cannot yield validated output; denied source content leaks nowhere; all admitted answer paths use the gate. |
| `TRACE-07` | TODO | 1.5 | TRACE-05, TRACE-06 | reviewed knowledge + dependency invalidation | Implement candidate→reviewed→approved knowledge/procedure lifecycle, reverse dependencies, supersession/retraction/revocation/delete handling and scoped reuse. | Approved concept/procedure reuses with fresh authorization and lineage; source change invalidates dependent caches/work; repeated usage never self-approves knowledge. |

## 6. CAP — generated/scoped production capability surface

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `CAP-00` | TODO | 1.5 | BASE-02, GOV-01 | capability metadata/codegen + release | Expand reviewed **read** capability descriptors from inventory bootstrap to the minimum P1 domain set, deriving provider schema/result policy from canonical IR. | Every added read has review metadata, closed schema, server-derived tenant scope, bounded result policy, verifier tests and immutable release/pin. |
| `CAP-01` | TODO | 2x | CAP-00, ERP-00 | operation schema codegen + action-draft metadata | Expand IR type resolution enough to generate provider-safe operation inputs for reviewed **draft-only** consequential capabilities; never expose raw reducer names. | Reviewed mutations have generated typed schemas/risk/confirmation metadata and can only resolve to action-draft flow; unreviewed operations remain unadvertised. |
| `CAP-02` | TODO | 1.5 | GOV-05, SEC-00 | scoped SQL/data service | Implement reviewed server-owned SQL templates or equivalent typed data services only where generated resource reads are insufficient; executor owns tenant/company binds. | Model/caller SQL never reaches shared DB; DDL/DML/export/cross-tenant tricks deny; output rows/schema/bytes/timeout are independently bounded. |
| `CAP-03` | TODO | 2x | GOV-05, SEC-00 | tenant-file + approved research/network brokers | Complete company-scoped tenant object operations and explicit allowlisted research/fetch capability boundary; no server paths or standing credentials. | Cross-company object reads, path traversal, unrestricted URLs/egress and oversized/incorrect-MIME data deny; provenance and data classification are retained. |
| `CAP-04` | TODO | 1.5 | CAP-00, TRACE-06, GOV-05 | first skill migration batch | Migrate read/report/analysis pilot skills to the canonical executor using reviewed generated/scoped capabilities. | Migrated skills no longer use legacy raw SQL/handwritten capability bypasses and pass certification/evidence gates. |
| `CAP-05` | TODO | 2x | CAP-01..04, ERP-07 | remaining skills/platform route classification | Migrate remaining bundled skills and classify RAG/forms/import/context as governed skills or platform services with one authority path. | No enabled AI route is an alternate model/tool authority; consequential skills use certified draft operations; unresolved capability classes remain disabled explicitly. |

## 7. ERP — business workflow integration and invariant certification

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `ERP-00` | TODO | 1.5 | BASE-00 | common workflow/action/result primitives + ADV harness | Implement INT shared workflow seam and ADV generic invariant helpers: zero-delta rejection, tenant/reference sweeper, retry/fault matrix, stale approval/version binding. | Shared primitives are used by first vertical; generated typed mutations remain client boundary; generic invariant fixtures fail known bad cases. |
| `ERP-01` | TODO | 2x | ERP-00 | O2C CRM→quote→order | Complete user-reachable CRM/sales quotation/order lifecycle with stable record refs, authorization, stale state and typed operation results. | Human UI/API E2E reaches canonical order state without hard-wired undefined/duplicate business rules; O2C early ADV cases pass. |
| `ERP-02` | TODO | 2x | ERP-01, BASE-04 | O2C fulfillment→invoice→payment→returns | Complete fulfillment/backorders, invoicing, payment/reconciliation and returns/credit/exchange continuation. | Retry/lost-response/concurrency/conservation/accounting/approval cases pass; cross-module refs converge correctly. |
| `ERP-03` | TODO | 2x | ERP-00 | P2P supplier→requisition/RFQ→PO | Complete supplier onboarding, requisition/RFQ and PO lifecycle under shared workflow primitives. | Typed/UI flow, permissions, approvals and stale-state behavior pass; beneficiary/reference mutation attacks are covered. |
| `ERP-04` | TODO | 2x | ERP-03, BASE-04 | P2P receipt→bill/match→payment | Complete receipt, vendor bill, three-way match and payment. | Quantity/money conservation, duplicate effects, approval/version binding and payment retry cases pass. |
| `ERP-05` | TODO | 2x | ERP-00, BASE-03, BASE-04 | inventory + record-to-report certification | Integrate/certify inventory operations and accounting close/payment/reporting paths needed by pilot capabilities. | Serial/stock concurrency, closed-period/post races, balance/conservation, reconstruction and tenant cases pass. |
| `ERP-06` | TODO | 2x | ERP-00 | projects/payroll/subscriptions/shared approvals/horizontal flows | Complete the minimum P1/P2 user-reachable vertical/horizontal flows for projects, employee/payroll, subscriptions, approvals, documents/import/reporting convergence. | Each enabled flow has typed UI reachability, authorization, retry/stale semantics and its vertical ADV gate; non-target modules stay explicitly deferred. |
| `ERP-07` | TODO | 1.5 | ERP-02, ERP-04, ERP-05, ERP-06 | AI/offline exposure matrix | Publish the certified workflow→CapabilityKey→risk/approval/offline eligibility matrix. No new business code. | AI/offline may only expose workflows whose human canonical path passed its invariant gate; every disabled operation has an explicit reason. |

## 8. WPR — one reusable WorkProgram runtime

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `WPR-00` | TODO | 1.5 | CAP-00, TRACE-01 | WorkProgram/CodeArtifact contracts + compiler | Implement immutable draft/version manifests, step taxonomy/effect classes, graph compilation and static resolution of capabilities/runtime/artifacts. | Invalid graph/unresolved capability/runtime/hash/approval boundary fails closed; published version is immutable and pins contract version. |
| `WPR-01` | TODO | 2x | WPR-00 | ProgramRun persistence + deterministic scheduler | Implement durable ProgramRun/step state and scheduler for deterministic acquire/code/render-ready primitives, pause/cancel/failure and budgets. | Restart preserves canonical state; UI/client never orchestrates steps; no consequential step exists yet except explicit unsupported state. |
| `WPR-02` | TODO | 1.5 | WPR-01, TRACE-04, TRACE-05 | checkpoint/retry/resume | Add checkpoints, explicit step retry ownership, stale-handle reacquisition, current authorization and effect-safe resume. | Completed consequential/effect refs are never blindly replayed; reconnect recovers state rather than resubmitting the last step. |
| `WPR-03` | TODO | 1.5 | WPR-01, CAP-03 | model/research/document adapters | Integrate model, approved research, document/OCR step adapters under evidence/freshness/budget contracts. | Provider/runtime details remain outside graph semantics; evidence/source refs persist; malformed/stale provider output follows explicit failure policy. |
| `WPR-04` | TODO | 1.5 | WPR-01, CAP-01, ERP-07 | capability/draft/approval steps | Add generated capability invocation, draft-action, approval/wait steps and execution-time reauthorization. | Sandbox/model cannot mutate ERP directly; stale approval/draft/permission tests fail closed; effect is idempotent/reconcilable. |
| `WPR-05` | TODO | 2x | WPR-02..04 | automation + execution modes + shared ProgramRun UI | Add version-pinned manual/schedule/domain triggers, overlap/dedup/misfire rules, simulate/dry-run/preview/live, and server-owned run UI. | One report/import/document program uses the same engine; automation restart does not duplicate runs; dashboard render never implicitly executes work. |
| `WPR-06` | TODO | 1.5 | WPR-05, SEC-06 | certification/compatibility/dependency graph | Implement CertificationReport, risk-scaled fixtures/evals, dependency graph and compatibility classification against contract/runtime changes. | Published program can be blocked/migrated/deprecated deterministically; deployment surfaces affected programs; certification never grants runtime authorization. |

## 9. SBX — sandbox, data/evidence boundary, artifacts and workspace

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `SBX-00` | TODO | 1.5 | WPR-00, SEC-00 | `SandboxProvider` abstraction + first Daytona proof | Implement provider-neutral sandbox lifecycle and one approved isolated provider proof without leaking provider IDs into program semantics. | Create/execute/destroy works through interface; provider swap seam is real; runtime has no ERP authority. |
| `SBX-01` | TODO | 1.5 | SBX-00, SEC-03 | approved runtime profiles/dependency baseline | Define immutable profile versions/image digests/package allowlists/network/resource budgets and build initial analysis/document/spreadsheet profiles. | Published profiles use pinned environment, no arbitrary package install, no floating image; revocation state is machine-readable. |
| `SBX-02` | TODO | 2x | SBX-00, CAP-00, SEC-00 | DatasetHandle broker/materialization | Implement opaque task/org/company-scoped dataset handles with schema/watermark/provenance/expiry and brokered access. | Handles expose no SQL/storage credentials/path; expired/revoked/cross-task handles deny; row/field/result policy is enforced at materialization. |
| `SBX-03` | TODO | 2x | SBX-01, SBX-02 | Lumière Python SDK + evidence boundary | Implement `datasets`, analysis helpers, evidence emission and bounded artifact registration; raw stdout is not trusted evidence. | Python can analyze scoped data; only validated bounded evidence crosses to model; disclosure/cardinality/provenance tests pass. |
| `SBX-04` | TODO | 1.5 | SBX-03, TRACE-06 | durable program/artifact/recipe lifecycle | Persist AnalysisProgram/CodeArtifact/evidence/document/chart/spreadsheet metadata outside sandbox and implement ad-hoc→recipe→reviewed-skill nomination. | Destroyed sandbox loses scratch but durable outputs reproduce from pinned refs; one successful run cannot auto-promote a skill. |
| `SBX-05` | TODO | 2x | SBX-01, SBX-03, SEC-02 | ProgramWorkspace terminal/files/diff | Implement authorized workspace session, mediated browser PTY, approved file editor/diff and explicit save-as-artifact-draft. | Terminal cannot target host/STDB/PG/cloud; TTL/reconnect/tenant isolation pass; unsaved scratch disappears; terminal output remains untrusted text. |
| `SBX-06` | TODO | 2x | SBX-04, SBX-05, WPR-05 | Lumière CLI + reproduction + collaborative authoring | Route CLI through same broker, reproduce destroyed environments under fresh authorization, and surface agent/user artifact patches as explicit diffs. | CLI gets no broad credentials; reproduction cannot revive stale handles; accepted edits create versioned drafts; AI/manual edits share certification path. |

## 10. SEC — HSEC, residency, retention and supply chain

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `SEC-00` | TODO | 1.5 | BASE-02 | trusted execution envelope/narrowing primitives | Implement one server-derived envelope for actor/org/company/capability/data-class/region/processor/runtime/disclosure/retention scope with subset-only child derivation. | Tamper/superset/expiry/placement-generation tests fail closed; model/client cannot populate trusted fields. |
| `SEC-01` | TODO | 1.5 | SEC-00, GOV-00 | current-policy reauthorization + fence-hop matrix | Reauthorize at run/tool/dataset/draft/approval/execute/resume/fork boundaries and test equivalent denied effects across supported routes. | Permission/member/company revocation blocks next protected operation regardless of skill/WorkProgram/fallback/resume path; zero unauthorized effect. |
| `SEC-02` | TODO | 1.5 | SEC-00, SBX-00 | sandbox credential/network/filesystem isolation | Build adversarial secret discovery, metadata, host mount/socket, egress, resource and tenant A→destroy→tenant B reuse tests. | No standing secret/host access; deny-by-default egress holds; warm pool/snapshot has no prior-tenant residue. |
| `SEC-03` | TODO | 1.5 | SEC-00 | processor/residency/fallback policy | Implement reviewed ProcessorPolicy and runtime target selection as an intersection of tenant placement, data class, region, retention/training-use and provider/sandbox/storage capability. | Empty intersection fails; provider/sandbox/storage/search fallback never weakens policy; region canaries identify actual selected targets. |
| `SEC-04` | TODO | 2x | SEC-03, SBX-02 | data-copy inventory + retention/deletion/legal hold | Build machine-readable inventory/retention descriptors across STDB/PG/object/search/vector/prompt/dataset/sandbox/artifact/log/backups/local/offline copies and lifecycle canary tests. | Expired temporary copies disappear where required; legal hold preserves canonical held evidence without retaining every scratch copy; third-party proof limitations are explicit. |
| `SEC-05` | TODO | 1.5 | SEC-01, GOV-03, TRACE-05, WPR-04 | approval race + resume/fork/WorkProgram inheritance | Certify exact draft/version binding, execution-time reauth, blast-radius budgets, outcome reconciliation and subset inheritance through child/runtime contexts. | Approval of vN authorizes nothing after mutation to vN+1; stale/revoked scopes fail; child/fork/provider switch cannot widen authority or reset budget. |
| `SEC-06` | TODO | 2x | SEC-02..05, WPR-06, SBX-04 | supply chain, credential broker, attestation, deployment certification | Pin CodeArtifact/runtime dependencies/SBOM, broker external credentials, support central revocation, produce execution attestations and integrate security results into promotion. | Published executable is hash-addressed/revocable, receives no standing secret, affected automations pause, deployment evidence records region/processor/policy/runtime hashes. |

## 11. LEARN — decision correction, replay and organization learning

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `LEARN-00` | TODO | 1.5 | TRACE-01, TRACE-06, WPR-01 | observable trace schema/decision graph | Persist objective interpretation, bounded decisions/alternatives, tool/policy/evidence/source/action/artifact/outcome refs without chain-of-thought. | A completed run reconstructs observable causal decision/tool/evidence graph under current authorization. |
| `LEARN-01` | TODO | 1.5 | LEARN-00, TRACE-05, TRACE-07 | typed corrections + replay executor | Let authorized users correct source/claim/tool/decision/action/outcome nodes and fork immutable original history into forensic/corrected/current/candidate replay modes. | Historical effects never auto-replay; same-state replay uses immutable refs where available; current-state replay reauthorizes; correction remains attributable. |
| `LEARN-02` | TODO | 1.5 | LEARN-01 | RunComparison + ExperienceCase registry | Implement Original/Corrected/Baseline comparison and governed ExperienceCase promotion for candidate-runtime regression. | Decision/tool/evidence/action/artifact/outcome diffs are inspectable; security/tenancy/policy regression is hard fail, not aggregate quality tradeoff. |
| `LEARN-03` | TODO | 2x | LEARN-02, TRACE-07 | organization patterns/preferences/knowledge/heuristics/recipes/skills | Detect repeated correction candidates and implement reviewed promotion hierarchy with independent actors/domain ownership/counterexamples/outcome evidence. | Authorization/high-risk policy never learns silently; disagreement stays scoped; promoted behavior is versioned, revocable, tenant-isolated and regression-tested. |

## 12. INTRO — forensic introspection and causality

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `INTRO-00` | TODO | 1.5 | SEC-00, LEARN-00 | event envelope + IR capture classification + actor pseudonym | Define typed event families/causation IDs, IR-driven audit modes and organization-local keyed pseudonyms; no universal raw payload log. | HTTP/operation/business/AI/workflow events share correlation/causation semantics; sensitive values follow classification; identity reveal is separately authorized/audited. |
| `INTRO-01` | TODO | 2x | INTRO-00, SEC-04 | semantic capture + canonical audit projection + forensic index | Capture access/query/operation/provider/sandbox/offline/import events, project canonical STDB business audit, and store partitioned Postgres forensic metadata with encrypted evidence refs where required. | Consequential business audit lineage survives operational sink degradation; tenant scope derives from trusted context; causal resource timeline resolves without raw shadow database. |
| `INTRO-02` | TODO | 1.5 | INTRO-01 | admin investigation API/UI + governed exports | Add event/detail/correlation/actor/resource views, privileged identity resolution, evidence access and export under distinct capabilities; introspection actions audit themselves. | Admin can trace business effect→operation→auth→workflow/AI/source; denied scope/evidence leaks nothing; exports have bounded lifecycle. |
| `INTRO-03` | TODO | 2x | INTRO-02, LEARN-03, SEC-04, SEC-06 | integrity chain + retention/legal hold + HLEARN/HSEC convergence | Add per-org/partition sequence/hash chain, external checkpoints, class-based retention/deletion/legal hold, and unify HLEARN/offline/import causality. | Integrity verification detects tamper/gap; retention and legal hold pass canaries; learning/introspection does not duplicate hidden reasoning/raw datasets into logs. |

## 13. ADVAI — separately admitted M8/M9 capabilities

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `ADVAI-00` | TODO | 2x | TRACE-07, CAP-05, SEC-06 | bounded specialist delegation | Implement parent/child objective, capability subset, evidence/output contract, depth/concurrency/deadline and shared reserved-budget accounting. | Child cannot widen access/overspend/continue after cancellation; findings retain sources; disagreement remains visible; model review cannot replace human/domain approval. |
| `ADVAI-01` | TODO | 1.5 | TRACE-07, SEC-06 | typed lifecycle extensions | Add only identified normalization/diagnostic/render/telemetry extension points with pinned schema/version/order/effects/time/size/retry/failure semantics. | Required extension failure blocks where specified; optional failure degrades visibly; hooks cannot rewrite trusted context or bypass evidence/authorization. |

## 14. ML — governed model-refinement plane

| ID | Status | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | --- | ---: | --- | --- | --- | --- |
| `ML-00` | TODO | 1.5 | LEARN-02, INTRO-00, SEC-04 | training governance + TrainingPermission/TrainingExample contracts | Implement explicit `none/eval-only/org-private/deidentified-shared/system-fixture` policy and immutable task-family TrainingExample with provenance/deletion lineage. | Customer production defaults to `none`; transforms can only narrow permission; authorization/business policy is never encoded as executable learned authority. |
| `ML-01` | TODO | 2x | ML-00, INTRO-03 | ExperienceCase compiler + immutable DatasetVersion registry | Compile eligible cases through privacy/provenance/task-family transforms into content-addressed examples/datasets with compiler/policy versions. | No direct run→JSONL path; secrets/private IDs are handled task-aware; every example resolves back to source/correction/case and deletion state. |
| `ML-02` | TODO | 1.5 | ML-01 | BenchmarkSuiteVersion + leakage controls | Implement protected train/validation/test case-family separation, hard ADV/HSEC gates and task-specific metrics. | Eval contamination checks fail closed; tenant/security/business-invariant regressions are hard promotion blockers regardless of aggregate score. |
| `ML-03` | TODO | 2x | ML-02, CAP-00 | first capability ranker | Train/evaluate/deploy a replaceable capability retrieval ranker bounded by deterministic authorization candidates. | Improves ranking metrics/context cost without hallucinating unauthorized capability; failure falls back to deterministic discovery, not wider authority. |
| `ML-04` | TODO | 2x | ML-02, TRACE-06, LEARN-02 | tool selection/arguments + SFT/preference/verifier pipeline | Add task-family pipelines for selection/NO_TOOL/ASK/ABSTAIN, schema-valid arguments, corrected preferences and evidence verification. | Generated arguments never include tenant authority fields; preference scope is preserved; learned verifier never substitutes for deterministic/domain approval. |
| `ML-05` | TODO | 2x | ML-03, ML-04, SEC-06 | TrainingJob/ModelArtifact registry + shadow/canary/router | Persist reproducible training jobs/artifacts, benchmark candidates, run consequentially inert shadow comparison, then canary through ModelRouter with rollback. | Candidate provenance is complete; shadow causes no business effects; canary respects cost/residency/security gates; rollback target is explicit. |
| `ML-06` | TODO | 1.5 | ML-05, INTRO-03 | vertical/private adapters + deletion/retraining lineage | Add optional vertical and explicitly opted-in organization-private adapter lifecycle with isolated datasets/artifacts and deletion/retraining/revocation accounting. | Private facts stay out of shared weights by default; cross-org serving/cache isolation passes; source deletion identifies affected datasets/models honestly rather than claiming automatic unlearning. |

## 15. Promotion checklist

### P0 — governed read-only pilot

Must be `ACCEPTED`:

```text
BASE-00..05
GOV-00..06
SEC-00..01
```

Plus the exact `CAP-00` read entries required by the pilot. `TRACE-06` may initially be scoped to the admitted pilot answer class, but candidate prose must still pass a real shared answer gate.

### P1 — single-agent production harness

Must additionally be `ACCEPTED`:

```text
TRACE-00..07
CAP-00..05 for enabled skills
ERP-00..07 for enabled consequential workflows
SEC-05
```

Operator/runtime metrics and migration evidence must show no enabled legacy bypass.

### P2 — reusable new-generation ERP execution

Must additionally be `ACCEPTED`:

```text
WPR-00..06
SBX-00..04 for enabled sandbox profiles
SBX-05..06 only if ProgramWorkspace/CLI are advertised
SEC-02..06
```

If ProgramWorkspace is not advertised, its packages may be `DEFERRED` without weakening sandbox WorkProgram admission.

### P3 — learning + forensic plane

Must additionally be `ACCEPTED`:

```text
LEARN-00..03
INTRO-00..03
```

### P4 — advanced execution

`ADVAI-00` and `ADVAI-01` are admitted independently. Keep disabled until their package passes.

### P5 — model refinement

`ML-00..06` are admitted sequentially by capability. Model training is never a prerequisite for deterministic authorization or normal ERP operation.

## 16. Approximate session envelope

If each package stays bounded and the coordinator aggressively avoids duplicated/reopened work:

```text
P0                          ~15–20 Luna sessions
P1 cumulative               ~35–50
P2 cumulative               ~50–65
P3 cumulative               ~60–75
P4 + P5 full stated roadmap ~75–95
```

The range includes integration/review/rework sessions but assumes independent packages run in parallel where their ownership does not collide.

The purpose of this ledger is to make those sessions composable: each worker should be able to finish one row, hand back evidence, and leave the repository in a state where the coordinator can safely unlock the next dependencies.

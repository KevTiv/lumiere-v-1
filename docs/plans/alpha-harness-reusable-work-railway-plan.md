# Alpha harness reusable work and Railway delivery plan

Status: proposed execution plan, 2026-11-01.
Source baseline: `12dac9c4c` on application main. Reconcile the implementation and served release again before assigning a package.

Source implementation checkpoint: [Alpha reusable work source foundation](../evidence/alpha-reusable-work-source-foundation-2026-11-01.md), based on refreshed main `0731e6864` and contracts `0.3.164`. AH-01/02/04/06/07/10/11/12 have bounded source foundations; their remaining integration and release gates remain partial. Certification and live activation are deferred by the user. No row below becomes accepted from this checkpoint alone.

Deliver reusable, inspectable agent work for the current Alpha modules: acquire authorized data, execute a bounded program, retain verified outputs, publish a versioned tool into an existing ERP workspace, and rerun it with fresh data. Add scoped correction, replay and reviewed procedural memory around that same execution path.

The first vertical slice is an **Accounting and Expenses review report**, opened from Reports and linked to its authorized source records. The second exercises **Products and Warehouse** stock observations. Manufacturing is outside the current Alpha discovery profile and is not the acceptance example for this release.

This plan covers the broader harness gaps. The six near-term workstreams already owned by another session remain dependencies, with their own implementation and acceptance records. This planning change performs no deployment, activation, paid execution or production data mutation.

## 1. Governing plans and current implementation

Architectural semantics remain with the existing plans. This file narrows their implementation and proof to Alpha; it does not replace their full-program gates.

| Concern | Authority and retained implementation |
| --- | --- |
| Execution and uncertainty | [Governed-program direction](README-governed-program-note.md), [migration plan](governed-intelligence-program-migration.md); retain `DecisionGraph`, `GovernedProgramExecutor`, the existing governed services, independent review and native run/effect/spend owners. |
| Reusable programs and publication | [WorkProgram runtime](work-program-runtime-execution-plan.md), [UI convergence](work-program-ui-harness-convergence-plan.md), [certification and compatibility](work-program-certification-compatibility-plan.md). |
| Presentation and placement | [Frontend IR delivery](frontend-ir-luna-coordination-plan.md), `crates/presentation-core`, `spacetimedb/src/presentation`, and `api-server/src/routes/presentation*`. Personal immutable draft save/read already exists; publication and activation are separate missing contracts. |
| Sandbox and datasets | [Data-analysis plan](agent-sandbox-data-analysis-plan.md), [Railway JavaScript status](../plan/railway-js-sandbox-status.md); retain `sandbox-controller` and `ai-gateway/src/sandbox`. JavaScript/QuickJS on Railway is the initial direction. Older Python/Daytona examples describe later profiles. |
| Trace and learning | [Decision trace, replay and learning](harness-decision-trace-replay-organizational-learning.md), migration workstream IC-01–09; retain intelligence events, evidence lineage, decision cases/patterns, reviewed knowledge and checked lifecycle operations. |
| Security and investigation | [Harness security](harness-security-residency-sandbox-certification.md), [forensic causality](forensic-introspection-causality-layer.md), existing trusted context, policy and business audit. |
| Deployment | [Railway releases from main](../railway-main-releases.md), the existing ordered release workflows and scripts. |

The September implementation ledger is a dependency reference, not a current inventory. In particular, sandbox broker/runtime code, typed governed execution, knowledge review, decision corrections and personal presentation persistence must be inspected and reused before classifying their parent packages as missing.

## 2. Alpha module and surface scope

Use `frontend/packages/ui/src/lib/workspace-profile.ts` and `product-surface-catalog.ts` as the current discovery/admission owners, together with [Finance navigation](../plan/finance-alpha-navigation-status.md) and [Products, Warehouse and Fleet scope](product-fleet-alpha-2026-10-31.md). Navigation is not authorization. Every program also needs current server-side capability, company, row and field admission.

The following is the required module coverage matrix. Each row gets an exact named capability/input/output mapping and persisted acceptance evidence during AH-00/AH-09. A missing source adapter is a bounded follow-up, not permission to infer data or remove that module from the matrix.

| Alpha module | Bounded reusable-work proof | Preserve existing boundary |
| --- | --- | --- |
| Accounting | Period-scoped entry/balance review with exact sources, currency and accounting basis; use the existing Finance review inputs and deterministic calculations. | No new posting, payment, reconciliation, tax-filing or locked-period authority. |
| Expenses | Evidence-completeness and allocation review; exact expense/receipt references and unresolved evidence remain visible. | No inferred receipt content, automatic approval or reimbursement. |
| Reports | Catalog, explicit run, persisted report/table/chart output, source drill-through, version history and publication. | Rendering or opening a dashboard never executes a paid program. |
| Sales | Bounded quotation/order pipeline and follow-up report from existing authorized states. | No automatic confirmation, invoicing, delivery or invented revenue recognition. |
| CRM | Bounded lead/opportunity/contact review with exact links and truthful scope. | Existing organization-shared records retain their native scope; company selection must not imply stronger storage isolation. |
| Purchasing | Purchase-order status/discrepancy review with existing receipt and vendor links. | No automatic order confirmation, receipt, payment or new procurement workflow. |
| Subscriptions | Renewal/invoicing status review using recorded lifecycle facts. | A next-invoice date is not a contractual end date; no invented term, charge or renewal. |
| Products | Catalog/category/UOM/data-completeness review using current catalog facts and allowed import references. | Historical import prices are not current prices; no catalog or stock mutation from analysis. |
| Warehouse | Product/location stock and count-observation review, with quantity kind, unit, source watermark and completeness. | Counts, on-hand, reserved and available values stay distinct; no stock posting or immediate replenishment execution. |
| Fleet | Tenant-owned vehicle, manual odometer and recorded service/inspection-cost review. | No GPS, rental, fuel/TCO, retirement or asset-disposal claims; retain the existing service-accounting owner. |

Supporting surfaces are Overview, Tasks, Approvals, Documents, Calendar, Settings and the gated contextual ERP Assistant. Reuse their current roles: placement of stored outputs, existing follow-ups/approvals, document/guide references, schedule inspection and permissioned administration. Calendar is not the scheduler or an authority grant. Documents support already registered text/metadata and admitted guides; OCR, vision, paid indexing and embedding/RAG expansion remain with their separate admission scopes.

Do not expose standalone internal harness/composer screens, broad Inventory, Manufacturing, HR, Projects, Helpdesk, IoT, Maps, Messages, Notebook or other hidden module families to satisfy this plan. Existing authorized record handoffs into related owners remain valid. The guided import picker keeps its actual current allowlist; this program does not broaden it or certify imports by generating a mapping.

## 3. Interface with the other session

The other session owns all six items below. Consume its accepted revision and generated interfaces; do not implement replacements here. An external dependency starts **unverified**, irrespective of code presence.

| External dependency | Required handoff for this plan |
| --- | --- |
| E1 Owner allowance and company scope | Supported configuration read/write, shared-pool identity, current policy revision and company checks. Reruns preserve that pool. |
| E2 Current skill certification | Exact source/model-policy/certificate/release bindings for every skill used by a WorkProgram. A parent skill's certificate does not certify sandbox code or a user-authored program. |
| E3 Live completion and recovery | Fully settled run/effect/economics evidence, checked continuation and current authorization semantics. Reuse the run identity and reconciliation owner. |
| E4 Control-plane integration | Accepted descriptor/instance/stream/follow-up/parking interfaces for features actually enabled. Manual WorkPrograms need only the applicable subset; scheduled execution waits for an admitted production dispatcher. |
| E5 Assistant and ERP handoffs | Typed permitted proposal, record/artifact navigation and exact saved-result contracts. Reuse these when creating a program draft or opening its sources. |
| E6 Prepaid usage | Canonical funding/admission/settlement interface when paid customer credit is activated. Sponsored Alpha can proceed under its separately accepted allowance; this plan creates no wallet, tariff, credit grant or checkout. |

Contracts/codegen, runtime entry points, presentation exports and release orchestration each have one integration owner. Reserve their changes before implementation, including producer releases needed by both sessions. A program cannot become a workaround for a blocked report release, unavailable capability or unimplemented dispatcher.

## 4. Railway baseline and target topology

Read-only Railway inventory on 2026-11-01 found project `reasonable-optimism` (`cc695d4b-030c-43e3-bbd6-a41095b09257`) and only environment `production` (`dbeb35da-dcc5-43bb-ad1d-0066aa530199`). The environment had 17 services and no staged changes. These are inventory observations, not a served-source or end-to-end certification.

- API, AI gateway, web, edge, projection and workflow workers had successful deployments. The shared Rust services referenced the same runtime digest. Verify OCI revision, actual served revision, contracts/catalog and module publisher completion before claiming a coherent candidate.
- No sandbox-controller service or controller volume was present. The owner-report and three integration-worker service records had no deployed source; their existence is not running capacity.
- Application/database services were configured in `europe-west4`. The existing `report-artifacts` bucket reported `ams`. Check processor/region compatibility and bucket access/lifecycle before reuse; do not infer identical placement or a regulated-residency certification.
- Priority Boarding was off in the account feature read. That result does not establish workload-sandbox API entitlement. AH-03 must verify actual workspace entitlement, SDK/API availability and approved-region capacity before allocating a test sandbox.

Target additions are one separately scoped Railway certification environment with a private single-replica sandbox-controller service and protected persistent journal volume, followed by the production controller only after certification. Resolve explicit project/environment/service IDs; names are labels. Certification uses its own database/module, storage prefix or bucket, service identities, actors and bounded budget. It cannot inherit production database credentials, use a production document volume, or mutate the farm as a fault fixture.

Keep the current API, AI gateway, STDB/PG projection and workflow owners. Add a separate dispatcher service only if E4's accepted architecture requires one. Do not activate the dormant owner-report/integration workers as a substitute. Scope controller management credentials to the required Railway resources and keep them out of the guest, model, artifact metadata and logs. If the provider cannot confine the management credential sufficiently, resolve that boundary before customer-data admission.

Railway `ISOLATED` mode still allows public internet. A private controller endpoint and a network-free guest SDK do not prove an enforced egress/escape boundary. If the required boundary cannot be demonstrated, keep sandbox execution synthetic-only and mark sandbox-backed program release blocked. There is no silent fallback to raw rows in model context or an unisolated Node process.

## 5. Alpha release results

Deliver three explicit results in order. These are bounded Alpha gates, not full P2/P3/P5 certification from the broader harness ledger.

| Gate | User-visible result | Required packages |
| --- | --- | --- |
| A Reusable reports | An authorized user runs a published, immutable read-only program from an existing module, reopens its verified output after VM destruction, and reruns with fresh data. Every one of the ten modules has its declared proof. | AH-00–10, AH-13 and AH-15's Gate A acceptance, plus applicable E1–5. |
| B Correctable and reusable experience | The user corrects a source/claim/decision, compares a safe replay, and an independent reviewer promotes one bounded procedural recipe for a later task. | Gate A, AH-11–12 and final AH-15 acceptance. |
| C Scheduled reports | A separately enabled published program runs under a dedicated service binding, with overlap/dedup/budget and revocation proof. | Gate B, AH-14 and E4's production dispatcher acceptance. |

Gates A and B are the proposed current Alpha target. Gate C is an opt-in Alpha increment and stays unavailable until its own proof; it is not implied by manual execution. Full ProgramWorkspace/terminal access, additional runtimes, specialists, arbitrary extensions and model training remain later milestones in section 11. This narrows feature admission, not the ten-module coverage target.

## 6. Bounded work packages

All rows start **PLANNED**. Existing code is retained; acceptance attaches an integrated revision, immutable contract/runtime pins where applicable, exact checks and real-service evidence. Split module cohorts into suffix PRs rather than combining all module changes in one diff.

| ID | Owner boundary | Dependencies | Deliverable and exit evidence |
| --- | --- | --- | --- |
| AH-00 Baseline and capability census | Integration; read-only inventory | Current main and external handoff | Reconcile source/served heads, open changes, contracts, E1–6, module matrix, presentation publication gaps, sandbox entitlement and source-adapter completeness. Reserve shared files. Record delivered/partial/missing for each row. |
| AH-01 Program and code contracts | Canonical program contract/compiler | AH-00 | Draft/head/immutable version, typed input/output, code hash, graph/capability/profile/schema pins and dependency manifest. Compile the admitted subset into the existing governed graph/runtime; reject unsupported nodes, raw authority/SQL/paths and incompatible refs. Generate and release contracts once through the existing lane. |
| AH-02 Durable runs and artifacts | Native persistence and existing artifact/storage adapters | AH-01 | Bind program/version/step/output records to the existing durable run/effect identity. Persist through native organization commit/projection/reconstruction. Validate artifact hash, size, MIME/disclosure, tenant/company and source refs before registration; orphan uploads reconcile. Restart/reconstruction preserves exact IDs and no execution is repeated. SQLite remains operational state only. |
| AH-03 Runtime and isolation proof | Sandbox controller/provider/profile | AH-00 | Verify Railway entitlement and isolated certification target; pin runtime, SDK/dependencies, region and resource policy. Exercise actual provider create/execute/destroy with synthetic data, egress/metadata/host/credential denial, expiry/revocation and tenant-reuse attacks. Record unresolved provider/base-image evidence explicitly. No customer data before the relevant isolation proof passes. |
| AH-04 Canonical program execution | Governed executor adapters | AH-01–02; applicable E1–3 | Execute approved acquire/compute/sandbox/render and bounded model/review nodes with per-boundary reauthorization, input/output validation, current cost admission and exact checkpoint/effect recovery. Fixed steps rerun without replanning. Denial, timeout, cancellation and unknown dispatch remain distinct. |
| AH-05 Deployed sandbox certification | Runtime/release and independent security review | AH-02–04, AH-13 storage/isolation subset | Deploy the exact controller/profile to certification with private ingress and durable volume; prove one bounded read-only workload, restart/cleanup, persistent output after destroy, compute limits, current authority and actual placement. Produce an independent runtime certificate. Production admission remains disabled until the reviewed release includes its exact scope. |
| AH-06 Human publication and placement | Existing presentation owner | AH-00; AH-01 for program bindings | Extend the current draft owner with authorized immutable publish/activate/revert and the minimum approved output/run component metadata. Human author saves/reopens, previews, publishes and reverts a report placement; stale edits, personal/team/org scope and cross-tenant denial pass. No second placement registry or renderer. |
| AH-07 Program certification and catalog UI | Existing certification owner and web renderer | AH-01–02, AH-04, AH-06; AH-13 access subset | Catalog, typed run form, durable progress/output, version/fork/publish/disable controls; certificate pins graph/code/runtime/IO/contract/dependencies. Changing any pin requires compatibility review or recertification. Human and harness-authored drafts share validation/publication; a successful run only nominates a draft. |
| AH-08 First published vertical slice | Accounting/Expenses/Reports adapters and acceptance | AH-05, AH-07, AH-10; applicable E1–5 | Authorized accounting/expense dataset → JavaScript analysis → independently verified bounded evidence → durable report → human-reviewed published program and Reports placement. Destroy the VM, reopen, rerun on fresh watermarks, revert placement and block a revoked/incompatible version. |
| AH-09a Commercial module cohort | CRM/Sales/Purchasing owners | AH-08 | Implement the three matrix proofs using the same run/form/output/version components. Each has exact source links, empty/denied/partial states, current scope, replay safety and persisted evidence. |
| AH-09b Subscription cohort | Subscriptions owner | AH-08 | Recorded lifecycle status review with truthful date semantics and exact record links; unavailable facts never become inferred contractual terms. |
| AH-09c Operational module cohort | Product/Warehouse/Fleet owners | AH-08 | Three proofs, with Warehouse first: schema/unit/count distinctions, stock freshness and catalog price provenance; Fleet recorded costs/manual mileage. No new business-effect path or hidden module activation. |
| AH-10 Observable trace | Existing intelligence/evidence/lifecycle owners | AH-00; AH-01–02 for new durable references | Append bounded typed facts, factors, alternatives, uncertainty, source/tool/artifact/outcome refs and provenance onto one correlated trace. Join existing intelligence/provider events rather than duplicate them. Redacted inspector distinguishes provider-reported, deterministic, user and reviewer observations; record loss cannot silently produce a certified run. |
| AH-11 Correction and safe replay | Existing decision-case/lifecycle owners | AH-02, AH-04, AH-10 | First-class immutable corrections and forensic/corrected/current-state replay for the admitted read-only programs. Reuse checked fork/compare operations; show source, claim, decision, output and economics differences. Historical inspection makes zero provider/effect calls; explicit re-execution gets fresh authorization and admission. |
| AH-12 Reviewed procedural memory | Existing knowledge/precedent/promotion owners | AH-07, AH-10–11 | One tenant-scoped versioned TaskRecipe type with source cases, checks, applicability, review, supersession and revocation. Retrieve under current policy/version filters. Compare no-memory, precedent-only and precedent-plus-recipe in non-consequential evaluation with fixed inputs and a bounded budget; publish evidence of benefit or leave the recipe unpromoted. |
| AH-13 Scoped forensics and data lifecycle | Existing audit/trusted-context/storage owners | AH-00; AH-01–02 for new records | Correlate request→program/run→provider/sandbox→artifact→existing business source; add bounded authorized investigation/export. Inventory and enforce temporary dataset, journal, object, model-context and log lifecycles; deletion/legal-hold and integrity canaries cover all new copies. Retain canonical business audit when operational sinks fail. |
| AH-14 Scheduled program binding | Existing trigger/dispatcher owner | AH-07–08, accepted E4; applicable E1–3 | Manual/UTC schedule binding to exact published version, dedicated run-as principal, overlap policy, unique due/run key and bounded period allowance. Schedule records intent only; admitted reactor performs I/O. Missed/duplicate triggers, restart, revocation and pause cannot duplicate work or approve an action. |
| AH-15 Integrated Railway acceptance | Release and independent QA/domain reviewers | Gate A: AH-08, all AH-09 cohorts, AH-13 and applicable external gates. Gate B adds AH-11–12; Gate C adds AH-14. | Matching-head hosted checks, populated upgrade/reconstruction, isolated adversarial/race proofs, served-release verification, real signed-in module journeys, independent review, disable/revert/rollback rehearsal and final evidence index. Record each gate separately; every enabled feature maps to its exact passed gate. |

AH-13 starts with the data classification, region, deletion/hold and access rules needed by AH-02/05/07; its final cross-service investigation proof follows those integrations. This phased dependency does not permit storing new customer copies without a lifecycle owner.

## 7. Execution sequence and first implementation batch

```text
AH-00 current baseline and external handoff
  ├─ AH-01 contracts → AH-02 persistence → AH-04 executor
  ├─ AH-03 synthetic Railway isolation → AH-05 deployed certification
  ├─ AH-06 human publication/placement → AH-07 program catalog/certification
  └─ AH-10 trace + AH-13 lifecycle/security foundations
                        ↓
AH-08 Accounting/Expenses report, publish, destroy, reopen, rerun
  ├─ AH-09a/b/c ten-module coverage
  └─ AH-11 correction/replay → AH-12 reviewed recipe and evaluation
                        ↓
AH-15 Gate A/B release and served acceptance
                        ↓
AH-14 optional scheduled-report Gate C
```

The first batch is AH-00, AH-01, the synthetic portion of AH-03, the existing human draft/publication gap in AH-06, and AH-10/AH-13 contract design. Finish reviewable contracts and reserve the producer/release lane before dependent API/UI work. Implement the first vertical slice before replicating module adapters. Source work that does not require provider execution can progress while external acceptance or Railway entitlement is pending.

Keep changes bounded by canonical ownership. This plan assigns engineering responsibilities; it does not start additional sessions or assign agents. Re-estimate package size after AH-00 and split large rows. Old cumulative session estimates are not an Alpha delivery forecast.

## 8. Contracts, authority and cost rules

1. **One executor and run identity.** A WorkProgram is a versioned composition consumed by the existing governed runtime. Add missing typed node adapters and durable metadata there; do not build an independent loop, scheduler, workflow state machine or business authority.
2. **Immutable executable identity.** Pin graph, code, IO schemas, generated capabilities, application contract, runtime/profile and review policy. Program drafts, runtime certification, skill release and presentation activation are distinct identities and permissions. Certification grants no runtime authority.
3. **Current scope at every protected boundary.** Recheck actor/service membership, company, fields, capabilities, policy/placement generation, program compatibility and source validity at acquisition, materialization, dispatch, resume, output delivery and replay. A saved artifact never carries historical access into the present. Initial runs select one company; an organization-wide aggregate requires separately authorized acquisition for each constituent scope.
4. **No second money authority.** Consume E1/E6 and existing reservations/provider attempts. Do not reset budget on rerun, review, replay, month rollover or provider switch. Sandbox CPU/memory/time/concurrency/output/storage limits are additional resource admission. CPU-time reservation units are not proven Railway invoice prices. AH-00 must record whether the approved USD 10 shared allowance includes compute/storage; until a reviewed monetary bound and canonical admission integration exist, funded customer sandbox execution remains blocked. Synthetic work gets an explicit finite operator budget. No package silently raises the allowance or sponsors credit.
5. **Evidence is the data boundary.** Opaque handles and approved schema metadata reach the model; raw datasets, credentials, SQL and storage paths do not. Bound disclosure and source access, verify calculations independently, retain units/currency/basis/watermarks, and show partial/stale/missing evidence. Shape validation alone does not establish factual correctness or privacy.
6. **Effects stay with domain owners.** Alpha programs produce read-only results or nominations to existing draft/proposal flows. They cannot post, pay, move stock, renew or approve. Historical replay never repeats effects; uncertain provider/compute outcomes retain their identity/holds until reconciled.
7. **Publication uses the shared presentation path.** Complete human publication before harness-authored placement. Persist data-only references to approved components and immutable program versions; no arbitrary JavaScript/HTML/SQL in presentation definitions. Page render and artifact open are free of implicit program/provider dispatch.
8. **Durable output is separate from scratch.** Canonical metadata participates in existing persistence/projection/reconstruction; protected artifacts use an existing storage abstraction with verified lifecycle and region. The controller journal cannot become a second ERP database, permanent dataset archive or artifact publication authority.

## 9. Acceptance matrix

Use existing native, gateway, controller, migration and browser owners; extend them for changed behavior. Keep source tests, local/synthetic tests, hosted CI, deployed certification and live user acceptance as distinct evidence classes.

| Scenario | Required evidence |
| --- | --- |
| Compile/version admission | Invalid graph, unresolved capability, changed hash/schema/profile, stale publication and incompatible contract reject before provider or sandbox dispatch. Revert changes active placement/version, not history or money. |
| Isolation and scope | Two actors and at least two organizations/companies with independent grants; forged actor/context, denied fields, expired handles, mid-run revocation and tenant A→destroy→tenant B reuse disclose no unauthorized data. Same-actor company switching is not the second-actor proof. |
| First vertical and module coverage | Persisted exact run/version/output/source IDs for every module matrix row. Deterministic expected results, correct units/basis, useful review, empty/partial/denied states and direct authorized source links. Missing adapters remain visible blockers. |
| Destroy/restart/reconstruct | Destroy the VM and restart controller/gateway; recover exact state/output. Reconstruct in a disposable target from canonical durable records and objects; immutable history and artifact hashes agree. Lost dispatch/upload/settlement replies reconcile without another execution. |
| Output correctness | Compare bounded analysis to an independent native/test oracle, including mixed currency/UOM rejection, missing data, zero, stale stock, missing receipt evidence and unavailable Fleet history. A failed independent review remains review-required. |
| Human and harness authoring | Save/reopen draft, concurrent stale edit, denied publication, independent certification, publish/disable/revert, revoked read and incompatible dependency. Both authors use the same validator and exact version identity. |
| Cost and fairness | Isolated concurrent runs across both companies cannot evade their accepted shared allowance or compute ceiling. Explicit replay/review/rerun reserves again; unknown outcomes retain holds. Interactive reads remain usable when compute is saturated. |
| Correction and memory | Original trace stays immutable; corrected/current replay exposes changed inputs/results and fresh economics. Recipe promotion needs an independent reviewer and compatible evidence; revocation blocks subsequent retrieval. Negative/no-improvement evaluation is recorded honestly. |
| Forensics and lifecycle | Trace one run across services by IDs/hashes without raw payload logging. Denied investigators see no content. Dataset expiry deletes materialized bytes; artifacts follow policy/hold; logs/journal/exports have tested lifecycles. Integrity checks detect an intentional gap in an isolated fixture. |
| Scheduled increment | Dedicated principal, version pin, duplicate/missed/overlapping due events, pause, revoked binding, exhausted allowance and dispatcher restart all retain one exact outcome per accepted occurrence. No schedule inherits human approval. |
| Web and release | Real authenticated runs at 390px/1440px plus keyboard/focus; changed shared controls retain 320px/768px coverage where applicable. English Alpha is the target with existing localization policy. Report/correction/version controls survive reload and company change. AI/compute failure leaves ordinary ERP work available. |

Use an isolated Railway lane for destructive, concurrency, network-escape and actor-revocation tests. Production acceptance is a bounded, explicitly admitted owner workflow using preserved farm data; a read-only report may create run/artifact records, which must be recorded separately from business writes. Record private tenant/actor IDs, source facts, screenshots, receipts and any sensitive output outside Git; commit sanitized manifests and reproducible commands/hashes.

The controller baseline checks are `npm test` and `npm run acceptance:synthetic` under `sandbox-controller` with Node 24. They prove local runtime/recovery behavior, not deployed VM isolation. Required changed Rust/native/frontend tests and full matching-pin CI are determined by the packages implemented. A documentation-only planning change does not run or claim those runtime checks.

## 10. Ordered release, rollout and rollback

1. Reconcile the source and served candidate with the other session; record external gate evidence and exact contract/catalog pins. Produce additive durable changes, populated upgrade and reconstruction evidence. Never rewrite a released migration or generated artifact.
2. Extend the existing digest-verified ordered release to build/package the controller and probe its private readiness, profile hash, schema compatibility and recovery storage. Preserve the shared release lock and one revision across application services. Controller/runtime certificate admission is an additional gate; generic health is insufficient.
3. Deploy to the isolated certification environment first: dependencies → native module → PG migrations → API/projection/workflow and controller → AI gateway → web/edge, with dependency-specific readiness checks. Use no production credentials or tenant snapshots by default.
4. Complete actual provider isolation, persistence, monetary/resource admission and user-workload certification. The current hard production fence stays closed until a reviewed source admission change pins the certified runtime/profile/target and applicable program releases. Environment variables and UI feature flags cannot manufacture a certificate or bypass the fence.
5. Release the compatible candidate through `Release main to Railway` / `Release Railway stack`, including explicit controller integration, rather than ad-hoc deploys of individual directories. Observe terminal `SUCCESS`, exact image digests/OCI revisions, migration/publisher completion and served-release/readiness readback.
6. Admit the first organization/company and exact program version with default-deny capabilities. Complete AH-08, then admit the module cohorts only with their own evidence. Retain the profile's bounded module list and source-read authorization. Keep schedule activation separate at Gate C.
7. On failure, disable new starts/publication/placement for the affected version and allow existing reconciliation/settlement and authorized artifact inspection. Preserve unknown-effect holds. Revert presentation activation or select a prior compatible certified program; roll application images back only with a complete schema-compatible digest set. No destructive migration rollback or ledger reset.
8. Rehearse pause/disable/revert, credential/runtime revocation, missing artifact storage and partial rollout in certification. Record owner, recovery command/readback, retained state and rollback limits before production promotion.

The evidence index must include source SHA, contract/catalog, program/graph/code hashes, runtime/profile/controller image, certificate/reviewer, selected provider/region, dataset watermark/schema, run/event/output IDs, object hashes, cost reservations/settlement, actual tests and deployment results. A blocked case stays blocked; a disabled feature is containment, not completed roadmap scope.

## 11. Later milestones and explicit Alpha deferrals

| Broader gap | Alpha delivery | Later milestone and prerequisite |
| --- | --- | --- |
| WorkPrograms and UI convergence | All ten scoped read-only proofs, reusable version/publication, existing-module report placement, safe replay and one reviewed recipe. | General import/document workflows and consequential program steps after their domain/certification gates; native/mobile execution UI after the web proof. |
| ProgramWorkspace | Inspect pinned code/version/output and submit a new reviewed draft through normal UI. | Browser PTY, filesystem editor/diffs, CLI, warm pools and collaborative live workspaces after sandbox isolation and explicit session/TTL/audit certification. |
| Runtime/provider expansion | Pinned JavaScript/QuickJS on Railway. | Python/scientific libraries, richer documents/spreadsheets, Daytona or another provider only when the workload justifies a separately certified profile/provider. |
| Learning | Scoped explanations, corrections, read-only replay/comparison and independently reviewed TaskRecipe retrieval/evaluation. | Candidate-runtime replay at scale, automated pattern discovery, deterministic graduation and organization-wide learned behavior after outcome/counterexample and shadow-evaluation evidence. |
| Forensics/security | Correlation, bounded investigation, integrity and copy/retention/deletion proof for this new Alpha path. | Full repository-wide forensic capture, regulated-residency tiers, offline convergence and broad legal-hold/backups certification retain the parent plans' wider gates. |
| Specialists/extensions | Existing single-agent graph and approved typed adapters. | Parent/child delegation with shared budgets/cancellation and typed lifecycle extension ABI need separate ADVAI/M8/M9 admission. No generic hooks or outside-agent MCP execution surface. |
| Model refinement | Reviewed cases and evaluation results remain attributable and access controlled; production data gains no training permission. | Training Data Gateway, consent/deletion lineage, immutable datasets/benchmarks, ranker/SFT/adapters, model registry and shadow/canary promotion follow the [model-refinement plan](model-refinement-dataset-plane.md). |

These deferrals remain on the broader program register. Gate A/B completion cannot be reported as full WorkProgram/sandbox, organizational-learning, forensic or model-refinement completion.

## 12. Immediate handoff

Start AH-00 against fresh main and Railway readback, obtain E1–6 owner/interface status, and freeze the minimum manifest/run/output contract. Then implement AH-01 plus synthetic AH-03 and the missing human publication foundation. Keep actual customer sandbox execution blocked until entitlement, enforced isolation, compute-money admission and independent certification are demonstrated.

The first concrete acceptance target is: **run the Accounting/Expenses report, publish its immutable version into Reports, destroy the sandbox, reopen the exact output, and rerun against fresh authorized data without replanning or losing provenance.** Warehouse is the next dataset-semantics proof; the remaining module cohorts, correction/replay and reviewed memory complete the scoped Alpha target.

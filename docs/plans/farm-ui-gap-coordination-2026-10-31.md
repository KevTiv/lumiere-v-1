# Farm UI gap coordination plan

Status: **Planned. Source fixes, deployment and live acceptance have separate gates.**

Close the defects found during the original-file farm rehearsal and the later
Railway AI run. First finish the existing farm repair PR. Then repair AI scope,
run inspection and document status. Complete the Mugisha naming work and repeat
the failed operator paths against the served release.

This plan does not start implementation, publish contracts, deploy services or
activate a skill. Owners below are workstream roles. They are not claims that
agents or people have been assigned.

## Verified starting point

Checked on 2026-10-31:

- Current main is `1b842603d950c6c94bb91c845c4cfbe5f8c5e1ec`. The preceding live
  run verified that served revision, contracts `0.3.159` and application catalog
  `32`. Check the served images and catalogs again before each acceptance run.
- [PR #340](https://github.com/KevTiv/lumiere-v-1/pull/340) is open and draft.
  Its current head is `ec3dad26545c8d27765f9456ba62c0c100362438`. The latest eight
  workflows, including [CI run 41225611774](https://github.com/KevTiv/lumiere-v-1/actions/runs/41225611774), report `action_required`. This is not a green gate or proof of a
  failing test. The coordinator must inspect the GitHub reason and resolve it
  through the normal workflow controls.
- PR #340 contains source fixes for company save recovery/session refresh,
  product and location source details, product cost/sale status, prepared location
  import without AI, and optional checksum decoding. Those fixes have not passed
  deployed acceptance. Earlier local test totals do not certify its newer head.
- The original farm company already has the 15 source documents, 22 original
  products, five locations and 93 accounting drafts. It has 838 unresolved review
  rows. The test company has 15 registered source documents and one explicitly
  approved inactive product reference. Indexing completion remains unproved.
- The approved paid AI test used the original company because the test company
  has no matching agent binding. One run persisted five steps and four settled
  provider attempts. It stopped at `agent_settled` after independent review.
  This is not a completed run. Its exact IDs, request keys and spend are private.
- The original products, drafts, review batches and documents matched their
  saved baselines after the AI test. No new accounting draft or posting resulted.

The original and test companies are in the same organization. The product
catalog is shared at organization scope. A test company does not isolate catalog
writes. Reuse the approved inactive test product and inspect exact record IDs.

## Work packets and owners

| Packet | Priority and owner | Scope and dependency | Exit check |
| --- | --- | --- | --- |
| F1 Existing farm repairs | P0; farm UI owner | Finish PR #340 at its actual current head. Resolve workflow state and the unexecuted full API test gate. | Required checks pass at the exact head; company recovery, product/location details and deterministic location import pass after deployment. |
| A1 AI company scope | P0; query/authorization owner | Repair the AI-agent company projection and both analysis selectors. Coordinate shared generated outputs with the release owner. | Matching company sees the agent; another company cannot select it. Missing or redacted binding is unavailable, not organization-wide. Explicit null is allowed only under the existing organization-wide agent rules. Server rejection remains enforced. |
| A2 Run lifecycle and usage | P0; AI runtime and module owners | Diagnose lifecycle table visibility and repair the run usage counter. A1 can proceed independently. Contract scope is a discovery gate. | Authorized exact-run inspection works; stale continuations and wrong scope are rejected. Wait-state token usage agrees with provider records, with run state and spend unchanged. |
| D1 Document indexing state | P1; document/API owner with AI spend owner | Build on F1 checksum decoding. Connect receipts to the canonical worker result for the exact document version and checksum. | Saved, registered, queued/running, completed, failed and unavailable states are distinct. Retry and lost replies do not upload or register again. A real terminal state is read back. |
| N1 Concrete names | P1; Products/review UI owner | Expose the existing category update operation. Add a scoped review display-label operation only where the current owner lacks one. | Names persist after refresh; record IDs, category links, source hashes, original filenames and source facts remain unchanged. |
| A3 Finance skill eligibility | P1; AI certification owner | Show tenant release/readiness in the UI. Prepare certification of the five advisory skills only after A1/A2 and suitable evidence are available. | Ineligible skills have a clear reason and no paid dispatch. A skill is usable only after its exact version has an active certified tenant release. Activation is a separate approval gate. |
| V1 Live recovery and isolation | P0 for final acceptance; acceptance coordinator | Recheck deployed F1/A1/A2/D1/N1. Use an isolated fault environment for destructive failure scenarios. One UI writer. | Exact receipts, IDs, scope denials, recovery and spend reconciliation prove each case. Unexecuted cases remain blocked. |
| H1 Mugisha handover | P1; farm data owner and acceptance coordinator | Follow verified F1/N1; include D1 only when indexing is actually accepted. | Original source data is accessible under concrete labels; original records reconcile; unresolved rows, created references, accounting drafts and posted records are reported separately. |

## Implementation boundaries

F1 stays in PR #340. Do not add unrelated AI work to that PR or overwrite its
newer remote head from an older local checkout. Recheck the diff and hosted
results. Its known local disk limit is an environment issue, not a test pass.
Execute the required API tests in a suitable environment and report the result.

For A1, start at `crates/stdb-auth/assets/resource_registry.json` and
`crates/stdb-auth/src/field_policy.rs`. The two consumers are
`frontend/web/app/(modules)/ai-harness/report-analysis-panel.tsx` and
`finance-review-panel.tsx`. Preserve company scope in default and restricted
projections. Test absent, redacted, explicit-null, matching and different-company
bindings. Generate shared artifacts from the canonical owner; do not patch
generated contracts by hand or broaden the agent binding to make a test pass.

For A2, start at `ai-gateway/src/routes/run_lifecycle.rs`,
`ai-gateway/src/orchestrator/run.rs` and `skill_loader.rs`. The runtime SQL check
reported that `ai_run_lifecycle_state` did not exist or was private. Establish
which case applies, using the deployed module and intended reader identity.
Do not assume a missing table, invent a continuation, or grant general database
access. Retain acting-user checks and the `ai.run.lifecycle` capability boundary.

The observed usage mismatch is zero run tokens versus 6,622 provider tokens.
Check the canonical meaning of the run counter and the available update/read
owners before choosing a repair. The current wait-state call accepts status,
while terminal completion writes totals. Do not complete a waiting run to fill
its counter, book spend again, or replace unknown usage with zero. If the owner
needs a schema or reducer change, prepare that change with its generated contract
and compatibility tests through the module release lane. Confirm the required
contract version during this work; do not preselect a version number.

For D1, start at `api-server/src/evidence_ingestion.rs`,
`document_upload_receipts.rs`, `frontend/web/lib/use-document-upload-receipts.ts`
and `frontend/web/components/document-upload-receipts.tsx`. The existing receipt
status reads queue-admission markers; a queued marker cannot prove worker
completion. Correlate terminal status to the original immutable version, not the
newest document. Keep current visibility checks. If a canonical worker status
owner is missing, specify the bounded contract before implementing UI success.
Keep upload and registration receipts intact during retry or worker failure.

The existing Mistral pilot excludes indexing/embeddings, OCR and unrestricted
chat until they use the same approved spend admission. Check that boundary
before a real indexing retry can incur provider cost. Read-only status work and
an isolated worker/provider fixture can proceed independently. An isolated
fixture proves fault handling; it does not prove indexing of the live files.

For N1, reuse `useUpdateProductCategory` in
`frontend/packages/query-hooks/src/hooks/inventory/products.ts` and its existing
`update_product_category` operation. Add exact authorized readback before showing
a saved result. Categories are shared by the organization. Rename the intended
category by ID; do not create a replacement category or relink products.
For review batches, keep an editable display label separate from immutable
source evidence if the current batch title is immutable. Preserve creation
identity and content-hash deduplication. Retain edited text on a failed save.

Use these concrete display names for the alpha company:

- Shop product references, replacing the current category label.
- Shop audit sheets.
- Product price references.
- Customer sales records.
- Staff references.
- Shop balance snapshots.

Display a date or source period only when the source establishes it. The name
change must not turn an old price into a current price, a balance snapshot into
an open receivable, or an inventory count into current stock.

For A3, distinguish eligibility UI from certification work. The five skills are
`finance_report_review`, `bank_reconciliation_review`, `period_close_review`,
`expense_evidence_review` and `finance_variance_review`. An owner role or provider
key does not supply a certified release. Show the missing prerequisite before
dispatch. Prepare exact-version certification evidence and source hashes before
requesting activation. Do not recreate the revoked temporary administrator.

## Coordination and release order

1. The coordinator records the current main, PR heads, release state and private
   baseline. Inspect why PR #340 workflows require action. Resolve only the
   current-head workflow gate; do not rerun the obsolete `0edda6b` release.
2. Finish F1. A1, A2 diagnosis, D1 design and N1 source work can proceed in separate
   branches. Use `codex/` branches and isolated worktrees for code fixes. Agree on
   shared registry, contract and translation changes before integration.
3. The coordinator alone integrates generated artifacts, immutable contract pins
   and migration catalog changes. Preserve released migrations and checksums.
   Add a migration only when the chosen canonical change needs one. Keep A1 and
   A2 in focused PRs unless a shared contract makes one atomic change necessary.
4. Prepare release A from verified F1. Include N1 only if it is independently
   ready; naming must not delay the existing recovery fix. Prepare the exact
   revision, artifacts, required checks and rollback procedure before asking for
   release approval. This plan is not merge or deployment approval.
5. After approval, use the ordered release and verify the actual served web,
   API, gateway and module revisions plus contract and application catalogs.
   Keep the previous compatible artifacts available. Do not reverse a deployed
   data migration or remove saved farm records as rollback.
6. Repeat F1 operator checks. If they pass, continue H1 naming and data readback.
   In parallel, finish A1/A2/D1 and eligibility UI. Release B follows the same
   exact-head approval and served-revision checks; it need not wait for Finance
   activation. Check runtime/certification source hashes after any relevant
   change before allowing a paid run.
7. Run V1 with one UI writer. Use the test company for scoped import writes and
   the original company only for the already approved read-only paid AI path.
   A company switch is not authorization to bind the agent to the test company.
8. Close each packet only from its exit evidence. Finance activation and any
   extra access or environment provisioning require their own concrete reviewed
   setup. Keep blocked items visible while independent packets progress.

The coordinator maintains one register with these columns: packet, owner,
branch/PR and exact head, contract dependency, checks, deployed revision, live
result, blocker and next action. Use `planned`, `source ready`, `deployed`,
`live passed` and `blocked` as distinct states. Move a packet forward only when
the corresponding evidence exists. Do not claim a live pass from CI or fixtures.

## Acceptance and handover checks

| Case | Required result and evidence |
| --- | --- |
| Company setup | Review Rwanda/RWF, units, VAT status and source-data mode; refresh before saving. A saved or lost reply resolves to one company and one request. The new company becomes usable without a manual full reload. Receivable/payable classifications are read back. |
| Product and location details | Reuse the approved inactive product. Verify file, row, source hash, review identity and original cost where present. Create a reviewed location once through the deterministic import. Refresh and recover a lost reply with the same request and exact created ID. |
| Review regression | Repeat partial price confirmation, unchanged numeric values on unit selection, retained exception, history/undo and atomic stale-bulk rejection in disposable review batches. Preserve original unresolved decisions. |
| Document state | Reuse the 15 existing test-company document receipts. Prove a terminal worker result for the exact version. Exercise admission failure, worker failure and lost replies in the isolated lane. Retry without another blob, document or initial version. Show unavailable status when a result cannot be read. |
| AI scope and usage | An unbound company cannot select or execute the agent. Exact-run transcript/lifecycle reads reject another company. Compare run usage with exact provider records and reservations; refresh creates no new provider attempt. |
| Run continuation | Inspect the returned run; exercise interrupt/resume/cancel and stale concurrency rejection through the UI. Verify continuation does not repeat a completed effect or release uncertain spend. Test queued input and fork/restart only in their isolated, approved scope. |
| Spend and faults | Use an isolated environment with labelled test data for 429, timeout, restart, ambiguous provider outcomes and period/budget exhaustion. Test unknown-outcome reconciliation before retry; do not exhaust the production cap or interrupt shared Railway services. Reconcile each attempt and reservation. |
| Another actor | Obtain a legitimate second test actor with reviewed limited access; never restore the revoked administrator. Verify that actor cannot resume the first actor's retained import work. Test revocation and reauthorization in the isolated lane with exact current grants. |
| Finance skills | Before activation, verify clear unavailable state and zero paid dispatch. After approved certification, exercise each activated skill with suitable authorized evidence. Keep empty data, unknown facts and drafts explicit. |
| Mugisha handover | Verify all 15 original checksums and existing source documents. Apply concrete labels after N1 is deployed. Read back the same product/location links and drafts. Report the unresolved queue separately. Do not submit a second original-company seed. |

An empty report followed by `agent_settled` can be a correct review outcome.
Do not weaken independent review to force `completed`. A completed-run claim
requires available evidence for the chosen objective and an actual passing final
review. If the farm company lacks that evidence, record the specific blocked
positive case. Isolated seeded reports remain separate evidence.

Record actor/organization/company scope, served revisions, file hashes, request
and receipt identities, exact created IDs, screenshots, duplicate checks and
spend privately. Keep CSV contents, private receipts and credentials out of Git.
The repository register should contain only source status and sanitized results.

Preserve the original 22 products, five locations and 93 drafts. Confirm zero
unexpected catalog records, postings or stock effects. Keep all 838 unresolved
rows visible until their missing facts are resolved. Report reference creation,
draft creation, posting and AI indexing completion as separate counts.
The existing USD 5 monthly AI cap remains the limit; recheck remaining spend
before a paid case. No budget increase, fallback provider or added paid skill is
part of this plan.

## Follow-up after these gates

The first shipment also lists combined multi-file intake, location mapping,
linked customer/account/journal/totals preview, draft-versus-posted dashboard
summaries and separate historical/current prices. Track these as later product
packets. They must not be implied complete by this repair or by the presence of
the source archive. Choose a bounded next packet after the farm acceptance
blockers close; an unresolved accounting treatment is a data-review task.

Source context: [first shipment](https://github.com/KevTiv/lumiere-v-1/blob/1b842603d950c6c94bb91c845c4cfbe5f8c5e1ec/docs/plans/farm-import-first-shipment-2026-10-31.md),
[organization import](https://github.com/KevTiv/lumiere-v-1/blob/1b842603d950c6c94bb91c845c4cfbe5f8c5e1ec/docs/plans/farm-history-organization-import.md),
[Mistral setup](https://github.com/KevTiv/lumiere-v-1/blob/1b842603d950c6c94bb91c845c4cfbe5f8c5e1ec/docs/plans/mistral-alpha-railway-setup.md), and
[PR #340](https://github.com/KevTiv/lumiere-v-1/pull/340).
Private farm and AI acceptance records remain the evidence for the observed
results; older harness certification does not certify this tenant or revision.


## Source integration checkpoint on 2026-10-31

Integration branch: `codex/farm-gap-integration`, based on main `1b842603`.
This candidate does not include unmerged PR #340. Reconcile with its final head
and rerun exact-head checks after it merges. No source fix below is deployed.

| Packet | Source commit(s) integrated | State and remaining gate |
| --- | --- | --- |
| F1 | External PR #340 | Separate CI/release lane; not part of this combined test result. |
| N1 | [PR #342](https://github.com/KevTiv/lumiere-v-1/pull/342), `031ba9e13`, `b91853979`, `e6cb3fc70` | Category rename source ready for review. Five resolver and seven Products catalog tests pass. Review display-label operation remains a separate producer task. No live rename. |
| A1 | [PR #341](https://github.com/KevTiv/lumiere-v-1/pull/341), `dcebd51ef`, `d16f440a7` | Scope selector and canonical projection source ready for review. Five selector tests and 91 exact-source authorization tests pass. Code generation and full/deployed checks pending. |
| A2 | [PR #344](https://github.com/KevTiv/lumiere-v-1/pull/344), `14840b9ab`, `b11d5ecef` | Five scoped read views and truthful provider usage candidate. Six observation and four lifecycle model tests pass. Module schema/contract generation, native reader authorization execution and gateway integration remain required. Persisted run counter is unchanged. |
| D1 | [PR #343](https://github.com/KevTiv/lumiere-v-1/pull/343), `82fcd99a0` | Exact worker-result resolver and receipt UI candidate. Nine receipt tests pass. Full API/router execution and live indexing/failure recovery remain pending. Legacy receipts without a job manifest are not declared complete. |
| A3 | `25415ccef` | Contract boundary documented in finance-skill-readiness-admission-contract.md. No session-owned no-cost Finance admission read exists. Positive readiness UI is blocked on that producer; no activation. |
| V1/H1 | None | Deployed acceptance and Mugisha naming/data handover remain pending. |

Combined focused command, run from `frontend/web`:

```sh
node --import tsx --test \
  'app/(modules)/ai-harness/agent-company-scope.test.ts' \
  'app/(modules)/ai-harness/finance-review-model.test.ts' \
  'app/(modules)/ai-harness/run-lifecycle.test.ts' \
  'app/(modules)/ai-harness/run-observation.test.ts' \
  'app/(modules)/inventory/product-catalog.test.ts' \
  lib/document-upload-receipts.test.ts \
  ../packages/query-hooks/src/hooks/product-category-rename.test.ts
```

Result: **39 passed, zero failed**. The observation test is now registered in the
web unit command. The missing metadata-only question label is in the English
locale; locale JSON has no duplicate keys. Syntax transpilation of the six
changed TSX presentation files passes. These checks do not replace a full type
check or mounted/operator coverage.

All current stdb-auth and policy-core source inputs match the directly compiled
A1 test executable; its 91 authorization tests were rerun and passed. This uses
coherent cached dependencies, not a new full Cargo build. Source-owner isolated
Rust resolver tests remain separate evidence, not a full gateway/API/module pass.
The full web type check has not passed; the coordinator observed unresolved
SDK/dependency errors in the isolated setup. No full module codegen or native
reader authorization execution is claimed here.

The supported `python3 scripts/finance-skill-manifests.py --write` command updated
only proposed report/Finance manifests and the development report seed binding.
`--check` then passed on this combined source. This is not tenant registration or
certification. Final release source hashes must be regenerated again if PR #340
or another source dependency changes the candidate. The A2 module views require
an immutable contract release and aligned generated outputs before deployment.
Keep compatible runtime artifacts and block readiness when the required reader
or released views are unavailable.

Independent source review corrections are integrated: A1 now rejects agent IDs
and company selections outside the Number dispatch range, including string and
bigint inputs. Organization comparisons remain exact. N1 uses a form epoch so a
late reply cannot close a newer form after close/reopen or a scope change. The
rename modal disables its default auto-close and success toast; only exact saved
readback in the current form epoch closes it. A mounted async modal regression
remains required; resolver tests and syntax checks do not certify that UI race.

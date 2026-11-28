# CSV onboarding delivery plan

**Status** In implementation. The saved-task, preparation recipe, and historical
expense journal delivery is described in the
[implementation and acceptance notes](./import-backfill-implementation.md).
This plan covers CSV intake through verified records in the normal ERP modules.
It builds on the
[agent sandbox import plan](./agent-sandbox-import-onboarding-plan.md).

## Finance Alpha import coverage

The [machine-readable register](../../frontend/web/lib/alpha-import-coverage.json)
audits the Wave 4 stack at `9557d1e6`. It records each entry point, its format
and visibility conditions, the native implementation and scope, saved-task
support, and served-build evidence. The [discovery types](../../frontend/web/lib/alpha-import-discovery.ts)
provide the same read-only data to consumers. Run
`node --test scripts/tests/alpha-import-coverage.test.mjs` to check the complete
workspace profile, Settings keys, module CSV actions, and code anchors.

- **Discovery.** A Finance Alpha surface or wizard key only controls where an
  operator can find a flow. Some imports are confined to a module toolbar or
  specialized form. For example, lots have a native registration and client
  handler, with no action that opens the handler on the audited surface.
- **Admission and authority.** The [native import registry](../../api-server/src/routes/import.rs)
  distinguishes organization-only, organization-plus-currency and company
  reducer arguments. Tracked requests also bind a company and check the
  importing actor. CRM contact, lead and opportunity submission requires the
  server's opt-in even when a module or wizard displays the action. Farm
  discovery needs the selected company's Farm Operations pack and current
  farm read permission. The farm import page also checks create access for
  intake. The historical-document replay entry requires create access on
  entries and lines, entry write access, payment-transaction read access and
  reconciliation creation, plus callable replay capability.
- **Saved tasks.** The [server catalog](../../api-server/src/routes/import_reviews/capabilities.rs)
  distinguishes execution, reviewed record operations, native preview and
  evidence-only destinations. The [task routes](../../api-server/src/routes/import_reviews/tasks.rs)
  control original access and the explicit named handoff. A document intake
  clerk can use the authorized document flow. The source review and
  workflow endpoints still enforce [full administration and company scope](../../api-server/src/routes/import_reviews/mod.rs).
  Held operations include their current recovery paths. They have no
  execution action in the discovery data.
- **Served evidence.** Each audited operation starts as `unverified` for
  this baseline. Repository, hosted CI and historical pilot evidence below
  remain reference material. Operation-level release proof requires an
  identified served revision and exact authorized result links.

### Earlier Alpha operation register

Baseline checked on 15 November 2026 at
[main `4e37059c`](https://github.com/KevTiv/lumiere-v-1/commit/4e37059c0b6b7841b0b9129a736a7896770f68bf).
The Alpha profile at this revision has 18 surfaces. Track merged code, hosted
checks, and verification on the served build for each operation.

| Operation or surface | Repository evidence | Served verification or pending gate |
| --- | --- | --- |
| Assistant CSV/XLSX intake, Settings resume | Existing company-scoped saved tasks, immutable originals, preparation and grouped review. This increment saves explicit chat intent or starts inspection on drop, then uses the same task to prepare. | Reopen in a second chat and device. Exercise the deployed gateway and a provider outage. |
| Accounting historical expense journals | Existing task-scoped proposals, draft header and line receipts, and verification in the Accounting workflow. | Run the approved isolated electricity replay and lost-response check. |
| Sales customer summaries and Warehouse/Inventory recorded counts | [#422](https://github.com/KevTiv/lumiere-v-1/pull/422) adds views in the normal modules. The onboarding handoff records pilot readback. This increment discovers these operations in the server catalog and retains verified matches in the task that requested them. | Capture served revision and exact native record links for this increment. Recorded counts are historical observations. Movements and openings need their own native effects. |
| Sales daily shop lines | [#427](https://github.com/KevTiv/lumiere-v-1/pull/427) merged with [green CI](https://github.com/KevTiv/lumiere-v-1/actions/runs/43707330312) and [E2E](https://github.com/KevTiv/lumiere-v-1/actions/runs/43707330083). [#429](https://github.com/KevTiv/lumiere-v-1/pull/429) registers its native owner in the saved import workspace. | Verify the release and exercise the task against the 907 prepared lines. |
| Exact Activity and source revision links | [#424](https://github.com/KevTiv/lumiere-v-1/pull/424) adds scoped exact-record URLs and the saved history drawer. Follow its [hosted CI](https://github.com/KevTiv/lumiere-v-1/actions/runs/43707613029). | [#430](https://github.com/KevTiv/lumiere-v-1/pull/430) preserves the Shop Sales route, observation kind and record ID. Verify the authenticated route matrix. |
| Assistant built-in skill availability | [#425](https://github.com/KevTiv/lumiere-v-1/pull/425) merged. Its [hosted CI](https://github.com/KevTiv/lumiere-v-1/actions/runs/43699798473) passed. | Verify against the served gateway and refreshed company roles. |
| Documents originals and managed versions | [#426](https://github.com/KevTiv/lumiere-v-1/pull/426) merged with [hosted CI](https://github.com/KevTiv/lumiere-v-1/actions/runs/43702073289). Listed documents open in their owning company. | Add explicit version selection at import intake and authorize the same version on readback. |
| Products, CRM contacts, Warehouse locations | Existing native previews with saved import job receipts. | Match exact saved rows and prove native duplicate and permission handling. CRM leads/opportunities and product prices require separate operations. |
| Purchasing, employee Expenses, Fleet, Subscriptions | Native historical operation coverage is pending. Shop operating spend uses the Accounting operation when its evidence supports that effect. | Add native adapters and exact readback for each operation. |
| Reports, Overview, Tasks, Approvals, Calendar | Existing workspace surfaces. Import-specific projections and native follow-up operations are pending. | Reconcile native counts and totals. Bind follow-ups and approvals to the exact saved task and group. |
| Farm Batches | [#428](https://github.com/KevTiv/lumiere-v-1/pull/428) adds company-scoped farm imports behind its own admission. Follow its [hosted CI](https://github.com/KevTiv/lumiere-v-1/actions/runs/43709541745). | Integrate the native farm owner through the shared registry after merge and verify processing, costs and exact stock/valuation readback. Coordinate PostgreSQL migration sequence when merging. |

### Shop Sales acceptance fixture

The local proofs cover different boundaries of the saved import path.

| Check | Evidence |
| --- | --- |
| Original workbook preparation | [CLI fixture](../../scripts/tests/test_shop_sales_workbook_acceptance.py) reads two selected worksheets with English, French, and Kinyarwanda wording. Three traceable sale lines total RWF 45,500.50. The fixture retains a RWF 0.01 subtotal difference, holds a line whose quantity and price disagree with the amount, and preserves two distinct source rows at the same physical row number on different sheets. |
| Chat and Settings continuation | [Browser fixture](../../frontend/web/tests/chat-import-ui.spec.ts) previews Shop Sales, approves the ready rows, and reopens the exact results in another chat. Simulated HTTP receipts exercise the real chat and import components, including an already-present record and a Sales link with the exact record ID. |
| PostgreSQL identity and scope | [Import review storage tests](../../api-server/src/routes/import_reviews/postgres_tests.rs) cover worksheet-aware identity and replay, preservation of legacy source matches, and confirmed stable sale-line references for changed exports. Run with `C4_TEST_PG=1` and the disposable PostgreSQL configuration from CI. |

Deploy the worksheet-aware writer and migration 51 together. The migration
replaces the previous four-part source constraint, which the earlier writer
names as its `ON CONFLICT` target. Pause Sales and Warehouse backfill writes
during the cutover. A rollback also needs the compatible database schema or the
worksheet-aware writer. Restoring the previous constraint after accepting data
from multiple worksheets can fail when worksheets share a source row number.

The signed-in pilot remains pending. Its target comes from the prepared source
lines below.

| Shop | Source lines |
| --- | ---: |
| Kicukiro | 11 |
| Kimironko | 275 |
| Nyabugogo | 185 |
| Zinia | 436 |
| Total | 907 |

An earlier disposable PostgreSQL run saved 907 synthetic lines totaling RWF
29,477,500 and matched all 907 on replay. The pilot acceptance target is
**RWF 71,406,345.45**. On the served release, confirm company and workbook scope,
check the ready and held groups against the original sources, and approve the
ready Shop Sales rows. Reopen from chat or Settings and check products, sale
dates, quantities, unit prices, exact amounts, and source sheet and row references
in Sales. Count each saved or matched record once. Run the exact-file replay and
a changed-export replay where stable sale-line references are available. Keep
rows with uncertain same-event identity for review. Verify zero duplicate sales
and zero additional ledger and stock effects. Record the served revision, exact
record links, verified totals, and remaining exceptions here.

## Scope

Every uploaded file gets an intake result. Every source record the system can
identify gets an explanation and a next step. Valid data proceeds when the target
module supports it and the required facts are known. Other data can stay as
evidence, wait for a decision, or receive a precise rejection. This gives unfamiliar
files a defined path through the system.

Use the existing import task, file storage, mapping preview, source review, and
native import operations where they meet the requirements below. The sandbox
handles inspection and preparation. The owning ERP module validates and writes
records. Extend each part at its existing boundary.

## Cases the harness must handle

| Source case | Required behavior |
| --- | --- |
| Standard CSV and common variants | Detect supported encodings, byte order marks, delimiters and line endings. Handle quotes, escaped quotes, empty cells, and multiline fields. Show a sample and allow an override when the format is uncertain. |
| Broken or unreadable file | Locate malformed quotes, corrupt bytes, unsupported encoding, truncation, or invalid record shape. When the parser can establish record boundaries, isolate the bad records. When boundaries are uncertain, hold the affected region and ask for a corrected export. |
| Oversized, mislabeled, or unsafe file | Check file type and apply published limits for file size, record size, column count, and processing time. Explain re-export or split options. Apply existing safety rules to formula-like cells and treat instruction-like text as untrusted source data. |
| Several tables in one file | Identify report titles, repeated or stacked headers, side-by-side tables, blank sections, subtotals, totals, and notes. Show proposed section boundaries. Let the operator adjust a boundary and preview the affected records. |
| One table across several files | Group files by layout and business scope. Match explicitly mapped keys. Surface missing companions, repeated extracts, and ambiguous joins. Keep the original file and record references after combining data. |
| Flat, wide, and parent-child exports | Support direct mapping, unpivoting periods or product columns, and assembling headers with lines. Preview one-to-many and many-to-one mappings. Hold unmatched children or unresolved parent conflicts. |
| Local formats and quantities | Distinguish blank, zero, and explicit null. Preserve identifiers with leading zeros. Parse date and number formats, currencies, signed values, units, and exchange rates only when established. Keep kilograms and pieces separate without a documented conversion. |
| Ambiguous labels and references | Suggest product aliases, shop locations, account codes, and localized terms from bounded evidence. Prefer stable external IDs. Require a decision for conflicting identities or uncertain matches. Use ERP references from the selected company. |
| Totals, snapshots, and notes | Keep report totals as controls when detail already covers them. Distinguish opening balances, stock counts, period summaries, and transaction detail. Notes about payment methods, credit, or old debt retain their wording and evidence status. |
| Duplicate, overlap, correction, or conflict | Distinguish identical bytes, repeated business records, overlapping report periods, conflicting versions, and legitimate repeat transactions. Compare by target-specific keys and scope. Use the module's supported correction workflow when prior ERP records need changes. |
| Incomplete or unsupported business data | Save supported facts with their source trace. Show the missing fact, permission, reference, or module operation. Process other groups that can proceed independently. |
| Large files, timeouts, and retries | Profile within bounded resources and validate the full write set. Save progress by batch. Recover after interruption or a lost response using saved receipts. Recheck scope and current ERP state before continuing. |

For a file that cannot be parsed safely, report the affected byte range when
possible. For a parsed file, account for every logical record, including blank,
structural, duplicate, excluded, and blocked records. A quoted line break stays
within its logical record. A row with several business facts can have several
outcomes. Keep source coverage separate from native record counts.

## Tenant decision workspace

Start from a saved import task. Show the selected company, files, detected
sections, date range, and progress. Group questions by the action the operator
can take. The same fact can resolve many rows when the evidence and scope match.
Show the exceptions before applying the decision.

| Decision | Evidence shown | Action |
| --- | --- | --- |
| Choose how to read the file | Raw sample, proposed header and sections, affected record count | Accept or change the format or boundaries |
| Map a meaning or ERP reference | Original wording, proposed value, sample rows, and current ERP match | Confirm for the shown scope, change the value, or hold exceptions |
| Resolve duplicates or conflicts | Versions side by side, overlapping dates, proposed match, and any existing ERP record | Keep a version, mark a duplicate, confirm separate events, or hold |
| Supply a missing fact | Known fields and the exact missing field, with affected records and destination | Supply the fact, retain partial confirmation, or hold |
| Create native records | Company, module, date range, validated draft count, totals by currency, and exclusions | Approve the ready group |
| Verify completion | Actual counts, amounts, ERP IDs, skipped records, and retryable failures | Open the normal module at the imported period or retry the affected batch |

Save decisions with the evidence, scope, and revision they apply to. Reject
stale changes and explain what changed. Let the operator revise a decision before
execution. After a write, use the module's correction operation and keep the
original receipt. Make **Confirm source facts**, **Create drafts**, and **Post**
separate actions. Posting follows the owning module's approval flow.

## Reconciliation and execution

1. Keep the original bytes, content hash, file version, section, logical record
   and cell references. Preserve the original value and the rule that produced
   each normalized value. A recipe applies only to its approved layout and scope.
   A changed layout or conflicting value triggers a new review.
2. Reconcile against other files and existing ERP records before preparing the
   write set. A file hash identifies an exact copy. A target-specific business key
   and the prior receipt identify an imported record across changed exports.
   Compare control counts, quantities by unit, and totals by currency and period.
   Show every unresolved difference or intentional exclusion.
3. Build the proposal from registered ERP operations. For each target, define
   required facts, reference types, company scope, dependency order, duplicate
   rules, supported create or correction operations, and readback. Validate the
   entire approved group with the same business rules used at execution.
4. Bind approval to the proposal revision, company, sources, and expected effects.
   Recheck permissions, dependencies, and freshness before writing. Save
   execution receipts with actual IDs. Use an atomic native operation for linked
   records where available. Otherwise save each step and its IDs before moving
   to the next one. A retry uses the same operation key and reconciles prior
   effects before it writes.
5. Read back the actual records and dependent lines. Check company, references,
   source trace, date, totals, and draft or posted state. Mark completion only
   after verification. Link to the ordinary module with the correct company and
   imported dates selected.

## Delivery order

1. **Prove one complete Accounting path.** Use the farm electricity case in an
   isolated company with approved test data. Confirm one scoped meaning, hold an
   overlapping report, approve a ready group, and create native draft journal
   entries. Use the reconciled farm result as the acceptance target for an
   authorized replay: 45 drafts, 90 lines, 735,260 RWF on each side, zero posted.
   Interrupt the write and prove that retry creates no duplicate headers or
   lines. Verify the total in the regular Accounting view.
2. **Expand file preparation and decisions.** Add the input cases above in
   order of evidence from real onboarding. Prove full coverage for mixed report
   sections, uncertain parsing, localized values, and changed files. Ship
   grouped preview, exceptions, and resume as part of the workflow.
3. **Expand native destinations through a capability matrix.** Start from the
   existing product, contact and location handoffs. Add cases for sales and
   purchase documents, expense records, stock counts and movements, opening
   balances, and payments as their owning operations pass validation and
   readback. Enable each record type and operation separately. Use the same
   decision workspace for every destination.
4. **Reuse verified mappings.** Save reviewed recipes for recurring exports.
   Preview reuse on a fresh upload. Detect drift, isolate unmatched records,
   and ask only about differences. Keep tenant-specific meanings and source
   data in their approved scope.

## Release checks

- Maintain a fixture for each case in the table and for combinations that caused
  onboarding errors, such as a changed file that overlaps an imported period.
  Use sanitized farm-shaped fixtures and a clean control file.
- Check source coverage and expected ERP results separately. Verify held facts,
  conflicting records, exclusions, control totals, and source trace.
- Test full-file validation after a clean sample, ambiguous locale, broken
  dependencies, duplicate and changed uploads, stale approval, simultaneous
  retries, and cross-company reference attempts.
- Prove the operator can stop and resume, approve ready work, see the reasons
  for held items, and open the verified records in the normal module. A module
  action is ready only when this path passes for its supported operations.

## First delivery and remaining work

| Area | First delivery | Remaining release work |
| --- | --- | --- |
| File intake | Saved tasks preserve original files and source coverage. Operators can choose explicit section boundaries, side-by-side columns, and header rows. | Add downloadable coverage exports, broader workbook support, and resumable processing above current limits. |
| Data preparation | Explicit locale rules, bounded text transforms, stable source identities, and versioned preparation receipts preserve ambiguous values as evidence. | Add approved joins, unpivot operations, and reconciliation of control totals across files. |
| Decisions and reuse | Immutable recipe versions pin source layout. Repreparing or applying a recipe creates fresh review groups without copying confirmations or ERP approvals. | Add broader competing-version decisions and destination-specific transformation rules. |
| Duplicate and revision checks | Approved source claims prevent repeated effects. Company-wide period/amount comparisons and explicit candidate-bound distinct-expense decisions hold stale or ambiguous overlaps. | Add target-specific reconciliation and correction/supersession for the remaining native destinations. |
| Native Accounting | Confirmed expense facts produce immutable previews, exact approvals, recoverable header/line requests, and company-scoped native readback. | Prove the farm electricity replay and interruption recovery in an isolated company against the live native ERP. |
| Other destinations | Product, contact, and location retain their existing native preview with receipts linked to the saved task. A server catalog explains evidence-only destinations. | Register, validate, and verify the remaining destination operations separately. |

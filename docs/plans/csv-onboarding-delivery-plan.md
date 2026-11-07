# CSV onboarding delivery plan

**Status** Proposed. This plan covers CSV intake through verified records in the
normal ERP modules. It builds on the
[agent sandbox import plan](./agent-sandbox-import-onboarding-plan.md).

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
| File intake | Guided delimiter selection, bounded parsing and source diagnostics. Saved tasks preserve the original files, hold malformed files, and count review, blank, and header records. | Add operator-defined section boundaries, side-by-side layouts, full-file coverage exports, and resumable processing above current limits. |
| Data preparation | Recognized sequential tables get separate review batches. Ambiguous values and layouts remain evidence. | Add explicit locale rules, approved joins and unpivot operations, and reconciliation of control totals across files. |
| Decisions and reuse | Source review separates evidence from eligible import previews. Guided templates saved with their layout trigger a fresh mapping review after column changes. | Add a decision for competing source versions and versioned recipes that include approved transforms and target rules. |
| Duplicate and revision checks | Same-byte files within a selection stay in evidence review. Saved tasks show earlier same-byte and same-name matches in the same company and actor scope. | Reconcile row identity, report overlap, and native receipts across changed exports and multiple authorized operators. |
| Native Accounting | Journal bundle execution uses native receipts and company-scoped readback for headers and lines. | Bind a confirmed expense source group to a typed Accounting proposal and prove the farm electricity replay in an isolated company. |
| Other destinations | Product, contact, and location continue through their existing native import preview. | Register, validate, and verify the remaining destination operations separately. |

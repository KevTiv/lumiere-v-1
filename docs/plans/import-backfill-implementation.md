# Saved imports and historical ERP backfill

## Delivery status

This change connects saved source tasks, preparation rules, source decisions,
Accounting proposals, native import receipts, and chat status. The first new
execution adapter creates historical expense journal drafts. Product, contact,
and warehouse location imports retain their existing native preview and execution
path, with their job receipts now attached to the saved task.

The broader [CSV onboarding plan](./csv-onboarding-delivery-plan.md) remains the
completion contract. This change does not enable every historical ERP destination.
The capability catalog explicitly describes available execution, existing native
preview, and evidence-only destinations.

## Operator workflow

1. Select the company and start or reopen a saved import from Settings or chat.
   The task keeps its original files, file hashes, preparation consent, and review
   groups. Navigation between Sources, Decisions, ERP preview, and Results keeps
   the same task and company.
2. Inspect the source coverage. Choose explicit header and section boundaries,
   mapped fields, number and date formats, and any supported text transformations.
   Repreparing creates a new saved task with fresh review decisions.
3. Confirm the facts that are supported by the source. A known amount and expense
   classification can be confirmed while settlement or another fact remains held.
   Coverage counts describe source records; they are not counts of ERP records.
4. For historical expenses, choose the company journal, expense debit account,
   credit account, and date treatment. A source period is not silently converted
   into a transaction date. Supply a deliberate posting date and accounting reason
   when the source does not establish a transaction date.
5. Prepare an exact preview of up to 200 source rows. Inspect the ready entries,
   balanced totals, source references, and held rows. Similar expense candidates
   show the compared amount, currency, period, posting date, reference, and category.
   Eligible distinct-expense decisions require a reason and generate a new preview.
   Exact source duplicates and matching external references cannot use that override.
6. Approve the exact preview, then create its draft entries. Source confirmation,
   proposal approval, native execution, and posting remain separate actions. The
   import adapter never posts entries.
7. Reopen Results after interruption. A pending preparation retains its exact
   request and inputs. Resume uses the existing approved proposal and native
   request identities. Verify performs readback without dispatching another write.
8. Open the created records in Accounting. Their History and Sources view links
   back to the saved task, proposal, and original file and row. A verified receipt
   describes the state at verification time; normal Accounting shows current state.

For recurring exports, save the prepared rules as a versioned recipe. Apply an
explicit recipe version to a fresh upload, inspect layout drift and coverage, and
confirm the new source facts. Recipes reuse parsing and mapping rules, not prior
approvals, source values, or ERP write authority.

## Responsibilities

| Component | Owns | Boundary |
| --- | --- | --- |
| Saved import task | Original files, consent, company and actor scope, review group membership | A task is not an ERP execution receipt. |
| Preparation worker | Bounded parsing, explicit sections and formats, source coverage, stable identities and layout hashes | Source cells and suggested interpretations are untrusted evidence. |
| Source review | Confirmed facts, reasons and optimistic revisions | Confirmation does not create or post ERP records. |
| Workflow service | Immutable proposals, exact approvals, source claims, overlap decisions and recovery state | Existing native authorization and module validation still apply. |
| Native import service | Authorized writes, stable request receipts and record mappings | PostgreSQL and the native ERP are not a shared transaction. |
| Accounting verifier | Company-scoped header and line readback, amounts, currency, references and unposted state | Completion requires actual records matching the approved proposal. |
| UI and chat | Shared task navigation and bounded authorized status | A chat message cannot supply trusted task state or authorize a write. |

The typed client is in `frontend/web/lib/import-workflow.ts`. The workflow and
capability catalog are in `api-server/src/routes/import_reviews/`. Preparation
rules and the worker are in `scripts/import_preparation.py`; recipe storage is
owned by the API server.

## API contracts

All routes use the existing authenticated organization/company/actor scope.
Numeric ERP identifiers cross the workflow JSON boundary as decimal strings.
Amounts use fixed decimal strings and are validated against currency precision.

| Method and route | Result |
| --- | --- |
| `GET /api/import-tasks/:task/workflow` | Saved proposals, native receipts, and destination capabilities for this task. |
| `POST /api/import-tasks/:task/workflow/proposals` | Immutable preview from exact source revisions and explicit accounting configuration. |
| `GET /api/import-tasks/:task/workflow/requests/:requestKey` | Exact preparation receipt lookup, independent of the bounded proposal list. |
| `POST .../proposals/:id/approve` | Approval bound to the proposal revision and digest. |
| `POST .../proposals/:id/execute` | Execute or resume using the same native request identities. |
| `POST .../proposals/:id/verify` | Read existing native receipts and records without initiating writes. |
| `POST /api/import-tasks/:task/reprepare` | New task and fresh reviews from revised preparation rules. |
| `GET /api/import-recipes` | Recipes in the authorized company scope. |
| `POST /api/import-recipes` | Immutable recipe version from a prepared source task. |
| `GET /api/import-recipes/requests/:request` | Exact receipt for a possibly interrupted recipe save. |
| `POST /api/import-recipes/:key/apply` | New prepared task using an explicit version and source-file bindings. |

Mutations preserve existing permission checks. The capability catalog describes
supported paths; it does not grant access to those paths. The list currently shows
the latest 100 proposals and 20 native receipts. Pending preparation recovery uses
the exact request endpoint instead of assuming absence from either bounded list.

## Duplicate prevention and recovery

Approved source claims bind the file content hash, physical source row, effect
kind, company, and immutable proposal. Renaming the same file does not create a
new import identity. Cross-export comparisons use confirmed business identities,
periods, currency, amounts, and active claims from the same company.

Distinct-expense decisions apply only to eligible amount/period overlaps. Each
decision includes the source revision and a digest of the complete displayed
candidate set. Approval recomputes that evidence under a company lock. A changed
candidate set, a hard duplicate, or truncated evidence keeps the row held.

Preparation intent is saved before dispatch. A lost reply, refresh, or switch
between import views cannot replace its inputs or generate a different request.
The browser freezes the uncertain inputs and looks up the exact saved receipt.
An authorization error or timeout is not evidence that a request never happened.

Execution saves stable header and line request identities. Retries inspect native
receipts before proceeding. Verification checks actual record IDs, company,
currency, references, dates, quantities of headers and lines, balanced amounts,
and unposted state. A partial or uncertain execution remains recoverable under the
same approved proposal. Source edits prevent further stale writes, while a
read-only verification can still reconcile effects of the original approved work.

## Paired opening balances and draft correction

A saved source section mapped to Historical observations can prepare paired
opening-balance drafts. Each row must have a confirmed `opening_balance` type,
unique `document_reference`, description, matching positive debit and credit,
cutover day, `debit_account_id`, `credit_account_id`, and `currency_id`.
Choose the same cutover day and currently valid company accounts and currency in
the preview. Each accepted pair becomes one draft entry and two journal lines
through the existing approval and exact receipt/readback flow. A group uses one
account pair and one date. Prepare separate groups for different account pairs.
Signed, one-sided, or aggregate trial balances need their own balancing and
cutover workflow. Source snapshots do not establish the company's opening ledger.

After both native import stages have saved successful receipts, **Remove
imported drafts** calls the existing atomic bundle rollback owner. The action
also stays available if a later verification cannot read the ERP records. The
owner accepts unchanged drafts with no downstream effects. The saved task confirms both exact native rollback receipts and reads
the mapped headers and lines before releasing source claims. Both changes reuse
the existing schema and promoted native contracts. The original proposal and
receipts remain in history. Review current source decisions or
mapping and approve a new preview to replace those drafts. Edited or posted
records require Accounting's own correction workflow, and uncertain native
outcomes keep the source claims until a terminal readback.

The original product/contact/location paths expose `native_receipt_only` results.
Their job receipt is deliberately separate from the historical Accounting
adapter's full readback. Untrusted record metadata cannot manufacture source
provenance; the record history binding comes from immutable proposals and trusted
native record mappings.

## Chat behavior

Chat sends only typed task selectors. The gateway independently reloads the
authorized task and workflow, bounds the displayed counts, and checks freshness
before and after provenance evaluation. Deterministic status cards distinguish
source preparation, open decisions, approved work, and verified historical
receipts. Generated claims retain the existing evidence gate. Neither an uploaded
cell nor caller-provided task text becomes trusted task state.

## Rollout and remaining acceptance

The PostgreSQL changes are additive migrations 38–40. Apply the normal migration
runner before starting the new API paths. The release compatibility manifest pins
the resulting catalog checksum. Both Rust container recipes include the updated
Python preparation module. No native ERP schema migration is introduced here.

Required merge checks include the frontend typecheck, import unit and browser
suites, Python preparation tests, gateway tests, and API import-review tests with
`C4_TEST_PG` configured. The CI changes register the new suites. The full API
compile and native integration gates remain required even when focused tests pass.

Outstanding completion work from the broader feature plan:

- Run the authorized farm replay in an isolated company against the live native
  ERP. The target of 45 drafts, 90 lines, 735,260 RWF on each side, and zero posted
  is an acceptance target, not a result produced by this branch's synthetic tests.
  Prove interrupted header/line execution and accounting-view totals there.
- Add and certify historical sales, purchases, employee expense claims, stock
  movements/counts, signed trial balances, and payments through their owning
  native operations. Generic sales, purchase, subscription and expense CSV jobs
  do not supply exact per-row record identities or the full native relation
  validation required for a saved workflow. Confirm settlement and stock effects
  through their respective owners.
- Extend preparation to approved joins, unpivoting, broader workbook support,
  cross-file control reconciliation, and processing beyond current bounded limits.
  Current XLSX preparation retains the existing single-worksheet limit.
- Support multiple expense facts on one physical source row using trusted,
  immutable cell-range provenance. Side-by-side sections are reviewable now, but
  the expense adapter conservatively claims the original file hash and row. A
  second expense on that same row stays held as a source duplicate. Operator
  section names or mutable mapping identities must not bypass that protection.
- Extend operator-managed correction to edited or posted ERP effects through
  the owning reversal operations. Changing a source decision leaves prior ERP
  records and receipts intact.
- Add explicit cancellation or replacement of an approved proposal when the native
  owner can prove that no effects can still arrive. Changing an approved executable
  source row currently holds its execution and retains its claims. A missing reply
  or absent receipt alone must never release those claims. Edits to held rows that
  were excluded from execution do not block the unchanged approved entries.
- Add paged access to older proposal/receipt history and translated locale packs
  for the new interface strings. English fallback is available now.

These remaining paths should be enabled individually only after their source
review, exact preview, native execution, recovery, and readback acceptance passes.

# Farm import: first shipment

## Scope and dependency

This change implements guided company setup, grouped source review and recoverable
document submissions. It builds on PR #331 (`codex/alpha-capability-completion`)
for the canonical native creation receipt and the mounted import handoff guards.
The branch also includes main's merged currency fixes (#335 and #336) and named
product unit/category choices. Target the PR at #331's branch until that dependency
lands, then retarget to main after checking the resulting diff.

This is source implementation and automated evidence. The original 15 farm files
were not available for this change; the browser scenarios use labelled synthetic
HTTP responses. They do not certify a complete import into a live farm company.

## User-visible behavior

### Guided setup

Settings exposes a company setup review for country, named currency, units, VAT
registration, fiscal year end and historical-data mode. The review links to
accounts, journals, taxes, fiscal periods, units/products and source imports. Empty
currency/unit choices stay explicit.
Existing company currency is read-only. Setup progress and an uncertain save are
retained for the actor, organization and company, with a result check after refresh.

Supported company fields use the existing native company operations. New-company
metadata retains the setup choices and submission identity. For existing companies,
units, VAT-registration status and historical mode are labelled as a plan on this
device; the existing update operation does not persist those preferences. The UI
does not silently create accounts, taxes or journals or claim those steps complete.

The account creation form asks for purpose. Customer balances create a receivable
asset with reconciliation; supplier balances create a payable liability with
reconciliation. Bank/cash and other account purposes have explicit classifications
in the same create request.

The remaining-form audit also replaces Projects subcontractor costs' raw currency
ID with a named, required currency choice and rejects stale/unavailable selections.
Inventory's first unit still lacks a canonical category-name query; its existing
category inference is a follow-up, not a claim of complete lookup coverage.

### Grouped uncertainty review

Issue groups, inline editing, next-row navigation and a bulk preview replace
repeated modal-only correction. The preview shows the selected rows and preserves
unselected exceptions. A stale row rejects the entire bulk transaction. Successful
responses must contain the exact submitted identities, revisions and decisions.
Uncertain replies retain the same request key for retry.

Field confirmations are independent of row readiness. For the sausage example,
source quantity `8`, recorded price `600 RWF` and total `4,800 RWF` remain immutable.
An operator can confirm `4,800 RWF/kg` while actual weight, original quantity unit
and cost remain unknown. Selecting kilograms changes only the selected unit. Whole
row confirmation requires the populated values to be explicitly confirmed and all
required facts supplied. Keep-unresolved and exclude remain explicit choices.

History records the actor, reason, revision and field confirmations. Undo creates a
new revision from a verified predecessor; it does not erase the prior decision.
History can be paged beyond the first 100 revisions.

Confirmed product, contact and location exports retain `source_review` metadata:
batch, item, decision revision, original file, original row, source hash, row basis
and reason. The native location importer now records the exact created identity
and submitted CSV row as products and contacts already do. The guided import keeps
the exact request bytes and request ID across refresh, scoped to actor/company,
and checks the server result before allowing a new submission.
Refresh recovery supports submitted CSVs up to 2 MB, including source provenance.
If the source exceeds that bound or browser storage cannot retain it, the UI stops
before dispatch and explains the problem; it never sends an unresumable request.
Product and location record details display the recorded source file, row, hash,
review batch/item/revision and decision reason from their authorized metadata.
Location rows now open a detail sheet. Selection resets when the actor,
organization or company changes, and malformed source metadata is not presented
as provenance.

### Save receipts

Document uploads display independent file-save, document-registration and indexing
states. Registration binds a stable submission identity to the original bytes and
registration fields. Native document creation, initial version, creation receipt,
folder update and audit evidence commit together. Reusing the same identity with a
different payload fails. Editing or purging the document cannot free that identity
for a duplicate create.

The browser retains scoped receipt pointers. The server is authoritative for file
and registration status. Recovery resolves the original immutable version while
checking the live document's visibility and the current field-read permissions.
Retry indexing reuses the saved document without uploading or registering again.
An index admission failure leaves the file and document saved. A queued submission
is labelled **AI indexing pending · queued**; it is not a claim that indexing has
finished. A superseded source is identified explicitly and does not index a newer
version through the older receipt.

## Migration and deployment

Application migrations 1–31 and their SQL remain unchanged. Migration **32**, change
set **21**, adds `confirmed_fields` to source-review items and audit decisions.
Only already-confirmed rows/decisions receive a backfill of supplied nonempty
values. Unknowns, source JSON, proposals and prior migration history are preserved.
The release manifest records the expanded catalog checksum. Contracts remain at
the dependency's immutable **0.3.159** release; no native schema or reducer
signature is added by this change.

Apply the standard ordered release migration before serving the new API/UI. Do not
renumber a deployed application migration or rewrite the previously deployed
source-review SQL. This work does not merge or deploy the branch.

## Automated evidence

Focused coverage lives beside each owner:

- `company-setup-model.test.ts`, `company-setup-panel.test.tsx`,
  `account-creation.test.ts` and `chart-of-accounts-create.test.tsx`: explicit
  choices, reviewed setup, uncertain-save recovery and one-form classification.
- `import-review-model.test.ts`, `import-review-uncertainty.test.ts`,
  `guided-import-recovery.test.ts` and the reference/preview tests: partial field
  decisions, 838-row grouping, bulk exceptions, undo, exact receipts, retained
  requests and original source metadata.
- `document-upload-receipts.test.ts`, `document-blob-upload.test.ts`,
  `document-create-effect.test.ts` and the mounted lifetime tests: stage recovery,
  duplicate prevention, index retries and invalidation on actor/company or
  permission changes.
- `company-setup-ui.spec.ts`, `import-review-ui.spec.ts`,
  `prepared-product-import-ui.spec.ts` and
  `document-upload-receipts-ui.spec.ts`: production components in a browser with
  synthetic HTTP/session boundaries, refresh and request-count assertions.
- `record-import-source.test.ts`, `record-import-source.test.tsx` and
  `import-source-detail-ui.spec.ts`: source evidence in product/location record
  details, exact large IDs, malformed/redacted metadata, refresh and dismissal
  across actor, organization and company changes.
- Actual PostgreSQL review tests cover scope, idempotency, revision checks, partial
  confirmations, all-or-nothing bulk decisions and durable undo history. The
  migration test upgrades populated catalog 31 to 32 and checks restart safety.
- API receipt tests exercise immutable original versions, current permissions,
  purged records and indexing failure independently from file/registration success.
- Native harness scenarios extend `run_data_ops_commit_test` and
  `run_documents_wave_a_tests` for created-row trace and atomic replay respectively.
  Compile coverage alone is not a claim that these reducers ran on a live service.

Record executed checks and any remaining failures in the PR description; the
existence of a test here is not evidence that it ran.

## Farm UI acceptance still required

Use the original 15 files in a disposable authorized farm company and keep an
acceptance record containing the served commit and created record identities.

1. Complete company setup with Rwanda/RWF, explicit units, VAT status and the
   intended historical mode. Refresh on review, then save. Create receivable and
   payable accounts and inspect their classification without editing them again.
2. Save the source for review. Confirm the original filenames/rows and the issue
   counts against the source. Inspect the sausage original, proposal and unknowns.
3. Confirm the proposed price while weight and cost remain unknown. Change the
   unit to kilograms and verify quantity/price are unchanged. Refresh and confirm
   the decision and unresolved fields remain.
4. Preview a bulk correction, exclude an exception, apply it, navigate to the next
   issue, and undo a row. Verify the exception and complete audit history. Introduce
   a stale revision and verify no partial bulk application.
5. Resolve enough product/location rows to continue into the prepared import.
   Interrupt a response, refresh and check the saved result. Verify one submission
   identity and trace every created record through import job/record metadata to
   the exact original file and row. Open each created product/location detail and
   inspect its Recorded import source panel. Refresh and verify the same source
   evidence is shown. Repeat for each supported source type.
6. Upload a document while indexing is unavailable. Verify **File saved → Document
   registered → AI indexing failed**, refresh, retry indexing and verify that file
   upload and document registration each happened once. Repeat with a lost reply.
7. Confirm a different actor/company cannot resume the prior scope's work. Record
   unresolved source rows separately from created and posted records.

The complete farm rehearsal also depends on later work: a combined multi-file
intake, location-mapping review, linked customer/account/journal-line/totals preview,
draft-versus-posted dashboard summaries, separation of historical and current
prices, and owner AI provisioning/budget renewal. This shipment does not claim
those follow-ups complete. Background indexing-worker completion/failure needs a
canonical status read beyond queue admission, and version-upload flows retain
their existing separate behavior.

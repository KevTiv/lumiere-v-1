# Chat file import

## Implemented flow

Dropping CSV or single-sheet XLSX files into the signed-in assistant saves a
durable attachment task for the current actor, organization, company and
conversation. It starts in **Awaiting your decision**. A message is optional;
unsent composer text is retained. Intake
accepts up to 20 files, 5 MB per file and 20 MB combined. Next.js, Kong and the
API admit the corresponding bounded base64 JSON request.

The API applies the existing unrestricted-administrator source-review access
policy. File controls are enabled after an authorized task-list read. Task and
original-file reads reauthorize current membership and company scope. Changing
actor, organization, company or conversation hides previous work.

Each submission has a stable request identity bound to its ordered filenames,
source hashes, selected company and conversation. Original bytes commit before
preparation and remain immutable in PostgreSQL. Downloads return those original
bytes. Reusing the request identity with different input fails. A lost response
checks the exact saved request; it does not start a new task. Browser storage
contains scoped request pointers, fingerprints and any unresolved decision receipt.

### Explicit processing decisions

Attaching files does not start parsing or preparation. The chat displays a saved
question with selectable choices and an **Other** text field:

- **Prepare an import for review**, followed by **Approve preparation**.
- **Inspect files only**, followed by **Approve inspection**.
- **Other**, followed by **Send instructions**.

No choice is selected by default. Selecting a radio button alone does not dispatch
work. Other requires a nonempty bounded reply, saves clarification, and leaves
processing paused. The interface explains that custom instructions are retained
as notes and are not automatically applied by a later supported action.

The reusable chat decision card identifies each question and revision. The server
persists the complete question/options snapshot and an append-only answer receipt
bound to the actor, company, original source fingerprint and question revision.
Stale revisions and changed-payload retries are rejected. Refresh restores the
pending question; interrupted answers recover their exact original receipt without
another approval identity. Neither refreshing nor the resume endpoint can approve
an unanswered task. These decisions authorize preparation or inspection only;
creating business records still requires the existing reviewed import confirmation.

Inspection produces source observations without exported business fields and opens
the source-review view without an import wizard. The worker requires an explicit
approved mode, and the API rejects business-import targets in inspection results.

Task cards distinguish saved sources, prepared reviews and preparation errors.
Only the approved saved state can resume preparation using server-held originals. Preparation
is bounded synchronous work with timeout and concurrency limits; it is not a
background queue. Refresh checks task state. A worker interruption retains the
saved task for an explicit resume. Structured source errors retain the originals
and explain why a corrected selection is needed.

The trusted Python worker performs deterministic inspection without an LLM,
network access or business-record writes. It retains original physical CSV rows,
worksheet coordinates, filenames and SHA-256 hashes. It reuses farm audit
parsing, flags overlapping/conflicting/duplicate reports, and retains unknown
values. Supported explicit product, contact and location tables become source
review datasets. Historical snapshots and unsupported linked records remain
observations. Generic explicit ISO date columns and verified farm supplementary
layouts retain date evidence; ambiguous dates remain unknown or invalid.

The worker rejects multi-sheet workbooks, formulas and excessive expanded XLSX
content with actionable errors. Multiline exported values require an explicit
single-line correction because the current native CSV importer cannot consume
quoted multiline records. Original multiline text remains in the source.

Review buttons open the existing grouped review and import workspace. Required
prices, units, category choices, operating flags and contact roles remain explicit.
Contacts have a deterministic prepared preview that binds the actual CSV to the
selected company. Reviewed records use the existing tracked import endpoint and
its exact request/result recovery. Preparation does not post accounting entries,
set current stock or turn old debt snapshots into current obligations.

## Runtime and release

The unreleased application migration 33 adds task, original-source, review-link
and append-only decision storage, including the persisted question snapshot.
Existing migrations 1–32 are unchanged. The checked-in release compatibility
manifest records the appended catalog checksum. No generated native contract
change is required.

Both Rust runtime Dockerfiles install Python 3 and package
`scripts/import-task-prepare.py` and `scripts/farm-history-preflight.py`.
`LUMIERE_IMPORT_PREPARE_SCRIPT` selects the trusted worker path; runtime images use
`/app/scripts/import-task-prepare.py`. Debug builds default to the checkout script.
Apply the normal ordered migration/API/frontend release before enabling the new
flow. These source changes do not establish a deployment.

## Validation boundaries

Coverage includes mounted chat controls, actual Python-output-to-TypeScript
review/preview contracts, task-coordinator recovery and source-fingerprint checks,
PostgreSQL task immutability/scope/replay tests, and browser scenarios mounting the
production chat/task/review components with synthetic HTTP receipts. CI registers
the Python tests, frontend model tests, backend review tests and dedicated browser
suite. Executed results are reported separately from the existence of tests.

Executed in this workspace:

- 250 Python tests passed, including explicit processing-mode and inspection bounds.
- 47 focused frontend tests passed. Mounted coverage passed for the chat controls
  (20 tests) and the decision card, host and inspection handoff (21 tests).
- Ten browser scenarios passed, with the affected inspection scenario rerun after
  hiding its continuation controls. They cover the 15-file selection shape with
  synthetic files, radio-only non-submission, pending-question refresh, Other
  clarification, exact approval-receipt recovery and inspection without import.
- Seven Rust task tests passed with actual Python execution and PostgreSQL enabled
  (no skips), including preapproval blocking, decision replay/revision conflicts,
  concurrent approval, immutable original/question/answer evidence and inspection.
- The final Rust migration-catalog checksum test passed. API library checking,
  full web TypeScript checking and UI TypeScript checking passed.

The actual worker test caught and verified a fix for input-pipe EOF handling;
closing a write stream without dropping the pipe had left Python waiting for
input. Mounted host tests also cover delayed replies after an A → B → A scope
change and stale completions racing a newer operation or access denial.

The route-boundary scan currently reports reducer calls in unchanged test fixtures
in `api-server/src/routes/knowledge_guides.rs` and
`api-server/src/routes/ai_evidence.rs`. This pre-existing repository failure is
outside the new import routes; reducer-literal lint, release compatibility,
ownership and Finance manifest checks pass.

The original 15 private farm files are not present in this workspace. Live
acceptance still requires the served revision, those original hashes, a disposable
authorized company, request/record IDs and duplicate checks. Synthetic receipts
do not establish that acceptance.

## Follow-ups

- Linked accounting migration and cross-entity reconciliation previews.
- Multi-sheet XLSX and reviewed formula-value handling.
- Conversational corrections that become explicit versioned review decisions;
  the implemented correction surface is the existing review workspace.
- Durable task-level aggregation of resulting draft/posted record receipts;
  execution receipts currently remain in the existing tracked import workflow.
- Reusable preparation recipes and asynchronous worker scheduling.
- Further domain-specific decision questions using the same reusable card and
  durable revision/answer protocol.

These follow-ups extend the existing
[sandbox import proposal](agent-sandbox-import-onboarding-plan.md). Historical
business rules remain those in
[farm history organization import](farm-history-organization-import.md).

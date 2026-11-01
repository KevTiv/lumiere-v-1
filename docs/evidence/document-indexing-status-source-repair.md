# Document indexing status source repair

Status: REVIEW — source repair, not deployed acceptance.
Base: `1b842603d950c6c94bb91c845c4cfbe5f8c5e1ec`.

The upload receipt previously read queue-admission markers only. A successful
queue admission stayed queued even after the worker completed or exhausted its
attempts. This change records exact job references after all passages have been
admitted and reads their canonical worker results through the existing scoped
receipt. It does not add a new upload, document, background queue or status owner.

## Current path and effect identity

- Component: `DocumentUploadReceipts` and its Check save receipt action.
- Application owner: `resumeDocumentSubmission` and receipt refresh.
- API: the existing document blob receipt route with actor/company submission
  identity, current document visibility and field access checks.
- Ingestion: `persist_document_evidence`, existing `request_embedding_job`, then
  exact semantic-key readback to one queue job per immutable passage.
- Effect key: object key + document ID + full checksum; each manifest entry has
  one passage ID/fingerprint and one exact queue job ID.
- Canonical result: `queue_job.status` and `search_embedding.sync_status` under
  the same company and exact passage/fingerprint/index generation.
- Completed: every expected passage has a completed job and synced embedding.
  Atomic `finalize_embedding_job` remains the only completion authority.
- Failed: a job is dead-lettered/cancelled, or its index is failed. Pending and
  leased jobs remain queued/running. Missing, duplicate or stale result rows are
  unavailable; they never certify completion.

The manifest is private upload bookkeeping, not an independent worker status.
It contains no passage text or lease credential. Its immutable writes accept
identical recovery and reject a changed expected effect set. The queue and
embedding read selects omit payload, copied text, vectors and error details.
A failed status read retains successful file-save and document-registration
states. Current scope/field checks run again before returning the receipt.

## Verification

- `node --import tsx --test lib/document-upload-receipts.test.ts`: nine passed.
  Includes lost registration/indexing replies, unchanged identity, independent
  save stages, and no new effect from running/completed/unavailable checks.
- An isolated `rustc --test` harness compiled the exact `worker_status`,
  `combine_worker_statuses` and `validate_job_refs` functions plus their four
  owner tests against cached serde_json. All four passed. This verifies the
  resolver; it does not compile the complete API route.
- Added router regression source for immutable manifest replay/conflict, exact
  completed readback, stale index generation, and preserved saved stages.
  Full API/router execution remains pending in the integration environment.
- Rust formatting and `git diff --check` passed.

## Remaining acceptance

No Railway write or paid indexing was performed. This is not live indexing
acceptance. The existing legacy queued receipts have no expected-job manifest;
read-only checks preserve their queued status. A separately authorized governed
re-ingestion of that same document/version/checksum can establish a manifest
without a new upload or document registration. It must not be automatically
triggered by status checks, and any OCR/embedding cost must use the approved
spend admission first. No legacy receipt is claimed complete by this repair.

A dead-lettered job requires the canonical queue retry operation. Calling the
existing ingestion endpoint alone does not reopen a dead-lettered job and must
not be reported as recovered. Live completion, failed-worker recovery and
cross-actor verification remain required. The UI fixture/regression cases do
not certify those deployed transitions. No native schema, reducer or generated
contract change is required by this source repair.

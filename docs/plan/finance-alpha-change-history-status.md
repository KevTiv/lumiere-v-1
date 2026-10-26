# Finance alpha trusted change history first implementation

**Status:** Implementation candidate; contract release and integrated runtime acceptance pending.
**Plan:** [Finance alpha change history and review](../plans/finance-alpha-change-review-plan.md).
**Product behavior:** Normal permitted saves apply immediately and acquire history. Selected financial actions retain their existing approval rules; explicit proposed-change review remains a later implementation slice.

## Delivered scope

The first producer is the ordinary `update_account_move_line` branch for draft Accounting entries, invoices and bills. It records actual changed material fields inside the native business transaction, links the exact audit identity, and records source/evidence rows through the existing organization commit pipeline for durable PostgreSQL projection. Repeating the same effective values creates no duplicate material change.

`business_change` is private and has no caller-supplied append reducer. The old raw audit API cannot fabricate trusted history. The public audit row contains a summary; before/after values live in private evidence. Metadata remains a normal writable field but is excluded from material diffs, including when legacy metadata exceeds the evidence-size limit.

The invoice/bill record page has a **Changes** tab showing authorized before/after values, actor, time, exact line identity and partial-coverage disclosure. The API requires `business_history:read`, current source and child permissions, company membership and current field policy. It redacts before returning data, rechecks authority after source reads, uses bounded scope-bound pagination and serves private responses without caching. The existing role editor exposes a read-only history capability without assigning it to any role.

The current API reads the private hot evidence through the existing server-owned native client. PostgreSQL durability uses the normal generated append-history projection. A dedicated scoped service reader, PostgreSQL history read/RLS path and safe evidence cooling are not implemented by this slice; the table remains always hot. No new PostgreSQL instance, production role grant or deployment is created.

## Coverage limits

- Ordinary draft line material updates only. PO quantity/price economic correction, metadata diffs, line add/delete, move-header edits and other Accounting operations remain outside this producer.
- Earlier changes have no invented backfilled values. Empty material history does not claim that no earlier work occurred.
- No generic proposed-update editor, ChangeSet approval executor, rollback or mandatory review on normal saves is introduced. Existing approvals and explicit financial correction/reversal operations remain authoritative.
- The [seven-module operation inventory](finance-alpha-change-review-inventory-status.md) records 480 relevant operations, including 427 session-exposed commands. It classifies source signals and gaps; it does not certify history for the other six modules or complete FCR-00 owner/policy acceptance.

## Evidence and release gates

The implementation includes pure diff/codec tests, native persisted Accounting regressions, API HTTP/SATS authorization and pagination cases, UI/parser/role tests and a real-stack `@p0` Playwright case. The browser case performs the visible line edit, checks the exact before/after result, reloads without redispatch and tests forged-audit exclusion, field redaction and revoked grants. Discovery and fixture tests are distinct from executing that case against a real stack.

Local validation on 2026-10-26 passed the real `run_accounting_post_invoice_test`
reducer against a disposable SpacetimeDB 2.8.2 instance with development fixture
admission enabled. Native module/tests typechecking and WASM builds passed. The
API history suite passed all 12 tests; query-hooks, UI and Web TypeScript passed;
six parser and 21 focused UI/RBAC tests passed. The Python script suite passed 168
tests. The 518-table live generation, storage-policy bootstrap and organization
ownership checks passed, as did 13 storage-policy and 12 tenant-ownership tests.
These checks validate the first producer and its boundaries; the browser case
still needs integrated execution with the final published contracts.

Migration 27 is promoted byte-for-byte from live code generation into the frozen
ledger and API catalog (change set 16, Expand); pending version is 28. Sixteen
migration unit tests and a real disposable PostgreSQL upgrade/projection test
passed. That test preserves the version-26 prefix, verifies exact history values
and tenant-scoped identity, prevents duplicate/replacement history, and verifies
whole-commit rollback and safe retry after a forced second-insert failure.
Generated reconstruction dispatch includes the private evidence relation.

Local and hosted results are recorded on the PR for its exact head. Before merge:

1. The normal contracts workflow must publish and repin the new private table and PostgreSQL/reconstruction manifests, including promoted migration 27; published migration history stays immutable.
2. Native/API and frontend checks must pass against the resulting coherent pin. Newly required CI selectors include the API history tests and inventory check.
3. The real native Accounting regression and Playwright history path must execute against a disposable integrated stack, alongside the existing financial alpha gates.
4. Validate the populated schema upgrade and exact durable projection/reconstruction of evidence, audit links and source rows. Static metadata registration alone is not that proof.
5. Perform normal review and separately record deployed alpha acceptance before enabling staff history grants. No production execution is part of this implementation PR.

## Plan position

FCR-00 has a source inventory and validator; policy/field/runtime acceptance remains open. FCR-01 has the first private capture and source storage contracts, with contract publication and durable-runtime proof pending. FCR-02/FCR-03 have the normal-save Accounting history path and initial shared renderer/API, while proposed-change submission/review/application remains unimplemented. FCR-04 through FCR-11 continue under the original plan.

The next slice completes generated-contract and runtime acceptance for this producer, then adds a typed Accounting draft-update proposal with material base validation and the existing independent workflow approval boundary. Broader module adoption follows that reviewed contract.

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


## Read-only history UX refinement (2026-10-27)

The follow-up refines the existing invoice/bill **Changes** tab. It does not add
proposed updates, restore, approval or execution controls. It retains native
capture, source/field policy, company/actor scope, exact values and the existing
history query owner.

- Event headings name only the authorized changed fields returned for that save.
  Exact line IDs are secondary. No title, count or relation name is inferred from
  a current record or an omitted historical field.
- Comparison values are labelled **Before this save** and **After this save**.
  One continuous event list replaces repeated outer cards; expanded comparisons
  stack on narrow screens. Decimal and U64 strings remain exact escaped text.
  Null and empty strings have distinct labels; zero stays zero.
- Actor identity has an explicit **User** fallback and an accessible native
  disclosure for the full authorized identity. No name lookup, guessed actor,
  historical currency or relation-label enrichment is added. The displayed
  timestamp includes its local time-zone label; the original ISO timestamp stays
  in the time element.
- A short partial-history notice stays visible. Existing coverage limitations
  remain in a native disclosure. Empty, filtered-empty with continuation,
  loading, denied and failed reads remain distinct. Failed/denied reads hide
  cached evidence; no missing history is presented as a confirmed zero.
- Refresh and pagination reuse the existing read owner, expose progress, and
  disable duplicate read controls while either request is pending. Read controls
  do not submit a business change. Native event/identity disclosures remain
  keyboard controls without custom key interception.

The Mobbin reference pass selected business-readable activity summaries from
[Xero](https://mobbin.com/screens/002c8c1f-505c-4bbf-a2de-54ac2578e2d7)
and [Lightfield](https://mobbin.com/screens/201a0769-f061-40af-a5fb-c9670fddeca0).
[Linear](https://mobbin.com/screens/6c14e085-9ff5-4e61-9a21-b04f1b0a3433)
provided a document-comparison example for keeping historical changes focused;
its restore control is outside this producer's scope. The cross-domain screens
inform structure only. Lumiere's existing semantic colors, typography,
components, document navigation and default/Ocean theme ownership are retained.
The exact labels and placement are product decisions, not a formal ERP standard.

The user assigned test execution to CI. This follow-up adds/updates renderer and
wrapper regression source in the existing automatically discovered UI suite.
No local tests, typechecks, lint runners, builds, browser stacks, seeds or
services were run. Source review and whitespace inspection are not test passes.
Earlier foundation results above apply to their recorded revision, not this UI
follow-up. Real keyboard/mobile/theme/text-enlargement evidence remains a release
check; no new screenshot or device acceptance is claimed.

### Integration with main after PR #285 (2026-10-27)

Merged `main` at `fb7f6687cfa71d91f2c2377a9d32a585f8ade05e` into the
Finance history branch. The seven text conflicts were contract pin and generated
metadata selections. The invoice page retains the Changes tab and its existing
history invalidation alongside scoped list return navigation and the full-width
Saved details workspace. The role dialog retains the history capability label
alongside its scrolling body and pending-safe footer. Main's runtime reader,
operation contracts, shared-select gate, type-debt reductions and bill-source E2E
correction are retained.

The resolution keeps the existing coherent 0.3.150 Rust/frontend pin, archive
checksums, lockfile entries, presentation dictionary and release metadata as the
history-bearing generation anchor. Main's 0.3.151 archive is not a combined
release: it omits `business_change_table` and migration 27. Its unreferenced
archives are removed from this branch; no archive content, published tag or
published SQL is edited. The combined sources still need the repository's normal
Release contracts workflow to generate, publish and repin a matching release.
That workflow runs on the branch push and chooses the next available version;
this change does not manually publish or invent a release pin.

Archive/source inspection found no difference in shared published migrations
between 0.3.150 and 0.3.151. Migration 27 remains byte-for-byte equal to both the
pre-merge source and its published 0.3.150 SQL, SHA-256
`0ee008de8fdcf2e56573af9ada2e2557fd9a0647ae6f029a46050bbac0989736`.
The source capture module, promoted migration ledger/catalog and private history
storage policy are preserved. The history E2E opens the event summary explicitly,
so the nested user-identity disclosure cannot make that selector ambiguous; it
also requires the exact before/after values to be visible after expansion. The Finance source inventory was regenerated for
the merged operation-contract inputs; only two input hashes changed.

Source and archive inspection are not executed acceptance tests. Per user
instruction, CI owns all tests, typechecks, lint, builds and browser execution.
No local test runner, service or seed was started. Until the combined contract
pin and its same-head CI succeed, this branch remains a draft and is not declared
merge-ready. No role grant, production data change, merge or deployment is part
of this update.

# Alpha ERP history implementation status

**Date:** 2026-11-05.
**Status:** Implementation candidate. Integrated acceptance and deployed verification remain release gates.
**Plan:** [ERP history and source tracing across the current alpha](../plans/alpha-erp-history-and-sources.md).

## Available experience

Alpha workspaces have an **Activity** drawer opened from the workspace toolbar. Its URL retains the module's tab and filters through `?history=activity`. A reader can expand an event, follow its exact business record where a canonical page exists, or inspect that record's **History & sources** in a detail drawer. Existing record pages and sheets use the shared history component. The specialized Accounting Changes view remains available.

This includes the ten current business modules and Documents, Calendar, My work, Approvals, Overview, Settings and the enabled Assistant surfaces. Discovery does not grant access. Reads require `business_history:read` and current source/company/field permissions. Existing non-alpha Project, Manufacturing and POS audit views retain their explicitly limited legacy behavior.

Record history uses server pagination rather than filtering the latest 500 organization audit rows. Organization-wide evidence has its own private table and event identity, without assigning shared records a fictitious company. Module results apply current source access independently to each event and field, including a fresh policy check before returning evidence. Company, actor and role changes clear the corresponding client scope; a protected-read denial hides sibling cached evidence until both panels are refreshed.

## Capture and source evidence

Eligible alpha audit producers use a fallible native capture adapter. Private evidence and its exact audit identity are recorded in the business transaction. Complete outcome owners attach those rows to their existing persistence envelope, so projection cannot advance to the history without that operation's business effects. Delegated paths awaiting that integration retain their existing audit behavior under an explicit owner policy. Standalone history journal entries are supporting evidence and do not certify complete business reconstruction. Raw caller-authored audit entries cannot create private history. Internal helper producers supply registered canonical operation names. Additional private snapshots cover selected previously unaudited material changes and product edits without expanding public audit values.

Comparisons contain only retained scalar fields with known before/after values. Missing original values remain summaries. Explicit soft-delete state is preserved, exact identifiers and decimal strings survive, and wide-row evidence prioritizes changed fields before applying its size budget. An identical known snapshot does not claim another material change.

Tracked import receipts connect submitted row numbers and exact created record IDs. The sealed tracked-import owner combines job results, source records, mappings and private history in one durable envelope for the five supported product, contact, location, journal-entry and journal-line import families. Direct legacy CSV reducers can retain hot private evidence without that sealed owner; they do not receive the same durable-history certification. Original source hashes are returned only when the immutable admission matches the original importing actor, organization/company, request, entity and final submitted content hash. A prepared derivative is labelled as a derivative; it does not prove a particular original row by itself.

Reviewed exports can additionally retain a verified source-review batch, item and revision. The submission boundary validates exported values, confirmed fields and source provenance against the saved review before recording that immutable relationship. The history reader joins it to the exact native import receipt. Earlier imports without the retained binding remain incomplete. Saving a source fact does not imply that a native document exists, is posted, or is settled.

## Contracts and storage

`organization_business_change` is private append-only history with organization ownership. The existing company-owned `business_change` contract remains compatible. Generated ownership, storage policy and reconstruction include the new table. Frozen PostgreSQL migration 37 adds its durable append-history relation and partitions; existing released migrations remain unchanged.

Native and source-review evidence retain their existing transactional owners. Reads of native evidence currently use the private hot tables. PostgreSQL supplies durable projection/reconstruction, but a dedicated historical PostgreSQL reader and safe hot-evidence cooling are further work. The new table remains always hot under the reviewed storage policy.

## Coverage and remaining work

The [generated coverage register](../evidence/alpha-history-inventory.md) enumerates current source candidates, verified contract identities, direct and delegated producer observations, existing domain evidence, import receipts, and unresolved paths. These source classifications do not certify an operation's material fields or runtime outcome. CI checks both the current Finance register and the expanded alpha register for drift.

The following parts of the original plan remain explicit completion gates:

- Complete the disposition and runtime proof of every enabled mutation. Some source candidates retain only domain evidence, receipts or legacy audit, and some require an admission/non-material classification. The register must not be interpreted as complete capture merely because the module has a drawer.
- Fill missing original values where domain owners can capture them reliably, and normalize additional existing domain evidence through the shared reader. There is no historical invention for pre-capture changes.
- Replace remaining list-based source authorization adapters with reviewed exact-record owners. Such readers can omit records beyond their collection's bound. Archived/deleted records without an established current authority remain unavailable.
- Finish durable-store history reads, lag/capacity budgets and retention/finalization proof before cooling evidence. Current history is a paginated live event view, not an arbitrary historical ERP snapshot.
- Reconcile real pilot source files and receipts under their own tenant/company scopes, complete integrated module journeys, verify the served release, and enable selected staff role grants through the existing role owner.

Normal domain approval, posting, correction and reversal owners continue to determine business outcomes. General proposed edits, branching, rollback and offline synchronization remain with their separate plans.

## Verification

Validation against contracts `0.3.167` passed all 103 API/PostgreSQL cases: 43 history/source, 15 import, two admission, 24 source-review, 18 migration compatibility, and one catalog binding test. The PostgreSQL cases include rollback of a failed complete source/history projection, idempotent retry, and exact migration table ordering.

The final production WASM passed ten native suite entry points, including core, tracked imports, five operation-owner suites, Accounting history, Fleet and Subscriptions. These exercise company/organization capture, raw-audit forgery exclusion, batch deduplication and complete outcome envelopes. Broader Sales, Expenses and Purchasing found stale test expectations; the corrected exact row/link and tenant-currency fixtures pass native test compilation and are selected for isolated CI execution.

Focused UI/model and navigation suites, package typechecks, locale/type-debt checks, ownership/storage checks, codegen tests, C2 boundary checks and both inventory checks passed. Matching-head CI and deployed module acceptance remain separate gates. A fixture, static inventory or successful typecheck does not certify the unresolved operation dispositions above.

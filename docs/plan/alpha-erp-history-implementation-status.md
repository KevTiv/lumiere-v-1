# Alpha ERP history implementation status

**Date:** 2026-11-05.
**Status:** Implementation candidate. Integrated acceptance and deployed verification remain release gates.
**Plan:** [ERP history and source tracing across the current alpha](../plans/alpha-erp-history-and-sources.md).

## Available experience

Alpha workspaces have an **Activity** drawer opened from the workspace toolbar. Its URL retains the module's tab and filters through `?history=activity`. A reader can expand an event, follow its exact business record where a canonical page exists, or inspect that record's **History & sources** in a detail drawer. Existing record pages and sheets use the shared history component. The specialized Accounting Changes view remains available.

This includes the ten current business modules and Documents, Calendar, My work, Approvals, Overview, Settings and the enabled Assistant surfaces. Discovery does not grant access. Reads require `business_history:read` and current source/company/field permissions. Existing non-alpha Project, Manufacturing and POS audit views retain their explicitly limited legacy behavior.

Record history uses server pagination rather than filtering the latest 500 organization audit rows. Organization-wide evidence has its own private table and event identity, without assigning shared records a fictitious company. Module results apply current source access independently to each event and field, including a fresh policy check before returning evidence. Company, actor and role changes clear the corresponding client scope; a protected-read denial hides sibling cached evidence until both panels are refreshed.

## Capture and source evidence

Existing alpha audit producers now use a fallible native capture adapter. Private evidence, its exact audit identity and the organization persistence commit are recorded in the business transaction. Raw caller-authored audit entries cannot create private history. Internal helper producers supply registered canonical operation names. Additional private snapshots cover selected previously unaudited material changes and product edits without expanding public audit values.

Comparisons contain only retained scalar fields with known before/after values. Missing original values remain summaries. Explicit soft-delete state is preserved, exact identifiers and decimal strings survive, and wide-row evidence prioritizes changed fields before applying its size budget. An identical known snapshot does not claim another material change.

Tracked import receipts connect submitted row numbers and exact created record IDs. Supported creation paths also capture private import events. Original source hashes are returned only when the immutable admission matches the original importing actor, organization/company, request, entity and final submitted content hash. A prepared derivative is labelled as a derivative; it does not prove a particular original row by itself.

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

The implementation includes native persisted company/organization capture and forged-audit exclusion cases, source-aware API HTTP/SATS tests, import binding tests, PostgreSQL upgrade/recovery tests, UI permission/pagination cases, locale checks and deterministic source inventory tests. Current execution results and the exact published contract revision belong in the pull request. A fixture, static inventory or successful typecheck does not substitute for the integrated module acceptance gates above.

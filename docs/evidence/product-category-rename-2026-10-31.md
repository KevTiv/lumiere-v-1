# Product category rename source repair

Task / base SHA: N1 category action; base 1b842603. REVIEW, source only.

Files changed: Inventory/Products category action and retained form; existing
query-hook package with a name-only rename application function and tests;
Products action permission mapping; two English locale entries.

Before path: Categories offered create, delete and restore. The existing
update_product_category operation and hook were not exposed as a rename action.

After path: Select one category -> retained name form -> authorized exact-ID
pre-read -> existing update_product_category -> exact saved-name readback. A lost
reply is accepted only when the requested name reads back. A repeat with that
saved name dispatches no second update. Failed or unreadable results retain edits.

Canonical owners reused: product_category native reducer, existing BFF command,
category query and current product_category/write authorization. Only name is sent;
parent links, sequence, metadata and product references are preserved.

Effect identity + cardinality: Exact category u64 ID and current organization;
zero or duplicate matches reject. Previous-name mismatch rejects before dispatch.
This pre-read is not an atomic concurrency lock; the native update has no expected
revision input, and this packet does not claim server CAS protection.

Resulting record ref: The same category ID. No live category was renamed.

Typed outcomes/errors: applied / alreadyApplied require exact readback. Uncertain
or rejected results throw and keep the form. Actor/org/company switches dismiss
selection; drafts are not persisted across identities. The new action carries
product_category/write discovery permission and rechecks it before submission.

Tests run (command + result): Five category rename tests pass (lost response,
repeat, zero/multiple/stale IDs, accepted-but-not-saved, unavailable readback,
blank name). Seven Products catalog tests pass, including rename permission.
TS/TSX syntax transpilation passes. Full web type checking fails in this isolated
workspace with SDK/dependency type errors; it is not a pass. Hosted full type
checking and mounted/browser operator coverage remain required.

Operator proof: Not performed. No deployment, data change or paid AI call.

Compatibility/debt retired: Category naming is available without replacement
records or relinking products. New labels use the existing locale fallback.

Remaining blocker/deferral: Review batch display-label editing has no existing
named operation. Its API/storage design must preserve immutable source evidence,
creation hashes and replay semantics before implementation. This commit does not
rename review batches or complete the full N1 packet. Full validation and the
Mugisha live naming handover remain pending.

Contract release required: no for category rename; existing operation reused.

Next bounded task: hosted validation, mounted form recovery/scope checks, then
approved release and exact category readback. Design the separate batch label
operation before changing historical source titles.

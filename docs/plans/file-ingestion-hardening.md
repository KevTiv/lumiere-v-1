# Alpha file ingestion hardening

Implementation base: `8f1673757b6b2f7060632f0864a377b30d9e2158` (2 November 2026).
This refreshes the earlier review at `3b8c00e`; main's intervening navigation work
does not change the inspected CSV admission boundaries. The selected design is
shared admission with restricted Excel extraction. No new ERP grants are needed.

## Enforced boundaries

The `lumiere-file-inspection` crate owns bounded CSV parsing and content
eligibility. API, AI gateway and native CSV reducers share the parser. Inspection
covers the complete accepted input; preview sampling does not limit inspection.
Malformed shapes, controls and excessive bytes/rows/columns/cells fail closed.
Findings are capped without losing the rejected AI-eligibility outcome. Formula
and known instruction patterns withhold AI assistance; valid signed numbers and
telephone numbers remain ordinary data. Processing permission is distinct from
AI eligibility, and neither grants business authority.

The browser sends original CSV/XLSX bytes to `/api/import/inspect-file`, forwarded
to the authenticated API. Membership determines organization/company scope. CSV
is inspected directly; XLSX goes through the restricted worker. The returned
matrix is checked against its canonical CSV before use. No local extraction
fallback can impersonate server admission.

The server stores immutable original bytes and a private source receipt. The
opaque handle binds actor, organization, company, original byte hash, original
normalized dataset hash and both extraction/content policy versions. A tracked
XLSX submission requires this handle. Before reducer dispatch, the API verifies
the receipt and exact original bytes, independently inspects the final CSV, and
records an immutable preparation linking both identities to the request ID.
This records a **user-prepared derivative**: it does not assert that client-side
mapping or corrections were independently reconstructed from the original.
Changed final bytes or a substituted source cannot reuse that request identity.
The existing reducer approval, permission, company, field and outcome checks
remain authoritative. Ordinary CSV submissions without original-source claims
are inspected at dispatch and remain supported.

Managed document uploads receive a server-owned inspection receipt before
completion. It binds object key, scope, bytes, name, type and policy. Download,
receipt, branding, OCR and indexing paths recheck current identity and profile;
legacy or stale content is reinspected. Caller-supplied completion flags are not
evidence. Copies of another object's receipt and storage failures fail closed.

Document extraction checks derived text before truncation and before evidence
mutation. Workbook indexing consumes the same restricted normalized extraction
and verifies its dataset hash. Source, extraction and content-policy identities
are retained in evidence metadata. Retrieval of older document passages checks
current content eligibility at resolve and release. RAG prompts serialize
server-resolved references and content separately with explicit untrusted
instruction status. Rejected answers do not disclose passage snippets, including
when membership changed after initial retrieval. Model content cannot change the
static capability graph, current grants, exact approval identity or recipients.

## Restricted workbook worker

`scripts/workbook-extract.py` is a standalone, tool-free parser. The API launches
`/usr/bin/python3 -I -S` with an empty environment and stdin/stdout pipes. It
passes no bucket credentials, session token, source path or user-selected code.
The worker closes other file descriptors and installs mandatory Linux seccomp
restrictions before reading bytes. Its default syscall policy denies operations;
the small allowlist permits stdin reads, stdout/stderr writes, memory management
without executable mappings, signals, clocks and process exit. File opens,
socket creation/connect, exec, fork/clone, ptrace and policy changes are denied.

The worker limits address space to 256 MiB, CPU to five seconds, core/file output
and child count to zero, with no more than sixteen descriptors. The API adds an
eight-second deadline, bounded output/diagnostic pipes, kill-on-cancellation and
two concurrent extraction slots per API process. Missing Python/libseccomp or
isolation failures return unavailable; there is no permissive fallback. Ordinary
CSV remains independent of workbook-worker availability.

| Workbook constraint | Alpha limit or behavior |
| --- | --- |
| Original bytes | 5,000,000 |
| ZIP members | 200 |
| Expanded member / aggregate | 10,000,000 / 25,000,000 bytes |
| Declared compression ratio | At most 100:1 |
| XML elements / nesting | 250,000 per part / 64 levels |
| Cells / row coordinate / columns | 50,000 / 25,000 / 200 |
| Matrix allocation | 1,000,000 cells |
| Canonical CSV | 2,000,000 bytes |
| Worksheets | Exactly one visible sheet |
| Formulas, cached formula results | Reject; request a values-only copy |
| Macros, embedded binaries, comments, hidden rows/columns | Reject |
| External relationships, DTD/entities, malformed XML | Reject |
| ZIP traversal, duplicate paths/cells, encryption | Reject |

## Document profiles and limitations

Known supported types are CSV, plain/Markdown text, JSON, static XLSX, PDF,
PNG/JPEG and non-animated WebP. Declarations require matching extension/MIME and
bounded basenames. Unsupported active/legacy/unknown formats fail closed rather
than becoming downloadable active content through an alternate upload path.

These are structural profiles and known-pattern checks, **not an antivirus
verdict or proof of benign intent**. PDF checks cover bounded signature/EOF and
explicit active names; compressed or novel PDF features are not exhaustively
inspected. Existing native PDF text extraction remains in the API process and
is not covered by the workbook sandbox. Raster header validation is not a full
image decoder certification. An AV engine or content disarm service can be added
behind the receipt owner later; private tenant files must not be submitted to a
public scanner by default. No such service is provisioned by this change.

Known-pattern detection cannot eliminate semantic prompt injection or establish
the truth of imported business data. Untrusted provenance and independently
enforced operation authority remain necessary after a file passes inspection.
Human review must evaluate final amounts, recipients and changes; a clean scan
must never act as payment approval or a permission grant.

## Validation and deployment

The script tests run the **real seccomp filter**, proving file-open, socket,
fork and exec denials. They cover hostile workbook packages, formulas/caches,
hidden content, external relationships, XML entities/depth, duplicate/traversal
paths, compression bombs, later rows and benign multiline/numeric data. Rust
tests cover complete CSV/matrix budgets, digest binding, scope substitution,
policy changes, immutable preparations, current blob receipts, derived text and
RAG source/action boundaries. Frontend tests exercise original-byte forwarding,
complete scans, strict response consistency and bounded streaming BFF bodies.

Both Rust runtime images install `libseccomp2`, copy the worker, and run the
kernel denial probe during image construction. Source changes participate in
runtime image triggers. The shared native parser participates in contract
module cache keys, publisher input and release dirty checks. No reducer/table
schema or public signature changes are introduced.

Deploy matching API/web/module code, retain existing authorization checks, and
verify one ordinary CSV plus a values-only XLSX through review/apply. Rehearse
worker timeout, isolation unavailable and private-store failure. Confirm that a
tenant cannot reuse another actor/company's source handle. Measure extraction
duration, peak worker RSS, queue/busy rejections and normal API latency under the
pilot workload before raising limits. No production latency benchmark has been
claimed.

Rollback should disable XLSX admission or restore a validated worker/profile;
never bypass current inspection on failure. A policy change invalidates prior
eligibility and requires reinspection. Private orphaned source bytes can remain
if metadata/preparation writes fail; retain their private access boundary and
include `import-admissions`/`import-preparations` in the organization's storage
retention/deletion process. Durable-source retention is an operational follow-up
and does not grant those internal objects ordinary document access.

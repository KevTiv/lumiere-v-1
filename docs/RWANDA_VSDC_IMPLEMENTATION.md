# Rwanda VSDC implementation

This local development milestone adds a protocol client, canonical-invoice
readiness checks and fiscal archive guards. It does not enable Rwanda statutory
submission. The Rwanda export route continues to reject requests, and the
readiness route always returns `readyToSubmit: false`.

## Protocol baseline

RRA's [About EBM page](https://www.rra.gov.rw/en/about-ebm) currently links
[VSDC API v1.0.5](https://www.rra.gov.rw/fileadmin/user_upload/VSDC_SPECIFICATION_DOCUMENT_v1.0.5_okay.pdf),
revised 16 May 2023, and a separate
[CIS specification](https://www.rra.gov.rw/fileadmin/user_upload/CIS_for_VSDC_technical_Specifications_New.pdf).
These public documents establish a development baseline, not approval for an
installed device or certification of this application. No sandbox enrollment
has been supplied. The certification workbook linked by RRA was unavailable
during research and has not been reviewed.

The API document's tables and examples disagree on the item tax and receipt
customer-TIN field names. The client requires an explicit reviewed dialect and
an inclusive or exclusive price convention; neither has a default. The client
does not determine tax classifications, payment methods or legal rates.

## Local boundaries

`api-server/src/rwanda_vsdc` is private and has no production callers. It
implements initialization and a restricted normal-sale request/receipt client.
The operator supplies the exact URL, taxpayer/branch scope and reviewed device
configuration. No endpoint, credentials or device identity are generated.
Requests use exact decimal hundredths and lossless counters up to 38 digits.
The supported sale envelope excludes discounts, insurance, refunds,
cancellations, copies, training and proforma receipts. Values requiring rounding
are rejected; this is not a Rwanda rounding-policy implementation.

The transport has bounded request/response sizes and a whole-operation timeout,
keeps TLS verification and configured proxy behavior, and disables redirects and
automatic retry. Failures after dispatch remain uncertain, including overlap
responses. Provider bodies and initialization keys are not exposed through error
messages. A response identifies the device; it does not prove invoice-level
correlation, signature validity or safe replay.

The authenticated read-only endpoint is:

```text
GET /v1/statutory-adapters/rw/companies/:company_id/invoices/:move_id/readiness
```

It checks actor-authorized canonical invoice data and company scope and reports
safe blocker codes/field names. It returns no fiscal payload, raw invoice
content or provider secrets. It respects the existing field projections; absent
or redacted fields remain unavailable. It reserves no numbers and has no
outbound side effects. Fiscal mapping, enrollment, pack acceptance,
certification and durable dispatch remain explicit blockers.

Document locale defaults now respect the exact accepted/effective company pack
pin. Fiscal creation, new versions and restores require a declared fiscal kind,
valid pin and matching supported MIME type before any writes. Ordinary
non-fiscal documents retain their normal behavior. Rwanda's draft fiscal kinds
remain unsupported; no archive format is invented from their names.

## Remaining integration dependencies

Before connecting the client to an issuance flow, obtain the approved sandbox
VSDC package/version and enrolled taxpayer, branch, device and environment
bindings. Resolve the documented field inconsistencies against that runtime and
confirm numbering, uncertain-result reconciliation and authoritative receipt
readback. No live VSDC API requests or certification application have been made.

Canonical preparation also needs reviewed, versioned item/classification/unit,
tax, payment and fiscal operator mappings. Current invoice-line projections do
not expose every required field. Extend those reads under field policy and
capture an immutable fiscal snapshot; do not reconstruct historical taxes from
mutable product data, caller metadata or current tax definitions.

The draft Rwanda pack also needs a controlled publication/acceptance path tied
to reviewed evidence. The current catalog stores one definition per pack and
does not promote an installed draft automatically. Any coexistence of historical
rulesets needs an explicit versioning migration and matching company pins.

Then add the dedicated durable fiscal intent, atomic number reservation,
registered dispatcher identity, receipt archive and explicit recovery workflow.
That work requires coordinated canonical schema/contracts changes. Generic
project e-invoice intents and ordinary queue completion are not fiscal receipts.
The existing invoice PDF cannot be treated as a signed EBM receipt.

The CIS requirements also cover receipt presentation, journal, copy/refund,
daily reports and inventory behavior. The restricted client is not a claim of
conformance to those requirements. Legal/tax acceptance and actual RRA
certification remain separate from the
[accounting rehearsal](RWANDA_ACCOUNTING_ALPHA_REHEARSAL.md).

## Release preparation

The published contracts pin remains `0.3.122`; this milestone adds no canonical
tables or reducer signatures. Rebuild the application/module artifacts and
retain their exact hashes before deployment. See
[Production deployment](PRODUCTION_DEPLOY.md) for read-only migration lineage
auditing, reviewed-mail verification and persistent document storage checks.
Local tests do not establish deployed acceptance, real provider delivery or a
production restore.

Local validation is recorded in
[the development evidence record](evidence/rwanda-vsdc-local-2026-10-18.json).
It records source checksums, test counts and development-only module settings;
it is not certification or a production release approval.

Validation passed: 606 API library tests plus one CLI test, 10 read-only
PostgreSQL audit cases, eight actual SpacetimeDB runners including the full
platform suite, 13 bootstrap tests, 13 Railway workflow tests and 12 release
manifest tests. Preflight/release/Compose checks and changed-file formatting pass.
The three existing ignored API tests remain ignored. Final module logs contain
666 records with no errors or panics, and document/folder integrity checks pass.
The tenant-isolation fixture now retains a verified backup administrator before
revoking its caller and explicitly tests unchanged state on denied operations.

The tested development WASM hash is
`8ecc4c6ec1d417c0253bfdb293dd8ef7a34c9030968e56fef664b88b87e7d2db`.
Its actual HTTP schema matches the 0.3.122 baseline after sorting only
`misc_exports`: 515 tables, 1,452 reducers and 1,398 named types. The normalized
schema hash remains
`db9bdab0ece275882d43327b2f897df76ac4c9903790514d55cfc842003d652b`.
No new contracts release or pin is needed for this source change. Deployment
configuration generation is now 6.

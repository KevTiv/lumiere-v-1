# Accounting alpha implementation and release handoff

Updated 2026-10-18 for `codex/draft-backend-accounting-alpha-gaps`. Implementation and the coherent local 0.3.122 pin are complete, with all local checks passing. Remote contracts publication is next; service configuration, deployment and deployed acceptance remain gated. Local validation does not establish deployed accountant acceptance, provider delivery, production recovery readiness or Rwanda statutory certification.

## Implemented workflows

| Workflow | Current behavior |
| --- | --- |
| Bank settlement and approval | A reviewed bank line creates one payment and follows configured payment approval. Only successful posting and allocation mark the line matched. Immutable attempts bind the organization, company, payment, selected documents and financial snapshots; stale approval, denied authority and conflicting retry cannot apply financial effects. Native reducer calls and BFF commands enforce company access fences. |
| Closed-approval recovery | After rejection, invalidation or workflow cancellation, an authorized operator can explicitly abandon an unposted attempt or resubmit a freshly reviewed selection with a reason. Recovery retains the old payment/attempt history and creates a distinct replacement when resubmitting. It does not reopen an old task or silently retry an uncertain command. Open approvals remain pending until valid authorization closes them. |
| Coordinated bank reversal | The dedicated bank reversal validates the owned payment, allocation snapshots, explicit reversal date and open accounting period, and follows configured reversal approval. It posts a reversal entry, restores the bank line and affected invoice/clearing balances, and unwinds only the settlement's sale-order deltas. Prior payment allocations remain intact. Generic payment cancellation, reallocation and bank-line editing cannot bypass bank ownership. |
| Remaining payment balances | Clearing-line residuals drive allocated and remaining amounts in payment operations and the overview. Currency precision, source availability, payment state and row ownership are checked. |
| Invoice email and collections | Operators review the recipient, message and managed PDF choice, queue once, then explicitly send that exact message. Collections opens reviewed reminders for scoped overdue customer invoices. Durable service-bound dispatch claims prevent concurrent or uncertain sends from replaying automatically; legacy batch dispatch is disabled. See the [email runbook](ACCOUNTING_EMAIL_DISPATCH.md). |
| Bill intake and documents | Draft bill review exposes source exceptions and recovery actions. Operators can upload a managed PDF/image and attach it to the selected bill. Actor/company/bill scope, exact uploaded object, document ownership and canonical readback govern confirmation. Pending or uncertain attempts block another upload. |
| Import review | CSV review shows file counts, references, exact decimal source totals separated by currency/document type and actionable errors before commit. Tracked execution and reconciliation determine import success. Missing currency remains explicitly unresolved. |
| Period close and reports | Source failures block the relevant close checks. Report links retain the exact organization/company/period and microsecond endpoints; generation and readback require the same scope and input fingerprint. Close policy still requires only applicable reports. A report's existence does not establish current ledger or tax correctness. |
| Accounting reads | Mounted workspaces and retained recovery actions determine HTTP reads. Unavailable or redacted data stays unavailable; cached rows do not become ready evidence after scope or permission loss. Invoice detail uses a dedicated smaller read set. |

The release also preserves the published invitation/access lifecycle: trusted invitation acceptance receipts, atomic member access changes, role metadata and effective permission checks. The union retains field-write intersections and scoped projections. Payment posting/cancellation/reversal remain explicit capabilities separate from ordinary payment-record CRUD; accounting module denies apply to both. This integration is not onboarding certification.

## Supported limits

- Bank settlement supports the exact full bank amount, one partner, posted customer invoices or supplier bills, one compatible AR/AP clearing account, and company base currency in the same organization/company. Every outstanding AR/AP item of each selected document must be included. Foreign currency, refunds/netting, partial settlement of selected outstanding balances, write-offs and automatic matching remain outside this desk's supported path.
- Reversal requires the authoritative bank attempt and unchanged owned financial evidence. Unsupported or stale records fail closed; there is no manual unlink shortcut. Expired approver authority leaves an open task pending rather than creating a separate expired-task state.
- Supported posting/reconciliation use integer minor-unit checks within the pilot monetary envelope. Persisted accounting money still includes `f64`; this is not a complete money-storage migration.
- Queueing, provider acceptance and recipient delivery are separate email outcomes. Unknown provider outcomes have no automatic resend/reset. Managed email attachments are limited to 8 MiB; general attachment composition, delivery-webhook certification and issuance-time PDF archival remain deferred. Queue-token deduplication and some PDF/browser readbacks still use broader lists for large histories.
- Bill uploads support PDF, PNG, JPEG and WebP up to 20 MiB. OCR, automatic extraction and posting from uploaded bytes are deferred. Client-side unknown-link recovery survives panel remounts in the current browser session; it is not a durable journal across a full browser reload.
- Import totals aid source review; they do not prove ledger control-total agreement. Period reports do not independently certify freshness, balances, tax correctness or filing readiness. Closing remains an explicit server-validated action.
- The opt-in legacy direct subscription layer retains the union of visited resources. Removing that union and further splitting the accounting controller remain follow-up work.

## Coherent contract release

The validated local candidate is `lumiere-contracts` **0.3.122**, revision `b2c43fd99b5e0938da3f9a33908d0029cabb9163`. It combines the purchasing controls published in 0.3.120 and the invitation/access operations published in 0.3.121 with the accounting settlement/reversal and reviewed-mail changes. Existing purchasing tables/reducers and every `UpdateAccountMoveLineParams` field remain present; the two access operations, private invitation receipt table and `UpdateRoleParams.metadata` are retained.

Application pin commit `1a1b3054018b63bfbff94fb807ee669c955ec4c2` installs the candidate locally across the Rust/npm archives, lockfiles, generated metadata, presentation consumers and `release-compatibility-manifest.json`. Final application validation is recorded below; catalog and manifest verification pass. The application source branch is locally committed. Remote contracts publication and deployment have not been performed. Published operation-history snapshots are preserved in the linear union history.

| Frozen module/contract evidence | Value |
| --- | --- |
| Source commit | `44848106c3aa763c456844a4346ea717e59369e0`; `source_dirty=false` |
| Development WASM SHA-256 | `90821a463a75918bdc7669ae5baee64b836309ce009b116cc77f895868a16e95` |
| Canonical IR SHA-256 | `0656e152af761f88c2bbfd4693029196bdc3f7e0bd32af63d3ec248f92157213` |
| Schema SHA-256 | `af93dcf3cfbaa629257deea922fe9b5b0fb3843cf4c3227bf4ef48d9edd25217` |
| Canonical counts | 1,458 operations; 371 resources; 515 tables; 1,398 types |

The exact union comparison preserves both published operation/table/resource sets. Regenerated SDK and presentation trees match the bootstrap outputs; schema differences are limited to export-record ordering. Evidence: `/tmp/lumiere-0.3.122-final-canonical-evidence.json` and `/tmp/lumiere-0.3.122-union-verification.json`.

| Locally pinned package | SHA-256 |
| --- | --- |
| `lumiere-contracts-rust-0.3.122.tar.gz` | `56a5f223d36f0169bc25a4b925332a25afc9d2793f5926d30969d524bc5495af` |
| `lumiere-contracts-0.3.122.tgz` | `09c0c3d176b41f88530340c24c7e9e0d8cdfc2f729d76b33fa8bffc8346c2591` |

Candidate checks pass: Rust all features, TypeScript typecheck/build, generator drift, 30 Python emitter tests, two Rust v2 codec tests and nine Node codec/capability tests. Evidence: `/tmp/lumiere-0.3.122-local-candidate-evidence.json`.

The reviewed application migration lineage is:

| Catalog version | Migration |
| --- | --- |
| 1–16 | Existing shared lineage, unchanged |
| 17 | Purchasing keyed operations |
| 18 | Exact published invitation-acceptance durable delta |
| 19 | Bank attempt/reversal durable delta |
| 20 | Platform identity lifecycle storage |

The verified catalog is version 20 with SHA-256 `1ffe92904e13f853eff37a16d4a7a4e7ec080469f69d623982f6b1fb2fe2a9d5`; configuration generation is 5.

An existing database that recorded the onboarding branch's **platform identity lifecycle at version 17** has a different lineage from this catalog's purchasing version 17. It must stop at migration verification until a reviewed transition is supplied. Do not rewrite recorded checksums, relabel an applied migration or substitute another version-17 body to make startup pass. Versions 18/19 and the new platform entry do not repair that historical divergence by themselves.

## Validation and release gates

| Evidence | Current status |
| --- | --- |
| Accounting/bank runtime | **PASS:** all three final bank/payment domain runners on the exact frozen WASM, including recovery, coordinated reversal, prior-payment preservation, module denial and six native company-scope denials with unchanged state. |
| Access and policy integration | Independent source review passed. Hosted invitation tests: 14 pass; private routing: 3 pass; role-assignment projection: 8 pass; shared pure policy: 5 pass. **PASS:** final `run_core_sod_test` covers atomic member access, trusted invite retries, canonical/module duty checks, explicit financial capabilities and field-write intersections. |
| Accounting frontend/browser | **PASS:** final C2, COV00C/D, transport and i18n checks; 1,092 direct tests across 191 files (166 shared, 460 query-hook, 466 web), plus 785 UI tests across 119 files: **1,877 frontend unit/component tests**. The 10 bank-lifecycle hook cases are included. UI, query-hook and full-web TypeScript checks pass. **PASS:** 14 Chromium cases at 390px/1440px with intercepted APIs, including four resubmit/reversal cases covering retained attempts, scope changes and withheld compensation proof. Screenshots: `/tmp/lumiere-122-accounting-operations-artifacts`. |
| Contracts and durability | **PASS:** clean canonical generation, published-union comparison and local 0.3.122 candidate/package checks. The pin is installed in all consumers. Runtime catalog checksum, configuration example, release-manifest verification, 12 manifest tests and eight IR pin tests pass. Remote publication remains a separate release step. |
| API/auth/policy checks | **PASS:** 655 Rust tests against the local 0.3.122 pin: 578 API, 72 auth and five policy. Three tests remain deliberately ignored: two performance benchmarks and one live STDB/Postgres drill. |
| External release | Service configuration, external deployment, real provider delivery, production restore rehearsal and deployed accountant acceptance have not been established by these local tests. |

All four final runtime runner results and the exact observed module hash are recorded in `/tmp/lumiere-0.3.122-final-runtime-results.json`; database logs contain no errors or panics. Direct test counts are recorded in `/tmp/lumiere-122-direct-unit-summary.json`; Rust results are in `/tmp/lumiere-0.3.122-combined-api-auth-tests-final.log`. Workspace-local logs and artifacts under `/tmp` are temporary evidence, not a durable release record. Final release evidence must identify the exact source/module/contracts artifacts consumed by the deployed web, API and module.

Before release:

1. Publish the reviewed immutable contracts release and record its final provenance before deployment. Verify the target database migration lineage; the incompatible onboarding version-17 history still requires a reviewed transition. Keep the reviewed-mail claim and trusted invitation acceptance unavailable to generic session operations.
2. Configure and verify provider credentials, the managed PDF renderer when selected, and `LUMIERE_REVIEWED_MAIL_STDB_TOKEN` with an active per-organization `reviewed_mail_dispatcher` binding. Apply explicit persona permissions and document read/create access; do not bypass field redaction to make a checklist ready.
3. Deploy one consistent web/API/module/contracts set to the intended environment. Rehearse settlement approval/recovery/reversal, bill-document uncertainty, imports, exact-period reports and email outcomes with deployed identities and services. Record the named user's/accountant's acceptance and production recovery evidence.
4. Keep Rwanda statutory approval separate. Real RRA/VSDC exchange remains deferred pending official specifications and an approved integration/certification plan. The existing adapter stub is not statutory integration; country-pack, tax/legal review and the [Rwanda rehearsal's statutory gate](RWANDA_ACCOUNTING_ALPHA_REHEARSAL.md) still apply.

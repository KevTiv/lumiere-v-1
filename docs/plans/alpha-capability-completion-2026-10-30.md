# Alpha capability completion

Started 2026-10-30 from main `fbb9a6b56b9a93bce4cd105b85f9099b6dff87a0`.
The user authorized implementation with subagents. This register tracks code,
checks, and acceptance separately. Previous production success at `51dc5486`
does not certify these new changes or the later main revision.

## Ownership and scope

| Packet | Owner | Implementation scope | Current state |
| --- | --- | --- | --- |
| H1 | accounting_completion | Correct invoice defaults, eligibility and provenance; preserve explicit stale choices; existing trusted-history coverage | Implemented; final gates tracked in PR #331 |
| H2 | creation_completion | Atomic native custom fields for CRM, quotation, purchase order and Accounting creation; scoped durable creation receipts and uncertain-save recovery | Implemented; final gates tracked in PR #331 |
| H3 | expenses_completion | Authorized saved allocation readback and retained edits; validated employee/currency inputs | Implemented; final gates tracked in PR #331 |
| H4 | billing_completion | Exact closure/renewal evidence; idempotent renewal and readback through existing amendment owner | Implemented; final gates tracked in PR #331 |
| H5a | documents_completion | Authoritative retention preview; recipient exclusions and actual provider delivery receipts | Implemented; final gates tracked in PR #331 |
| H5b | assistant_completion | Existing independent-review guide adapter, source freshness and bounded contextual error help | Implemented; final gates tracked in PR #331 |
| Integration | coordinator | Shared projections, registries/codegen, contract release, translations, test registration, independent review and PR evidence | Implemented; final gates tracked in PR #331 |

Final hosted gate outcomes and any subsequent evidence are recorded in
[PR #331](https://github.com/KevTiv/lumiere-v-1/pull/331). This file records the
implementation checkpoint without creating another source revision for each CI result.

Each owner uses a separate worktree. Shared generated artifacts and immutable
contract versions are integrated once by the coordinator. Domain code remains
with its canonical transaction, authorization, evidence and receipt owner.

## Reconciled dependencies

- Merged PR #328 owns general-journal import readiness and is included here.
- Open #325/#326 own legacy skill discovery and form-proposal decoding.
- Open #312/#313 own wider translation coverage; new keys here remain localized.
- Open #251 owns WhatsApp provider changes; this packet only reads existing evidence.
- Main already contains #318–#323 and #327. Their accepted work is preserved.
- H2 also covers an additional Accounting create-then-patch custom-field path
  found during implementation. The initial handoff only named commercial paths.

## Acceptance boundaries

Known unsupported capabilities remain explicit: no contractual subscription end
date is stored by the current native model; a next-invoice date is not an end
date. A new term policy is outside this packet. Notebook account sync/execution
and optional integration activation remain deferred.

No real purge, provider send/charge, or production financial write is authorized
by a local test. Use isolated fixtures and actual service evidence for economic
effects. Independent accountant/device acceptance remains outstanding until a
human reviewer completes it against the served candidate.

## Completion evidence

Record each integrated commit, tests, contract version, PR and unresolved case
here before describing the packet as complete. An implementation or synthetic
test pass is not deployment, production financial acceptance or human review.


## Integration checkpoint

Current main through `5956b38b` (including #328 journal import readiness) is
integrated. Independent owners reviewed each other's native transaction,
permission, receipt and stale-context boundaries. Production is unchanged.

The wave includes Accounting atomic custom fields, saved allocation CAS,
creation/renewal recovery, reviewed purge, canonical exclusion/provider evidence,
source-authorized guide review, and scoped Purchasing discrepancy/currency views.
Native fixture currencies now use actual organization-owned currency identities;
no FX rule or financial assertion was relaxed to accommodate sentinel IDs.

A private `record_creation_receipt` is the single new durable table. The strict
census remains exact: 524 tables, all organization owned, with five existing
persistence protocol relations. Generated migration 30 is frozen in the ledger
and registered in the application catalog; migration 29 and prior checksums
remain unchanged. The established release workflow published and pinned immutable contracts
`0.3.159` in run `41114895044`, including clean regeneration/drift verification. The first release attempt correctly rejected the
unregistered pending migration, before publishing a contract tag.

The exact hosted production-profile module from commit `1b2eb6cc` passed all
seven isolated native suites: configured creation, Accounting, Expenses,
Subscriptions, Documents, Messaging and guides. The ZIP artifact is
`13005350711`, SHA-256
`7d33a40558693fd9f0047adaa177d7d771db3740a28878e6bef6b5d6af702c52`;
the module SHA-256 is
`39c9e435b00b81d6427fc9b1a67de0062d2c17a1bcbdf046864e7b838baf495a`.
The subsequent fixes in this checkpoint do not change native module sources.
The original local builds exceeded memory; acceptance uses this successful
canonical hosted build instead. Earlier fixture currency failures were corrected
without weakening their economic assertions.

Integrated query-hooks passed 576 tests, ERP-shared 170, registered web helpers
142, STDB transport files 8, presentation-core files 3 and guide helper files 2.
After correcting the missing exclusions-hook fixture and adding three explicit
evidence-denial cases, the full UI rerun at `095cf893` passed all 1,472 cases
across 212 files. The focused fixture also passed lint with zero warnings.
The Purchasing type-debt baseline decreased from 2,261 to 2,244 occurrences.
The codegen ledger checksum test passes and regeneration classifies exactly 524
tables with all 15 ledger migrations released. Final API-source regression
execution passed all 30 cases: creation recovery 9, expense allocation 13,
retention 6, exclusion capture validation 1 and the actual Rust application
catalog checksum check 1. This local build used the pre-release 0.3.158 bindings;
matching-pin hosted validation remains required. A first local HTTP fixture run
was denied loopback binding by the execution sandbox; the unchanged tests passed
when run with loopback network access. All eleven workspace, web and mobile typechecks passed serially against the
verified 0.3.159 archive. The employee-default field union and a Purchasing
fixture type were corrected, with 22 focused cases and zero-warning lint passing.
The real PostgreSQL C4 group passed all 12 cases on the pre-pin source, including
the named 29→30 receipt preservation/restart case. Final matching-pin hosted
gates, browser regressions and real-service guide acceptance remain required
before the draft PR is ready; their results are recorded on PR #331.

Known limits: Lead records retain their existing organization-shared schema,
while operating-company admission, custom values and recovery receipts are exact.
Trusted history covers explicit journal-line updates/additions; deletions,
automatic lines and broader economic correction/history families remain excluded.
Contractual subscription end dates, a trusted product/workflow guide compatibility
registry, Notebook account sync/execution and optional provider activation remain
outside this wave. English-alpha behavior is the target; new common recovery keys
use explicit English fallback in partial locale packs where translations are not
supplied. Independent accountant/device and served-release acceptance remain open.

## Integration after import-review storage

Main `d9a14a21` adds the source-review workspace and three PostgreSQL-only
platform tables. Its ordered production release `41130971634` completed storage
migration 30 before this branch was merged. That migration's name, change set,
SQL and checksum remain unchanged. Creation receipts therefore use application
migration 31, change set 20, referencing the unchanged generated ledger SQL
`0030_durable_projection_delta.sql`. Generated and application migration numbers
are separate identities; immutable contracts `0.3.159` remain valid.

The root application catalog is version 31, checksum
`sha256:ece6a58a3b87d41e3cc3c5e3afd55b1c02628f9da3e393169002c55460a9eb85`.
Upgrade coverage follows guides 29, deployed import reviews 30, then receipts 31,
preserving source reviews, prior rows, receipt IDs and history through restart.
A disposable database containing the earlier unmerged receipt-based application
migration 30 must fail closed. No automatic history rewrite or production data
repair is introduced. Published SQL, tags and archives are unchanged.
The release verifier checks each generated SQL filename and checksum against
an actual catalog reference, so an application number alone cannot admit an
unregistered generated migration.

Confirmed source handoffs now stay inside the mounted import wizard. Loading
another source requires confirmation for an idle draft and preserves the current
file and mapping on cancellation. Active or unresolved imports block replacement;
the existing request identity and result-check/retry owner remain intact. The
wizard rechecks current work after confirmation before replacing any draft.

The Sales browser fixture now reads the canonical quotation receipt for its
submitted operation key and uses `recordId`; the former receipt endpoint and
receipt-ID assumption are retired. The configured-lead browser case exercises
required-field rejection, atomic values and receipt, lost-response recovery and
reload without a second create. Final integrated results remain on PR #331.

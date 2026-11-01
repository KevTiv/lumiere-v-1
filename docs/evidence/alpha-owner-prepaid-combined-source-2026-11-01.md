# Owner allowance and prepaid source candidate

Status: REVIEW, contract-dependent native foundation. Base `04d8541e4`.
No live cap, credit, price, grant, provider or farm record was changed.

The combined native candidate preserves one managed organization pool, the
existing spend reservations and original company attribution. Owner limit and
shared-agent edits have revision guards and actor-bound immutable receipts.
Company-delegated administrators are denied. Legacy sponsored cap increases
cannot exceed the recorded existing ceiling. Missing legacy periods remain
unfunded; an owner cap does not renew sponsored money.

Prepaid funding requires both a dedicated organization service binding and a
narrow permission. Accounts start disabled and unfunded. Explicit one-way
cutover preserves earlier sponsored use and all open holds. Credits and linked
reversals are immutable and idempotent. Every new reservation checks available
credit and the monthly budget inside the same reducer transaction. Settlement
and release use the original reservation rows, so no second debit authority
exists. An unknown provider outcome retains its reservation. Deficits block
new calls while settlement remains available.

After trusted prepaid activation, the owner may raise its cap above the earlier
sponsored ceiling. The same credit check still bounds every provider request.
The combined native case covers legacy/disabled denial, cap replay, exhausted
credit, held funds, settlement and unchanged funding and price entries.

## Source validation

- Six focused owner-policy tests and five prepaid arithmetic tests pass.
- The readiness worker also ran seven focused combined policy/arithmetic tests.
- The first prepaid module `cargo check --locked --offline --tests` passed
  before the final pool and combined edits. A later owner candidate check
  found two fixture clone errors, which were corrected.
- Final combined module compilation and native reducer execution remain
  pending. The local disk constraint stopped further builds; prior checks do
  not certify the final combined tree.
- Formatting, diff checks, source-bound manifest checks and the generated
  Finance change-review inventory pass.
- The isolated module CI lane now explicitly calls the owner configuration and
  prepaid test runners before contract drift verification. These native cases
  have not been marked passed merely because they are registered.

## Required follow up

Publish new generated contracts through the normal reviewed release, align pins
and generated consumers, then wire authenticated API/UI reads and writes. The
branch name suppresses automatic immutable publication. Contract drift cannot
pass against the old pin until that release is approved and applied.

Automatic funded month rollover remains deferred. The current native path
requires an existing provisioned month even after prepaid activation. Add
funding-aware rollover with old-month settlement tests before claiming that
part of the plan complete.

The legacy native `configure_ai_spend` pricing/provisioning authorization is a
separate paid-release blocker. The new commands have no price inputs, but do
not remove that legacy authority. Harden the trusted pricing/sponsor boundary
before paid cutover. No verified-payment adapter, checkout, top-up UI or real
payment recognition is implemented here. Funding entries represent approved
sponsored grants, not fabricated customer payments.

These are source foundations. They do not establish paid production readiness,
owner UI acceptance, full platform certification or the requested live USD 10
cap. The last verified live cap remains USD 5.

## Contract generation repair

Release 41306256015 built the native module, then stopped before publication:
the storage census still expected 524 tables and the four new tables had no
storage policies. The funding table also lacked an organization-leading index.

The source repair adds all four always-hot policies, preserves every earlier
policy and reviewed fixture, adds the funding organization index, and advances
the strict storage and ownership censuses to 528 (523 application relations and
five protocol relations). The pending durable migration is reserved as 33 so
it does not reuse the existing application catalog 31/32 numbers. All released
SQL remains unchanged. Exact generated SQL was subsequently promoted and added
to catalog 33 as described below; the workflow gate remains intact.

The full code-generator test suite passes 143 tests, with its existing ignored
test unchanged. All 13 Python ownership tests pass. A failure-only release
artifact now retains the exact generated manifest and migration SQL to support
that review and promotion. No migration was applied to Railway.


## Canonical migration and operation repair

The second generation attempt passed storage coverage, then exposed missing
operation metadata. All nine new native exports (seven reducers and two views)
now have canonical identities and authored classifications. Existing identities
remain unchanged. Both source registries cover the same 1,505 names.

Canonical generation passed locally using the actual CI-built module from
`dc1edbc250f655ed05eaea1b1720888b48dfc064`, fresh Rust/TypeScript SDKs and its raw
schema from a disposable in-memory localhost database. That database was stopped
and its temporary data/config removed. The schema is unchanged by the later
owner-reason null-byte validation fix; six focused actual-function tests pass.

The canonical migration 33 SQL has checksum
`sha256:d11af0da114e9bb496cd6a29c42e80034765e4dfbcdfee760d183e9ee7ea2f2f`.
It matches the earlier hosted schema plan exactly. The exact generated bytes
were promoted to the ledger and application catalog 33/change set 22, with
pending advanced to 34. Review found four tables, 43 columns and eight indexes,
with no data writes. Every existing released SQL file remains byte-identical.

All 143 code-generator tests and 13 ownership tests pass. Five isolated tests
extracted from the actual application migration owner pass, including manifest
binding, ordered catalog identities, migration 33's exact SQL checksum and the
unchanged first-32 catalog checksum. This is not a full api-server build or
PostgreSQL execution result. Application catalog 33 checksum is
`sha256:488b5e004dadaf81a5891c5e9c408053855ba884be62dd59bda2c1d62682b843`.

Canonical regeneration after promotion passed: all 16 migrations are released
and no pending 34 delta exists.

Final publication, consumer pins and native compilation from the completed
branch are checked by the subsequent normal release run. No Railway migration
or live funding/configuration change is part of this repair.

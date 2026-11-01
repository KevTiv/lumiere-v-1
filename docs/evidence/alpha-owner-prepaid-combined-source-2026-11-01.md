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

- Five current owner-policy tests and five prepaid arithmetic tests pass.
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

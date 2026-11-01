# Alpha AI prepaid native foundation

Status: source candidate. Contracts and runtime acceptance remain required.

The module adds one opt-in prepaid pool per organization. Funding entries are
immutable approved sponsored grants or linked reversals. These are not payment
receipts. No grant, service binding or credit balance is provisioned by default.

The funding principal must hold an active exact `ai_credit_funder` organization
binding and `ai_credit/manage`, `ai_credit/fund` or `ai_credit/reverse` permission.
Owner wildcard permissions alone do not permit funding. Generic session dispatch
explicitly denies all three operator reducers.

Accounts start disabled and unfunded. A one-way enable operation records prior
settled usage as the sponsored opening baseline and requires funding to cover
all existing holds, including earlier months. It rejects another enabled pool or
another agent's open holds. There is no disable/reset command. Existing runs and
monthly budget counters remain unchanged.

New reservation admission checks monthly allowance and prepaid credit within the
same module transaction. The original reservation rows own held and settled use;
there is no duplicate debit table or worker-side balance authorization. Existing
settlement and proven pre-dispatch release update that canonical projection.
Unknown outcomes remain reserved. Refunds can expose a deficit and block new
calls while existing commitments can still settle. Another agent cannot bypass
the funded pool after cutover.

An operation key binds organization, source reference, account, grant/reversal,
amount, original grant and caller identity. Conflicting replays are rejected.
Reversal totals cannot exceed the original grant. Monthly allowance is never
changed by funding. Currency is USD for this alpha source slice; customer retail
pricing and provider costs are not conflated by a new pricing policy here.

The private projection scans the organization's reservation history and its
account's funding history with a 100,000-row bound. Above that bound it blocks
new admission with a reconciliation error rather than ignoring commitments.
A future audited checkpoint/index is needed before that scale; settlement and
release do not depend on this scan. No private funding rows are exposed through
unrestricted query views.

Validation includes standalone checked-arithmetic tests and native reducer test
cases registered in `run_all_ai_tests`. The native cases cover owner denial,
funding replay and reversal limits, one-way cutover, insufficient funds, preserved
monthly counters, settlement after reversal, prior-month holds, proven release,
and exact settlement/release replay. Native compilation and actual in-module
execution are separate gates; compilation is not a live payment or AI acceptance
result.

This changes module schema and reducer metadata. It requires the normal immutable
contract generation/release and aligned consumer pins before deployment. No
manual generated-contract edit, Stripe integration, live funding, temporary
administrator or provider call is included.

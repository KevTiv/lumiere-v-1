# AI owner configuration native foundation

Status: REVIEW, source candidate only. Base `04d8541e4d4cfea61bcf5af4144ab054f33eb878`.
No runtime limit, funding, agent scope, credential, price or grant was changed.

## Canonical path and effect identity

The current generic session path keeps the user's STDB token and dispatches only
released generated operations. `configure_ai_spend` is denied there and also
appends prices. Calling it with a server identity does not establish a human
owner. This packet leaves that full operation denied and adds two narrow native
owners. API/UI wiring is deliberately deferred until their generated contracts
are released and pinned.

- `set_ai_owner_limit(org, agent, params)` updates an existing exact current UTC
  budget ID. Parameters are budget ID, expected configuration revision, expected
  limit, requested integer limit, request key and reason. No currency, prices,
  funding, spent or held counters are caller inputs.
- `share_ai_owner_agent(org, agent, params)` widens an existing company agent to
  organization scope only. It takes budget ID, expected revision, expected
  existing company ID, request key and reason. It cannot choose another
  organization, move the agent, narrow it to a different company, change skills
  or rewrite existing run attribution.
- Both require a current active human identity, `ai_agent:write`, an unambiguous
  organization membership and administrator authority through the existing
  `effective_roles` and `member_is_admin` owner. An active company-delegated
  administrator is explicitly denied through the canonical delegated-scope
  resolver before either organization-wide command. There is no service bypass or
  role-name heuristic. Audit actor comes from `ctx.sender()`.

The private configuration row has one agent primary key, organization, revision,
monthly limit/currency policy, a sponsored ceiling and write actor/time. The
sponsored ceiling is captured from the existing approved period budget, never
from owner input. An owner can lower or restore within it. An unbounded increase
is rejected. Higher prepaid-backed owner caps need the separately reviewed
funding integration; the numeric cap never grants sponsorship or credits. A missing row means revision
zero before the first approved edit. Each edit creates one private immutable
receipt bound to organization/request key, agent, actor and the exact command
payload hash. Same-key replay is read before stale-revision checks, after current
permission checks. A changed payload or actor rejects. Duplicate receipts fail
closed. Successful replay never advances revision or writes another audit row.

Two sender-scoped read views reuse the existing active AI spend-reader binding.
They expose configuration values and receipt identity/result metadata, not the
reason or actor payload. A future authenticated owner API must check current
owner permission before reading through that dedicated reader; a request body
must not supply an actor or service credential. Generic direct session reads of
these private tables are not introduced.

## Spend and monthly boundaries

Limit updates reject a lower amount than settled plus outstanding spend, with
checked integer arithmetic. Existing currency, prices, budget ID, reservations,
provider attempts and usage counters remain intact. The existing pricing
provisioner can append reviewed prices, but cannot alter a managed limit or
currency; it must use the owner command for an allowance edit.

One managed pool is permitted per organization. Initial adoption rejects another
active funded agent or another agent's current-period usage/holds. Once adopted,
configuration and reservation guards reject other agent pools. This foundation
does not claim general multi-agent aggregate billing.

An owner-selected recurring numeric policy is not recurring funding authority.
The standalone candidate requires an already provisioned current UTC period.
A missing period fails closed for managed and unmanaged agents. Existing periods
must match the managed limit/currency and are never reset. Historical periods
and holds remain unchanged. Exact accepted-reservation replay precedes mutable
pool/period checks, after permission and payload validation; it cannot redispatch
a provider or reserve again. Later settlement still uses the original period.

Prepaid-enabled first-use period creation may be integrated only with the exact
enabled account and funding admission in the same reservation transaction. That
combined behavior is not implemented or claimed here. No scheduler, funding,
credit balance or trusted ceiling-increase operation is added. Sharing the agent
alone does not activate any company's skills or bypass normal authorization.
The live USD 5 to USD 10 increase therefore needs a reviewed sponsorship/funding
boundary and the later owner API/UI; this candidate has not applied it.

A further pre-existing boundary needs review before promotion:
`configure_ai_spend` is generic-session denied, but its native permission is
`ai_agent:write`, which an organization owner may hold. Direct native dispatch
can still supply provider prices. The narrow new commands have no price inputs,
but closing that legacy path requires an independently trusted provisioning
principal, not a wildcard grant for the user or server. This candidate does not
claim that existing native pricing authority has been fully separated.

## Verification

Four pure tests pass by extracting the exact `validate_request`, `next_revision`
and `validate_limit` functions and their in-file test module, then executing:

```text
rustc --edition 2021 --test /private/tmp/ai-owner-config-policy-tests.rs -o /private/tmp/ai-owner-config-policy-tests
/private/tmp/ai-owner-config-policy-tests
```

These cover committed-spend and arithmetic overflow, stale/overflowed revision,
bounded request input, and sponsored-ceiling rejection/restoration. They are not native transaction or authorization
proof. Changed-file Rust formatting, `git diff --check`, and the canonical
`finance-skill-manifests.py --check` pass.

Actual native tests are added to `run_all_ai_tests`, using real module database
fixtures and invoking the reducers. Cases cover exact same-key replay, changed
payload, stale revision, cross-organization scope, ordinary editor/inactive
principal rejection, attribution and audit cardinality, cap floor, price and
usage preservation, same-agent scope sharing, reader registration/retirement,
legacy missing-period denial, replayed reservation after a pool change, old-period
holds, sponsored-ceiling rejection/restoration, and company-delegated admin denial. They are prepared for hosted execution but have
not run locally. A cached offline module `cargo check --locked --offline --tests`
was attempted and found two test-fixture errors (`UserProfile` has no `Clone`).
Those fixtures now move/re-read/restore their flags. No second compile ran after
the disk reached the critical threshold, so final module compilation is unverified. No browser, live provider or payment test ran.

## Release dependency and remaining work

Two private tables, two read views, two parameter types and two reducers need
canonical schema ownership/census/ledger review, generated contracts and an
immutable release with aligned pins before API integration. Only the canonical
source exposure manifest classifies the two new narrow commands as session
operations; no generated artifact is hand-edited. Native operation descriptors,
read types and exposure output are still absent from the pinned contract.

Keep this branch under `codex/draft-backend-` before pushing so automatic contract
publication cannot run. No immutable publication or production deployment is
authorized by this source preparation.

Next: compile and execute the native tests; generate/review the compatible
contract candidate through the owning release lane; then implement the typed
owner read/update UI with exact receipt recovery using the human session token.
Report source, deployment and live owner acceptance separately. This candidate
does not claim that the live USD 5 cap became USD 10, that the shared agent was
applied, or that any credits were funded.

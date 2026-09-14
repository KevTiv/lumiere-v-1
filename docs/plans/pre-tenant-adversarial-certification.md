# Pre-Tenant Adversarial Certification

Status: draft (branch `test/pre-tenant-adversarial-certification`, cut from `main` @ `06c9c82a0`).

## Purpose

Before the first real customer, deliberately attack the failure classes a first tenant would
otherwise discover: concurrency, stale state, permission drift, provider callback disorder,
mobile-network instability, payment ambiguity, AI partial execution, duplicate submission, and
reconstruction/replay.

This suite **supplements, and does not replace**, real-tenant piloting. Real tenants are still
required to discover workflow ergonomics, market terminology, policy assumptions and unanticipated
business behaviour. The suite certifies correctness and failure behaviour only.

Non-goals: no product scope expansion, no webshop/e-commerce, no refactor of communication or
money models, no changes to the open stacked PRs.

## Invariants

| Id | Invariant |
|----|-----------|
| AUTHORITY | No stale/custom/AI artifact may widen current permissions. |
| IDEMPOTENCY | Retries, double taps, provider callbacks and reconnects cause one business effect. |
| MONEY | Allocations, unapplied balances, fees and reversals reconcile exactly (minor units). |
| COMMUNICATION | One business message intent has traceable attempts, provider events and timeline state. |
| STALE STATE | Old UI, IR definitions and action drafts cannot overwrite newer authoritative state. |
| RECOVERY | Projection/reconstruction cannot redispatch or duplicate consequential work. |
| TENANCY | Every invariant above remains organization- and company-isolated. |

## Layer ownership

| Layer | Owns | Location | Gate today |
|-------|------|----------|------------|
| STDB in-module certification | Reducer-level IDEMPOTENCY, MONEY, COMMUNICATION, STALE STATE, TENANCY; seeded state machines | `spacetimedb/tests/pretenant/*` run from existing domain reducers | Compiles in blocking `cargo check --tests`; executes in the E2E domain-reducer loop |
| Native Rust unit/property | Money representation envelope; defect-registry ↔ plan consistency | `spacetimedb/tests/pretenant/{money,mod}.rs` `#[cfg(test)]` | Blocking candidates (`make pretenant-cert-native`) |
| api-server | Webhook authenticity/freshness, BFF operation boundary, draft HTTP revision conflicts | `api-server/src/routes/*` unit tests (existing) | Existing CI |
| ai-gateway | Tool protocol fuzzing, per-call reauthorization, ambiguous provider timeout, budget reservation | `ai-gateway/src/orchestrator/agent_loop_tests.rs` on the AI stack | Pending PR #23/#24/#26 |
| presentation-core | IR definition corruption, versioning, pins | `crates/presentation-core` on the IR stack | Pending PR #13/#19/#25 |
| Playwright (production Next.js) | Operator-level separation of duties (two sessions), true request concurrency, lost responses, latency/offline, responsive reachability, capability-gated IR/agent acceptance | `frontend/web/tests/e2e/pretenant-*.spec.ts` | Optional/nightly/manual (`make e2e-pretenant`) |

Raw reducer calls are used only for precise setup and fault injection; they are never counted as
operator acceptance. Separation-of-duties proofs use two authenticated sessions. No superuser
shortcut is used to prove ordinary-user behaviour (the in-module layer runs as a test superuser and
therefore certifies reducer invariants, not RBAC).

## Repository state inspected

Open stacks (all draft, none assumed merged):

- Frontend/presentation IR: #13 `codex/frontend-ir-foundation` (base `main`) → #19 saved-draft
  snapshots → #25 save/reopen.
- AI harness: #14 (base #13) → #15 typed tool transport → #16 → #17 governed capability codegen →
  #18 → #20 capability pin → #21 → #22 verified catalog/authorized tool view → #23 bounded agent loop
  → #24 H5a per-call policy/approval stops → #26 H5 budget and draft persistence.

Existing coverage reused (not duplicated): `crm::deferred_test::test_crm_whatsapp_inbox`,
`accounting::payment_management_test` (ACC-RI-004 allocation retry/reversal),
`core::operational_messaging_test`, `api-server/src/routes/whatsapp_webhooks.rs` unit tests,
`operational-messaging.spec.ts`, `mobile-money-payments.spec.ts` (fixtures extracted to
`payment-fixtures.ts` for reuse), `bank-statement-import.spec.ts`, `crm-duplicate-merge.spec.ts`,
`ai-harness-policy.spec.ts`, `mvp-ai-action-draft.spec.ts`, `auth-permission-enforcement.spec.ts`
(limited-actor provisioning pattern), PR #13 `validation_tests.rs`, PR #25 stale-conflict spec and
`check-presentation-draft-http.py`.

## Execution constraints and conventions

### No new reducers

Every `#[spacetimedb::reducer]`, including test reducers, is part of the pinned generated contract
(`lumiere-codegen/contract-operation-ids.json`, `crates/stdb-client/src/generated_reducer_contract.rs`).
Certification cases are therefore plain functions called from existing domain test reducers:

- `run_core_operational_messaging_test` → COMM-* and SM-01
- `run_accounting_payment_management_test` → PAY-* and SM-02

Only reducer bodies change; no persisted table, operation, storage policy or contract changes.

### Strict known-defect registry

Cases assert the **correct** invariant. When `main` violates it, the case id is registered in
`KNOWN_DEFECTS` (`spacetimedb/tests/pretenant/mod.rs`) and in the table below:

- still failing → logged `KNOWN-DEFECT` (pre-tenant blocker), run continues;
- now passing → the run fails until the entry is removed (the fix becomes blocking);
- setup failure (`SETUP …`) → the run fails, so fixture drift cannot hide behind the registry.

Playwright uses the same rule through `expectKnownDefect(caseId, summary, assertion)`: only the
invariant assertion block may fail (recorded as a `known-defect` annotation); setup failures fail the
test, and an invariant that now holds fails the test until the registration is removed. `test.fail()`
is deliberately not used because it would also absorb setup failures.

### Capability gating

`frontend/web/tests/e2e/pretenant-support.ts` defines capabilities with self-flipping probes:

- `route` — BFF route exists (non-404);
- `reducer` — reducer name/pattern present in the generated `lib/reducer-names.ts`;
- `source` — prerequisite source path (optionally containing a marker) exists in the checkout.

Unavailable → `test.skip()` with the exact prerequisite PR/milestone. Available → the test runs. Where
the landed contract has not yet been inspected, the body calls `pendingContract()`, which **fails**
with a pointer to this plan; it never silently passes. There are no unconditional skips.

### Tags

`@pretenant` `@adversarial` plus area tags `@communications` `@payments` `@mobile`
`@presentation-ir` `@agent-harness` `@recovery`, and `@capability-pending` for gated tests.

## Phase 1 — Communications normalization audit

### Canonical ownership (as implemented on `main`)

| Concern | Canonical owner | Other representations / gaps |
|---------|-----------------|------------------------------|
| Message intent | `OperationalMessage` | User-authored outbound `CrmConversationMessage` rows are intents without an `OperationalMessage` until a provider callback links them. |
| Recipient snapshot | `OperationalMessage.contact_id` + `phone_identity_id` | Stored **by reference**: `update_contact_identity` changes `normalized_e164` under the same id (COMM-14). No value/hash snapshot. |
| Channel | `OperationalMessage.channel` | Duplicated on `MessageBatch` and `CrmConversation`; scope checks compare them. |
| Provider attempt | **none** | No attempt table; no outbound dispatch exists on `main` or any open PR. |
| Provider message id | `CrmConversationMessage.provider_message_id` | Org-scoped uniqueness by scan (no unique index); relies on serialized reducers. |
| Provider event id | `CrmProviderEventReceipt` (account + event id + fingerprint + kind) | No unique index; replay check by scan. |
| Delivery status | `OperationalMessage.status` (intent) and `CrmConversationMessage.status` (timeline) | Two representations updated together; SM-01 asserts they agree. |
| Conversation | `CrmConversation` (`external_thread_id` binding by trusted principal) | — |
| Timeline entry | `CrmConversationMessage` | `MailMessage` chatter is separate; invoice reminders do not appear on the invoice chatter. |
| Consent | `ContactCommunicationPreference` (contact/company/channel) | Also `ContactPhoneIdentity.verification_state = OptedOut` and `core::privacy::PrivacyConsent`; `contact_can_receive` reads only the first two and does not scope by organization (COMM-13). |
| Approval | `MessageBatch.approved_by/at` | No independence rule (COMM-11), no content binding (COMM-09), no revalidation (COMM-06/07/14). |
| Audit | `audit_log` via `write_audit_log_v2` | Messaging, inbox and payment reducers do not record organization commits (see Phase 8). |

### Canonical rules decided by this suite

1. **Monotonic delivery.** Rank `queued < sent < delivered`; `failed` is terminal and reachable only
   from `queued`/`sent`. A later callback may never lower rank or swap terminal states (COMM-04, SM-01).
2. **Stale callbacks are absorbed.** An authentic, well-formed but stale callback records its receipt
   and returns success without changing state, so the provider stops retrying (COMM-05).
3. **Exact replay idempotent, conflicting replay fails closed.** Same event id + same fingerprint +
   same kind → no-op; any difference → rejection with no ledger/state change (COMM-01/02).
4. **Provider message ownership is unique** per organization (COMM-03).
5. **Consent is revalidated at the dispatch boundary.** On `main` approval is the last boundary before
   copy/queue, so approval must revalidate. Preview is never a capability lease (COMM-06).
6. **Recipient identity is an immutable snapshot.** If the snapshotted identity is archived or its
   number changes, approval/dispatch fails closed; a new batch (re-resolution) must be approved
   (COMM-07, COMM-14).
7. **Approved content is immutable.** Approval binds rendered content; template edits never change
   rendered messages (COMM-08 holds for invoice reminders; COMM-09 fails for contact batches).
8. **Merge keeps one timeline.** After A→B merge, provider events continue on the same conversation
   under B; events still addressed to A fail closed (the webhook adapter must resolve
   `merge_target_id`) (COMM-10).
9. **Independent approval.** A batch creator cannot approve it; a second approval by the approver is
   idempotent; simultaneous approvals execute once (COMM-11, COMM-11-E2E).

### Ambiguous outbound timeout

Not implementable on `main`: no reducer or route dispatches WhatsApp/SMS (v1 records copy/queue
intents only). Mandatory future case `COMM-OUT-01`, capability-gated in
`pretenant-communications-adversarial.spec.ts` on any `dispatch_*/send_*` messaging reducer. Acceptance:
one provider-visible intent per business message (stable provider idempotency key), one timeline
effect, retry idempotent, and a timeout leaves an explicit `unknown` attempt reconciled by callback —
never a blind resend.

## Phase 2 — Mobile-money / payments

Accounting remains the sole ledger source of truth; every case asserts ledger rows (ledger payment,
move residuals, clearing residual) rather than operational rows alone.

**Money representation.** Operational amounts are `f64`; admission uses an absolute
`RECONCILIATION_EPSILON = 1e-6`. The native model (`money.rs`) shows exact agreement with integer
minor units for 0-, 2- and 3-decimal currencies up to 1e8 major units, and demonstrates that from
~1e10 major units the epsilon is below f64 resolution so admission becomes exact float comparison
(`MONEY-PRECISION`). The in-module PAY-09 case (a 12,345,678,901.23 payment settled by two
allocations) passes on `main`, so the divergence is proven for the admission rule in isolation, not yet
reproduced end-to-end through the ledger. Not changed in this PR. Pre-tenant position: acceptable for the SME pilot
envelope only if tenant limits stay below 1e9 major units per payment; otherwise a blocker requiring
integer minor units/decimal.

**Statement CSV parsing is client-side** (`payment-operations-panel.tsx`, file-private, not
unit-testable without extraction). Server staging cases are PAY-10/11. Client findings (documented,
not executed here):

- `CSV-01` `parseStatementAmount("1.234,56")` → `1.23456` (European thousands + decimal comma misparsed silently).
- `CSV-02` `parseStatementAmount("1,234")` → `1.234` (US thousands separator read as decimal comma).
- `CSV-03` `NN/NN/YYYY` is always read as DD/MM; US exports are silently mis-dated.
- `CSV-04` the import idempotency key is a 32-bit hash of the file; combined with PAY-11B a collision
  silently drops a different statement.

## Coverage matrix

Legend — Class: **C** covered, **P** partial, **N** not covered, **B** blocked by open-PR functionality.

### Communications

| Case | Existing coverage | Missing coverage | Best layer | Runs on main? | Prerequisite | Implementation | Class |
|------|-------------------|------------------|-----------|---------------|--------------|----------------|-------|
| Exact inbound replay, conflicting inbound replay, cross account/org/company, inactive principal | `deferred_test::test_crm_whatsapp_inbox` | — | STDB | yes | — | reused | C |
| Webhook signature/freshness/metadata stripping | `whatsapp_webhooks.rs` tests | — | api-server | yes | — | reused | C |
| Event id reused across kinds; conflicting delivery replay | — | all | STDB | yes | — | COMM-01 | N |
| Duplicate delivered callback (new event id) | exact delivery replay only | single-effect proof | STDB | yes | — | COMM-02 | P |
| Same provider message id across two messages | — | all | STDB | yes | — | COMM-03 | N |
| Out-of-order callbacks (delivered→sent/failed, failed→delivered, dup sent, delivered before sent) | — | all | STDB + state machine | yes | — | COMM-04, COMM-05, SM-01 | N |
| Ambiguous outbound timeout | — | all | api-server worker + E2E | no | outbound dispatch capability | COMM-OUT-01 (gated) | B |
| Consent race (opt-out after preview) | preview exclusion (P1-MSG-02, core test) | revalidation at approval | STDB + two-session E2E | yes | — | COMM-06, COMM-06-E2E | P |
| Phone identity changes before dispatch | — | archive and number-change paths | STDB | yes | — | COMM-07, COMM-14 | N |
| Template change after approval | — | immutability proof | STDB | yes | — | COMM-08, COMM-09 | N |
| Contact merge with active provider conversation | merge UI (`crm-duplicate-merge.spec.ts`) | timeline continuity | STDB | yes | — | COMM-10 | P |
| Independent approval | single actor lifecycle (P1-MSG-02) | creator denial, approver, retry, simultaneous | STDB + two-session E2E | yes | — | COMM-11, COMM-11-E2E a–d | N |
| Batch/consent tenancy | `crm-read-isolation.spec.ts` (reads) | mutation and recipient scoping | STDB | yes | — | COMM-12, COMM-13 | P |

### Payments

| Case | Existing coverage | Missing coverage | Best layer | Runs on main? | Prerequisite | Implementation | Class |
|------|-------------------|------------------|-----------|---------------|--------------|----------------|-------|
| Concurrent allocation 80/50 on 100 | single allocation + retry (ACC-RI-004) | interleaving + true concurrency | STDB + E2E | yes | — | PAY-01, SM-02, PAY-01-E2E | P |
| Allocation retry after commit | ACC-RI-004 receipts/audit | — | STDB | yes | — | reused | C |
| Post retry after lost response | — | single effect, idempotent success | STDB + E2E | yes | — | PAY-02, PAY-03, PAY-02-E2E, M-02 | N |
| Reversal retry | — | single compensation, idempotent success | STDB | yes | — | PAY-04, PAY-05 | N |
| Statement approval retry | `bank-statement-import.spec.ts` (approve twice) | — | E2E | yes | — | reused | C |
| Duplicate refs: same account / normalized variant / distinct account / cross-company forgery | `payment_management_test`, P1-PAY-02 | cross-organization scope | STDB | yes | — | PAY-07 | P |
| Overpayment → explicit unapplied | — | all | STDB + E2E | yes | — | PAY-06, PAY-06-E2E | N |
| Provider payer mismatch → manual review | — | all | STDB | no | payer identity on `PaymentTransaction` | PAY-PAYER-01 (gated) | B |
| Reversal/chargeback after settlement | supplier reversal (P1-PAY-03), partial allocation reversal (ACC-RI-004) | full customer settlement + immutability + retry | STDB | yes | — | PAY-04 | P |
| Monetary precision (0.01, large, many small, 0/3-decimal) | — | all | native + STDB | yes | — | `money.rs`, PAY-08, PAY-09 | N |
| Statement staging fixtures | invalid row + identical retry (E2E) | negative/zero/NaN/inf/missing/duplicate/out-of-order/huge; conflicting replay | STDB | yes | — | PAY-10, PAY-11A, PAY-11B | P |
| CSV BOM/delimiter/localized decimals | BOM stripped in parser (untested) | parser tests | web unit | no (parser file-private) | parser extraction | CSV-01..04 (documented) | N |

### Frontend IR (all require the IR stack)

| Case | Existing coverage (on stack) | Missing coverage | Best layer | Runs on main? | Prerequisite | Implementation | Class |
|------|------------------------------|------------------|-----------|---------------|--------------|----------------|-------|
| Definition corruption | #13 `validation_tests.rs`: unknown fields, malformed values, duplicate ids/bounds, stale schema/catalog versions, denied fields, invalid identifiers/base revisions, component-kind mismatch, budget, unknown privilege field, malformed JSON | dangling detail reference, recursion, future version, oversized, corrupt snapshot hash (#19), invalid pins | presentation-core on stack + gated E2E | no | #13 (#19 for hashes) | IR-01 (gated) | B |
| Permission revocation after creation (field, resource, company membership, disabled resource, operation) | #13 denied fields at validate/preview | reauthorization on reopen/render, cache non-leak, degradation UI | E2E | no | #25 | IR-02 (gated) | B |
| Concurrent editing N/N | #25 HTTP 409 stale writer, mocked UI conflict | two real browser contexts, preserved local edits, single N+1 | E2E | no | #25 | IR-03 (gated) | B |
| Late response after company switch / edit / relogin / revocation | — | all | E2E | no | #13 + company switch surface | IR-04 (gated) | B |
| Human vs AI vs import equivalence | — | all | E2E + presentation-core | no | harness-generated presentation definitions (none on any PR) | IR-05 (gated) | B |

### AI harness

| Case | Existing coverage | Missing coverage | Best layer | Runs on main? | Prerequisite | Implementation | Class |
|------|-------------------|------------------|-----------|---------------|--------------|----------------|-------|
| Policy denial executes no tool / draft-only creates pending draft | P4-AI-01, P4-AI-02 | exactly-one draft on replay | E2E | yes (gateway required) | #26 for correlation replay | reused; AG-04 (gated) | P |
| Elevated separation of duties (requester, simultaneous approvers) | code check only | two-session proof | E2E | yes | — | AG-02 | N |
| Malicious ERP text stays data | — | all | E2E (gateway required) | yes | — | AG-01 | N |
| Stale action draft (payment changed before approval) | — | source-version binding | STDB + E2E | no | #26 exact draft correlation | AG-03 (gated) | B |
| Ambiguous provider timeout / no blind redispatch | — | all | ai-gateway | no | #23, #26 | AG-05 (gated) | B |
| Concurrent budget reservations | — | all | STDB (spend.rs) | no | #26 | AG-06 (gated) | B |
| Permission / capability changes mid-run | — | per-call reauthorization | ai-gateway | no | #24 | AG-07 (gated) | B |
| Tool protocol fuzzing | #23 `agent_loop_tests.rs` (loop bounds) | duplicate ids, unknown tool, malformed/oversized args, forged org/company, post-terminal calls, duplicate red action, reconnect replay | ai-gateway | no | #23, #24 | AG-08 (gated) | B |
| Recovery of run/budget/tool steps/pending drafts | — | all | reconstruction drill | no | #26 + reconstruction coverage | AG-09 (gated) | B |

### Mobile / network, personas, recovery

| Case | Existing coverage | Missing coverage | Best layer | Runs on main? | Prerequisite | Implementation | Class |
|------|-------------------|------------------|-----------|---------------|--------------|----------------|-------|
| Latency jitter + double submit (post payment) | — | all | E2E | yes | — | M-01 | N |
| Lost response after commit + retry (post payment, approve batch, approve AI draft) | — | all | E2E | yes | — | M-02, M-03, M-05 | N |
| Offline then retry | — | all | E2E | yes | — | M-02 | N |
| Save IR draft under lost response | — | all | E2E | no | #25 | M-04 (gated) | B |
| Resume into stale state (batch, payment) | — | all | E2E | yes | — | M-06 | N |
| WebSocket disconnect/reconnect resync | realtime refetch (`realtime-smoke.spec.ts`) | offline window | E2E | yes | — | M-07 | P |
| Responsive reachability 320/360/390/430/768 | — | all | E2E | yes | — | M-08 | N |
| Distributor persona, finance/communication half | pieces in lead-to-cash, mobile-money, messaging | composed scenario with failures | E2E | yes | — | PERSONA-DIST-01 | P |
| Distributor persona, supplier half (PO, receipt, bill, supplier payment, low stock) | `mvp-procure-to-pay.spec.ts`, `vertical-distributor.spec.ts` | composition | E2E | yes | — | documented composition | P |
| PostgreSQL temporary outage / AI unavailable degraded mode | degraded-mode gate in `core-vertical-deployability-pruning-plan.md` | fault injection during persona | infra drill | no | stack fault-injection harness | REC-DEG-01 (pending) | B |
| Reconstruction of communications/payments/drafts/harness | C7 drills, #25 `verify-presentation-reconstruction.py` | domain assertions, no redispatch | drill scripts | partial | commit coverage (REC-01) | REC-01..03 | P |

## Known defects (pre-tenant blockers)

Registered in `KNOWN_DEFECTS` / `expectKnownDefect()`; runtime confirmation recorded in the validation log.

| Case | Blocker |
|------|---------|
| `COMM-05` | Stale-but-valid provider status callback is rejected with an error; the webhook returns non-2xx and the provider retries. |
| `COMM-06` | Batch approval does not revalidate consent; a contact who opted out after preview remains an approved recipient. |
| `COMM-07` | Batch approval does not revalidate the snapshotted identity; an archived recipient identity remains approved. |
| `COMM-09` | Contact message batches are approved without rendered content, so approved content is not immutable. |
| `COMM-11` | A batch creator can approve their own batch; no independent-approval rule. |
| `COMM-13` | `create_message_batch` does not scope candidate contacts/identities to the calling organization. |
| `COMM-14` | A number change under the same identity id silently redirects an approved recipient. |
| `COMM-15` | (Playwright-only; not yet executed against a running stack) Batch approval retry by the same approver returns an error instead of an idempotent success. |
| `PAY-03` | `post_payment_transaction` retry after commit returns an error instead of idempotent success. |
| `PAY-05` | `reverse_payment_transaction` retry after commit returns an error instead of idempotent success. |
| `PAY-11B` | `stage_bank_statement_import` silently accepts a replayed idempotency key with a different payload. |
| `AG-IDEMP-01` | (Playwright-only; not yet executed against a running stack) AI draft approval retry after commit returns an error instead of idempotent success. |

Additional documented findings (not executed as tests): `MONEY-PRECISION`, `CSV-01..04`, `REC-01`.

## Phase 5 — Mobile/network resilience

`pretenant-mobile-resilience.spec.ts` uses Playwright request interception for seeded 150–400 ms
latency, `route.fetch()` + `route.abort()` to lose a committed response, `context.setOffline()`, and
two contexts for resume-into-stale-state. Responsive checks at 320/360/390/430/768 px assert no
horizontal page overflow, a reachable primary navigation control, keyboard focus movement and no app
error — no screenshot assertions.

## Phase 6 — Stateful randomized testing

`state_machine_cert.rs` runs fixed seeds `[1, 42, 1337, 20260912, 0xDEADBEEF]`:

- SM-01: random `sent/delivered/failed` callbacks, exact replays and tampered replays across three
  outbound messages; asserts non-regression, terminal stability, intent/timeline agreement, constant
  timeline size and exactly one receipt per accepted event.
- SM-02: random allocations (exact remainder, invoice residual, random), exact key replays,
  foreign-organization forgeries and a reversal; asserts against an integer minor-unit model after
  every step (net allocated, ≤ settlement, per-invoice residual, tenant scope).

Every failure message includes `seed=<n> step=<n>`. Contact/opt-out/merge/permission operations are
certified by the deterministic COMM cases; extending SM-01 with those operations is follow-up once
COMM-06/07/13/14 are fixed (otherwise every seed stops at the known defect).

## Phase 7 — Synthetic personas

Deterministic persona definitions live in `pretenant-support.ts` (`PERSONAS`): distributor/wholesaler,
cash-heavy shop, service/repair SME, cooperative/member payout, multi-branch wholesaler. The distributor
is the first composed scenario (`PERSONA-DIST-01` in `pretenant-payment-adversarial.spec.ts`): customer
+ phone identity, posted invoice, partial mobile-money payment with lost-response retry, explicit
remaining credit, reminder batch with independent approval, payment correction by reversal, and audit
read-back. The supplier half is covered by `mvp-procure-to-pay.spec.ts` and `vertical-distributor.spec.ts`;
composing it into the same scenario and adding PostgreSQL-outage / AI-unavailable injection (REC-DEG-01)
requires a stack fault-injection harness that does not exist yet.

## Phase 8 — Reconstruction certification

Existing gates are preserved (`c7-reconstruction-drill.sh`, `c7-all-module-reconstruction-drill.sh`,
`c5-finalization-drill.sh`, projection matrix in CI, #25 presentation reconstruction verifier).

`REC-01` finding: `operational_message`, `message_batch`, `crm_conversation*`,
`crm_provider_event_receipt`, `payment_transaction`, `payment_reconciliation` and
`bank_statement_import` are `durable_business_record` in the storage-policy manifest, but the reducers
that mutate them (`review_message_batch`, `receive_crm_provider_message`, `record_crm_provider_delivery`,
`post_payment_transaction`, `allocate_payment_transaction`, `stage_bank_statement_import`, …) do not call
`record_organization_commit` and are absent from `c2-commit-coverage.json`. Their projection and
reconstruction path must be proven before these domains are certified for RECOVERY.

Planned drill (REC-02, after REC-01 is resolved): run COMM-02/PAY-04 workflows → project to PostgreSQL →
destroy a disposable STDB → reconstruct the organization → replay the same provider event and allocation
key → continue the workflow. Assert row counts, checksums, business balances, receipts, draft revision
heads (#25), budget/action state (#26) and idempotency receipts, and that no provider call is issued by
reconstruction. REC-03 extends this to harness runs after #26.

## CI and promotion policy

Initial policy:

- `cargo check --locked --tests` (blocking, existing) compiles all in-module certification code.
- Native certification tests (`make pretenant-cert-native`) — blocking candidates; not added to CI in
  this PR until runtime is measured.
- In-module certification executes inside the existing E2E domain-reducer loop; known defects do not
  fail it, regressions and fixed-but-registered defects do.
- `@pretenant` Playwright suite — optional/nightly/manual via `make e2e-pretenant`; not part of `@p0`.
- Capability-pending tests skip with their exact prerequisite.

Promotion: adversarial test proves stable over repeated nightly runs → remove dev-fixture assumptions →
run against an isolated tenant → promote to release blocking. A known defect is removed from the
registry in the same PR that fixes it.

## Commands

```bash
make pretenant-cert-native          # native money model + registry consistency
make pretenant-cert-stdb            # in-module certification on local STDB (E2E_DB)
make e2e-pretenant                  # @pretenant Playwright against a running stack
cd frontend/web && pnpm exec playwright test --list --grep @pretenant
```

## Validation log

Run on 2026-09-12 against `main` @ `06c9c82a0` plus this branch.

| Command | Result |
|---------|--------|
| `cd spacetimedb && cargo check --locked --tests` | pass |
| `cd spacetimedb && cargo test --locked --lib pretenant_cert` | 6 passed |
| `spacetime build` + `spacetime publish lumiere-pretenant-cert --server local --clear-database` | pass |
| `spacetime call lumiere-pretenant-cert run_core_operational_messaging_test` | pass: COMM-01/02/03/04/08/10/12 and SM-01 pass; COMM-05/06/07/09/11/13/14 confirmed known defects |
| `spacetime call lumiere-pretenant-cert run_accounting_payment_management_test` | pass: PAY-01/02/04/06/07/08/09/10/11A and SM-02 pass; PAY-03/05/11B confirmed known defects |
| `cd frontend/web && pnpm exec playwright test --list` | 216 tests in 69 files (44 `@pretenant`) |
| `tsc --noEmit` (web, excluding stale local `.next/dev` types) | pass |

Not executed: the `@pretenant` Playwright suite (needs a running seeded stack, `make e2e-pretenant`). Its
browser-only defects (`COMM-15`, `AG-IDEMP-01`) and behavioural assertions are unverified at runtime.

# BASE-03 — communications correctness completion

Status: **IMPLEMENTATION COMPLETE — acceptance proof pending**

Current tip: PR #88 (`codex/base03-communications-correctness`), stacked on BASE-04 PR #87.

## Closed defects

### COMM-05 — stale provider callback absorption

A well-formed `sent` callback arriving after the message is already
`delivered` or `failed` is now acknowledged as stale:

- the provider event receipt is persisted;
- conversation and operational message status do not regress;
- no duplicate status audit/effect is created;
- terminal `delivered ↔ failed` swaps still fail closed.

### COMM-06 — consent revalidation

Batch approval re-resolves every snapshotted recipient under current
organization/company/channel consent. An opt-out after preview blocks approval
and requires a new batch.

### COMM-07 / COMM-14 — recipient identity snapshot integrity

Approval requires the current eligible primary phone identity to be the exact
identity captured by the child `OperationalMessage`.

It also rejects an identity updated after the preview timestamp, so changing the
number under the same identity id cannot silently redirect approved copy.

### COMM-09 — immutable rendered contact-batch content

Generic contact batches now render subject/body and variable hash before the
batch is created. Supported generic contact variables are deliberately bounded
to contact-derived values:

- `customer_name`;
- `contact_name`;
- `recipient_name`.

Unsupported template variables fail closed; invoice-specific variables remain
owned by `create_invoice_reminder_batch`.

Native certification proves later template edits do not mutate the previewed
contact-batch snapshot.

### COMM-11 — independent approval

A batch creator cannot approve their own batch. Approval remains a separate
permission boundary and validates recipient/content state before commit.

### COMM-13 — tenant/company recipient scope

Candidate contacts and phone identities are resolved through the current
organization/company scope before batch persistence. Cross-organization or
cross-company recipient injection rejects transactionally with no batch/message
effect.

### COMM-15 — committed approval retry

If the original approver retries an already committed approval, the reducer
returns success without writing a second approval audit.

A different stale approver still receives a non-pending-state rejection, so
resume/stale-client semantics remain explicit.

## Additional hardening

- single-message creation uses the same scoped recipient resolver;
- legacy `phone_identity_id = 0` still means “resolve the current eligible
  primary identity”; a nonzero stale/mismatched identity fails closed;
- invoice-reminder recipient resolution now uses the same organization/company
  rules;
- approval requires batch children to remain unapproved `Draft` intents;
- the pre-tenant native known-defect registry is empty after these repairs;
- COMM-11/15/06 browser expected-failure wrappers are now blocking assertions;
- the ordinary operational-messaging E2E uses a separately provisioned approver
  instead of self-approval.

## Deliberately excluded

- actual WhatsApp/SMS outbound provider dispatch and ambiguous provider timeout
  handling (`COMM-OUT-01`, capability-gated);
- reconstruction/organization-commit coverage (`REC-01`);
- AI draft approval retry (`AG-IDEMP-01`);
- optional expansion of SM-01 with contact/consent mutation operations.

## BASE-03 acceptance

Do not mark BASE-03 `ACCEPTED` until all relevant proofs have passed on the
integrated stack:

```bash
cargo check --locked --manifest-path spacetimedb/Cargo.toml --tests
make pretenant-cert-native
make check-codegen-pinned

# Freshly published local stack:
spacetime call <db> run_core_operational_messaging_test --server local --no-config

# Two-session authority / consent / retry:
make e2e-pretenant E2E_ONLY_SPEC=pretenant-communications-adversarial.spec.ts

# Lost-response and stale-session approval:
make e2e-pretenant E2E_ONLY_SPEC=pretenant-mobile-resilience.spec.ts E2E_GREP="M-03|M-06"

# Existing operational messaging workflow:
make e2e-single E2E_SPEC=operational-messaging.spec.ts E2E_GREP=

cd frontend/web
pnpm typecheck
```

No additional BASE-03 product-code blocker is currently identified. Any failure
from these gates must be classified as a BASE-03 regression or a BASE-05
harness/environment issue before promotion.

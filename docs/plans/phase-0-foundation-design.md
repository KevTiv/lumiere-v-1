# Phase 0 Foundation Design

## Scope

This document implements the Phase 0 design deliverable for the SME ERP roadmap.
It fixes the proposed ownership boundaries and delivery gates needed before any
phone-first, payment, messaging, reporting, or AI feature code is started.

It is a design baseline, not a claim that country-specific provider or privacy
policy decisions are approved. Those decisions are called out as sign-off gates.

## Current Codebase References

- Request ownership and generated-resource workflow: `docs/ARCHITECTURE.md`.
- Tenant/company rules: `docs/guides/tenant-scoping-organization-vs-company.md`.
- Money posting: `spacetimedb/src/accounting/payments.rs`,
  `journal_entries.rs`, and `bank_reconciliation.rs`.
- Contact and duplicate lifecycle: `spacetimedb/src/crm/contacts.rs` and
  `crm/duplicate.rs`.
- Audit/RBAC: `spacetimedb/src/helpers.rs`, `core/audit.rs`, and
  `core/permissions.rs`.
- Existing AI boundary: `ai-gateway/src/orchestrator/`, `sandbox/`, `harness/`,
  `spacetimedb/src/ai/`, and `frontend/web/app/api/ai/_lib/route-helpers.ts`.
- Schema publication/codegen: `crates/stdb-auth/assets/resource_registry.json`,
  `lumiere-codegen/`, and `make codegen` described in `docs/ARCHITECTURE.md`.

## Decisions

### D0.1 - Financial Source of Truth

`AccountPayment` and its resulting `AccountMove` remain the only posted payment
and ledger authority. A new operational payment transaction identifies a provider
event and links to one posted payment. It cannot independently change an invoice,
bill, balance, or journal.

`PaymentReconciliation` becomes the allocation authority once introduced. Each
row links one posted payment to one receivable/payable move line and stores its
applied amount and residual snapshot. It supports partial and many-to-many
settlement. Existing `reconciled_invoice_ids` and `reconciled_bill_ids` remain
read-compatible projections until every consumer has moved to allocations.

### D0.2 - Contact Source of Truth

`Contact` remains the party master. New phone, WhatsApp, mobile-money, and role
data are normalized child records. Current Contact booleans/ranks remain
compatibility projections during migration. Customer and supplier balances are
read models calculated from posted account move lines and reconciliations; no
contact balance column is introduced.

### D0.3 - Scope and Read Boundaries

All proposed tables carry `organization_id`; company-operational rows also carry
`company_id`. Reducers validate organization membership and company ownership.
The API server serves named, scoped resources. Browser code never issues raw SQL,
and AI receives only named data services or approved snapshot datasets.

### D0.4 - Mutation and Correction Boundaries

Posted money, stock, permissions, imports, and red AI actions are immutable
business events. Corrections are compensating reducers linked to the original
record. A state update is allowed only for an unposted draft or an explicit,
audited lifecycle transition that cannot alter financial effect.

### D0.5 - Message Truthfulness

V1 WhatsApp/SMS is a copy action. Its persisted state means a user copied a
rendered message; it never asserts provider delivery. Direct provider delivery
will later use a separate attempt/status record and server-side credentials.

### D0.6 - Report and AI Output Boundaries

Owner reports are typed catalog entries rendered from scoped DTOs. A model may
summarize a typed report but cannot supply trusted HTML. AI uses declarative
shells with explicit resources and limits, not generated executable code.

## Phase 1 Contract Inventory

| Contract | Proposed owner | Blocking decision | Phase 1 consumer |
| --- | --- | --- | --- |
| ContactIdentity and ContactRoleAssignment | CRM | phone normalization/verification policy | CRM form, duplicate guard, messaging |
| PaymentProvider and PaymentAccount | Accounting | first-market provider/accounting mapping | payment workspace, daily balances |
| PaymentTransaction, Fee, Allocation, Reversal | Accounting | fee bearing and correction policy | payment posting/reconciliation |
| OperationalMessage, Template, Recipient, Batch | Core messaging | consent/retention policy | copy actions, timeline |
| Owner report DTO/catalog | API server/reporting | accounting cutoff and renderer selection | owner report UI/PDF |
| AI policy/skill manifest | AI gateway/SpacetimeDB | approver/SOD policy | green skills and action drafts |

## Data Model and Reducer Migration Specification

### Additive Schema Strategy

1. Add new SpacetimeDB types/tables/reducers without changing existing payment
   or contact writes. Every table gets organization/company indexes, timestamps,
   actor fields, soft-delete/archive policy where appropriate, and audit writes.
2. Add named query resources and API-server scoped handlers. Update
   `resource_registry.json`, run `make codegen`, and add reducer invalidation
   entries before frontend hooks are introduced.
3. Seed/backfill in an idempotent internal reducer. Follow the precedent in
   `core/organization.rs::backfill_external_ids`: privileged only, batchable,
   observable, and auditable. A dry-run/read report precedes mutation.
4. Dual-read new and legacy data through a single mapper. New UI writes new
   records and maintains compatibility projections only while legacy readers
   require them.
5. Migrate all read paths and E2E fixtures. Only then remove compatibility
   behavior in a separately approved schema release. No destructive table/field
   removal is part of Phase 1.

### Contact Migration Contract

`ContactPhoneIdentity` has: `id`, `organization_id`, optional `company_id`,
`contact_id`, `kind` (`primary|whatsapp|mobile_money`), `normalized_e164`,
`display_masked`, `verification_state`, `is_preferred`, timestamps, and metadata.
Store the plain normalized value only where field policy permits the repository
to operate; add a normalized lookup/fingerprint appropriate to the database's
index capabilities. One preferred identity per `(contact, kind, company scope)`
is enforced in reducer validation.

`ContactRoleAssignment` has contact, role, optional company, active interval,
and metadata for terms/agent ownership. It replaces role inference from only
booleans but does not duplicate employee HR records. The initial backfill maps
existing customer/vendor/employee flags and ranks to active roles, preserves
`phone` as primary where present, and uses `mobile` as a nonpreferred candidate
only when distinct after normalization. Rows that cannot normalize are reported,
not discarded.

### Payment Migration Contract

`PaymentAccount` maps a company cash drawer, bank account, or mobile wallet to
an existing `AccountJournal`. It has provider, currency, display identity,
masked account reference, active state, optional fee account, and provider
configuration reference. It does not store credentials.

`PaymentTransaction` is created as a draft with `payment_account_id`, direction,
party, `external_reference`, normalized reference fingerprint, occurred time,
`settlement_amount`, `gross_external_amount`, and `net_account_amount`. It links
to `AccountPayment` only on atomic posting. Reducers enforce these invariants:

```txt
settlement_amount > 0
gross_external_amount > 0
net_account_amount >= 0
sum(PaymentFee.amount) = gross_external_amount - net_account_amount
sum(posted allocations) <= settlement_amount
all payment/account/party/allocated move lines share organization + company
external reference uniqueness scope = company + payment account + fingerprint
```

The exact relation between fee, customer/supplier burden, and settlement is
represented by `fee_bearer` and an approved posting policy. The accounting
design review must approve the generated journal-line examples for incoming and
outgoing payments before reducers are written. `PaymentReversal` always points
to an original posted transaction and creates compensating payment, allocation,
and journal effects; it never rewrites the original.

### Reducer Contract

Each proposed reducer takes flat `organization_id` plus typed params with
`company_id`; it calls `check_permission`, validates company ownership, performs
the domain mutation, and writes `write_audit_log_v2` on success. Expected groups:

```txt
CRM: create/update/verify/archive contact identity; assign/end contact role; prepare/approve merge
Payments: create/update draft account/transaction; post transaction; allocate; reverse; import/approve statement
Messaging: create/render/copy message; preview/approve/cancel batch; append delivery attempt
Reports: generate/render/download typed report
AI: create/test/promote/rollback skill version; create/approve/reject action draft
```

Posted/reversal/bulk/import reducers must include correlation IDs in metadata to
link source UI flow, import job, report generation, and AI run/draft.

## Report Schema Baseline

Every report DTO includes `report_key`, `schema_version`, `scope`, generated
timestamp, accounting watermark/cutoff, currency, totals, data caveats, and
typed lines. Initial keys and mandatory sections are:

| Key | Mandatory sections | Authoritative data |
| --- | --- | --- |
| `daily_business_summary_v1` | sales, receipts, purchases, expenses/fees, stock alerts, exceptions | sales, payments, purchasing, inventory |
| `cash_mobile_money_v1` | opening, by account/provider, receipts, disbursements, fees, closing, unreconciled | journals, payment transactions, allocations |
| `customer_balances_v1` | party, due buckets, credit status, open invoices, payments | account move lines and allocations |
| `supplier_payables_v1` | supplier, due buckets, bills, planned/paid amounts | account move lines and allocations |
| `low_stock_v1` | product, on hand, reserved, reorder point, forecast, supplier hint | stock quant/move/replenishment |
| `stock_movement_v1` | product, location, source, destination, quantity, valuation reference | stock moves/valuation |
| `sales_by_product_v1` | quantity, gross/net sales, returns, margin where authoritative | sales/invoices/returns |
| `purchase_spend_v1` | supplier, product/category, quantity, spend, landed cost policy | purchase/bills/landed costs |
| `payment_fee_summary_v1` | provider/account, fee type/bearer, amount, rate, accounting status | payment fees/moves |
| `monthly_owner_report_v1` | executive summary plus selected monthly report sections | catalog reports above |

Each schema has matching Rust and TypeScript types, valid/invalid fixtures, and
locale-aware money/date render snapshots before a PDF route is enabled.

## AI Policy and Risk Baseline

The canonical skill manifest contains immutable `skill_key`, `version`, tenant
visibility, category, description, input/output JSON schema, risk,
required_permissions, allowed_resources, scope rules, max rows/steps/tool calls,
output types, redaction policy, fixture set, status, and source hash. Risk is
one of `green`, `amber`, or `red`.

Green invokes only read services and records an audit. Amber returns a typed
draft, never a mutation. Red requires: role permission; a preview/diff against
a source watermark; a different eligible human approver where configured; audit;
and an explicit correction/rollback plan. Unknown actions default deny. The
specific matrix is maintained in `ai-enterprise-harness-plan.md`.

## Milestones

1. **Design sign-off:** product/accounting/security approve the decision record,
   first-market provider list, phone policy, consent/retention, report cutoffs,
   renderer, and red-action approver rules.
2. **Contract sign-off:** owners approve table/reducer params, journal examples,
   named query resources, report DTOs, skill manifest, and fixture matrix.
3. **Readiness sign-off:** migration dry-run and fixture review demonstrate that
   old contact/payment records remain readable and no requested flow requires
   raw SQL or unbounded export.

## Acceptance Criteria

- No Phase 1 pull request may introduce a table/reducer outside this ownership
  model without an explicit decision-record amendment.
- Every proposed mutable record has organization/company scope, permissions,
  audit, lifecycle, correction policy, and generated-resource/codegen impact.
- Every owner report and skill has a typed schema, bounded source, and fixture.
- The unresolved decisions below have named approvers before posting, direct
  messaging, or production PDF work begins.

## E2E and Fixture Requirements

The executable fixture contract is in `phase-0-e2e-fixture-spec.md`. Phase 1
work must add its E2E scenario to that matrix before implementation begins, not
after the UI is complete.

## Security and Privacy Considerations

Phones, wallet references, messages, reports, and AI artifacts are restricted
fields. Default outputs are masked. Secrets are represented only by vault/secret
references. New named query resources require org/company filtering and row
limits; exports require a dedicated permission and audit. AI shells have no
filesystem, network, raw SQL, or reducer execution authority.

## Open Sign-Off Gates

1. Launch countries, currencies, providers, reference formats, and provider fee
   accounting policy.
2. Phone identity verification, consent, retention, staff reveal, and cross-
   company sharing policy.
3. Accounting period correction/reversal rules and approver segregation of
   duties.
4. PDF renderer/deployment constraints, report legal retention, and owner report
   timezone/cutoff policy.
5. Model-provider residency, AI prompt/output retention, and global-skill
   review ownership.

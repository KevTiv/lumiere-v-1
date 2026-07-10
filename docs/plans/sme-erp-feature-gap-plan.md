# SME ERP Feature Gap Plan

## Scope

This plan covers the production ERP wedge for distributors, wholesalers, shops,
and service businesses: phone-first contacts, stock, credit, purchases, cash and
mobile money, operational messaging, owner reporting, imports, and safe AI
assistance. It deliberately excludes webshop, public storefront, checkout,
customer portals, and marketplaces.

This is a design and implementation-order document. It does not authorize
feature implementation or CI changes.

## Current-State Inspection

| Area | State | Evidence and assessment |
| --- | --- | --- |
| CRM / contacts | Partially implemented | `spacetimedb/src/crm/contacts.rs` defines `Contact` and reducers `create_contact`, `update_contact_*`; it already has `phone`, `mobile`, customer/vendor/employee flags and ranks. `crm/duplicate.rs` has `find_duplicate_contacts` and `merge_contacts`; `frontend/web/app/(modules)/crm/crm-client.tsx`, `frontend/packages/query-hooks/src/hooks/crm.ts`, and `frontend/packages/ui/src/lib/crm-*-configs.ts` provide the module surface. It lacks normalized phone identities, WhatsApp/mobile-money fields, explicit business roles, balances, and a cross-entity financial timeline. |
| Sales | Implemented | `spacetimedb/src/sales/sales_core.rs`, `pos_transactions.rs`, `return_orders.rs`, and `delivery_shipping.rs` own quotations, orders, POS, returns, and delivery. The web module is `frontend/web/app/(modules)/sales/sales-client.tsx`; mutations live in `frontend/packages/query-hooks/src/hooks/sales.ts`. The lead-to-cash tests are `mvp-lead-to-cash.spec.ts`, `sales-invoice-flow.spec.ts`, and `sales-mutations.spec.ts`. |
| Purchasing | Implemented | `spacetimedb/src/purchasing/purchase_orders.rs`, `vendor_management.rs`, and `landed_costs.rs` supply purchase orders, supplier banks, intake, and landed cost. UI/hook entry points are `purchasing-client.tsx` and `hooks/purchasing.ts`; `mvp-procure-to-pay.spec.ts` and `purchasing-module.spec.ts` cover the critical path. |
| Inventory | Implemented | Products, warehouses, moves, adjustment, counts, replenishment, valuation, barcode, and traceability are in `spacetimedb/src/inventory/`. `inventory-client.tsx`, `hooks/inventory.ts`, and `inventory-mutations.spec.ts` cover the module. The distributor-specific stock views and reports are still missing. |
| Accounting / payments | Partially implemented | `accounting/payments.rs` has `AccountPayment`, `create_payment`, `post_payment`, `cancel_payment`, and `register_payment_on_invoice`; payment posting creates an `AccountMove`. `bank_reconciliation.rs` supports statement lines, matching, reconciliation and unreconciliation. UI is embedded in `accounting-client.tsx` with `useAccountPayments` and payment mutations in `hooks/accounting.ts`. It has no provider/account abstraction, reference idempotency, fee ledger, allocation amounts, structured reversal, or mobile-money operating view. |
| Reports | Partially implemented | `spacetimedb/src/analytics/reports.rs` provides report templates, saved reports, scheduled reports, and metrics. `reports-client.tsx`, `query-builder.tsx`, `pivot-explorer.tsx`, and `hooks/reports.ts` expose broad generic reporting. Owner reports with typed schemas, controlled data scopes, reliable PDF storage, and daily operational drilldowns remain absent. |
| Messaging / mail / WhatsApp | Partially implemented | `spacetimedb/src/core/messaging.rs` supplies polymorphic `MailMessage`/`MailFollower`, `post_message`, `post_internal_note`, and subscriptions. Mail templates and queued email are in `documents/templates.rs` and `api-server/src/routes/mail.rs`. `integrations/whatsapp_business.rs` stores secure WhatsApp Business account configuration but does not deliver operational messages. `messages-client.tsx`, `hooks/messages.ts`, and `crm-components/crm-record-timeline.ts` are existing UI patterns. No SMS, copy-first workflow, consent model, delivery lifecycle, or bulk-approval flow exists. |
| Settings / admin / permissions | Implemented | Organization, companies, roles, users, SSO, audit log, field permissions, and AI settings are exposed by `settings-client.tsx` and `frontend/packages/ui/src/settings/`. Policy and field-access data are in `spacetimedb/src/core/permissions.rs`; common reducers call `helpers::check_permission`; audit writes use `helpers::write_audit_log_v2` and `core/audit.rs`. |
| AI gateway / drafts / skills | Partially implemented | `ai-gateway/src/orchestrator/run.rs`, `orchestrator/skill_loader.rs`, `sandbox/query.rs`, `tools/`, and `harness/entity_registry.rs` implement a useful constrained base. Gateway routes include `/v1/skills/run` and `/v1/actions/draft`; Next BFF routes include `app/api/ai/skills/run/route.ts` and `app/api/ai/actions/draft/route.ts`. SpacetimeDB has `AiSkill`, `AiAgentRun`, `AiActionDraft`, lifecycle hooks, and `AiReducerAllowlist` in `spacetimedb/src/ai/`. Missing are a canonical intent/policy/scope pipeline, versioned reviewed skill promotion, privacy redaction, consistent risk taxonomy, and action-specific correction requirements. |
| Import assistant / rollback | Implemented | Import tracking and `rollback_import_job` are in `spacetimedb/src/data_ops/import_tracker.rs`; mapping finalization is in `import_mapping_templates.rs`. The UI pattern is `frontend/web/lib/guided-import-wizard.tsx` and `frontend/packages/ui/src/import-assistant/`; hooks are `hooks/ai-import-mapping.ts` and `hooks/import-jobs.ts`. `frontend/web/tests/e2e/import-rollback.spec.ts` validates the rollback flow. Payment statement import is not yet an import target. |
| Documents / PDF / export | Partially implemented | Documents and templates are in `spacetimedb/src/documents/`. The API server has controlled PDF/XLSX renderers for financial reports, sales orders, and account moves in `api-server/src/routes/documents.rs`; Next proxy routes are under `app/api/documents/{pdf,xlsx}/`. Current PDF output is line-oriented `printpdf`, not a typed owner-report rendering pipeline with stored artifacts. |
| Relevant E2E | Implemented for current MVP, gaps for new wedge | Existing coverage includes lead-to-cash, procure-to-pay, payments/accounting, invoice correction, CRM duplicate merge, import rollback, AI RAG/action drafts, permissions, inventory, reports parity, and module smoke tests under `frontend/web/tests/e2e/`. There are no E2Es for mobile-money payment lifecycle, operational message copy/approval, owner report PDF, AI skill promotion, or risk tiers. |

## Architecture Constraints

1. Preserve `organization_id` and `company_id` ownership in tables, reducers,
   BFF validation, query keys, and subscription scopes. Follow
   `docs/guides/tenant-scoping-organization-vs-company.md`.
2. Keep accounting as the financial source of truth. Sales and purchasing may
   initiate payment workflows but must not maintain a parallel payment ledger.
3. Add mutations as typed SpacetimeDB reducers, expose them through existing
   `frontend/packages/stdb/src/commands/*-http.ts` command maps, and use typed
   finalizers/mappers in `erp-shared` before form submission.
4. Use existing shared form configuration and module entity configuration rather
   than bespoke modal payloads. Extend module clients, subscriptions, and query
   hooks alongside reducers.
5. Write audit records for money, stock, permissions, imports, AI, exports, and
   bulk work. Red actions must be correction-based after posting rather than
   destructive edits.

## Feature-Group Summary

### A. Phone-first contacts

1. **Current codebase evidence:** `Contact` in
   `spacetimedb/src/crm/contacts.rs` contains `phone`, `mobile`,
   `is_customer`, `is_vendor`, `is_employee`, and rank fields. `create_contact`
   and `update_contact` accept those fields. `contact_phone`,
   `find_duplicate_contacts`, and `merge_contacts` in `crm/duplicate.rs` already
   compare phone/name and preserve ranks. CRM forms/tables are configured in
   `frontend/packages/ui/src/lib/crm-form-configs.ts` and
   `crm-entity-configs.ts`; queries/mutations are in `hooks/crm.ts`; timeline UI
   begins at `ui/src/crm-components/crm-record-timeline.ts`.
2. **Proposed architecture:** retain `Contact` as the canonical party. Add
   `ContactPhoneIdentity` for E.164-normalized primary/WhatsApp/mobile-money
   values, verification/state, preferred channel, and masked display; add
   `ContactRoleAssignment` with `customer`, `supplier`, `farmer_member`,
   `employee`, and `agent`, scoped to organization plus optional company. Keep
   current booleans/ranks as backward-compatible projections while migrating.
   Compute customer/supplier balances from posted accounting allocations and
   residuals through a scoped projection; never write mutable totals on Contact.
3. **Backend changes:** add company-aware contact identity/role tables, indexes
   on normalized phone and name search key, duplicate candidate reason/source,
   identity verification history, and timeline projection queries. `create_contact`
   and update reducers validate a primary identity and use the centralized
   duplicate guard before write. Extend merge to re-parent identities, roles,
   operational messages, balances/source links, and retain merge provenance.
   Payment account references belong to the contact identity type, while company
   wallets belong to the payment module in
   `mobile-money-payment-management-plan.md`.
4. **Frontend changes:** make phone the first required customer/supplier input in
   CRM forms, with country-aware normalization and duplicate warning before save.
   Update CRM contact list filters for role, phone, WhatsApp availability, and
   balance state. Add Contact detail tabs: Overview, Timeline, Customer Balance,
   Supplier Balance, and Communication Preferences. Reuse shared form builder,
   query hooks, module subscriptions, and parameter finalizers; add no ad-hoc
   contact mutation path.
5. **AI/harness changes:** green skills may find duplicate candidates or report
   balances using masked identity values. Customer merge is amber: it produces a
   typed merge draft with field/relationship diff. AI cannot silently merge a
   contact or expose a full phone/mobile-money reference.
6. **Permissions/audit requirements:** introduce `contact_identity` and
   `contact_role` permissions, respect field-level visibility in
   `core/permissions.rs`, and audit create/update/verification/merge/reveal.
   Require an explicit override permission and audit reason to create a likely
   duplicate. The timeline must enforce source-record permissions and company
   scope for every event.
7. **E2E test requirements:** create a customer with only a phone, WhatsApp
   phone, and mobile-money reference; add supplier and farmer/member roles;
   assert normalized duplicate warning, sanctioned merge, separated balances,
   masked field behavior, timeline links, and cross-company denial. Include a
   migration fixture proving existing `phone`/`mobile` values remain searchable.
8. **Risks / open questions:** select a phone normalization library and country
   metadata source; decide whether one Contact may carry different company-level
   credit terms and mobile-money identities; define verification evidence and
   local privacy/retention consent. Verify whether employee is a CRM role or
   should merely link to the existing HR resource.
9. **Suggested implementation order:** approve the identity/role compatibility
   migration; build normalized identities and duplicate search; update forms/list
   and field policy; add balance/timeline projection after allocation rows exist;
   then enable AI merge drafts and messaging preferences.

### B. Payments, C. Messaging, D. Reports, E-G. AI governance, H. vertical packs

Detailed architecture, acceptance criteria, risks, and E2E work are split into
the focused plans below to keep ownership boundaries clear:

- `docs/plans/mobile-money-payment-management-plan.md`
- `docs/plans/messaging-operations-plan.md`
- `docs/plans/reporting-pdf-skill-plan.md`
- `docs/plans/ai-enterprise-harness-plan.md`
- `docs/plans/vertical-lite-packs-plan.md`

## Phased Roadmap

### Phase 0 - Investigation and design docs

Confirm source-of-truth semantics for AR/AP residuals and partial allocation;
define payment provider/account chart-of-account mapping; identify target
countries/currencies and personal-data retention requirements; approve the AI
risk matrix and report schemas. Produce reducer/table migration and fixture
specifications before code changes.

Phase 0 design artifacts are now captured in
`docs/plans/phase-0-foundation-design.md` and
`docs/plans/phase-0-e2e-fixture-spec.md`. The five named product/legal/provider
sign-off gates in the foundation design remain prerequisites for Phase 1 posting,
direct provider messaging, and production report rendering.

### Phase 1 - Core payment/contact/messaging foundations

Implement normalized phone-first contact identities and roles, payment accounts
and transactions integrated with `AccountPayment`, allocation-aware
reconciliation, copy-first operational messages, consent/visibility controls,
and linked timelines. Include statement-import staging only after the manual
transaction flow is stable.

### Phase 2 - Owner reports + PDF

Build scoped query services, typed report schemas/templates, the owner-report
catalogue, controlled PDF rendering, document storage, and report audit records.

### Phase 3 - AI harness read-only skills

Introduce the intent router, policy engine, scope resolver, skill registry
review model, privacy guard, sandbox controls, and green read-only reporting
skills. Use fixtures to certify each released skill.

### Phase 4 - AI action drafts and risk enforcement

Map amber/red actions to explicit policies, previews, approvers, reversible
reducers, and audit. Extend the current action-draft lifecycle rather than
providing direct AI mutation access.

### Phase 5 - Vertical-lite packs

Deliver one pack at a time behind company-level enablement, starting with
distributor/wholesaler. Reuse the shared ERP core; avoid branching accounting,
inventory, or contact logic per vertical.

### Phase 6 - CI/release hardening

Only after the contracts above stabilize, add generated-binding checks, migration
checks, E2E fixture isolation, security regression suites, and release gates.
CI is intentionally not implementation priority in this planning pass.

## Milestones and Acceptance Criteria

- Phase 0 is complete when the payment double-entry/allocation contract, data
  classification, report schemas, skill manifest schema, and approval matrix
  have design approval.
- Each later phase is complete only when reducer tests, BFF scope tests, UI
  flows, E2E scenarios, audit assertions, and tenant-isolation checks pass.
- No feature may introduce an AI path that executes arbitrary SQL, external
  network calls, or a raw reducer outside the explicit allowlist/policy gate.

## Open Questions

1. Which countries, currencies, mobile-money providers, and provider reference
   formats are in the first launch cohort?
2. Should a contact be shared across companies in an organization, or should
   company-specific roles/credit limits be mandatory for all commercial parties?
3. Which legal retention/consent policy applies to phone numbers and message
   bodies, and which staff roles may view unmasked payment references?
4. Which approval system of record should red AI actions use when the existing
   workflow gate cannot represent segregation-of-duties requirements?

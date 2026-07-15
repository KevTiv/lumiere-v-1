# CRM Investigation — Account & Contact Lifecycle

Status snapshot of Lumiere CRM against a NetSuite/Attio *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, i18n, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Implementation status (2026-07-15):** Waves 1–2 from this doc are implemented in-tree (subscriptions expanded, consent/relationship/admin/presence/forecast/pack validators). Differentiating foundations are also in-tree: lead scoring (explainable factors), dynamic segment rule AST + evaluate, relationship intelligence snapshots, and WhatsApp CRM conversation inbox (intent rows; delivery remains worker-side).

**Verdict:** Lumiere has a solid **lead → opportunity → sale order** spine with phone-first identities, duplicate merge, UTM dimensions, consent tables, and subscription-backed lists. Against that bar it is strong on transactionality and tenant safety, **partial** on pipeline UX / attribution / customer-360, and **absent** on territories, scoring, quotas, forecasting, campaign engines, and collaborative presence.

### Wave delivery checklist

| Wave | Item | Status |
|------|------|--------|
| 1 | Expand CRM workspace + org SQL subscriptions | Done |
| 1 | Consent history on contact sheet | Done |
| 1 | Contact relationship CRUD + parent hierarchy | Done |
| 1 | Opportunity stage / lead source / lost reason / assignment rule admin | Done |
| 1 | Domain tests (`run_crm_relationship_admin_test`) | Done |
| 2 | Opportunity presence + disconnect cleanup | Done |
| 2 | Country-pack ABN/CNPJ/UEN (+ address_required) validators on contact writes | Done |
| 2 | Forecast snapshot + weighted pipeline / UTM attribution dashboard | Done |
| — | WhatsApp CRM inbox, lead scoring, relationship intelligence, dynamic segment AST | Foundations shipped (see deferred modules) |

---

## 1. Verified inventory

### 1.1 Tables (backend `spacetimedb/src/crm` + adjacent)

| Area | Tables | Status |
|------|--------|--------|
| Party master | `Contact`, `ContactCategory`, `ContactCategoryAssignment`, `ContactRelationship`, `ContactTag`, `ContactTagAssignment` | Present |
| Phone-first | `ContactPhoneIdentity` (E.164, WhatsApp/mobile_money kinds, verify/archive) | Present |
| Roles | `ContactRoleAssignment` | Present |
| Leads | `Lead`, `LeadSource`, `LeadLostReason` | Present (sources/reasons largely seed-only) |
| Opportunities | `Opportunity`, `OpportunityStage`, `OpportunityLine` | Present (stages: seed/direct insert; no create reducer) |
| Activities | `Activity`, `ActivityType`, `CalendarEvent` | Present |
| Segments | `ContactSegment`, `SegmentMember`, `AssignmentRule` | Present (`AssignmentRule` seed-only — no public reducer) |
| Duplicates | `ContactDuplicateCandidate` | Present |
| Attribution (core) | `UtmCampaign`, `UtmMedium`, `UtmSource` | Present |
| Consent / privacy (core) | `PrivacyConsent`, classifications/rules | Present |
| Messaging (core) | `ContactCommunicationPreference`, operational messages, WhatsApp account | Present |
| Country packs (core) | AU/NZ/ZA/SG + BR/AR/CL/MY/ID/TH/PH tax packs | Present (tax-oriented, not CRM address packs) |

**Schema notes**

- `Contact.parent_id` exists (hierarchy hook) but no hierarchy governance reducers/UI.
- `ContactRelationship` exists; merge repoints it; **no create/update relationship reducer**.
- Leads/opportunities carry `campaign_id` / `medium_id` / `source_id` FKs to UTM tables — not a full campaign object model.

### 1.2 Reducers (verified callable surface)

**Contacts:** `create_contact`, `update_contact`, `update_contact_address|business|details`, `delete_contact`, `create_contact_tag`, `assign_tag_to_contact`

**Identities:** `create|update|verify|archive_contact_identity`

**Roles:** `assign_contact_role`, `end_contact_role`

**Duplicates:** `find_duplicate_contacts`, `merge_contacts`

**Leads:** `create_lead`, `update_lead_details|address|revenue`, `delete_lead`, `convert_lead_to_customer`

**Opportunities:** `create_opportunity`, `update_opportunity`, `create_opportunity_line`, `convert_opportunity_to_sale_order`

**Activities:** `create_activity`, `complete_activity`, `create|update|delete_calendar_event`

**Segments:** `create_contact_segment`, `add_contact_to_segment`

**Adjacent:** UTM CRUD, `record_privacy_consent`, `set_contact_communication_preference`, CSV import reducers (`import_*_csv`)

**Missing reducers (tables exist):** contact relationships, categories CRUD, assignment rules, lead sources/lost reasons, opportunity stages, activity types, dynamic segment evaluation.

### 1.3 Subscriptions & queries

`CRM_WORKSPACE_RESOURCE_KEYS` (`frontend/packages/stdb/src/subscriptions/crm-workspace.ts`):

- `leads`
- `opportunities`
- `opportunity-stages`
- `contacts`
- `contact-phone-identities`
- `contact-role-assignments`
- `activities`
- `users`

Partial gaps vs tables: tags/segments/opportunity-lines/calendar/UTM/consent are mostly **BFF query + invalidate**, not first-class workspace subscription keys. `proposal-presence` exists for proposals — **no opportunity presence**.

### 1.4 UI operations (`crm-client` + hooks)

| Tab / surface | Operations |
|---------------|------------|
| Dashboard | Live KPIs (leads, pipeline $, win rate), funnel/by-stage charts, quick actions |
| Leads | Create/edit details·address·revenue, convert (qualified only), delete, CSV |
| Opportunities | Create/edit, change stage, mark won/lost, convert → SO, lines, **table-or-board** kanban |
| Contacts | CRUD, address/business/details, identities+roles panels, payments/messages, chatter/timeline |
| Activities | Create, complete |
| Contact tags / segments | Create tag/segment, assign/add |
| Attribution | `CrmUtmSettings` (campaign/medium/source) |
| Duplicates | Client detect + scan reducer + merge |

### 1.5 Tests

| Layer | Coverage |
|-------|----------|
| Domain reducers | `run_all_crm_tests`: contact update/delete, lead delete, identity/role/dupe-by-phone, opportunity convert/line/stage |
| E2E | `mvp-lead-to-cash`, `phone-first-contacts`, `crm-contact-identities-ui`, messaging opt-out |
| Unit | `crm-params-merge`, update-params helpers |

**Not covered:** territories, scoring, quotas, forecasting, campaign attribution math, consent UI lifecycle, relationship graphs, collaborative presence.

---

## 2. Gap matrix (quality bar vs inventory)

| Capability | State | Notes |
|------------|-------|-------|
| Prospecting / lead intake | **Present** | Lead CRUD + CSV; state machine `new→qualified→converted/lost` |
| Qualification | **Partial** | State string; no scoring, no qualification checklist |
| Opportunities + stages | **Present** | Stage transitions update probability; won/lost side-effects |
| Pipeline board (real-time) | **Partial** | Board UI + subscriptions; no collaborative presence / optimistic multi-user conflict UX |
| Forecasting | **Partial** | Per-deal `expected_revenue × probability`; no period forecasts, categories, commit |
| Sales quotas / territories | **Absent** | No tables/reducers |
| Activities / calendar | **Partial** | Activities wired; calendar reducers exist, thin UI; no chaining UI for `ActivityType` |
| Campaigns | **Unsuitable as “campaigns”** | UTM *dimensions* only — not send plans, audiences, ROI |
| Campaign attribution | **Partial** | IDs on lead/opp/SO/move; no multi-touch/credit model |
| Partner channels | **Partial** | `is_partner`, role `partner`/`distributor`/`agent`; no PRM programs |
| Customer communication | **Present** | Preferences, WhatsApp/SMS ops messaging, chatter |
| Post-sale history | **Partial** | Contact panel for payments/messages; no unified 360 command center |
| Lead scoring | **Absent** | |
| Customer hierarchies | **Partial** | `parent_id` field only |
| Consent history | **Partial** | `PrivacyConsent` + reducer; CRM UI history thin |
| Duplicate governance | **Present** | Email / name+phone; merge rewires leads/opps/SO/tags/segments/relationships |
| Relationship intelligence | **Absent** | Table shell; no graph, intensity, or AI features |
| Configurable address formats | **Absent** | Flat street/city/zip/state/country; country packs are tax |
| Company identifiers | **Partial** | `tax_id`, `company_registry`; no pack-driven validation (ABN, CNPJ, UEN…) |
| Phone normalization | **Present** | E.164 via `phonenumber` + region from country |
| Multilingual names | **Partial** | Western `first_name`/`last_name`; no display-order / script fields |
| WhatsApp-first patterns | **Partial–Present** | Identity kind + credentials + messaging; not CRM-native conversation inbox |
| Collaborative opp presence | **Absent** | Pattern exists on proposals only |

---

## 3. Required invariants

### Authorization

- Every CRM reducer: `check_permission(ctx, organization_id, resource, action)`.
- Org membership on load; company scope via `company_id` / `require_company_in_organization` for identities, roles, duplicates, opportunity writes.
- Field-level write: `ensure_resource_fields_writable` on `update_contact` / `update_opportunity` (Casbin metadata fields).
- Phone E.164 columns treated as sensitive in query registry (masked display default).

### Audit

- Mutations end with `write_audit_log_v2` (CREATE/UPDATE/DELETE/SET_ACTIVE-style actions).
- Soft-delete contacts/leads (`deleted_at`); merge sets `merge_target_id` for traceability.

### Concurrency / consistency (SpacetimeDB)

- Reducers are **single transactions** — convert lead (contact+opp), convert opp→SO, merge contacts must stay atomic.
- No optimistic client-only stage moves without reducer success.
- Duplicate scan/merge and identity “preferred” uniqueness must remain company-scoped (validated in phone-first E2E).
- Lead convert: only `state == "qualified"`; opportunity convert requires partner + lines + warehouse/pricelist.

### Accounting / lead-to-cash couplings

- Won opportunity → sale order inherits partner, lines, UTM campaign IDs where mapped.
- Customer contact used as `partner_id` for AR/SO — ranks/roles must stay consistent with credit/invoicing.
- Consent opt-out must block outreach batches (messaging E2E already asserts this).
- Period locks / credit control sit on post-CRM accounting path — CRM must not invent balances.

---

## 4. Reference workflows

1. **Inbound prospect** → create lead (UTM) → qualify → convert → contact + opportunity
2. **Outbound / phone-first** → contact + WhatsApp identity → verify → role `prospect` → activity → opportunity
3. **Pipeline** → stage moves (board/table) → add lines → mark won/lost or convert to SO
4. **Cash** → SO → invoice → payment (MVP e2e golden path)
5. **Governance** → scan duplicates → merge → survivor keeps history
6. **Retention** → communication preference + privacy consent → purge policy (org)
7. **Partner** → role `distributor`/`agent` + referred_by (no commission engine yet)

### Acceptance scenarios (≥10)

1. Create contact with tax id + address; soft-delete hides from active lists; audit CREATE/DELETE.
2. Add WhatsApp identity with local AU/ZA/BR number; store E.164; preferred uniqueness per contact.
3. Assign/end `customer` role company-scoped; cross-company isolation holds.
4. Create lead with UTM campaign; only **qualified** lead converts.
5. Convert creates contact + opportunity; campaign/source/medium preserved.
6. Stage change updates probability from stage; won sets `is_won` + `date_closed`.
7. Opportunity with lines converts to sale order linked by opportunity/partner.
8. Duplicate email pair in same company detected; merge rewires leads/opps/orders; loser has `merge_target_id`.
9. Branch company duplicate does not appear in main company dupe list.
10. Opted-out contact excluded from WhatsApp batch; opted-in with valid identity included.
11. Field policy denies write to restricted contact fields.
12. Tenant B cannot see/mutate tenant A contacts (cross-tenant e2e).
13. Board stage drag fails closed if reducer fails; subscribed clients refresh to server stage.
14. Calendar event create/update stays org-scoped; linked `partner_ids` invalid if foreign org.
15. Consent grant then revoke appends history (`granted`/`revoked_at`); messaging respects latest.

---

## 5. Localization matrix (CRM-relevant)

Country packs today are **tax-centric**. CRM needs address/ID/name/phone overlays per region.

| Concern | Oceania (AU/NZ) | Southern Africa (ZA+) | Brazil / Southern Cone (BR/AR/CL) | Maritime SEA (SG/MY/ID/PH/TH) |
|---------|-----------------|------------------------|-----------------------------------|--------------------------------|
| Address format | Suburb/state/postcode; NZ postcodes | Province / municipality | CEP + estado; AR/CL provincial | SG postal; MY/ID state/province; PH barangay |
| Company ID | ABN/ACN; NZBN | Company reg / VAT | CNPJ/CPF; CUIT; RUT | UEN; SSM; NPWP; TIN |
| Phone | +61/+64; E.164 ✅ | +27; WhatsApp-heavy ✅ path | +55/+54/+56; mobile-first | +65/+60/+62/+63/+66 |
| Names | Western given/family | Often Western + clan | Given + compound family; accents | Malay/Indo single names; Chinese order; Thai given+nick |
| Consent | Privacy Act AU/NZ | POPIA | LGPD | PDPA variants |
| Currency/FY (ops) | AUD/NZD; AU FY Jul | ZAR | BRL/ARS/CLP; inflation modes in pack meta | SGD/MYR/IDR/PHP/THB |
| Pack seed today | AU, NZ | ZA | BR, AR, CL | SG, MY, ID, TH, PH |
| CRM pack gap | Address schema + ABN validation | Address + POPIA consent types | Nested address + CNPJ/CPF validators | Flexible name + UEN/NPWP |

**i18n:** UI strings primarily `en.json`; region packs do not yet drive address forms or name field sets.

---

## 6. SpacetimeDB architecture decision (CRM)

| Topic | Decision |
|-------|----------|
| **Transactions** | Keep all lifecycle mutations in reducers (convert, merge, stage, identity verify). Do not split convert across client round-trips. |
| **Subscriptions** | Expand CRM workspace keys to include `opportunity-lines`, tags/assignments, segments/members, UTM, privacy-consent, communication preferences for true customer-360 freshness. Keep high-churn messaging in `messages-workspace`. |
| **Isolation** | Enforce org filter in every SQL subscription; company filter for identities, roles, duplicate candidates, opportunity company binding. Public tables + private RLS-style query registry remain mandatory. |
| **Scale** | Index paths already: org/company/email/stage/normalized E.164. Avoid full-table duplicate O(n²) scans for large tenants — move to indexed email/phone candidate indexes or scheduled candidate materialization. Dynamic segments: do not evaluate arbitrary domain strings inside hot reducers without bounded rules. |
| **External-service boundary** | Reducers: normalize phone, consent, preferences, outbound *intent* rows. **Procedures/API workers:** WhatsApp Business Cloud, SMS gateways, email ESP, enrichment/scoring models, CNPJ/ABN lookups. Store provider message IDs on operational message rows; never block reducers on HTTP. |
| **Presence** | New `opportunity_presence` (conn id, opp id, user, last_seen) updated from client heartbeat; ephemeral, org-scoped subscription — mirror `proposal-presence`. |
| **Forecast/quota** | Either pure client aggregates over subscribed opps (pilot) or scheduled snapshot tables (`forecast_snapshot`) for period commit — do not recompute warehouse facts inside UI-only code for audit-grade forecasts. |

---

## 7. Priority classification

### Pilot-critical

- Lead → opportunity → SO integrity (already e2e); keep green
- Phone E.164 + WhatsApp identity + opt-out preferences
- Company/org isolation on contacts, duplicates, roles
- Opportunity stage board + update_opportunity permissions/field policy
- Duplicate scan/merge for data hygiene
- Consent recording path usable before outbound messaging in target regions
- Expand CRM subscriptions for contact-360 freshness (identities, messages, activities already partly there)

### Competitive

- Configurable address / company-ID validators via country packs
- Multilingual / region-aware name models
- Real pipeline forecasting (period, weighted, owner rollup)
- Territory assignment + assignment-rule engine (table already seeded)
- Campaign attribution reports (UTM → won revenue)
- Relationship create/UI + account hierarchy (`parent_id`)
- Consent history UI in contact sheet
- Opportunity stages / lead sources admin reducers (end seed-only)

### Differentiating

- Collaborative opportunity presence + live chatter (Attio-class)
- WhatsApp-native CRM inbox (not just ops batch send)
- Relationship intelligence / enrichment
- Lead scoring with explainable factors (procedure + reducer apply)
- Partner channel programs + multi-touch attribution
- True dynamic segments with safe, indexed rule AST

---

## Bottom line

The product already supports an **operational CRM spine** suitable for pilot lead-to-cash, with unusual strength in **phone-first / WhatsApp identity** and **merge-aware party governance**. The gap to the stated quality bar is not “add NetSuite modules wholesale,” but closing **forecast/territory/quota**, making **UTM into attribution**, finishing **relationship/hierarchy**, grounding **locale packs for party data** (not only tax), and using SpacetimeDB subscriptions for **live board + customer-360** — with presence and scoring as differentiating layers, not pilot blockers.

### Related docs

- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, SoD, country packs, FX
- CRM module: `spacetimedb/src/crm/`
- CRM workspace subscriptions: `frontend/packages/stdb/src/subscriptions/crm-workspace.ts`
- Domain tests: `spacetimedb/tests/crm/` (`run_all_crm_tests`)

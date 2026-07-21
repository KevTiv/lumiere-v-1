# Proposals & Tenders — Gap Fixes Plan

Backlog derived from [PROPOSALS_TENDERS_INVESTIGATION.md](../PROPOSALS_TENDERS_INVESTIGATION.md) (2026-07-21).  
NetSuite is a **quality bar**, not a feature-copy spec.

## Wave A — Pilot integrity (company, money, contracts, hygiene)

- [x] Require `company_id` + `currency_id` (or code) on create; company guards on all proposal mutators; isolation domain tests
- [x] Migrate create/update/status/section/line reducers to `*Params` + flat scope ids; audit sweep
- [x] Status transition machine in reducer (UI soft-gates insufficient)
- [x] Bid/no-bid decision table + reducer (blocks submit when no-bid)
- [x] Remove or quarantine aspirational phantom reducer names in coverage scripts
- [x] Align / deprecate misaligned registry form statuses (`sent`/`viewed`/…) with `ProposalStatus`
- [x] Drop or clearly label “Import RFP” quick action until real ingest exists

## Wave B — Collaboration truth (versions + conflicts)

- [x] `save_proposal_version` snapshots **server** sections (+ lines + commercial totals); client supplies message only
- [x] Wire restore: transactional rewrite of live sections from snapshot + audit
- [x] Section upsert optimistic concurrency (`expected_write_date` / revision) + explicit conflict resolve reducer
- [x] Presence permission checks + TTL / disconnect cleanup; proposal-scoped presence queries where possible
- [x] Cap inline `proposal_source_doc` size; large files → documents module references

## Wave C — Commercial close (approvals + convert + traceability)

- [x] Approval/SoD gate before Submitted→Awarded (workflow subject or dedicated approve)
- [x] Recompute / enforce commercial total from lines (tax/FX display per company currency)
- [x] `convert_proposal_to_sale_order` with `proposal_id` FK + partner/line inheritance + double-convert guard
- [x] Optional `convert_proposal_to_project` (services)
- [x] Post-award list drill-down proposal → SO/project
- [x] Wire `partner_id` / `document_folder_id` / `template_id` on create UI

## Wave D — Tender depth (competitive)

- [x] STDB template store (multilingual section skeletons) replacing in-memory builtins
- [x] Compliance matrix + document-requirement rows; submit guards
- [x] Clause library + country-pack commercial terms blocks
- [x] Persist analyze output as requirements/scores via reducer (mock non-prod only)
- [x] Link document esign to `proposal_version_id`
- [x] Mount or delete orphan `tender-editor-panel` / `ai-analysis-panel`

## Wave E — Portals & packages (differentiating)

- [x] PDF/DOCX proposal generator worker from template + version
- [x] `proposal_integration_intent` + workers for regional portals (GeBIZ, AusTender, eTender, …)
- [x] Bidder/customer clarification portal principal
- [x] Preferential procurement / local-content score columns (ZA/SEA packs)

## Out of scope until waves A–C land

- Full OT/CRDT collaborative editing
- Live statutory adapters pretending country-pack metadata is law
- Merging sales proposals with purchasing `purchase_rfq` tables

## Validation notes (2026-07-21 implementation)

- Domain tests: `run_all_proposals_tests` / `run_proposals_wave_a_test` (company isolation, bid gate, revision conflict, server snapshot+restore)
- Domain tests Wave D/E: `run_proposals_wave_d_test` (template apply, compliance submit guard, analysis materialize, PDF intent)
- `cargo check` (spacetimedb): passed after Waves A–E
- Bindings: `spacetime generate` TS + Rust; `make codegen` for registry/auth assets
- Post-award list columns: `saleOrderId` / `projectId` on proposals table config
- Wave D/E UI: library templates in sidebar, compliance checklist, analyze persist, PDF intent queue
- Orphan panels `tender-editor-panel` / `ai-analysis-panel` deleted (superseded by `AIPanel` + STDB sections)
- Publish note: schema changes require `make local-reset` (or clear-database republish) before domain tests / UI smoke
- Worker note: PDF/DOCX/portal intents are STDB rows for out-of-reducer workers — workers not shipped in this wave

# Configured Alpha record creation

Baseline: `fbb9a6b56b9a93bce4cd105b85f9099b6dff87a0`. This packet implements H2 of the Alpha capability handoff, with an additional Accounting partial-write correction. Deployment and independent business acceptance remain separate.

## Implemented behavior

- CRM lead, opportunity and contact creation and Sales quotation creation validate the complete native request, custom definitions and exact form scope before business writes. The base record, typed EAV values and an immutable actor/company-scoped creation receipt commit in one reducer transaction.
- The reserved `__lumiere_create_v1` metadata envelope carries an exact company string and operation key. Native code derives the actor and full typed-request SHA-256 fingerprint. Changed input or another actor cannot reuse the key.
- Metadata-only Lead creation resolves the requested envelope company and uses the existing CRM capability gate and canonical company-membership policy. Legacy requests without an envelope retain the default company. The Lead table remains organization-shared; this packet does not introduce company-private Lead records. Receipt and EAV scope follow the authorized selected company.
- Frontend create hooks retain the original complete request under actor/organization/company/model scope before dispatch, use Web Locks for cross-tab coordination and disable automatic mutation retries. They check the exact private receipt before a user-requested retry and replay identical bytes with the same key. A changed draft cannot replace an unresolved request or be reported saved when an older attempt resolves.
- The private `lead-creations`, `opportunity-creations`, `contact-creations` and `quotation-creations` reads use current authorization, membership-derived company and exact creator/model/key filters. They expose receipt identity, not business-record contents or a general receipt feed.
- Purchase orders reuse `create_purchase_order_once` and its existing receipt. Custom fields are validated/persisted inside the same canonical create transaction; unkeyed Purchase Order creation does not admit them.
- Manual invoices/bills validate and save EAV values in `create_manual_account_invoice`, using its existing Accounting idempotency receipt. Post-success/status-read custom-field mutations must be removed by the Accounting integration owner.
- C2 commits capture complete business records, lines where authored, EAV values, canonical audits, exact receipts and SO/PO document sequences. An identical replay creates no additional source commit. Restoring those commits is a distinct runtime acceptance check.
- The obsolete alternate one-shot quotation command and its dedicated helper/tests are retired. Invoice-effect tests are retained.

## Validation boundaries

Definitions are selected from one active organization/module/form configuration, including personal fields belonging to the current actor and form. Duplicate/ambiguous definitions, disabled role fields, missing required fields and invalid types/options fail before writes. Required role rules merge into value validation, so null/empty values cannot bypass them. Camel-case UI and snake-case native length constraints have one strict decoder; conflicting aliases and unknown constraints reject.

Text, finite numbers, booleans, configured options, string arrays and valid date/time values preserve their types, including numeric zero and boolean false. Arbitrary regex policies, conditional visibility, files, hidden/password/custom renderers and dynamic UserSelect options without stored canonical choices remain explicit exclusions. They must be explained before entry by the form owner; a failed save does not create a partial record.

## Executed local checks

- Twelve invocation tests pass with `node --import tsx --test --test-isolation=none src/hooks/record-creation-invocation.test.ts` in query-hooks. They cover durable-before-POST identity, exact large IDs, lost-response recovery without duplicate POST, immutable explicit retry, changed drafts, unavailable/denied reads, rejected input, actor/company changes, storage failures and invalid/ambiguous receipts.
- Five mounted UI hook tests pass for the actual production transport: StrictMode effect setup/cleanup, actor A→B→A, company 2→3→2, unmount during a pending read and an unavailable Web Locks API.
- Query-hooks TypeScript passes with the existing local immutable contracts pin.
- New invocation/transport/test files pass the actual shared ESLint configuration with zero warnings. Broad changed-file lint also reports pre-existing unused imports/warnings in the large CRM/Purchasing consumers; no baseline allowance was changed.
- Rust formatting and whitespace checks pass.
- A standalone web TypeScript attempt exhausted the default 4 GiB V8 heap before completion. Integrated web validation belongs to the coordinator's serial larger-heap run; this attempt is not a pass.

## Runtime cases added; execution still required

`run_configured_record_creation_tests` is registered in `run_all_platform_tests`. It invokes real Contact, quotation and keyed Purchase Order owners and checks base/EAV/receipt identity, no duplicates on replay, rejected changed payload, invalid/missing/empty/null custom values, role restrictions and company boundaries. It also checks exact durable source-commit rows and no additional commit on replay.

The same runtime gate includes selected-company Lead creation with a false-superuser administrator holding an exact live `*:*` role, ordinary bound/default membership, expired/inactive additive roles, a valid additive administrator and ambiguous membership. The fixture explicitly opts into the existing CRM multi-company capability so policy assertions do not pass merely because the rollout guard blocked them.

`run_accounting_post_invoice_test` includes the extended manual invoice scenario. It checks a real balanced invoice plus custom values and receipt, replay stability, invalid-custom-field rejection without a base move and exact C2 coverage. Existing invoice tax, posting and effect assertions remain.

Native compile and execution, API runtime authorization/readback, matching contract/schema release, integrated browser journeys and served-version proof are coordinator-owned gates. Source and synthetic tests do not establish those outcomes.

## Integration checklist

- Register `queries::record_creations` before generic resource dispatch, without adding a broad private-table registry entry.
- Generate/release the new private receipt schema and immutable artifacts through the existing workflow. Do not rewrite released migrations or tags.
- Register the six literal source-commit helpers from `forms/record_creation_persistence.rs` in the C2 coverage manifest.
- Remove the five obsolete `customFieldCreateUnavailableMessage` declarations only for admitted CRM lead/opportunity/contact, quotation and Purchase Order forms. Retain the shared capability guard for unsupported owners.
- Remove the obsolete CRM custom-field guard test from the explicit web-unit file list. Invocation tests are auto-discovered in query-hooks; the mounted hook test is auto-discovered in UI.
- Integrate the separately owned visible pending-create check/restore/handoff controls and typed Accounting custom-field editor.
- Verify the complete retained-input → save → exact reopen journey against real services before claiming H2 acceptance.

# Helpdesk canonical business-record relation activation

This source change adds a private `helpdesk_ticket_related_record` row keyed by
`ticket_id`, a `set_helpdesk_related_record` reducer, and a sender-authorized
`helpdesk_related_record_read` view. The target is a closed typed union:
`SaleOrder(u64)` or `AccountMove(u64)`. No stored text is used as a label or URL.

Existing Helpdesk tickets are organization-wide and have no company column or
related-record field. This change leaves their schema and create/update params
unchanged. The relation owns an explicit company scope. While present it cannot
move to another company; clear it explicitly before reassociation. Native
company-restricted memberships cannot set, replace, or clear another company's
relation. Both ticket-write and target-read permission are required when setting.
Clearing deliberately needs no target-read permission, so inaccessible references
can be removed by an authorized ticket writer.

The private table must never be exposed as a generic public query. The read view
checks the live organization profile, first active membership, company restriction,
ticket-read permission, target-read permission, live ticket/company existence and
canonical target organization/company. It returns only identifiers and target kind.
A hidden/inaccessible relation yields no row: clients must label this as "no
accessible related record", not evidence that no relation exists. Labels must
come from a separate authorized target read. Field-level redaction of target IDs
and feature/module entitlement checks must be applied by the BFF before client
activation.

## Required before enabling the client

1. Compile and publish the module to an isolated test cell without clearing a
   production database. Run `run_helpdesk_relational_integrity_test`; query the
   sender-specific view with separate authorized/denied identities and verify
   changes to memberships/roles immediately revoke rows. Include tickets/targets
   in the same organization but different companies, deleted ticket/company,
   missing target and revoked target permission.
2. Generate schema IR and all Rust/TypeScript bindings from that exact compiled
   module through the repository codegen workflow. The storage-policy source entry
   treats the relation as a durable, always-hot child of `helpdesk_ticket`, using
   natural key `ticket_id`. Regenerate storage/reconstruction manifests and
   `generated_reconstruction_apply.rs`; validate commit projection, restore order
   (ticket before relation), and set/clear replay in the reconstruction drill.
   The reducer records upserts/deletes through `record_organization_commit`.
3. Release the resulting immutable `lumiere-contracts` artifact with its real
   module fingerprint, source commit and generated view/reducer metadata. Update
   this repository's pin through its normal release/resolve workflow. No bindings,
   schema IR, or published version are hand-written by this change.
4. Register the new operation in the regenerated immutable operation catalog and
   its Helpdesk BFF command hints. Add a query resource backed by
   `helpdesk_related_record_read`, with ticket permission, requested-company
   authorization, target resource/module checks, target-ID field access and no
   fallback to private-table SQL. Generate resource/field/company metadata.
5. Add a company-scoped query hook and mutation hook using regenerated types.
   Implement a target selector populated only from authorized canonical records.
   Read target labels independently. Extend the existing cross-record link builder
   to resolve SaleOrder/AccountMove targets with its strict ID/scope/duplicate
   checks and canonical `saleOrderHref`/`accountMoveHref`. Add the related link
   to the Helpdesk record sheet and verify click, reload, return, permission loss
   and denied/missing read states with mounted/browser tests.

The integrated native module test build passes, including compilation of the
Helpdesk reducer regression harness. All four Helpdesk helper tests pass through
`cargo test --locked --lib helpdesk::related_records::tests`; Rust formatting also
passes. Runtime reducer harness execution in a test cell, sender-view queries,
reconstruction/codegen, contract release, and client/browser activation remain
pending. This is backend
source preparation, not a claim that the pinned published contract supports the
new operation or view.

# Documents and communications completion packet

Baseline: `fbb9a6b56b9a93bce4cd105b85f9099b6dff87a0`.

Implemented:

- A fresh, uncached API preview scans the existing purge owner's entire organization-wide scope. It excludes active legal holds, preserves exact IDs/timestamps, redacts names outside the live owner/field ACL, and blocks the UI when any affected row cannot be reviewed. Immediate and delayed actions show affected records before confirmation. Permission, company/actor continuity and a fresh scope fingerprint are checked before dispatch.
- Immediate deletion uses the new `purge_reviewed_expired_documents(organization_id, document_ids)` operation. It recomputes current expired, deleted and non-held documents inside the reducer transaction and rejects any mismatch before calling the existing hard-purge owner. The historical unbound operation remains available to its existing callers. The new UI uses the reviewed operation.
- Scheduled jobs retain the existing dynamic behavior. The preview includes documents expiring by the proposed run time and explicitly states that eligibility and holds are checked again at execution. It is not a frozen future deletion set.
- The canonical contact/invoice batch creators capture per-record exclusion reasons when eligibility is decided. Creation deduplicates candidate contact IDs. Caller-supplied metadata cannot override the captured snapshot.
- Company-scoped batches atomically capture their exclusions through the existing private `business_change` owner and organization commit, including the batch, child intents and captured evidence. The dedicated read route authorizes current batch/company/field access before private reads and refreshes authority before returning. Public raw audit rows and historical caller metadata cannot establish this evidence. Legacy and organization-wide batches without capture remain explicitly unavailable.
- Batch review shows exact provider references only when service-authored conversation evidence matches the operational message, organization, company and status. Provider acceptance, confirmed delivery, failure and unavailable evidence remain distinct. No provider send or receipt is fabricated.

Integration dependencies owned by the coordinator:

- Release the new native operation through the immutable contracts workflow, add it to the Documents typed command/invalidation and UI operation inventories, and regenerate the operation registry. Existing released tags/migrations remain unchanged; no new table or SQL migration is introduced by this packet.
- Add `operational_message_id` to the existing CRM conversation-message default projection, retaining field-policy enforcement.
- Call `messaging::strip_untrusted_batch_exclusions(&mut rows)` for `message-batches` generic query responses. The dedicated source-authorized endpoint is the only trusted exclusion source.
- Merge the English locale fragment at `/tmp/alpha-documents-i18n.json`.

Verification recorded locally:

- Five message review helper cases pass, including exact large IDs, wrong-company evidence, legacy forged metadata, incomplete snapshots and provider acceptance versus delivery.
- Four retention helper/actual-reader cases pass, including hidden/incomplete scope, changed fingerprints and denied/unavailable reads that issue only one uncached GET.
- Query-hooks TypeScript passed before introducing the new native-operation signature; the final check requires the coordinator's new contract release. A full web check was stopped near the default V8 heap limit; it is not a pass.
- New and messages-specific TypeScript files pass the existing UI ESLint configuration. Whole touched Documents files retain pre-existing unused-symbol lint findings (`DocumentLockProjection`, `organizationId`, `editDocumentForm`, `versionFormConfig`); these were not waived or reclassified as passes.
- New API tests cover authoritative hold/delay/hidden scope, malformed/denied sources, stable fingerprint behavior, and a real SQL fixture proving unpaginated organization-wide reads with failed reads returning errors. Native tests cover exact reviewed-set matching and captured metadata replacement. Rust sources pass formatting; native/API execution remains an integration gate.

No production purge, provider send, deployment, or human acceptance was performed. Final integrated typechecks, native/API tests, authenticated save/readback and device acceptance remain required.

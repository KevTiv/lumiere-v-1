# Alpha history coverage inventory

The [generated register](alpha-history-inventory.json) indexes source ownership and history signals for the ten current alpha business modules and their supporting surfaces. It extends the existing Finance inventory parsers and canonical operation identities. The [implementation plan](../plans/alpha-erp-history-and-sources.md) defines the coverage and release requirements.

Each operation row records its actual native source, canonical identity, exposure, affected module candidates, direct capture/audit signals, persistence registration signals and remaining entry-path, field-policy and runtime checks. API source-review decisions, source admission and import recovery appear separately under `service_paths`, since they do not have native reducer identities. `provider_contracts` distinguishes company-owned `business_change`, organization-wide `organization_business_change`, PostgreSQL source decisions, import-row receipts and immutable review/import bindings.

Source signals describe what can be observed statically:

| Status | Meaning |
| --- | --- |
| `trusted-helper-observed-branch-and-fields-unverified` | A direct trusted capture or business-audit adapter call exists. Its branches, supplied material fields and actual persisted effects still need review. |
| `delegated-helper-observed-branch-and-fields-unverified` | A bounded, unambiguous helper path reaches trusted capture. The path is source evidence, with the same execution and material-field limits as direct capture. |
| `audit-only-completeness-and-trust-unverified` | A direct legacy audit call exists. It does not establish authoritative before/after values. |
| `delegated-legacy-audit-no-trusted-capture` | A helper path reaches legacy audit but no private capture was observed. |
| `guarded-owner-fallback-no-private-capture` | The standalone writer is blocked by the complete-owner policy. It retains legacy audit until that exact owner merges evidence into its source outcome. |
| `capture-not-merged-no-private-history` | Private rows were staged, but no registered exact owner merge was observed on this entry path. The rows do not count as durable private history. |
| `capture-policy-unresolved-no-private-history` | A dynamic producer operation could not be resolved to a closed owner policy. |
| `conditional-typed-import-owner-not-universal-history` | The tracked-import owner merges exact source and evidence for its five declared targets. Other CSV entity branches remain outside this conditional contract. |
| `import-receipt-only-no-material-change-evidence` | An exact imported-row mapping was observed. It does not establish material edit history or original source bytes. |
| `domain-evidence-only-not-shared-private-history` | A domain event, version or run record was observed. Its source authority and API integration remain separate from shared private history. |
| `no-direct-history-signal` | No supported direct or delegated capture/audit/receipt signal was observed. Ambiguous calls, callbacks and deeper delegation remain owner review work. |
| `source-unresolved` | The native implementation could not be resolved. Contract evidence alone cannot certify capture. |

Session exposure is a transport boundary. Module source ownership does not establish a current enabled browser path, and broad source files can contain operations outside a bounded alpha workspace. The register therefore preserves `entry-path-review-required-not-proven-by-session-exposure`. Linked project tasks, employee reference imports and communications do not admit their hidden standalone modules.

`capture_start` and `runtime_evidence` stay unset until the owner supplies deployed proof. The static generator never upgrades a row to runtime-certified history. Overview is an authorized aggregate reader and owns no mutation candidates.

The delegated scan follows at most six call levels and 256 unambiguous function locations per operation. It prefers a function in the caller's source file when names overlap and does not guess among other ambiguous names. Each observed path retains source locations and its provider candidates. `scan_limited` identifies paths that reach a traversal limit. A business-audit adapter can choose either company or organization scope from canonical producer data at runtime, so its static provider list records candidates rather than asserting both are written.

`write_business_audit` and `write_private_business_audit` create a standalone evidence journal only when the owner policy allows it. Protected owners retain legacy audit through those writers until their source outcome integrates the evidence. `capture_business_audit` and `capture_private_business_audit` stage rows for a caller; they count as an observed owner integration only when the registered owner merges that vector into its canonical commit. The generic evidence journal is registered separately from complete C2 business outcomes and never grants module or operation completeness.

`typed_import_capture_producers` records the import staging owner's actual match cases and source scopes: product imports are organization-wide, ledger entries and lines are company-owned, and contacts/stock locations retain their optional source company. Direct CSV entry points stage evidence without establishing a complete durable outcome. The sealed tracked-import owner can merge job, mappings, errors, exact source rows and audit-linked evidence for these five targets. Its `conditional_outcomes` classification does not certify other `import_csv_tracked` entities or add universal C2 coverage. Per-target provider candidates remain separate from universal private-provider counts; each canonical operation still appears once.

The review/import binding provider verifies saved confirmed source values and revision, then retains an immutable request/content/row binding. That prepared binding alone cannot establish that a native record was created; the source reader must match the exact native import outcome.

Module counts may overlap for shared workflows, while each canonical operation appears once in the aggregate. The summary includes counts by module/status and the explicit operation names without observed private capture. These gaps remain open even when an existing domain receipt or audit makes the action inspectable elsewhere.

Regenerate after producer, scope or contract changes:

```bash
python3 -B scripts/generate-alpha-history-inventory.py
python3 -B scripts/generate-alpha-history-inventory.py --check
python3 -B -m unittest discover -s scripts/tests -p test_alpha_history_inventory.py -v
```

CI checks the exact generated artifact and rejects new alpha surfaces without an ownership classification. The contracts release workflow regenerates and checks the same artifact alongside the existing Finance inventory. Input digests bind native sources, shared capture helpers, operation metadata, the complete-owner policy, the workspace profile and bounded Inventory tab metadata. Policy validation rejects unknown producer identities, unregistered complete owners and direct complete owners that add an unguarded standalone journal. The C2 boundary tests separately protect evidence-only and conditional classifications.

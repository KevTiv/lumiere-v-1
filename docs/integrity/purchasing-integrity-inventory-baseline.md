# Purchasing Relational-Integrity Inventory — Baseline

This is the Phase 0 diagnostic required by the [Purchasing remediation plan](../plans/purchasing-relational-integrity-remediation-plan.md). The implementation is [`spacetimedb/src/purchasing/integrity_inventory.rs`](../../spacetimedb/src/purchasing/integrity_inventory.rs).

It is a permanent operational reducer rather than a SQL script because it can
inspect the full persisted relationship graph despite the project's HTTP SQL
limitations. It is read-only: it only iterates tables, creates in-memory maps,
and emits structured log lines; it never calls `insert`, `update`, or `delete`.

## Runbook

Publish the candidate module to the intended isolated/dev database, then:

```text
spacetime call <database> purchasing_integrity_inventory
spacetime logs <database> | grep "[purchasing-integrity]"
```

Do not use `--clear-database` on an environment whose records are being
measured. Running the reducer itself does not mutate any data. Re-run it before
and after each relation migration and attach the log output, environment name,
and date to the relevant PUR-RI tracker row.

## Coverage

The report emits six independently countable categories, with up to five stable
sample IDs per category:

| Category | Detects |
|---|---|
| `zero_relation_ids` | Required relation IDs and optional company/PO/accounting/bank IDs incorrectly stored as `0`. |
| `dangling_relations` | Missing parent, company, vendor, product, UoM, currency, picking, journal, accounting move/vendor bill, payment-term, warehouse, or PO targets across the Purchasing graph. |
| `cross_organization_or_company` | Existing relations whose tenant/company differs from their parent/referencing Purchasing row, including foreign companies, pickings, journals, moves/vendor bills, and partner-bank payment journals. |
| `duplicate_or_mismatched_collections` | Duplicate reverse-vector IDs, stale header vectors versus authoritative child tables, and PO picking-count disagreement. |
| `mismatched_business_relations` | PO-line partner/currency/company disagreement, RFQ-bid currency/company disagreement, and return/source-PO-line substitution. |
| `duplicate_integration_intents` | Reused `(organization, company, provider, intent type, idempotency key)` tuples. |

This inventory reports evidence only; it deliberately does not quarantine,
backfill, clear, or repair data. Ambiguous links must be quarantined according
to the remediation plan rather than guessed from display text or a first row.

## Verification

Run `cargo fmt --check` and `cargo check` from `spacetimedb/` before publishing.
The native check validates that all examined table accessors and fields exist;
the actual inventory must then be executed through the published WASM module to
measure persisted data. A clean native check or an unrun inventory is not a
zero-violation result.

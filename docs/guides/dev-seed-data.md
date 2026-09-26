# Dev Seed Data

`spacetimedb/src/seed.rs` now uses a hybrid strategy:

- Realistic linked flows for the core ERP paths already surfaced in the UI.
- A final coverage pass that inserts one representative row for many otherwise-empty public tables.

## Goals

- Make more modules visually inspectable in local UI demos.
- Reduce false negatives when a screen looks unfinished only because its table is empty.
- Keep the seed understandable by separating business-flow data from coverage-only filler.

## Contract

- `seed_dev_data` is still idempotent at the organization level. If `Lumiere Demo Corp` already exists, the reducer exits without re-seeding.
- Coverage rows are intentionally marked with `{"seed":true,"coverage":true}` metadata where the table supports metadata.
- Coverage rows are not meant to model every business rule perfectly. They exist so every major public surface has at least one representative record to render.

## Coverage Pass

The coverage pass focuses on table families that were previously easy to miss in local demos:

- Core infra: settings, reference extras, sessions, UTM, messaging, queue, privacy, audit.
- CRM support tables: activities, calendar, lead metadata, segments, assignments.
- POS execution: payment methods, configs, loyalty artifacts, sessions, orders, lines, and payments.
- Inventory execution: supplier/customer locations, pickings, moves, move lines, lots, serials, traceability, cycle counts, and adjustments.
- Purchasing edge flows: partner banks, supplier intake, requisitions, and landed costs.
- Manufacturing execution: production orders, work orders, workcenter productivity, and attached quality records.
- Accounting runtime/reporting: bank match candidates plus representative financial report outputs.
- Forms and integrations.
- Proposals collaboration tables.
- Workflow runtime/definition tables.
- Reporting, knowledge, AI intelligence, fleet, and geo helpers.

This is still intentionally non-exhaustive. The seed favors representative linked records for heavy public table families over trying to simulate every downstream workflow perfectly.

## Usage

```bash
spacetime call lumiere-v1 seed_dev_data '{}'
```

If you need a clean rerun, clear the local database first and then call the reducer again.

### Versioned first-organization personas

After `seed_dev_data`, provision the seven named COV personas and verify their
credential, membership, role-assignment, and representative module rows:

```bash
make seed-first-org-personas
```

The manifest is
[`frontend/web/fixtures/first-org-fixture.v1.json`](../../frontend/web/fixtures/first-org-fixture.v1.json).
Set `E2E_FIRST_ORG_PERSONA_PASSWORD` to override the local-only fixture password.
The provisioner requires the exact `Lumiere Demo Corp` (`DEMO`) organization and
`Lumiere Technologies Inc.` (`LTI`) company; it does not fall back to another
tenant.

To validate the checked-in manifest without a running stack:

```bash
make check-cov02-first-org-fixture
```

These commands are trusted setup utilities. Their health report is setup
evidence, not browser operator-path proof.

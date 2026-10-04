# Durable PostgreSQL migration ledger

`lumiere-codegen` used to regenerate the whole durable schema as migration 1 on
every contracts release. The api-server records each migration's checksum and
refuses to start when a released migration changes, so every schema change
invalidated every existing database.

Released migrations are now frozen here and emitted verbatim. The generator
adds one pending follow-up migration containing only what the current schema
adds on top of the released set:

- a table that is new is added whole;
- an existing table may only gain `CREATE [UNIQUE] INDEX IF NOT EXISTS` lines;
- anything else (a column, a type, a removed table or index) fails generation:
  author an explicit migration in `api-server` instead of relying on
  `CREATE TABLE IF NOT EXISTS`, which would silently do nothing on a database
  that already has the table.

`pending.version` shares the api-server migration catalog's version space
(`api-server/src/cold_tier/migrate.rs`); keep it contiguous with the authored
migrations there. After a release, copy the published pending file here, add it
to `released`, and advance `pending`.

## Landing a follow-up

The pending file ships in the next contracts release, and api-server can only
reference it (`lumiere_contracts::manifests::PG_DDL_MIGRATIONS_00NN_...`) once
that release is pinned. Land it in two steps so no branch ever fails to build:

1. Push the schema/generator change. `release-contracts.yml` publishes the next
   contracts version (it releases on a change to the durable migrations even
   when the IR hash is unchanged) and pins it.
2. After the pin, add the `Migration` entry to the catalog in
   `api-server/src/cold_tier/migrate.rs` (a new change set, `Expand` phase), raise
   `durable_postgres.application_catalog_version` in
   `release-compatibility-manifest.json`, and promote the published pending file
   into this directory.

Editing `migrate.rs` before the pin breaks every service that runs
`cargo watch -w api-server` (the Docker dev stack), because the constant does not
exist in the pinned crate yet.

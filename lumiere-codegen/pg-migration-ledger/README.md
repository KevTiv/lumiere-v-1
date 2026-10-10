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

1. Run codegen. It prints the pending file it generated and writes it to the
   staging directory.
2. Promote it in the same commit as its consumer: copy the file here, add it to
   `released` in `ledger.json`, and advance `pending`.
3. In `api-server/src/cold_tier/migrate.rs` add the `Migration` entry (a new
   change set, `Expand` phase) with
   `sql: include_str!("../../../lumiere-codegen/pg-migration-ledger/<file>.sql")`,
   and raise `durable_postgres.application_catalog_version` in
   `release-compatibility-manifest.json`. The release workflow recomputes the
   catalog checksum when it pins.

The ledger file is the single source of truth: api-server embeds it and the
contracts release republishes the same bytes, so the catalog never depends on a
contracts constant that is not pinned yet. (A constant from the pinned crate would
break every `cargo watch -w api-server` service until the release landed.)
`Dockerfile.rust` copies this directory for the same reason.

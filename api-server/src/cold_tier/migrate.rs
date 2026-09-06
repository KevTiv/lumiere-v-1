//! Versioned PostgreSQL migrations for the durable/cold-tier schema.
//!
//! The cold tier used to execute a collection of `CREATE ... IF NOT EXISTS`
//! statements on every process start. That made startup idempotent, but it
//! did not record which schema a database had, detect edited SQL, or provide
//! a safe ordering for dependencies. This module owns the durable migration
//! history and applies each migration exactly once.
//!
//! Migrations are deliberately append-only. A later application version may
//! add an additive migration, but it must not edit one that may already have
//! been applied. A checksum mismatch therefore fails closed instead of
//! attempting to infer whether an existing database can be repaired.

use anyhow::{bail, Context, Result};
use deadpool_postgres::Pool;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

use super::ledger;
use crate::platform_control;

/// The table containing the durable migration history.
pub const MIGRATION_TABLE: &str = platform_control::SCHEMA_MIGRATION_TABLE;

/// One migration known by this application binary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Migration {
    /// Monotonically increasing migration number.
    pub version: i64,
    /// Stable human-readable identifier. This is part of the migration
    /// identity and must not be reused for different SQL.
    pub name: &'static str,
    /// Additive rollout this migration belongs to.
    pub change_set: i64,
    /// Ordered expand/backfill/verify/contract phase within the change set.
    pub phase: MigrationPhase,
    /// PostgreSQL statements to execute as one migration.
    pub sql: &'static str,
}

/// Safe schema rollout order. A new change set always starts at [`Self::Expand`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MigrationPhase {
    Expand,
    ProjectBackfill,
    Verify,
    Contract,
}

impl MigrationPhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Expand => "expand",
            Self::ProjectBackfill => "project_backfill",
            Self::Verify => "verify",
            Self::Contract => "contract",
        }
    }
}

/// The currently shipped migration catalog, in dependency order.
///
/// The durable projection migration is emitted by `lumiere-codegen`; this
/// list only binds that immutable artifact to its release identity. The
/// remaining entries are authored cold-tier infrastructure migrations. If
/// generated SQL for an already released migration changes, the checksum
/// check intentionally blocks startup until an authored follow-up migration
/// is added.
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "durable_projection",
        change_set: 1,
        phase: MigrationPhase::Expand,
        sql: lumiere_contracts::manifests::PG_DDL_MIGRATIONS_0001_DURABLE_PROJECTION,
    },
    Migration {
        version: 2,
        name: "cold_pos_order",
        change_set: 1,
        phase: MigrationPhase::Expand,
        sql: lumiere_contracts::manifests::PG_DDL_COLD_POS_ORDER,
    },
    Migration {
        version: 3,
        name: "organization_projection_watermark",
        change_set: 1,
        phase: MigrationPhase::Expand,
        sql: lumiere_contracts::manifests::PG_DDL_ORGANIZATION_PROJECTION_WATERMARK,
    },
    Migration {
        version: 4,
        name: "organization_projection_quarantine",
        change_set: 1,
        phase: MigrationPhase::Expand,
        sql: lumiere_contracts::manifests::PG_DDL_ORGANIZATION_PROJECTION_QUARANTINE,
    },
    Migration {
        version: 5,
        name: "organization_projection_status",
        change_set: 1,
        phase: MigrationPhase::Expand,
        sql: lumiere_contracts::manifests::PG_DDL_ORGANIZATION_PROJECTION_STATUS,
    },
    Migration {
        version: 6,
        name: "archive_transfer",
        change_set: 1,
        phase: MigrationPhase::Expand,
        sql: ledger::ARCHIVE_TRANSFER_DDL,
    },
    Migration {
        version: 7,
        name: "platform_control",
        change_set: 1,
        phase: MigrationPhase::Expand,
        sql: platform_control::PLATFORM_CONTROL_DDL,
    },
    Migration {
        version: 8,
        name: "platform_reset_token_binding",
        change_set: 2,
        phase: MigrationPhase::Expand,
        sql: platform_control::PLATFORM_RESET_TOKEN_BINDING_DDL,
    },
    Migration {
        version: 9,
        name: "organization_commit_protocol_upgrade",
        change_set: 2,
        phase: MigrationPhase::Expand,
        sql: ORGANIZATION_COMMIT_PROTOCOL_UPGRADE_SQL,
    },
];

/// SQL used to bootstrap the migration history itself.
///
/// This is intentionally not represented as a numbered migration: without a
/// history table there is nowhere to record the fact that a numbered
/// migration ran. The `IF NOT EXISTS` makes bootstrap safe for databases
/// upgraded from the old startup-only DDL path.
const MIGRATION_TABLE_DDL: &str = r#"
create schema if not exists lumiere_platform;

-- Adopt the pre-C0 API-server history table without copying or losing its
-- checksums.  The target relation is intentionally created after this block.
do $$
begin
    if to_regclass('public.lumiere_schema_migrations') is not null
       and to_regclass('lumiere_platform.schema_migration') is null then
        alter table public.lumiere_schema_migrations set schema lumiere_platform;
        alter table lumiere_platform.lumiere_schema_migrations rename to schema_migration;
    end if;
end
$$;

create table if not exists lumiere_platform.schema_migration (
    version bigint primary key,
    name text not null unique,
    change_set bigint not null,
    phase text not null check (phase in ('expand', 'project_backfill', 'verify', 'contract')),
    checksum text not null,
    applied_at timestamptz not null default now()
)
"#;

/// Advisory lock key shared by every process that can run cold-tier setup.
///
/// `pg_advisory_xact_lock` releases this lock automatically if the connection
/// or transaction fails, so a crashed drainer cannot strand future startups.
const MIGRATION_LOCK_KEY: i64 = 0x4c554d49455245;
const DURABLE_SCHEMA_MANIFEST_JSON: &str = lumiere_contracts::manifests::DURABLE_PG_SCHEMA_MANIFEST;
const POSTGRES_IDENTIFIER_MAX_BYTES: usize = 63;

/// Adopt the column types, indexes, and protocol constraints that C4 declares
/// for C3 heap relations.
///
/// The C3 projection worker created these tables with `CREATE TABLE IF NOT
/// EXISTS`, so the C4 baseline could not add constraints when it adopted an
/// existing relation. PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`; each
/// guarded block is therefore deliberately idempotent for both legacy and
/// fresh databases. The tax-deadline index is renamed only when its C3 shape
/// is non-unique, freeing the canonical name for the required unique index.
/// The parent unique key is added before the child foreign key that references
/// it.
const ORGANIZATION_COMMIT_PROTOCOL_UPGRADE_SQL: &str = r#"
do $lumiere$
begin
    if to_regclass('organization_row_change') is not null
       and exists (
           select 1
           from pg_catalog.pg_attribute
           where attrelid = to_regclass('organization_row_change')
             and attname = 'row_identity_json'
             and not attisdropped
             and atttypid <> 'jsonb'::regtype
       ) then
        alter table "organization_row_change"
            alter column "row_identity_json" type jsonb
            using "row_identity_json"::jsonb;
    end if;
end
$lumiere$;

do $lumiere$
begin
    if to_regclass('organization_row_change') is not null
       and exists (
           select 1
           from pg_catalog.pg_attribute
           where attrelid = to_regclass('organization_row_change')
             and attname = 'row_json'
             and not attisdropped
             and atttypid <> 'jsonb'::regtype
       ) then
        alter table "organization_row_change"
            alter column "row_json" type jsonb
            using "row_json"::jsonb;
    end if;
end
$lumiere$;

do $lumiere$
begin
    if exists (
        select 1
        from pg_catalog.pg_class index_relation
        join pg_catalog.pg_index index_definition
          on index_definition.indexrelid = index_relation.oid
        where index_relation.oid = to_regclass('tax_deadline_status_job_organization_id')
          and not index_definition.indisunique
    ) then
        alter index "tax_deadline_status_job_organization_id"
            rename to "tax_deadline_status_job_organization_id_legacy";
    end if;
end
$lumiere$;

create unique index if not exists "tax_deadline_status_job_organization_id"
    on "tax_deadline_status_job" ("organization_id");

do $lumiere$
begin
    if to_regclass('organization_commit') is not null
       and not exists (
           select 1
           from pg_catalog.pg_constraint
           where conrelid = to_regclass('organization_commit')
             and conname = 'organization_commit_org_sequence_key'
       ) then
        alter table "organization_commit"
            add constraint "organization_commit_org_sequence_key"
            unique ("organization_id", "sequence");
    end if;
end
$lumiere$;

do $lumiere$
begin
    if to_regclass('organization_row_change') is not null
       and not exists (
           select 1
           from pg_catalog.pg_constraint
           where conrelid = to_regclass('organization_row_change')
             and conname = 'organization_row_change_commit_fk'
       ) then
        alter table "organization_row_change"
            add constraint "organization_row_change_commit_fk"
            foreign key ("organization_id", "commit_sequence")
            references "organization_commit" ("organization_id", "sequence");
    end if;
end
$lumiere$;

do $lumiere$
begin
    if to_regclass('organization_row_change') is not null
       and not exists (
           select 1
           from pg_catalog.pg_constraint
           where conrelid = to_regclass('organization_row_change')
             and conname = 'organization_row_change_commit_ordinal_key'
       ) then
        alter table "organization_row_change"
            add constraint "organization_row_change_commit_ordinal_key"
            unique ("organization_id", "commit_sequence", "ordinal");
    end if;
end
$lumiere$;

do $lumiere$
begin
    if to_regclass('organization_row_change') is not null
       and not exists (
           select 1
           from pg_catalog.pg_constraint
           where conrelid = to_regclass('organization_row_change')
             and conname = 'organization_row_change_kind_check'
       ) then
        alter table "organization_row_change"
            add constraint "organization_row_change_kind_check"
            check ("change_kind" in ('upsert', 'delete'));
    end if;
end
$lumiere$;

do $lumiere$
begin
    if to_regclass('organization_row_change') is not null
       and not exists (
           select 1
           from pg_catalog.pg_constraint
           where conrelid = to_regclass('organization_row_change')
             and conname = 'organization_row_change_payload_check'
       ) then
        alter table "organization_row_change"
            add constraint "organization_row_change_payload_check"
            check (("change_kind" = 'upsert' and "row_json" is not null)
                or ("change_kind" = 'delete' and "row_json" is null));
    end if;
end
$lumiere$;
"#;

fn postgres_identifier(identifier: &str) -> String {
    identifier
        .chars()
        .scan(0usize, |bytes, character| {
            let next = *bytes + character.len_utf8();
            if next > POSTGRES_IDENTIFIER_MAX_BYTES {
                None
            } else {
                *bytes = next;
                Some(character)
            }
        })
        .collect()
}

/// Return the checksum recorded for a migration's SQL.
///
/// The algorithm prefix makes the stored value unambiguous if a stronger
/// digest is adopted later. The exact SQL bytes are hashed, including the
/// generated file's header and whitespace, because changing either is a
/// release-significant migration edit.
pub fn migration_checksum(sql: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(sql.as_bytes()))
}

/// Return a deterministic fingerprint for the complete application migration
/// catalog, including every migration's rollout metadata and SQL checksum.
pub fn migration_catalog_checksum(migrations: &[Migration]) -> String {
    let mut digest = Sha256::new();
    for migration in migrations {
        digest.update(migration.version.to_be_bytes());
        digest.update([0]);
        digest.update(migration.name.as_bytes());
        digest.update([0]);
        digest.update(migration.change_set.to_be_bytes());
        digest.update([0]);
        digest.update(migration.phase.as_str().as_bytes());
        digest.update([0]);
        digest.update(migration_checksum(migration.sql).as_bytes());
        digest.update([0xff]);
    }
    format!("sha256:{:x}", digest.finalize())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AppliedMigration {
    version: i64,
    name: String,
    change_set: i64,
    phase: String,
    checksum: String,
}

/// Validate persisted history and return the first migration to apply.
///
/// History must be a contiguous prefix of the compiled catalog. Allowing a
/// later version while an earlier one is missing would make dependency order
/// unverifiable and could leave a partially provisioned database looking
/// current. Unknown versions are rejected so an incompatible application
/// cannot silently operate against a schema it does not understand.
fn first_pending_migration(
    applied: &[AppliedMigration],
    migrations: &[Migration],
) -> Result<usize> {
    if migrations
        .windows(2)
        .any(|pair| pair[0].version >= pair[1].version)
    {
        bail!("compiled PostgreSQL migrations are not strictly ordered");
    }

    if migrations
        .iter()
        .enumerate()
        .any(|(index, migration)| migration.version != (index as i64) + 1)
    {
        bail!("compiled PostgreSQL migrations must start at version 1 without gaps");
    }

    for pair in migrations.windows(2) {
        if pair[0].change_set > pair[1].change_set
            || (pair[0].change_set == pair[1].change_set && pair[0].phase > pair[1].phase)
        {
            bail!("compiled PostgreSQL migration rollout phases are out of order");
        }
    }

    for (index, persisted) in applied.iter().enumerate() {
        let expected_version = index as i64 + 1;
        if persisted.version != expected_version {
            bail!(
                "database PostgreSQL migration history is not contiguous at version {} (found {})",
                expected_version,
                persisted.version
            );
        }
        if !matches!(
            persisted.phase.as_str(),
            "expand" | "project_backfill" | "verify" | "contract"
        ) {
            bail!(
                "database PostgreSQL migration {} has an unknown rollout phase",
                persisted.version
            );
        }
        if let Some(previous) = index.checked_sub(1).and_then(|i| applied.get(i)) {
            let phase_rank = |phase: &str| match phase {
                "expand" => 0,
                "project_backfill" => 1,
                "verify" => 2,
                "contract" => 3,
                _ => 4,
            };
            if previous.change_set > persisted.change_set
                || (previous.change_set == persisted.change_set
                    && phase_rank(&previous.phase) > phase_rank(&persisted.phase))
            {
                bail!("database PostgreSQL migration rollout phases are out of order");
            }
        }
    }

    for (persisted, expected) in applied.iter().zip(migrations) {
        if persisted.name != expected.name {
            bail!(
                "PostgreSQL migration {} name mismatch (database '{}', application '{}')",
                expected.version,
                persisted.name,
                expected.name
            );
        }
        if persisted.change_set != expected.change_set || persisted.phase != expected.phase.as_str()
        {
            bail!(
                "PostgreSQL migration {} rollout metadata mismatch; refusing to start",
                expected.version
            );
        }

        let expected_checksum = migration_checksum(expected.sql);
        if persisted.checksum != expected_checksum {
            bail!(
                "PostgreSQL migration {} checksum mismatch; refusing to start",
                expected.version
            );
        }
    }

    // A rolled-back application may encounter migrations authored by the next
    // release. Expand/backfill/verify phases are additive by contract and are
    // safe to leave in place. A future contract phase is intentionally
    // incompatible and must fail closed rather than attempting a PG downgrade.
    if let Some(incompatible) = applied
        .iter()
        .skip(migrations.len())
        .find(|migration| migration.phase == "contract")
    {
        bail!(
            "database contains incompatible future contract migration {}",
            incompatible.version
        );
    }

    Ok(applied.len().min(migrations.len()))
}

#[derive(Debug, Default)]
struct ActualTable {
    relkind: String,
    columns: BTreeMap<String, (String, bool)>,
}

/// Verify the durable relations before recording the baseline as applied.
///
/// `CREATE TABLE IF NOT EXISTS` is required to adopt C3 databases, but it does
/// not prove that an existing table has the expected shape. This catalog check
/// validates every required column, its exact PG type/nullability, the primary
/// key, tenant-leading access, and the tenant-safe conflict target. Additional
/// columns and indexes remain allowed so an application rollback can run
/// against a newer additive schema.
async fn verify_durable_schema(transaction: &tokio_postgres::Transaction<'_>) -> Result<()> {
    let manifest: Value = serde_json::from_str(DURABLE_SCHEMA_MANIFEST_JSON)
        .context("parse durable PostgreSQL schema manifest")?;
    let expected_tables = manifest["tables"]
        .as_object()
        .context("durable PostgreSQL schema manifest lacks tables")?;

    let column_rows = transaction
        .query(
            "select c.relname, c.relkind::text, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull \
             from pg_catalog.pg_class c \
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace \
             join pg_catalog.pg_attribute a on a.attrelid = c.oid \
             where n.nspname = current_schema() and c.relkind in ('r', 'p') \
               and a.attnum > 0 and not a.attisdropped \
             order by c.relname, a.attnum",
            &[],
        )
        .await
        .context("read durable PostgreSQL table columns")?;
    let mut actual_tables = BTreeMap::<String, ActualTable>::new();
    for row in column_rows {
        let table: String = row.get(0);
        let entry = actual_tables.entry(table).or_default();
        entry.relkind = row.get(1);
        entry
            .columns
            .insert(row.get(2), (row.get::<_, String>(3), row.get(4)));
    }

    let index_rows = transaction
        .query(
            "select c.relname, index_relation.relname, i.indisprimary, i.indisunique, \
                    array_agg(a.attname::text order by keys.ordinality)::text[] \
             from pg_catalog.pg_index i \
             join pg_catalog.pg_class c on c.oid = i.indrelid \
             join pg_catalog.pg_class index_relation on index_relation.oid = i.indexrelid \
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace \
             cross join lateral unnest(i.indkey) with ordinality as keys(attnum, ordinality) \
             join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = keys.attnum \
             where n.nspname = current_schema() and i.indisvalid and i.indisready \
               and i.indpred is null and i.indexprs is null \
             group by c.relname, index_relation.relname, i.indexrelid, i.indisprimary, i.indisunique",
            &[],
        )
        .await
        .context("read durable PostgreSQL table indexes")?;
    let mut indexes = BTreeMap::<String, Vec<(String, bool, bool, Vec<String>)>>::new();
    for row in index_rows {
        indexes.entry(row.get(0)).or_default().push((
            row.get(1),
            row.get(2),
            row.get(3),
            row.get(4),
        ));
    }
    let partition_rows = transaction
        .query(
            "select c.relname, partitioned.partstrat::text, \
                    array_agg(a.attname::text order by keys.ordinality)::text[] \
             from pg_catalog.pg_partitioned_table partitioned \
             join pg_catalog.pg_class c on c.oid = partitioned.partrelid \
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace \
             cross join lateral unnest(partitioned.partattrs) with ordinality as keys(attnum, ordinality) \
             join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = keys.attnum \
             where n.nspname = current_schema() \
             group by c.relname, partitioned.partstrat",
            &[],
        )
        .await
        .context("read durable PostgreSQL partition keys")?;
    let mut partitions = BTreeMap::<String, (String, Vec<String>)>::new();
    for row in partition_rows {
        partitions.insert(row.get(0), (row.get(1), row.get(2)));
    }
    let partition_child_rows = transaction
        .query(
            "select parent.relname, pg_catalog.pg_get_expr(child.relpartbound, child.oid) \
             from pg_catalog.pg_inherits inheritance \
             join pg_catalog.pg_class parent on parent.oid = inheritance.inhparent \
             join pg_catalog.pg_namespace n on n.oid = parent.relnamespace \
             join pg_catalog.pg_class child on child.oid = inheritance.inhrelid \
             where n.nspname = current_schema() \
               and parent.relkind = 'p' \
               and child.relispartition \
             order by parent.relname, child.relname",
            &[],
        )
        .await
        .context("read durable PostgreSQL partition bounds")?;
    let mut partition_bounds = BTreeMap::<String, Vec<String>>::new();
    for row in partition_child_rows {
        let bound: Option<String> = row.get(1);
        let bound = bound.context("durable PostgreSQL partition child has no bound")?;
        partition_bounds.entry(row.get(0)).or_default().push(bound);
    }
    let constraint_rows = transaction
        .query(
            "select c.relname, constraint_row.conname \
             from pg_catalog.pg_constraint constraint_row \
             join pg_catalog.pg_class c on c.oid = constraint_row.conrelid \
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace \
             where n.nspname = current_schema()",
            &[],
        )
        .await
        .context("read durable PostgreSQL table constraints")?;
    let mut constraints = BTreeMap::<String, BTreeSet<String>>::new();
    for row in constraint_rows {
        constraints
            .entry(row.get(0))
            .or_default()
            .insert(row.get(1));
    }

    // `archive_transfer` is shared cold-tier infrastructure rather than an
    // application projection, so it is intentionally absent from the
    // generated durable-schema manifest. Verify its migration-owned shape
    // explicitly; `CREATE TABLE IF NOT EXISTS` must not adopt a malformed
    // pre-existing ledger.
    let archive_transfer = actual_tables
        .get("archive_transfer")
        .context("archive_transfer table is missing")?;
    if archive_transfer.relkind != "r" {
        bail!("archive_transfer has incompatible relation kind");
    }
    let expected_archive_transfer_columns = [
        ("resource", "text", true),
        ("row_id", "numeric(20,0)", true),
        ("organization_id", "numeric(20,0)", true),
        ("archive_version", "bigint", true),
        ("payload_checksum", "text", true),
        ("pg_transferred_at", "timestamp with time zone", true),
        ("stdb_finalized_at", "timestamp with time zone", false),
    ];
    for (column, expected_type, expected_not_null) in expected_archive_transfer_columns {
        let (actual_type, actual_not_null) = archive_transfer
            .columns
            .get(column)
            .with_context(|| format!("archive_transfer lacks required column '{column}'"))?;
        if actual_type != expected_type || *actual_not_null != expected_not_null {
            bail!("archive_transfer column '{column}' has incompatible type or nullability");
        }
    }
    let archive_indexes = indexes
        .get("archive_transfer")
        .map(Vec::as_slice)
        .unwrap_or_default();
    let archive_primary = ["resource".to_string(), "row_id".to_string()];
    if !archive_indexes
        .iter()
        .any(|(name, primary, unique, columns)| {
            name == "archive_transfer_pkey" && *primary && *unique && columns == &archive_primary
        })
    {
        bail!("archive_transfer has an incompatible primary key");
    }
    let archive_org_index = ["organization_id".to_string()];
    if !archive_indexes
        .iter()
        .any(|(name, primary, unique, columns)| {
            name == "archive_transfer_org" && !*primary && !*unique && columns == &archive_org_index
        })
    {
        bail!("archive_transfer lacks its organization index");
    }

    for (table, expected) in expected_tables {
        if expected["applicable"].as_bool() != Some(true) {
            continue;
        }
        let actual = actual_tables
            .get(table)
            .with_context(|| format!("durable PostgreSQL table '{table}' is missing"))?;
        let access_path = expected["postgres_access_path"]
            .as_str()
            .context("durable PostgreSQL table lacks access path")?;
        let allowed_relkind = actual.relkind == "r"
            || (access_path == "organization_partition" && actual.relkind == "p");
        if !allowed_relkind {
            bail!("durable PostgreSQL table '{table}' has incompatible relation kind");
        }
        for column in expected["columns"]
            .as_array()
            .context("durable PostgreSQL table lacks columns")?
        {
            let name = column["name"]
                .as_str()
                .context("durable PostgreSQL column lacks name")?;
            let expected_type = column["pg_type"]
                .as_str()
                .context("durable PostgreSQL column lacks PG type")?
                .to_ascii_lowercase();
            let expected_not_null = column["nullable"].as_bool() == Some(false);
            let (actual_type, actual_not_null) = actual.columns.get(name).with_context(|| {
                format!("durable PostgreSQL table '{table}' lacks column '{name}'")
            })?;
            if actual_type != &expected_type || *actual_not_null != expected_not_null {
                bail!(
                    "durable PostgreSQL table '{table}' column '{name}' has incompatible type or nullability"
                );
            }
        }

        let primary_key = expected["primary_key"]["column"]
            .as_str()
            .context("durable PostgreSQL table lacks primary key")?;
        let table_indexes = indexes.get(table).map(Vec::as_slice).unwrap_or_default();
        let legacy_primary = vec![primary_key.to_string()];
        let organization_column = expected["organization_column"].as_str();
        let partition_primary = organization_column.and_then(|organization| {
            (organization != primary_key)
                .then(|| vec![organization.to_string(), primary_key.to_string()])
        });
        let has_primary = table_indexes.iter().any(|(_, primary, _, columns)| {
            *primary
                && (columns == &legacy_primary
                    || partition_primary
                        .as_ref()
                        .is_some_and(|value| columns == value))
        });
        if !has_primary {
            bail!("durable PostgreSQL table '{table}' has incompatible primary key");
        }
        for expected_index in expected["indexes"]
            .as_array()
            .context("durable PostgreSQL table lacks index metadata")?
        {
            let index_name = expected_index["name"]
                .as_str()
                .context("durable PostgreSQL index lacks name")?;
            let persisted_index_name = postgres_identifier(index_name);
            let index_unique = expected_index["unique"]
                .as_bool()
                .context("durable PostgreSQL index lacks uniqueness")?;
            let index_columns = expected_index["columns"]
                .as_array()
                .context("durable PostgreSQL index lacks columns")?
                .iter()
                .map(|column| {
                    column
                        .as_str()
                        .map(str::to_string)
                        .context("durable PostgreSQL index column is not a string")
                })
                .collect::<Result<Vec<_>>>()?;
            let matches = table_indexes.iter().any(|(name, _, unique, columns)| {
                name == &persisted_index_name
                    && *unique == index_unique
                    && columns == &index_columns
            });
            if !matches {
                bail!("durable PostgreSQL table '{table}' lacks declared index '{index_name}'");
            }
        }
        if let Some(organization) = organization_column {
            let tenant_leading = table_indexes.iter().any(|(_, _, _, columns)| {
                columns.first().is_some_and(|value| value == organization)
            });
            if !tenant_leading {
                bail!("durable PostgreSQL table '{table}' lacks a tenant-leading index");
            }
            if access_path == "organization_partition" {
                let conflict_columns = vec![organization.to_string(), primary_key.to_string()];
                let tenant_unique = table_indexes
                    .iter()
                    .any(|(_, _, unique, columns)| *unique && columns == &conflict_columns);
                if !tenant_unique {
                    bail!("durable PostgreSQL table '{table}' lacks its tenant-safe unique index");
                }
            }
        }
        if actual.relkind == "p" {
            let expected_partition = expected["partition"]
                .as_object()
                .context("partitioned durable PostgreSQL table lacks partition metadata")?;
            let expected_column = expected_partition["column"]
                .as_str()
                .context("partition metadata lacks column")?;
            let modulus = expected_partition["modulus"]
                .as_u64()
                .context("partition metadata lacks modulus")?;
            let (strategy, columns) = partitions.get(table).with_context(|| {
                format!("durable PostgreSQL table '{table}' lacks partition-key metadata")
            })?;
            if strategy != "h" || columns != &vec![expected_column.to_string()] {
                bail!("durable PostgreSQL table '{table}' has incompatible partition key");
            }
            let bounds = partition_bounds
                .get(table)
                .map(Vec::as_slice)
                .unwrap_or_default();
            if bounds.len() != modulus as usize {
                bail!("durable PostgreSQL table '{table}' has incomplete partition coverage");
            }
            for remainder in 0..modulus {
                let marker = format!("modulus {modulus}, remainder {remainder}");
                if !bounds
                    .iter()
                    .any(|bound| bound.to_ascii_lowercase().contains(&marker))
                {
                    bail!(
                        "durable PostgreSQL table '{table}' lacks hash partition remainder {remainder}"
                    );
                }
            }
        }

        let required_constraints: &[&str] = match table.as_str() {
            "organization_commit" => &[
                "organization_commit_pkey",
                "organization_commit_org_sequence_key",
            ],
            "organization_row_change" => &[
                "organization_row_change_pkey",
                "organization_row_change_commit_fk",
                "organization_row_change_commit_ordinal_key",
                "organization_row_change_kind_check",
                "organization_row_change_payload_check",
            ],
            _ => &[],
        };
        let actual_constraints = constraints.get(table);
        for constraint in required_constraints {
            if !actual_constraints.is_some_and(|names| names.contains(*constraint)) {
                bail!(
                    "durable PostgreSQL table '{table}' lacks required constraint '{constraint}'"
                );
            }
        }
    }
    Ok(())
}

/// Apply all pending durable-schema migrations.
///
/// The migration history check, each DDL statement, and its history insert
/// execute under one transaction-scoped advisory lock. A failed migration
/// rolls back both schema changes and its history row, so a retry starts from
/// the last known-good prefix. Existing databases created by the former
/// `CREATE IF NOT EXISTS` startup path are adopted by replaying the
/// idempotent baseline statements and recording their checksums.
pub async fn ensure_schema(pool: &Pool) -> Result<()> {
    let mut client = pool
        .get()
        .await
        .context("get PG client for migration runner")?;
    let transaction = client
        .transaction()
        .await
        .context("begin PostgreSQL migration transaction")?;

    transaction
        .batch_execute(MIGRATION_TABLE_DDL)
        .await
        .context("bootstrap PostgreSQL migration history")?;
    transaction
        .execute(
            "select pg_advisory_xact_lock($1::bigint)",
            &[&MIGRATION_LOCK_KEY],
        )
        .await
        .context("lock PostgreSQL migration runner")?;

    let rows = transaction
        .query(
            "select version, name, change_set, phase, checksum from lumiere_platform.schema_migration order by version asc",
            &[],
        )
        .await
        .context("read PostgreSQL migration history")?;
    let applied = rows
        .into_iter()
        .map(|row| AppliedMigration {
            version: row.get("version"),
            name: row.get("name"),
            change_set: row.get("change_set"),
            phase: row.get("phase"),
            checksum: row.get("checksum"),
        })
        .collect::<Vec<_>>();
    let first_pending = first_pending_migration(&applied, MIGRATIONS)
        .context("validate PostgreSQL migration history")?;

    for migration in MIGRATIONS.iter().skip(first_pending) {
        let checksum = migration_checksum(migration.sql);
        transaction
            .batch_execute(migration.sql)
            .await
            .with_context(|| {
                format!(
                    "apply PostgreSQL migration {} ({})",
                    migration.version, migration.name
                )
            })?;
        transaction
            .execute(
                "insert into lumiere_platform.schema_migration (version, name, change_set, phase, checksum) values ($1, $2, $3, $4, $5)",
                &[&migration.version, &migration.name, &migration.change_set, &migration.phase.as_str(), &checksum],
            )
            .await
            .with_context(|| {
                format!(
                    "record PostgreSQL migration {} ({})",
                    migration.version, migration.name
                )
            })?;
    }

    verify_durable_schema(&transaction)
        .await
        .context("verify durable PostgreSQL schema")?;

    transaction
        .commit()
        .await
        .context("commit PostgreSQL migrations")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn applied(migration: Migration, checksum: String) -> AppliedMigration {
        AppliedMigration {
            version: migration.version,
            name: migration.name.to_string(),
            change_set: migration.change_set,
            phase: migration.phase.as_str().to_string(),
            checksum,
        }
    }

    #[test]
    fn shipped_migrations_are_ordered_and_have_unique_names() {
        assert!(!MIGRATIONS.is_empty());
        for (index, migration) in MIGRATIONS.iter().enumerate() {
            assert_eq!(migration.version, index as i64 + 1);
            assert!(!migration.name.is_empty());
            assert_eq!(migration_checksum(migration.sql).len(), 71);
            assert!(migration_checksum(migration.sql).starts_with("sha256:"));
            assert!(MIGRATIONS[..index]
                .iter()
                .all(|previous| previous.name != migration.name));
        }
    }

    #[test]
    fn organization_commit_protocol_upgrade_is_additive_and_idempotent() {
        let migration = MIGRATIONS
            .iter()
            .find(|migration| migration.name == "organization_commit_protocol_upgrade")
            .expect("protocol upgrade migration is shipped");
        assert_eq!(migration.version, 10);
        assert_eq!(migration.change_set, 2);
        assert_eq!(migration.phase, MigrationPhase::Expand);
        assert!(migration.sql.contains("to_regclass('organization_commit')"));
        assert!(migration
            .sql
            .contains("to_regclass('organization_row_change')"));
        for column in ["row_identity_json", "row_json"] {
            assert!(
                migration
                    .sql
                    .contains(&format!("alter column \"{column}\" type jsonb")),
                "missing JSONB adoption for {column}"
            );
        }
        for constraint in [
            "organization_commit_org_sequence_key",
            "organization_row_change_commit_fk",
            "organization_row_change_commit_ordinal_key",
            "organization_row_change_kind_check",
            "organization_row_change_payload_check",
        ] {
            assert!(migration.sql.contains(constraint), "missing {constraint}");
        }
        assert_eq!(migration.sql.matches("and not exists (").count(), 5);
        assert_eq!(migration.sql.matches("and exists (").count(), 2);
        assert!(migration
            .sql
            .contains("tax_deadline_status_job_organization_id_legacy"));
        assert!(migration.sql.contains(
            "create unique index if not exists \"tax_deadline_status_job_organization_id\""
        ));
        assert!(!migration.sql.contains("drop table"));
        assert!(!migration.sql.contains("create table"));
        assert!(
            migration
                .sql
                .find("organization_commit_org_sequence_key")
                .expect("parent key")
                < migration
                    .sql
                    .find("organization_row_change_commit_fk")
                    .expect("child foreign key")
        );
    }

    #[test]
    fn migration_checksum_changes_when_sql_changes() {
        assert_ne!(
            migration_checksum("create table one (id bigint)"),
            migration_checksum("create table one (id bigint, value text)")
        );
    }

    #[test]
    fn release_manifest_binds_complete_application_migration_catalog() {
        let manifest: Value =
            serde_json::from_str(include_str!("../../../release-compatibility-manifest.json"))
                .expect("release compatibility manifest is valid JSON");
        assert_eq!(
            manifest["durable_postgres"]["application_catalog_version"],
            MIGRATIONS
                .last()
                .expect("migration catalog is non-empty")
                .version
        );
        assert_eq!(
            manifest["durable_postgres"]["application_catalog_checksum"],
            migration_catalog_checksum(MIGRATIONS)
        );
    }

    #[test]
    fn postgres_identifier_matches_server_truncation() {
        assert_eq!(postgres_identifier("short_index"), "short_index");
        assert_eq!(
            postgres_identifier(
                "contact_identity_verification_authority_organization_authority_key"
            ),
            "contact_identity_verification_authority_organization_authority_"
        );
        assert!(postgres_identifier(&format!("{}é", "x".repeat(62))).len() <= 63);
    }

    #[test]
    fn empty_history_starts_at_first_migration() {
        assert_eq!(
            first_pending_migration(&[], MIGRATIONS).expect("valid catalog"),
            0
        );
    }

    #[test]
    fn matching_history_starts_after_applied_prefix() {
        let applied = MIGRATIONS[..2]
            .iter()
            .map(|migration| applied(*migration, migration_checksum(migration.sql)))
            .collect::<Vec<_>>();
        assert_eq!(
            first_pending_migration(&applied, MIGRATIONS).expect("valid history"),
            2
        );
    }

    #[test]
    fn edited_sql_fails_checksum_validation() {
        let migration = MIGRATIONS[0];
        let applied = vec![applied(migration, migration_checksum("edited sql"))];
        let error = first_pending_migration(&applied, MIGRATIONS).expect_err("drift must fail");
        assert!(error.to_string().contains("checksum mismatch"));
    }

    #[test]
    fn out_of_order_history_fails_closed() {
        let migration = MIGRATIONS[1];
        let applied = vec![applied(migration, migration_checksum(migration.sql))];
        let error = first_pending_migration(&applied, MIGRATIONS).expect_err("gap must fail");
        assert!(error.to_string().contains("not contiguous"));
    }

    #[test]
    fn bootstrap_is_idempotent_and_has_history_columns() {
        assert_eq!(MIGRATION_TABLE, "lumiere_platform.schema_migration");
        assert!(MIGRATION_TABLE_DDL.contains("create table if not exists"));
        assert!(MIGRATION_TABLE_DDL.contains("create schema if not exists lumiere_platform"));
        assert!(MIGRATION_TABLE_DDL.contains("lumiere_schema_migrations set schema"));
        assert!(MIGRATION_TABLE_DDL.contains("version bigint primary key"));
        assert!(MIGRATION_TABLE_DDL.contains("checksum text not null"));
        assert!(MIGRATION_TABLE_DDL.contains("change_set bigint not null"));
        assert!(MIGRATION_TABLE_DDL.contains("project_backfill"));
        assert!(MIGRATION_TABLE_DDL.contains("applied_at timestamptz"));
    }

    #[test]
    fn rollout_phases_are_ordered_within_each_change_set() {
        const SQL: &str = "select 1";
        let valid = [
            Migration {
                version: 1,
                name: "expand",
                change_set: 1,
                phase: MigrationPhase::Expand,
                sql: SQL,
            },
            Migration {
                version: 2,
                name: "backfill",
                change_set: 1,
                phase: MigrationPhase::ProjectBackfill,
                sql: SQL,
            },
            Migration {
                version: 3,
                name: "verify",
                change_set: 1,
                phase: MigrationPhase::Verify,
                sql: SQL,
            },
            Migration {
                version: 4,
                name: "contract",
                change_set: 1,
                phase: MigrationPhase::Contract,
                sql: SQL,
            },
            Migration {
                version: 5,
                name: "next_expand",
                change_set: 2,
                phase: MigrationPhase::Expand,
                sql: SQL,
            },
        ];
        assert_eq!(first_pending_migration(&[], &valid).unwrap(), 0);

        let invalid = [
            Migration {
                version: 1,
                name: "verify",
                change_set: 1,
                phase: MigrationPhase::Verify,
                sql: SQL,
            },
            Migration {
                version: 2,
                name: "expand",
                change_set: 1,
                phase: MigrationPhase::Expand,
                sql: SQL,
            },
        ];
        assert!(first_pending_migration(&[], &invalid)
            .unwrap_err()
            .to_string()
            .contains("phases are out of order"));
    }

    #[test]
    fn application_rollback_accepts_future_additive_migrations() {
        let mut history = MIGRATIONS
            .iter()
            .map(|migration| applied(*migration, migration_checksum(migration.sql)))
            .collect::<Vec<_>>();
        history.push(AppliedMigration {
            version: MIGRATIONS.len() as i64 + 1,
            name: "next_release_expand".into(),
            change_set: 2,
            phase: "expand".into(),
            checksum: migration_checksum("alter table example add column additive bigint"),
        });
        assert_eq!(
            first_pending_migration(&history, MIGRATIONS).expect("additive future schema is safe"),
            MIGRATIONS.len()
        );
    }

    #[test]
    fn application_rollback_rejects_future_contract_migrations() {
        let mut history = MIGRATIONS
            .iter()
            .map(|migration| applied(*migration, migration_checksum(migration.sql)))
            .collect::<Vec<_>>();
        history.push(AppliedMigration {
            version: MIGRATIONS.len() as i64 + 1,
            name: "next_release_contract".into(),
            change_set: 2,
            phase: "contract".into(),
            checksum: migration_checksum("alter table example drop column removed"),
        });
        assert!(first_pending_migration(&history, MIGRATIONS)
            .unwrap_err()
            .to_string()
            .contains("future contract migration"));
    }
}

#[cfg(test)]
mod postgres_compatibility_tests;

//! Idempotent PG DDL application for the cold tier.
//!
//! Every statement here is `CREATE TABLE/INDEX IF NOT EXISTS`, so calling
//! this on every process start (api-server, and each drainer binary) is
//! safe and cheap. This is not a general migration framework — the cold
//! tier has no `ALTER TABLE` history to replay yet; when that's needed,
//! this is the place a real migration runner would slot in.

use anyhow::{Context, Result};
use deadpool_postgres::Pool;

use super::ledger;

/// Generated per-resource cold-table DDL, one `include_str!` per active
/// archive candidate (`lumiere-codegen/archive-candidates.json`). `include_str!`
/// keeps this in lockstep with whatever `lumiere-codegen` last emitted
/// without a filesystem read at runtime — but it does mean each new
/// candidate needs a line added here; there's no glob-at-compile-time this
/// crate does automatically.
const GENERATED_COLD_TABLE_DDL: &[(&str, &str)] = &[
    (
        "cold_audit_log.sql",
        include_str!("../generated/pg_ddl/cold_audit_log.sql"),
    ),
    (
        "cold_pos_order.sql",
        include_str!("../generated/pg_ddl/cold_pos_order.sql"),
    ),
    (
        "organization_commit.sql",
        include_str!("../generated/pg_ddl/organization_commit.sql"),
    ),
    (
        "organization_row_change.sql",
        include_str!("../generated/pg_ddl/organization_row_change.sql"),
    ),
    (
        "organization_projection_watermark.sql",
        include_str!("../generated/pg_ddl/organization_projection_watermark.sql"),
    ),
    (
        "organization_projection_quarantine.sql",
        include_str!("../generated/pg_ddl/organization_projection_quarantine.sql"),
    ),
    (
        "organization_projection_status.sql",
        include_str!("../generated/pg_ddl/organization_projection_status.sql"),
    ),
];

/// Apply every cold-tier DDL statement. Safe to call unconditionally on
/// process startup.
pub async fn ensure_schema(pool: &Pool) -> Result<()> {
    let client = pool
        .get()
        .await
        .context("get PG client for ensure_schema")?;

    for (file_name, ddl) in GENERATED_COLD_TABLE_DDL {
        client
            .batch_execute(ddl)
            .await
            .with_context(|| format!("apply {file_name}"))?;
    }

    client
        .batch_execute(ledger::ARCHIVE_TRANSFER_DDL)
        .await
        .context("apply archive_transfer ledger DDL")?;

    Ok(())
}

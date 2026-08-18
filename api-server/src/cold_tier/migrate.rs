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

/// Generated per-resource cold-table DDL. Each entry is
/// `(source .sql file description, DDL text)`; kept as a `const` include so
/// this stays in lockstep with whatever `lumiere-codegen` last emitted,
/// without needing a filesystem read at runtime.
const COLD_AUDIT_LOG_DDL: &str =
    include_str!("../generated/pg_ddl/cold_audit_log.sql");

/// Apply every cold-tier DDL statement. Safe to call unconditionally on
/// process startup.
pub async fn ensure_schema(pool: &Pool) -> Result<()> {
    let client = pool.get().await.context("get PG client for ensure_schema")?;

    client
        .batch_execute(COLD_AUDIT_LOG_DDL)
        .await
        .context("apply cold_audit_log.sql")?;

    client
        .batch_execute(ledger::ARCHIVE_TRANSFER_DDL)
        .await
        .context("apply archive_transfer ledger DDL")?;

    Ok(())
}

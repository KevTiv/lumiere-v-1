//! Bounded lineage inspection, deliberately separate from migration application.

use anyhow::{bail, Context, Result};
use deadpool_postgres::Pool;
use serde::Serialize;
use tokio_postgres::IsolationLevel;

use super::{
    first_pending_migration, migration_catalog_checksum, migration_checksum, AppliedMigration,
    Migration, MIGRATIONS, MIGRATION_TABLE,
};

const LEGACY_MIGRATION_TABLE: &str = "public.lumiere_schema_migrations";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MigrationAuditStatus {
    Matching,
    Pending,
    Uninitialized,
    Conflicting,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MigrationAuditRow {
    version: i64,
    name: String,
    change_set: i64,
    phase: String,
    checksum: String,
}

impl From<&AppliedMigration> for MigrationAuditRow {
    fn from(row: &AppliedMigration) -> Self {
        Self {
            version: row.version,
            name: row.name.clone(),
            change_set: row.change_set,
            phase: row.phase.clone(),
            checksum: row.checksum.clone(),
        }
    }
}

fn expected_row(row: &Migration) -> MigrationAuditRow {
    MigrationAuditRow {
        version: row.version,
        name: row.name.into(),
        change_set: row.change_set,
        phase: row.phase.as_str().into(),
        checksum: migration_checksum(row.sql),
    }
}

/// Contains migration identities only: no connection credentials or business rows.
#[derive(Debug, Serialize)]
pub struct MigrationAuditReport {
    pub status: MigrationAuditStatus,
    expected_catalog_version: i64,
    expected_catalog_checksum: String,
    history_relation: Option<String>,
    observed: Vec<MigrationAuditRow>,
    matching_versions: Vec<i64>,
    pending: Vec<MigrationAuditRow>,
    conflicts: Vec<String>,
}

impl MigrationAuditReport {
    pub fn require_compatible(&self) -> Result<()> {
        if self.status == MigrationAuditStatus::Conflicting {
            bail!(
                "PostgreSQL migration lineage conflicts; no changes made: {}",
                self.conflicts.join("; ")
            );
        }
        Ok(())
    }

    pub fn require_current(&self) -> Result<()> {
        self.require_compatible()?;
        if self.history_relation.as_deref() == Some(LEGACY_MIGRATION_TABLE) {
            bail!("PostgreSQL migration history uses the legacy relation; canonical history adoption is needed before verification; no changes made");
        }
        if self.status != MigrationAuditStatus::Matching {
            bail!("PostgreSQL migration history is {:?}; {} migrations remain pending; no changes made", self.status, self.pending.len());
        }
        Ok(())
    }
}

fn inspect_history(
    current: bool,
    legacy: bool,
    applied: &[AppliedMigration],
    migrations: &[Migration],
) -> MigrationAuditReport {
    let mut report = MigrationAuditReport {
        status: MigrationAuditStatus::Uninitialized,
        expected_catalog_version: migrations.last().map_or(0, |row| row.version),
        expected_catalog_checksum: migration_catalog_checksum(migrations),
        history_relation: if current {
            Some(MIGRATION_TABLE.into())
        } else if legacy {
            Some(LEGACY_MIGRATION_TABLE.into())
        } else {
            None
        },
        observed: applied.iter().map(MigrationAuditRow::from).collect(),
        matching_versions: Vec::new(),
        pending: Vec::new(),
        conflicts: Vec::new(),
    };
    if current && legacy {
        report.conflicts.push(format!("both {MIGRATION_TABLE} and {LEGACY_MIGRATION_TABLE} exist; migration history is ambiguous"));
    }
    if !current && !legacy && !applied.is_empty() {
        report
            .conflicts
            .push("migration rows have no authoritative history relation".into());
    }
    if let Err(error) = first_pending_migration(applied, migrations) {
        report.conflicts.push(error.to_string());
    }
    // Rollback startup deliberately tolerates additive future versions. Release
    // auditing is stricter: an unknown lineage is never approved for promotion.
    for row in applied {
        match migrations.iter().find(|expected| expected.version == row.version) {
            Some(expected) if MigrationAuditRow::from(row) == expected_row(expected) => {
                report.matching_versions.push(row.version);
            }
            Some(expected) => report.conflicts.push(format!(
                "migration {} differs from expected '{}' (change_set {}, phase {}, checksum {}); observed '{}' (change_set {}, phase {}, checksum {})",
                row.version, expected.name, expected.change_set, expected.phase.as_str(), migration_checksum(expected.sql), row.name, row.change_set, row.phase, row.checksum
            )),
            None => report.conflicts.push(format!("unsupported migration version {} ({}) is outside the compiled catalog", row.version, row.name)),
        }
    }
    report.pending = migrations
        .iter()
        .filter(|expected| !applied.iter().any(|row| row.version == expected.version))
        .map(expected_row)
        .collect();
    report.status = if !report.conflicts.is_empty() {
        MigrationAuditStatus::Conflicting
    } else if (!current && !legacy) || applied.is_empty() {
        MigrationAuditStatus::Uninitialized
    } else if report.pending.is_empty() {
        MigrationAuditStatus::Matching
    } else {
        MigrationAuditStatus::Pending
    };
    report
}

/// Inspect either existing history relation in a repeatable-read, READ ONLY
/// transaction. This never calls the schema bootstrap or acquires an advisory
/// migration lock. PostgreSQL's ordinary SELECT locks last only for this read.
/// The audit proves recorded lineage, not that every business table has its DDL.
pub async fn audit_schema(pool: &Pool) -> Result<MigrationAuditReport> {
    let mut client = pool
        .get()
        .await
        .context("get PG client for read-only migration audit")?;
    let transaction = client
        .build_transaction()
        .isolation_level(IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .context("begin read-only PostgreSQL migration audit")?;
    let relations = transaction.query(
        "select n.nspname, c.relname, c.relkind::text from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where (n.nspname = 'lumiere_platform' and c.relname = 'schema_migration') or (n.nspname = 'public' and c.relname = 'lumiere_schema_migrations') limit 2",
        &[],
    ).await.context("inspect existing PostgreSQL migration relations")?;
    let mut current = false;
    let mut legacy = false;
    for row in relations {
        let schema: String = row.try_get(0)?;
        let name: String = row.try_get(1)?;
        let kind: String = row.try_get(2)?;
        if !matches!(kind.as_str(), "r" | "p") {
            bail!("migration relation {schema}.{name} is not a table; no changes made");
        }
        current |= schema == "lumiere_platform" && name == "schema_migration";
        legacy |= schema == "public" && name == "lumiere_schema_migrations";
    }
    let mut applied = Vec::new();
    // Never choose one of two histories, even when they appear identical.
    if current != legacy {
        let relation = if current {
            MIGRATION_TABLE
        } else {
            LEGACY_MIGRATION_TABLE
        };
        let limit = i64::try_from(MIGRATIONS.len())?
            .checked_add(1)
            .context("migration audit row bound overflow")?;
        // Identifiers are compile-time constants. Strings and row counts are
        // bounded even if the target contains malformed history metadata.
        let rows = transaction.query(&format!(
            "select version, left(name, 256) as name, change_set, left(phase, 64) as phase, left(checksum, 80) as checksum from {relation} order by version asc limit $1"
        ), &[&limit]).await.context("read bounded PostgreSQL migration history")?;
        for row in rows {
            applied.push(AppliedMigration {
                version: row.try_get("version")?,
                name: row.try_get("name")?,
                change_set: row.try_get("change_set")?,
                phase: row.try_get("phase")?,
                checksum: row.try_get("checksum")?,
            });
        }
    }
    let report = inspect_history(current, legacy, &applied, MIGRATIONS);
    transaction
        .rollback()
        .await
        .context("end read-only PostgreSQL migration audit")?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn history(count: usize) -> Vec<AppliedMigration> {
        MIGRATIONS[..count]
            .iter()
            .map(|row| AppliedMigration {
                version: row.version,
                name: row.name.into(),
                change_set: row.change_set,
                phase: row.phase.as_str().into(),
                checksum: migration_checksum(row.sql),
            })
            .collect()
    }

    #[test]
    fn reports_exact_prefix_and_pending_without_approving_incomplete_verify() {
        let pending = inspect_history(true, false, &history(16), MIGRATIONS);
        assert_eq!(pending.status, MigrationAuditStatus::Pending);
        assert_eq!(pending.matching_versions, (1..=16).collect::<Vec<_>>());
        assert_eq!(pending.pending[0].name, "platform_identity_lifecycle");
        assert!(pending.require_compatible().is_ok());
        assert!(pending.require_current().is_err());
        let complete = inspect_history(true, false, &history(MIGRATIONS.len()), MIGRATIONS);
        assert_eq!(complete.status, MigrationAuditStatus::Matching);
        assert!(complete.require_current().is_ok());
    }

    #[test]
    fn accepts_main_catalog_as_exact_prefix_with_only_additive_finance_pending() {
        let report = inspect_history(true, false, &history(18), MIGRATIONS);
        assert_eq!(report.status, MigrationAuditStatus::Pending);
        assert_eq!(report.matching_versions, (1..=18).collect::<Vec<_>>());
        assert_eq!(report.observed[16].name, "platform_identity_lifecycle");
        assert_eq!(
            report.observed[17].name,
            "durable_invite_acceptance_receipts"
        );
        assert_eq!(report.pending.len(), 1);
        assert_eq!(report.pending[0].version, 19);
        assert_eq!(report.pending[0].name, "financial_alpha_operations");
        assert!(report.require_compatible().is_ok());
        assert!(report.require_current().is_err());
    }

    #[test]
    fn missing_or_empty_history_is_uninitialized_not_verified() {
        for (current, legacy) in [(false, false), (true, false), (false, true)] {
            let report = inspect_history(current, legacy, &[], MIGRATIONS);
            assert_eq!(report.status, MigrationAuditStatus::Uninitialized);
            assert_eq!(report.pending.len(), MIGRATIONS.len());
            assert!(report.require_compatible().is_ok());
            assert!(report.require_current().is_err());
        }
    }

    #[test]
    fn legacy_history_is_inspected_without_adoption_and_two_histories_conflict() {
        let report = inspect_history(false, true, &history(16), MIGRATIONS);
        assert_eq!(
            report.history_relation.as_deref(),
            Some(LEGACY_MIGRATION_TABLE)
        );
        assert_eq!(report.status, MigrationAuditStatus::Pending);
        let complete = inspect_history(false, true, &history(MIGRATIONS.len()), MIGRATIONS);
        assert_eq!(complete.status, MigrationAuditStatus::Matching);
        assert!(complete.require_compatible().is_ok());
        assert!(complete
            .require_current()
            .unwrap_err()
            .to_string()
            .contains("adoption is needed"));
        let ambiguous = inspect_history(true, true, &[], MIGRATIONS);
        assert!(ambiguous.require_compatible().is_err());
        assert!(ambiguous.conflicts[0].contains("ambiguous"));
    }

    #[test]
    fn rejects_divergent_purchasing_seventeen_and_each_catalog_identity_drift() {
        for column in ["name", "phase", "change_set", "checksum"] {
            let mut applied = history(17);
            let row = &mut applied[16];
            match column {
                "name" => row.name = "purchasing_keyed_operations".into(),
                "phase" => row.phase = "verify".into(),
                "change_set" => row.change_set += 1,
                "checksum" => row.checksum = migration_checksum("changed SQL"),
                _ => unreachable!(),
            }
            let report = inspect_history(true, false, &applied, MIGRATIONS);
            assert!(
                report.require_compatible().is_err(),
                "accepted {column} drift"
            );
            assert!(report
                .conflicts
                .iter()
                .any(|reason| reason.contains("migration 17")));
            assert!(!report.matching_versions.contains(&17));
        }
    }

    #[test]
    fn rejects_holes_duplicates_and_unknown_future_additive_rows() {
        let mut hole = history(3);
        hole.remove(1);
        let mut duplicate = history(2);
        duplicate.push(duplicate[1].clone());
        for rows in [hole, duplicate] {
            let report = inspect_history(true, false, &rows, MIGRATIONS);
            assert!(report.require_compatible().is_err());
            assert!(report
                .conflicts
                .iter()
                .any(|reason| reason.contains("not contiguous")));
        }
        let mut future = history(MIGRATIONS.len());
        future.push(AppliedMigration {
            version: MIGRATIONS.len() as i64 + 1,
            name: "future_additive".into(),
            change_set: MIGRATIONS.last().unwrap().change_set + 1,
            phase: "expand".into(),
            checksum: migration_checksum("future SQL"),
        });
        assert!(
            first_pending_migration(&future, MIGRATIONS).is_ok(),
            "existing rollback semantics must remain unchanged"
        );
        let report = inspect_history(true, false, &future, MIGRATIONS);
        assert!(report.require_compatible().is_err());
        assert!(report
            .conflicts
            .iter()
            .any(|reason| reason.contains("unsupported migration version")));
    }
}

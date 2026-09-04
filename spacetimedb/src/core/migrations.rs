/// Deterministic schema / org migration ledger.
///
/// Global migrations are recorded in `SchemaMigration`.
/// Per-organization migrations are recorded in `OrgSchemaMigration`.
use std::collections::BTreeSet;

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::country_pack::seed_country_pack_catalog;
use crate::core::permissions::{sod_conflict_rule, SodConflictRule};
use crate::core::users::user_profile;
use crate::forms::migrations::run_seed_organization_form_configs;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::country_pack_hr::seed_hr_country_pack_leave_catalog;

pub const MIGRATION_COUNTRY_PACK_CATALOG: u64 = 1;
pub const MIGRATION_HR_COUNTRY_PACK_LEAVE_CATALOG: u64 = 4;
pub const MIGRATION_ORG_FORM_CONFIGS: u64 = 2;
pub const MIGRATION_ORG_FINANCE_SOD: u64 = 3;

fn seed_finance_sod_presets(ctx: &ReducerContext, organization_id: u64) {
    let presets = [
        (
            "account_move:create",
            "account_move:post",
            "Separate journal draft from posting",
        ),
        (
            "payment:create",
            "payment:post",
            "Separate payment create from posting",
        ),
        (
            "account_payment:create",
            "account_payment:post",
            "Separate ledger payment create from posting",
        ),
    ];

    for (permission_a, permission_b, description) in presets {
        let exists = ctx.db.sod_conflict_rule().iter().any(|r| {
            r.organization_id == organization_id
                && r.permission_a == permission_a
                && r.permission_b == permission_b
        });
        if exists {
            continue;
        }
        ctx.db.sod_conflict_rule().insert(SodConflictRule {
            id: 0,
            organization_id,
            permission_a: permission_a.to_string(),
            permission_b: permission_b.to_string(),
            description: Some(description.to_string()),
            is_active: true,
            created_at: ctx.timestamp,
            metadata: Some(r#"{"preset":"finance"}"#.to_string()),
        });
    }
}

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(accessor = schema_migration, public)]
pub struct SchemaMigration {
    #[primary_key]
    pub version: u64,
    pub name: String,
    pub applied_at: Timestamp,
    pub applied_by: Identity,
}

#[spacetimedb::table(
    accessor = org_schema_migration,
    public,
    index(accessor = org_migration_by_org, btree(columns = [organization_id]))
)]
pub struct OrgSchemaMigration {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub version: u64,
    pub name: String,
    pub applied_at: Timestamp,
    pub applied_by: Identity,
}

// ── Organization ownership backfill primitives ─────────────────────────────

/// A legacy row and the trusted organization candidates found for it.
///
/// This is intentionally a source-side primitive rather than a client-facing
/// reducer parameter. Callers must build candidates from validated parent or
/// root rows. A zero candidate, multiple candidates, or a conflicting stored
/// owner is quarantined instead of being assigned to an arbitrary tenant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrganizationOwnershipBackfillRow {
    pub table_name: String,
    pub record_id: u64,
    pub current_organization_id: Option<u64>,
    pub candidate_organization_ids: Vec<u64>,
}

/// The safe action a table-specific migration may take for one row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OrganizationOwnershipBackfillDecision {
    AlreadyOwned { organization_id: u64 },
    Backfill { organization_id: u64 },
    Quarantine { issue: String },
}

/// Stable identity for a quarantined source row across repeated runs.
pub fn organization_ownership_backfill_issue_key(
    scope: &str,
    table_name: &str,
    record_id: u64,
) -> String {
    format!("{scope}:{table_name}:{record_id}")
}

/// Resolve one row from authoritative organization candidates.
///
/// The caller owns the actual table update. Returning `Backfill` makes that
/// update explicit and keeps this helper unable to mutate ownership based on
/// untrusted input. Existing non-zero ownership is never silently changed.
pub fn classify_organization_ownership(
    row: &OrganizationOwnershipBackfillRow,
) -> OrganizationOwnershipBackfillDecision {
    if row
        .candidate_organization_ids
        .iter()
        .any(|organization_id| *organization_id == 0)
    {
        return OrganizationOwnershipBackfillDecision::Quarantine {
            issue: "sentinel organization candidate is not authoritative".to_string(),
        };
    }
    let candidates: BTreeSet<u64> = row
        .candidate_organization_ids
        .iter()
        .copied()
        .filter(|organization_id| *organization_id != 0)
        .collect();

    let Some(&organization_id) = candidates.iter().next() else {
        return OrganizationOwnershipBackfillDecision::Quarantine {
            issue: "no authoritative organization candidate (orphaned row)".to_string(),
        };
    };
    if candidates.len() != 1 {
        return OrganizationOwnershipBackfillDecision::Quarantine {
            issue: "multiple authoritative organization candidates (ambiguous row)".to_string(),
        };
    }

    match row.current_organization_id.filter(|value| *value != 0) {
        Some(current) if current == organization_id => {
            OrganizationOwnershipBackfillDecision::AlreadyOwned { organization_id }
        }
        Some(_) => OrganizationOwnershipBackfillDecision::Quarantine {
            issue: "stored organization conflicts with authoritative candidate".to_string(),
        },
        None => OrganizationOwnershipBackfillDecision::Backfill { organization_id },
    }
}

/// Fail closed unless a persisted run exists and both its issue count and
/// unresolved count are zero. Table-specific migrations supply those counts
/// from their existing evidence tables; this helper deliberately cannot mark
/// a migration complete or invent an ownership value.
pub fn verify_zero_unresolved_ownership(
    scope: &str,
    issue_count: usize,
    unresolved_rows: Option<u64>,
) -> Result<(), String> {
    if scope.trim().is_empty() {
        return Err("organization ownership validation scope must not be empty".to_string());
    }
    if issue_count != 0 {
        return Err(format!(
            "organization ownership validation failed for {scope}: {issue_count} quarantined row(s) remain"
        ));
    }
    let Some(unresolved_rows) = unresolved_rows else {
        return Err(format!(
            "organization ownership validation failed for {scope}: no backfill run"
        ));
    };
    if unresolved_rows != 0 {
        return Err(format!(
            "organization ownership validation failed for {scope}: latest run has {unresolved_rows} unresolved row(s)"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(current: Option<u64>, candidates: &[u64]) -> OrganizationOwnershipBackfillRow {
        OrganizationOwnershipBackfillRow {
            table_name: "pos_order_line".to_string(),
            record_id: 7,
            current_organization_id: current,
            candidate_organization_ids: candidates.to_vec(),
        }
    }

    #[test]
    fn issue_identity_is_stable_for_retries() {
        assert_eq!(
            organization_ownership_backfill_issue_key("c0", "pos_order_line", 7),
            organization_ownership_backfill_issue_key("c0", "pos_order_line", 7)
        );
        assert_ne!(
            organization_ownership_backfill_issue_key("c0", "pos_order_line", 7),
            organization_ownership_backfill_issue_key("c0", "pos_payment", 7)
        );
    }

    #[test]
    fn ambiguous_and_orphan_rows_are_quarantined() {
        assert!(matches!(
            classify_organization_ownership(&row(None, &[41, 42])),
            OrganizationOwnershipBackfillDecision::Quarantine { issue }
                if issue.contains("ambiguous")
        ));
        assert!(matches!(
            classify_organization_ownership(&row(None, &[])),
            OrganizationOwnershipBackfillDecision::Quarantine { issue }
                if issue.contains("orphaned")
        ));
        assert!(matches!(
            classify_organization_ownership(&row(None, &[41, 0])),
            OrganizationOwnershipBackfillDecision::Quarantine { issue }
                if issue.contains("sentinel")
        ));
    }

    #[test]
    fn only_unambiguous_missing_ownership_can_be_backfilled() {
        assert_eq!(
            classify_organization_ownership(&row(None, &[41, 41])),
            OrganizationOwnershipBackfillDecision::Backfill {
                organization_id: 41
            }
        );
        assert_eq!(
            classify_organization_ownership(&row(Some(41), &[41])),
            OrganizationOwnershipBackfillDecision::AlreadyOwned {
                organization_id: 41
            }
        );
        assert!(matches!(
            classify_organization_ownership(&row(Some(41), &[42])),
            OrganizationOwnershipBackfillDecision::Quarantine { issue }
                if issue.contains("conflicts")
        ));
    }

    #[test]
    fn completion_guard_requires_a_run_and_zero_unresolved_rows() {
        assert!(verify_zero_unresolved_ownership("c0", 0, Some(0)).is_ok());
        assert!(verify_zero_unresolved_ownership("c0", 1, Some(0)).is_err());
        assert!(verify_zero_unresolved_ownership("c0", 0, Some(1)).is_err());
        assert!(verify_zero_unresolved_ownership("c0", 0, None).is_err());
        assert!(verify_zero_unresolved_ownership("", 0, Some(0)).is_err());
    }
}

// ── Migration runners ────────────────────────────────────────────────────────

fn apply_global_migration(ctx: &ReducerContext, version: u64, name: &str) -> Result<(), String> {
    if ctx.db.schema_migration().version().find(&version).is_some() {
        return Ok(());
    }

    match version {
        MIGRATION_COUNTRY_PACK_CATALOG => seed_country_pack_catalog(ctx),
        MIGRATION_HR_COUNTRY_PACK_LEAVE_CATALOG => seed_hr_country_pack_leave_catalog(ctx),
        _ => return Err(format!("unknown global migration version {version}")),
    }

    ctx.db.schema_migration().insert(SchemaMigration {
        version,
        name: name.to_string(),
        applied_at: ctx.timestamp,
        applied_by: ctx.sender(),
    });

    Ok(())
}

fn apply_org_migration(
    ctx: &ReducerContext,
    organization_id: u64,
    version: u64,
    name: &str,
) -> Result<(), String> {
    let already = ctx
        .db
        .org_schema_migration()
        .org_migration_by_org()
        .filter(&organization_id)
        .any(|m| m.version == version);
    if already {
        return Ok(());
    }

    match version {
        MIGRATION_ORG_FORM_CONFIGS => run_seed_organization_form_configs(ctx, organization_id)?,
        MIGRATION_ORG_FINANCE_SOD => seed_finance_sod_presets(ctx, organization_id),
        _ => return Err(format!("unknown org migration version {version}")),
    }

    let row = ctx.db.org_schema_migration().insert(OrgSchemaMigration {
        id: 0,
        organization_id,
        version,
        name: name.to_string(),
        applied_at: ctx.timestamp,
        applied_by: ctx.sender(),
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "org_schema_migration",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(serde_json::json!({ "version": version, "name": name }).to_string()),
            changed_fields: vec!["version".to_string(), "name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Apply all pending global migrations (superuser or module init).
pub(crate) fn apply_pending_global_migrations(ctx: &ReducerContext) -> Result<(), String> {
    apply_global_migration(
        ctx,
        MIGRATION_COUNTRY_PACK_CATALOG,
        "seed_country_pack_catalog",
    )?;
    apply_global_migration(
        ctx,
        MIGRATION_HR_COUNTRY_PACK_LEAVE_CATALOG,
        "seed_hr_country_pack_leave_catalog",
    )?;
    Ok(())
}

/// Apply pending migrations for one organization.
#[spacetimedb::reducer]
pub fn apply_org_migrations(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    check_permission(ctx, organization_id, "organization", "write")?;
    apply_org_migration(
        ctx,
        organization_id,
        MIGRATION_ORG_FORM_CONFIGS,
        "seed_organization_form_configs",
    )?;
    apply_org_migration(
        ctx,
        organization_id,
        MIGRATION_ORG_FINANCE_SOD,
        "seed_finance_sod_presets",
    )
}

/// One-shot global migration runner (superuser).
#[spacetimedb::reducer]
pub fn apply_global_migrations(ctx: &ReducerContext) -> Result<(), String> {
    let user = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .ok_or("User not found")?;
    if !user.is_superuser {
        return Err("Only superusers may apply global migrations".to_string());
    }
    apply_pending_global_migrations(ctx)
}

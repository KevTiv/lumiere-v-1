/// Deterministic platform-migration bindings and organization migrations.
///
/// `SchemaMigration` is an organization-owned application binding to the
/// canonical platform migration history in API-server PostgreSQL
/// (`lumiere_platform.schema_migration`). It is not the global migration
/// ledger. `OrgSchemaMigration` remains the separate protocol relation for
/// organization-local application migrations.
use std::collections::BTreeSet;

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::core::auth::{password_reset_token, user_credential};
use crate::core::cold_tier_identity::cold_tier_service_identity;
use crate::core::country_pack::{country_pack_definition, country_pack_tax_rule};
use crate::core::organization::organization;
use crate::core::permissions::{sod_conflict_rule, SodConflictRule};
use crate::core::reference::country;
use crate::core::users::{
    find_user_profile_for_identity, find_user_profile_for_organization, user_organization,
    user_profile,
};
use crate::crm::contact_identities::contact_identity_verification_authority;
use crate::forms::migrations::run_seed_organization_form_configs;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::hr::country_pack_hr::hr_country_pack_leave_default;

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

#[spacetimedb::table(
    accessor = schema_migration,
    public,
    index(accessor = schema_migration_by_organization, btree(columns = [organization_id])),
    index(
        accessor = schema_migration_by_organization_and_platform_id,
        btree(columns = [organization_id, platform_migration_id])
    )
)]
pub struct SchemaMigration {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// Organization whose application state is being bound.
    pub organization_id: u64,
    /// Opaque reference to `lumiere_platform.schema_migration`.
    pub platform_migration_id: String,
    /// Organization-qualified uniqueness key, derived by the server.
    #[unique]
    pub organization_platform_migration_key: String,
    /// Descriptive copy of the canonical platform version.
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

/// Durable evidence for a C0 organization-ownership backfill row that could
/// not be resolved without guessing.  `source_key` is the stable source
/// primary key (including string primary keys), so retrying a run updates the
/// same quarantine row instead of creating duplicate evidence.
#[spacetimedb::table(
    accessor = c0_ownership_backfill_issue,
    index(accessor = c0_ownership_issue_by_table, btree(columns = [table_name]))
)]
pub struct C0OwnershipBackfillIssue {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub source_key: String,
    pub table_name: String,
    pub record_key: String,
    pub organization_id: Option<u64>,
    pub issue: String,
    pub detected_at: Timestamp,
}

/// Durable summary for one complete C0 ownership scan.  A run is append-only
/// evidence; the row-level issue table above is the idempotent retry surface.
#[spacetimedb::table(
    accessor = c0_ownership_backfill_run,
    index(accessor = c0_ownership_run_by_scope, btree(columns = [scope]))
)]
pub struct C0OwnershipBackfillRun {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub scope: String,
    pub scanned_rows: u64,
    pub backfilled_rows: u64,
    pub unresolved_rows: u64,
    pub completed_at: Timestamp,
    pub completed_by: Identity,
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
        assert_eq!(
            c0_source_key("country_pack_definition", "org-41:au"),
            c0_source_key("country_pack_definition", "org-41:au")
        );
        assert_ne!(
            c0_source_key("country_pack_definition", "org-41:au"),
            c0_source_key("country_pack_definition", "org-42:au")
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

    #[test]
    fn platform_migration_binding_requires_an_opaque_reference() {
        assert!(validate_platform_migration_id("platform:2026-09-04:catalog").is_ok());
        assert!(validate_platform_migration_id("").is_err());
        assert!(validate_platform_migration_id("   ").is_err());
        assert!(validate_platform_migration_organization_id(41).is_ok());
        assert!(validate_platform_migration_organization_id(0).is_err());
    }
}

// ── Migration runners ────────────────────────────────────────────────────────

fn validate_platform_migration_binding(
    ctx: &ReducerContext,
    organization_id: u64,
    platform_migration_id: &str,
) -> Result<(), String> {
    validate_platform_migration_organization_id(organization_id)?;
    if ctx.db.organization().id().find(&organization_id).is_none() {
        return Err("platform migration binding organization does not exist".to_string());
    }
    validate_platform_migration_id(platform_migration_id)
}

fn validate_platform_migration_organization_id(organization_id: u64) -> Result<(), String> {
    if organization_id == 0 {
        return Err("platform migration binding requires a non-zero organization_id".to_string());
    }
    Ok(())
}

fn validate_platform_migration_id(platform_migration_id: &str) -> Result<(), String> {
    if platform_migration_id.trim().is_empty() {
        return Err(
            "platform migration binding requires an opaque platform migration id".to_string(),
        );
    }
    Ok(())
}

const C0_OWNERSHIP_BACKFILL_SCOPE: &str = "c0_platform_bindings_and_references";

fn c0_source_key(table_name: &str, record_key: &str) -> String {
    format!("c0:{table_name}:{record_key}")
}

fn c0_clear_issue(ctx: &ReducerContext, table_name: &str, record_key: &str) {
    let source_key = c0_source_key(table_name, record_key);
    if let Some(issue) = ctx
        .db
        .c0_ownership_backfill_issue()
        .source_key()
        .find(&source_key)
    {
        ctx.db.c0_ownership_backfill_issue().id().delete(&issue.id);
    }
}

fn c0_record_issue(
    ctx: &ReducerContext,
    table_name: &str,
    record_key: &str,
    organization_id: Option<u64>,
    issue: &str,
) {
    let source_key = c0_source_key(table_name, record_key);
    let row = C0OwnershipBackfillIssue {
        id: 0,
        source_key: source_key.clone(),
        table_name: table_name.to_string(),
        record_key: record_key.to_string(),
        organization_id,
        issue: issue.to_string(),
        detected_at: ctx.timestamp,
    };
    if let Some(existing) = ctx
        .db
        .c0_ownership_backfill_issue()
        .source_key()
        .find(&source_key)
    {
        ctx.db
            .c0_ownership_backfill_issue()
            .id()
            .update(C0OwnershipBackfillIssue {
                id: existing.id,
                ..row
            });
    } else {
        ctx.db.c0_ownership_backfill_issue().insert(row);
    }
}

fn c0_direct_ownership_decision(
    ctx: &ReducerContext,
    table_name: &str,
    record_key: &str,
    organization_id: u64,
) -> OrganizationOwnershipBackfillDecision {
    if organization_id == 0 {
        return OrganizationOwnershipBackfillDecision::Quarantine {
            issue: "no authoritative organization candidate (orphaned row)".to_string(),
        };
    }
    if ctx.db.organization().id().find(&organization_id).is_none() {
        return OrganizationOwnershipBackfillDecision::Quarantine {
            issue: "stored organization does not exist".to_string(),
        };
    }
    classify_organization_ownership(&OrganizationOwnershipBackfillRow {
        table_name: table_name.to_string(),
        record_id: record_key.parse().unwrap_or(0),
        current_organization_id: Some(organization_id),
        candidate_organization_ids: vec![organization_id],
    })
}

fn c0_membership_ownership_decision(
    ctx: &ReducerContext,
    table_name: &str,
    record_key: &str,
    identity: Identity,
    current_organization_id: u64,
) -> OrganizationOwnershipBackfillDecision {
    if current_organization_id != 0 {
        let owns_profile = ctx
            .db
            .organization()
            .id()
            .find(&current_organization_id)
            .is_some()
            && ctx
                .db
                .user_organization()
                .user_org_by_user()
                .filter(&identity)
                .any(|membership| {
                    membership.organization_id == current_organization_id && membership.is_active
                });
        return if owns_profile {
            OrganizationOwnershipBackfillDecision::AlreadyOwned {
                organization_id: current_organization_id,
            }
        } else {
            OrganizationOwnershipBackfillDecision::Quarantine {
                issue: "stored organization has no matching active membership".to_string(),
            }
        };
    }

    let candidate_organization_ids = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&identity)
        .filter(|membership| membership.is_active)
        .map(|membership| membership.organization_id)
        .collect();
    classify_organization_ownership(&OrganizationOwnershipBackfillRow {
        table_name: table_name.to_string(),
        record_id: record_key.parse().unwrap_or(0),
        current_organization_id: None,
        candidate_organization_ids,
    })
}

fn c0_record_decision(
    ctx: &ReducerContext,
    table_name: &str,
    record_key: &str,
    current_organization_id: Option<u64>,
    decision: OrganizationOwnershipBackfillDecision,
) -> (u64, u64) {
    match decision {
        OrganizationOwnershipBackfillDecision::AlreadyOwned { .. } => {
            c0_clear_issue(ctx, table_name, record_key);
            (0, 0)
        }
        OrganizationOwnershipBackfillDecision::Backfill { organization_id } => {
            c0_clear_issue(ctx, table_name, record_key);
            debug_assert!(current_organization_id.is_none() || current_organization_id == Some(0));
            let _ = organization_id;
            (1, 0)
        }
        OrganizationOwnershipBackfillDecision::Quarantine { issue } => {
            c0_record_issue(ctx, table_name, record_key, current_organization_id, &issue);
            (0, 1)
        }
    }
}

fn c0_record_direct_row(
    ctx: &ReducerContext,
    table_name: &str,
    record_key: &str,
    organization_id: u64,
) -> (u64, u64) {
    let decision = c0_direct_ownership_decision(ctx, table_name, record_key, organization_id);
    c0_record_decision(ctx, table_name, record_key, Some(organization_id), decision)
}

fn require_c0_backfill_superuser(ctx: &ReducerContext) -> Result<(), String> {
    let user = find_user_profile_for_identity(ctx, ctx.sender()).ok_or("user not found")?;
    if !user.is_active || !user.is_superuser {
        return Err("only active superusers may manage C0 ownership backfills".to_string());
    }
    Ok(())
}

/// Scan the formerly-global platform bindings and seeded reference copies.
/// Missing ownership is only repaired for a credential/profile whose active
/// membership identifies exactly one organization; every other ambiguity is
/// persisted in the idempotent quarantine table.
#[spacetimedb::reducer]
pub fn run_c0_organization_ownership_backfill(ctx: &ReducerContext) -> Result<(), String> {
    require_c0_backfill_superuser(ctx)?;
    let mut scanned_rows = 0_u64;
    let mut backfilled_rows = 0_u64;
    let mut unresolved_rows = 0_u64;

    macro_rules! record_direct_rows {
        ($accessor:ident, $table:literal, $key:expr, $organization:expr) => {{
            let rows: Vec<_> = ctx.db.$accessor().iter().collect();
            for row in rows {
                scanned_rows += 1;
                let key = $key(&row);
                let (backfilled, unresolved) =
                    c0_record_direct_row(ctx, $table, &key, $organization(&row));
                backfilled_rows += backfilled;
                unresolved_rows += unresolved;
            }
        }};
    }

    record_direct_rows!(
        cold_tier_service_identity,
        "cold_tier_service_identity",
        |row: &_| row.platform_id.clone(),
        |row: &_| row.organization_id
    );
    record_direct_rows!(
        password_reset_token,
        "password_reset_token",
        |row: &_| row.id.to_string(),
        |row: &_| row.organization_id
    );
    record_direct_rows!(
        schema_migration,
        "schema_migration",
        |row: &_| row.id.to_string(),
        |row: &_| row.organization_id
    );
    record_direct_rows!(
        contact_identity_verification_authority,
        "contact_identity_verification_authority",
        |row: &_| row.id.to_string(),
        |row: &_| row.organization_id
    );
    record_direct_rows!(
        country,
        "country",
        |row: &_| row.organization_code_key.clone(),
        |row: &_| row.organization_id
    );
    record_direct_rows!(
        country_pack_definition,
        "country_pack_definition",
        |row: &_| row.organization_pack_key.clone(),
        |row: &_| row.organization_id
    );
    record_direct_rows!(
        country_pack_tax_rule,
        "country_pack_tax_rule",
        |row: &_| row.id.to_string(),
        |row: &_| row.organization_id
    );
    record_direct_rows!(
        currency,
        "currency",
        |row: &_| row.id.to_string(),
        |row: &_| row.organization_id
    );
    record_direct_rows!(
        hr_country_pack_leave_default,
        "hr_country_pack_leave_default",
        |row: &_| row.id.to_string(),
        |row: &_| row.organization_id
    );

    let credentials: Vec<_> = ctx.db.user_credential().iter().collect();
    for row in credentials {
        scanned_rows += 1;
        let record_key = row.id.to_string();
        let decision = c0_membership_ownership_decision(
            ctx,
            "user_credential",
            &record_key,
            row.identity,
            row.organization_id,
        );
        match decision {
            OrganizationOwnershipBackfillDecision::Backfill { organization_id } => {
                ctx.db
                    .user_credential()
                    .id()
                    .update(crate::core::auth::UserCredential {
                        organization_id,
                        ..row
                    });
                c0_clear_issue(ctx, "user_credential", &record_key);
                backfilled_rows += 1;
            }
            decision => {
                let (backfilled, unresolved) = c0_record_decision(
                    ctx,
                    "user_credential",
                    &record_key,
                    Some(row.organization_id),
                    decision,
                );
                backfilled_rows += backfilled;
                unresolved_rows += unresolved;
            }
        }
    }

    let profiles: Vec<_> = ctx.db.user_profile().iter().collect();
    for row in profiles {
        scanned_rows += 1;
        let record_key = row.id.to_string();
        let decision = c0_membership_ownership_decision(
            ctx,
            "user_profile",
            &record_key,
            row.identity,
            row.organization_id,
        );
        match decision {
            OrganizationOwnershipBackfillDecision::Backfill { organization_id } => {
                ctx.db
                    .user_profile()
                    .id()
                    .update(crate::core::users::UserProfile {
                        organization_id,
                        ..row
                    });
                c0_clear_issue(ctx, "user_profile", &record_key);
                backfilled_rows += 1;
            }
            decision => {
                let (backfilled, unresolved) = c0_record_decision(
                    ctx,
                    "user_profile",
                    &record_key,
                    Some(row.organization_id),
                    decision,
                );
                backfilled_rows += backfilled;
                unresolved_rows += unresolved;
            }
        }
    }

    ctx.db
        .c0_ownership_backfill_run()
        .insert(C0OwnershipBackfillRun {
            id: 0,
            scope: C0_OWNERSHIP_BACKFILL_SCOPE.to_string(),
            scanned_rows,
            backfilled_rows,
            unresolved_rows,
            completed_at: ctx.timestamp,
            completed_by: ctx.sender(),
        });
    Ok(())
}

/// Validate the latest persisted C0 scan.  Quarantined rows remain visible so
/// operators can repair their authoritative source and rerun the scan.
#[spacetimedb::reducer]
pub fn validate_c0_organization_ownership_backfill(ctx: &ReducerContext) -> Result<(), String> {
    require_c0_backfill_superuser(ctx)?;
    let issue_count = ctx.db.c0_ownership_backfill_issue().iter().count();
    let latest_run = ctx
        .db
        .c0_ownership_backfill_run()
        .iter()
        .filter(|run| run.scope == C0_OWNERSHIP_BACKFILL_SCOPE)
        .max_by_key(|run| run.id)
        .map(|run| run.unresolved_rows);
    verify_zero_unresolved_ownership(C0_OWNERSHIP_BACKFILL_SCOPE, issue_count, latest_run)
}

fn organization_platform_migration_key(
    organization_id: u64,
    platform_migration_id: &str,
) -> String {
    format!("{organization_id}:{platform_migration_id}")
}

fn record_platform_migration_binding_for_organization(
    ctx: &ReducerContext,
    organization_id: u64,
    platform_migration_id: &str,
    version: u64,
    name: &str,
) -> Result<(), String> {
    validate_platform_migration_binding(ctx, organization_id, platform_migration_id)?;
    let binding_key = organization_platform_migration_key(organization_id, platform_migration_id);

    if ctx
        .db
        .schema_migration()
        .organization_platform_migration_key()
        .find(&binding_key)
        .is_some()
    {
        return Ok(());
    }

    ctx.db.schema_migration().insert(SchemaMigration {
        id: 0,
        organization_id,
        platform_migration_id: platform_migration_id.to_string(),
        organization_platform_migration_key: binding_key,
        version,
        name: name.to_string(),
        applied_at: ctx.timestamp,
        applied_by: ctx.sender(),
    });

    Ok(())
}

/// Record a platform migration application supplied by the trusted
/// API-server PostgreSQL synchronization path.
#[spacetimedb::reducer]
pub fn record_platform_migration_binding(
    ctx: &ReducerContext,
    organization_id: u64,
    platform_migration_id: String,
    version: u64,
    name: String,
) -> Result<(), String> {
    let user = find_user_profile_for_organization(ctx, ctx.sender(), organization_id)
        .ok_or("User not found")?;
    if !user.is_superuser {
        return Err("Only superusers may record platform migration bindings".to_string());
    }
    record_platform_migration_binding_for_organization(
        ctx,
        organization_id,
        &platform_migration_id,
        version,
        &name,
    )
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
    let organization_ids: Vec<u64> = ctx
        .db
        .organization()
        .iter()
        .map(|organization| organization.id)
        .filter(|organization_id| *organization_id != 0)
        .collect();
    for organization_id in organization_ids {
        seed_pending_global_migrations_for_organization(ctx, organization_id);
    }
    Ok(())
}

/// Seed legacy organization-owned catalog rows for one existing organization.
///
/// This intentionally does not write `SchemaMigration`: canonical platform
/// migration truth is synchronized from API-server PostgreSQL through
/// `record_platform_migration_binding`.
fn seed_pending_global_migrations_for_organization(ctx: &ReducerContext, organization_id: u64) {
    crate::core::country_pack::seed_country_pack_catalog_for_organization(ctx, organization_id);
    crate::hr::country_pack_hr::seed_hr_country_pack_leave_catalog_for_organization(
        ctx,
        organization_id,
    );
}

/// Apply pending migrations for one organization.
#[spacetimedb::reducer]
pub fn apply_org_migrations(ctx: &ReducerContext, organization_id: u64) -> Result<(), String> {
    if organization_id == 0 {
        return Err("organization migrations require a non-zero organization_id".to_string());
    }
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
    let user = find_user_profile_for_identity(ctx, ctx.sender()).ok_or("User not found")?;
    if !user.is_superuser {
        return Err("Only superusers may apply global migrations".to_string());
    }
    apply_pending_global_migrations(ctx)
}

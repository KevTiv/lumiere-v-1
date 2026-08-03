/// Deterministic schema / org migration ledger.
///
/// Global migrations are recorded in `SchemaMigration`.
/// Per-organization migrations are recorded in `OrgSchemaMigration`.
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

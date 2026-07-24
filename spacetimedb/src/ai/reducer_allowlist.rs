//! Per-organization AI reducer allowlist — configurable guardrails for action drafts.

use spacetimedb::{reducer, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ───────────────────────────────────────────────────────────────────

/// Org-scoped allowlist entry controlling which reducers may appear in AI action drafts.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_reducer_allowlist,
    public,
    index(accessor = ai_reducer_allowlist_by_org, btree(columns = [organization_id]))
)]
pub struct AiReducerAllowlist {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub reducer_name: String,
    /// Casbin resource checked when creating drafts (e.g. `project_task`, `sale_order`).
    pub permission_resource: String,
    /// Casbin action checked when creating drafts (typically `create`).
    pub permission_action: String,
    pub enabled: bool,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateAiReducerAllowlistParams {
    pub reducer_name: String,
    pub permission_resource: String,
    pub permission_action: String,
    pub enabled: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateAiReducerAllowlistParams {
    pub reducer_name: Option<String>,
    pub permission_resource: Option<String>,
    pub permission_action: Option<String>,
    pub enabled: Option<bool>,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

#[reducer]
pub fn create_ai_reducer_allowlist(
    ctx: &ReducerContext,
    organization_id: u64,
    params: CreateAiReducerAllowlistParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_action_draft", "write")?;

    let reducer_name = params.reducer_name.trim().to_string();
    if reducer_name.is_empty() {
        return Err("reducer_name is required".to_string());
    }
    let permission_resource = params.permission_resource.trim().to_string();
    if permission_resource.is_empty() {
        return Err("permission_resource is required".to_string());
    }
    let permission_action = params.permission_action.trim().to_string();
    if permission_action.is_empty() {
        return Err("permission_action is required".to_string());
    }

    let duplicate = ctx
        .db
        .ai_reducer_allowlist()
        .ai_reducer_allowlist_by_org()
        .filter(&organization_id)
        .any(|entry| entry.reducer_name == reducer_name);
    if duplicate {
        return Err(format!(
            "allowlist entry for reducer '{reducer_name}' already exists"
        ));
    }

    let row = ctx.db.ai_reducer_allowlist().insert(AiReducerAllowlist {
        id: 0,
        organization_id,
        reducer_name: reducer_name.clone(),
        permission_resource: permission_resource.clone(),
        permission_action: permission_action.clone(),
        enabled: params.enabled,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_reducer_allowlist",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "reducer_name": reducer_name,
                    "permission_resource": permission_resource,
                    "permission_action": permission_action,
                    "enabled": params.enabled,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "reducer_name".to_string(),
                "permission_resource".to_string(),
                "permission_action".to_string(),
                "enabled".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_ai_reducer_allowlist(
    ctx: &ReducerContext,
    organization_id: u64,
    allowlist_id: u64,
    params: UpdateAiReducerAllowlistParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_action_draft", "write")?;

    let row = ctx
        .db
        .ai_reducer_allowlist()
        .id()
        .find(&allowlist_id)
        .ok_or("Allowlist entry not found")?;
    if row.organization_id != organization_id {
        return Err("Allowlist entry does not belong to this organization".to_string());
    }

    let reducer_name = params
        .reducer_name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or(row.reducer_name.clone());
    let permission_resource = params
        .permission_resource
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(row.permission_resource.clone());
    let permission_action = params
        .permission_action
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or(row.permission_action.clone());
    let enabled = params.enabled.unwrap_or(row.enabled);

    if reducer_name != row.reducer_name {
        let duplicate = ctx
            .db
            .ai_reducer_allowlist()
            .ai_reducer_allowlist_by_org()
            .filter(&organization_id)
            .any(|entry| entry.id != allowlist_id && entry.reducer_name == reducer_name);
        if duplicate {
            return Err(format!(
                "allowlist entry for reducer '{reducer_name}' already exists"
            ));
        }
    }

    let updated = AiReducerAllowlist {
        reducer_name: reducer_name.clone(),
        permission_resource: permission_resource.clone(),
        permission_action: permission_action.clone(),
        enabled,
        write_date: ctx.timestamp,
        metadata: params.metadata.or(row.metadata),
        ..row
    };
    ctx.db.ai_reducer_allowlist().id().update(updated);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_reducer_allowlist",
            record_id: allowlist_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "reducer_name": reducer_name,
                    "permission_resource": permission_resource,
                    "permission_action": permission_action,
                    "enabled": enabled,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "reducer_name".to_string(),
                "permission_resource".to_string(),
                "permission_action".to_string(),
                "enabled".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_ai_reducer_allowlist(
    ctx: &ReducerContext,
    organization_id: u64,
    allowlist_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_action_draft", "write")?;

    let row = ctx
        .db
        .ai_reducer_allowlist()
        .id()
        .find(&allowlist_id)
        .ok_or("Allowlist entry not found")?;
    if row.organization_id != organization_id {
        return Err("Allowlist entry does not belong to this organization".to_string());
    }

    ctx.db.ai_reducer_allowlist().id().delete(&allowlist_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_reducer_allowlist",
            record_id: allowlist_id,
            action: "DELETE",
            old_values: Some(
                serde_json::json!({
                    "reducer_name": row.reducer_name,
                    "permission_resource": row.permission_resource,
                    "permission_action": row.permission_action,
                    "enabled": row.enabled,
                })
                .to_string(),
            ),
            new_values: None,
            changed_fields: vec!["reducer_name".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn set_ai_reducer_allowlist_enabled(
    ctx: &ReducerContext,
    organization_id: u64,
    allowlist_id: u64,
    enabled: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "ai_action_draft", "write")?;

    let row = ctx
        .db
        .ai_reducer_allowlist()
        .id()
        .find(&allowlist_id)
        .ok_or("Allowlist entry not found")?;
    if row.organization_id != organization_id {
        return Err("Allowlist entry does not belong to this organization".to_string());
    }

    ctx.db.ai_reducer_allowlist().id().update(AiReducerAllowlist {
        enabled,
        write_date: ctx.timestamp,
        ..row.clone()
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_reducer_allowlist",
            record_id: allowlist_id,
            action: "SET_ACTIVE",
            old_values: Some(serde_json::json!({ "enabled": row.enabled }).to_string()),
            new_values: Some(serde_json::json!({ "enabled": enabled }).to_string()),
            changed_fields: vec!["enabled".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Suggested Casbin permission pairs when seeding an org allowlist (not used as an
/// empty-allowlist fallback — empty lists fail closed).
pub fn default_reducer_permission(reducer_name: &str) -> Option<(&'static str, &'static str)> {
    match reducer_name {
        "create_task" => Some(("project_task", "create")),
        "create_sale_order" => Some(("sale_order", "create")),
        "create_purchase_order" => Some(("purchase_order", "create")),
        _ => None,
    }
}

/// Whether `reducer_name` may be used in a new AI action draft for this organization.
pub fn is_allowed_ai_reducer(
    ctx: &ReducerContext,
    organization_id: u64,
    reducer_name: &str,
) -> Result<(), String> {
    let allowlist_rows: Vec<AiReducerAllowlist> = ctx
        .db
        .ai_reducer_allowlist()
        .ai_reducer_allowlist_by_org()
        .filter(&organization_id)
        .collect();

    // Fail closed: no org rows means no AI draft reducers are permitted.
    if allowlist_rows.is_empty() {
        return Err(format!(
            "reducer '{reducer_name}' is not allowed for AI drafts (empty allowlist)"
        ));
    }

    let entry = allowlist_rows
        .iter()
        .find(|row| row.reducer_name == reducer_name && row.enabled);

    match entry {
        Some(row) => {
            check_permission(
                ctx,
                organization_id,
                &row.permission_resource,
                &row.permission_action,
            )?;
            Ok(())
        }
        None => Err(format!(
            "reducer '{reducer_name}' is not allowed for AI drafts"
        )),
    }
}

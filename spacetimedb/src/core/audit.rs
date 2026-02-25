/// Audit Logging
///
/// Tables:  AuditLog · AuditRule
/// Pattern: AuditLog rows are append-only (no update/delete reducers).
///          AuditRule configures which tables/events should be tracked.
///          Use `helpers::write_audit_log` from other modules rather than
///          calling `log_audit_event` directly.
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::helpers::check_permission;

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = audit_log,
    public,
    index(name = "audit_by_org",   btree(columns = [organization_id])),
    index(name = "audit_by_table", btree(columns = [table_name]))
)]
pub struct AuditLog {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub table_name: String,
    pub record_id: u64,
    /// One of: CREATE · UPDATE · DELETE · LOGIN · LOGOUT
    pub action: String,
    pub old_values: Option<String>, // JSON
    pub new_values: Option<String>, // JSON
    pub changed_fields: Vec<String>,
    pub user_identity: Identity,
    pub session_id: Option<u64>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub timestamp: Timestamp,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = audit_rule,
    public,
    index(name = "audit_rule_by_org", btree(columns = [organization_id]))
)]
pub struct AuditRule {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub table_name: String,
    pub log_reads: bool,
    pub log_writes: bool,
    pub log_deletes: bool,
    pub log_logins: bool,
    pub is_active: bool,
    pub metadata: Option<String>,
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Insert a raw audit entry. Prefer `helpers::write_audit_log` for internal use.
#[spacetimedb::reducer]
pub fn log_audit_event(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    table_name: String,
    record_id: u64,
    action: String,
    old_values: Option<String>,
    new_values: Option<String>,
    changed_fields: Vec<String>,
    session_id: Option<u64>,
    ip_address: Option<String>,
    user_agent: Option<String>,
) -> Result<(), String> {
    // Either a member of the org or a superuser may log events
    let is_member = ctx
        .db
        .user_organization()
        .iter()
        .any(|uo| {
            uo.user_identity == ctx.sender()
                && uo.organization_id == organization_id
                && uo.is_active
        });

    let is_su = ctx
        .db
        .user_profile()
        .identity()
        .find(ctx.sender())
        .map(|u| u.is_superuser)
        .unwrap_or(false);

    if !is_member && !is_su {
        return Err("Not authorized to log events for this organization".to_string());
    }

    ctx.db.audit_log().insert(AuditLog {
        id: 0,
        organization_id,
        company_id,
        table_name,
        record_id,
        action,
        old_values,
        new_values,
        changed_fields,
        user_identity: ctx.sender(),
        session_id,
        ip_address,
        user_agent,
        timestamp: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_audit_rule(
    ctx: &ReducerContext,
    organization_id: u64,
    table_name: String,
    log_reads: bool,
    log_writes: bool,
    log_deletes: bool,
    log_logins: bool,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "audit_rule", "create")?;

    ctx.db.audit_rule().insert(AuditRule {
        id: 0,
        organization_id,
        table_name,
        log_reads,
        log_writes,
        log_deletes,
        log_logins,
        is_active: true,
        metadata: None,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_audit_rule(
    ctx: &ReducerContext,
    rule_id: u64,
    log_reads: Option<bool>,
    log_writes: Option<bool>,
    log_deletes: Option<bool>,
    log_logins: Option<bool>,
    is_active: Option<bool>,
) -> Result<(), String> {
    let rule = ctx
        .db
        .audit_rule()
        .id()
        .find(&rule_id)
        .ok_or("Audit rule not found")?;

    check_permission(ctx, rule.organization_id, "audit_rule", "write")?;

    ctx.db.audit_rule().id().update(AuditRule {
        log_reads: log_reads.unwrap_or(rule.log_reads),
        log_writes: log_writes.unwrap_or(rule.log_writes),
        log_deletes: log_deletes.unwrap_or(rule.log_deletes),
        log_logins: log_logins.unwrap_or(rule.log_logins),
        is_active: is_active.unwrap_or(rule.is_active),
        ..rule
    });

    Ok(())
}

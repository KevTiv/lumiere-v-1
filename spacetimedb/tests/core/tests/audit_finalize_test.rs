//! Fail-closed coverage for the retired audit-log cooling operation.

use spacetimedb::{ReducerContext, Table};

use crate::core::audit::{audit_log, finalize_audit_log_archive, AuditLog};

#[spacetimedb::reducer]
pub fn test_audit_finalize_is_disabled(ctx: &ReducerContext) -> Result<(), String> {
    let row = ctx.db.audit_log().insert(AuditLog {
        id: 0,
        organization_id: 1,
        company_id: None,
        table_name: "retired_audit_finalize".to_string(),
        record_id: 42,
        action: "CREATE".to_string(),
        old_values: None,
        new_values: Some(r#"{"a":1}"#.to_string()),
        changed_fields: vec!["a".to_string()],
        user_identity: ctx.sender(),
        session_id: None,
        ip_address: None,
        user_agent: None,
        timestamp: ctx.timestamp,
        metadata: None,
    });

    let error = finalize_audit_log_archive(ctx, row.id, "unused".to_string())
        .expect_err("retired audit finalization must fail closed");
    if !error.contains("audit_log cooling is disabled") {
        return Err(format!("unexpected retired-finalizer error: {error}"));
    }
    if ctx.db.audit_log().id().find(row.id).is_none() {
        return Err("retired audit finalizer deleted a hot audit row".to_string());
    }
    Ok(())
}

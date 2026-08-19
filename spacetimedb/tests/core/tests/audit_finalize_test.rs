//! `finalize_audit_log_archive` coverage (cold-tier Phase 1 write path).
//!
//! These exercise the STDB side of the audit-log cold-tier drain protocol —
//! checksum match/mismatch/idempotency — in isolation from the api-server
//! drainer, which needs a live PG + STDB pair to test end-to-end (see the
//! "Tests" checklist in docs/plans/audit-log-cold-by-default.md §9).
use spacetimedb::{ReducerContext, Table};

use crate::core::audit::{
    audit_log, audit_log_canonical_checksum, finalize_audit_log_archive, AuditLog,
};

fn insert_test_row(ctx: &ReducerContext, table_name: &str) -> AuditLog {
    ctx.db.audit_log().insert(AuditLog {
        id: 0,
        organization_id: 1,
        company_id: None,
        table_name: table_name.to_string(),
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
    })
}

#[spacetimedb::reducer]
pub fn test_finalize_deletes_on_checksum_match(ctx: &ReducerContext) -> Result<(), String> {
    let row = insert_test_row(ctx, "finalize_match");
    let checksum = audit_log_canonical_checksum(&row);

    finalize_audit_log_archive(ctx, row.id, checksum)?;

    if ctx.db.audit_log().id().find(row.id).is_some() {
        return Err("row should have been deleted on checksum match".to_string());
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn test_finalize_refuses_on_checksum_mismatch(ctx: &ReducerContext) -> Result<(), String> {
    let row = insert_test_row(ctx, "finalize_mismatch");

    let result = finalize_audit_log_archive(ctx, row.id, "deadbeef".to_string());
    if result.is_ok() {
        return Err("finalize should reject a wrong checksum".to_string());
    }

    if ctx.db.audit_log().id().find(row.id).is_none() {
        return Err("row should NOT have been deleted on checksum mismatch".to_string());
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn test_finalize_is_idempotent_when_already_gone(ctx: &ReducerContext) -> Result<(), String> {
    let row = insert_test_row(ctx, "finalize_idempotent");
    let checksum = audit_log_canonical_checksum(&row);

    finalize_audit_log_archive(ctx, row.id, checksum.clone())?;
    // Second call for the same (now-deleted) id must succeed, not error — this
    // is what makes a racing/duplicate drainer safe (docs/plans/audit-log-cold-
    // by-default.md §5 "Multiple workers").
    finalize_audit_log_archive(ctx, row.id, checksum)?;

    Ok(())
}

#[spacetimedb::reducer]
pub fn test_finalize_rejects_checksum_from_a_different_row(
    ctx: &ReducerContext,
) -> Result<(), String> {
    let row_a = insert_test_row(ctx, "finalize_field_sensitivity_a");
    let row_b = insert_test_row(ctx, "finalize_field_sensitivity_b");
    let checksum_b = audit_log_canonical_checksum(&row_b);

    // Try to finalize row_a using row_b's checksum — must be rejected, proving
    // the checksum is sensitive to the row's own content, not just its id.
    let result = finalize_audit_log_archive(ctx, row_a.id, checksum_b);
    if result.is_ok() {
        return Err("finalize should reject a checksum computed from a different row".to_string());
    }
    if ctx.db.audit_log().id().find(row_a.id).is_none() {
        return Err("row_a should still be present after a rejected finalize".to_string());
    }
    Ok(())
}

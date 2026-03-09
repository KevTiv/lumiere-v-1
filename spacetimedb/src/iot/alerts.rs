/// IoT Alerts — threshold violations and anomalies.
///
/// Alerts are created automatically by `record_telemetry` when sensor readings
/// breach configured thresholds, or manually by other reducers detecting anomalies.
use spacetimedb::{reducer, table, ReducerContext, Table, Timestamp};
use spacetimedb::Identity;

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::iot::registry::iot_device;

// ── Tables ────────────────────────────────────────────────────────────────────

#[table(
    accessor = iot_alert,
    public,
    index(accessor = iot_alert_by_device, btree(columns = [device_id])),
    index(accessor = iot_alert_by_org, btree(columns = [organization_id])),
    index(accessor = iot_alert_unresolved, btree(columns = [organization_id, resolved_at]))
)]
pub struct IoTAlert {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub device_id: u64,
    pub organization_id: u64,
    pub alert_type: String,
    pub severity: String, // IoTAlertSeverity: "Info" | "Warning" | "Critical"
    pub message: String,
    pub triggered_at: Timestamp,
    pub resolved_at: Option<Timestamp>,
    pub resolved_by: Option<Identity>,
    pub metadata: Option<String>,
}

// ── Internal helper (called from telemetry.rs) ────────────────────────────────

/// Create an alert directly — used internally from record_telemetry.
/// Does NOT check permissions (internal call only).
pub fn create_alert_internal(
    ctx: &ReducerContext,
    device_id: u64,
    organization_id: u64,
    alert_type: &str,
    severity: &str,
    message: &str,
) -> u64 {
    let alert = ctx.db.iot_alert().insert(IoTAlert {
        id: 0,
        device_id,
        organization_id,
        alert_type: alert_type.to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        triggered_at: ctx.timestamp,
        resolved_at: None,
        resolved_by: None,
        metadata: None,
    });

    log::warn!(
        "IoT alert created: device={} severity={} type={}",
        device_id,
        severity,
        alert_type
    );

    alert.id
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Resolve an open alert, marking it as handled.
#[reducer]
pub fn resolve_iot_alert(
    ctx: &ReducerContext,
    organization_id: u64,
    alert_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_alert", "write")?;

    let alert = ctx
        .db
        .iot_alert()
        .id()
        .find(&alert_id)
        .ok_or("Alert not found")?;

    if alert.organization_id != organization_id {
        return Err("Alert does not belong to this organization".to_string());
    }

    if alert.resolved_at.is_some() {
        return Err("Alert is already resolved".to_string());
    }

    ctx.db.iot_alert().id().update(IoTAlert {
        resolved_at: Some(ctx.timestamp),
        resolved_by: Some(ctx.sender()),
        ..alert
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "iot_alert",
            record_id: alert_id,
            action: "UPDATE",
            old_values: Some(r#"{"resolved_at":null}"#.to_string()),
            new_values: Some(r#"{"resolved_at":"now"}"#.to_string()),
            changed_fields: vec!["resolved_at".to_string(), "resolved_by".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Manually create an alert (e.g. from the ERP UI or another reducer).
#[reducer]
pub fn create_iot_alert(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    alert_type: String,
    severity: String,
    message: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_alert", "create")?;

    match severity.as_str() {
        "Info" | "Warning" | "Critical" => {}
        other => return Err(format!("Invalid severity: {}", other)),
    }

    // Verify device belongs to org
    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    let alert = ctx.db.iot_alert().insert(IoTAlert {
        id: 0,
        device_id,
        organization_id,
        alert_type: alert_type.clone(),
        severity: severity.clone(),
        message: message.clone(),
        triggered_at: ctx.timestamp,
        resolved_at: None,
        resolved_by: None,
        metadata: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "iot_alert",
            record_id: alert.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!(
                r#"{{"device_id":{},"severity":"{}","alert_type":"{}"}}"#,
                device_id, severity, alert_type
            )),
            changed_fields: vec![
                "device_id".to_string(),
                "severity".to_string(),
                "alert_type".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

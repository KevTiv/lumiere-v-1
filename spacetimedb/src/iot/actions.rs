/// IoT Actions — command queue for output devices.
///
/// Actions are inserted by ERP reducers (e.g. print a label when a MO is done)
/// and consumed by the IoT Gateway, which pushes them instantly to the connected
/// hub via WebSocket (falling back to MQTT or HTTP polling).
///
/// ## Result flow (Pass 2)
/// Input devices (scales, calipers) use the action+result pattern:
/// 1. ERP queues `GetWeight` action → device_id of the scale
/// 2. Hub receives via WS push → driver reads scale → calls `acknowledge_iot_action` with `result_payload`
/// 3. Frontend subscribes to the `IoTAction` row and reads `result_payload` once status = "Acknowledged"
use spacetimedb::{reducer, table, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::iot::registry::iot_device;

// ── Tables ────────────────────────────────────────────────────────────────────

#[table(
    accessor = iot_action,
    public,
    index(accessor = iot_action_by_device, btree(columns = [device_id])),
    index(accessor = iot_action_by_org, btree(columns = [organization_id])),
    index(accessor = iot_action_by_status, btree(columns = [status]))
)]
pub struct IoTAction {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub device_id: u64,
    pub organization_id: u64,
    /// "PrintLabel" | "PrintReceipt" | "OpenCashDrawer" | "DisplayMessage"
    /// "TriggerRelay" | "InitiatePayment" | "Custom"
    pub action_type: String,
    /// JSON payload — content depends on action_type
    pub payload: String,
    /// "Pending" | "Sent" | "Acknowledged" | "Failed"
    pub status: String,
    /// Who triggered this action (reducer name or "user:<hex_identity>")
    pub triggered_by: String,
    pub created_at: Timestamp,
    pub sent_at: Option<Timestamp>,
    pub acknowledged_at: Option<Timestamp>,
    /// JSON result returned by the device driver (e.g. weight reading, payment status)
    pub result_payload: Option<String>,
    pub error: Option<String>,
}

// ── Input params ─────────────────────────────────────────────────────────────

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct CreateActionParams {
    pub action_type: String,
    pub payload: String,
    pub triggered_by: String,
}

// ── Internal helper (called from other reducers) ──────────────────────────────

/// Queue an action without a permission check — for internal reducer-to-reducer use.
pub fn queue_action_internal(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    action_type: &str,
    payload: &str,
    triggered_by: &str,
) -> u64 {
    let action = ctx.db.iot_action().insert(IoTAction {
        id: 0,
        device_id,
        organization_id,
        action_type: action_type.to_string(),
        payload: payload.to_string(),
        status: "Pending".to_string(),
        triggered_by: triggered_by.to_string(),
        created_at: ctx.timestamp,
        sent_at: None,
        acknowledged_at: None,
        result_payload: None,
        error: None,
    });

    log::info!(
        "IoT action queued: id={} type={} device={}",
        action.id,
        action_type,
        device_id
    );

    action.id
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Queue a command for an output device (printer, display, relay, payment terminal, etc.).
#[reducer]
pub fn create_iot_action(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    params: CreateActionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_action", "create")?;

    match params.action_type.as_str() {
        "PrintLabel" | "PrintReceipt" | "OpenCashDrawer" | "DisplayMessage" | "TriggerRelay"
        | "InitiatePayment" | "Custom" => {}
        other => return Err(format!("Invalid action_type: {}", other)),
    }

    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    let action = ctx.db.iot_action().insert(IoTAction {
        id: 0,
        device_id,
        organization_id,
        action_type: params.action_type.clone(),
        payload: params.payload.clone(),
        status: "Pending".to_string(),
        triggered_by: params.triggered_by,
        created_at: ctx.timestamp,
        sent_at: None,
        acknowledged_at: None,
        result_payload: None,
        error: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "iot_action",
            record_id: action.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!(
                r#"{{"device_id":{},"action_type":"{}"}}"#,
                device_id, params.action_type
            )),
            changed_fields: vec!["action_type".to_string(), "status".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Send a standardized test action to validate device connectivity from the ERP UI.
/// Equivalent to Odoo's "Test Print" button.
#[reducer]
pub fn test_iot_device(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_action", "create")?;

    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    // Choose a sensible test action based on device type
    let (action_type, payload) = match device.device_type.as_str() {
        "ReceiptPrinter" | "LabelPrinter" => (
            "PrintLabel",
            r#"{"test":true,"content":"Test print from Lumiere ERP","copies":1}"#,
        ),
        "CustomerDisplay" => (
            "DisplayMessage",
            r#"{"test":true,"line1":"Lumiere ERP","line2":"Device OK"}"#,
        ),
        "CashDrawer" => ("OpenCashDrawer", r#"{"test":true}"#),
        "WeighingScale" | "MeasurementTool" => ("Custom", r#"{"test":true,"cmd":"get_reading"}"#),
        _ => ("Custom", r#"{"test":true}"#),
    };

    ctx.db.iot_action().insert(IoTAction {
        id: 0,
        device_id,
        organization_id,
        action_type: action_type.to_string(),
        payload: payload.to_string(),
        status: "Pending".to_string(),
        triggered_by: "test_iot_device".to_string(),
        created_at: ctx.timestamp,
        sent_at: None,
        acknowledged_at: None,
        result_payload: None,
        error: None,
    });

    Ok(())
}

/// Called by the IoT Gateway when it has dispatched the action to the device.
#[reducer]
pub fn mark_action_sent(
    ctx: &ReducerContext,
    organization_id: u64,
    action_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_action", "write")?;

    let action = ctx
        .db
        .iot_action()
        .id()
        .find(&action_id)
        .ok_or("Action not found")?;

    if action.organization_id != organization_id {
        return Err("Action does not belong to this organization".to_string());
    }

    if action.status != "Pending" {
        return Err(format!(
            "Cannot mark as Sent — current status is {}",
            action.status
        ));
    }

    ctx.db.iot_action().id().update(IoTAction {
        status: "Sent".to_string(),
        sent_at: Some(ctx.timestamp),
        ..action
    });

    Ok(())
}

/// Called by the IoT Gateway when the device confirms execution.
/// `result_payload` carries any data returned by the device driver
/// (e.g. scale weight: `{"value":12.5,"unit":"Kg"}`, payment result: `{"approved":true}`).
#[reducer]
pub fn acknowledge_iot_action(
    ctx: &ReducerContext,
    organization_id: u64,
    action_id: u64,
    result_payload: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_action", "write")?;

    let action = ctx
        .db
        .iot_action()
        .id()
        .find(&action_id)
        .ok_or("Action not found")?;

    if action.organization_id != organization_id {
        return Err("Action does not belong to this organization".to_string());
    }

    ctx.db.iot_action().id().update(IoTAction {
        status: "Acknowledged".to_string(),
        acknowledged_at: Some(ctx.timestamp),
        result_payload,
        ..action
    });

    Ok(())
}

/// Called by the IoT Gateway when the device fails to execute the action.
#[reducer]
pub fn fail_iot_action(
    ctx: &ReducerContext,
    organization_id: u64,
    action_id: u64,
    error: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_action", "write")?;

    let action = ctx
        .db
        .iot_action()
        .id()
        .find(&action_id)
        .ok_or("Action not found")?;

    if action.organization_id != organization_id {
        return Err("Action does not belong to this organization".to_string());
    }

    ctx.db.iot_action().id().update(IoTAction {
        status: "Failed".to_string(),
        error: Some(error),
        ..action
    });

    Ok(())
}

/// Retry a failed action by resetting it to Pending.
#[reducer]
pub fn retry_iot_action(
    ctx: &ReducerContext,
    organization_id: u64,
    action_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_action", "write")?;

    let action = ctx
        .db
        .iot_action()
        .id()
        .find(&action_id)
        .ok_or("Action not found")?;

    if action.organization_id != organization_id {
        return Err("Action does not belong to this organization".to_string());
    }

    if action.status != "Failed" {
        return Err(format!(
            "Can only retry Failed actions — current status is {}",
            action.status
        ));
    }

    ctx.db.iot_action().id().update(IoTAction {
        status: "Pending".to_string(),
        error: None,
        result_payload: None,
        sent_at: None,
        acknowledged_at: None,
        ..action
    });

    Ok(())
}

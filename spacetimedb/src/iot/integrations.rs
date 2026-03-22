/// IoT Integrations — link devices to ERP entities.
///
/// Devices are linked to ERP entities so that telemetry events can trigger
/// domain-specific logic:
///   - Scale linked to a stock_location → weight pre-fills inventory adjustments
///   - Scanner linked to a pos_config  → scanned barcode looks up POS product
///   - Sensor linked to a workcenter   → machine state updates MRP productivity
///   - Printer linked to a location    → label prints on stock move completion
use spacetimedb::{reducer, ReducerContext};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::quality::quality_check;
use crate::inventory::warehouse::stock_location;
use crate::iot::registry::iot_device;
use crate::manufacturing::work_centers::mrp_workcenter;
use crate::sales::pos_config::pos_config;

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Link a device to a manufacturing workcenter.
///
/// After linking, machine telemetry (state changes, cycle counts) will be
/// reflected in `MrpWorkcenterProductivity` records.
#[reducer]
pub fn link_device_to_workcenter(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    workcenter_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_device", "write")?;

    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    // Verify workcenter exists
    let _ = ctx
        .db
        .mrp_workcenter()
        .id()
        .find(&workcenter_id)
        .ok_or("Work center not found")?;

    ctx.db
        .iot_device()
        .id()
        .update(crate::iot::registry::IoTDevice {
            workcenter_id: Some(workcenter_id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..device
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "iot_device",
            record_id: device_id,
            action: "UPDATE",
            old_values: Some(r#"{"workcenter_id":null}"#.to_string()),
            new_values: Some(format!(r#"{{"workcenter_id":{}}}"#, workcenter_id)),
            changed_fields: vec!["workcenter_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Link a device to a stock location.
///
/// After linking, scale readings will pre-fill weight on stock moves at this
/// location; barcode scans will look up products in inventory.
#[reducer]
pub fn link_device_to_location(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    location_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_device", "write")?;

    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    // Verify location exists
    let _ = ctx
        .db
        .stock_location()
        .id()
        .find(&location_id)
        .ok_or("Stock location not found")?;

    ctx.db
        .iot_device()
        .id()
        .update(crate::iot::registry::IoTDevice {
            stock_location_id: Some(location_id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..device
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "iot_device",
            record_id: device_id,
            action: "UPDATE",
            old_values: Some(r#"{"stock_location_id":null}"#.to_string()),
            new_values: Some(format!(r#"{{"stock_location_id":{}}}"#, location_id)),
            changed_fields: vec!["stock_location_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Link a device to a POS configuration.
///
/// After linking, barcode scanner reads will look up products in the POS product
/// list; receipt printers will auto-print on order completion.
#[reducer]
pub fn link_device_to_pos(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    pos_config_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_device", "write")?;

    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    // Verify POS config exists
    let _ = ctx
        .db
        .pos_config()
        .id()
        .find(&pos_config_id)
        .ok_or("POS configuration not found")?;

    ctx.db
        .iot_device()
        .id()
        .update(crate::iot::registry::IoTDevice {
            pos_config_id: Some(pos_config_id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..device
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "iot_device",
            record_id: device_id,
            action: "UPDATE",
            old_values: Some(r#"{"pos_config_id":null}"#.to_string()),
            new_values: Some(format!(r#"{{"pos_config_id":{}}}"#, pos_config_id)),
            changed_fields: vec!["pos_config_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Link a measurement device (caliper, gauge, scale) to a quality check.
///
/// After linking, numeric sensor readings from `record_telemetry` are automatically
/// written into `QualityCheck.measure`, enabling hands-free measurement entry.
#[reducer]
pub fn link_device_to_quality_check(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    check_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_device", "write")?;

    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    let _ = ctx
        .db
        .quality_check()
        .id()
        .find(&check_id)
        .ok_or("Quality check not found")?;

    ctx.db
        .iot_device()
        .id()
        .update(crate::iot::registry::IoTDevice {
            quality_check_id: Some(check_id),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..device
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "iot_device",
            record_id: device_id,
            action: "UPDATE",
            old_values: Some(r#"{"quality_check_id":null}"#.to_string()),
            new_values: Some(format!(r#"{{"quality_check_id":{}}}"#, check_id)),
            changed_fields: vec!["quality_check_id".to_string()],
            metadata: None,
        },
    );

    Ok(())
}

/// Unlink a device from all ERP entities (reset all integration links).
#[reducer]
pub fn unlink_device(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_device", "write")?;

    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    ctx.db
        .iot_device()
        .id()
        .update(crate::iot::registry::IoTDevice {
            workcenter_id: None,
            stock_location_id: None,
            pos_config_id: None,
            quality_check_id: None,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..device
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "iot_device",
            record_id: device_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                r#"{"workcenter_id":null,"stock_location_id":null,"pos_config_id":null,"quality_check_id":null}"#
                    .to_string(),
            ),
            changed_fields: vec![
                "workcenter_id".to_string(),
                "stock_location_id".to_string(),
                "pos_config_id".to_string(),
                "quality_check_id".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

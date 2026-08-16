//! IOT-007/008/009/010: company_id denormalization on IoTTelemetry, IoTThreshold,
//! IoTAlert, and IoTAction — all four previously had no company_id column at all.
use spacetimedb::{ReducerContext, Table};

use crate::iot::actions::{create_iot_action, iot_action, CreateActionParams};
use crate::iot::alerts::iot_alert;
use crate::iot::registry::{
    iot_device, iot_hub, register_iot_device, register_iot_hub, RegisterDeviceParams,
    RegisterHubParams,
};
use crate::iot::telemetry::{
    iot_telemetry, iot_threshold, record_telemetry, set_iot_threshold, RecordTelemetryParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn seed_device(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    name: &str,
    device_type: &str,
) -> Result<u64, String> {
    register_iot_hub(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        RegisterHubParams {
            name: format!("{name} Hub"),
            serial: format!("SN-{name}"),
            ip_address: None,
            firmware_version: None,
            metadata: None,
        },
    )?;
    let hub_id = ctx
        .db
        .iot_hub()
        .iter()
        .find(|h| h.organization_id == fixture.organization_id && h.serial == format!("SN-{name}"))
        .map(|h| h.id)
        .ok_or("hub missing after register")?;

    register_iot_device(
        ctx,
        fixture.organization_id,
        fixture.company_id,
        hub_id,
        RegisterDeviceParams {
            name: name.to_string(),
            device_type: device_type.to_string(),
            identifier: format!("ID-{name}"),
            capabilities: vec![],
            metadata: None,
        },
    )?;
    ctx.db
        .iot_device()
        .iter()
        .find(|d| d.organization_id == fixture.organization_id && d.name == name)
        .map(|d| d.id)
        .ok_or_else(|| format!("device {name} missing after register"))
}

/// IOT-007/008: telemetry readings and threshold configs both carry the
/// device's company_id.
pub fn test_telemetry_and_threshold_company_id(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let device_id = seed_device(ctx, &fixture, "Iot Temp Sensor", "TemperatureSensor")?;

    record_telemetry(
        ctx,
        fixture.organization_id,
        device_id,
        RecordTelemetryParams {
            sensor_type: "temperature".to_string(),
            value: 21.5,
            raw_value: None,
            unit: "Celsius".to_string(),
            quality: "good".to_string(),
        },
    )?;
    let reading = ctx
        .db
        .iot_telemetry()
        .iter()
        .find(|t| t.device_id == device_id)
        .ok_or("telemetry row missing")?;
    if reading.company_id != fixture.company_id {
        return Err(format!(
            "telemetry company_id {} != device company_id {}",
            reading.company_id, fixture.company_id
        ));
    }

    set_iot_threshold(
        ctx,
        fixture.organization_id,
        device_id,
        "temperature".to_string(),
        Some(0.0),
        Some(30.0),
        "Warning".to_string(),
    )?;
    let threshold = ctx
        .db
        .iot_threshold()
        .iter()
        .find(|t| t.device_id == device_id)
        .ok_or("threshold row missing")?;
    if threshold.company_id != fixture.company_id {
        return Err(format!(
            "threshold company_id {} != device company_id {}",
            threshold.company_id, fixture.company_id
        ));
    }
    Ok(())
}

/// IOT-009: a threshold breach auto-creates an IoTAlert carrying the device's
/// company_id. IOT-010: create_iot_action also carries it.
pub fn test_alert_and_action_company_id(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let device_id = seed_device(ctx, &fixture, "Iot Alert Sensor", "TemperatureSensor")?;

    set_iot_threshold(
        ctx,
        fixture.organization_id,
        device_id,
        "temperature".to_string(),
        Some(0.0),
        Some(30.0),
        "Critical".to_string(),
    )?;

    // Breach the max — record_telemetry auto-creates an IoTAlert inline.
    record_telemetry(
        ctx,
        fixture.organization_id,
        device_id,
        RecordTelemetryParams {
            sensor_type: "temperature".to_string(),
            value: 99.0,
            raw_value: None,
            unit: "Celsius".to_string(),
            quality: "good".to_string(),
        },
    )?;
    let alert = ctx
        .db
        .iot_alert()
        .iter()
        .find(|a| a.device_id == device_id)
        .ok_or("alert row missing after threshold breach")?;
    if alert.company_id != fixture.company_id {
        return Err(format!(
            "alert company_id {} != device company_id {}",
            alert.company_id, fixture.company_id
        ));
    }

    let action_device_id = seed_device(ctx, &fixture, "Iot Action Printer", "ReceiptPrinter")?;
    create_iot_action(
        ctx,
        fixture.organization_id,
        action_device_id,
        CreateActionParams {
            action_type: "PrintReceipt".to_string(),
            payload: r#"{"order_id":1}"#.to_string(),
            triggered_by: "test".to_string(),
        },
    )?;
    let action = ctx
        .db
        .iot_action()
        .iter()
        .find(|a| a.device_id == action_device_id)
        .ok_or("action row missing")?;
    if action.company_id != fixture.company_id {
        return Err(format!(
            "action company_id {} != device company_id {}",
            action.company_id, fixture.company_id
        ));
    }
    Ok(())
}

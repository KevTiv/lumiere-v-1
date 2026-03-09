/// IoT Telemetry — ingest time-series sensor readings.
///
/// High write-volume table. Each reading is immutable once inserted.
/// Threshold checks run inline to create IoTAlerts when values breach limits.
use spacetimedb::{reducer, table, ReducerContext, Table, Timestamp};

use crate::helpers::check_permission;
use crate::inventory::quality::{quality_check, QualityCheck};
use crate::iot::alerts::create_alert_internal;
use crate::iot::registry::iot_device;
use crate::manufacturing::manufacturing_orders::{mrp_workorder, MrpWorkorder};
use crate::types::WorkorderState;

// ── Tables ────────────────────────────────────────────────────────────────────

#[table(
    accessor = iot_telemetry,
    public,
    index(accessor = telemetry_by_device, btree(columns = [device_id])),
    index(accessor = telemetry_by_org, btree(columns = [organization_id]))
)]
pub struct IoTTelemetry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub device_id: u64,
    pub organization_id: u64,
    /// Sensor type: "weight", "temperature", "humidity", "barcode", "rfid", "count", etc.
    pub sensor_type: String,
    /// Numeric reading (for barcodes/RFID this is 0.0 — use raw_value)
    pub value: f64,
    /// String reading for non-numeric sensors (barcode data, RFID tag, etc.)
    pub raw_value: Option<String>,
    /// Unit: "Kg", "Lb", "Celsius", "Fahrenheit", "Percent", "Count", etc.
    pub unit: String,
    /// Signal quality: "good", "uncertain", "bad"
    pub quality: String,
    pub recorded_at: Timestamp,
}

/// Threshold configuration per device+sensor_type combo.
#[table(
    accessor = iot_threshold,
    public,
    index(accessor = threshold_by_device, btree(columns = [device_id]))
)]
pub struct IoTThreshold {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub device_id: u64,
    pub organization_id: u64,
    pub sensor_type: String,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    /// Severity to use when breached: "Info", "Warning", "Critical"
    pub severity: String,
    pub active: bool,
}

// ── Input params ─────────────────────────────────────────────────────────────

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct RecordTelemetryParams {
    pub sensor_type: String,
    pub value: f64,
    pub raw_value: Option<String>,
    pub unit: String,
    pub quality: String,
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Ingest a single sensor reading.
///
/// Called by the IoT Gateway whenever a device publishes a measurement.
/// Automatically checks configured thresholds and creates alerts if breached.
#[reducer]
pub fn record_telemetry(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    params: RecordTelemetryParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_telemetry", "create")?;

    // Validate device exists and belongs to org
    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    match params.quality.as_str() {
        "good" | "uncertain" | "bad" => {}
        other => return Err(format!("Invalid quality: {}", other)),
    }

    ctx.db.iot_telemetry().insert(IoTTelemetry {
        id: 0,
        device_id,
        organization_id,
        sensor_type: params.sensor_type.clone(),
        value: params.value,
        raw_value: params.raw_value.clone(),
        unit: params.unit.clone(),
        quality: params.quality.clone(),
        recorded_at: ctx.timestamp,
    });

    // Only check thresholds for numeric readings with good quality
    if params.quality == "good" && params.raw_value.is_none() {
        check_thresholds(
            ctx,
            organization_id,
            device_id,
            &params.sensor_type,
            params.value,
        );

        // Quality check measurement auto-fill (calipers / scales linked to a check)
        if let Some(check_id) = device.quality_check_id {
            apply_measurement_to_quality_check(ctx, check_id, params.value);
        }

        // Footswitch → advance the active workorder step
        if device.device_type == "Footswitch"
            && params.sensor_type == "trigger"
            && device.workcenter_id.is_some()
        {
            trigger_footswitch_workorder(ctx, device.workcenter_id.unwrap());
        }
    }

    Ok(())
}

/// Ingest a batch of readings in one reducer call (reduces round-trips for high-frequency devices).
#[reducer]
pub fn record_telemetry_batch(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    readings: Vec<RecordTelemetryParams>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_telemetry", "create")?;

    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    for params in readings {
        match params.quality.as_str() {
            "good" | "uncertain" | "bad" => {}
            _ => continue, // skip invalid quality entries in a batch
        }

        ctx.db.iot_telemetry().insert(IoTTelemetry {
            id: 0,
            device_id,
            organization_id,
            sensor_type: params.sensor_type.clone(),
            value: params.value,
            raw_value: params.raw_value.clone(),
            unit: params.unit.clone(),
            quality: params.quality.clone(),
            recorded_at: ctx.timestamp,
        });

        if params.quality == "good" && params.raw_value.is_none() {
            check_thresholds(
                ctx,
                organization_id,
                device_id,
                &params.sensor_type,
                params.value,
            );
        }
    }

    Ok(())
}

/// Configure a min/max threshold for a device+sensor_type.
#[reducer]
pub fn set_iot_threshold(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    sensor_type: String,
    min_value: Option<f64>,
    max_value: Option<f64>,
    severity: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_threshold", "create")?;

    match severity.as_str() {
        "Info" | "Warning" | "Critical" => {}
        other => return Err(format!("Invalid severity: {}", other)),
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

    // Replace existing threshold for this device+sensor_type if present
    let existing = ctx
        .db
        .iot_threshold()
        .threshold_by_device()
        .filter(&device_id)
        .find(|t| t.sensor_type == sensor_type);

    if let Some(existing) = existing {
        ctx.db.iot_threshold().id().update(IoTThreshold {
            min_value,
            max_value,
            severity,
            active: true,
            ..existing
        });
    } else {
        ctx.db.iot_threshold().insert(IoTThreshold {
            id: 0,
            device_id,
            organization_id,
            sensor_type,
            min_value,
            max_value,
            severity,
            active: true,
        });
    }

    Ok(())
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn check_thresholds(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    sensor_type: &str,
    value: f64,
) {
    let thresholds: Vec<_> = ctx
        .db
        .iot_threshold()
        .threshold_by_device()
        .filter(&device_id)
        .filter(|t| t.sensor_type == sensor_type && t.active)
        .collect();

    for threshold in thresholds {
        let breached_low = threshold.min_value.map_or(false, |min| value < min);
        let breached_high = threshold.max_value.map_or(false, |max| value > max);

        if breached_low {
            create_alert_internal(
                ctx,
                device_id,
                organization_id,
                "threshold_low",
                &threshold.severity,
                &format!(
                    "Sensor '{}' value {:.2} is below minimum {:.2}",
                    sensor_type,
                    value,
                    threshold.min_value.unwrap_or(0.0)
                ),
            );
        } else if breached_high {
            create_alert_internal(
                ctx,
                device_id,
                organization_id,
                "threshold_high",
                &threshold.severity,
                &format!(
                    "Sensor '{}' value {:.2} exceeds maximum {:.2}",
                    sensor_type,
                    value,
                    threshold.max_value.unwrap_or(0.0)
                ),
            );
        }
    }
}

/// Auto-fill QualityCheck.measure with a device reading.
/// Called inline from record_telemetry when device.quality_check_id is set.
fn apply_measurement_to_quality_check(ctx: &ReducerContext, check_id: u64, value: f64) {
    if let Some(check) = ctx.db.quality_check().id().find(&check_id) {
        // Determine pass/fail against tolerance bounds
        let success = match (check.tolerance_min, check.tolerance_max) {
            (Some(min), Some(max)) => {
                if value >= min && value <= max {
                    "pass"
                } else {
                    "fail"
                }
            }
            (Some(min), None) => {
                if value >= min {
                    "pass"
                } else {
                    "fail"
                }
            }
            (None, Some(max)) => {
                if value <= max {
                    "pass"
                } else {
                    "fail"
                }
            }
            (None, None) => "pass",
        };

        ctx.db.quality_check().id().update(QualityCheck {
            measure: Some(value),
            measure_success: Some(success.to_string()),
            write_date: ctx.timestamp,
            ..check
        });

        log::info!(
            "Quality check {} measure updated: {:.4} → {}",
            check_id,
            value,
            success
        );
    }
}

/// Advance the active workorder at a workcenter when a footswitch is triggered.
/// Marks the currently in-progress workorder step as done.
fn trigger_footswitch_workorder(ctx: &ReducerContext, workcenter_id: u64) {
    // Find the first workorder in Progress at this workcenter
    let active = ctx
        .db
        .mrp_workorder()
        .iter()
        .find(|wo| wo.workcenter_id == workcenter_id && wo.state == WorkorderState::Progress);

    if let Some(wo) = active {
        ctx.db.mrp_workorder().id().update(MrpWorkorder {
            state: WorkorderState::Done,
            write_date: ctx.timestamp,
            ..wo
        });
        log::info!(
            "Footswitch advanced workorder {} at workcenter {}",
            wo.id,
            workcenter_id
        );
    }
}

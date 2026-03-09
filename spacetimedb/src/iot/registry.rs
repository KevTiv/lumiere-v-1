use spacetimedb::Identity;
/// IoT Registry — Hub and Device management.
///
/// An IoTHub represents a physical gateway box (like Odoo IoT Box) connected to
/// the network. Each hub can have multiple IoTDevices (sensors, scanners, printers).
///
/// ## Pairing Flow (Pass 2)
/// 1. ERP user calls `generate_hub_pairing_token` → gets a short-lived token string
/// 2. Physical hub POSTs the token to the IoT Gateway `/v1/pair`
/// 3. Gateway calls `claim_hub_with_token` → token consumed, IoTHub row created
/// 4. Hub then calls `sync_hub_devices` to register all detected peripherals
use spacetimedb::{reducer, table, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ── Tables ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
#[table(
    accessor = iot_hub,
    public,
    index(accessor = iot_hub_by_org, btree(columns = [organization_id]))
)]
pub struct IoTHub {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    /// Unique hardware identifier (MAC address or serial number)
    pub serial: String,
    pub ip_address: Option<String>,
    pub firmware_version: Option<String>,
    /// "Online" | "Offline" | "Error" | "Pairing" | "ConnectedNoServer"
    pub status: String,
    pub last_heartbeat: Option<Timestamp>,
    /// e.g. "signal:-65dBm,latency:12ms" — reported by hub on heartbeat
    pub connectivity_quality: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[table(
    accessor = iot_device,
    public,
    index(accessor = iot_device_by_hub, btree(columns = [hub_id])),
    index(accessor = iot_device_by_org, btree(columns = [organization_id]))
)]
pub struct IoTDevice {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub hub_id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub device_type: String, // DeviceType
    /// Port, address, or UUID that identifies this device on the hub
    pub identifier: String,
    pub status: String, // DeviceStatus
    pub capabilities: Vec<String>,
    pub last_seen: Option<Timestamp>,
    // Optional ERP links
    pub workcenter_id: Option<u64>,
    pub stock_location_id: Option<u64>,
    pub pos_config_id: Option<u64>,
    pub quality_check_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Short-lived token used to pair a physical hub without requiring a logged-in user.
/// Consumed on first use; expires after 15 minutes.
#[derive(Clone, Debug)]
#[table(
    accessor = iot_pairing_token,
    public,
    index(accessor = pairing_token_by_org, btree(columns = [organization_id]))
)]
pub struct IoTPairingToken {
    #[primary_key]
    pub token: String, // 32-char random hex
    pub organization_id: u64,
    pub company_id: u64,
    pub expires_at: Timestamp,
    pub used: bool,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

// ── Input params ─────────────────────────────────────────────────────────────

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct RegisterHubParams {
    pub name: String,
    pub serial: String,
    pub ip_address: Option<String>,
    pub firmware_version: Option<String>,
    pub metadata: Option<String>,
}

#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct RegisterDeviceParams {
    pub name: String,
    pub device_type: String,
    pub identifier: String,
    pub capabilities: Vec<String>,
    pub metadata: Option<String>,
}

/// Entry used by `sync_hub_devices` — represents one device the hub detected.
#[derive(spacetimedb::SpacetimeType, Clone, Debug)]
pub struct DeviceSyncEntry {
    pub identifier: String,
    pub name: String,
    pub device_type: String,
    pub capabilities: Vec<String>,
}

// ── Reducers ──────────────────────────────────────────────────────────────────

/// Generate a one-time pairing token for a hub to self-register.
/// Expires in 15 minutes. Call from the ERP UI — show the token to the user
/// who will enter it into the physical box UI.
#[reducer]
pub fn generate_hub_pairing_token(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_hub", "create")?;

    // Build a deterministic 32-char hex token from timestamp + org/company IDs.
    // SpacetimeDB reducers must be deterministic; ctx.timestamp (unique per
    // microsecond) XOR'd with org/company IDs provides sufficient uniqueness.
    let now_us = ctx.timestamp.to_micros_since_unix_epoch() as u64;
    let a = now_us ^ organization_id.wrapping_mul(0x9e3779b9_7f4a7c15);
    let b = now_us
        .wrapping_add(company_id)
        .wrapping_mul(0x6c62272e_07bb0142);
    let token = format!("{:016x}{:016x}", a, b);

    // Expire in 15 minutes = 15 * 60 * 1_000_000 microseconds
    let fifteen_min_us: i64 = 15 * 60 * 1_000_000;
    let now_us = ctx.timestamp.to_micros_since_unix_epoch();
    let expires_at = Timestamp::from_micros_since_unix_epoch(now_us + fifteen_min_us);

    ctx.db.iot_pairing_token().insert(IoTPairingToken {
        token: token.clone(),
        organization_id,
        company_id,
        expires_at,
        used: false,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });

    log::info!(
        "Pairing token generated for org={} company={} token={}",
        organization_id,
        company_id,
        &token[..8]
    );
    Ok(())
}

/// Called by the IoT gateway when a physical hub claims a pairing token.
/// The hub is NOT authenticated — the token is the credential.
/// Creates the IoTHub row and marks the token as used.
#[reducer]
pub fn claim_hub_with_token(
    ctx: &ReducerContext,
    token: String,
    serial: String,
    name: String,
    ip_address: Option<String>,
    firmware_version: Option<String>,
) -> Result<(), String> {
    let pairing = ctx
        .db
        .iot_pairing_token()
        .token()
        .find(&token)
        .ok_or("Invalid pairing token")?;

    if pairing.used {
        return Err("Pairing token already used".to_string());
    }

    let now_us = ctx.timestamp.to_micros_since_unix_epoch();
    let expires_us = pairing.expires_at.to_micros_since_unix_epoch();
    if now_us > expires_us {
        return Err("Pairing token has expired".to_string());
    }

    // Consume the token
    ctx.db.iot_pairing_token().token().update(IoTPairingToken {
        used: true,
        ..pairing.clone()
    });

    // Create the hub — use the token creator as the audit identity
    let hub = ctx.db.iot_hub().insert(IoTHub {
        id: 0,
        organization_id: pairing.organization_id,
        company_id: pairing.company_id,
        name: name.clone(),
        serial: serial.clone(),
        ip_address,
        firmware_version,
        status: "Online".to_string(),
        last_heartbeat: Some(ctx.timestamp),
        connectivity_quality: None,
        create_uid: pairing.created_by,
        create_date: ctx.timestamp,
        write_uid: pairing.created_by,
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log_v2(
        ctx,
        pairing.organization_id,
        AuditLogParams {
            company_id: Some(pairing.company_id),
            table_name: "iot_hub",
            record_id: hub.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!(
                r#"{{"name":"{}","serial":"{}","paired":true}}"#,
                name, serial
            )),
            changed_fields: vec!["name".to_string(), "serial".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Hub claimed via token: id={} serial={} org={}",
        hub.id,
        serial,
        pairing.organization_id
    );
    Ok(())
}

/// Register a new IoT hub manually (requires a logged-in user).
#[reducer]
pub fn register_iot_hub(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: RegisterHubParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_hub", "create")?;

    let hub = ctx.db.iot_hub().insert(IoTHub {
        id: 0,
        organization_id,
        company_id,
        name: params.name.clone(),
        serial: params.serial.clone(),
        ip_address: params.ip_address,
        firmware_version: params.firmware_version,
        status: "Offline".to_string(),
        last_heartbeat: None,
        connectivity_quality: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "iot_hub",
            record_id: hub.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!(
                r#"{{"name":"{}","serial":"{}"}}"#,
                hub.name, hub.serial
            )),
            changed_fields: vec!["name".to_string(), "serial".to_string()],
            metadata: None,
        },
    );

    log::info!("IoT hub registered: id={} serial={}", hub.id, hub.serial);
    Ok(())
}

/// Update hub connectivity info and health on heartbeat from the IoT gateway.
#[reducer]
pub fn update_hub_heartbeat(
    ctx: &ReducerContext,
    organization_id: u64,
    hub_id: u64,
    ip_address: Option<String>,
    firmware_version: Option<String>,
    connectivity_quality: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_hub", "write")?;

    let hub = ctx
        .db
        .iot_hub()
        .id()
        .find(&hub_id)
        .ok_or("IoT hub not found")?;

    if hub.organization_id != organization_id {
        return Err("Hub does not belong to this organization".to_string());
    }

    ctx.db.iot_hub().id().update(IoTHub {
        status: "Online".to_string(),
        last_heartbeat: Some(ctx.timestamp),
        ip_address: ip_address.or(hub.ip_address.clone()),
        firmware_version: firmware_version.or(hub.firmware_version.clone()),
        connectivity_quality,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..hub
    });

    Ok(())
}

/// Auto-discovery sync: hub reports all currently detected devices.
/// Creates rows for new devices, marks absent ones as Offline.
/// Called by the IoT gateway's `/v1/devices/sync` endpoint.
#[reducer]
pub fn sync_hub_devices(
    ctx: &ReducerContext,
    organization_id: u64,
    hub_id: u64,
    detected: Vec<DeviceSyncEntry>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_device", "write")?;

    let hub = ctx
        .db
        .iot_hub()
        .id()
        .find(&hub_id)
        .ok_or("IoT hub not found")?;

    if hub.organization_id != organization_id {
        return Err("Hub does not belong to this organization".to_string());
    }

    // Validate device types
    for entry in &detected {
        validate_device_type(&entry.device_type)?;
    }

    // Collect existing devices for this hub
    let existing: Vec<IoTDevice> = ctx
        .db
        .iot_device()
        .iot_device_by_hub()
        .filter(&hub_id)
        .collect();

    // Create or update detected devices
    for entry in &detected {
        if let Some(existing_device) = existing.iter().find(|d| d.identifier == entry.identifier) {
            // Update name/capabilities and mark online
            ctx.db.iot_device().id().update(IoTDevice {
                name: entry.name.clone(),
                device_type: entry.device_type.clone(),
                capabilities: entry.capabilities.clone(),
                status: "Online".to_string(),
                last_seen: Some(ctx.timestamp),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..existing_device.clone()
            });
        } else {
            // New device — create it
            ctx.db.iot_device().insert(IoTDevice {
                id: 0,
                hub_id,
                organization_id,
                company_id: hub.company_id,
                name: entry.name.clone(),
                device_type: entry.device_type.clone(),
                identifier: entry.identifier.clone(),
                status: "Online".to_string(),
                capabilities: entry.capabilities.clone(),
                last_seen: Some(ctx.timestamp),
                workcenter_id: None,
                stock_location_id: None,
                pos_config_id: None,
                quality_check_id: None,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                metadata: None,
            });

            log::info!(
                "Auto-discovered device: type={} identifier={} hub={}",
                entry.device_type,
                entry.identifier,
                hub_id
            );
        }
    }

    // Mark devices NOT in the detected list as Offline
    let detected_ids: Vec<&str> = detected.iter().map(|e| e.identifier.as_str()).collect();
    for device in &existing {
        if !detected_ids.contains(&device.identifier.as_str()) && device.status != "Offline" {
            ctx.db.iot_device().id().update(IoTDevice {
                status: "Offline".to_string(),
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..device.clone()
            });
        }
    }

    Ok(())
}

/// Register a physical device on an existing hub manually.
#[reducer]
pub fn register_iot_device(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    hub_id: u64,
    params: RegisterDeviceParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_device", "create")?;

    let hub = ctx
        .db
        .iot_hub()
        .id()
        .find(&hub_id)
        .ok_or("IoT hub not found")?;

    if hub.organization_id != organization_id {
        return Err("Hub does not belong to this organization".to_string());
    }

    validate_device_type(&params.device_type)?;

    let device = ctx.db.iot_device().insert(IoTDevice {
        id: 0,
        hub_id,
        organization_id,
        company_id,
        name: params.name.clone(),
        device_type: params.device_type.clone(),
        identifier: params.identifier.clone(),
        status: "Offline".to_string(),
        capabilities: params.capabilities,
        last_seen: None,
        workcenter_id: None,
        stock_location_id: None,
        pos_config_id: None,
        quality_check_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "iot_device",
            record_id: device.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!(
                r#"{{"name":"{}","device_type":"{}","hub_id":{}}}"#,
                device.name, device.device_type, hub_id
            )),
            changed_fields: vec![
                "name".to_string(),
                "device_type".to_string(),
                "hub_id".to_string(),
            ],
            metadata: None,
        },
    );

    log::info!(
        "IoT device registered: id={} type={} hub={}",
        device.id,
        device.device_type,
        hub_id
    );
    Ok(())
}

/// Update device online/offline status (called by IoT gateway on connection events).
#[reducer]
pub fn update_device_status(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
    status: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_device", "write")?;

    match status.as_str() {
        "Online" | "Offline" | "Error" | "Pairing" | "ConnectedNoServer" => {}
        other => return Err(format!("Invalid status: {}", other)),
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

    ctx.db.iot_device().id().update(IoTDevice {
        status,
        last_seen: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..device
    });

    Ok(())
}

/// Delete an IoT hub and all its devices.
#[reducer]
pub fn delete_iot_hub(
    ctx: &ReducerContext,
    organization_id: u64,
    hub_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_hub", "delete")?;

    let hub = ctx
        .db
        .iot_hub()
        .id()
        .find(&hub_id)
        .ok_or("IoT hub not found")?;

    if hub.organization_id != organization_id {
        return Err("Hub does not belong to this organization".to_string());
    }

    let devices: Vec<_> = ctx
        .db
        .iot_device()
        .iot_device_by_hub()
        .filter(&hub_id)
        .collect();

    for device in devices {
        ctx.db.iot_device().id().delete(&device.id);
    }

    ctx.db.iot_hub().id().delete(&hub_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(hub.company_id),
            table_name: "iot_hub",
            record_id: hub_id,
            action: "DELETE",
            old_values: Some(format!(r#"{{"serial":"{}"}}"#, hub.serial)),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    log::info!("IoT hub deleted: id={}", hub_id);
    Ok(())
}

/// Delete a single IoT device.
#[reducer]
pub fn delete_iot_device(
    ctx: &ReducerContext,
    organization_id: u64,
    device_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "iot_device", "delete")?;

    let device = ctx
        .db
        .iot_device()
        .id()
        .find(&device_id)
        .ok_or("IoT device not found")?;

    if device.organization_id != organization_id {
        return Err("Device does not belong to this organization".to_string());
    }

    ctx.db.iot_device().id().delete(&device_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(device.company_id),
            table_name: "iot_device",
            record_id: device_id,
            action: "DELETE",
            old_values: Some(format!(
                r#"{{"name":"{}","device_type":"{}"}}"#,
                device.name, device.device_type
            )),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

// ── Internal helpers ──────────────────────────────────────────────────────────

pub fn validate_device_type(t: &str) -> Result<(), String> {
    match t {
        "BarcodeScanner" | "WeighingScale" | "ReceiptPrinter" | "LabelPrinter" | "CashDrawer"
        | "TemperatureSensor" | "HumiditySensor" | "RfidReader" | "Camera" | "Plc"
        | "PaymentTerminal" | "CustomerDisplay" | "MeasurementTool" | "Footswitch" | "Custom" => {
            Ok(())
        }
        other => Err(format!("Invalid device_type: {}", other)),
    }
}

/// Fleet & Geo Module — Vehicle tracking, POS terminals, warehouse geo
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **FleetVehicle** | Vehicle with GPS lat/lng, driver, status |
/// | **PosTerminal** | POS terminal with lat/lng, status, revenue |
/// | **WarehouseGeo** | Lat/lng enrichment for warehouse records |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::check_permission;

// ============================================================================
// ENUMS
// ============================================================================

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum VehicleStatus {
    Active,
    Idle,
    Maintenance,
    Offline,
}

impl VehicleStatus {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "active" => Ok(Self::Active),
            "idle" => Ok(Self::Idle),
            "maintenance" => Ok(Self::Maintenance),
            "offline" => Ok(Self::Offline),
            other => Err(format!("Invalid vehicle status '{}'. Valid: active, idle, maintenance, offline", other)),
        }
    }
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PosStatus {
    Open,
    Closed,
    Error,
    Maintenance,
}

impl PosStatus {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "open" => Ok(Self::Open),
            "closed" => Ok(Self::Closed),
            "error" => Ok(Self::Error),
            "maintenance" => Ok(Self::Maintenance),
            other => Err(format!("Invalid POS status '{}'. Valid: open, closed, error, maintenance", other)),
        }
    }
}

// ============================================================================
// TABLES
// ============================================================================

/// FleetVehicle — a vehicle tracked with GPS coordinates
#[derive(Clone)]
#[spacetimedb::table(
    accessor = fleet_vehicle,
    public,
    index(accessor = fleet_vehicle_by_org, btree(columns = [organization_id])),
    index(accessor = fleet_vehicle_by_status, btree(columns = [status]))
)]
pub struct FleetVehicle {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub name: String,               // e.g. "Truck #101"
    pub license_plate: Option<String>,
    pub driver_name: Option<String>,
    pub driver_id: Option<Identity>,
    pub status: VehicleStatus,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub speed_kmh: Option<f64>,
    pub heading: Option<f64>,       // degrees (0–360)
    pub last_position_at: Option<Timestamp>,
    pub fuel_level: Option<f64>,    // 0.0–1.0
    pub odometer_km: Option<f64>,
    pub vehicle_type: String,       // "truck", "van", "bike", etc.
    pub company_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// PosTerminal — a point-of-sale terminal with geo location
#[derive(Clone)]
#[spacetimedb::table(
    accessor = pos_terminal,
    public,
    index(accessor = pos_terminal_by_org, btree(columns = [organization_id])),
    index(accessor = pos_terminal_by_status, btree(columns = [status]))
)]
pub struct PosTerminal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub name: String,               // e.g. "NYC Store — 5th Ave"
    pub location_label: Option<String>,
    pub status: PosStatus,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub daily_revenue: f64,
    pub open_orders: u32,
    pub currency_id: Option<u64>,
    pub company_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// WarehouseGeo — adds lat/lng to existing warehouse records
#[derive(Clone)]
#[spacetimedb::table(
    accessor = warehouse_geo,
    public,
    index(accessor = warehouse_geo_by_org, btree(columns = [organization_id])),
    index(accessor = warehouse_geo_by_warehouse, btree(columns = [warehouse_id]))
)]
pub struct WarehouseGeo {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,
    pub warehouse_id: u64,          // FK → Warehouse.id
    pub latitude: f64,
    pub longitude: f64,
    pub address: Option<String>,
    pub city: Option<String>,
    pub country_code: Option<String>,
    pub manager_name: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create or register a fleet vehicle
#[reducer]
pub fn create_fleet_vehicle(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    vehicle_type: String,
    license_plate: Option<String>,
    driver_name: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "fleet_vehicle", "create")?;

    ctx.db.fleet_vehicle().insert(FleetVehicle {
        id: 0,
        organization_id,
        name,
        license_plate,
        driver_name,
        driver_id: None,
        status: VehicleStatus::Idle,
        latitude: None,
        longitude: None,
        speed_kmh: None,
        heading: None,
        last_position_at: None,
        fuel_level: None,
        odometer_km: None,
        vehicle_type,
        company_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

/// Update a vehicle's GPS position and status
#[reducer]
pub fn update_vehicle_position(
    ctx: &ReducerContext,
    vehicle_id: u64,
    latitude: f64,
    longitude: f64,
    speed_kmh: f64,
    heading: f64,
    status: String,
) -> Result<(), String> {
    let vehicle = ctx.db.fleet_vehicle().id().find(&vehicle_id)
        .ok_or_else(|| format!("Vehicle {} not found", vehicle_id))?;

    check_permission(ctx, vehicle.organization_id, "fleet_vehicle", "write")?;

    let new_status = VehicleStatus::from_str(&status)?;

    ctx.db.fleet_vehicle().id().update(FleetVehicle {
        latitude: Some(latitude),
        longitude: Some(longitude),
        speed_kmh: Some(speed_kmh),
        heading: Some(heading),
        status: new_status,
        last_position_at: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..vehicle
    });

    Ok(())
}

/// Create a POS terminal
#[reducer]
pub fn create_pos_terminal(
    ctx: &ReducerContext,
    organization_id: u64,
    name: String,
    location_label: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "pos_terminal", "create")?;

    ctx.db.pos_terminal().insert(PosTerminal {
        id: 0,
        organization_id,
        name,
        location_label,
        status: PosStatus::Closed,
        latitude,
        longitude,
        daily_revenue: 0.0,
        open_orders: 0,
        currency_id: None,
        company_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    Ok(())
}

/// Update POS terminal status and daily stats
#[reducer]
pub fn update_pos_terminal(
    ctx: &ReducerContext,
    terminal_id: u64,
    status: String,
    daily_revenue: f64,
    open_orders: u32,
) -> Result<(), String> {
    let terminal = ctx.db.pos_terminal().id().find(&terminal_id)
        .ok_or_else(|| format!("POS terminal {} not found", terminal_id))?;

    check_permission(ctx, terminal.organization_id, "pos_terminal", "write")?;

    let new_status = PosStatus::from_str(&status)?;

    ctx.db.pos_terminal().id().update(PosTerminal {
        status: new_status,
        daily_revenue,
        open_orders,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..terminal
    });

    Ok(())
}

/// Upsert geo coordinates for a warehouse
#[reducer]
pub fn upsert_warehouse_geo(
    ctx: &ReducerContext,
    organization_id: u64,
    warehouse_id: u64,
    latitude: f64,
    longitude: f64,
    address: Option<String>,
    city: Option<String>,
    country_code: Option<String>,
    manager_name: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "warehouse_geo", "write")?;

    // Find existing geo record for this warehouse
    let existing = ctx.db.warehouse_geo()
        .warehouse_geo_by_warehouse()
        .filter(&warehouse_id)
        .next();

    if let Some(geo) = existing {
        ctx.db.warehouse_geo().id().update(WarehouseGeo {
            latitude,
            longitude,
            address,
            city,
            country_code,
            manager_name,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..geo
        });
    } else {
        ctx.db.warehouse_geo().insert(WarehouseGeo {
            id: 0,
            organization_id,
            warehouse_id,
            latitude,
            longitude,
            address,
            city,
            country_code,
            manager_name,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    }

    Ok(())
}

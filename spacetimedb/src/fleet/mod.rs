/// Fleet & Geo Module — Vehicle tracking and location-aware assets
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **FleetVehicle** | Vehicle registry with real-time GPS position |
/// | **PosTerminal** | Point-of-sale terminal with geo location |
/// | **WarehouseGeo** | Geo-location metadata for existing warehouses |
pub mod fleet;

pub use fleet::*;

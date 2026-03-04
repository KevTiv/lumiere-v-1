/// Inventory Module — Products & Stock Foundation
///
/// Covers SpacetimeDB Migration Plan Phase 3 (Weeks 9–13).
///
/// Sub-modules
/// -----------
/// | File        | Tables                                                        |
/// |-------------|---------------------------------------------------------------|
/// | product     | ProductCategory · Product · ProductAttribute · ProductVariant |
/// |             | ProductSupplierInfo · ProductPackaging                        |
/// | warehouse   | Warehouse · StockLocation · StockRoute · StockRule            |
/// | stock       | StockQuant · StockMove · StockMoveLine · StockPicking         |
/// | tracking    | StockProductionLot · StockProductionSerial · Traceability     |
/// | barcode     | BarcodeRule · BarcodeScan · BarcodeNomenclature               |
/// | quality     | QualityCheck · QualityAlert · QualityPoint · QualityTeam      |
/// | inventory_adjustments | StockInventory · StockInventoryLine · InventoryAdjustment    |
/// |             | AdjustmentReason · StockCountSheet                            |
/// | cycle_count | StockCycleCount                                               |
/// | replenishment | ReplenishmentRule · StockReorderGroup                         |
/// | warehouse_operations | WarehouseTask · PickingWave · PackagingMaterial · CartonizationResult |
/// | valuation   | InventoryValuation                                            |
pub mod barcode;
pub mod cycle_count;
pub mod inventory_adjustments;
pub mod product;
pub mod product_category;
pub mod quality;

pub use cycle_count::*;
pub use product_category::*;
pub mod replenishment;
pub mod stock;
pub mod tracking;
pub mod valuation;
pub mod warehouse;
pub mod warehouse_operations;

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
/// | inventory_close | InventoryClose · InventoryCloseLine                         |
/// | integration | InventoryIntegrationIntent (3PL ASN)                          |
/// | consignment | Consignment receive + ATP ownership                             |
/// | cross_dock  | Cross-dock outbound from inbound dest                           |
/// | putaway     | Directed putaway (rule / least-loaded / fixed)                  |
/// | packing     | StockPackage pack / confirm / done workflow                     |
/// | exceptions  | Short ATP / expired lot / open QC exception queues              |
/// | costing     | Inbound FIFO/LIFO/average/standard quant layer helpers          |
/// | warehouse_sync | Offline remote warehouse sync intents                        |
/// | atp_promise | Multi-WH promise dates + network ATP                            |
pub mod atp_promise;
pub mod audit;
pub mod barcode;
pub mod consignment;
pub mod costing;
pub mod cross_dock;
pub mod cycle_count;
pub mod exceptions;
pub mod integration;
pub mod inventory_adjustments;
pub mod inventory_close;
pub mod packing;
pub mod product;
pub mod product_category;
pub mod putaway;
pub mod quality;

pub use cycle_count::*;
pub use product_category::*;
pub mod replenishment;
pub mod stock;
pub mod tracking;
pub mod valuation;
pub mod warehouse;
pub mod warehouse_operations;
pub mod warehouse_sync;

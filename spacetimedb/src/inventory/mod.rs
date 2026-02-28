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
pub mod barcode;
pub mod product;
pub mod quality;
pub mod stock;
pub mod tracking;
pub mod warehouse;

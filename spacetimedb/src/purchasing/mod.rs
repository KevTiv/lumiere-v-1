/// Purchasing & Supply Chain Module — Purchase Orders, Vendor Management, and Landed Costs
///
/// # Phase 6 Submodules
///
/// | Submodule | Description | Tables |
/// |-----------|-------------|--------|
/// | **purchase_orders** | Purchase orders and requisitions | `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseRequisition` |
/// | **vendor_management** | Partner bank accounts and supplier intake | `ResPartnerBank`, `SupplierIntakeRequest` |
/// | **landed_costs** | Landed cost allocation | `StockLandedCost`, `StockLandedCostLines` |
///
/// # Module Structure
/// ```
/// purchasing/
/// ├── mod.rs              ← Module exports (this file)
/// ├── purchase_orders.rs  ← 6.1 Purchase Orders
/// ├── vendor_management.rs ← 6.2 Vendor Management
/// └── landed_costs.rs     ← 6.3 Landed Costs
/// ```
pub mod landed_costs;
pub mod purchase_orders;
pub mod vendor_management;

// Re-export commonly used types for convenience
pub use landed_costs::{StockLandedCost, StockLandedCostLines};
pub use purchase_orders::{PurchaseOrder, PurchaseOrderLine, PurchaseRequisition};
pub use vendor_management::{ResPartnerBank, SupplierIntakeRequest};

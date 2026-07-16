/// Purchasing & Supply Chain Module — Purchase Orders, Vendor Management, and Landed Costs
///
/// # Phase 6 Submodules
///
/// | Submodule | Description | Tables |
/// |-----------|-------------|--------|
/// | **purchase_orders** | Purchase orders and requisitions | `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseRequisition` |
/// | **vendor_management** | Partner bank accounts and supplier intake | `ResPartnerBank`, `SupplierIntakeRequest` |
/// | **landed_costs** | Landed cost allocation | `StockLandedCost`, `StockLandedCostLines` |
/// | **sourcing** | RFQ / multi-vendor tender MVP | `PurchaseRfq`, `PurchaseRfqLine`, `PurchaseRfqBid` |
/// | **purchase_returns** | Vendor RMA / purchase returns | `PurchaseReturn`, `PurchaseReturnLine` |
/// | **procurement_advanced** | Wave D differentiators | blanket/contracts/scorecards/… |
///
/// # Module Structure
/// ```
/// purchasing/
/// ├── mod.rs              ← Module exports (this file)
/// ├── purchase_orders.rs  ← 6.1 Purchase Orders
/// ├── vendor_management.rs ← 6.2 Vendor Management
/// ├── landed_costs.rs     ← 6.3 Landed Costs
/// ├── sourcing.rs         ← RFQ / tender MVP
/// ├── purchase_returns.rs ← Purchase returns MVP
/// └── procurement_advanced.rs ← Wave D advanced procurement
/// ```
pub mod landed_costs;
pub mod procurement_advanced;
pub mod purchase_orders;
pub mod purchase_returns;
pub mod sourcing;
pub mod vendor_management;

// Re-export commonly used types for convenience
pub use landed_costs::{StockLandedCost, StockLandedCostLines};
pub use purchase_orders::{PurchaseOrder, PurchaseOrderLine, PurchaseRequisition};
pub use purchase_returns::{PurchaseReturn, PurchaseReturnLine};
pub use sourcing::{PurchaseRfq, PurchaseRfqBid, PurchaseRfqLine};
pub use vendor_management::{ResPartnerBank, SupplierIntakeRequest};

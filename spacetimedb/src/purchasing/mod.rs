pub mod integrity_inventory;
/// Purchasing & Supply Chain Module — Purchase Orders, Vendor Management, and Landed Costs
///
/// # Phase 6 Submodules
///
/// | Submodule | Description | Tables |
/// |-----------|-------------|--------|
/// | **purchase_orders** | Purchase orders and requisitions | `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseRequisition`, `PurchaseRequisitionLine` |
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

use spacetimedb::ReducerContext;

use crate::core::organization::organization_settings;

/// Explicit organization-level opt-in for the purchasing actions quarantined in
/// the relational-integrity Phase 0 rollout.
///
/// This flag is intentionally not granted by plan or billing configuration. A
/// real tenant may only enable it after its affected purchasing data has been
/// assessed and a quarantine/backfill decision has been made.
pub const PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG: &str = "purchasing_ri_phase0_unsafe_actions";

const DEMO_MODE_FLAG: &str = "demo_mode";

/// Blocks quarantined purchasing mutations for real tenants until they have
/// explicitly opted in to the Phase 0 restriction override.
///
/// Seed/demo organizations retain their existing behavior through
/// [`DEMO_MODE_FLAG`]. Missing settings fail closed so an existing real tenant
/// cannot bypass the containment guard merely because it predates settings.
pub fn require_purchasing_ri_phase0_unsafe_actions_enabled(
    ctx: &ReducerContext,
    organization_id: u64,
) -> Result<(), String> {
    let enabled = ctx
        .db
        .organization_settings()
        .organization_id()
        .find(&organization_id)
        .map(|settings| {
            settings.feature_flags.iter().any(|flag| {
                flag == PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG || flag == DEMO_MODE_FLAG
            })
        })
        .unwrap_or(false);

    if enabled {
        return Ok(());
    }

    Err(format!(
        "purchasing action is disabled pending relational-integrity remediation; enable `{PURCHASING_RI_PHASE0_UNSAFE_ACTIONS_FLAG}` only after the tenant quarantine/backfill decision"
    ))
}

// Re-export commonly used types for convenience
pub use landed_costs::{StockLandedCost, StockLandedCostLines};
pub use purchase_orders::{
    PurchaseOrder, PurchaseOrderLine, PurchaseRequisition, PurchaseRequisitionLine,
};
pub use purchase_returns::{PurchaseReturn, PurchaseReturnLine};
pub use sourcing::{PurchaseRfq, PurchaseRfqBid, PurchaseRfqLine};
pub use vendor_management::{ResPartnerBank, SupplierIntakeRequest};

/// Sales Module — Sales Quotations, Orders, POS, and Delivery
///
/// # Phase 5 Submodules
///
/// | Submodule | Description | Tables |
/// |-----------|-------------|--------|
/// | **sales_core** | Sales quotations, orders, and order lines | `SaleOrder`, `SaleOrderLine`, `SaleOrderOption` |
/// | **pos_config** | POS setup, payment methods, loyalty programs | `PosConfig`, `PosPaymentMethod`, `PosLoyaltyProgram` |
/// | **pos_transactions** | POS sessions, orders, payments, loyalty cards | `PosSession`, `PosOrder`, `PosOrderLine`, `PosPayment`, `PosLoyaltyCard` |
/// | **delivery_shipping** | Picking batches, carriers, shipping methods | `StockPickingBatch`, `DeliveryCarrier`, `DeliveryPriceRule`, `ShippingMethod` |
///
/// # Module Structure
/// ```
/// sales/
/// ├── mod.rs              ← Module exports (this file)
/// ├── sales_core.rs       ← 5.1 Sales Core (orders, order lines)
/// ├── pos_config.rs       ← 5.2 POS Configuration
/// ├── pos_transactions.rs ← 5.3 POS Transactions
/// └── delivery_shipping.rs ← 5.4 Delivery & Shipping
/// ```
pub mod delivery_shipping;
pub mod pos_config;
pub mod pos_transactions;
pub mod pricelists;
pub mod sales_core;

// Re-export commonly used types for convenience
pub use delivery_shipping::{
    DeliveryCarrier, DeliveryPriceRule, ShippingMethod, StockPickingBatch,
};
pub use pos_config::{PosConfig, PosLoyaltyProgram, PosPaymentMethod};
pub use pos_transactions::{PosLoyaltyCard, PosOrder, PosOrderLine, PosPayment, PosSession};
pub use pricelists::{ProductPricelist, ProductPricelistItem};
pub use sales_core::{SaleOrder, SaleOrderLine, SaleOrderOption};

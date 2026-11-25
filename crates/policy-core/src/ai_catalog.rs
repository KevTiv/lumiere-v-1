//! Shared catalog search can discover only records with a readable display field.

pub const SHARED_CATALOG_READ: &str = "ai.context.catalog.read";
pub const SHARED_CATALOG_MAX_ROWS: u64 = 20;
pub const SHARED_CATALOG_MAX_BYTES: u64 = 64 * 1024;

/// Record kind, authoritative API resource, and the field used for discovery.
pub const SHARED_CATALOG_FIELDS: &[(&str, &str, &str)] = &[
    ("sale_order", "sale-orders", "reference"),
    ("purchase_order", "purchase-orders", "name"),
    ("account_move", "account-moves", "name"),
    ("project_task", "tasks", "name"),
    ("product", "products", "name"),
    ("contact", "contacts", "name"),
];

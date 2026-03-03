/// Inventory Valuation — Tables and Reducers
///
/// Tables:
///   - InventoryValuation
use spacetimedb::{Identity, Timestamp};

/// Inventory Valuation
#[spacetimedb::table(
    accessor = inventory_valuation,
    public,
    index(accessor = valuation_by_org, btree(columns = [organization_id])),
    index(accessor = valuation_by_location, btree(columns = [location_id])),
    index(accessor = valuation_by_product, btree(columns = [product_id]))
)]
pub struct InventoryValuation {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub product_id: u64,
    pub product_variant_id: Option<u64>,
    pub location_id: u64,
    pub warehouse_id: Option<u64>,
    pub company_id: u64,
    pub min_qty: f64,
    pub max_qty: f64,
    pub qty_multiple: f64,
    pub qty_to_order: f64,
    pub lead_days: i32,
    pub route_id: Option<u64>,
    pub group_id: Option<u64>,
    pub action: String,
    pub trigger: String,
    pub auto: bool,
    pub procurement_group_id: Option<u64>,
    pub supplier_id: Option<u64>,
    pub bom_id: Option<u64>,
    pub active: bool,
    pub sequence: i32,
    pub is_active: bool,
    pub last_run: Option<Timestamp>,
    pub next_run: Option<Timestamp>,
    pub created_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub metadata: Option<String>,
}

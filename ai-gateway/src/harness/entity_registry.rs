//! Entity snapshot registry — mirrors `erp-shared/ai-entity-snapshot-registry.ts`.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScopeKind {
    Company,
    Organization,
    OrganizationOptionalCompany,
}

#[derive(Clone, Copy, Debug)]
pub struct RelationSnapshotSpec {
    pub relation_key: &'static str,
    pub table: &'static str,
    pub foreign_key: &'static str,
    pub scope: ScopeKind,
    pub org_column: Option<&'static str>,
    pub company_column: Option<&'static str>,
    pub limit: usize,
    pub prompt_fields: &'static [&'static str],
}

#[derive(Clone, Copy, Debug)]
pub struct EntitySnapshotSpec {
    pub entity_type: &'static str,
    pub table: &'static str,
    pub id_column: &'static str,
    pub scope: ScopeKind,
    pub org_column: Option<&'static str>,
    pub company_column: Option<&'static str>,
    pub prompt_fields: &'static [&'static str],
    pub label_template: &'static str,
    pub relations: &'static [RelationSnapshotSpec],
}

const SALE_ORDER_LINES: RelationSnapshotSpec = RelationSnapshotSpec {
    relation_key: "lines",
    table: "sale_order_line",
    foreign_key: "order_id",
    scope: ScopeKind::Company,
    org_column: Some("organization_id"),
    company_column: Some("company_id"),
    limit: 20,
    prompt_fields: &[
        "id",
        "name",
        "product_id",
        "product_uom_qty",
        "price_unit",
        "price_subtotal",
        "price_total",
    ],
};

const PURCHASE_ORDER_LINES: RelationSnapshotSpec = RelationSnapshotSpec {
    relation_key: "lines",
    table: "purchase_order_line",
    foreign_key: "order_id",
    scope: ScopeKind::Company,
    org_column: Some("organization_id"),
    company_column: Some("company_id"),
    limit: 20,
    prompt_fields: &[
        "id",
        "product_id",
        "product_qty",
        "price_unit",
        "price_subtotal",
        "price_total",
    ],
};

const SALE_ORDER: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "sale_order",
    table: "sale_order",
    id_column: "id",
    scope: ScopeKind::Company,
    org_column: Some("organization_id"),
    company_column: Some("company_id"),
    prompt_fields: &[
        "id",
        "reference",
        "state",
        "amount_total",
        "amount_untaxed",
        "amount_tax",
        "partner_id",
        "date_order",
        "invoice_status",
        "company_id",
        "organization_id",
    ],
    label_template: "Sale order #{id}",
    relations: &[SALE_ORDER_LINES],
};

const PURCHASE_ORDER: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "purchase_order",
    table: "purchase_order",
    id_column: "id",
    scope: ScopeKind::Company,
    org_column: Some("organization_id"),
    company_column: Some("company_id"),
    prompt_fields: &[
        "id",
        "name",
        "state",
        "partner_id",
        "amount_total",
        "amount_untaxed",
        "amount_tax",
        "date_order",
        "invoice_status",
        "receipt_status",
        "company_id",
        "organization_id",
    ],
    label_template: "Purchase order #{id}",
    relations: &[PURCHASE_ORDER_LINES],
};

const PROJECT_TASK: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "project_task",
    table: "project_task",
    id_column: "id",
    scope: ScopeKind::Company,
    org_column: Some("organization_id"),
    company_column: Some("company_id"),
    prompt_fields: &[
        "id",
        "name",
        "description",
        "priority",
        "state",
        "kanban_state",
        "project_id",
        "partner_id",
        "date_deadline",
        "progress",
        "is_closed",
        "is_blocked",
        "company_id",
        "organization_id",
    ],
    label_template: "Task #{id}",
    relations: &[],
};

const ACCOUNT_MOVE: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "account_move",
    table: "account_move",
    id_column: "id",
    scope: ScopeKind::Company,
    org_column: Some("organization_id"),
    company_column: Some("company_id"),
    prompt_fields: &[
        "id",
        "name",
        "ref_",
        "move_type",
        "state",
        "date",
        "partner_id",
        "amount_total",
        "amount_residual",
        "payment_state",
        "company_id",
        "organization_id",
    ],
    label_template: "Journal entry #{id}",
    relations: &[],
};

const MRP_PRODUCTION: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "mrp_production",
    table: "mrp_production",
    id_column: "id",
    scope: ScopeKind::Company,
    org_column: Some("organization_id"),
    company_column: Some("company_id"),
    prompt_fields: &[
        "id",
        "origin",
        "product_id",
        "product_qty",
        "qty_produced",
        "state",
        "availability",
        "date_planned_start",
        "date_planned_finished",
        "is_delayed",
        "company_id",
        "organization_id",
    ],
    label_template: "Manufacturing order #{id}",
    relations: &[],
};

const PRODUCT: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "product",
    table: "product",
    id_column: "id",
    scope: ScopeKind::Organization,
    org_column: Some("organization_id"),
    company_column: None,
    prompt_fields: &[
        "id",
        "name",
        "display_name",
        "default_code",
        "list_price",
        "qty_available",
        "active",
        "type_",
        "organization_id",
    ],
    label_template: "Product #{id}",
    relations: &[],
};

const CONTACT: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "contact",
    table: "contact",
    id_column: "id",
    scope: ScopeKind::OrganizationOptionalCompany,
    org_column: Some("organization_id"),
    company_column: Some("company_id"),
    prompt_fields: &[
        "id",
        "name",
        "display_name",
        "email",
        "phone",
        "type_",
        "is_customer",
        "is_vendor",
        "company_id",
        "organization_id",
    ],
    label_template: "Contact #{id}",
    relations: &[],
};

const REGISTRY: &[EntitySnapshotSpec] = &[
    SALE_ORDER,
    PURCHASE_ORDER,
    PROJECT_TASK,
    ACCOUNT_MOVE,
    MRP_PRODUCTION,
    PRODUCT,
    CONTACT,
];

pub fn normalize_entity_type(raw: &str) -> String {
    raw.trim().to_ascii_lowercase().replace('-', "_")
}

pub fn lookup_entity_spec(entity_type: &str) -> Option<&'static EntitySnapshotSpec> {
    let key = normalize_entity_type(entity_type);
    REGISTRY.iter().find(|spec| spec.entity_type == key)
}

pub fn content_type_to_entity(content_type: &str) -> Option<&'static str> {
    match normalize_entity_type(content_type).as_str() {
        "sale_order" => Some("sale_order"),
        "purchase_order" => Some("purchase_order"),
        "project_task" => Some("project_task"),
        "account_move" => Some("account_move"),
        "mrp_production" => Some("mrp_production"),
        "product" => Some("product"),
        "contact" => Some("contact"),
        _ => None,
    }
}

pub fn format_snapshot_label(template: &str, id: u64) -> String {
    template.replace("{id}", &id.to_string())
}

pub fn entity_type_allowed(entity_type: &str, allowed_entity_types: Option<&[String]>) -> bool {
    let Some(allowed) = allowed_entity_types.filter(|list| !list.is_empty()) else {
        return true;
    };
    let key = normalize_entity_type(entity_type);
    allowed
        .iter()
        .any(|value| normalize_entity_type(value) == key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_sale_order_spec() {
        let spec = lookup_entity_spec("sale_order").expect("spec");
        assert_eq!(spec.table, "sale_order");
        assert!(!spec.relations.is_empty());
    }

    #[test]
    fn lookup_purchase_order_has_lines() {
        let spec = lookup_entity_spec("purchase_order").expect("spec");
        assert_eq!(spec.relations[0].table, "purchase_order_line");
    }

    #[test]
    fn content_type_maps_product() {
        assert_eq!(content_type_to_entity("product"), Some("product"));
    }

    #[test]
    fn entity_type_allowed_filters_unknown() {
        assert!(entity_type_allowed(
            "sale_order",
            Some(&["sale_order".to_string()])
        ));
        assert!(!entity_type_allowed(
            "product",
            Some(&["sale_order".to_string()])
        ));
        assert!(entity_type_allowed("product", None));
    }
}

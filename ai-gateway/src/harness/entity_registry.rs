//! Entity snapshot registry — mirrors `erp-shared/ai-entity-snapshot-registry.ts`.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScopeKind {
    Company,
    Organization,
    OrganizationOptionalCompany,
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
}

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
};

const REGISTRY: &[EntitySnapshotSpec] = &[SALE_ORDER, PRODUCT, CONTACT];

pub fn normalize_entity_type(raw: &str) -> String {
    raw.trim().to_ascii_lowercase().replace('-', "_")
}

pub fn lookup_entity_spec(entity_type: &str) -> Option<&'static EntitySnapshotSpec> {
    let key = normalize_entity_type(entity_type);
    REGISTRY.iter().find(|spec| spec.entity_type == key)
}

pub fn content_type_to_entity(content_type: &str) -> Option<&'static str> {
    match normalize_entity_type(content_type).as_str() {
        "product" => Some("product"),
        "contact" => Some("contact"),
        _ => None,
    }
}

pub fn format_snapshot_label(template: &str, id: u64) -> String {
    template.replace("{id}", &id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_sale_order_spec() {
        let spec = lookup_entity_spec("sale_order").expect("spec");
        assert_eq!(spec.table, "sale_order");
    }

    #[test]
    fn content_type_maps_product() {
        assert_eq!(content_type_to_entity("product"), Some("product"));
    }
}

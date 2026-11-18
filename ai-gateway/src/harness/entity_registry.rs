//! Allowlisted ERP snapshots and fields for grounded answers.

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
    /// Fields derived by the actor-authorized API, outside the native table.
    pub derived_prompt_fields: &'static [&'static str],
}

#[derive(Clone, Copy, Debug)]
pub struct EntitySnapshotSpec {
    pub entity_type: &'static str,
    pub api_resource: &'static str,
    pub table: &'static str,
    pub id_column: &'static str,
    pub scope: ScopeKind,
    pub org_column: Option<&'static str>,
    pub company_column: Option<&'static str>,
    pub prompt_fields: &'static [&'static str],
    /// Fields derived by the actor-authorized API, outside the native table.
    pub derived_prompt_fields: &'static [&'static str],
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
        "organization_id",
        "company_id",
        "order_id",
        "name",
        "product_id",
        "product_uom_qty",
        "price_unit",
        "price_subtotal",
        "price_total",
    ],
    derived_prompt_fields: &[],
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
        "organization_id",
        "company_id",
        "order_id",
        "product_id",
        "product_qty",
        "price_unit",
        "price_subtotal",
        "price_total",
    ],
    derived_prompt_fields: &[],
};

const SALE_ORDER: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "sale_order",
    api_resource: "sale-orders",
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
    derived_prompt_fields: &[],
    label_template: "Sale order #{id}",
    relations: &[SALE_ORDER_LINES],
};

const PURCHASE_ORDER: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "purchase_order",
    api_resource: "purchase-orders",
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
    derived_prompt_fields: &[],
    label_template: "Purchase order #{id}",
    relations: &[PURCHASE_ORDER_LINES],
};

const PROJECT_TASK: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "project_task",
    api_resource: "tasks",
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
    derived_prompt_fields: &[],
    label_template: "Task #{id}",
    relations: &[],
};

const ACCOUNT_MOVE: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "account_move",
    api_resource: "account-moves",
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
        "journal_id",
        "currency_id",
        "company_currency_id",
        "invoice_date",
        "invoice_date_due",
        "amount_untaxed",
        "amount_tax",
        "amount_total",
        "amount_residual",
        "payment_state",
        "company_id",
        "organization_id",
    ],
    derived_prompt_fields: &["currency_code", "company_currency_code"],
    label_template: "Journal entry #{id}",
    relations: &[ACCOUNT_MOVE_LINES],
};

const MRP_PRODUCTION: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "mrp_production",
    api_resource: "mrp-productions",
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
    derived_prompt_fields: &[],
    label_template: "Manufacturing order #{id}",
    relations: &[],
};

const PRODUCT: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "product",
    api_resource: "products",
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
    derived_prompt_fields: &[],
    label_template: "Product #{id}",
    relations: &[],
};

const CONTACT: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "contact",
    api_resource: "contacts",
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
    derived_prompt_fields: &[],
    label_template: "Contact #{id}",
    relations: &[],
};

const fn company_snapshot(
    table: &'static str,
    api_resource: &'static str,
    label_template: &'static str,
    prompt_fields: &'static [&'static str],
    relations: &'static [RelationSnapshotSpec],
) -> EntitySnapshotSpec {
    EntitySnapshotSpec {
        entity_type: table,
        api_resource,
        table,
        id_column: "id",
        scope: ScopeKind::Company,
        org_column: Some("organization_id"),
        company_column: Some("company_id"),
        prompt_fields,
        derived_prompt_fields: &[],
        label_template,
        relations,
    }
}

const fn company_relation(
    relation_key: &'static str,
    table: &'static str,
    foreign_key: &'static str,
    prompt_fields: &'static [&'static str],
) -> RelationSnapshotSpec {
    RelationSnapshotSpec {
        relation_key,
        table,
        foreign_key,
        scope: ScopeKind::Company,
        org_column: Some("organization_id"),
        company_column: Some("company_id"),
        limit: 20,
        prompt_fields,
        derived_prompt_fields: &[],
    }
}

const ACCOUNT_MOVE_LINE_FIELDS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "move_id",
    "account_id",
    "name",
    "date",
    "parent_state",
    "debit",
    "credit",
    "balance",
    "currency_id",
    "company_currency_id",
    "payment_id",
    "product_id",
    "quantity",
    "price_unit",
    "price_subtotal",
    "display_type",
    "sequence",
];
const ACCOUNT_MOVE_LINES: RelationSnapshotSpec = RelationSnapshotSpec {
    derived_prompt_fields: &[
        "account_code",
        "account_name",
        "currency_code",
        "company_currency_code",
    ],
    ..company_relation(
        "lines",
        "account_move_line",
        "move_id",
        ACCOUNT_MOVE_LINE_FIELDS,
    )
};
const ACCOUNT_MOVE_LINE: EntitySnapshotSpec = company_snapshot(
    "account_move_line",
    "account-move-lines",
    "Journal line #{id}",
    ACCOUNT_MOVE_LINE_FIELDS,
    &[],
);
const ACCOUNT: EntitySnapshotSpec = company_snapshot(
    "account_account",
    "account-accounts",
    "Account #{id}",
    &[
        "id",
        "organization_id",
        "company_id",
        "code",
        "name",
        "internal_type",
        "internal_group",
        "currency_id",
        "deprecated",
    ],
    &[],
);
const PAYMENT_ALLOCATIONS: RelationSnapshotSpec = company_relation(
    "allocations",
    "payment_reconciliation",
    "account_payment_id",
    &[
        "id",
        "organization_id",
        "company_id",
        "account_payment_id",
        "allocated_move_line_id",
        "allocated_amount",
        "currency_id",
        "residual_before",
        "residual_after",
        "is_reversal",
        "reversed_reconciliation_id",
    ],
);
const PAYMENT: EntitySnapshotSpec = EntitySnapshotSpec {
    derived_prompt_fields: &["currency_code"],
    ..company_snapshot(
        "account_payment",
        "account-payments",
        "Payment #{id}",
        &[
            "id",
            "organization_id",
            "company_id",
            "name",
            "ref_",
            "state",
            "date",
            "amount",
            "currency_id",
            "partner_id",
            "payment_type",
            "move_id",
            "reversal_move_id",
            "reconciled_invoice_ids",
            "reconciled_bill_ids",
        ],
        &[PAYMENT_ALLOCATIONS],
    )
};

const STOCK_MOVE_FIELDS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "picking_id",
    "reference",
    "state",
    "product_id",
    "product_variant_id",
    "product_uom",
    "product_uom_qty",
    "quantity_done",
    "location_id",
    "location_dest_id",
];
const STOCK_MOVE: EntitySnapshotSpec = company_snapshot(
    "stock_move",
    "stock-moves",
    "Stock movement #{id}",
    STOCK_MOVE_FIELDS,
    &[],
);
const STOCK_MOVE_LINE: EntitySnapshotSpec = company_snapshot(
    "stock_move_line",
    "stock-move-lines",
    "Stock movement line #{id}",
    &[
        "id",
        "organization_id",
        "company_id",
        "move_id",
        "picking_id",
        "reference",
        "product_id",
        "product_variant_id",
        "product_uom_id",
        "location_id",
        "location_dest_id",
        "lot_id",
        "qty_done",
        "state",
        "date",
    ],
    &[],
);
const STOCK_PICKING: EntitySnapshotSpec = company_snapshot(
    "stock_picking",
    "stock-pickings",
    "Warehouse transfer #{id}",
    &[
        "id",
        "organization_id",
        "company_id",
        "name",
        "state",
        "picking_code",
        "location_id",
        "location_dest_id",
        "scheduled_date",
        "date_done",
        "sale_id",
        "purchase_id",
        "backorder_id",
    ],
    &[company_relation(
        "moves",
        "stock_move",
        "picking_id",
        STOCK_MOVE_FIELDS,
    )],
);
const STOCK_COUNT_LINES: RelationSnapshotSpec = RelationSnapshotSpec {
    scope: ScopeKind::Organization,
    company_column: None,
    ..company_relation(
        "lines",
        "stock_count_sheet",
        "cycle_count_id",
        &[
            "id",
            "organization_id",
            "cycle_count_id",
            "product_id",
            "location_id",
            "lot_id",
            "uom_id",
            "expected_qty",
            "counted_qty",
            "variance",
            "variance_value",
            "counted_at",
            "is_processed",
        ],
    )
};
const STOCK_CYCLE_COUNT: EntitySnapshotSpec = company_snapshot(
    "stock_cycle_count",
    "stock-cycle-counts",
    "Cycle count #{id}",
    &[
        "id",
        "organization_id",
        "company_id",
        "name",
        "state",
        "location_id",
        "last_count_date",
        "next_count_date",
    ],
    &[STOCK_COUNT_LINES],
);
const STOCK_QUANT_FIELDS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "product_id",
    "product_variant_id",
    "location_id",
    "lot_id",
    "quantity",
    "reserved_quantity",
    "available_quantity",
];
const STOCK_QUANT: EntitySnapshotSpec = company_snapshot(
    "stock_quant",
    "stock-quants",
    "Stock position #{id}",
    STOCK_QUANT_FIELDS,
    &[],
);
const STOCK_LOCATION: EntitySnapshotSpec = company_snapshot(
    "stock_location",
    "stock-locations",
    "Warehouse location #{id}",
    &[
        "id",
        "organization_id",
        "company_id",
        "name",
        "complete_name",
        "location_id",
        "usage",
    ],
    &[company_relation(
        "quants",
        "stock_quant",
        "location_id",
        STOCK_QUANT_FIELDS,
    )],
);

const FLEET_INSPECTION_FIELDS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "vehicle_id",
    "inspected_at",
    "outcome",
    "odometer_km",
    "notes",
];
const FLEET_INSPECTION: EntitySnapshotSpec = company_snapshot(
    "fleet_inspection",
    "fleet-inspections",
    "Fleet inspection #{id}",
    FLEET_INSPECTION_FIELDS,
    &[],
);
const FLEET_SERVICE_FIELDS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "vehicle_id",
    "serviced_at",
    "service_type_id",
    "odometer_km",
    "provider",
    "notes",
    "cost_amount",
    "currency_id",
    "account_move_id",
];
const FLEET_SERVICE: EntitySnapshotSpec = company_snapshot(
    "fleet_service_record",
    "fleet-service-records",
    "Fleet service record #{id}",
    FLEET_SERVICE_FIELDS,
    &[],
);
const FLEET_VEHICLE: EntitySnapshotSpec = company_snapshot(
    "fleet_vehicle",
    "fleet-vehicles",
    "Vehicle #{id}",
    &[
        "id",
        "organization_id",
        "company_id",
        "name",
        "license_plate",
        "status",
        "vehicle_type",
        "odometer_km",
    ],
    &[
        company_relation(
            "inspections",
            "fleet_inspection",
            "vehicle_id",
            FLEET_INSPECTION_FIELDS,
        ),
        company_relation(
            "service_records",
            "fleet_service_record",
            "vehicle_id",
            FLEET_SERVICE_FIELDS,
        ),
    ],
);

const LEAD: EntitySnapshotSpec = EntitySnapshotSpec {
    scope: ScopeKind::Organization,
    company_column: None,
    ..company_snapshot(
        "lead",
        "leads",
        "CRM lead #{id}",
        &[
            "id",
            "organization_id",
            "name",
            "company_name",
            "state",
            "probability",
            "expected_revenue",
            "date_deadline",
            "priority",
        ],
        &[],
    )
};
const OPPORTUNITY: EntitySnapshotSpec = company_snapshot(
    "opportunity",
    "opportunities",
    "CRM opportunity #{id}",
    &[
        "id",
        "organization_id",
        "company_id",
        "name",
        "stage_id",
        "probability",
        "expected_revenue",
        "company_currency_id",
        "is_won",
        "is_lost",
        "date_deadline",
        "lead_id",
        "contact_id",
    ],
    &[company_relation(
        "lines",
        "opportunity_line",
        "opportunity_id",
        &[
            "id",
            "organization_id",
            "company_id",
            "opportunity_id",
            "name",
            "product_id",
            "quantity",
            "uom_id",
            "price_unit",
            "price_subtotal",
        ],
    )],
);

const EXPENSE: EntitySnapshotSpec = company_snapshot(
    "hr_expense",
    "expenses",
    "Expense #{id}",
    &[
        "id",
        "organization_id",
        "company_id",
        "name",
        "state",
        "date",
        "total_amount",
        "currency_id",
        "line_kind",
        "payment_mode",
        "has_receipt",
    ],
    &[],
);
const EXPENSE_SHEET: EntitySnapshotSpec = EntitySnapshotSpec {
    entity_type: "hr_expense_sheet",
    ..company_snapshot(
        "expense_sheet",
        "expense-sheets",
        "Expense report #{id}",
        &[
            "id",
            "organization_id",
            "company_id",
            "name",
            "state",
            "total_amount",
            "currency_id",
            "accounting_date",
            "account_move_id",
            "reimbursement_move_id",
        ],
        &[],
    )
};
const SUBSCRIPTION_LINE_FIELDS: &[&str] = &[
    "id",
    "organization_id",
    "company_id",
    "subscription_id",
    "name",
    "product_id",
    "product_uom_qty",
    "price_unit",
    "price_subtotal",
    "currency_id",
    "recurring_rule_type",
    "recurring_interval",
    "line_is_recurring",
];
const SUBSCRIPTION_LINE: EntitySnapshotSpec = company_snapshot(
    "subscription_line",
    "subscription-lines",
    "Subscription line #{id}",
    SUBSCRIPTION_LINE_FIELDS,
    &[],
);
const SUBSCRIPTION: EntitySnapshotSpec = company_snapshot(
    "subscription",
    "subscriptions",
    "Subscription #{id}",
    &[
        "id",
        "organization_id",
        "company_id",
        "code",
        "state",
        "plan_id",
        "partner_id",
        "currency_id",
        "date_start",
        "close_date",
        "recurring_next_date",
        "recurring_total",
        "recurring_mrr",
        "invoice_count",
        "health",
    ],
    &[company_relation(
        "lines",
        "subscription_line",
        "subscription_id",
        SUBSCRIPTION_LINE_FIELDS,
    )],
);

const REGISTRY: &[EntitySnapshotSpec] = &[
    SALE_ORDER,
    PURCHASE_ORDER,
    PROJECT_TASK,
    ACCOUNT_MOVE,
    MRP_PRODUCTION,
    PRODUCT,
    CONTACT,
    ACCOUNT_MOVE_LINE,
    ACCOUNT,
    PAYMENT,
    STOCK_MOVE,
    STOCK_MOVE_LINE,
    STOCK_PICKING,
    STOCK_CYCLE_COUNT,
    STOCK_QUANT,
    STOCK_LOCATION,
    FLEET_INSPECTION,
    FLEET_SERVICE,
    FLEET_VEHICLE,
    LEAD,
    OPPORTUNITY,
    EXPENSE,
    EXPENSE_SHEET,
    SUBSCRIPTION_LINE,
    SUBSCRIPTION,
];

pub fn normalize_entity_type(raw: &str) -> String {
    let key = raw.trim().to_ascii_lowercase().replace('-', "_");
    match key.as_str() {
        "expense_sheet" => "hr_expense_sheet".to_owned(),
        "crm_lead" => "lead".to_owned(),
        _ => key,
    }
}

pub fn lookup_entity_spec(entity_type: &str) -> Option<&'static EntitySnapshotSpec> {
    let key = normalize_entity_type(entity_type);
    REGISTRY.iter().find(|spec| spec.entity_type == key)
}

pub fn content_type_to_entity(content_type: &str) -> Option<&'static str> {
    lookup_entity_spec(content_type).map(|spec| spec.entity_type)
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
        assert_eq!(spec.api_resource, "sale-orders");
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
    fn supported_snapshots_provide_stable_keys_and_scope_fields() {
        let mut entities = std::collections::HashSet::new();
        let mut resources = std::collections::HashSet::new();

        for spec in REGISTRY {
            assert!(entities.insert(spec.entity_type));
            assert!(resources.insert(spec.api_resource));
            assert_eq!(
                content_type_to_entity(spec.entity_type),
                Some(spec.entity_type)
            );
            assert!(spec.prompt_fields.contains(&spec.id_column));
            if let Some(organization) = spec.org_column {
                assert!(spec.prompt_fields.contains(&organization));
            }
            if let Some(company) = spec.company_column {
                assert!(spec.prompt_fields.contains(&company));
            }
            for relation in spec.relations {
                assert!(relation.limit > 0);
                assert!(relation.prompt_fields.contains(&relation.foreign_key));
                if let Some(organization) = relation.org_column {
                    assert!(relation.prompt_fields.contains(&organization));
                }
                if let Some(company) = relation.company_column {
                    assert!(relation.prompt_fields.contains(&company));
                }
            }
        }
        assert_eq!(
            content_type_to_entity("expense_sheet"),
            Some("hr_expense_sheet")
        );
        assert_eq!(content_type_to_entity("crm_lead"), Some("lead"));
        assert_eq!(content_type_to_entity("ai_evidence_passage"), None);
    }

    #[test]
    fn journal_lines_include_debit_credit_and_separately_derived_account_labels() {
        let spec = lookup_entity_spec("account_move").expect("journal snapshot");
        let lines = &spec.relations[0];

        assert_eq!(lines.relation_key, "lines");
        assert_eq!(lines.foreign_key, "move_id");
        assert_eq!(lines.scope, ScopeKind::Company);
        assert!(lines.prompt_fields.contains(&"debit"));
        assert!(lines.prompt_fields.contains(&"credit"));
        assert_eq!(
            lines.derived_prompt_fields,
            [
                "account_code",
                "account_name",
                "currency_code",
                "company_currency_code"
            ]
        );
        assert_eq!(
            spec.derived_prompt_fields,
            ["currency_code", "company_currency_code"]
        );
    }

    #[test]
    fn cycle_count_lines_use_the_selected_parent_and_organization() {
        let spec = lookup_entity_spec("stock_cycle_count").expect("cycle count snapshot");
        let lines = &spec.relations[0];

        assert_eq!(spec.scope, ScopeKind::Company);
        assert_eq!(lines.scope, ScopeKind::Organization);
        assert_eq!(lines.foreign_key, "cycle_count_id");
        assert!(lines.prompt_fields.contains(&"variance"));
        assert_eq!(lines.company_column, None);
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

use super::*;
use crate::models::{
    ApprovedCapabilityMetadata, ApprovedComponentMetadata, ComponentKind, ComponentReference,
    DetailNode, ModuleDraft, PageDefinition, PageNode, SemanticSlot,
};

fn limits() -> ValidationLimits {
    ValidationLimits {
        max_pages: 2,
        max_nodes_per_page: 4,
        max_fields_per_node: 3,
        max_page_size: 100,
        max_read_bindings: 2,
        max_id_length: 32,
        max_title_length: 64,
    }
}
fn catalog() -> ValidationCatalog {
    ValidationCatalog {
        application_contract: "contracts-v1".into(),
        component_catalog_version: 7,
        components: vec![
            ApprovedComponentMetadata {
                id: "collection".into(),
                kind: ComponentKind::Collection,
                version: 1,
                slots: vec![SemanticSlot::Primary],
            },
            ApprovedComponentMetadata {
                id: "detail".into(),
                kind: ComponentKind::Detail,
                version: 1,
                slots: vec![SemanticSlot::Secondary],
            },
        ],
        capabilities: vec![ApprovedCapabilityMetadata {
            resource: "receivables".into(),
            fields: vec!["id".into(), "name".into(), "amount".into()],
        }],
    }
}
fn draft() -> ModuleDraft {
    ModuleDraft {
        schema_version: 1,
        module_id: "collections".into(),
        title: "Collections".into(),
        base_revision: None,
        application_contract: "contracts-v1".into(),
        component_catalog_version: 7,
        pages: vec![PageDefinition {
            id: "home".into(),
            title: "Home".into(),
            nodes: vec![
                PageNode::Collection(crate::models::CollectionNode {
                    id: "receivables".into(),
                    slot: SemanticSlot::Primary,
                    component: ComponentReference {
                        id: "collection".into(),
                        version: 1,
                    },
                    resource: "receivables".into(),
                    fields: vec!["id".into(), "name".into()],
                    page_size: 50,
                }),
                PageNode::Detail(DetailNode {
                    id: "detail".into(),
                    slot: SemanticSlot::Secondary,
                    component: ComponentReference {
                        id: "detail".into(),
                        version: 1,
                    },
                    source_node_id: "receivables".into(),
                    fields: vec!["id".into(), "amount".into()],
                }),
            ],
        }],
    }
}

#[test]
fn accepts_valid_collection_detail_draft() {
    assert!(validate_module_draft(&draft(), &catalog(), &limits()).is_ok());
}

#[test]
fn rejects_stale_schema_contract_and_component_catalog_versions() {
    let mut value = draft();
    value.schema_version = 2;
    value.application_contract = "stale-contract".into();
    value.component_catalog_version = 6;
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    for code in [
        "unsupported_schema_version",
        "application_contract_mismatch",
        "component_catalog_mismatch",
    ] {
        assert!(
            errors.iter().any(|error| error.code == code),
            "missing diagnostic {code}"
        );
    }
}

#[test]
fn denied_fields_are_rejected_in_both_collection_and_detail() {
    let mut restricted = catalog();
    restricted.capabilities[0].fields = vec!["id".into()];
    let errors = validate_module_draft(&draft(), &restricted, &limits()).unwrap_err();
    for node_index in [0, 1] {
        assert!(errors
            .iter()
            .any(|error| error.code == "field_not_available"
                && error.path == format!("pages[0].nodes[{node_index}].fields[1]")));
    }
}

#[test]
fn returns_structured_errors_for_limits_and_catalog() {
    let mut value = draft();
    value.pages[0].nodes[0] = PageNode::Collection(crate::models::CollectionNode {
        id: "receivables".into(),
        slot: SemanticSlot::Secondary,
        component: ComponentReference {
            id: "missing".into(),
            version: 9,
        },
        resource: "unknown".into(),
        fields: vec!["bad".into()],
        page_size: 101,
    });
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    assert!(errors
        .iter()
        .any(|error| error.code == "component_not_approved"));
    if let PageNode::Collection(collection) = &mut value.pages[0].nodes[0] {
        collection.component = ComponentReference {
            id: "collection".into(),
            version: 1,
        };
    }
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    assert!(errors
        .iter()
        .any(|error| error.code == "slot_not_permitted"));
    assert!(errors
        .iter()
        .any(|error| error.code == "resource_not_available"));
    assert!(errors
        .iter()
        .any(|error| error.code == "page_size_not_allowed"));
}

#[test]
fn validates_field_shape_and_page_size_even_when_resource_is_unknown() {
    let mut value = draft();
    if let PageNode::Collection(collection) = &mut value.pages[0].nodes[0] {
        collection.resource = "unknown".into();
        collection.fields = vec!["id".into(), "id".into(), "".into()];
        collection.page_size = 101;
    }
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    assert!(errors.iter().any(|error| error.code == "duplicate_field"));
    assert!(errors.iter().any(|error| error.code == "empty_field"));
    assert!(errors
        .iter()
        .any(|error| error.code == "page_size_not_allowed"));
}

#[test]
fn detail_must_reference_collection_on_same_page() {
    let mut value = draft();
    if let PageNode::Detail(detail) = &mut value.pages[0].nodes[1] {
        detail.source_node_id = "missing".into();
    }
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    assert!(errors
        .iter()
        .any(|error| error.code == "detail_source_not_collection"));
}

#[test]
fn detail_may_precede_its_collection_source() {
    let mut value = draft();
    let collection = value.pages[0].nodes.remove(0);
    value.pages[0].nodes.push(collection);
    assert!(validate_module_draft(&value, &catalog(), &limits()).is_ok());
}

#[test]
fn rejects_invalid_identifiers_and_base_revisions() {
    let mut value = draft();
    value.module_id = "Collections".into();
    value.pages[0].id = "home_page".into();
    value.pages[0].nodes[0] = match value.pages[0].nodes[0].clone() {
        PageNode::Collection(mut node) => {
            node.id = "Receivables".into();
            PageNode::Collection(node)
        }
        node => node,
    };
    value.base_revision = Some("01".into());
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    assert!(
        errors
            .iter()
            .filter(|error| error.code == "invalid_identifier")
            .count()
            >= 3
    );
    assert!(errors
        .iter()
        .any(|error| error.code == "invalid_base_revision"));
}

#[test]
fn enforces_collection_primary_and_detail_secondary_slots() {
    let mut value = draft();
    if let PageNode::Collection(collection) = &mut value.pages[0].nodes[0] {
        collection.slot = SemanticSlot::Secondary;
    }
    if let PageNode::Detail(detail) = &mut value.pages[0].nodes[1] {
        detail.slot = SemanticSlot::Primary;
    }
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    assert!(errors
        .iter()
        .any(|error| error.code == "collection_slot_not_primary"));
    assert!(errors
        .iter()
        .any(|error| error.code == "detail_slot_not_secondary"));
}

#[test]
fn rejects_component_kind_mismatch() {
    let mut value = draft();
    if let PageNode::Collection(collection) = &mut value.pages[0].nodes[0] {
        collection.component.id = "detail".into();
    }
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    assert!(errors
        .iter()
        .any(|error| error.code == "component_kind_mismatch"));
}

#[test]
fn rejects_duplicates_and_budget() {
    let mut value = draft();
    value.pages.push(value.pages[0].clone());
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    assert!(errors.iter().any(|error| error.code == "duplicate_page_id"));
    let duplicate = value.pages[0].nodes[0].clone();
    value.pages[0].nodes.push(duplicate);
    let errors = validate_module_draft(&value, &catalog(), &limits()).unwrap_err();
    assert!(errors.iter().any(|error| error.code == "duplicate_node_id"));
}

#[test]
fn strict_wire_json_rejects_unknown_privilege_field() {
    let mut json = serde_json::to_value(draft()).unwrap();
    json["privilege"] = serde_json::json!("admin");
    assert!(serde_json::from_value::<ModuleDraft>(json).is_err());
}

#[test]
fn malformed_json_is_rejected() {
    assert!(serde_json::from_str::<ModuleDraft>("{not-json").is_err());
}

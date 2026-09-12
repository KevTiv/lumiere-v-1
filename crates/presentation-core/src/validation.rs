use std::collections::{HashMap, HashSet};

use crate::models::{
    ApprovedCapabilityMetadata, ApprovedComponentMetadata, ComponentKind, DetailNode, ModuleDraft,
    PageNode, ValidationDiagnostic,
};

/// Resource and size limits applied to a module draft.
#[derive(Clone, Debug)]
pub struct ValidationLimits {
    /// Maximum number of pages.
    pub max_pages: usize,
    /// Maximum nodes per page.
    pub max_nodes_per_page: usize,
    /// Maximum fields exposed by one node.
    pub max_fields_per_node: usize,
    /// Maximum collection page size.
    pub max_page_size: u16,
    /// Maximum collection read bindings in the module.
    pub max_read_bindings: usize,
    /// Maximum identifier length in Unicode scalar values.
    pub max_id_length: usize,
    /// Maximum title length in Unicode scalar values.
    pub max_title_length: usize,
}

/// Actor-filtered component and capability metadata used for validation.
#[derive(Clone, Debug)]
pub struct ValidationCatalog {
    /// Pinned application-contract identifier.
    pub application_contract: String,
    /// Pinned component catalog revision.
    pub component_catalog_version: u32,
    /// Components permitted for this actor and organization.
    pub components: Vec<ApprovedComponentMetadata>,
    /// Resources and fields permitted for this actor and organization.
    pub capabilities: Vec<ApprovedCapabilityMetadata>,
}

/// Validate a module draft against an already actor-filtered catalog.
///
/// This function performs structural and compatibility checks only. It does not
/// authenticate the caller, grant capabilities, query a database, or infer
/// business semantics from the submitted payload.
pub fn validate_module_draft(
    draft: &ModuleDraft,
    catalog: &ValidationCatalog,
    limits: &ValidationLimits,
) -> Result<(), Vec<ValidationDiagnostic>> {
    let mut errors = Vec::new();
    if draft.schema_version != 1 {
        error(
            &mut errors,
            "schemaVersion",
            "unsupported_schema_version",
            "schema version must be 1",
        );
    }
    if draft.application_contract != catalog.application_contract {
        error(
            &mut errors,
            "applicationContract",
            "application_contract_mismatch",
            "application contract is not the approved pin",
        );
    }
    if draft.component_catalog_version != catalog.component_catalog_version {
        error(
            &mut errors,
            "componentCatalogVersion",
            "component_catalog_mismatch",
            "component catalog version is not the approved pin",
        );
    }
    validate_text(
        &mut errors,
        "moduleId",
        &draft.module_id,
        limits.max_id_length,
        true,
    );
    validate_text(
        &mut errors,
        "title",
        &draft.title,
        limits.max_title_length,
        true,
    );
    validate_slug(&mut errors, "moduleId", &draft.module_id);
    if let Some(revision) = draft.base_revision.as_deref() {
        if revision == "0" || revision.starts_with('0') || revision.parse::<u64>().is_err() {
            error(
                &mut errors,
                "baseRevision",
                "invalid_base_revision",
                "base revision must be a positive decimal u64",
            );
        }
    }
    if draft.pages.len() > limits.max_pages {
        error(
            &mut errors,
            "pages",
            "page_limit_exceeded",
            "module exceeds the page limit",
        );
    }

    let components: HashMap<(&str, u32), &ApprovedComponentMetadata> = catalog
        .components
        .iter()
        .map(|component| ((component.id.as_str(), component.version), component))
        .collect();
    let capabilities: HashMap<&str, &ApprovedCapabilityMetadata> = catalog
        .capabilities
        .iter()
        .map(|capability| (capability.resource.as_str(), capability))
        .collect();
    let mut read_bindings = 0usize;
    let mut page_ids = HashSet::new();

    for (page_index, page) in draft.pages.iter().enumerate() {
        let page_path = format!("pages[{page_index}]");
        validate_text(
            &mut errors,
            &format!("{page_path}.id"),
            &page.id,
            limits.max_id_length,
            true,
        );
        validate_text(
            &mut errors,
            &format!("{page_path}.title"),
            &page.title,
            limits.max_title_length,
            true,
        );
        validate_slug(&mut errors, &format!("{page_path}.id"), &page.id);
        if !page_ids.insert(page.id.as_str()) {
            error(
                &mut errors,
                &format!("{page_path}.id"),
                "duplicate_page_id",
                "page id is duplicated",
            );
        }
        if page.nodes.len() > limits.max_nodes_per_page {
            error(
                &mut errors,
                &format!("{page_path}.nodes"),
                "node_limit_exceeded",
                "page exceeds the node limit",
            );
        }
        let mut node_ids = HashSet::new();
        let collections: HashMap<&str, &crate::models::CollectionNode> = page
            .nodes
            .iter()
            .filter_map(|node| match node {
                PageNode::Collection(collection) => Some((collection.id.as_str(), collection)),
                PageNode::Detail(_) => None,
            })
            .collect();
        for (node_index, node) in page.nodes.iter().enumerate() {
            let path = format!("{page_path}.nodes[{node_index}]");
            let (id, component, slot, fields, resource, page_size) = match node {
                PageNode::Collection(node) => (
                    node.id.as_str(),
                    &node.component,
                    &node.slot,
                    &node.fields,
                    Some(node.resource.as_str()),
                    Some(node.page_size),
                ),
                PageNode::Detail(node) => (
                    node.id.as_str(),
                    &node.component,
                    &node.slot,
                    &node.fields,
                    None,
                    None,
                ),
            };
            validate_text(
                &mut errors,
                &format!("{path}.id"),
                id,
                limits.max_id_length,
                true,
            );
            if !node_ids.insert(id) {
                error(
                    &mut errors,
                    &format!("{path}.id"),
                    "duplicate_node_id",
                    "node id is duplicated",
                );
            }
            validate_slug(&mut errors, &format!("{path}.id"), id);
            match node {
                PageNode::Collection(_)
                    if !matches!(slot, crate::models::SemanticSlot::Primary) =>
                {
                    error(
                        &mut errors,
                        &format!("{path}.slot"),
                        "collection_slot_not_primary",
                        "collection nodes must use the primary slot",
                    )
                }
                PageNode::Detail(_) if !matches!(slot, crate::models::SemanticSlot::Secondary) => {
                    error(
                        &mut errors,
                        &format!("{path}.slot"),
                        "detail_slot_not_secondary",
                        "detail nodes must use the secondary slot",
                    )
                }
                _ => {}
            }
            if fields.len() > limits.max_fields_per_node {
                error(
                    &mut errors,
                    &format!("{path}.fields"),
                    "field_limit_exceeded",
                    "node exceeds the field limit",
                );
            }
            validate_fields(&mut errors, &format!("{path}.fields"), fields);
            if let Some(page_size) = page_size {
                if page_size == 0 || page_size > limits.max_page_size {
                    error(
                        &mut errors,
                        &format!("{path}.pageSize"),
                        "page_size_not_allowed",
                        "page size is outside the approved limit",
                    );
                }
            }
            let Some(approved) = components.get(&(component.id.as_str(), component.version)) else {
                error(
                    &mut errors,
                    &format!("{path}.component"),
                    "component_not_approved",
                    "component version is not approved",
                );
                continue;
            };
            if !approved
                .slots
                .iter()
                .any(|approved_slot| same_slot(approved_slot, slot))
            {
                error(
                    &mut errors,
                    &format!("{path}.slot"),
                    "slot_not_permitted",
                    "component cannot be placed in this slot",
                );
            }
            let expected_kind = match node {
                PageNode::Collection(_) => ComponentKind::Collection,
                PageNode::Detail(_) => ComponentKind::Detail,
            };
            if approved.kind != expected_kind {
                error(
                    &mut errors,
                    &format!("{path}.component"),
                    "component_kind_mismatch",
                    "component kind does not match the node kind",
                );
            }
            if let Some(resource) = resource {
                read_bindings += 1;
                if read_bindings > limits.max_read_bindings {
                    error(
                        &mut errors,
                        &format!("{path}.resource"),
                        "read_budget_exceeded",
                        "module exceeds the read binding budget",
                    );
                }
                let Some(capability) = capabilities.get(resource) else {
                    error(
                        &mut errors,
                        &format!("{path}.resource"),
                        "resource_not_available",
                        "resource is not available in the approved catalog",
                    );
                    continue;
                };
                for (field_index, field) in fields.iter().enumerate() {
                    if !capability
                        .fields
                        .iter()
                        .any(|approved_field| approved_field == field)
                    {
                        error(
                            &mut errors,
                            &format!("{path}.fields[{field_index}]"),
                            "field_not_available",
                            "field is not available for the resource",
                        );
                    }
                }
            }
            if let PageNode::Detail(detail) = node {
                validate_detail(&mut errors, &path, detail, &collections, &capabilities);
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn validate_detail(
    errors: &mut Vec<ValidationDiagnostic>,
    path: &str,
    detail: &DetailNode,
    collections: &HashMap<&str, &crate::models::CollectionNode>,
    capabilities: &HashMap<&str, &ApprovedCapabilityMetadata>,
) {
    let Some(collection) = collections.get(detail.source_node_id.as_str()) else {
        error(
            errors,
            &format!("{path}.sourceNodeId"),
            "detail_source_not_collection",
            "detail source must resolve to a collection on this page",
        );
        return;
    };
    let Some(capability) = capabilities.get(collection.resource.as_str()) else {
        return;
    };
    for (field_index, field) in detail.fields.iter().enumerate() {
        if !capability
            .fields
            .iter()
            .any(|approved_field| approved_field == field)
        {
            error(
                errors,
                &format!("{path}.fields[{field_index}]"),
                "field_not_available",
                "field is not available for the detail source",
            );
        }
    }
}

fn same_slot(left: &crate::models::SemanticSlot, right: &crate::models::SemanticSlot) -> bool {
    matches!(
        (left, right),
        (
            crate::models::SemanticSlot::Primary,
            crate::models::SemanticSlot::Primary
        ) | (
            crate::models::SemanticSlot::Secondary,
            crate::models::SemanticSlot::Secondary
        )
    )
}

fn validate_text(
    errors: &mut Vec<ValidationDiagnostic>,
    path: &str,
    value: &str,
    max: usize,
    required: bool,
) {
    if required && value.trim().is_empty() {
        error(errors, path, "empty_value", "value must not be empty");
    }
    if value.chars().count() > max {
        error(
            errors,
            path,
            "value_too_long",
            "value exceeds the length limit",
        );
    }
}

fn validate_slug(errors: &mut Vec<ValidationDiagnostic>, path: &str, value: &str) {
    if value.is_empty()
        || value
            .chars()
            .any(|ch| !(ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-'))
        || value.starts_with('-')
        || value.ends_with('-')
        || value.contains("--")
    {
        error(
            errors,
            path,
            "invalid_identifier",
            "identifier must be lowercase hyphenated alphanumeric text",
        );
    }
}

fn validate_fields(errors: &mut Vec<ValidationDiagnostic>, path: &str, fields: &[String]) {
    let mut seen = HashSet::new();
    for (index, field) in fields.iter().enumerate() {
        let field_path = format!("{path}[{index}]");
        if field.trim().is_empty() {
            error(
                errors,
                &field_path,
                "empty_field",
                "field must not be empty",
            );
        }
        if !seen.insert(field.as_str()) {
            error(
                errors,
                &field_path,
                "duplicate_field",
                "field is duplicated",
            );
        }
    }
}

fn error(errors: &mut Vec<ValidationDiagnostic>, path: &str, code: &str, message: &str) {
    errors.push(ValidationDiagnostic {
        path: path.to_owned(),
        code: code.to_owned(),
        message: message.to_owned(),
    });
}

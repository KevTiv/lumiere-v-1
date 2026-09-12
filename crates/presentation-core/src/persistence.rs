use std::collections::HashMap;

use crate::models::{
    ApprovedCapabilityMetadata, ApprovedComponentMetadata, ComponentKind, ModuleDraft, PageNode,
    SemanticSlot,
};
use crate::validation::{validate_module_draft, ValidationCatalog, ValidationLimits};

const MAX_DRAFT_BYTES: usize = 64 * 1024;

/// A validated draft payload prepared for a persistence envelope.
///
/// This preparation performs structural validation only. It does not authenticate an actor,
/// authorize resources, certify application pins, or establish ownership. The persistence layer
/// must store the revision separately from `definition_json`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparedDraft {
    /// Stable module slug used as the persistence lookup key.
    pub module_key: String,
    /// Canonical JSON for the complete definition with `baseRevision` set to null.
    pub definition_json: String,
    /// Definition schema version.
    pub schema_version: u32,
    /// Application-contract pin carried by the definition.
    pub application_contract: String,
    /// Component-catalog pin carried by the definition.
    pub component_catalog_version: u32,
}

/// Parse and structurally validate a draft before it is placed in a persistence envelope.
pub fn prepare_saved_draft(
    definition_json: &str,
    expected_revision: Option<u64>,
) -> Result<PreparedDraft, String> {
    if definition_json.len() > MAX_DRAFT_BYTES {
        return Err("definition exceeds the 64 KiB limit".into());
    }
    let mut definition: ModuleDraft = serde_json::from_str(definition_json)
        .map_err(|error| format!("invalid module definition: {error}"))?;
    if definition.schema_version != 1 {
        return Err("schemaVersion must be 1".into());
    }
    if definition.component_catalog_version != 1 {
        return Err("componentCatalogVersion must be 1".into());
    }
    if definition.application_contract.trim().is_empty()
        || definition.application_contract.chars().count() > 160
    {
        return Err("applicationContract must be non-empty and at most 160 characters".into());
    }
    if !revision_matches(definition.base_revision.as_deref(), expected_revision) {
        return Err("baseRevision does not match the expected revision".into());
    }

    let catalog = structural_catalog(&definition);
    validate_module_draft(&definition, &catalog, &limits())
        .map_err(|diagnostics| format!("invalid module definition: {diagnostics:?}"))?;

    definition.base_revision = None;
    let definition_json = serde_json::to_string(&definition)
        .map_err(|error| format!("failed to encode module definition: {error}"))?;
    if definition_json.len() > MAX_DRAFT_BYTES {
        return Err("canonical definition exceeds the 64 KiB limit".into());
    }
    Ok(PreparedDraft {
        module_key: definition.module_id.clone(),
        schema_version: definition.schema_version,
        application_contract: definition.application_contract.clone(),
        component_catalog_version: definition.component_catalog_version,
        definition_json,
    })
}

fn revision_matches(base_revision: Option<&str>, expected_revision: Option<u64>) -> bool {
    match (base_revision, expected_revision) {
        (None, None) => true,
        (Some(base), Some(expected)) => base == expected.to_string(),
        _ => false,
    }
}

fn structural_catalog(definition: &ModuleDraft) -> ValidationCatalog {
    let mut capability_fields: HashMap<&str, Vec<String>> = HashMap::new();
    for page in &definition.pages {
        let collection_resources: HashMap<&str, &str> = page
            .nodes
            .iter()
            .filter_map(|node| match node {
                PageNode::Collection(collection) => {
                    Some((collection.id.as_str(), collection.resource.as_str()))
                }
                PageNode::Detail(_) => None,
            })
            .collect();
        for node in &page.nodes {
            let (resource, fields_to_add) = match node {
                PageNode::Collection(collection) => {
                    (Some(collection.resource.as_str()), &collection.fields)
                }
                PageNode::Detail(detail) => (
                    collection_resources
                        .get(detail.source_node_id.as_str())
                        .copied(),
                    &detail.fields,
                ),
            };
            if let Some(resource) = resource {
                let fields = capability_fields.entry(resource).or_default();
                for field in fields_to_add {
                    if !fields.contains(field) {
                        fields.push(field.clone());
                    }
                }
            }
        }
    }
    ValidationCatalog {
        application_contract: definition.application_contract.clone(),
        component_catalog_version: 1,
        components: vec![
            ApprovedComponentMetadata {
                id: "erp.collection".into(),
                kind: ComponentKind::Collection,
                version: 1,
                slots: vec![SemanticSlot::Primary],
            },
            ApprovedComponentMetadata {
                id: "erp.detail".into(),
                kind: ComponentKind::Detail,
                version: 1,
                slots: vec![SemanticSlot::Secondary],
            },
        ],
        capabilities: capability_fields
            .into_iter()
            .map(|(resource, fields)| ApprovedCapabilityMetadata {
                resource: resource.into(),
                fields,
            })
            .collect(),
    }
}

fn limits() -> ValidationLimits {
    ValidationLimits {
        max_pages: 8,
        max_nodes_per_page: 16,
        max_fields_per_node: 32,
        max_page_size: 100,
        max_read_bindings: 16,
        max_id_length: 64,
        max_title_length: 160,
    }
}

#[cfg(test)]
mod tests {
    use super::prepare_saved_draft;
    use serde_json::{json, Value};

    fn draft() -> Value {
        json!({
            "schemaVersion": 1,
            "moduleId": "collections",
            "title": "Collections",
            "applicationContract": "contracts-v1",
            "componentCatalogVersion": 1,
            "pages": [
                {"id": "home", "title": "Home", "nodes": [
                    {"kind": "collection", "id": "entries", "slot": "primary", "component": {"id": "erp.collection", "version": 1}, "resource": "account-moves", "fields": ["id", "name"], "pageSize": 25},
                    {"kind": "detail", "id": "entry-detail", "slot": "secondary", "component": {"id": "erp.detail", "version": 1}, "sourceNodeId": "entries", "fields": ["id", "amount"]}
                ]},
                {"id": "archive", "title": "Archive", "nodes": []}
            ]
        })
    }

    #[test]
    fn preserves_multi_page_semantics_and_clears_base_revision() {
        let mut value = draft();
        value["baseRevision"] = json!("7");
        let prepared =
            prepare_saved_draft(&serde_json::to_string(&value).unwrap(), Some(7)).unwrap();
        let stored: Value = serde_json::from_str(&prepared.definition_json).unwrap();
        assert_eq!(stored["pages"].as_array().unwrap().len(), 2);
        assert_eq!(stored["pages"][0]["nodes"].as_array().unwrap().len(), 2);
        assert!(stored["baseRevision"].is_null());
        let mut normalized: crate::models::ModuleDraft = serde_json::from_value(value).unwrap();
        normalized.base_revision = None;
        assert_eq!(
            prepared.definition_json,
            serde_json::to_string(&normalized).unwrap()
        );
    }

    #[test]
    fn rejects_unknown_attributes_malformed_and_oversized_payloads() {
        let mut unknown = draft();
        unknown["privilege"] = json!("admin");
        assert!(prepare_saved_draft(&serde_json::to_string(&unknown).unwrap(), None).is_err());
        assert!(prepare_saved_draft("{bad", None).is_err());
        assert!(prepare_saved_draft(
            &format!(
                "{}{}",
                serde_json::to_string(&draft()).unwrap(),
                " ".repeat(64 * 1024)
            ),
            None
        )
        .is_err());
    }

    #[test]
    fn rejects_stale_revision_and_noncanonical_pins() {
        let mut stale = draft();
        stale["baseRevision"] = json!("7");
        assert!(prepare_saved_draft(&serde_json::to_string(&stale).unwrap(), Some(8)).is_err());
        assert!(prepare_saved_draft(&serde_json::to_string(&draft()).unwrap(), Some(7)).is_err());
        stale["baseRevision"] = json!("07");
        assert!(prepare_saved_draft(&serde_json::to_string(&stale).unwrap(), Some(7)).is_err());
    }

    #[test]
    fn canonical_bytes_are_stable_and_complete() {
        let input = serde_json::to_string(&draft()).unwrap();
        let first = prepare_saved_draft(&input, None).unwrap();
        let second = prepare_saved_draft(&first.definition_json, None).unwrap();
        assert_eq!(first.definition_json, second.definition_json);
        assert_eq!(first.module_key, "collections");
        assert_eq!(first.application_contract, "contracts-v1");
    }
}

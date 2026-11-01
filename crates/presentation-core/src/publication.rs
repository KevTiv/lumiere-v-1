//! Publication and placement transitions over immutable saved module versions.
//!
//! The storage/API owner supplies the current actor-filtered catalogue and
//! checks identity, company membership and publication permission. These pure
//! functions grant no authority and perform no I/O or program execution.
//! These internal planning values deliberately have no Serde implementation.
//! Future HTTP contracts must encode u64 identities/revisions as validated
//! decimal strings, as the existing saved-draft wire contracts do.

use crate::{validate_module_draft, ModuleDraft, ValidationCatalog, ValidationLimits};

/// Immutable identity that a publication and its placements must pin exactly.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicationVersion {
    /// Owning module's database identity.
    pub module_id: u64,
    /// Exact immutable module version, never a latest-version selector.
    pub version_id: u64,
    /// Immutable version revision.
    pub revision: u64,
    /// Lowercase SHA-256 digest of the stored canonical definition.
    pub definition_hash: String,
}

/// Current placement projection. Immutable events remain its history owner.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PublicationPlacement {
    /// Compare-and-swap generation, initially zero.
    pub generation: u64,
    /// Explicitly active published immutable version.
    pub active_version_id: Option<u64>,
    /// Prior active version available for explicit reversion.
    pub previous_version_id: Option<u64>,
}

/// A bounded action on an existing module placement.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PublicationAction {
    /// Activate a separately published exact version.
    Activate { version_id: u64 },
    /// Return to the prior active version, after fresh authorization/validation.
    Revert { version_id: u64 },
    /// Stop displaying this placement without erasing publication history.
    Disable,
}

/// Stable expected outcomes retained by persistence and transport owners.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PublicationError {
    /// A malformed or mismatching immutable reference was supplied.
    InvalidVersion,
    /// The reviewed draft head is no longer current.
    StaleDraft,
    /// Stored definition bytes do not match their immutable digest.
    DefinitionHashMismatch,
    /// The current actor's catalogue no longer admits the definition.
    DefinitionUnavailable,
    /// Another placement command won the compare-and-swap race.
    StalePlacement,
    /// An unchanged placement requires receipt reconciliation, not a new event.
    AlreadyActive,
    /// Reversion must name the recorded prior active version.
    InvalidRevert,
    /// No generation can be allocated without overflow.
    GenerationExhausted,
}

/// Validate publication against the exact saved bytes and a fresh trusted catalogue.
///
/// `actual_hash` must be computed from stored canonical bytes by the persistence
/// owner, never taken from the client. The same validation is required before
/// delivering an activated version; a historical publication is not access.
pub fn validate_publication(
    version: &PublicationVersion,
    definition: &ModuleDraft,
    actual_hash: &str,
    expected_head: u64,
    actual_head: u64,
    catalog: &ValidationCatalog,
    limits: &ValidationLimits,
) -> Result<(), PublicationError> {
    if expected_head == 0 || expected_head != actual_head || version.revision != actual_head {
        return Err(PublicationError::StaleDraft);
    }
    validate_published_definition(version, definition, actual_hash, catalog, limits)
}

/// Revalidate a historical published version before activation or delivery.
///
/// Unlike a new publication, this does not require the version to be the latest
/// draft head: reversion pins an older immutable version deliberately.
pub fn validate_published_definition(
    version: &PublicationVersion,
    definition: &ModuleDraft,
    actual_hash: &str,
    catalog: &ValidationCatalog,
    limits: &ValidationLimits,
) -> Result<(), PublicationError> {
    if version.module_id == 0
        || version.version_id == 0
        || version.revision == 0
        || version.definition_hash.len() != 64
        || !version
            .definition_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(PublicationError::InvalidVersion);
    }
    if version.definition_hash != actual_hash {
        return Err(PublicationError::DefinitionHashMismatch);
    }
    validate_module_draft(definition, catalog, limits)
        .map_err(|_| PublicationError::DefinitionUnavailable)
}

/// Plan one exact CAS placement change; persist it and its receipt atomically.
///
/// Activate/revert callers must first prove that the target is published under
/// this module and current scope and validate its definition afresh. Receipt
/// replay belongs before this function but after current authorization.
pub fn plan_publication_placement(
    current: &PublicationPlacement,
    expected_generation: u64,
    action: &PublicationAction,
) -> Result<PublicationPlacement, PublicationError> {
    if current.active_version_id == Some(0)
        || current.previous_version_id == Some(0)
        || (current.generation == 0
            && (current.active_version_id.is_some() || current.previous_version_id.is_some()))
        || (current.active_version_id.is_some()
            && current.active_version_id == current.previous_version_id)
    {
        return Err(PublicationError::InvalidVersion);
    }
    if current.generation != expected_generation {
        return Err(PublicationError::StalePlacement);
    }
    let target = match *action {
        PublicationAction::Activate { version_id } => {
            if version_id == 0 {
                return Err(PublicationError::InvalidVersion);
            }
            Some(version_id)
        }
        PublicationAction::Revert { version_id } => {
            if version_id == 0 || current.previous_version_id != Some(version_id) {
                return Err(PublicationError::InvalidRevert);
            }
            Some(version_id)
        }
        PublicationAction::Disable => None,
    };
    if target == current.active_version_id {
        return Err(PublicationError::AlreadyActive);
    }
    Ok(PublicationPlacement {
        generation: current
            .generation
            .checked_add(1)
            .ok_or(PublicationError::GenerationExhausted)?,
        active_version_id: target,
        previous_version_id: current.active_version_id.or(current.previous_version_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition() -> ModuleDraft {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1, "moduleId": "collections", "title": "Collections",
            "applicationContract": "contracts-v1", "componentCatalogVersion": 1,
            "pages": [{"id": "home", "title": "Home", "nodes": [{
                "kind": "collection", "id": "entries", "slot": "primary",
                "component": {"id": "erp.collection", "version": 1},
                "resource": "entries", "fields": ["id"], "pageSize": 10
            }]}]
        }))
        .unwrap()
    }

    fn catalog() -> ValidationCatalog {
        ValidationCatalog {
            application_contract: "contracts-v1".into(),
            component_catalog_version: 1,
            components: vec![crate::ApprovedComponentMetadata {
                id: "erp.collection".into(),
                version: 1,
                kind: crate::ComponentKind::Collection,
                slots: vec![crate::SemanticSlot::Primary],
            }],
            capabilities: vec![crate::ApprovedCapabilityMetadata {
                resource: "entries".into(),
                fields: vec!["id".into()],
            }],
        }
    }

    fn limits() -> ValidationLimits {
        ValidationLimits {
            max_pages: 2,
            max_nodes_per_page: 4,
            max_fields_per_node: 4,
            max_page_size: 100,
            max_read_bindings: 4,
            max_id_length: 64,
            max_title_length: 160,
        }
    }

    fn version() -> PublicationVersion {
        PublicationVersion {
            module_id: 1,
            version_id: 7,
            revision: 2,
            definition_hash: "a".repeat(64),
        }
    }

    #[test]
    fn publish_requires_exact_reviewed_head_and_persisted_hash() {
        let version = version();
        assert_eq!(
            validate_publication(
                &version,
                &definition(),
                &version.definition_hash,
                2,
                2,
                &catalog(),
                &limits()
            ),
            Ok(())
        );
        assert_eq!(
            validate_publication(
                &version,
                &definition(),
                &version.definition_hash,
                2,
                3,
                &catalog(),
                &limits()
            ),
            Err(PublicationError::StaleDraft)
        );
        assert_eq!(
            validate_publication(
                &version,
                &definition(),
                &"b".repeat(64),
                2,
                2,
                &catalog(),
                &limits()
            ),
            Err(PublicationError::DefinitionHashMismatch)
        );
    }

    #[test]
    fn old_published_version_revalidates_against_current_access_and_pins() {
        let version = version();
        assert!(validate_published_definition(
            &version,
            &definition(),
            &version.definition_hash,
            &catalog(),
            &limits()
        )
        .is_ok());
        let mut revoked = catalog();
        revoked.capabilities.clear();
        assert_eq!(
            validate_published_definition(
                &version,
                &definition(),
                &version.definition_hash,
                &revoked,
                &limits()
            ),
            Err(PublicationError::DefinitionUnavailable)
        );
        let mut changed = catalog();
        changed.application_contract = "contracts-v2".into();
        assert_eq!(
            validate_published_definition(
                &version,
                &definition(),
                &version.definition_hash,
                &changed,
                &limits()
            ),
            Err(PublicationError::DefinitionUnavailable)
        );
    }

    #[test]
    fn competing_commands_reject_the_losing_generation() {
        let first = plan_publication_placement(
            &PublicationPlacement::default(),
            0,
            &PublicationAction::Activate { version_id: 7 },
        )
        .unwrap();
        assert_eq!(
            plan_publication_placement(&first, 0, &PublicationAction::Activate { version_id: 8 }),
            Err(PublicationError::StalePlacement)
        );
        assert_eq!(first.active_version_id, Some(7));
    }

    #[test]
    fn revert_uses_recorded_history_and_disable_does_not_erase_it() {
        let current = PublicationPlacement {
            generation: 2,
            active_version_id: Some(9),
            previous_version_id: Some(7),
        };
        assert_eq!(
            plan_publication_placement(&current, 2, &PublicationAction::Revert { version_id: 8 }),
            Err(PublicationError::InvalidRevert)
        );
        let reverted =
            plan_publication_placement(&current, 2, &PublicationAction::Revert { version_id: 7 })
                .unwrap();
        assert_eq!(reverted.previous_version_id, Some(9));
        let disabled =
            plan_publication_placement(&reverted, 3, &PublicationAction::Disable).unwrap();
        assert_eq!(disabled.active_version_id, None);
        assert_eq!(disabled.previous_version_id, Some(7));
    }

    #[test]
    fn repeated_commands_require_receipts_and_generations_cannot_wrap() {
        let state = PublicationPlacement {
            generation: u64::MAX,
            active_version_id: Some(4),
            previous_version_id: None,
        };
        assert_eq!(
            plan_publication_placement(
                &state,
                u64::MAX,
                &PublicationAction::Activate { version_id: 4 }
            ),
            Err(PublicationError::AlreadyActive)
        );
        assert_eq!(
            plan_publication_placement(&state, u64::MAX, &PublicationAction::Disable),
            Err(PublicationError::GenerationExhausted)
        );
    }
}

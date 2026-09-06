//! Server-owned organization execution placement and cell-move fencing.
//!
//! An organization has one authoritative execution cell at a time.  The
//! placement generation is a fencing token: workers and cells must present
//! the generation they resolved before a placement-sensitive operation can
//! be finalized.  This module deliberately contains logical identifiers only;
//! host names, credentials, and connection pools remain deployment details.
//!
//! The move coordinator chooses the destination from its server-owned cell
//! catalog.  There is no destination cell, durable store, or generation
//! argument on [`PlacementController::move_organization`].  This is the
//! boundary that prevents an HTTP/client caller from steering an organization
//! to an arbitrary cell or store.

use std::collections::BTreeMap;
use std::fmt;

use serde::Serialize;

/// The initial logical execution cell.
pub const INITIAL_CELL_ID: &str = "cell-primary-eu";
/// The initial logical durable store.
pub const INITIAL_DURABLE_STORE_ID: &str = "pg-primary";

/// A validated logical execution-cell identifier.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
pub struct CellId(String);

impl CellId {
    /// Construct a logical cell identifier.
    pub fn new(value: impl Into<String>) -> Result<Self, PlacementError> {
        let value = value.into();
        validate_identifier("cell", &value)?;
        Ok(Self(value))
    }

    /// Return the logical identifier.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CellId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A validated logical durable-store identifier.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
pub struct DurableStoreId(String);

impl DurableStoreId {
    /// Construct a logical durable-store identifier.
    pub fn new(value: impl Into<String>) -> Result<Self, PlacementError> {
        let value = value.into();
        validate_identifier("durable store", &value)?;
        Ok(Self(value))
    }

    /// Return the logical identifier.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DurableStoreId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// The organization lifecycle independent of billing-provider state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum OrganizationLifecycle {
    /// Initial organization provisioning.
    Provisioning,
    /// Normal business execution is permitted.
    Active,
    /// Entitlement grace period; retention is preserved.
    GracePeriod,
    /// Ordinary execution is suspended; durable state is retained.
    Suspended,
    /// Not resident in an active cell; recoverable from durable state.
    Archived,
    /// Recovery/migration is in progress; ordinary execution is fenced.
    Reactivating,
}

impl OrganizationLifecycle {
    /// Whether this lifecycle permits ordinary business execution.
    #[must_use]
    pub fn permits_business_execution(self) -> bool {
        matches!(self, Self::Active | Self::GracePeriod)
    }

    fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Provisioning, Self::Active)
                | (Self::Provisioning, Self::GracePeriod)
                | (Self::Active, Self::GracePeriod)
                | (Self::Active, Self::Suspended)
                | (Self::GracePeriod, Self::Active)
                | (Self::GracePeriod, Self::Suspended)
                | (Self::Suspended, Self::Archived)
                | (Self::Suspended, Self::Reactivating)
                | (Self::Archived, Self::Reactivating)
                | (Self::Reactivating, Self::Active)
        )
    }
}

/// The monotonically increasing fencing generation for an organization.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct PlacementGeneration(u64);

impl PlacementGeneration {
    /// The first generation assigned during server-side onboarding.
    pub const INITIAL: Self = Self(1);

    /// Construct a non-zero generation.
    pub fn new(value: u64) -> Result<Self, PlacementError> {
        if value == 0 {
            return Err(PlacementError::InvalidGeneration);
        }
        Ok(Self(value))
    }

    /// Return the numeric generation.
    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }

    fn next(self) -> Result<Self, PlacementError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or(PlacementError::GenerationExhausted)
    }
}

/// The canonical server-owned placement record.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct OrganizationPlacement {
    organization_id: u64,
    cell_id: CellId,
    generation: PlacementGeneration,
    lifecycle: OrganizationLifecycle,
    durable_store: DurableStoreId,
}

/// Trusted lookup boundary used by routing, durable access, and workers.
///
/// Implementations own the placement records; callers can resolve an
/// organization but cannot provide a replacement cell, store, or generation.
pub trait OrganizationPlacementResolver {
    /// Resolve the current authoritative placement for an organization.
    fn resolve(&self, organization_id: u64) -> Result<&OrganizationPlacement, PlacementError>;
}

impl OrganizationPlacement {
    /// Build the initial server-derived placement for a new organization.
    pub fn initial(organization_id: u64) -> Result<Self, PlacementError> {
        if organization_id == 0 {
            return Err(PlacementError::InvalidOrganization);
        }
        Ok(Self {
            organization_id,
            cell_id: CellId::new(INITIAL_CELL_ID)?,
            generation: PlacementGeneration::INITIAL,
            lifecycle: OrganizationLifecycle::Provisioning,
            durable_store: DurableStoreId::new(INITIAL_DURABLE_STORE_ID)?,
        })
    }

    /// Construct a recovery target from trusted server configuration.
    ///
    /// This is crate-visible so HTTP and client input types cannot construct a
    /// placement or choose a fencing generation.
    pub(crate) fn reconstruction_target(
        organization_id: u64,
        cell_id: CellId,
        generation: PlacementGeneration,
        durable_store: DurableStoreId,
    ) -> Result<Self, PlacementError> {
        if organization_id == 0 {
            return Err(PlacementError::InvalidOrganization);
        }
        Ok(Self {
            organization_id,
            cell_id,
            generation,
            lifecycle: OrganizationLifecycle::Reactivating,
            durable_store,
        })
    }

    /// Return the organization governed by this placement.
    #[must_use]
    pub const fn organization_id(&self) -> u64 {
        self.organization_id
    }

    /// Return the server-selected execution cell.
    #[must_use]
    pub fn cell_id(&self) -> &CellId {
        &self.cell_id
    }

    /// Return the current fencing generation.
    #[must_use]
    pub const fn generation(&self) -> PlacementGeneration {
        self.generation
    }

    /// Return the current lifecycle.
    #[must_use]
    pub const fn lifecycle(&self) -> OrganizationLifecycle {
        self.lifecycle
    }

    /// Return the server-selected durable store.
    #[must_use]
    pub fn durable_store(&self) -> &DurableStoreId {
        &self.durable_store
    }
}

/// The durable checkpoint established before target materialization.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DurableCheckpoint {
    pub organization_id: u64,
    pub source_generation: PlacementGeneration,
    pub sequence: u64,
    pub commit_checksum: String,
}

impl DurableCheckpoint {
    fn validate_for(&self, placement: &OrganizationPlacement) -> Result<(), PlacementError> {
        if self.organization_id != placement.organization_id
            || self.source_generation != placement.generation
            || self.sequence == 0
            || !is_sha256_checksum(&self.commit_checksum)
        {
            return Err(PlacementError::CheckpointMismatch);
        }
        Ok(())
    }
}

/// Evidence that the target cell has been materialized and checked.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TargetVerification {
    pub organization_id: u64,
    pub target_cell: CellId,
    pub target_store: DurableStoreId,
    pub target_generation: PlacementGeneration,
    pub sequence: u64,
    pub state_checksum: String,
}

impl TargetVerification {
    fn validate(
        &self,
        placement: &OrganizationPlacement,
        target: &CellTarget,
        checkpoint: &DurableCheckpoint,
    ) -> Result<(), PlacementError> {
        if self.organization_id != placement.organization_id
            || self.target_cell != target.cell_id
            || self.target_store != target.durable_store
            || self.target_generation != placement.generation.next()?
            || self.sequence != checkpoint.sequence
            || !is_sha256_checksum(&self.state_checksum)
        {
            return Err(PlacementError::VerificationMismatch);
        }
        Ok(())
    }
}

/// A server-configured destination.  It is not accepted by the move method;
/// the controller selects one from its private destination catalog.
#[derive(Clone, Debug, Eq, PartialEq)]
struct CellTarget {
    cell_id: CellId,
    durable_store: DurableStoreId,
}

/// Errors raised by placement resolution or a fenced move.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PlacementError {
    InvalidOrganization,
    InvalidIdentifier(&'static str),
    InvalidGeneration,
    GenerationExhausted,
    OrganizationAlreadyExists,
    OrganizationNotFound,
    DestinationUnavailable,
    LifecycleTransition {
        from: OrganizationLifecycle,
        to: OrganizationLifecycle,
    },
    CheckpointMismatch,
    VerificationMismatch,
    StaleGeneration {
        expected: PlacementGeneration,
        provided: PlacementGeneration,
    },
    BusinessExecutionFenced(OrganizationLifecycle),
}

impl fmt::Display for PlacementError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidOrganization => f.write_str("organization id must be non-zero"),
            Self::InvalidIdentifier(kind) => write!(f, "{kind} id has an invalid shape"),
            Self::InvalidGeneration => f.write_str("placement generation must be non-zero"),
            Self::GenerationExhausted => f.write_str("placement generation is exhausted"),
            Self::OrganizationAlreadyExists => f.write_str("organization placement already exists"),
            Self::OrganizationNotFound => f.write_str("organization placement was not found"),
            Self::DestinationUnavailable => {
                f.write_str("no compatible placement destination is available")
            }
            Self::LifecycleTransition { from, to } => write!(
                f,
                "invalid organization lifecycle transition: {from:?} -> {to:?}"
            ),
            Self::CheckpointMismatch => {
                f.write_str("durable checkpoint does not match the current placement")
            }
            Self::VerificationMismatch => {
                f.write_str("target verification does not match the current move")
            }
            Self::StaleGeneration { expected, provided } => write!(
                f,
                "stale placement generation: expected {}, provided {}",
                expected.get(),
                provided.get()
            ),
            Self::BusinessExecutionFenced(lifecycle) => {
                write!(
                    f,
                    "ordinary organization execution is fenced in {lifecycle:?} lifecycle"
                )
            }
        }
    }
}

impl std::error::Error for PlacementError {}

/// Driver for the external checkpoint/materialize/verify work.
///
/// The driver receives the destination selected by the trusted controller,
/// while callers of the controller never provide that destination.
pub trait PlacementMigrationDriver {
    /// Establish a durable cut/checkpoint from the current cell.
    fn checkpoint(
        &mut self,
        placement: &OrganizationPlacement,
    ) -> Result<DurableCheckpoint, PlacementError>;
    /// Materialize the target's working set at the checkpoint.
    fn materialize(
        &mut self,
        target: &OrganizationPlacement,
        checkpoint: &DurableCheckpoint,
    ) -> Result<(), PlacementError>;
    /// Verify hashes/counts/invariants on the materialized target.
    fn verify(
        &mut self,
        target: &OrganizationPlacement,
        checkpoint: &DurableCheckpoint,
    ) -> Result<TargetVerification, PlacementError>;
}

/// Result of a successful server-controlled placement flip.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PlacementMove {
    pub organization_id: u64,
    pub source: OrganizationPlacement,
    pub target: OrganizationPlacement,
    pub checkpoint: DurableCheckpoint,
}

/// The trusted organization placement resolver and move coordinator.
#[derive(Debug)]
pub struct PlacementController {
    placements: BTreeMap<u64, OrganizationPlacement>,
    destinations: Vec<CellTarget>,
}

impl PlacementController {
    /// Create a controller with the initial logical cell and server-owned
    /// destination catalog.  The catalog is infrastructure configuration, not
    /// request data.
    pub fn new(destinations: Vec<(CellId, DurableStoreId)>) -> Result<Self, PlacementError> {
        if destinations.is_empty() {
            return Err(PlacementError::DestinationUnavailable);
        }
        let destinations = destinations
            .into_iter()
            .map(|(cell_id, durable_store)| CellTarget {
                cell_id,
                durable_store,
            })
            .collect();
        Ok(Self {
            placements: BTreeMap::new(),
            destinations,
        })
    }

    /// Construct the initial one-cell deployment catalog.
    pub fn bootstrap() -> Result<Self, PlacementError> {
        Self::new(vec![(
            CellId::new(INITIAL_CELL_ID)?,
            DurableStoreId::new(INITIAL_DURABLE_STORE_ID)?,
        )])
    }

    /// Register a newly onboarded organization at the server-selected initial
    /// destination.  No placement fields are accepted from the caller.
    pub fn onboard(
        &mut self,
        organization_id: u64,
    ) -> Result<OrganizationPlacement, PlacementError> {
        if self.placements.contains_key(&organization_id) {
            return Err(PlacementError::OrganizationAlreadyExists);
        }
        let target = self
            .destinations
            .first()
            .ok_or(PlacementError::DestinationUnavailable)?;
        let mut placement = OrganizationPlacement::initial(organization_id)?;
        placement.cell_id = target.cell_id.clone();
        placement.durable_store = target.durable_store.clone();
        self.placements.insert(organization_id, placement.clone());
        Ok(placement)
    }

    /// Resolve the authoritative current placement.
    pub fn resolve(&self, organization_id: u64) -> Result<&OrganizationPlacement, PlacementError> {
        self.placements
            .get(&organization_id)
            .ok_or(PlacementError::OrganizationNotFound)
    }

    /// Transition lifecycle through the server-owned state machine.
    pub fn transition_lifecycle(
        &mut self,
        organization_id: u64,
        next: OrganizationLifecycle,
    ) -> Result<OrganizationPlacement, PlacementError> {
        let placement = self
            .placements
            .get_mut(&organization_id)
            .ok_or(PlacementError::OrganizationNotFound)?;
        if !placement.lifecycle.can_transition_to(next) {
            return Err(PlacementError::LifecycleTransition {
                from: placement.lifecycle,
                to: next,
            });
        }
        placement.lifecycle = next;
        Ok(placement.clone())
    }

    /// Move an organization using checkpoint → materialize → verify →
    /// generation increment → placement flip.  The destination is selected by
    /// the server from the configured catalog; it is intentionally not an
    /// argument to this method.
    pub fn move_organization<D: PlacementMigrationDriver>(
        &mut self,
        organization_id: u64,
        driver: &mut D,
    ) -> Result<PlacementMove, PlacementError> {
        let source = self.placements.get(&organization_id).cloned();
        let result = self.move_organization_inner(organization_id, driver);
        if result.is_err() {
            // A failed checkpoint/materialization/verification must never
            // leave the organization stranded in Reactivating.  The source
            // placement remains authoritative until the verified flip.
            if let Some(source) = source {
                self.placements.insert(organization_id, source);
            }
        }
        result
    }

    fn move_organization_inner<D: PlacementMigrationDriver>(
        &mut self,
        organization_id: u64,
        driver: &mut D,
    ) -> Result<PlacementMove, PlacementError> {
        let source = self.resolve(organization_id)?.clone();
        if !source.lifecycle.permits_business_execution() {
            return Err(PlacementError::LifecycleTransition {
                from: source.lifecycle,
                to: OrganizationLifecycle::Reactivating,
            });
        }
        let target = self
            .destinations
            .iter()
            .find(|target| target.cell_id != source.cell_id)
            .ok_or(PlacementError::DestinationUnavailable)?
            .clone();
        let target_generation = source.generation.next()?;
        let planned_target = OrganizationPlacement {
            organization_id,
            cell_id: target.cell_id.clone(),
            generation: target_generation,
            lifecycle: OrganizationLifecycle::Reactivating,
            durable_store: target.durable_store.clone(),
        };
        // Fence ordinary writes before establishing the cut.  The exact
        // source generation remains attached to the checkpoint so an old
        // worker cannot finalize after a later flip.
        let mut fenced_source = source.clone();
        fenced_source.lifecycle = OrganizationLifecycle::Reactivating;
        self.placements
            .insert(organization_id, fenced_source.clone());
        let checkpoint = driver.checkpoint(&fenced_source)?;
        checkpoint.validate_for(&source)?;
        driver.materialize(&planned_target, &checkpoint)?;
        let verification = driver.verify(&planned_target, &checkpoint)?;
        verification.validate(&fenced_source, &target, &checkpoint)?;
        let mut target_placement = planned_target;
        target_placement.lifecycle = OrganizationLifecycle::Active;
        self.placements
            .insert(organization_id, target_placement.clone());
        Ok(PlacementMove {
            organization_id,
            source,
            target: target_placement,
            checkpoint,
        })
    }

    /// Validate a worker/cell operation against the current generation.
    pub fn require_current_generation(
        &self,
        organization_id: u64,
        provided: PlacementGeneration,
    ) -> Result<(), PlacementError> {
        let expected = self.resolve(organization_id)?.generation;
        if expected != provided {
            return Err(PlacementError::StaleGeneration { expected, provided });
        }
        let lifecycle = self.resolve(organization_id)?.lifecycle;
        if !lifecycle.permits_business_execution() {
            return Err(PlacementError::BusinessExecutionFenced(lifecycle));
        }
        Ok(())
    }
}

impl OrganizationPlacementResolver for PlacementController {
    fn resolve(&self, organization_id: u64) -> Result<&OrganizationPlacement, PlacementError> {
        self.resolve(organization_id)
    }
}

fn validate_identifier(kind: &'static str, value: &str) -> Result<(), PlacementError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(PlacementError::InvalidIdentifier(kind));
    }
    Ok(())
}

fn is_sha256_checksum(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Driver {
        events: Vec<String>,
        wrong_generation: bool,
        wrong_target: bool,
        wrong_organization: bool,
    }

    impl PlacementMigrationDriver for Driver {
        fn checkpoint(
            &mut self,
            placement: &OrganizationPlacement,
        ) -> Result<DurableCheckpoint, PlacementError> {
            if placement.lifecycle != OrganizationLifecycle::Reactivating {
                return Err(PlacementError::BusinessExecutionFenced(placement.lifecycle));
            }
            self.events.push("checkpoint".into());
            Ok(DurableCheckpoint {
                organization_id: placement.organization_id,
                source_generation: placement.generation,
                sequence: 42,
                commit_checksum: "a".repeat(64),
            })
        }

        fn materialize(
            &mut self,
            target: &OrganizationPlacement,
            _: &DurableCheckpoint,
        ) -> Result<(), PlacementError> {
            self.events.push(format!(
                "materialize:{}:{}",
                target.cell_id,
                target.generation.get()
            ));
            Ok(())
        }

        fn verify(
            &mut self,
            target: &OrganizationPlacement,
            checkpoint: &DurableCheckpoint,
        ) -> Result<TargetVerification, PlacementError> {
            self.events.push(format!(
                "verify:{}:{}",
                target.cell_id,
                target.generation.get()
            ));
            Ok(TargetVerification {
                organization_id: if self.wrong_organization {
                    target.organization_id + 1
                } else {
                    target.organization_id
                },
                target_cell: CellId::new(if self.wrong_target {
                    "cell-unexpected"
                } else {
                    target.cell_id.as_str()
                })?,
                target_store: target.durable_store.clone(),
                target_generation: if self.wrong_generation {
                    PlacementGeneration::new(99)?
                } else {
                    target.generation
                },
                sequence: checkpoint.sequence,
                state_checksum: "b".repeat(64),
            })
        }
    }

    fn controller() -> PlacementController {
        PlacementController::new(vec![
            (
                CellId::new("cell-primary-eu").unwrap(),
                DurableStoreId::new("pg-primary").unwrap(),
            ),
            (
                CellId::new("cell-secondary-eu").unwrap(),
                DurableStoreId::new("pg-secondary").unwrap(),
            ),
        ])
        .unwrap()
    }

    #[test]
    fn move_uses_server_destination_and_flips_generation_after_verification() {
        let mut controller = controller();
        let initial = controller.onboard(7).unwrap();
        assert_eq!(initial.generation, PlacementGeneration::INITIAL);
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Active)
            .unwrap();
        let mut driver = Driver {
            events: Vec::new(),
            wrong_generation: false,
            wrong_target: false,
            wrong_organization: false,
        };
        let moved = controller.move_organization(7, &mut driver).unwrap();
        assert_eq!(
            driver.events,
            [
                "checkpoint",
                "materialize:cell-secondary-eu:2",
                "verify:cell-secondary-eu:2"
            ]
        );
        assert_eq!(moved.source.cell_id.as_str(), "cell-primary-eu");
        assert_eq!(moved.target.cell_id.as_str(), "cell-secondary-eu");
        assert_eq!(moved.target.durable_store.as_str(), "pg-secondary");
        assert_eq!(moved.target.generation.get(), 2);
        assert_eq!(controller.resolve(7).unwrap(), &moved.target);
        let evidence = serde_json::to_value(&moved).unwrap();
        assert_eq!(evidence["organization_id"], 7);
        assert_eq!(evidence["source"]["generation"], 1);
        assert_eq!(evidence["target"]["generation"], 2);
        assert_eq!(evidence["target"]["cell_id"], "cell-secondary-eu");
    }

    #[test]
    fn stale_generation_is_rejected_after_flip() {
        let mut controller = controller();
        let initial = controller.onboard(7).unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Active)
            .unwrap();
        let mut driver = Driver {
            events: Vec::new(),
            wrong_generation: false,
            wrong_target: false,
            wrong_organization: false,
        };
        controller.move_organization(7, &mut driver).unwrap();
        let error = controller
            .require_current_generation(7, initial.generation)
            .expect_err("old cell generation must be fenced");
        assert_eq!(
            error,
            PlacementError::StaleGeneration {
                expected: PlacementGeneration::new(2).unwrap(),
                provided: PlacementGeneration::INITIAL,
            }
        );
    }

    #[test]
    fn repeated_moves_increment_generation_monotonically() {
        let mut controller = controller();
        controller.onboard(7).unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Active)
            .unwrap();
        let mut first = Driver {
            events: Vec::new(),
            wrong_generation: false,
            wrong_target: false,
            wrong_organization: false,
        };
        let generation_two = controller.move_organization(7, &mut first).unwrap().target;
        let mut second = Driver {
            events: Vec::new(),
            wrong_generation: false,
            wrong_target: false,
            wrong_organization: false,
        };
        assert_eq!(generation_two.generation.get(), 2);
        let generation_three = controller.move_organization(7, &mut second).unwrap().target;
        assert_eq!(generation_three.cell_id.as_str(), "cell-primary-eu");
        assert_eq!(generation_three.durable_store.as_str(), "pg-primary");
        assert_eq!(generation_three.generation.get(), 3);
        assert_eq!(
            controller.require_current_generation(7, generation_two.generation),
            Err(PlacementError::StaleGeneration {
                expected: generation_three.generation,
                provided: generation_two.generation,
            })
        );
    }

    #[test]
    fn lifecycle_fence_rejects_current_generation_during_reactivation() {
        let mut controller = controller();
        let initial = controller.onboard(7).unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Active)
            .unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Suspended)
            .unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Reactivating)
            .unwrap();
        assert_eq!(
            controller.require_current_generation(7, initial.generation),
            Err(PlacementError::BusinessExecutionFenced(
                OrganizationLifecycle::Reactivating
            ))
        );
    }

    #[test]
    fn failed_target_verification_does_not_flip_placement() {
        let mut controller = controller();
        controller.onboard(7).unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Active)
            .unwrap();
        let initial = controller.resolve(7).unwrap().clone();
        let mut driver = Driver {
            events: Vec::new(),
            wrong_generation: true,
            wrong_target: false,
            wrong_organization: false,
        };
        assert!(matches!(
            controller.move_organization(7, &mut driver),
            Err(PlacementError::VerificationMismatch)
        ));
        assert_eq!(controller.resolve(7).unwrap(), &initial);
    }

    #[test]
    fn wrong_target_verification_does_not_flip_or_leak_store() {
        let mut controller = controller();
        controller.onboard(7).unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Active)
            .unwrap();
        let initial = controller.resolve(7).unwrap().clone();
        let mut driver = Driver {
            events: Vec::new(),
            wrong_generation: false,
            wrong_target: true,
            wrong_organization: false,
        };
        assert!(matches!(
            controller.move_organization(7, &mut driver),
            Err(PlacementError::VerificationMismatch)
        ));
        let current = controller.resolve(7).unwrap();
        assert_eq!(current, &initial);
        assert_eq!(current.durable_store.as_str(), "pg-primary");
    }

    #[test]
    fn cross_organization_verification_does_not_flip_placement() {
        let mut controller = controller();
        controller.onboard(7).unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Active)
            .unwrap();
        let initial = controller.resolve(7).unwrap().clone();
        let mut driver = Driver {
            events: Vec::new(),
            wrong_generation: false,
            wrong_target: false,
            wrong_organization: true,
        };
        assert!(matches!(
            controller.move_organization(7, &mut driver),
            Err(PlacementError::VerificationMismatch)
        ));
        assert_eq!(controller.resolve(7).unwrap(), &initial);
    }

    #[test]
    fn lifecycle_rejects_activation_from_archived_without_reactivation() {
        let mut controller = controller();
        controller.onboard(7).unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Active)
            .unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Suspended)
            .unwrap();
        controller
            .transition_lifecycle(7, OrganizationLifecycle::Archived)
            .unwrap();
        assert!(matches!(
            controller.transition_lifecycle(7, OrganizationLifecycle::Active),
            Err(PlacementError::LifecycleTransition { .. })
        ));
        assert_eq!(
            controller.resolve(7).unwrap().lifecycle,
            OrganizationLifecycle::Archived
        );
    }

    #[test]
    fn identifiers_and_generations_are_validated() {
        assert!(CellId::new("cell/other").is_err());
        assert!(DurableStoreId::new("").is_err());
        assert!(PlacementGeneration::new(0).is_err());
    }

    #[test]
    fn onboarding_cannot_reset_an_existing_generation() {
        let mut controller = controller();
        controller.onboard(7).unwrap();
        assert_eq!(
            controller.onboard(7),
            Err(PlacementError::OrganizationAlreadyExists)
        );
        assert_eq!(
            controller.resolve(7).unwrap().generation,
            PlacementGeneration::INITIAL
        );
    }
}

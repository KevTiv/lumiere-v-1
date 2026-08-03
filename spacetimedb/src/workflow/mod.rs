pub mod action_registry;
/// Workflow Engine Module — Definitions and runtime execution
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **Workflow** | Workflow definitions attached to ERP models |
/// | **WorkflowVersion** | Immutable published workflow content |
/// | **WorkflowNode** | Version-pinned typed workflow node |
/// | **WorkflowEdge** | Version-pinned typed workflow edge |
/// | **WorkflowCalendarVersion** | Immutable local-working-time rules |
/// | **WorkflowInstance** | Runtime instances bound to ERP records |
/// | **WorkflowToken** | Revisioned execution tokens within a running instance |
/// | **WorkflowDecisionEvent** | Append-only runtime and authorization evidence |
/// | **WorkflowSimulationResult** | Deterministic side-effect-free simulation output |
/// | **WorkflowDelegation** | Effective-dated approval delegation evidence |
pub mod approval_gate;
pub mod approvals;
pub mod authorization;
pub mod branches;
pub mod calendar;
pub mod definitions;
pub mod delivery;
pub mod evaluator;
pub mod migration;
pub mod packs;
pub mod runtime;
pub mod simulation;

pub use action_registry::*;
pub use approval_gate::*;
pub use approvals::*;
pub use authorization::*;
pub use branches::*;
pub use calendar::*;
pub use definitions::*;
pub use delivery::*;
pub use evaluator::*;
pub use migration::*;
pub use packs::*;
pub use runtime::*;
pub use simulation::*;

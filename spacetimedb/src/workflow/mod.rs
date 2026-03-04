/// Workflow Engine Module — Definitions and runtime execution
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **Workflow** | Workflow definitions attached to ERP models |
/// | **WorkflowActivity** | Individual steps within a workflow |
/// | **WorkflowTransition** | Edges connecting activities with conditions |
/// | **WorkflowInstance** | Runtime instances bound to ERP records |
/// | **WorkflowWorkitem** | Active work items within a running instance |
pub mod definitions;
pub mod runtime;

pub use definitions::*;
pub use runtime::*;

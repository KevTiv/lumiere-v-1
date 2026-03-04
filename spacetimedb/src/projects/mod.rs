/// Projects Module — Project management, tasks, and timesheets
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectProject** | Project definitions |
/// | **ProjectTask** | Tasks within projects |
/// | **ProjectTimesheet** | Time logs against tasks and projects |
pub mod projects;
pub mod tasks;
pub mod timesheets;

pub use projects::*;
pub use tasks::*;
pub use timesheets::*;

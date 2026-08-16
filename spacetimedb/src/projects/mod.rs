/// Projects Module — Project management, tasks, and timesheets
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **ProjectProject** | Project definitions |
/// | **ProjectTask** | Tasks within projects |
/// | **ProjectTimesheet** | Time logs against tasks and projects |
/// | **ProjectTimesheetApproval** | Append-only validate/reject/reopen decisions |
/// | **ProjectRateCard** / **ProjectRateCardLine** | PSA rate cards for cost/sell resolution |
/// | **WorkingCalendar** / **PublicHoliday** / **ResourceAllocation** | Capacity |
/// | **ResourceCapacitySnapshot** | Materialised remaining capacity |
/// | **ProjectMilestone** | Delivery milestones |
/// | **ProjectMarginSnapshot** | Live project margin |
/// | **ResourceUtilisationSnapshot** | Available vs billable hours |
/// | **CapacityForecastSnapshot** / **ProjectChangeOrder** / **ProjectEarnedValueSnapshot** | Wave E |
/// | **ProjectSubcontractorCost** / **ProjectRevenueSchedule** / **ProjectIntegrationIntent** | Wave E |
pub mod capacity;
pub mod milestones;
pub mod project_accounting;
pub mod projects;
pub mod psa_advanced;
pub mod rate_cards;
pub mod task_stages;
pub mod tasks;
pub mod timesheets;

pub use capacity::*;
pub use milestones::*;
pub use project_accounting::*;
pub use projects::*;
pub use psa_advanced::*;
pub use rate_cards::*;
pub use task_stages::*;
pub use tasks::*;
pub use timesheets::*;

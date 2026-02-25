/// Shared SpacetimeType enums used across multiple domain modules.
///
/// Rule: only put types here that are referenced by MORE THAN ONE domain module.
/// Types used exclusively within one domain live in that domain's file.
use spacetimedb::SpacetimeType;

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum JobStatus {
    Pending,
    Processing,
    Completed,
    Failed,
    Scheduled,
}

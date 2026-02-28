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

// Integration-related enums used across multiple integration providers

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum IntegrationType {
    GoogleDrive,
    OneDrive,
    Dropbox,
    WhatsAppBusiness,
    Slack,
    MicrosoftTeams,
    Zoom,
    Other,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SyncStatus {
    Connected,
    Disconnected,
    Syncing,
    Error,
    PendingAuth,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum IntegrationStatus {
    Active,
    Inactive,
    Pending,
    Suspended,
}

// Inventory-related enums used across multiple modules

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ProductType {
    Product,
    Service,
    Consumable,
    Storable,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum StockMoveState {
    Draft,
    Waiting,
    Confirmed,
    Assigned,
    Done,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PickingState {
    Draft,
    Waiting,
    Confirmed,
    Assigned,
    Done,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum LocationUsage {
    Supplier,
    View,
    Internal,
    Customer,
    Inventory,
    Production,
    Transit,
    Scrap,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum QualityState {
    None,
    Pass,
    Fail,
    Partial,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SerialState {
    Free,
    Reserved,
    InUse,
    Blocked,
    Expired,
}

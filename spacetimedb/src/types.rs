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

// Sales & POS related enums used across multiple modules

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SaleState {
    Draft,
    Sent,
    Sale,
    Done,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum LineState {
    Draft,
    Confirmed,
    Done,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum InvoiceStatus {
    NoInvoice,
    ToInvoice,
    Invoiced,
    UpsellingOpportunity,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum LineInvoiceStatus {
    ToInvoice,
    Invoiced,
    No,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SessionState {
    NewSession,
    OpeningControl,
    Opened,
    ClosingControl,
    Closed,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PosOrderState {
    Draft,
    Paid,
    Done,
    Invoiced,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PaymentStatus {
    Pending,
    Done,
    Reversed,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PaymentMethodType {
    Cash,
    Bank,
    Card,
    DigitalWallet,
    LoyaltyPoints,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum CardState {
    New,
    Active,
    Expired,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum BatchState {
    Draft,
    InProgress,
    Done,
    Cancelled,
}

// Purchasing & Supply Chain enums

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PoState {
    Draft,
    Sent,
    ToApprove,
    Purchase,
    Done,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PoInvoiceStatus {
    No,
    Partial,
    Invoiced,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum RequisitionState {
    Draft,
    Sent,
    InProgress,
    Approved,
    Cancelled,
    Closed,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum IntakeState {
    Draft,
    Submitted,
    UnderReview,
    Approved,
    Rejected,
    OnHold,
    Onboarded,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum LandedCostState {
    Draft,
    Posted,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SplitMethod {
    Equal,
    ByQuantity,
    ByCurrentCost,
    ByWeight,
    ByVolume,
}

// Accounting-related enums

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum AccountTypeInternal {
    Receivable,
    Payable,
    Liquidity,
    Asset,
    Equity,
    Liability,
    Income,
    Expense,
    Other,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum AccountInternalGroup {
    Asset,
    Liability,
    Equity,
    Income,
    Expense,
    Other,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum JournalType {
    Sale,
    Purchase,
    Cash,
    Bank,
    General,
    Inventory,
    Manufacturing,
    PointOfSale,
    Check,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum MoveType {
    Entry,
    OutInvoice,
    OutRefund,
    InInvoice,
    InRefund,
    InternalTransfer,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum AccountMoveState {
    Draft,
    Posted,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PaymentState {
    NotPaid,
    Paid,
    Partial,
    Reversed,
    InvoicingLegacy,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum TaxTypeUse {
    Sale,
    Purchase,
    None,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum TaxAmountType {
    Percent,
    Fixed,
    Division,
    PythonCode,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum TaxDeadlineType {
    Filing,
    Payment,
    Registration,
    Report,
    Renewal,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum TaxDeadlineStatus {
    Upcoming,
    DueSoon,
    Overdue,
    Completed,
    Waived,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum BankStatementState {
    Open,
    Posted,
    Cancelled,
    Processing,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum FiscalYearState {
    Draft,
    Running,
    Closed,
    Locked,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum FiscalYearType {
    Standard,
    Adjustment,
    Opening,
    Closing,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum AutoPost {
    No,
    AtDate,
    Monthly,
    Quarterly,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ReconciliationMode {
    Edit,
    Readonly,
    Hidden,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PeriodState {
    Draft,
    Open,
    Closed,
}

// Phase 8: Advanced Accounting & Financials

// Fixed Assets
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum AssetState {
    Draft,
    Running,
    Close,
    Removed,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum AssetType {
    Purchase,
    Sale,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum DepreciationMethod {
    Linear,
    Degressive,
    DegressiveThenLinear,
}

// Budgeting
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum BudgetState {
    Draft,
    Confirm,
    Validate,
    Done,
    Cancel,
}

// Intercompany Transactions
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum IntercompanyState {
    Draft,
    Pending,
    Approved,
    Processing,
    Completed,
    Cancelled,
    Error,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum RuleType {
    Invoice,
    Bill,
    Payment,
    Transfer,
}

// Consolidation
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ConsolidationState {
    Draft,
    InProgress,
    Completed,
    Cancelled,
}

// Financial Statements
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ReportType {
    BalanceSheet,
    ProfitAndLoss,
    CashFlow,
    TrialBalance,
    GeneralLedger,
    AgedReceivable,
    AgedPayable,
    PartnerBalance,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ReportState {
    Draft,
    Generated,
    Exported,
    Archived,
}

// Phase 10: Manufacturing

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum BomType {
    Manufacture,
    Kit,
    Subcontract,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum MoState {
    Draft,
    Confirmed,
    Planned,
    Progress,
    ToClose,
    Done,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum WorkorderState {
    Pending,
    Ready,
    Progress,
    Done,
    Cancel,
}

// Phase 11: Projects

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum TaskState {
    InProgress,
    ChangesRequested,
    Approved,
    Cancelled,
    Done,
}

// Phase 16: Analytics & Reporting

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum WidgetType {
    Chart,
    Table,
    Kpi,
    List,
}

// Phase 14: AI & Business Intelligence

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum InsightSeverity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

// Phase 13: Workflow Engine

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum InstanceState {
    Active,
    Complete,
    Exception,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum WorkitemState {
    Active,
    Complete,
    Exception,
    Dummy,
}

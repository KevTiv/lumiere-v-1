/// Shared SpacetimeType enums used across multiple domain modules.
///
/// Rule: only put types here that are referenced by MORE THAN ONE domain module.
/// Types used exclusively within one domain live in that domain's file.
use spacetimedb::SpacetimeType;

// ============================================================================
// POLICY ENUMS (1.1 — Eliminating Hardcoded Policy Strings)
// ============================================================================

/// Sale order shipping policy — when to trigger delivery
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ShippingPolicy {
    /// Ship each product individually as soon as available
    Direct,
    /// Ship only when all products are ready
    OneMove,
    /// Ship products as they become available (same as Direct)
    ShipOnly,
    /// Send invoice then ship
    InvoiceAndShip,
}

impl ShippingPolicy {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "direct" => Ok(Self::Direct),
            "one_move" => Ok(Self::OneMove),
            "ship_only" => Ok(Self::ShipOnly),
            "invoice_and_ship" => Ok(Self::InvoiceAndShip),
            other => Err(format!(
                "Invalid shipping_policy '{}'. Valid values: direct, one_move, ship_only, invoice_and_ship",
                other
            )),
        }
    }
}

/// Sale order picking policy — how stock moves are grouped
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PickingPolicy {
    /// Create one move per order line
    Direct,
    /// Group all lines into one picking
    OneMove,
}

impl PickingPolicy {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "direct" => Ok(Self::Direct),
            "one_move" => Ok(Self::OneMove),
            other => Err(format!(
                "Invalid picking_policy '{}'. Valid values: direct, one_move",
                other
            )),
        }
    }
}

/// Purchase order quantity copy behavior
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum IsQuantityCopy {
    /// Do not copy quantities
    None,
    /// Copy quantities from reference document
    Copy,
}

impl IsQuantityCopy {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "none" => Ok(Self::None),
            "copy" => Ok(Self::Copy),
            other => Err(format!(
                "Invalid is_quantity_copy '{}'. Valid values: none, copy",
                other
            )),
        }
    }
}

/// Purchase requisition award mode
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ExclusiveMode {
    /// Only one vendor wins the requisition
    Exclusive,
    /// Multiple vendors can be awarded
    Multiple,
}

impl ExclusiveMode {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "exclusive" => Ok(Self::Exclusive),
            "multiple" => Ok(Self::Multiple),
            other => Err(format!(
                "Invalid exclusive mode '{}'. Valid values: exclusive, multiple",
                other
            )),
        }
    }
}

/// Stock move procurement method
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ProcureMethod {
    /// Take from existing stock
    MakeToStock,
    /// Trigger procurement only when needed
    MakeToOrder,
}

impl ProcureMethod {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "make_to_stock" => Ok(Self::MakeToStock),
            "make_to_order" => Ok(Self::MakeToOrder),
            other => Err(format!(
                "Invalid procure_method '{}'. Valid values: make_to_stock, make_to_order",
                other
            )),
        }
    }
}

/// Manufacturing order component consumption strictness
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ConsumptionMode {
    /// Accept any consumed quantity
    Flexible,
    /// Warn when consumed quantity differs from expected
    Warning,
    /// Error when consumed quantity differs from expected
    Strict,
}

impl ConsumptionMode {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "flexible" => Ok(Self::Flexible),
            "warning" => Ok(Self::Warning),
            "strict" => Ok(Self::Strict),
            other => Err(format!(
                "Invalid consumption '{}'. Valid values: flexible, warning, strict",
                other
            )),
        }
    }
}

/// Project billing type
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum BillType {
    /// Bill based on project milestones
    CustomerProject,
    /// Bill based on tasks completed
    CustomerTask,
    /// Project is not billable
    No,
}

impl BillType {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "customer_project" => Ok(Self::CustomerProject),
            "customer_task" => Ok(Self::CustomerTask),
            "no" => Ok(Self::No),
            other => Err(format!(
                "Invalid bill_type '{}'. Valid values: customer_project, customer_task, no",
                other
            )),
        }
    }
}

/// Project pricing type
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PricingType {
    /// Rate per task
    TaskRate,
    /// Fixed rate for the whole project
    FixedRate,
    /// Rate per employee
    EmployeeRate,
}

impl PricingType {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "task_rate" => Ok(Self::TaskRate),
            "fixed_rate" => Ok(Self::FixedRate),
            "employee_rate" => Ok(Self::EmployeeRate),
            other => Err(format!(
                "Invalid pricing_type '{}'. Valid values: task_rate, fixed_rate, employee_rate",
                other
            )),
        }
    }
}

/// Timesheet entry invoice type
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum TimesheetInvoiceType {
    /// Hours will be invoiced to the customer
    Billable,
    /// Hours are not invoiced
    NonBillable,
    /// Hours generate revenue via subscription/recurring
    TimesheetRevenues,
}

impl TimesheetInvoiceType {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "billable" => Ok(Self::Billable),
            "non_billable" => Ok(Self::NonBillable),
            "timesheet_revenues" => Ok(Self::TimesheetRevenues),
            other => Err(format!(
                "Invalid timesheet_invoice_type '{}'. Valid values: billable, non_billable, timesheet_revenues",
                other
            )),
        }
    }

    /// Derive the default from a project's bill_type string
    pub fn default_for_bill_type(bill_type: &str) -> Self {
        match bill_type {
            "customer_task" | "customer_project" => Self::Billable,
            _ => Self::NonBillable,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Billable => "billable",
            Self::NonBillable => "non_billable",
            Self::TimesheetRevenues => "timesheet_revenues",
        }
    }
}

/// Work center operational state
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum WorkingState {
    /// Work center is running normally
    Normal,
    /// Work center is blocked / in maintenance
    Blocked,
    /// Work center has completed its current job
    Done,
}

impl WorkingState {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "normal" => Ok(Self::Normal),
            "blocked" => Ok(Self::Blocked),
            "done" => Ok(Self::Done),
            other => Err(format!(
                "Invalid working_state '{}'. Valid values: normal, blocked, done",
                other
            )),
        }
    }
}

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

// Dangling-ref fixes: Payment Terms
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PaymentTermValue {
    Balance,
    Percent,
    Fixed,
}

// Dangling-ref fixes: Pricelists
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum DiscountPolicy {
    WithDiscount,
    WithoutDiscount,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ComputePrice {
    Fixed,
    Percentage,
    Formula,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PricelistAppliedOn {
    AllProducts,
    Category,
    Product,
}

// Dangling-ref fixes: Payments
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PaymentType {
    InBound,
    OutBound,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PartnerType {
    Customer,
    Supplier,
}

// Dangling-ref fixes: Messaging
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum MailMessageType {
    Comment,
    Note,
    Email,
    Notification,
}

// HR Module
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum EmploymentType {
    FullTime,
    PartTime,
    Contract,
    Intern,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum HrLeaveState {
    Draft,
    Confirm,
    Refused,
    Validated,
    ValidatedOne,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ContractState {
    New,
    Open,
    Expired,
    Cancelled,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum PayslipState {
    Draft,
    Verify,
    Done,
    Cancelled,
}

// Helpdesk Module
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum TicketPriority {
    Low,
    Normal,
    High,
    Urgent,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum HelpdeskTicketState {
    New,
    InProgress,
    OnHold,
    Closed,
    Cancelled,
}

// Expenses Module
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ExpenseState {
    Draft,
    Submitted,
    Approved,
    Posted,
    Done,
    Refused,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ExpenseSheetState {
    Draft,
    Submitted,
    Approved,
    Posted,
    Done,
    Refused,
}

// IoT Module
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum DeviceType {
    BarcodeScanner,
    WeighingScale,
    ReceiptPrinter,
    LabelPrinter,
    CashDrawer,
    TemperatureSensor,
    HumiditySensor,
    RfidReader,
    Camera,
    Plc,
    // Pass 2 additions
    PaymentTerminal,   // card payment terminal (one per hub)
    CustomerDisplay,   // customer-facing screen showing order total
    MeasurementTool,   // calipers, gauge feelers → Quality module
    Footswitch,        // hands-free trigger for manufacturing workorder steps
    Custom,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum DeviceStatus {
    Online,
    Offline,
    Error,
    Pairing,
    /// Hub is reachable but cannot reach SpacetimeDB (no auth / network partition)
    ConnectedNoServer,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SensorUnit {
    Kg,
    Lb,
    Celsius,
    Fahrenheit,
    Percent,
    Count,
    Lux,
    Ppm,
    Bar,
    Volt,
    Amp,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum IoTActionType {
    PrintLabel,
    PrintReceipt,
    OpenCashDrawer,
    DisplayMessage,
    TriggerRelay,
    /// Initiate a card payment: payload = { amount, currency, order_id }
    InitiatePayment,
    Custom,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum IoTActionStatus {
    Pending,
    Sent,
    Acknowledged,
    Failed,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum IoTAlertSeverity {
    Info,
    Warning,
    Critical,
}

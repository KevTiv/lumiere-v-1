/// Accounting Module — Chart of Accounts, Journal Entries, Tax Management, Fiscal Periods, and Advanced Accounting
///
/// # Module Structure
///
/// | Phase | Submodule | Description | Tables |
/// |-------|-----------|-------------|-------|
/// | 7.1 | **chart_of_accounts** | Chart of accounts structure | `AccountAccount`, `AccountAccountType`, `AccountGroup`, `AccountJournal` |
/// | 7.2 | **journal_entries** | Accounting moves and entries | `AccountMove`, `AccountMoveLine` |
/// | 7.3 | **tax_management** | Tax configuration and rules | `AccountTax`, `AccountTaxGroup`, `TaxJurisdiction`, `TaxSchedule` |
/// | 7.4 | **bank_reconciliation** | Bank statements and reconciliation | `AccountBankStatement`, `AccountBankStatementLine`, `AccountReconciliationWidget` |
/// | 7.5 | **fiscal_periods** | Fiscal years and accounting periods | `AccountFiscalYear`, `AccountPeriod` |
/// | 8.1 | **fixed_assets** | Fixed assets and depreciation | `AccountAsset`, `AccountAssetDepreciationLine` |
/// | 8.2 | **budgeting** | Budget management | `CrossoveredBudget`, `CrossoveredBudgetLines`, `BudgetPost` |
/// | 8.3 | **analytic_accounting** | Analytic accounts and lines | `AccountAnalyticAccount`, `AccountAnalyticLine`, `AccountAnalyticDistributionModel` |
/// | 8.4 | **intercompany** | Intercompany transactions | `IntercompanyTransaction`, `IntercompanyRule` |
/// | 8.5 | **consolidation** | Multi-entity consolidation | `ConsolidationAccount`, `ConsolidationJournal`, `ConsolidationEliminationEntry`, `ConsolidationCompanyRate` |
/// | 8.6 | **financial_statements** | Financial reports | `FinancialReport`, `TrialBalance`, `BalanceSheetLine`, `ProfitLossLine`, `CashFlowLine`, `ReportTemplate` |
///
/// # Directory Structure
/// ```
/// accounting/
/// ├── mod.rs                 ← Module exports (this file)
/// ├── chart_of_accounts.rs   ← 7.1 Chart of Accounts
/// ├── journal_entries.rs     ← 7.2 Journal Entries
/// ├── tax_management.rs     ← 7.3 Tax Management
/// ├── bank_reconciliation.rs← 7.4 Bank & Reconciliation
/// ├── fiscal_periods.rs      ← 7.5 Fiscal Periods
/// ├── fixed_assets.rs       ← 8.1 Fixed Assets
/// ├── budgeting.rs          ← 8.2 Budgeting
/// ├── analytic_accounting.rs← 8.3 Analytic Accounting
/// ├── intercompany.rs       ← 8.4 Intercompany Transactions
/// ├── consolidation.rs      ← 8.5 Multi-Entity & Consolidation
/// └── financial_statements.rs← 8.6 Financial Statements
/// ```
pub mod analytic_accounting;
pub mod bank_reconciliation;
pub mod budgeting;
pub mod chart_of_accounts;
pub mod consolidation;
pub mod financial_statements;
pub mod fiscal_periods;
pub mod fixed_assets;
pub mod intercompany;
pub mod journal_entries;
pub mod payment_terms;
pub mod payments;
pub mod tax_management;

// Re-export Phase 7 types
pub use bank_reconciliation::{
    AccountBankStatement, AccountBankStatementLine, AccountReconciliationWidget, BankMatchCandidate,
};
pub use chart_of_accounts::{AccountAccount, AccountAccountType, AccountGroup, AccountJournal};
pub use fiscal_periods::{AccountFiscalYear, AccountPeriod};
pub use journal_entries::{AccountMove, AccountMoveLine};
pub use tax_management::{
    AccountTax, AccountTaxGroup, TaxDeadline, TaxDeadlineReminder, TaxDeadlineStatusJob,
    TaxJurisdiction, TaxSchedule,
};

// Re-export Phase 8 types
pub use analytic_accounting::{
    AccountAnalyticAccount, AccountAnalyticDistributionModel, AccountAnalyticLine,
};
pub use budgeting::{BudgetPost, CrossoveredBudget, CrossoveredBudgetLines};
pub use consolidation::{
    ConsolidationAccount, ConsolidationCompanyRate, ConsolidationEliminationEntry,
    ConsolidationJournal,
};
pub use financial_statements::{
    BalanceSheetLine, CashFlowLine, FinancialReport, ProfitLossLine, ReportTemplate, TrialBalance,
};
pub use fixed_assets::{AccountAsset, AccountAssetDepreciationLine};
pub use intercompany::{IntercompanyRule, IntercompanyTransaction};
pub use payment_terms::{AccountPaymentTerm, AccountPaymentTermLine};
pub use payments::AccountPayment;

/// Data Operations — Phase 15: CSV Import Reducers
///
/// Provides bulk CSV import reducers for all major ERP entities.
/// Each reducer follows the pattern:
///   1. check_permission
///   2. parse_csv
///   3. begin_import_job
///   4. loop: validate row → insert or record_import_error
///   5. finish_import_job
pub mod accounting_imports;
pub mod ai_imports;
pub mod analytics_imports;
pub mod core_imports;
pub mod crm_imports;
pub mod document_imports;
pub mod expenses_imports;
pub mod helpers;
pub mod helpdesk_imports;
pub mod hr_imports;
pub mod import_tracker;
pub mod inventory_imports;
pub mod manufacturing_imports;
pub mod project_imports;
pub mod purchasing_imports;
pub mod sales_imports;
pub mod subscription_imports;
pub mod workflow_imports;

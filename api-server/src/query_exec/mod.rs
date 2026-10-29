//! Execute /v1/query/:resource SQL via stdb-auth resource registry + special cases.
//! Non-registry virtual resources are allowlisted in crates/stdb-auth/assets/query_exec_non_registry.json.

use serde_json::Value;

use crate::error::ApiError;
use stdb_auth::{is_hr_pii_resource, registry_get, resolve_http_sql_columns, FieldAccessContext};
use stdb_client::StdbClient;

mod access_control;
mod accounting;
mod ai;
mod authoritative;
mod company_scope;
mod crm;
mod documents;
mod forms;
mod hr;
mod imports;
mod inventory;
mod messaging;
mod purchasing;
mod registered;
mod row_values;
mod worklists;

use access_control::{
    read_roles, read_user_organization, read_user_roles, require_ui_child_read_permission,
};
use ai::{
    read_ai_action_drafts, read_ai_action_drafts_inbox, read_ai_agent_runs, read_ai_chat_messages,
    read_ai_chat_sessions, read_ai_skill_fixtures, read_ai_skill_releases, read_ai_skill_test_runs,
    read_ai_skill_versions,
};
pub use authoritative::execute_authorized_resource_record;
#[cfg(test)]
pub(crate) use company_scope::enforce_requested_company;
pub(crate) use company_scope::{
    accounting_child_resource, accounting_resource, authorize_membership_company_ids, crm_resource,
    inventory_resource, iot_resource, optional_company_accounting_resource, purchasing_resource,
    resolve_membership_company_id,
};
pub use company_scope::{
    default_company_id, resolve_accounting_company_id, resolve_crm_company_id,
    resolve_inventory_company_id, resolve_iot_company_id, resolve_purchasing_company_id,
    resolve_sales_company_id,
};
use crm::filter_crm_company_rows;
use documents::{read_document_templates, read_mail_templates};
use hr::{maybe_log_hr_pii_read, read_direct_reports, read_employees, read_my_employee};
use messaging::read_queued_mail_messages;
use row_values::row_company_matches;
pub(crate) use row_values::{
    filter_and_strip_soft_deleted, filter_resource_archived_rows, has_iot_read_permission, row_u64,
};

pub async fn execute_resource_query(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
) -> Result<Vec<Value>, ApiError> {
    execute_resource_query_for_company(
        client,
        resource,
        organization_id,
        identity_hex,
        field_access,
        None,
    )
    .await
}

pub async fn execute_resource_query_for_company(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
    requested_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let mut rows = read_resource_query_for_company(
        client,
        resource,
        organization_id,
        identity_hex,
        field_access,
        requested_company_id,
    )
    .await?;
    row_values::preserve_query_timestamp_precision(&mut rows);
    Ok(rows)
}

async fn read_resource_query_for_company(
    client: &StdbClient,
    resource: &str,
    organization_id: u64,
    identity_hex: &str,
    field_access: Option<&FieldAccessContext>,
    requested_company_id: Option<u64>,
) -> Result<Vec<Value>, ApiError> {
    let fa = field_access;
    require_ui_child_read_permission(resource, organization_id, identity_hex, fa)?;
    if iot_resource(resource) && !has_iot_read_permission(fa, resource) {
        return Err(ApiError::Forbidden(format!(
            "Read permission denied for IoT resource '{resource}'"
        )));
    }
    let crm_company_id = if crm_resource(resource) {
        Some(
            resolve_crm_company_id(client, organization_id, identity_hex, requested_company_id)
                .await?,
        )
    } else {
        None
    };
    let inventory_company_id = if inventory_resource(resource) {
        Some(
            resolve_inventory_company_id(
                client,
                organization_id,
                identity_hex,
                requested_company_id,
            )
            .await?,
        )
    } else {
        None
    };
    let purchasing_company_id = if purchasing_resource(resource) {
        Some(
            resolve_purchasing_company_id(
                client,
                organization_id,
                identity_hex,
                requested_company_id,
            )
            .await?,
        )
    } else {
        None
    };
    let accounting_company_id = if accounting_resource(resource)
        || accounting_child_resource(resource)
        || optional_company_accounting_resource(resource)
    {
        Some(
            resolve_accounting_company_id(
                client,
                organization_id,
                identity_hex,
                requested_company_id,
            )
            .await?,
        )
    } else {
        None
    };
    let iot_company_id = if iot_resource(resource) {
        Some(
            resolve_iot_company_id(client, organization_id, identity_hex, requested_company_id)
                .await?,
        )
    } else {
        None
    };

    if accounting_child_resource(resource) {
        return accounting::read_accounting_child_rows(
            client,
            resource,
            organization_id,
            fa,
            accounting_company_id,
        )
        .await;
    }

    if let Some(rows) = crate::workflow_reads::execute_private_workflow_query(
        client,
        resource,
        organization_id,
        identity_hex,
        fa,
    )
    .await?
    {
        return Ok(rows);
    }

    match resource {
        "hr-leave-allocations" | "hr-offboarding-checklists" | "hr-statutory-ids" => {
            return hr::read_hr_child_rows(
                client,
                resource,
                organization_id,
                identity_hex,
                fa,
                requested_company_id,
            )
            .await;
        }
        "document-signature-requests" | "document-legal-holds" | "document-external-refs" => {
            return documents::read_document_child_rows(
                client,
                resource,
                organization_id,
                identity_hex,
                fa,
            )
            .await;
        }
        "roles" => {
            return read_roles(client, organization_id, fa).await;
        }
        "user-roles" => {
            return read_user_roles(client, identity_hex, fa).await;
        }
        "user-organization" => {
            return read_user_organization(client, resource, organization_id, identity_hex, fa)
                .await;
        }
        "ai-chat-sessions" => {
            return read_ai_chat_sessions(client, organization_id, identity_hex).await;
        }
        "ai-chat-messages" => {
            return read_ai_chat_messages(client, organization_id, identity_hex).await;
        }
        "ai-action-drafts" => {
            return read_ai_action_drafts(client, organization_id, identity_hex).await;
        }
        "ai-agent-runs" => {
            return read_ai_agent_runs(client, organization_id).await;
        }
        "ai-skill-versions" => {
            return read_ai_skill_versions(client, organization_id).await;
        }
        "ai-skill-releases" => {
            return read_ai_skill_releases(client, organization_id).await;
        }
        "ai-skill-fixtures" => {
            return read_ai_skill_fixtures(client, organization_id).await;
        }
        "ai-skill-test-runs" => {
            return read_ai_skill_test_runs(client, organization_id, fa).await;
        }
        "ai-action-drafts-inbox" => {
            return read_ai_action_drafts_inbox(client, organization_id).await;
        }
        // Wave 4 DQ / legacy approval keys — served by `workflow_reads` before this match.
        // Arms remain so `lumiere-codegen` query_exec audit stays green.
        "approval-requests-inbox"
        | "approval-requests"
        | "approval-rules"
        | "workflow-human-tasks-inbox"
        | "workflow-human-tasks"
        | "workflow-human-task-events"
        | "workflow-timers-late"
        | "workflow-outbox-dead"
        | "workflow-decision-events"
        | "workflow-migration-plans"
        | "workflow-migration-preflights"
        | "workflow-migration-results"
        | "workflow-subject-snapshots"
        | "workflow-activities"
        | "workflow-transitions"
        | "workflow-workitems" => {
            return Ok(Vec::new());
        }
        "document-templates" => {
            let company_ids = company_scope::resolve_template_company_ids(
                client,
                organization_id,
                identity_hex,
                requested_company_id,
            )
            .await?;
            return read_document_templates(client, organization_id, &company_ids, fa).await;
        }
        "mail-templates" => {
            return read_mail_templates(client, organization_id).await;
        }
        // SpacetimeDB SQL cannot express a NULL/None comparison against an
        // `Option<u64>` column: `IS NULL`/`IS NOT NULL` are rejected outright
        // ("Unsupported expression"), and no literal (`NULL`, `'none'`, `0`,
        // struct-literal syntax) parses as the sum type `(some: U64 | none:
        // ())` either. The erp-org-sql extraWhere for these two resources
        // used to include `AND timesheet_invoice_id IS NULL`, which SpacetimeDB
        // always rejected with a 400 — build the WHERE clause without it and
        // filter the None rows out here instead.
        "timesheets-to-validate" | "timesheets-unbilled" => {
            return worklists::read_timesheets_to_validate(client, resource, organization_id, fa)
                .await;
        }
        "sale-orders-to-approve"
        | "leaves-to-approve"
        | "payslips-to-export"
        | "expense-sheets-to-approve"
        | "expenses-missing-receipt"
        | "expense-policy-exceptions" => {
            return worklists::read_sale_orders_to_approve(client, resource, organization_id, fa)
                .await;
        }
        "purchase-orders-to-approve" => {
            return purchasing::read_purchase_orders_to_approve(
                client,
                resource,
                organization_id,
                fa,
                purchasing_company_id,
            )
            .await;
        }
        "partner-banks" => {
            return purchasing::read_partner_banks(
                client,
                resource,
                organization_id,
                fa,
                purchasing_company_id,
            )
            .await;
        }
        "landed-cost-lines" => {
            return purchasing::read_landed_cost_lines(
                client,
                resource,
                organization_id,
                fa,
                purchasing_company_id,
            )
            .await;
        }
        "queued-mail-messages" => {
            return read_queued_mail_messages(client, organization_id).await;
        }
        "consolidation-accounts" => {
            return accounting::read_consolidation_accounts(client, resource, organization_id, fa)
                .await;
        }
        "consolidation-journals" => {
            return accounting::read_consolidation_journals(client, resource, organization_id, fa)
                .await;
        }
        "consolidation-elimination-entries" => {
            return accounting::read_consolidation_elimination_entries(
                client,
                resource,
                organization_id,
                fa,
                accounting_company_id,
            )
            .await;
        }
        "account-payment-term-lines" => {
            return accounting::read_account_payment_term_lines(client, organization_id, fa).await;
        }
        "account-assets" | "fixed-assets" => {
            return accounting::read_account_assets(client, organization_id, fa).await;
        }
        "depreciation-lines" => {
            return accounting::read_depreciation_lines(client, organization_id, fa).await;
        }
        "intercompany-rules" => {
            return accounting::read_intercompany_rules(client, organization_id, fa).await;
        }
        "intercompany-transactions" => {
            return accounting::read_intercompany_transactions(client, organization_id, fa).await;
        }
        "pos-configs" => {
            return inventory::read_pos_configs(client, organization_id, fa).await;
        }
        "pos-sessions" => {
            return inventory::read_pos_sessions(client, organization_id, fa).await;
        }
        "ai-insights" => {
            return ai::read_ai_insights(client, organization_id, fa).await;
        }
        "ai-document-processing-jobs" => {
            return ai::read_ai_document_processing_jobs(client, organization_id, fa).await;
        }
        "delivery-carriers"
        | "delivery-price-rules"
        | "shipping-methods"
        | "pos-payment-methods" => {
            return inventory::read_delivery_carriers(client, resource, organization_id, fa).await;
        }
        "picking-batches" => {
            return inventory::read_picking_batches(client, resource, fa, inventory_company_id)
                .await;
        }
        "fiscal-years" | "account-periods" => {
            return accounting::read_fiscal_years(client, resource, organization_id, fa).await;
        }
        "import-jobs" => {
            return imports::read_import_jobs(client, organization_id).await;
        }
        "import-job-errors" => {
            return imports::read_import_job_errors(client, organization_id).await;
        }
        "form-config-fields" => {
            return forms::read_form_config_fields(client, organization_id, fa).await;
        }
        "form-role-configs" => {
            return forms::read_form_role_configs(client, organization_id, fa).await;
        }
        "import-mapping-templates" => {
            return imports::read_import_mapping_templates(client, organization_id).await;
        }
        "audit-log" => {
            return access_control::read_audit_log(client, organization_id).await;
        }
        "audit-rules" => {
            return access_control::read_audit_rules(client, organization_id).await;
        }
        "org-permissions" => {
            return access_control::read_org_permissions(client, organization_id).await;
        }
        "field-permissions" => {
            return access_control::read_field_permissions(client, organization_id).await;
        }
        "policy-snapshots" => {
            return access_control::read_policy_snapshots(client, organization_id, identity_hex)
                .await;
        }
        _ => {}
    }

    if resource == "my-employee" {
        return read_my_employee(client, organization_id, identity_hex, fa).await;
    }

    if resource == "direct-reports" {
        return read_direct_reports(client, organization_id, identity_hex, fa).await;
    }

    // H1: org-wide `employees` only for HR roles; others get self row only (same as my-employee).
    if resource == "employees" {
        return read_employees(client, organization_id, identity_hex, fa).await;
    }

    if resource == "document-folders" {
        return documents::read_document_folders(client, organization_id, identity_hex, fa).await;
    }

    if resource == "documents" || resource == "documents-deleted" {
        return documents::read_documents(client, resource, organization_id, identity_hex, fa)
            .await;
    }

    if resource == "document-versions" {
        return documents::read_document_versions(client, organization_id, identity_hex, fa).await;
    }

    let Some(reg) = registry_get(resource) else {
        return Err(ApiError::NotFound(format!(
            "Unknown resource: \"{resource}\""
        )));
    };

    let sql = registered::select_registered_sql(
        resource,
        &reg.table,
        organization_id,
        fa,
        inventory_company_id,
        purchasing_company_id,
        accounting_company_id,
        iot_company_id,
    )?;

    let mut rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;

    if let Some(company_id) = crm_company_id {
        filter_crm_company_rows(client, resource, organization_id, company_id, &mut rows).await?;
    }
    if let Some(company_id) = inventory_company_id {
        inventory::filter_inventory_company_rows(resource, company_id, &mut rows);
    }
    if let Some(company_id) = purchasing_company_id {
        rows.retain(|row| row_company_matches(row, company_id, false));
    }
    if let Some(company_id) = accounting_company_id {
        accounting::filter_accounting_company_rows(resource, company_id, &mut rows);
    }
    if let Some(company_id) = iot_company_id {
        rows.retain(|row| row_company_matches(row, company_id, false));
    }

    if resource == "activities"
        || resource == "companies"
        || resource == "contacts"
        || resource == "contact-phone-identities"
        || resource == "leads"
        || resource == "product-categories"
        || resource == "employees"
        || resource == "my-employee"
        || resource == "direct-reports"
    {
        filter_and_strip_soft_deleted(&mut rows);
    }

    filter_resource_archived_rows(resource, &mut rows);

    registered::sort_registered_rows(resource, &mut rows);

    if is_hr_pii_resource(resource) {
        let cols = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
        let record_id = rows
            .first()
            .and_then(|r| r.get("id").and_then(|v| v.as_u64()))
            .unwrap_or(0);
        maybe_log_hr_pii_read(
            client,
            organization_id,
            resource,
            &reg.table,
            &cols,
            rows.len() as u32,
            record_id,
        )
        .await;
    }

    crm::sort_crm_rows(resource, &mut rows);
    purchasing::sort_purchasing_rows(resource, &mut rows);
    inventory::sort_inventory_rows(resource, &mut rows);

    Ok(rows)
}

#[cfg(test)]
mod tests;

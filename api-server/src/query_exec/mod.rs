//! Execute /v1/query/:resource SQL via stdb-auth resource registry + special cases.
//! Non-registry virtual resources are allowlisted in crates/stdb-auth/assets/query_exec_non_registry.json.

use serde_json::Value;
#[cfg(test)]
use std::collections::HashSet;

use crate::error::ApiError;
use stdb_auth::{
    identity_sql_literal, is_hr_pii_resource, registry_get, resolve_http_sql_columns,
    FieldAccessContext,
};
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

use access_control::{read_roles, read_user_organization, read_user_roles};
use ai::{
    read_ai_action_drafts, read_ai_action_drafts_inbox, read_ai_agent_runs, read_ai_chat_messages,
    read_ai_chat_sessions, read_ai_skill_fixtures, read_ai_skill_releases, read_ai_skill_test_runs,
    read_ai_skill_versions,
};
pub use authoritative::execute_authorized_resource_record;
#[cfg(test)]
use authoritative::{authoritative_record_sql, AuthoritativeResourceScope};
#[cfg(test)]
pub(crate) use company_scope::enforce_requested_company;
pub(crate) use company_scope::{
    accounting_resource, company_ids_for_organization, crm_resource, inventory_resource,
    iot_resource, optional_company_accounting_resource, purchasing_resource,
};
pub use company_scope::{
    default_company_id, resolve_accounting_company_id, resolve_crm_company_id,
    resolve_inventory_company_id, resolve_iot_company_id, resolve_purchasing_company_id,
    resolve_sales_company_id,
};
use crm::filter_crm_company_rows;
#[cfg(test)]
use crm::filter_direct_crm_company_rows;
#[cfg(test)]
use crm::visible_parent_ids_from_rows;
use documents::{read_document_templates, read_mail_templates};
use hr::{maybe_log_hr_pii_read, read_direct_reports, read_employees, read_my_employee};
use messaging::read_queued_mail_messages;
pub(crate) use row_values::{
    filter_and_strip_archived, filter_and_strip_soft_deleted, has_iot_read_permission, row_u64,
};
#[cfg(test)]
use row_values::{
    optional_u64, row_enum_tag_is, row_id_u64_strict, row_identity_option_is, row_not_soft_deleted,
};

fn row_company_matches(row: &Value, company_id: u64, allow_shared: bool) -> bool {
    match row_u64(row, "companyId", "company_id") {
        Ok(Some(id)) => id == company_id,
        Ok(None) => allow_shared,
        Err(_) => false,
    }
}

fn filter_inventory_company_rows(resource: &str, company_id: u64, rows: &mut Vec<Value>) {
    // product-categories with no company_id are org-shared and visible to all
    // company members within the organization.
    let allow_shared = matches!(resource, "product-categories");
    rows.retain(|row| row_company_matches(row, company_id, allow_shared));
}

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
    let fa = field_access;
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
    let accounting_company_id =
        if accounting_resource(resource) || optional_company_accounting_resource(resource) {
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
        "roles" => {
            return read_roles(client, fa).await;
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
        | "workflow-activities"
        | "workflow-transitions"
        | "workflow-workitems" => {
            return Ok(Vec::new());
        }
        "document-templates" => {
            return read_document_templates(client, organization_id).await;
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
            return crate::cold_tier::audit_read::hot_rows(client, organization_id).await;
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

    // Pilot ACL = owner-only on both WS and HTTP (match erp_subscriptions.rs; not full
    // `read_access_ids`). Documents/folders/versions must not fall through to org-only SQL.
    if resource == "document-folders" {
        let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
        let cols = resolve_http_sql_columns("document-folders", fa).map_err(ApiError::Internal)?;
        let col_part = cols.join(", ");
        let sql = format!(
            "SELECT {col_part} FROM doc_folder WHERE organization_id = {organization_id} AND (is_access_restricted = false OR owner_id = {id})"
        );
        return client.query_sql(&sql).await.map_err(ApiError::internal);
    }

    if resource == "documents" || resource == "documents-deleted" {
        let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
        let cols = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
        let col_part = cols.join(", ");
        let deleted = if resource == "documents-deleted" {
            "true"
        } else {
            "false"
        };
        let sql = format!(
            "SELECT {col_part} FROM document WHERE organization_id = {organization_id} AND is_deleted = {deleted} AND owner_id = {id}"
        );
        return client.query_sql(&sql).await.map_err(ApiError::internal);
    }

    // Pilot ACL = owner-only. `document_version` has no `owner_id`; SpacetimeDB SQL cannot
    // JOIN/subquery parent `document.owner_id`. Filter by `created_by` (same as WS).
    if resource == "document-versions" {
        let id = identity_sql_literal(identity_hex).map_err(ApiError::Internal)?;
        let cols = resolve_http_sql_columns("document-versions", fa).map_err(ApiError::Internal)?;
        let col_part = cols.join(", ");
        let sql = format!(
            "SELECT {col_part} FROM document_version WHERE organization_id = {organization_id} AND created_by = {id}"
        );
        return client.query_sql(&sql).await.map_err(ApiError::internal);
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
        filter_inventory_company_rows(resource, company_id, &mut rows);
    }
    if let Some(company_id) = purchasing_company_id {
        rows.retain(|row| row_company_matches(row, company_id, false));
    }
    if let Some(company_id) = accounting_company_id {
        rows.retain(|row| {
            row_company_matches(
                row,
                company_id,
                optional_company_accounting_resource(resource),
            )
        });
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

    if resource == "contact-phone-identities" || resource == "payment-accounts" {
        filter_and_strip_archived(&mut rows);
    }

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

    match resource {
        "contact-tags" | "contact-categories" | "contact-segments" => {
            rows.sort_by(|a, b| {
                let an = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let bn = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                an.cmp(bn)
            });
        }
        "opportunity-stages" => {
            rows.sort_by(|a, b| {
                let asq = a.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                let bsq = b.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                asq.cmp(&bsq)
            });
        }
        "activities" | "landed-costs" => {
            rows.sort_by(|a, b| {
                let ai = a.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let bi = b.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                bi.cmp(&ai)
            });
        }
        "pricelist-items" => {
            rows.sort_by(|a, b| {
                let apl = a
                    .get("pricelistId")
                    .or_else(|| a.get("pricelist_id"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let bpl = b
                    .get("pricelistId")
                    .or_else(|| b.get("pricelist_id"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let asq = a.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                let bsq = b.get("sequence").and_then(|v| v.as_i64()).unwrap_or(0);
                apl.cmp(&bpl).then(asq.cmp(&bsq))
            });
        }
        "quality-alerts" => {
            rows.sort_by(|a, b| {
                let ai = a.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let bi = b.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                bi.cmp(&ai)
            });
        }
        _ => {}
    }

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn authoritative_access(permission: &str) -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 42,
            role_id: 7,
            role_name: "member".into(),
            is_superuser: false,
            role_permissions: vec![permission.into()],
            identity_hex: "actor".into(),
            field_permissions: Vec::new(),
        }
    }

    #[test]
    fn authoritative_company_sql_is_bounded_by_scope_and_id() {
        let access = authoritative_access("sale_order:read");
        let (sql, scope) = authoritative_record_sql("sale-orders", 42, 7, 99, Some(&access))
            .expect("authorized SQL");
        assert_eq!(scope, AuthoritativeResourceScope::OrganizationAndCompany);
        assert!(sql.contains("organization_id = 42"));
        assert!(sql.contains("company_id = 7"));
        assert!(sql.contains("id = 99"));
        assert!(sql.ends_with("LIMIT 1"));
    }

    #[test]
    fn authoritative_sql_fails_closed_without_read_permission() {
        let access = authoritative_access("sale_order:write");
        assert!(authoritative_record_sql("sale-orders", 42, 7, 99, Some(&access)).is_err());
        assert!(authoritative_record_sql("sale-orders", 42, 7, 99, None).is_err());
        assert!(authoritative_record_sql("unknown", 42, 7, 99, Some(&access)).is_err());
    }

    #[test]
    fn company_bound_actor_cannot_request_another_company() {
        assert!(enforce_requested_company(7, Some(8), "cross-company").is_err());
        assert_eq!(
            enforce_requested_company(7, Some(7), "cross-company").expect("same company"),
            7
        );
    }

    #[test]
    fn enum_post_filter_matches_only_expected_sats_tags() {
        assert!(row_enum_tag_is(
            &json!({ "state": "ToApprove" }),
            "state",
            &["ToApprove"]
        ));
        assert!(row_enum_tag_is(
            &json!({ "state": "ValidatedOne" }),
            "state",
            &["Confirm", "ValidatedOne"]
        ));
        assert!(!row_enum_tag_is(
            &json!({ "state": "Approved" }),
            "state",
            &["ToApprove"]
        ));
    }

    #[test]
    fn identity_post_filter_accepts_sats_option_encodings() {
        let target = "abcdef";
        for row in [
            json!({ "userId": ["0xABCDEF"] }),
            json!({ "user_id": { "some": ["0xabcdef"] } }),
            json!({ "userId": "ABCDEF" }),
        ] {
            assert!(row_identity_option_is(&row, "userId", "user_id", target));
        }
        assert!(!row_identity_option_is(
            &json!({ "userId": { "none": [] } }),
            "userId",
            "user_id",
            target
        ));
        assert!(!row_identity_option_is(
            &json!({ "userId": ["0x123456"] }),
            "userId",
            "user_id",
            target
        ));
    }

    #[test]
    fn row_not_soft_deleted_treats_missing_and_null_as_live() {
        assert!(row_not_soft_deleted(&json!({ "id": 1 })));
        assert!(row_not_soft_deleted(&json!({ "id": 1, "deletedAt": null })));
        assert!(row_not_soft_deleted(
            &json!({ "id": 1, "deleted_at": { "none": [] } })
        ));
    }

    #[test]
    fn row_not_soft_deleted_rejects_timestamp() {
        assert!(!row_not_soft_deleted(&json!({
            "id": 1,
            "deletedAt": { "__timestamp_micros_since_unix_epoch__": 1 }
        })));
    }

    #[test]
    fn filter_and_strip_soft_deleted_removes_deleted_rows_and_field() {
        let mut rows = vec![
            json!({ "id": 1, "deletedAt": null }),
            json!({ "id": 2, "deletedAt": { "__timestamp_micros_since_unix_epoch__": 1 } }),
        ];
        filter_and_strip_soft_deleted(&mut rows);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get("id").and_then(|v| v.as_u64()), Some(1));
        assert!(rows[0].get("deletedAt").is_none());
    }

    #[test]
    fn crm_company_match_distinguishes_owned_shared_and_cross_company_rows() {
        let owned = json!({ "companyId": 7 });
        let shared = json!({ "companyId": null });
        let tagged = json!({ "company_id": { "some": [7] } });

        assert!(row_company_matches(&owned, 7, false));
        assert!(row_company_matches(&tagged, 7, false));
        assert!(!row_company_matches(&owned, 8, true));
        assert!(row_company_matches(&shared, 7, true));
        assert!(!row_company_matches(&shared, 7, false));
    }

    #[test]
    fn direct_company_owned_crm_resources_exclude_null_and_cross_company_rows() {
        for resource in [
            "contacts",
            "opportunities",
            "contact-phone-identities",
            "contact-role-assignments",
            "contact-communication-preferences",
        ] {
            let mut rows = vec![
                json!({ "id": 1, "companyId": 7 }),
                json!({ "id": 2, "companyId": null }),
                json!({ "id": 3, "companyId": 8 }),
            ];

            assert!(filter_direct_crm_company_rows(resource, 7, &mut rows));
            assert_eq!(rows, vec![json!({ "id": 1, "companyId": 7 })]);
        }
    }

    #[test]
    fn parent_visibility_excludes_null_cross_company_and_deleted_rows() {
        let rows = vec![
            json!({ "id": 1, "companyId": 7, "deletedAt": null }),
            json!({ "id": 2, "companyId": null, "deletedAt": null }),
            json!({ "id": 3, "companyId": 8, "deletedAt": null }),
            json!({ "id": 4, "companyId": 7, "deletedAt": { "some": [1] } }),
        ];

        assert_eq!(visible_parent_ids_from_rows(&rows, 7), HashSet::from([1]));
    }

    #[test]
    fn explicitly_organization_shared_resources_are_not_direct_company_filtered() {
        let mut rows = vec![json!({ "id": 1, "organizationId": 9 })];

        assert!(!filter_direct_crm_company_rows(
            "contact-tags",
            7,
            &mut rows
        ));
        assert_eq!(rows, vec![json!({ "id": 1, "organizationId": 9 })]);

        let mut rows = vec![json!({ "id": 1, "organizationId": 9 })];
        assert!(!filter_direct_crm_company_rows(
            "contact-categories",
            7,
            &mut rows
        ));
        assert_eq!(rows, vec![json!({ "id": 1, "organizationId": 9 })]);
    }

    #[test]
    fn realtime_exact_company_resources_project_company_id() {
        for resource in [
            "contacts",
            "opportunities",
            "opportunity-lines",
            "opportunity-presence",
            "contact-phone-identities",
            "contact-role-assignments",
            "contact-communication-preferences",
            "contact-tag-assignments",
            "contact-category-assignments",
            "segment-members",
            "privacy-consent",
            "contact-relationship-insights",
            "contact-relationships",
            "contact-duplicate-candidates",
            "crm-forecast-snapshots",
            "crm-conversations",
            "crm-conversation-messages",
        ] {
            let entry = registry_get(resource).expect("CRM resource must be registered");
            assert!(
                entry.mandatory.iter().any(|field| field == "company_id"),
                "{resource} must project company_id for exact realtime filtering"
            );
        }

        for resource in [
            "leads",
            "lead-sources",
            "lead-lost-reasons",
            "opportunity-stages",
            "contact-tags",
            "contact-categories",
            "contact-segments",
            "assignment-rules",
            "activities",
            "calendar-events",
            "utm-campaigns",
            "utm-media",
            "utm-sources",
            "lead-scores",
            "lead-score-factors",
            "contact-segment-rules",
        ] {
            let entry = registry_get(resource).expect("shared CRM resource must be registered");
            assert!(
                !entry.mandatory.iter().any(|field| field == "company_id"),
                "{resource} is explicitly organization-shared"
            );
        }
    }

    #[test]
    fn crm_resource_classification_is_narrow() {
        assert!(crm_resource("contacts"));
        assert!(crm_resource("crm-conversation-messages"));
        assert!(!crm_resource("account-moves"));
    }

    #[test]
    fn row_id_u64_strict_roundtrips_boundary_values() {
        // 2^53 — largest JS-safe integer
        let at_boundary = json!({ "id": "9007199254740992" });
        assert_eq!(
            row_id_u64_strict(&at_boundary).unwrap(),
            9007199254740992u64
        );

        // 2^53 + 1 — first value that JS Number silently truncates
        let above_boundary = json!({ "id": "9007199254740993" });
        assert_eq!(
            row_id_u64_strict(&above_boundary).unwrap(),
            9007199254740993u64
        );

        // near u64::MAX
        let near_max = json!({ "id": "18446744073709551614" });
        assert_eq!(
            row_id_u64_strict(&near_max).unwrap(),
            18446744073709551614u64
        );

        // numeric form also accepted
        let numeric = json!({ "id": 42u64 });
        assert_eq!(row_id_u64_strict(&numeric).unwrap(), 42u64);
    }

    #[test]
    fn row_id_u64_strict_rejects_bad_inputs() {
        assert!(row_id_u64_strict(&json!({})).is_err(), "missing id field");
        assert!(
            row_id_u64_strict(&json!({ "id": null })).is_err(),
            "null id"
        );
        assert!(
            row_id_u64_strict(&json!({ "id": "" })).is_err(),
            "empty string"
        );
        assert!(
            row_id_u64_strict(&json!({ "id": "-1" })).is_err(),
            "negative string"
        );
        assert!(
            row_id_u64_strict(&json!({ "id": "3.14" })).is_err(),
            "float string"
        );
        assert!(
            row_id_u64_strict(&json!({ "id": "not_a_number" })).is_err(),
            "non-numeric string"
        );
    }

    #[test]
    fn optional_u64_returns_ok_none_for_absent_and_null() {
        assert_eq!(optional_u64(None).unwrap(), None);
        assert_eq!(optional_u64(Some(&json!(null))).unwrap(), None);
        assert_eq!(optional_u64(Some(&json!({ "none": [] }))).unwrap(), None);
    }

    #[test]
    fn optional_u64_parses_string_at_boundary_values() {
        let v = json!("9007199254740993");
        assert_eq!(optional_u64(Some(&v)).unwrap(), Some(9007199254740993u64));

        let v2 = json!({ "some": ["18446744073709551614"] });
        assert_eq!(
            optional_u64(Some(&v2)).unwrap(),
            Some(18446744073709551614u64)
        );
    }

    #[test]
    fn optional_u64_errors_on_present_but_unparseable_value() {
        assert!(
            optional_u64(Some(&json!("not_a_number"))).is_err(),
            "non-numeric string should be an error"
        );
        assert!(
            optional_u64(Some(&json!("-5"))).is_err(),
            "negative string should be an error"
        );
        assert!(
            optional_u64(Some(&json!({ "some": ["bad"] }))).is_err(),
            "invalid some value should be an error"
        );
    }

    #[test]
    fn inventory_resource_classification_covers_expected_resources() {
        assert!(inventory_resource("stock-quants"));
        assert!(inventory_resource("stock-pickings"));
        assert!(inventory_resource("warehouses"));
        assert!(inventory_resource("quality-checks"));
        assert!(inventory_resource("replenishment-rules"));
        assert!(inventory_resource("picking-batches"));
        assert!(!inventory_resource("account-moves"));
        assert!(!inventory_resource("contacts"));
    }

    #[test]
    fn accounting_resource_classification_covers_company_scoped_tables() {
        for resource in [
            "account-accounts",
            "account-assets",
            "account-groups",
            "account-journals",
            "account-move-lines",
            "account-moves",
            "account-payments",
            "account-periods",
            "account-reconciliation-widgets",
            "account-taxes",
            "amortization-lines",
            "amortization-schedules",
            "analytic-accounts",
            "analytic-distribution-models",
            "analytic-lines",
            "bank-statements",
            "budgets",
            "budget-lines",
            "budget-posts",
            "consolidation-elimination-entries",
            "depreciation-lines",
            "fiscal-years",
            "fixed-assets",
            "fx-revaluation-runs",
            "partner-credit-controls",
            "partner-credit-holds",
            "payment-accounts",
            "payment-fees",
            "payment-reconciliations",
            "payment-reversals",
            "payment-transactions",
            "tax-deadlines",
            "tax-groups",
            "tax-schedules",
        ] {
            assert!(
                accounting_resource(resource),
                "{resource} backs a required company_id column and must be scoped"
            );
        }
    }

    #[test]
    fn accounting_resource_distinguishes_optional_company_and_org_wide_tables() {
        assert!(!accounting_resource("account-account-types"));
        assert!(optional_company_accounting_resource(
            "account-account-types"
        ));
        // These tables carry no company_id column and remain org-wide.
        assert!(!accounting_resource("account-payment-terms"));
        assert!(!accounting_resource("account-payment-term-lines"));
        assert!(!optional_company_accounting_resource(
            "account-payment-terms"
        ));
        // Sanity: not misclassified as another domain's resource.
        assert!(!accounting_resource("contacts"));
        assert!(!accounting_resource("stock-quants"));
        assert!(!crm_resource("account-accounts"));
        assert!(!inventory_resource("account-journals"));
        assert!(!purchasing_resource("account-moves"));
    }

    #[test]
    fn accounting_resources_project_company_id_for_row_filtering() {
        for resource in [
            "account-accounts",
            "account-assets",
            "account-groups",
            "account-journals",
            "account-move-lines",
            "account-moves",
            "account-payments",
            "account-periods",
            "account-reconciliation-widgets",
            "account-taxes",
            "amortization-lines",
            "amortization-schedules",
            "analytic-accounts",
            "analytic-distribution-models",
            "analytic-lines",
            "bank-statements",
            "budgets",
            "budget-lines",
            "budget-posts",
            "consolidation-elimination-entries",
            "depreciation-lines",
            "fiscal-years",
            "fixed-assets",
            "fx-revaluation-runs",
            "partner-credit-controls",
            "partner-credit-holds",
            "payment-accounts",
            "payment-fees",
            "payment-reconciliations",
            "payment-reversals",
            "payment-transactions",
            "tax-deadlines",
            "tax-groups",
            "tax-schedules",
        ] {
            let entry = registry_get(resource).expect("accounting resource must be registered");
            let projects_company_id = entry.mandatory.iter().any(|f| f == "company_id")
                || entry.default_restricted.iter().any(|f| f == "company_id");
            assert!(
                projects_company_id,
                "{resource} must project company_id by default for row_company_matches to work"
            );
        }
    }

    #[test]
    fn accounting_company_scoped_rows_filtered_strictly_no_shared_fallback() {
        let mut rows = vec![
            json!({ "id": 1, "companyId": 7 }),
            json!({ "id": 2, "companyId": null }),
            json!({ "id": 3, "companyId": 8 }),
        ];
        rows.retain(|row| row_company_matches(row, 7, false));
        assert_eq!(rows, vec![json!({ "id": 1, "companyId": 7 })]);
    }

    #[test]
    fn malformed_company_fields_fail_closed_even_for_shared_scope() {
        for row in [
            json!({ "companyId": "not-a-number" }),
            json!({ "companyId": -1 }),
        ] {
            assert!(!row_company_matches(&row, 7, true));
        }
        assert!(row_company_matches(&json!({ "companyId": null }), 7, true));
    }

    #[test]
    fn accounting_optional_company_rows_include_selected_and_shared_only() {
        let entry = registry_get("account-account-types")
            .expect("optional-company accounting resource must be registered");
        assert!(entry
            .default_restricted
            .iter()
            .any(|field| field == "company_id"));

        let mut rows = vec![
            json!({ "id": 1, "companyId": 7 }),
            json!({ "id": 2, "companyId": null }),
            json!({ "id": 3, "companyId": 8 }),
        ];
        rows.retain(|row| row_company_matches(row, 7, true));
        assert_eq!(
            rows,
            vec![
                json!({ "id": 1, "companyId": 7 }),
                json!({ "id": 2, "companyId": null }),
            ]
        );
    }

    #[test]
    fn iot_resource_classification_covers_every_company_owned_table() {
        for resource in [
            "iot-actions",
            "iot-alerts",
            "iot-devices",
            "iot-hubs",
            "iot-pairing-tokens",
            "iot-telemetry",
            "iot-thresholds",
        ] {
            assert!(iot_resource(resource), "{resource} must be company-scoped");
        }
        assert!(!iot_resource("contacts"));
        assert!(!iot_resource("pos-configs"));
    }

    #[test]
    fn iot_read_permission_accepts_module_and_resource_permissions() {
        let module_reader = authoritative_access("module:iot:read");
        for resource in [
            "iot-actions",
            "iot-alerts",
            "iot-devices",
            "iot-hubs",
            "iot-pairing-tokens",
            "iot-telemetry",
            "iot-thresholds",
        ] {
            assert!(
                has_iot_read_permission(Some(&module_reader), resource),
                "{resource} must accept the checked-in Manager module permission"
            );
        }

        let resource_reader = authoritative_access("iot_hub:read");
        assert!(has_iot_read_permission(Some(&resource_reader), "iot-hubs"));

        let writer = authoritative_access("module:iot:write");
        assert!(!has_iot_read_permission(Some(&writer), "iot-hubs"));
        assert!(!has_iot_read_permission(None, "iot-hubs"));
    }

    #[test]
    fn iot_resources_project_company_id_for_defense_in_depth() {
        for resource in [
            "iot-actions",
            "iot-alerts",
            "iot-devices",
            "iot-hubs",
            "iot-pairing-tokens",
            "iot-telemetry",
            "iot-thresholds",
        ] {
            let columns = resolve_http_sql_columns(resource, None).expect("IoT HTTP projection");
            assert!(
                columns.iter().any(|column| column == "company_id"),
                "{resource} must project company_id for post-fetch verification"
            );
        }
    }

    #[test]
    fn iot_company_scoped_rows_exclude_null_and_cross_company_values() {
        let mut rows = vec![
            json!({ "id": 1, "companyId": 7 }),
            json!({ "id": 2, "companyId": null }),
            json!({ "id": 3, "companyId": 8 }),
        ];
        rows.retain(|row| row_company_matches(row, 7, false));
        assert_eq!(rows, vec![json!({ "id": 1, "companyId": 7 })]);
    }
}

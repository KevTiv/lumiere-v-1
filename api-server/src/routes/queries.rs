//! Authenticated query and authoritative-record handlers.

use crate::error::ApiError;
use crate::query_exec::{
    execute_authorized_resource_record, execute_resource_query_for_company, resolve_crm_company_id,
    resolve_sales_company_id,
};
use crate::session::resolve_api_session;
use crate::state::AppState;
use crate::trusted_context::{TrustedOperationContext, RESOURCE_QUERY_OPERATION_ID};
use crate::web_session::stdb_identity_hex_hint;
use axum::{
    extract::{Path, Query, State},
    http::{header::AUTHORIZATION, HeaderMap},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use stdb_auth::{has_resource_read_permission, registry_get};

mod activity_work;
mod replenishment;
mod task_assignees;

#[derive(Debug, Deserialize)]
pub(crate) struct OrgQuery {
    #[serde(rename = "organizationId")]
    organization_id: Option<u64>,
    #[serde(rename = "companyId")]
    company_id: Option<u64>,
    cursor: Option<String>,
    #[serde(rename = "operationKey", alias = "operation_key")]
    operation_key: Option<String>,
    limit: Option<u32>,
    #[serde(rename = "workScope")]
    work_scope: Option<String>,
    #[serde(rename = "workView")]
    work_view: Option<String>,
    #[serde(rename = "workTeam")]
    work_team: Option<String>,
    #[serde(rename = "taskId")]
    task_id: Option<u64>,
    #[serde(rename = "activityId")]
    activity_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuthoritativeQuery {
    #[serde(rename = "companyId")]
    company_id: u64,
}

fn owner_read_permission_resource(resource: &str) -> Option<&str> {
    if resource == "purchase-order-creations" {
        Some("purchase-orders")
    } else if resource == "purchase-receipt-operations" {
        Some("purchase-order-lines")
    } else if resource == "replenishment-run-jobs" {
        Some("replenishment-rules")
    } else if crate::query_exec::crm_resource(resource) {
        Some(resource)
    } else if crate::workflow_reads::is_private_workflow_resource(resource) {
        // Most private workflow tables are intentionally absent from the
        // public resource registry.  They still use the canonical workflow
        // permission alias (`workflow:read`) before the owner-token read.
        Some(if registry_get(resource).is_some() {
            resource
        } else {
            "workflows"
        })
    } else {
        None
    }
}

fn owner_read_module(resource: &str) -> Option<&'static str> {
    if matches!(
        resource,
        "purchase-order-creations" | "purchase-receipt-operations"
    ) {
        Some("purchasing")
    } else if crate::query_exec::crm_resource(resource) {
        Some("crm")
    } else if crate::workflow_reads::is_private_workflow_resource(resource) {
        Some("workflows")
    } else {
        None
    }
}

fn require_owner_read_permission(
    resource: &str,
    context: &TrustedOperationContext,
) -> Result<(), ApiError> {
    let Some(permission_resource) = owner_read_permission_resource(resource) else {
        return Ok(());
    };
    let access = context.field_access();
    let module_permission = owner_read_module(resource).is_some_and(|module| {
        let read = format!("module:{module}:read");
        let wildcard = format!("module:{module}:*");
        access.is_superuser
            || access.role_permissions.iter().any(|permission| {
                permission == "*:*" || permission == &read || permission == &wildcard
            })
    });
    if has_resource_read_permission(Some(access), permission_resource) || module_permission {
        Ok(())
    } else {
        Err(ApiError::Forbidden(format!(
            "Read permission denied for resource '{resource}'"
        )))
    }
}

pub(crate) async fn get_query(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path(resource): Path<String>,
    Query(q): Query<OrgQuery>,
) -> Result<Json<Value>, ApiError> {
    let auth = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let id_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_tok = cookies.get("stdb_token").map(|c| c.value().to_string());

    let session = resolve_api_session(&state, auth, cookie_tok.as_deref(), id_hint.as_deref())
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let session_client = state.client_with_token(&session.stdb_token);
    let context = TrustedOperationContext::from_session_with_placement(
        &session,
        session_client,
        RESOURCE_QUERY_OPERATION_ID,
        &state.organization_placements,
    )?;

    let org_id = context.organization_id();
    if let Some(override_org) = q.organization_id {
        if override_org != org_id {
            return Err(ApiError::Forbidden(
                "Cannot query another organization's data".into(),
            ));
        }
    }
    context.require_current_placement(&state.organization_placements)?;

    if let Some(request) = activity_work::ActivityWorkRequest::parse(
        &resource,
        q.company_id,
        q.work_scope.as_deref(),
        q.work_view.as_deref(),
        q.work_team.as_deref(),
        q.cursor.as_deref(),
        q.limit,
        q.activity_id,
    )? {
        if q.operation_key.is_some() {
            return Err(ApiError::BadRequest(
                "operationKey is not supported for a work board".into(),
            ));
        }
        let page = activity_work::read_activity_work(&state.stdb, &context, request).await?;
        context.require_current_placement(&state.organization_placements)?;
        return Ok(Json(
            json!({"data": page.rows, "nextCursor": page.next_cursor}),
        ));
    }

    if let Some(request) = crate::workflow_reads::WorkBoardRequest::parse(
        &resource,
        q.company_id,
        q.work_scope.as_deref(),
        q.work_view.as_deref(),
        q.work_team.as_deref(),
        q.cursor.as_deref(),
        q.limit,
    )? {
        if q.operation_key.is_some() {
            return Err(ApiError::BadRequest(
                "operationKey is not supported for a work board".into(),
            ));
        }
        let page = crate::workflow_reads::read_work_board(&state.stdb, &context, request).await?;
        context.require_current_placement(&state.organization_placements)?;
        return Ok(Json(
            json!({"data": page.rows, "nextCursor": page.next_cursor}),
        ));
    }

    if resource == "task-assignees" {
        let data =
            task_assignees::read_task_assignees(&state.stdb, &context, q.company_id, q.task_id)
                .await?;
        context.require_current_placement(&state.organization_placements)?;
        return Ok(Json(json!({"data": data})));
    }

    // Private workflow tables are not readable with the user JWT; use the module
    // owner token and enforce identity/company filters in `workflow_reads`.
    let owner_read = owner_read_permission_resource(&resource).is_some();
    if owner_read {
        require_owner_read_permission(&resource, &context)?;
    }
    let operation_read = match resource.as_str() {
        "purchase-order-creations" => Some((
            "purchase_order_creation_operation",
            "purchase order creation",
            "erp.create_purchase_order_once",
            "id, organization_id, company_id, operation_key, purchase_order_id, payload_hash, created_by, created_at",
        )),
        "purchase-receipt-operations" => Some((
            "purchase_receipt_operation",
            "receipt",
            "erp.receive_po_line_once",
            "id, organization_id, company_id, operation_key, line_id, order_id, quantity, lot_id, received_before, received_after, move_id, picking_id, continuation_move_id, continuation_picking_id, created_by, created_at",
        )),
        _ => None,
    };
    if let Some((table, operation_label, contract_operation_id, columns)) = operation_read {
        if stdb_client::reducer_contract_by_operation_id(contract_operation_id).is_none() {
            return Err(ApiError::Unavailable(format!(
                "Durable {operation_label} contracts are unavailable"
            )));
        }
        let key = q.operation_key.as_deref().ok_or_else(|| {
            ApiError::BadRequest(format!(
                "operationKey is required for {operation_label} readback"
            ))
        })?;
        if key.is_empty()
            || key.len() > 128
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(ApiError::BadRequest(format!(
                "Invalid {operation_label} operation key"
            )));
        }
        let company_id = crate::query_exec::resolve_purchasing_company_id(
            context.client(),
            org_id,
            context.actor_identity(),
            q.company_id,
        )
        .await?;
        let identity = stdb_auth::identity_sql_literal(context.actor_identity())
            .map_err(ApiError::Internal)?;
        let id = format!("{org_id}:{company_id}:{key}");
        // This private recovery read is deliberately fixed to the immutable
        // receipt evidence shape. It does not depend on a public registry
        // entry and cannot be broadened by request parameters.
        let sql = format!(
            "SELECT {columns} FROM {table} WHERE id = '{id}' AND organization_id = {org_id} AND company_id = {company_id} AND created_by = {identity}"
        );
        let data = state
            .stdb
            .query_sql(&sql)
            .await
            .map_err(ApiError::internal)?;
        return Ok(Json(json!({ "data": data })));
    }
    // Only this exact registered private inventory resource uses the bounded
    // adapter. Membership scope is resolved with the actor client, not owner authority.
    if resource == "replenishment-run-jobs" {
        let mut data = replenishment::read(&state.stdb, context, q.company_id).await?;
        if let Some(limit) = q.limit {
            data.truncate(limit as usize);
        }
        return Ok(Json(json!({ "data": data })));
    }
    let client = if owner_read {
        state.stdb.clone()
    } else {
        context.client().clone()
    };
    // "pos-orders" is cursor-paginated (hot+cold merge) and needs a response
    // envelope beyond the generic `{"data": [...]}` — special-cased here
    // rather than folded into `execute_resource_query_for_company`, whose
    // signature is shared by ~40 resources that don't need a cursor.
    if resource == "pos-orders" {
        let company_id = resolve_sales_company_id(
            context.client(),
            org_id,
            context.actor_identity(),
            q.company_id,
        )
        .await?;
        let scoped_context = context.with_company_scope(vec![company_id])?;
        scoped_context.require_company_scope(&[company_id])?;
        let page = crate::cold_tier::pos_order_read::merged_page(
            &client,
            &state.organization_placements,
            org_id,
            Some(company_id),
            q.cursor.clone(),
            q.limit,
        )
        .await?;
        return Ok(Json(
            json!({ "data": page.rows, "nextCursor": page.next_cursor }),
        ));
    }

    let mut data = execute_resource_query_for_company(
        &client,
        &resource,
        org_id,
        context.actor_identity(),
        Some(context.field_access()),
        q.company_id,
    )
    .await?;
    if let Some(limit) = q.limit {
        data.truncate(limit as usize);
    }

    Ok(Json(json!({ "data": data })))
}

pub(crate) async fn get_authoritative_resource(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: tower_cookies::Cookies,
    Path((resource, record_id)): Path<(String, u64)>,
    Query(query): Query<AuthoritativeQuery>,
) -> Result<Json<Value>, ApiError> {
    let auth = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    let identity_hint = stdb_identity_hex_hint(&headers, &cookies);
    let cookie_token = cookies
        .get("stdb_token")
        .map(|cookie| cookie.value().to_string());
    let session = resolve_api_session(
        &state,
        auth,
        cookie_token.as_deref(),
        identity_hint.as_deref(),
    )
    .await?
    .ok_or(ApiError::Unauthorized)?;
    let session_client = state.client_with_token(&session.stdb_token);
    let context = TrustedOperationContext::from_session_with_placement(
        &session,
        session_client,
        RESOURCE_QUERY_OPERATION_ID,
        &state.organization_placements,
    )?;
    let organization_id = context.organization_id();
    context.require_current_placement(&state.organization_placements)?;

    let owner_read = crate::query_exec::crm_resource(&resource);
    if owner_read {
        require_owner_read_permission(&resource, &context)?;
    }

    // The requested company is only actor intent. Resolve it against the active
    // membership so a company-bound actor cannot pivot within the organization.
    let company_id = resolve_crm_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(query.company_id),
    )
    .await?;

    let client = if crate::query_exec::crm_resource(&resource) {
        state.stdb.clone()
    } else {
        context.client().clone()
    };
    let scoped_context = context.with_company_scope(vec![company_id])?;
    scoped_context.require_company_scope(&[company_id])?;
    let row = execute_authorized_resource_record(
        &client,
        &resource,
        organization_id,
        company_id,
        record_id,
        Some(scoped_context.field_access()),
    )
    .await?
    .ok_or_else(|| ApiError::NotFound("Authoritative resource not found".into()))?;

    Ok(Json(json!({ "data": row })))
}

#[cfg(test)]
mod tests {
    use super::{owner_read_module, owner_read_permission_resource};

    #[test]
    fn owner_reads_use_the_resource_permission() {
        assert_eq!(owner_read_permission_resource("leads"), Some("leads"));
        assert_eq!(
            owner_read_permission_resource("workflow-human-tasks"),
            Some("workflows")
        );
        assert_eq!(owner_read_permission_resource("products"), None);
        assert_eq!(
            owner_read_permission_resource("purchase-order-creations"),
            Some("purchase-orders")
        );
        assert_eq!(
            owner_read_permission_resource("purchase-receipt-operations"),
            Some("purchase-order-lines")
        );
        assert_eq!(
            owner_read_module("purchase-receipt-operations"),
            Some("purchasing")
        );
        assert_eq!(
            owner_read_module("purchase-order-creations"),
            Some("purchasing")
        );
        assert_eq!(
            owner_read_permission_resource("purchase-receipt-operations-extra"),
            None
        );
        assert_eq!(
            owner_read_permission_resource("replenishment-run-jobs"),
            Some("replenishment-rules")
        );
        assert_eq!(
            owner_read_permission_resource("replenishment_run_job"),
            None
        );
        assert_eq!(
            owner_read_permission_resource("replenishment-run-jobs-extra"),
            None
        );
    }
}

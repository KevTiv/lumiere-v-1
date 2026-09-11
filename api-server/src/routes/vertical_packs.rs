//! `/v1/vertical-packs/*` — company-scoped vertical product pack state.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::query_exec::resolve_membership_company_id;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::OrgSession;

async fn company_packs_get(
    State(state): State<Arc<AppState>>,
    Path(company_id): Path<u64>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let company_id = resolve_membership_company_id(
        context.client(),
        organization_id,
        context.actor_identity(),
        Some(company_id),
        "vertical-pack company scope mismatch",
    )
    .await?;
    let context = context.with_company_scope(vec![company_id])?;
    let data = context
        .client()
        .query_sql(&format!(
            "SELECT id, company_id, pack_key, enabled, configuration, updated_at FROM company_vertical_pack WHERE organization_id = {organization_id} AND company_id = {company_id}"
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "data": data })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/vertical-packs/:company_id", get(company_packs_get))
}

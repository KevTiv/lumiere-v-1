//! Saved source reviews become immutable, approved native import proposals.
//! PostgreSQL owns review decisions; native ERP receipts own business effects.
//! A lost response resumes by the same native request IDs, never by timestamps.
mod binding;
mod model;
mod native;
mod overlap;
mod storage;
#[cfg(test)]
mod tests;

use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use tokio_postgres::Transaction;

use super::{scope, Scope, StorageScope};
use crate::{
    cold_tier::pg_pool,
    error::ApiError,
    routes::import::{read_workflow_import, submit_workflow_import, WorkflowImportRequest},
    session::ApiSession,
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};
pub(crate) use binding::read_workflow_binding;
use model::*;
use storage::SavedProposal;

async fn read(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(task): Path<String>,
    Query(query): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    let scoped = storage_scope(&context, query.company_id);
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let proposals = storage::list(&tx, scoped, &task).await?;
    tx.commit().await.map_err(ApiError::internal)?;
    let (native_results, native_results_more) =
        super::native_requests::list(&context, query.company_id, &task).await?;
    Ok(Json(
        json!({"version":1,"organizationId":context.organization_id().to_string(),"requestId":task,"companyId":query.company_id.to_string(),"capabilities":super::capabilities::catalog(),"proposals":proposals,"nativeResults":native_results,"nativeResultsMore":native_results_more}),
    ))
}

async fn prepare(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(task): Path<String>,
    Json(body): Json<PrepareBody>,
) -> Result<Json<Value>, ApiError> {
    body.validate()?;
    let context = scope(&state, &session, body.company_id).await?;
    let scoped = storage_scope(&context, body.company_id);
    let request_hash = hash(&serde_json::to_vec(&body).map_err(ApiError::internal)?);
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    storage::require_task(&tx, scoped, &task, true).await?;
    if let Some(existing) =
        storage::replay(&tx, scoped, &task, &body.request_key, &request_hash).await?
    {
        return Ok(Json(existing.view()));
    }
    let decimals =
        native::validate_references(&context, body.company_id, &body.configuration).await?;
    let rows = storage::reviews(&tx, scoped, &task, &body.rows).await?;
    let mut definition = build_definition(&rows, &body.configuration, decimals)?;
    overlap::hold_candidates(&tx, scoped, &mut definition, None).await?;
    let proposal = storage::insert(&tx, scoped, &task, &body, &request_hash, &definition).await?;
    // Reject a group that cannot pass the existing native byte admission before
    // the operator approves it. No native operation is dispatched here.
    native::header_request(scoped, &task, &proposal)?;
    let view = proposal.view();
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(view))
}

async fn read_request(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((task, request)): Path<(String, String)>,
    Query(query): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    let scoped = storage_scope(&context, query.company_id);
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let proposal = storage::read_request(&tx, scoped, &task, &request).await?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(proposal.view()))
}

async fn read_posting_status(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((task, id)): Path<(String, i64)>,
    Query(query): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    let access = Some(context.field_access());
    if ["state", "move_type", "metadata"]
        .into_iter()
        .any(|field| !stdb_auth::has_resource_field_read_permission(access, "account-moves", field))
    {
        return Err(ApiError::NotFound(
            "verified journal entry receipt not found".into(),
        ));
    }
    let scoped = storage_scope(&context, query.company_id);
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    storage::require_task(&tx, scoped, &task, false).await?;
    let proposal = storage::read_proposal(&tx, scoped, &task, id, false).await?;
    tx.commit().await.map_err(ApiError::internal)?;
    let result = proposal
        .result
        .as_ref()
        .filter(|_| proposal.state == "verified")
        .ok_or_else(|| ApiError::NotFound("verified journal entry receipt not found".into()))?;
    let mut status =
        native::read_posting_status(&context, scoped, &task, &proposal, result).await?;
    status["taskId"] = json!(task);
    status["organizationId"] = json!(scoped.organization.to_string());
    Ok(Json(status))
}

async fn approve(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((task, id)): Path<(String, i64)>,
    Json(body): Json<ActionBody>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    let scoped = storage_scope(&context, body.company_id);
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    overlap::lock_company(&tx, scoped).await?;
    let mut proposal = storage::load(&tx, scoped, &task, id).await?;
    proposal.require_approval(&body, scoped.company)?;
    let decimals = native::validate_references(
        &context,
        body.company_id,
        &proposal.definition.configuration,
    )
    .await?;
    if proposal.approved_at.is_some() {
        // An approval response can be lost too. Reusing the same exact content
        // must not claim sources again or silently approve a new revision.
        storage::validate_approved_sources(&tx, scoped, &task, &proposal, decimals).await?;
        storage::require_claims(&tx, scoped, &proposal).await?;
    } else {
        storage::approve(&tx, scoped, &task, &mut proposal, decimals).await?;
    }
    let view = proposal.view();
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(view))
}

async fn execute(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((task, id)): Path<(String, i64)>,
    Json(body): Json<ActionBody>,
) -> Result<Json<Value>, ApiError> {
    run(&state, &session, &task, id, &body, true)
        .await
        .map(Json)
}

async fn verify(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((task, id)): Path<(String, i64)>,
    Json(body): Json<ActionBody>,
) -> Result<Json<Value>, ApiError> {
    run(&state, &session, &task, id, &body, false)
        .await
        .map(Json)
}

fn storage_scope(context: &TrustedOperationContext, company: u64) -> StorageScope<'_> {
    StorageScope {
        organization: context.organization_id(),
        company,
        actor: context.actor_identity(),
    }
}

async fn run(
    state: &AppState,
    session: &ApiSession,
    task: &str,
    id: i64,
    body: &ActionBody,
    allow_write: bool,
) -> Result<Value, ApiError> {
    let context = scope(state, session, body.company_id).await?;
    let scoped = storage_scope(&context, body.company_id);
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    // Serialize callers for this proposal and retain shared source-row locks
    // through dispatch. A concurrent reviewer cannot change the approved facts
    // between the freshness check and a native write. A process crash releases
    // those locks; the native request receipt remains the recovery authority.
    let mut proposal = storage::load(&tx, scoped, task, id).await?;
    proposal.require_approval(body, scoped.company)?;
    if proposal.approved_at.is_none() {
        return Err(ApiError::Conflict(
            "approve this exact proposal before executing it".into(),
        ));
    }
    storage::require_claims(&tx, scoped, &proposal).await?;
    let outcome = async {
        if allow_write {
            let decimals = native::validate_references(
                &context,
                scoped.company,
                &proposal.definition.configuration,
            )
            .await?;
            storage::validate_approved_sources(&tx, scoped, task, &proposal, decimals).await?;
        }
        // Read-only verification compares existing effects with the immutable
        // approved snapshot. Later source edits cannot hide a previously saved
        // receipt; they still prevent any further dispatch from that proposal.
        proposal.state = "executing".into();
        proposal.last_error = None;
        proposal.result = None;
        execute_steps(
            state,
            session,
            &context,
            &tx,
            scoped,
            task,
            &mut proposal,
            allow_write,
        )
        .await
    }
    .await;
    match outcome {
        Ok(result) => {
            proposal.state = "verified".into();
            proposal.execution.phase = Phase::Complete;
            proposal.result = Some(result);
        }
        Err(error) => {
            proposal.state = "blocked".into();
            proposal.result = None;
            if matches!(proposal.execution.phase, Phase::Complete) {
                proposal.execution.phase = Phase::Verification;
            }
            // ApiError redacts internal causes. Source data is never written to
            // traces or copied into task errors by this orchestration layer.
            proposal.last_error = Some(error.to_string());
        }
    }
    storage::save_progress(&tx, &proposal).await?;
    let view = proposal.view();
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(view)
}

#[allow(clippy::too_many_arguments)]
async fn execute_steps(
    state: &AppState,
    session: &ApiSession,
    context: &TrustedOperationContext,
    tx: &Transaction<'_>,
    scoped: StorageScope<'_>,
    task: &str,
    proposal: &mut SavedProposal,
    allow_write: bool,
) -> Result<VerifiedResult, ApiError> {
    let headers = native::header_request(scoped, task, proposal)?;
    proposal.execution.phase = Phase::Headers;
    proposal.execution.parent_request_id = Some(headers.request_id.clone());
    let parent = resolve_native(state, session, context, &headers, allow_write).await?;
    proposal.execution.parent_job_id = parent["jobId"].as_str().map(str::to_owned);
    storage::record_receipt(
        tx,
        scoped,
        proposal.id,
        "headers",
        &headers.request_id,
        &hash(headers.csv.as_bytes()),
        &parent,
    )
    .await?;
    let header_ids = match native::receipt_ids(&parent, proposal.definition.entries.len()) {
        Ok(ids) => ids,
        Err(error) => {
            if rejected_empty(&parent) {
                storage::release_empty_claims(tx, proposal.id).await?;
                return Err(ApiError::Conflict(format!("{error} No business records were created; correct the source or mapping and prepare a new proposal.")));
            }
            return Err(error);
        }
    };
    let lines = native::line_request(scoped, task, proposal, &header_ids)?;
    proposal.execution.phase = Phase::Lines;
    proposal.execution.line_request_id = Some(lines.request_id.clone());
    let line_receipt = resolve_native(state, session, context, &lines, allow_write).await?;
    proposal.execution.line_job_id = line_receipt["jobId"].as_str().map(str::to_owned);
    storage::record_receipt(
        tx,
        scoped,
        proposal.id,
        "lines",
        &lines.request_id,
        &hash(lines.csv.as_bytes()),
        &line_receipt,
    )
    .await?;
    let line_ids = match native::receipt_ids(&line_receipt, proposal.definition.entries.len() * 2) {
        Ok(ids) => ids,
        Err(error) => {
            if rejected_empty(&line_receipt) {
                let (moves, lines) =
                    native::read_records(context, scoped.company, &header_ids).await?;
                if moves.is_empty() && lines.is_empty() {
                    storage::release_empty_claims(tx, proposal.id).await?;
                    return Err(ApiError::Conflict(format!("{error} Native cleanup removed the unchanged drafts; correct the source or mapping and prepare a new proposal.")));
                }
            }
            return Err(error);
        }
    };
    proposal.execution.phase = Phase::Verification;
    let (moves, lines) = native::read_records(context, scoped.company, &header_ids).await?;
    native::verify_records(
        scoped,
        task,
        proposal,
        &header_ids,
        &line_ids,
        &moves,
        &lines,
    )
}

fn rejected_empty(receipt: &Value) -> bool {
    matches!(receipt["status"].as_str(), Some("failed" | "rolled_back"))
        && receipt["rowsImported"].as_u64() == Some(0)
}

async fn resolve_native(
    state: &AppState,
    session: &ApiSession,
    context: &TrustedOperationContext,
    request: &WorkflowImportRequest,
    allow_write: bool,
) -> Result<Value, ApiError> {
    match read_workflow_import(context,request,&hash(request.csv.as_bytes())).await {
        Ok(receipt) => Ok(receipt),
        Err(ApiError::NotFound(_)) if allow_write => submit_workflow_import(state,session,request).await,
        Err(ApiError::NotFound(_)) => Err(ApiError::Conflict("this stage has no native receipt yet; resume the approved import to create the remaining drafts".into())),
        Err(error) => Err(error),
    }
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/import-tasks/:task/workflow", get(read))
        .route(
            "/import-tasks/:task/workflow/requests/:requestKey",
            get(read_request),
        )
        .route("/import-tasks/:task/workflow/proposals", post(prepare))
        .route(
            "/import-tasks/:task/workflow/proposals/:proposal/approve",
            post(approve),
        )
        .route(
            "/import-tasks/:task/workflow/proposals/:proposal/execute",
            post(execute),
        )
        .route(
            "/import-tasks/:task/workflow/proposals/:proposal/verify",
            post(verify),
        )
        .route(
            "/import-tasks/:task/workflow/proposals/:proposal/posting-status",
            get(read_posting_status),
        )
        .layer(DefaultBodyLimit::max(500_000))
}

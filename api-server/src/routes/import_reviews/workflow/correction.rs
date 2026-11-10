//! Release source claims only after the native owner removes the exact draft bundle.

use super::*;
use crate::commands::dispatch_session_reducer;

pub(super) async fn rollback(
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
    if matches!(proposal.execution.phase, Phase::RolledBack) {
        return Ok(Json(proposal.view()));
    }
    if proposal.approved_at.is_none() {
        return Err(ApiError::Conflict(
            "This proposal has no approved drafts to remove.".into(),
        ));
    }
    storage::require_claims(&tx, scoped, &proposal).await?;

    let headers = native::header_request(scoped, &task, &proposal)?;
    let header_hash = hash(headers.csv.as_bytes());
    let saved_parent =
        storage::saved_receipt(&tx, id, "headers", &headers.request_id, &header_hash).await?;
    let header_ids = native::receipt_ids(&saved_parent, proposal.definition.entries.len())?;
    let lines = native::line_request(scoped, &task, &proposal, &header_ids)?;
    let line_hash = hash(lines.csv.as_bytes());
    let saved_lines =
        storage::saved_receipt(&tx, id, "lines", &lines.request_id, &line_hash).await?;
    let line_ids = native::receipt_ids(&saved_lines, header_ids.len() * 2)?;

    let parent = read_workflow_import(&context, &headers, &header_hash).await?;
    let child = read_workflow_import(&context, &lines, &line_hash).await?;
    if bundle_state(&parent, &child, &saved_parent, &saved_lines)? == BundleState::Draft {
        let job = positive_id(child["jobId"].as_str().unwrap_or_default())?;
        let dispatch = dispatch_session_reducer(
            &state,
            &session,
            "rollback_import_job",
            json!([scoped.organization, job]),
        )
        .await;
        // A lost reply can follow a committed rollback. Require terminal native
        // receipts either way and surface the owner's rejection when they are absent.
        let parent = read_workflow_import(&context, &headers, &header_hash).await?;
        let child = read_workflow_import(&context, &lines, &line_hash).await?;
        if bundle_state(&parent, &child, &saved_parent, &saved_lines)? != BundleState::Removed {
            dispatch?;
            return Err(ApiError::Conflict(
                "The native rollback is still unconfirmed. Check this proposal again.".into(),
            ));
        }
    }

    native::verify_removed(&context, scoped.company, &header_ids, &line_ids).await?;
    storage::release_empty_claims(&tx, proposal.id).await?;
    // The persisted state remains blocked for execution. The terminal phase
    // distinguishes verified native removal from an unresolved execution.
    proposal.state = "blocked".into();
    proposal.execution.phase = Phase::RolledBack;
    proposal.execution.parent_request_id = Some(headers.request_id);
    proposal.execution.line_request_id = Some(lines.request_id);
    proposal.execution.parent_job_id = saved_parent["jobId"].as_str().map(str::to_owned);
    proposal.execution.line_job_id = saved_lines["jobId"].as_str().map(str::to_owned);
    proposal.result = None;
    proposal.last_error = None;
    storage::save_progress(&tx, &proposal).await?;
    let view = proposal.view();
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(Json(view))
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum BundleState {
    Draft,
    Removed,
}

pub(super) fn bundle_state(
    parent: &Value,
    child: &Value,
    saved_parent: &Value,
    saved_child: &Value,
) -> Result<BundleState, ApiError> {
    for (current, saved) in [(parent, saved_parent), (child, saved_child)] {
        let receipt_fields = [
            "jobId",
            "requestId",
            "totalRows",
            "rowsImported",
            "errorRows",
        ];
        if receipt_fields
            .iter()
            .any(|field| current.get(*field).is_none() || current.get(*field) != saved.get(*field))
        {
            return Err(ApiError::Conflict(
                "The native import receipt identity changed.".into(),
            ));
        }
    }
    match (parent["status"].as_str(), child["status"].as_str()) {
        (Some("success"), Some("success"))
            if parent["records"] == saved_parent["records"]
                && child["records"] == saved_child["records"] =>
        {
            Ok(BundleState::Draft)
        }
        (Some("rolled_back"), Some("rolled_back")) => Ok(BundleState::Removed),
        _ => Err(ApiError::Conflict(
            "Both native receipts must confirm the same draft or rollback outcome.".into(),
        )),
    }
}

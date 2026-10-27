//! Authenticated read-only finance workflow snapshots. No reducer dispatch.
use crate::{
    error::ApiError,
    query_exec::{execute_resource_query_for_company, resolve_membership_company_id},
    state::AppState,
    trusted_context::TrustedOperationContext,
    web_session::OrgSession,
};
use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use lumiere_finance_review_core::{self as core, reviews as project, Input};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{str::FromStr, sync::Arc};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Request {
    company_id: u64,
    inputs: Value,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/finance-reviews/:skill", post(review))
}

fn invalid(error: impl std::fmt::Display) -> ApiError {
    ApiError::Unprocessable(error.to_string())
}

async fn rows(
    state: &AppState,
    ctx: &TrustedOperationContext,
    company: u64,
    resource: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = execute_resource_query_for_company(
        &state
            .stdb
            .with_query_limits(core::MAX_ROWS, core::MAX_BYTES)
            .map_err(ApiError::internal)?,
        resource,
        ctx.organization_id(),
        ctx.actor_identity(),
        Some(ctx.field_access()),
        Some(company),
    )
    .await?;
    if rows.len() > core::MAX_ROWS
        || serde_json::to_vec(&rows).map_err(ApiError::internal)?.len() > core::MAX_BYTES
    {
        return Err(ApiError::Unprocessable(
            "finance review source exceeds its bound".into(),
        ));
    }
    project::bounded(&rows, ctx.organization_id()).map_err(invalid)?;
    Ok(rows)
}

async fn preview(
    state: &AppState,
    ctx: &TrustedOperationContext,
    company: u64,
    key: core::ReportKey,
    date: &str,
    timezone: &str,
) -> Result<Value, ApiError> {
    use crate::reports::{
        auth::{ensure_report_access, mask_report_preview, ReportAccess},
        common::{ReportKey, ReportPreviewRequest},
        service::preview_report,
    };
    let key = ReportKey::from_str(key.as_str())
        .map_err(|_| ApiError::BadRequest("unknown report".into()))?;
    ensure_report_access(Some(ctx.field_access()), key, ReportAccess::Preview)?;
    let report = preview_report(
        &state
            .stdb
            .with_query_limits(core::MAX_ROWS, core::MAX_BYTES)
            .map_err(ApiError::internal)?,
        key,
        ctx.organization_id(),
        ctx.actor_identity(),
        ReportPreviewRequest {
            company_id: company,
            date: date.into(),
            timezone: timezone.into(),
            scenario: None,
        },
    )
    .await?;
    serde_json::to_value(mask_report_preview(report, Some(ctx.field_access())))
        .map_err(ApiError::internal)
}

async fn review(
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
    OrgSession {
        session,
        organization_id,
    }: OrgSession,
    Json(body): Json<Request>,
) -> Result<Json<Value>, ApiError> {
    let input = core::parse_input(&key, &body.inputs)
        .map_err(|_| ApiError::BadRequest("invalid finance review parameters".into()))?;
    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    context.require_current_placement(&state.organization_placements)?;
    let company = resolve_membership_company_id(
        &state.stdb,
        organization_id,
        context.actor_identity(),
        Some(body.company_id),
        "finance review company scope mismatch",
    )
    .await?;
    let context = context.with_company_scope(vec![company])?;
    let observation = match input {
        Input::Report(p) => {
            preview(
                &state,
                &context,
                company,
                p.report_key,
                &p.date,
                &p.timezone,
            )
            .await?
        }
        Input::Variance(p) => {
            let actual = preview(
                &state,
                &context,
                company,
                p.report_key,
                &p.actual_date,
                &p.timezone,
            )
            .await?;
            let baseline = preview(
                &state,
                &context,
                company,
                p.report_key,
                &p.baseline_date,
                &p.timezone,
            )
            .await?;
            project::variance(&actual, &baseline).map_err(invalid)?
        }
        Input::Bank(p) => {
            let statements = rows(&state, &context, company, "bank-statements").await?;
            project::scoped(
                project::exact(&statements, p.statement_id).map_err(invalid)?,
                organization_id,
                company,
            )
            .map_err(invalid)?;
            let lines = rows(&state, &context, company, "bank-statement-lines").await?;
            let candidates = rows(&state, &context, company, "bank-match-candidates").await?;
            let invoices = rows(&state, &context, company, "account-moves").await?;
            let payments = rows(&state, &context, company, "account-payments").await?;
            project::reconciliation(
                organization_id,
                company,
                p.statement_id,
                &statements,
                &lines,
                &candidates,
                &invoices,
                &payments,
            )
            .map_err(invalid)?
        }
        Input::Close(p) => {
            let periods = rows(&state, &context, company, "account-periods").await?;
            let moves = rows(&state, &context, company, "account-moves").await?;
            let statements = rows(&state, &context, company, "bank-statements").await?;
            let lines = rows(&state, &context, company, "bank-statement-lines").await?;
            project::close_readiness(
                organization_id,
                company,
                p.period_id,
                &periods,
                &moves,
                &statements,
                &lines,
            )
            .map_err(invalid)?
        }
        Input::Expense(p) => expense(&state, &context, &session, company, p).await?,
    };
    // Placement and membership are rechecked after reads, before returning data.
    context.require_current_placement(&state.organization_placements)?;
    resolve_membership_company_id(
        &state.stdb,
        organization_id,
        context.actor_identity(),
        Some(company),
        "finance review membership changed",
    )
    .await?;
    let response = json!({"schemaVersion":1,"skillKey":key,"organizationId":organization_id,"companyId":company,"observedAt":chrono::Utc::now().to_rfc3339(),"observation":observation});
    if serde_json::to_vec(&response)
        .map_err(ApiError::internal)?
        .len()
        > core::MAX_BYTES
    {
        return Err(ApiError::Unprocessable(
            "finance review output exceeds its bound".into(),
        ));
    }
    Ok(Json(response))
}

async fn expense(
    state: &AppState,
    ctx: &TrustedOperationContext,
    session: &crate::session::ApiSession,
    company: u64,
    input: core::ExpenseInput,
) -> Result<Value, ApiError> {
    let resource = if input.record_kind == core::ExpenseKind::Expense {
        "expenses"
    } else {
        "account-moves"
    };
    let records = rows(state, ctx, company, resource).await?;
    let row = project::exact(&records, input.record_id).map_err(invalid)?;
    project::scoped(row, ctx.organization_id(), company).map_err(invalid)?;
    let mut record = row.clone();
    let source = if input.record_kind == core::ExpenseKind::Expense {
        let attachments = project::field(row, "attachmentIds")
            .map_err(invalid)?
            .as_array()
            .ok_or_else(|| invalid("attachment IDs unavailable"))?;
        if attachments.is_empty() {
            json!({"status":"missing_attachment"})
        } else if attachments.len() != 1 {
            json!({"status":"ambiguous_sources","count":attachments.len()})
        } else {
            let receipt_id = attachments[0]
                .as_u64()
                .ok_or_else(|| invalid("invalid receipt identity"))?;
            let receipts = rows(state, ctx, company, "expense-receipts").await?;
            let receipt = project::exact(&receipts, receipt_id).map_err(invalid)?;
            project::scoped(receipt, ctx.organization_id(), company).map_err(invalid)?;
            if project::number(receipt, "employeeId").map_err(invalid)?
                != project::number(row, "employeeId").map_err(invalid)?
            {
                return Err(ApiError::Forbidden("receipt employee mismatch".into()));
            }
            let key = project::field(receipt, "storageKey")
                .map_err(invalid)?
                .as_str()
                .ok_or_else(|| invalid("receipt key unavailable"))?;
            let blob =
                crate::document_blobs::read_authorized_review_receipt(state, session, company, key)
                    .await?;
            let expected =
                project::option(project::field(receipt, "contentHash").map_err(invalid)?)
                    .map_err(invalid)?
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("receipt checksum unavailable"))?;
            if expected != blob.checksum {
                return Err(ApiError::Conflict("receipt checksum changed".into()));
            }
            let after_receipts = rows(state, ctx, company, "expense-receipts").await?;
            if project::exact(&after_receipts, receipt_id).map_err(invalid)? != receipt {
                return Err(ApiError::Conflict(
                    "receipt relation changed during review".into(),
                ));
            }
            source_text(blob, json!({"receiptId":receipt_id,"checksum":expected}))?
        }
    } else {
        let amount = project::field(row, "amountTotal").map_err(invalid)?.clone();
        record["totalAmount"] = amount;
        for (source, target) in [("amountUntaxed", "subtotal"), ("amountTax", "taxAmount")] {
            if let Ok(value) = project::field(row, source) {
                record[target] = value.clone();
            }
        }
        let documents = rows(state, ctx, company, "documents").await?;
        let linked = documents
            .iter()
            .filter(|d| {
                project::number(d, "resId").ok() == Some(input.record_id)
                    && project::tag(d, "resModel").ok().as_deref() == Some("account_move")
            })
            .collect::<Vec<_>>();
        if linked.is_empty() {
            json!({"status":"missing_attachment"})
        } else if linked.len() != 1 {
            json!({"status":"ambiguous_sources","count":linked.len()})
        } else {
            let document_id = project::number(linked[0], "id").map_err(invalid)?;
            project::scoped(linked[0], ctx.organization_id(), company).map_err(invalid)?;
            let versions = rows(state, ctx, company, "document-versions").await?;
            let current = versions
                .iter()
                .filter(|v| {
                    project::number(v, "documentId").ok() == Some(document_id)
                        && project::boolean(v, "isCurrent").ok() == Some(true)
                })
                .collect::<Vec<_>>();
            if current.len() != 1 {
                return Err(ApiError::Conflict(
                    "bill source version is unavailable or ambiguous".into(),
                ));
            }
            let version = current[0];
            let url = project::field(version, "url")
                .map_err(invalid)?
                .as_str()
                .ok_or_else(|| invalid("source URL unavailable"))?;
            let checksum = project::field(version, "checksum")
                .map_err(invalid)?
                .as_str()
                .ok_or_else(|| invalid("source checksum unavailable"))?;
            let blob = crate::document_blobs::read_authorized_document_blob(
                state,
                session,
                company,
                document_id,
                url,
            )
            .await?;
            if blob.checksum != checksum {
                return Err(ApiError::Conflict("source checksum changed".into()));
            }
            let after = rows(state, ctx, company, "document-versions").await?;
            let current_after = after
                .iter()
                .filter(|v| {
                    project::number(v, "documentId").ok() == Some(document_id)
                        && project::boolean(v, "isCurrent").ok() == Some(true)
                })
                .collect::<Vec<_>>();
            if current_after.len() != 1 || current_after[0] != version {
                return Err(ApiError::Conflict(
                    "source version changed during review".into(),
                ));
            }
            source_text(
                blob,
                json!({"documentId":document_id,"versionId":project::number(version,"id").map_err(invalid)?,"checksum":checksum}),
            )?
        }
    };
    let after = rows(state, ctx, company, resource).await?;
    if project::exact(&after, input.record_id).map_err(invalid)? != row {
        return Err(ApiError::Conflict(
            "saved record changed during evidence review".into(),
        ));
    }
    project::expense_comparison(&record, &source).map_err(invalid)
}

fn source_text(
    blob: crate::document_blobs::CompletedBlob,
    reference: Value,
) -> Result<Value, ApiError> {
    let extracted =
        crate::evidence_ingestion::extract_server_owned_text(&blob.content_type, &blob.bytes);
    match extracted {
        Ok(Some(text)) => Ok(
            json!({"status":"available","reference":reference,"processor":"server-owned-text-v1","text":text}),
        ),
        Ok(None) => Ok(
            json!({"status":"unavailable_extraction","reference":reference,"reason":"OCR is not invoked by this read"}),
        ),
        Err(ApiError::Unprocessable(_)) => Ok(json!({"status":"unreadable","reference":reference})),
        Err(error) => Err(error),
    }
}

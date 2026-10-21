//! `/v1/mail/*` — dispatch queued outbound emails via Resend.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tower_cookies::Cookies;

use super::documents::accounting::{
    invoice_revision_matches, render_account_move_pdf, InvoicePdfReview,
};
use crate::commands::{
    authorize_reducer_company_scope, dispatch_reviewed_mail_mutation, ReviewedMailDeliveryAuthority,
};
use crate::document_render::invoice::row_u64;
use crate::error::ApiError;
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::{require_org, resolve_session};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/mail/dispatch-queued", post(dispatch_queued_mail))
        .route(
            "/mail/messages/:message_id/dispatch",
            post(dispatch_reviewed_mail),
        )
}

fn row_id(row: &Value) -> Option<u64> {
    row.get("id")
        .and_then(|v| v.as_u64())
        .or_else(|| row.get("id").and_then(|v| v.as_str())?.parse().ok())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ReviewedDispatchRequest {
    review_id: String,
}

struct ReviewedDispatch {
    company_id: u64,
    move_id: u64,
    review_id: String,
    revision: Vec<Value>,
    recipient: String,
    subject: String,
    text: String,
    attach_pdf: bool,
    filename: String,
}

fn reviewed_dispatch(
    row: &Value,
    org_id: u64,
    review_id: &str,
) -> Result<ReviewedDispatch, ApiError> {
    let fail = || {
        ApiError::Conflict("queued email does not match the exact readable invoice review".into())
    };
    if row_u64(row, &["organizationId", "organization_id"]) != Some(org_id)
        || row.get("model").and_then(Value::as_str) != Some("account_move")
    {
        return Err(fail());
    }
    let metadata: Value = serde_json::from_str(
        row.get("metadata")
            .and_then(Value::as_str)
            .ok_or_else(fail)?,
    )
    .map_err(|_| fail())?;
    if metadata.get("delivery").and_then(Value::as_str) != Some("queued") {
        return Err(ApiError::Conflict(
            "email is already claimed or sent; inspect its original status without retrying".into(),
        ));
    }
    let raw = metadata
        .get("context_json")
        .and_then(Value::as_str)
        .filter(|raw| raw.len() <= 131_072)
        .ok_or_else(fail)?;
    let context: Value = serde_json::from_str(raw).map_err(|_| fail())?;
    let review = context.get("invoiceReview").ok_or_else(fail)?;
    let version = review
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .filter(|value| matches!(value, 1 | 2))
        .ok_or_else(fail)?;
    let id = |key: &str| {
        review.get(key).and_then(Value::as_str).and_then(|value| {
            value
                .parse::<u64>()
                .ok()
                .filter(|id| *id > 0 && id.to_string() == value)
        })
    };
    let company_id = id("companyId").ok_or_else(fail)?;
    let move_id = id("moveId").ok_or_else(fail)?;
    let template_id = id("templateId").ok_or_else(fail)?;
    if id("organizationId") != Some(org_id)
        || row_u64(row, &["resId", "res_id"]) != Some(move_id)
        || review.get("reviewId").and_then(Value::as_str) != Some(review_id)
        || review_id.trim().is_empty()
        || review_id.len() > 128
        || review_id.chars().any(char::is_control)
        || row_u64(&metadata, &["mail_template_id"]) != Some(template_id)
    {
        return Err(fail());
    }
    let field = |key: &str| review.get(key).and_then(Value::as_str).ok_or_else(fail);
    let subject = field(if version == 2 {
        "subject"
    } else {
        "expectedSubject"
    })?
    .to_string();
    let text = field(if version == 2 {
        "bodyText"
    } else {
        "expectedBodyHtml"
    })?
    .to_string();
    let attach_pdf = review
        .get("pdfAttached")
        .and_then(Value::as_bool)
        .ok_or_else(fail)?;
    let filename = field("pdfFilename")?.to_string();
    let recipient = metadata
        .get("to")
        .and_then(Value::as_str)
        .ok_or_else(fail)?
        .to_string();
    if filename != format!("account-move-{move_id}.pdf")
        || version == 1 && attach_pdf
        || metadata.get("subject").and_then(Value::as_str) != Some(subject.as_str())
        || metadata.get("html").and_then(Value::as_str) != Some(text.as_str())
        || row.get("body").and_then(Value::as_str) != Some(text.as_str())
        || metadata.get("attach_document").and_then(Value::as_bool) != Some(attach_pdf)
        || subject.trim().is_empty()
        || subject.len() > 4096
        || subject.chars().any(char::is_control)
        || text.trim().is_empty()
        || text.len() > 65_536
        || recipient.is_empty()
        || recipient.len() > 254
        || recipient != recipient.trim()
        || recipient.split('@').count() != 2
        || recipient.starts_with('@')
        || recipient.ends_with('@')
        || recipient
            .chars()
            .any(|value| value.is_whitespace() || value.is_control() || matches!(value, '<' | '>'))
    {
        return Err(fail());
    }
    let revision: Vec<Value> =
        serde_json::from_str(field("recordRevision")?.trim()).map_err(|_| fail())?;
    if revision.len() != 7 {
        return Err(fail());
    }
    Ok(ReviewedDispatch {
        company_id,
        move_id,
        review_id: review_id.into(),
        revision,
        recipient,
        subject,
        text,
        attach_pdf,
        filename,
    })
}

fn reviewed_provider_payload(
    from: &str,
    reviewed: &ReviewedDispatch,
    pdf: Option<&[u8]>,
) -> Result<Vec<u8>, ApiError> {
    let mut payload = json!({ "from": from, "to": [&reviewed.recipient], "subject": reviewed.subject, "text": reviewed.text });
    if reviewed.attach_pdf {
        let pdf = pdf
            .filter(|bytes| bytes.starts_with(b"%PDF-") && bytes.len() <= 8 * 1024 * 1024)
            .ok_or_else(|| ApiError::Unavailable("reviewed invoice PDF is unavailable".into()))?;
        payload["attachments"] = json!([{ "filename": reviewed.filename, "content": base64::engine::general_purpose::STANDARD.encode(pdf), "content_type": "application/pdf" }]);
    } else if pdf.is_some() {
        return Err(ApiError::Conflict(
            "unreviewed PDF attachment was supplied".into(),
        ));
    }
    serde_json::to_vec(&payload).map_err(ApiError::internal)
}

/// Provider transport accepts already frozen bytes and never retries. A test endpoint
/// can be injected here without exposing a caller-selected URL in the HTTP route.
async fn send_reviewed_payload(
    http: &reqwest::Client,
    endpoint: &str,
    key: &str,
    idempotency_key: &str,
    payload: Vec<u8>,
) -> Result<Option<String>, ()> {
    let response = http
        .post(endpoint)
        .header("Authorization", format!("Bearer {key}"))
        .header("Idempotency-Key", idempotency_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .timeout(std::time::Duration::from_secs(30))
        .body(payload)
        .send()
        .await
        .map_err(|_| ())?;
    if !response.status().is_success() {
        return Err(());
    }
    // Acceptance is recorded separately from recipient delivery; no arbitrary provider response is persisted.
    let metadata = response.json::<Value>().await.ok();
    Ok(metadata.and_then(|value| {
        value
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| id.len() <= 256)
            .map(str::to_string)
    }))
}

async fn dispatch_reviewed_mail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(message_id): Path<u64>,
    Json(request): Json<ReviewedDispatchRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let org_id = require_org(&session)?;
    let resend_key = std::env::var("RESEND_API_KEY").unwrap_or_default();
    if resend_key.trim().is_empty() {
        return Err(ApiError::Unavailable(
            "outbound email provider is not configured".into(),
        ));
    }
    let from = std::env::var("RESEND_FROM_EMAIL")
        .unwrap_or_else(|_| "Lumiere ERP <onboarding@resend.dev>".into());
    let trusted = TrustedOperationContext::for_resource_read(&state, &session)?;
    if !stdb_auth::has_resource_read_permission(session.field_access.as_ref(), "mail-messages") {
        return Err(ApiError::Forbidden(
            "email message read access is required".into(),
        ));
    }
    let registry = stdb_auth::registry_get("mail-messages")
        .ok_or_else(|| ApiError::Internal("mail message read contract is unavailable".into()))?;
    let sql = stdb_auth::select_org_scoped_sql(
        "mail-messages",
        &registry.table,
        org_id,
        session.field_access.as_ref(),
        &format!(" AND id = {message_id}"),
        " LIMIT 2",
    )
    .map_err(ApiError::Internal)?;
    let rows = trusted
        .client()
        .query_sql(&sql)
        .await
        .map_err(ApiError::internal)?;
    let mut matching = rows.iter().filter(|row| row_id(row) == Some(message_id));
    let row = matching
        .next()
        .ok_or_else(|| ApiError::NotFound("reviewed mail message not found".into()))?;
    if matching.next().is_some() {
        return Err(ApiError::Conflict(
            "reviewed mail message is ambiguous".into(),
        ));
    }
    let reviewed = reviewed_dispatch(row, org_id, &request.review_id)?;
    authorize_reducer_company_scope(&trusted, vec![reviewed.company_id]).await?;
    let delivery_authority = ReviewedMailDeliveryAuthority::prepare(&state, org_id).await?;
    let pdf = if reviewed.attach_pdf {
        Some(
            render_account_move_pdf(
                &state,
                &session,
                reviewed.move_id,
                Some(InvoicePdfReview {
                    organization_id: org_id,
                    company_id: reviewed.company_id,
                    revision: &reviewed.revision,
                }),
            )
            .await?,
        )
    } else {
        let row = crate::query_exec::execute_authorized_resource_record(
            trusted.client(),
            "account-moves",
            org_id,
            reviewed.company_id,
            reviewed.move_id,
            session.field_access.as_ref(),
        )
        .await?
        .ok_or_else(|| ApiError::Conflict("reviewed invoice is unavailable".into()))?;
        if !invoice_revision_matches(&row, &reviewed.revision) {
            return Err(ApiError::Conflict(
                "invoice changed after email review".into(),
            ));
        }
        None
    };
    let payload = reviewed_provider_payload(&from, &reviewed, pdf.as_deref())?;
    let request_digest = hex::encode(Sha256::digest(&payload));
    let idempotency_key = format!(
        "lumiere-mail-{org_id}-{message_id}-{}",
        hex::encode(Sha256::digest(
            format!("{}:{request_digest}", reviewed.review_id).as_bytes()
        ))
    );
    // The module checks the latest invoice/template revision atomically after rendering,
    // then consumes the queued state. Lost claim acknowledgments never lead to provider I/O.
    dispatch_reviewed_mail_mutation(
        &state,
        &session,
        reviewed.company_id,
        "claim_reviewed_mail_delivery",
        json!([
            org_id,
            reviewed.company_id,
            message_id,
            reviewed.review_id,
            request_digest
        ]),
    )
    .await?;
    let accepted = send_reviewed_payload(
        &state.http,
        "https://api.resend.com/emails",
        &resend_key,
        &idempotency_key,
        payload,
    )
    .await;
    let Ok(provider_id) = accepted else {
        return Ok((
            StatusCode::ACCEPTED,
            Json(
                json!({ "status": "unknown", "messageId": message_id.to_string(),
            "message": "Provider acceptance is unconfirmed. This request remains claimed and will not be sent again automatically." }),
            ),
        ));
    };
    if delivery_authority
        .record_acceptance(
            &state,
            message_id,
            &reviewed.review_id,
            &request_digest,
            provider_id,
        )
        .await
        .is_err()
    {
        return Ok((
            StatusCode::ACCEPTED,
            Json(
                json!({ "status": "unknown", "messageId": message_id.to_string(),
            "message": "The provider accepted this request, but its dispatch record is unconfirmed. Inspect the original request without sending another copy." }),
            ),
        ));
    }
    Ok((
        StatusCode::OK,
        Json(
            json!({ "status": "dispatched", "messageId": message_id.to_string(), "recipientDeliveryConfirmed": false }),
        ),
    ))
}

/// The legacy batch route cannot prove a single reviewed provider claim. Keep
/// it permanently disabled rather than sending before a denied receipt write.
async fn dispatch_queued_mail() -> (StatusCode, Json<Value>) {
    (
        StatusCode::GONE,
        Json(json!({
            "error": "Batch email dispatch is unavailable. Open the invoice, review its email, then send that single reviewed message.",
            "code": "reviewed_message_dispatch_required",
        })),
    )
}

#[cfg(test)]
mod reviewed_dispatch_tests {
    use super::*;

    #[tokio::test]
    async fn legacy_batch_route_is_gone_without_any_credentials_or_provider_work() {
        let (status, Json(body)) = dispatch_queued_mail().await;
        assert_eq!(status, StatusCode::GONE);
        assert_eq!(body["code"], "reviewed_message_dispatch_required");
        assert!(body["error"]
            .as_str()
            .expect("message")
            .contains("single reviewed message"));
    }

    fn row() -> Value {
        let context = json!({ "invoiceReview": { "schemaVersion": 2, "reviewId": "review-1", "organizationId": "1", "companyId": "2",
            "moveId": "3", "templateId": "4", "subject": "One-off reminder", "bodyText": "Plain <script>text</script>",
            "pdfFilename": "account-move-3.pdf", "pdfAttached": true,
            "expectedSubject": "Template subject", "expectedBodyHtml": "Template body", "expectedAttachDocument": false,
            "recordRevision": "[\"Posted\",\"OutInvoice\",100,\"5\",\"INV/3\",\"Buyer\",null]" } });
        json!({ "id": 10, "organization_id": 1, "model": "account_move", "res_id": 3, "body": "Plain <script>text</script>",
            "metadata": json!({"delivery":"queued", "to":"alpha@example.test", "subject":"One-off reminder", "html":"Plain <script>text</script>",
                "attach_document":true, "mail_template_id":4, "context_json":context.to_string()}).to_string() })
    }

    #[test]
    fn reviewed_payload_uses_exact_plain_text_and_real_managed_pdf_bytes() {
        let reviewed = reviewed_dispatch(&row(), 1, "review-1").expect("review");
        let bytes = b"%PDF-1.7\nmanaged invoice bytes";
        let frozen =
            reviewed_provider_payload("Sender <sender@example.test>", &reviewed, Some(bytes))
                .expect("payload");
        let payload: Value = serde_json::from_slice(&frozen).expect("json");
        assert_eq!(payload["subject"], "One-off reminder");
        assert_eq!(payload["text"], "Plain <script>text</script>");
        assert!(payload.get("html").is_none());
        assert_eq!(payload["attachments"][0]["filename"], "account-move-3.pdf");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(
                    payload["attachments"][0]["content"]
                        .as_str()
                        .expect("base64")
                )
                .expect("decode"),
            bytes
        );
        assert!(reviewed_provider_payload("Sender", &reviewed, None).is_err());
        assert!(reviewed_provider_payload("Sender", &reviewed, Some(b"not a pdf")).is_err());
        assert_ne!(
            Sha256::digest(&frozen),
            Sha256::digest(b"another reviewed payload")
        );
    }

    #[test]
    fn exact_review_scope_payload_and_unclaimed_lifecycle_are_required() {
        assert!(reviewed_dispatch(&row(), 9, "review-1").is_err());
        assert!(reviewed_dispatch(&row(), 1, "review-other").is_err());
        for (key, value) in [
            ("delivery", json!("dispatching")),
            ("delivery", json!("sent")),
            ("subject", json!("Unreviewed subject")),
            ("attach_document", json!(false)),
            ("to", json!("injected\r\nBcc: victim@example.test")),
        ] {
            let mut row = row();
            let mut metadata: Value =
                serde_json::from_str(row["metadata"].as_str().expect("metadata")).expect("json");
            metadata[key] = value;
            row["metadata"] = json!(metadata.to_string());
            assert!(reviewed_dispatch(&row, 1, "review-1").is_err(), "{key}");
        }
    }

    #[test]
    fn snapshot_revision_rejects_changed_or_redacted_authoritative_fields() {
        let review = reviewed_dispatch(&row(), 1, "review-1").expect("review");
        let record = json!({"state":{"posted":[]}, "move_type":{"out_invoice":[]}, "amount_total":100.0,
            "currency_id":5,"name":"INV/3","invoice_partner_display_name":"Buyer","metadata":null});
        assert!(invoice_revision_matches(&record, &review.revision));
        for key in [
            "state",
            "move_type",
            "amount_total",
            "currency_id",
            "name",
            "invoice_partner_display_name",
            "metadata",
        ] {
            let mut redacted = record.clone();
            redacted.as_object_mut().expect("record").remove(key);
            assert!(
                !invoice_revision_matches(&redacted, &review.revision),
                "{key}"
            );
        }
        let mut changed = record;
        changed["metadata"] = json!("changed issued document snapshot");
        assert!(!invoice_revision_matches(&changed, &review.revision));
    }

    #[tokio::test]
    async fn injected_provider_receives_frozen_payload_and_idempotency_key_once() {
        use axum::{body::Bytes, extract::State};
        use std::sync::Mutex;
        let captured = Arc::new(Mutex::new(Vec::<(HeaderMap, Vec<u8>)>::new()));
        let output = captured.clone();
        let app = Router::new()
            .route(
                "/emails",
                post(
                    |State(captured): State<Arc<Mutex<Vec<(HeaderMap, Vec<u8>)>>>>,
                     headers: HeaderMap,
                     body: Bytes| async move {
                        captured
                            .lock()
                            .expect("capture")
                            .push((headers, body.to_vec()));
                        (StatusCode::OK, Json(json!({"id":"mock-acceptance"})))
                    },
                ),
            )
            .with_state(output);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listen");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move { axum::serve(listener, app).await.expect("serve") });
        let reviewed = reviewed_dispatch(&row(), 1, "review-1").expect("review");
        let payload = reviewed_provider_payload(
            "sender@example.test",
            &reviewed,
            Some(b"%PDF-1.7\nreal bytes"),
        )
        .expect("payload");
        let accepted = send_reviewed_payload(
            &reqwest::Client::builder()
                .no_proxy()
                .build()
                .expect("client"),
            &format!("http://{address}/emails"),
            "mock-key",
            "message-review-payload-digest",
            payload.clone(),
        )
        .await;
        assert!(accepted.is_ok());
        let captured = captured.lock().expect("captured");
        assert_eq!(captured.len(), 1);
        assert_eq!(
            captured[0].0.get("idempotency-key").expect("key"),
            "message-review-payload-digest"
        );
        assert_eq!(captured[0].1, payload);
        server.abort();
    }

    #[tokio::test]
    async fn provider_failure_is_redacted_and_never_retried_by_transport() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let requests = Arc::new(AtomicUsize::new(0));
        let count = requests.clone();
        let app = Router::new().route(
            "/emails",
            post(move || {
                let count = count.clone();
                async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    (StatusCode::SERVICE_UNAVAILABLE, "sensitive provider error")
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listen");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move { axum::serve(listener, app).await.expect("serve") });
        let result = send_reviewed_payload(
            &reqwest::Client::builder()
                .no_proxy()
                .build()
                .expect("client"),
            &format!("http://{address}/emails"),
            "mock-key",
            "original-claim",
            b"{}".to_vec(),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        server.abort();
    }
}

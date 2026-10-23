//! Explicit user-reviewed WhatsApp dispatch. Request input never grants authority.
mod source;
pub(super) mod storage;
mod triage;

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_cookies::Cookies;

use super::{
    outbound::{
        policy::{Eligibility, FreshAuthorization, ReviewedMessage},
        send_once, SendOutcome,
    },
    protocol::{field, row_u64, text},
    require_enabled, store,
};
use crate::{cold_tier::pg_pool, error::ApiError, state::AppState};
use source::Choice;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scope {
    company_id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreviewRequest {
    company_id: String,
    choice: Choice,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DispatchRequest {
    company_id: String,
    review_id: String,
}

fn company(value: &str) -> Result<u64, ApiError> {
    value
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::BadRequest("invalid company identifier".into()))
}

fn now_seconds() -> u64 {
    chrono::Utc::now().timestamp().max(0) as u64
}

fn send_enabled() -> Result<(), ApiError> {
    require_enabled()?;
    if std::env::var("LUMIERE_WHATSAPP_SEND_ENABLED").as_deref() != Ok("1") {
        return Err(ApiError::Unavailable("WhatsApp sending is disabled".into()));
    }
    Ok(())
}

fn pool() -> Result<&'static deadpool_postgres::Pool, ApiError> {
    pg_pool::required_pool()
        .map_err(|_| ApiError::Unavailable("WhatsApp storage is unavailable".into()))
}

async fn options(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(message_id): Path<u64>,
    Query(scope): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    send_enabled()?;
    store::verify(pool()?)
        .await
        .map_err(|_| ApiError::Unavailable("WhatsApp migration is required".into()))?;
    let source = source::load(
        &state,
        &headers,
        &cookies,
        scope.company_id,
        message_id,
        &Choice::Reply,
    )
    .await?;
    let now = now_seconds();
    let window_open = source
        .eligibility
        .last_customer_message_seconds
        .is_some_and(|last| last <= now && now - last < 86400);
    let transport_state = storage::state(
        pool()?,
        source.message.organization_id,
        scope.company_id,
        source.message.operational_message_id,
    )
    .await
    .map_err(|_| ApiError::Unavailable("WhatsApp status is unavailable".into()))?;
    Ok(Json(json!({
        "messageId":message_id.to_string(), "body":match &source.message.content {
            super::outbound::policy::Content::Reply(body) => body.as_str(), _ => "",
        },
        "senderName":source.sender_name, "recipient":source.masked_recipient,
        "replyWindowOpen":window_open, "optedOut":source.eligibility.opted_out,
        "quietHoursAllow":source.eligibility.quiet_hours_allow,
        "templates":source.templates, "transport":transport_state,
        "dailyLimit":source.daily_limit,
    })))
}

async fn preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(message_id): Path<u64>,
    Json(request): Json<PreviewRequest>,
) -> Result<Json<Value>, ApiError> {
    send_enabled()?;
    let company = company(&request.company_id)?;
    let mut source = source::load(
        &state,
        &headers,
        &cookies,
        company,
        message_id,
        &request.choice,
    )
    .await?;
    let review = storage::save(pool()?, &mut source, &request.choice)
        .await
        .map_err(|_| {
            ApiError::Conflict(
                "message is ineligible, already attempted, or review storage is unavailable".into(),
            )
        })?;
    let body = source.body.clone();
    Ok(Json(json!({
        "reviewId":review.id, "messageId":message_id.to_string(),
        "senderName":source.sender_name, "recipient":source.masked_recipient,
        "body":body, "expiresInSeconds":600, "choice":request.choice,
        "notice":"Confirmation sends this exact message once. Provider acceptance is not delivery.",
    })))
}

struct Guard<'a> {
    state: &'a Arc<AppState>,
    headers: &'a HeaderMap,
    cookies: &'a Cookies,
    review: &'a storage::Review,
}

impl FreshAuthorization for Guard<'_> {
    async fn refresh(&self, message: &ReviewedMessage) -> anyhow::Result<Eligibility> {
        send_enabled()?;
        let current = storage::review(
            pool()?,
            message.organization_id,
            self.review.company_id,
            self.review.message_id,
            &self.review.actor,
            &self.review.id,
        )
        .await?;
        let mut source = source::load(
            self.state,
            self.headers,
            self.cookies,
            current.company_id,
            current.message_id,
            &current.choice,
        )
        .await?;
        storage::check_source(&current, &mut source)?;
        Ok(source.eligibility)
    }
}

async fn dispatch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(message_id): Path<u64>,
    Json(request): Json<DispatchRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    send_enabled()?;
    let company = company(&request.company_id)?;
    let context = source::context(&state, &headers, &cookies, company, true).await?;
    let org = context.organization_id();
    let review = storage::review(
        pool()?,
        org,
        company,
        message_id,
        context.actor_identity(),
        &request.review_id,
    )
    .await
    .map_err(|_| ApiError::Conflict("review expired or is not available in this scope".into()))?;
    let mut source = source::load(
        &state,
        &headers,
        &cookies,
        company,
        message_id,
        &review.choice,
    )
    .await?;
    storage::check_source(&review, &mut source).map_err(|_| {
        ApiError::Conflict("message or permissions changed; review again before sending".into())
    })?;
    let guard = Guard {
        state: &state,
        headers: &headers,
        cookies: &cookies,
        review: &review,
    };
    let transport = source::transport()?;
    let result = send_once(
        pool()?,
        &transport,
        &source.message,
        &source.token,
        source.daily_limit,
        &guard,
    )
    .await;
    // A send error can follow a committed claim. Never encourage a blind retry.
    let status = match result {
        Ok(SendOutcome::Accepted(_)) => "accepted",
        Ok(SendOutcome::Rejected) => "rejected",
        Ok(SendOutcome::AlreadyAttempted) => "already_attempted",
        Ok(SendOutcome::Unknown) | Err(_) => "unknown",
    };
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "state":status, "messageId":message_id.to_string(), "canAutomaticallyRetry":false,
            "notice":"Check message status before taking further action. This message will not be resent automatically.",
        })),
    ))
}

async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Path(message_id): Path<u64>,
    Query(scope): Query<Scope>,
) -> Result<Json<Value>, ApiError> {
    require_enabled()?;
    let context = source::context(&state, &headers, &cookies, scope.company_id, false).await?;
    let row = source::read(
        &state,
        &context,
        scope.company_id,
        "crm-conversation-messages",
        message_id,
    )
    .await?;
    let transport = match row_u64(&row, "operational_message_id") {
        Some(id) => storage::state(pool()?, context.organization_id(), scope.company_id, id)
            .await
            .map_err(|_| {
                ApiError::Unavailable("dispatch status is unavailable; do not resend".into())
            })?,
        None => json!({"state":"not_linked","providerAccepted":false}),
    };
    Ok(Json(json!({
        "messageId":message_id.to_string(), "deliveryState":field(&row, "status"),
        "transport":transport,
    })))
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/whatsapp/messages/:message_id/options", get(options))
        .route("/whatsapp/messages/:message_id/preview", post(preview))
        .route("/whatsapp/messages/:message_id/dispatch", post(dispatch))
        .route("/whatsapp/messages/:message_id/status", get(status))
        .merge(triage::router())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_requests_cannot_supply_recipient_authority_or_provider_ids() {
        assert!(serde_json::from_value::<DispatchRequest>(json!({
            "companyId":"1","reviewId":"a","recipient":"250700000000"
        }))
        .is_err());
        assert!(serde_json::from_value::<PreviewRequest>(json!({
            "companyId":"1","choice":{"mode":"reply"},"actorCanSend":true
        }))
        .is_err());
        assert!(company("0").is_err());
        assert!(company("1 OR 1=1").is_err());
        assert_eq!(company("9007199254740993").unwrap(), 9007199254740993);
    }
}

//! Current actor, field, company, recipient and sender authority for one message.
use std::sync::Arc;

use axum::http::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tower_cookies::Cookies;

use super::super::{
    inbound,
    outbound::{
        meta,
        policy::{Content, Eligibility, ReviewedMessage},
        MetaTransport,
    },
    protocol::{absent, enum_tag, field, fingerprint, optional_id, row_u64, text},
};
use crate::{
    cold_tier::pg_pool, commands::authorize_reducer_company_scope, error::ApiError,
    state::AppState, trusted_context::TrustedOperationContext, web_session::resolve_session,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum Choice {
    Reply,
    Template {
        #[serde(rename = "templateId")]
        template_id: String,
        parameters: Vec<String>,
    },
}

pub(super) struct Source {
    pub actor: String,
    pub conversation_id: u64,
    pub message_id: u64,
    pub message: ReviewedMessage,
    pub eligibility: Eligibility,
    pub digest: String,
    pub token: String,
    pub sender_name: String,
    pub body: String,
    pub masked_recipient: String,
    pub daily_limit: u32,
    pub templates: Vec<meta::Template>,
}

pub(super) async fn context(
    state: &AppState,
    headers: &HeaderMap,
    cookies: &Cookies,
    company: u64,
    sending: bool,
) -> Result<TrustedOperationContext, ApiError> {
    let session = resolve_session(state, headers, cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let context = TrustedOperationContext::for_resource_read(state, &session)?;
    if company == 0 {
        return Err(ApiError::BadRequest("company is required".into()));
    }
    authorize_reducer_company_scope(&context, vec![company]).await?;
    context.require_current_placement(&state.organization_placements)?;
    let access = context.field_access();
    if !stdb_auth::permission_allowed(access, "operational_message", "read")
        || (sending && !stdb_auth::permission_allowed(access, "operational_message", "send"))
    {
        return Err(ApiError::Forbidden(
            "WhatsApp message permission is required".into(),
        ));
    }
    context.with_company_scope(vec![company])
}

/// Private owner reads happen only after actor, resource and field authorization.
/// Missing/redacted values remain unavailable; they never become default facts.
pub(super) async fn read(
    state: &AppState,
    context: &TrustedOperationContext,
    company: u64,
    resource: &str,
    id: u64,
) -> Result<Value, ApiError> {
    if id == 0 || !stdb_auth::has_resource_read_permission(Some(context.field_access()), resource) {
        return Err(ApiError::Forbidden("message source is restricted".into()));
    }
    let registry = stdb_auth::registry_get(resource)
        .ok_or_else(|| ApiError::Unavailable("message read contract is unavailable".into()))?;
    let sql = stdb_auth::select_org_scoped_sql(
        resource,
        &registry.table,
        context.organization_id(),
        Some(context.field_access()),
        &format!(" AND id = {id} AND company_id = {company}"),
        " LIMIT 2",
    )
    .map_err(ApiError::Internal)?;
    let rows = state
        .stdb
        .query_sql(&sql)
        .await
        .map_err(ApiError::unavailable)?;
    let [row] = rows.as_slice() else {
        return Err(ApiError::NotFound("message source is unavailable".into()));
    };
    if row_u64(row, "organization_id") != Some(context.organization_id())
        || optional_id(row, "company_id")? != Some(company)
    {
        return Err(ApiError::Forbidden(
            "message source scope is restricted".into(),
        ));
    }
    Ok(row.clone())
}

fn message_body<'a>(row: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    field(row, key)
        .and_then(Value::as_str)
        .filter(|body| !body.trim().is_empty() && body.len() <= 4000)
        .ok_or_else(|| {
            ApiError::Forbidden("message content is unavailable or exceeds its limit".into())
        })
}

fn id(row: &Value, key: &str) -> Result<u64, ApiError> {
    row_u64(row, key).filter(|id| *id > 0).ok_or_else(|| {
        ApiError::Conflict(format!("message lacks {key}; queue a new reviewed message"))
    })
}

pub(super) fn transport() -> Result<MetaTransport, ApiError> {
    let version = std::env::var("LUMIERE_WHATSAPP_GRAPH_VERSION")
        .map_err(|_| ApiError::Unavailable("Meta Graph version is not configured".into()))?;
    MetaTransport::new(&version)
        .map_err(|_| ApiError::Unavailable("invalid Meta Graph version".into()))
}

fn quiet_minute_allowed(start: u32, end: u32, minute: u32) -> bool {
    if start < end {
        minute < start || minute >= end
    } else if start > end {
        minute >= end && minute < start
    } else {
        false
    }
}

fn quiet_hours(preference: &Value, org: u64, account: u64) -> Result<bool, ApiError> {
    use chrono::Timelike;
    let start = field(preference, "quiet_hours_start");
    let end = field(preference, "quiet_hours_end");
    if start.is_some_and(absent) && end.is_some_and(absent) {
        return Ok(true);
    }
    let parse = |value: Option<&Value>| -> Option<u32> {
        let value = value?.as_str()?;
        let (hours, minutes) = value.split_once(':')?;
        let (hours, minutes) = (hours.parse::<u32>().ok()?, minutes.parse::<u32>().ok()?);
        (hours < 24 && minutes < 60).then_some(hours * 60 + minutes)
    };
    let (Some(start), Some(end)) = (parse(start), parse(end)) else {
        return Err(ApiError::Forbidden(
            "quiet-hour policy is restricted".into(),
        ));
    };
    let encoded = std::env::var("LUMIERE_WHATSAPP_TIMEZONES").unwrap_or_default();
    let zones: Value = serde_json::from_str(&encoded).unwrap_or(Value::Null);
    let key = format!("{org}:{account}");
    let zone = zones
        .get(key.as_str())
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<chrono_tz::Tz>().ok())
        .ok_or_else(|| {
            ApiError::Unavailable("sender quiet-hour timezone is not configured".into())
        })?;
    let now = chrono::Utc::now().with_timezone(&zone);
    Ok(quiet_minute_allowed(
        start,
        end,
        now.hour() * 60 + now.minute(),
    ))
}

fn identity_eligible(identity: &Value) -> bool {
    field(identity, "archived_at").is_some_and(absent)
        && matches!(
            field(identity, "kind").and_then(enum_tag),
            Some("WhatsApp" | "Primary")
        )
        && field(identity, "verification_state")
            .and_then(enum_tag)
            .is_some_and(|state| !matches!(state, "OptedOut" | "opted_out"))
}

pub(super) async fn load(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    cookies: &Cookies,
    company: u64,
    message_id: u64,
    choice: &Choice,
) -> Result<Source, ApiError> {
    let context = context(state, headers, cookies, company, true).await?;
    let org = context.organization_id();
    let message = read(
        state,
        &context,
        company,
        "crm-conversation-messages",
        message_id,
    )
    .await?;
    if text(&message, "direction")? != "outbound" || text(&message, "status")? != "queued" {
        return Err(ApiError::Conflict(
            "only queued outgoing messages can be reviewed".into(),
        ));
    }
    let conversation_id = id(&message, "conversation_id")?;
    let conversation = read(
        state,
        &context,
        company,
        "crm-conversations",
        conversation_id,
    )
    .await?;
    if field(&conversation, "channel").and_then(enum_tag) != Some("WhatsApp")
        || text(&conversation, "status")? != "open"
    {
        return Err(ApiError::Conflict(
            "open WhatsApp conversation required".into(),
        ));
    }
    let account_id = id(&conversation, "provider_account_id")?;
    let identity_id = id(&conversation, "phone_identity_id")?;
    let contact_id = id(&conversation, "contact_id")?;
    let operational_id = id(&message, "operational_message_id")?;
    let identity = read(
        state,
        &context,
        company,
        "contact-phone-identities",
        identity_id,
    )
    .await?;
    let contact = read(state, &context, company, "contacts", contact_id).await?;
    let operational = read(
        state,
        &context,
        company,
        "operational-messages",
        operational_id,
    )
    .await?;
    if !field(&contact, "deleted_at").is_some_and(absent)
        || !field(&contact, "merge_target_id").is_some_and(absent)
        || !identity_eligible(&identity)
        || id(&identity, "contact_id")? != contact_id
        || id(&operational, "contact_id")? != contact_id
        || id(&operational, "phone_identity_id")? != identity_id
        || field(&operational, "channel").and_then(enum_tag) != Some("WhatsApp")
        || field(&operational, "status").and_then(enum_tag) != Some("Queued")
        || row_u64(&operational, "message_batch_id") != Some(0)
        || text(&operational, "subject_model")? != "crm_conversation"
        || id(&operational, "subject_id")? != conversation_id
        || message_body(&message, "body")? != message_body(&operational, "rendered_body")?
    {
        return Err(ApiError::Forbidden(
            "recipient or canonical message is no longer eligible".into(),
        ));
    }
    let accounts = state.stdb.query_sql(&format!(
        "SELECT * FROM whatsapp_business_account WHERE organization_id = {org} AND id = {account_id} LIMIT 2"
    )).await.map_err(ApiError::unavailable)?;
    let [account] = accounts.as_slice() else {
        return Err(ApiError::Unavailable(
            "WhatsApp sender is not connected".into(),
        ));
    };
    let waba = text(account, "business_account_id")?;
    let phone = text(account, "phone_number_id")?;
    let bound = inbound::account(state, waba, phone).await?;
    if bound.organization_id != org
        || bound.account_id != account_id
        || bound.company_id.is_some_and(|value| value != company)
    {
        return Err(ApiError::Forbidden("WhatsApp sender scope changed".into()));
    }
    inbound::provider_ready(state, org, account_id).await?;
    let reference = text(account, "credentials_reference")?;
    let token = meta::credential(org, account_id, waba, phone, reference)
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    let registry = stdb_auth::registry_get("contact-communication-preferences")
        .ok_or_else(|| ApiError::Unavailable("consent read contract is unavailable".into()))?;
    if !stdb_auth::has_resource_read_permission(
        Some(context.field_access()),
        "contact-communication-preferences",
    ) {
        return Err(ApiError::Forbidden(
            "consent read access is required".into(),
        ));
    }
    let sql = stdb_auth::select_org_scoped_sql(
        "contact-communication-preferences",
        &registry.table,
        org,
        Some(context.field_access()),
        &format!(" AND company_id = {company} AND contact_id = {contact_id}"),
        " LIMIT 8",
    )
    .map_err(ApiError::Internal)?;
    let preferences = state
        .stdb
        .query_sql(&sql)
        .await
        .map_err(ApiError::unavailable)?;
    if preferences.len() >= 8 {
        return Err(ApiError::Forbidden("consent selection is ambiguous".into()));
    }
    let matching: Vec<_> = preferences
        .iter()
        .filter(|row| field(row, "channel").and_then(enum_tag) == Some("WhatsApp"))
        .collect();
    let [preference] = matching.as_slice() else {
        return Err(ApiError::Forbidden(
            "record explicit WhatsApp consent before sending".into(),
        ));
    };
    if field(preference, "opted_in").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::Forbidden(
            "recipient has not opted in to WhatsApp".into(),
        ));
    }
    let e164 = text(&identity, "normalized_e164")?;
    let recipient = e164.strip_prefix('+').unwrap_or(e164).to_owned();
    let masked_recipient = format!(
        "***{}",
        recipient
            .chars()
            .rev()
            .take(4)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>()
    );
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool
        .get()
        .await
        .map_err(|_| ApiError::Unavailable("WhatsApp state is unavailable".into()))?;
    let facts = client.query_opt(
        "SELECT last_customer_seconds,stopped_at IS NOT NULL FROM lumiere_whatsapp.recipient_state \
         WHERE organization_id=$1 AND account_id=$2 AND recipient=$3",
        &[&org.to_string(), &account_id.to_string(), &recipient],
    ).await.map_err(|_| ApiError::Unavailable("WhatsApp recipient state is unavailable".into()))?;
    drop(client);
    let last = facts
        .as_ref()
        .and_then(|row| row.get::<_, Option<i64>>(0))
        .and_then(|value| u64::try_from(value).ok());
    let stopped = facts.as_ref().is_some_and(|row| row.get::<_, bool>(1));
    let transport = transport()?;
    let (sender_name, templates) = tokio::try_join!(
        transport.sender_name(phone, &token),
        transport.templates(waba, &token),
    )
    .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    let mut template_digest = String::new();
    let content = match choice {
        Choice::Reply => Content::Reply(message_body(&message, "body")?.to_owned()),
        Choice::Template {
            template_id,
            parameters,
        } => {
            let template = templates
                .iter()
                .find(|template| template.id == *template_id)
                .ok_or_else(|| {
                    ApiError::Conflict("exact approved utility template is unavailable".into())
                })?;
            if parameters.len() != template.parameter_count
                || meta::render(&template.body, parameters)
                    .map_err(|error| ApiError::BadRequest(error.to_string()))?
                    != message_body(&message, "body")?
            {
                return Err(ApiError::Conflict(
                    "template output must equal the queued message exactly".into(),
                ));
            }
            template_digest = template.definition_digest.clone();
            Content::Template {
                name: template.name.clone(),
                language: template.language.clone(),
                parameters: parameters.clone(),
            }
        }
    };
    let limit = row_u64(account, "daily_message_limit")
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::Unavailable("sender has no daily message allowance".into()))?;
    let daily_limit = limit.min(1000) as u32;
    let digest = fingerprint(&json!([
        org,
        company,
        account_id,
        conversation_id,
        message_id,
        operational_id,
        contact_id,
        identity_id,
        e164,
        phone,
        waba,
        reference,
        fingerprint(&json!(token)),
        message_body(&message, "body")?,
        template_digest,
        daily_limit,
    ]));
    let body = message_body(&message, "body")?.to_owned();
    let message = ReviewedMessage {
        organization_id: org,
        company_id: company,
        account_id,
        operational_message_id: operational_id,
        phone_number_id: phone.to_owned(),
        recipient,
        review_digest: String::new(),
        content,
    };
    let eligibility = Eligibility {
        organization_id: org,
        company_id: company,
        account_id,
        review_digest: String::new(),
        approved_payload_digest: String::new(),
        actor_can_send: true,
        sender_active: true,
        explicit_opt_in: true,
        opted_out: stopped,
        quiet_hours_allow: quiet_hours(preference, org, account_id)?,
        last_customer_message_seconds: last,
        exact_meta_template_approved: matches!(choice, Choice::Template { .. }),
        meta_approval_checked_at_seconds: Some(chrono::Utc::now().timestamp().max(0) as u64),
    };
    Ok(Source {
        actor: context.actor_identity().to_owned(),
        conversation_id,
        message_id,
        message,
        eligibility,
        digest,
        token,
        sender_name,
        body,
        masked_recipient,
        daily_limit,
        templates,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_redacted_identity_controls_never_authorize_a_send() {
        let mut row = json!({"archivedAt":null,"kind":"WhatsApp","verificationState":"Unverified"});
        assert!(identity_eligible(&row));
        row.as_object_mut().unwrap().remove("verificationState");
        assert!(!identity_eligible(&row));
        row["verificationState"] = json!("OptedOut");
        assert!(!identity_eligible(&row));
        row["verificationState"] = json!("Verified");
        row["kind"] = json!("MobileMoney");
        assert!(!identity_eligible(&row));
    }

    #[test]
    fn overnight_quiet_hours_have_explicit_boundaries() {
        assert!(!quiet_minute_allowed(1200, 420, 1200));
        assert!(!quiet_minute_allowed(1200, 420, 0));
        assert!(quiet_minute_allowed(1200, 420, 420));
        assert!(quiet_minute_allowed(1200, 420, 1199));
        assert!(!quiet_minute_allowed(100, 100, 200));
    }
}

#[cfg(test)]
mod message_content_tests {
    use super::message_body;
    use serde_json::json;

    #[test]
    fn message_content_is_not_limited_to_provider_identifier_length() {
        let normal = json!({"body": "x".repeat(1000)});
        assert_eq!(message_body(&normal, "body").unwrap().len(), 1000);
        assert!(message_body(&json!({"body": "x".repeat(4001)}), "body").is_err());
        assert!(message_body(&json!({"body": "💡".repeat(1100)}), "body").is_err());
        assert!(message_body(&json!({"body": null}), "body").is_err());
        assert!(message_body(&json!({}), "body").is_err());
    }
}

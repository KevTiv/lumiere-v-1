//! Resolve provider facts to existing, company-scoped canonical CRM records.
use std::collections::BTreeSet;

use serde_json::{json, Value};

use super::protocol::{
    absent, enum_tag, field, optional_id, row_u64, text, valid_asset_id, Incoming,
};
use crate::{
    commands::{dispatch_internal_reducer, InternalRouteAuthority},
    error::ApiError,
    state::AppState,
};

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Account {
    pub organization_id: u64,
    pub account_id: u64,
    pub company_id: Option<u64>,
    pub business_account_id: String,
    pub phone_number_id: String,
}

fn account_from_row(row: &Value) -> Result<Account, ApiError> {
    for name in ["is_active", "messaging_enabled", "webhook_enabled"] {
        if field(row, name).and_then(Value::as_bool) != Some(true) {
            return Err(ApiError::Forbidden("whatsapp account is disabled".into()));
        }
    }
    if !field(row, "deleted_at").is_some_and(absent) {
        return Err(ApiError::Forbidden("whatsapp account is archived".into()));
    }
    Ok(Account {
        organization_id: row_u64(row, "organization_id")
            .filter(|id| *id > 0)
            .ok_or_else(|| ApiError::Unprocessable("invalid organization binding".into()))?,
        account_id: row_u64(row, "id")
            .filter(|id| *id > 0)
            .ok_or_else(|| ApiError::Unprocessable("invalid account binding".into()))?,
        company_id: optional_id(row, "company_id")?,
        business_account_id: text(row, "business_account_id")?.to_owned(),
        phone_number_id: text(row, "phone_number_id")?.to_owned(),
    })
}

pub(super) async fn account(
    state: &AppState,
    waba: &str,
    phone: &str,
) -> Result<Account, ApiError> {
    if !valid_asset_id(waba) || !valid_asset_id(phone) {
        return Err(ApiError::BadRequest("invalid meta asset identifier".into()));
    }
    let sql = format!(
        "SELECT * FROM whatsapp_business_account WHERE business_account_id = '{waba}' \
         AND phone_number_id = '{phone}' LIMIT 3"
    );
    let rows = state
        .stdb
        .query_sql(&sql)
        .await
        .map_err(ApiError::unavailable)?;
    if rows.len() != 1 {
        return Err(ApiError::Unavailable(
            "ambiguous or missing meta account binding".into(),
        ));
    }
    let account = account_from_row(&rows[0])?;
    if account.business_account_id != waba || account.phone_number_id != phone {
        return Err(ApiError::Forbidden("meta account binding mismatch".into()));
    }
    Ok(account)
}

fn sender_e164(value: &str) -> Result<String, ApiError> {
    if !(8..=15).contains(&value.len())
        || value.starts_with('0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ApiError::Unprocessable(
            "sender requires identity triage".into(),
        ));
    }
    Ok(format!("+{value}"))
}

fn select_identity(rows: &[Value], account: &Account) -> Result<(u64, u64), ApiError> {
    if rows.len() >= 32 {
        return Err(ApiError::Unprocessable(
            "identity lookup is truncated".into(),
        ));
    }
    let mut contacts = BTreeSet::new();
    let mut candidates = Vec::new();
    for row in rows {
        if row_u64(row, "organization_id") != Some(account.organization_id)
            || !field(row, "archived_at").is_some_and(absent)
        {
            continue;
        }
        let company = optional_id(row, "company_id")?;
        if company.is_none() || account.company_id.is_some_and(|id| company != Some(id)) {
            continue;
        }
        let rank = match field(row, "kind").and_then(enum_tag) {
            Some("WhatsApp" | "whatsapp") => 0,
            Some("Primary" | "primary") => 1,
            _ => continue,
        };
        match field(row, "verification_state").and_then(enum_tag) {
            None | Some("OptedOut" | "opted_out") => continue,
            _ => {}
        }
        let (Some(contact), Some(identity)) = (row_u64(row, "contact_id"), row_u64(row, "id"))
        else {
            continue;
        };
        contacts.insert((contact, company));
        candidates.push((rank, identity, contact));
    }
    if contacts.len() != 1 || candidates.is_empty() {
        return Err(ApiError::Unprocessable(
            "sender requires contact triage".into(),
        ));
    }
    candidates.sort_unstable();
    let (_, identity, contact) = candidates[0];
    Ok((contact, identity))
}

pub(super) async fn process(state: &AppState, event: &Incoming) -> Result<(), ApiError> {
    let current = account(state, &event.business_account_id, &event.phone_number_id).await?;
    if current.organization_id != event.organization_id
        || current.account_id != event.account_id
        || current.company_id != event.company_id
    {
        return Err(ApiError::Forbidden(
            "provider binding changed after receipt".into(),
        ));
    }
    match event.kind.as_str() {
        "message" => message(state, &current, event).await,
        "status" => delivery(state, &current, event).await,
        _ => Err(ApiError::Unprocessable(
            "provider event requires triage".into(),
        )),
    }
}

async fn message(state: &AppState, account: &Account, event: &Incoming) -> Result<(), ApiError> {
    let raw = &event.payload;
    let id = text(raw, "id")?;
    let sender = text(raw, "from")?;
    if raw.get("type").and_then(Value::as_str) != Some("text") {
        return Err(ApiError::Unprocessable(
            "attachment requires document intake".into(),
        ));
    }
    let body = raw
        .pointer("/text/body")
        .and_then(Value::as_str)
        .filter(|body| !body.trim().is_empty() && body.len() <= 4000)
        .ok_or_else(|| ApiError::Unprocessable("unsupported message body".into()))?;
    let e164 = sender_e164(sender)?;
    let sql = format!(
        "SELECT * FROM contact_phone_identity WHERE organization_id = {} \
         AND normalized_e164 = '{e164}' LIMIT 32",
        account.organization_id
    );
    let rows = state
        .stdb
        .query_sql(&sql)
        .await
        .map_err(ApiError::unavailable)?;
    let (contact, identity) = select_identity(&rows, account)?;
    dispatch_internal_reducer(
        state,
        InternalRouteAuthority::ProviderWebhook,
        Some(account.organization_id),
        "receive_crm_provider_message",
        json!([account.organization_id, {
            "provider_account_id": account.account_id,
            "provider_event_id": id,
            "event_fingerprint": event.fingerprint,
            "contact_id": contact,
            "phone_identity_id": identity,
            "external_thread_id": format!("meta:{}:{sender}", account.account_id),
            "provider_message_id": id,
            "body": body,
        }]),
    )
    .await?;
    Ok(())
}

async fn delivery(state: &AppState, account: &Account, event: &Incoming) -> Result<(), ApiError> {
    let raw = &event.payload;
    let id = text(raw, "id")?;
    let status = match text(raw, "status")? {
        "read" | "delivered" => "delivered",
        "sent" => "sent",
        "failed" => "failed",
        _ => {
            return Err(ApiError::Unprocessable(
                "unsupported delivery status".into(),
            ))
        }
    };
    let escaped = id.replace('\'', "''");
    let sql = format!(
        "SELECT * FROM crm_conversation_message WHERE organization_id = {} \
         AND direction = 'outbound' AND provider_message_id = '{escaped}' LIMIT 2",
        account.organization_id
    );
    let rows = state
        .stdb
        .query_sql(&sql)
        .await
        .map_err(ApiError::unavailable)?;
    if rows.len() != 1 {
        return Err(ApiError::Unavailable(
            "provider message correlation is pending".into(),
        ));
    }
    let row = &rows[0];
    if row_u64(row, "organization_id") != Some(account.organization_id)
        || account
            .company_id
            .is_some_and(|id| row_u64(row, "company_id") != Some(id))
    {
        return Err(ApiError::Forbidden(
            "provider delivery company mismatch".into(),
        ));
    }
    let (Some(conversation), Some(message), Some(operational)) = (
        row_u64(row, "conversation_id"),
        row_u64(row, "id"),
        row_u64(row, "operational_message_id"),
    ) else {
        return Err(ApiError::Unprocessable(
            "delivery lacks canonical linkage".into(),
        ));
    };
    let failure = if status == "failed" {
        json!({"some": "meta delivery failed"})
    } else {
        json!({"none": []})
    };
    dispatch_internal_reducer(
        state,
        InternalRouteAuthority::ProviderWebhook,
        Some(account.organization_id),
        "record_crm_provider_delivery",
        json!([account.organization_id, {
            "provider_account_id": account.account_id,
            "provider_event_id": format!("meta:{}", event.event_key),
            "event_fingerprint": event.fingerprint,
            "conversation_id": conversation,
            "conversation_message_id": message,
            "provider_message_id": id,
            "operational_message_id": operational,
            "status": status,
            "failure_reason": failure,
        }]),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Account {
        Account {
            organization_id: 1,
            account_id: 2,
            company_id: Some(3),
            business_account_id: "123".into(),
            phone_number_id: "456".into(),
        }
    }

    #[test]
    fn real_database_account_shape_is_accepted_and_disabled_accounts_are_denied() {
        let mut row = json!({"id":2,"organizationId":1,"companyId":3,
            "isActive":true,"messagingEnabled":true,"webhookEnabled":true,
            "deletedAt":null,"businessAccountId":"123","phoneNumberId":"456"});
        assert!(account_from_row(&row).is_ok());
        row["isActive"] = json!(false);
        assert!(account_from_row(&row).is_err());
    }

    #[test]
    fn matching_does_not_use_wallet_identities_or_another_company() {
        let wallet = json!({"id":1,"organizationId":1,"companyId":3,"contactId":9,
            "kind":"MobileMoney","archivedAt":null,"verificationState":"Unverified"});
        let mut whatsapp = wallet.clone();
        whatsapp["id"] = json!(2);
        whatsapp["kind"] = json!({"tag":"WhatsApp"});
        assert_eq!(
            select_identity(&[wallet, whatsapp.clone()], &fixture()).unwrap(),
            (9, 2)
        );
        whatsapp["companyId"] = json!(4);
        assert!(select_identity(&[whatsapp], &fixture()).is_err());
    }

    #[test]
    fn incoming_user_ids_are_not_assumed_to_be_phone_numbers() {
        assert!(sender_e164("username:123").is_err());
        assert!(sender_e164("0250788123456").is_err());
        assert_eq!(sender_e164("250788123456").unwrap(), "+250788123456");
    }
}

//! Deployment-owned sender enrollment. Tenant-editable account metadata is not
//! evidence that a WhatsApp business asset belongs to that tenant.
use std::collections::BTreeSet;

use anyhow::{bail, Result};
use serde::Deserialize;

use super::protocol::valid_asset_id;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Connection {
    organization_id: String,
    account_id: String,
    business_account_id: String,
    phone_number_id: String,
    credentials_reference: String,
    access_token: String,
}

pub(super) struct Binding {
    pub organization_id: u64,
    pub account_id: u64,
    pub credentials_reference: String,
}

fn canonical_id(value: &str) -> Result<u64> {
    let id = value
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0 && id.to_string() == value)
        .ok_or_else(|| anyhow::anyhow!("invalid WhatsApp enrollment identifier"))?;
    Ok(id)
}

fn parse(encoded: &str) -> Result<Vec<Connection>> {
    if encoded.len() > 524288 {
        bail!("invalid WhatsApp enrollment configuration");
    }
    let entries: Vec<Connection> = serde_json::from_str(encoded)
        .map_err(|_| anyhow::anyhow!("invalid WhatsApp enrollment configuration"))?;
    if entries.is_empty() || entries.len() > 1000 {
        bail!("invalid WhatsApp enrollment count");
    }
    let mut assets = BTreeSet::new();
    let mut accounts = BTreeSet::new();
    for entry in &entries {
        let org = canonical_id(&entry.organization_id)?;
        let account = canonical_id(&entry.account_id)?;
        if !valid_asset_id(&entry.business_account_id)
            || !valid_asset_id(&entry.phone_number_id)
            || entry.business_account_id.bytes().all(|byte| byte == b'0')
            || entry.phone_number_id.bytes().all(|byte| byte == b'0')
            || entry.credentials_reference.trim().is_empty()
            || entry.credentials_reference.len() > 255
            || entry.access_token.is_empty()
            || entry.access_token.len() > 16384
            || !entry
                .access_token
                .bytes()
                .all(|byte| byte.is_ascii_graphic())
            || !assets.insert((&entry.business_account_id, &entry.phone_number_id))
            || !accounts.insert((org, account))
        {
            bail!("ambiguous or invalid WhatsApp sender enrollment");
        }
    }
    Ok(entries)
}

fn load() -> Result<Vec<Connection>> {
    let encoded = std::env::var("LUMIERE_WHATSAPP_ACCOUNT_TOKENS")
        .map_err(|_| anyhow::anyhow!("WhatsApp sender enrollment is not provisioned"))?;
    parse(&encoded)
}

fn find_binding(entries: &[Connection], waba: &str, phone: &str) -> Result<Binding> {
    let entry = entries
        .iter()
        .find(|entry| entry.business_account_id == waba && entry.phone_number_id == phone)
        .ok_or_else(|| anyhow::anyhow!("sender has no approved deployment binding"))?;
    Ok(Binding {
        organization_id: canonical_id(&entry.organization_id)?,
        account_id: canonical_id(&entry.account_id)?,
        credentials_reference: entry.credentials_reference.clone(),
    })
}

/// Resolve signed Meta assets only through server-approved enrollment. In
/// particular, another tenant cannot claim incoming traffic by copying IDs.
pub(super) fn binding(waba: &str, phone: &str) -> Result<Binding> {
    find_binding(&load()?, waba, phone)
}

fn find_credential(
    entries: Vec<Connection>,
    organization: u64,
    account: u64,
    waba: &str,
    phone: &str,
    reference: &str,
) -> Result<String> {
    let binding = find_binding(&entries, waba, phone)?;
    if binding.organization_id != organization
        || binding.account_id != account
        || binding.credentials_reference != reference
    {
        bail!("sender enrollment does not match the requested organization or account");
    }
    entries
        .into_iter()
        .find(|entry| entry.business_account_id == waba && entry.phone_number_id == phone)
        .map(|entry| entry.access_token)
        .ok_or_else(|| anyhow::anyhow!("sender credential is unavailable"))
}

pub(super) fn credential(
    organization: u64,
    account: u64,
    waba: &str,
    phone: &str,
    reference: &str,
) -> Result<String> {
    find_credential(load()?, organization, account, waba, phone, reference)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> serde_json::Value {
        json!({
            "organizationId":"1", "accountId":"2", "businessAccountId":"123",
            "phoneNumberId":"456", "credentialsReference":"fixture/connection",
            "accessToken":"not-a-real-token"
        })
    }

    #[test]
    fn signed_assets_select_only_the_server_enrolled_organization() {
        let entries = parse(&json!([fixture()]).to_string()).unwrap();
        let bound = find_binding(&entries, "123", "456").unwrap();
        assert_eq!((bound.organization_id, bound.account_id), (1, 2));
        assert!(find_binding(&entries, "999", "456").is_err());
        assert!(find_binding(&entries, "123", "999").is_err());
        assert!(find_credential(entries, 9, 2, "123", "456", "fixture/connection").is_err());
    }

    #[test]
    fn duplicate_asset_or_account_enrollment_is_denied_not_guessed() {
        let first = fixture();
        let mut other = first.clone();
        other["organizationId"] = json!("9");
        assert!(parse(&json!([first.clone(), other]).to_string()).is_err());
        let mut other = first.clone();
        other["phoneNumberId"] = json!("789");
        assert!(parse(&json!([first, other]).to_string()).is_err());
    }

    #[test]
    fn credential_scope_and_reference_cannot_be_substituted() {
        let config = json!([fixture()]).to_string();
        assert!(find_credential(
            parse(&config).unwrap(),
            1,
            3,
            "123",
            "456",
            "fixture/connection"
        )
        .is_err());
        assert!(find_credential(
            parse(&config).unwrap(),
            1,
            2,
            "123",
            "456",
            "another/reference"
        )
        .is_err());
        assert_eq!(
            find_credential(
                parse(&config).unwrap(),
                1,
                2,
                "123",
                "456",
                "fixture/connection"
            )
            .unwrap(),
            "not-a-real-token"
        );
    }

    #[test]
    fn malformed_enrollment_does_not_expose_secret_content() {
        let mut value = fixture();
        value["organizationId"] = json!("0");
        assert!(parse(&json!([value]).to_string()).is_err());
        let mut value = fixture();
        value["accessToken"] = json!("private-value\nmalformed");
        let error = parse(&json!([value]).to_string())
            .err()
            .unwrap()
            .to_string();
        assert!(!error.contains("private-value"));
    }
}

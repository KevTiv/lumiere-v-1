//! Server-owned native password support and platform credential helpers.

use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

use crate::cold_tier::pg_pool;
use crate::error::ApiError;
use crate::platform_control::{self, PlatformId};
use crate::session::normalize_identity_hex_for_sql;
use crate::state::AppState;
use stdb_auth::select_user_organization_for_identity_sql;

const ADMIN_TOKEN_PLACEHOLDERS: &[&str] = &[
    "",
    "your-server-token-here",
    "changeme",
    "replace-me",
    "replace_me",
];

pub fn is_usable_admin_token(raw: &str) -> bool {
    let t = raw.trim();
    !t.is_empty()
        && !ADMIN_TOKEN_PLACEHOLDERS
            .iter()
            .any(|p| p.eq_ignore_ascii_case(t))
}

pub fn encrypt_token(key: &[u8; 32], plaintext: &str) -> Result<String, ApiError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(ApiError::internal)?;
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);
    let mut ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        // aes_gcm::Error does not implement std::error::Error with these features.
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let mut combined = iv.to_vec();
    combined.append(&mut ciphertext);
    Ok(STANDARD.encode(&combined))
}

pub fn decrypt_token(key: &[u8; 32], b64: &str) -> Result<String, ApiError> {
    let combined = STANDARD.decode(b64.trim()).map_err(ApiError::internal)?;
    if combined.len() < 13 {
        return Err(ApiError::Internal("invalid encrypted token payload".into()));
    }
    let (iv, ct) = combined.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(ApiError::internal)?;
    let plain = cipher
        .decrypt(Nonce::from_slice(iv), ct)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    String::from_utf8(plain).map_err(ApiError::internal)
}

pub fn now_micros() -> i128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as i128)
        .unwrap_or(0)
}

pub fn generate_secure_token() -> (String, String) {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let hash = Sha256::digest(token.as_bytes());
    let token_hash = hex::encode(hash);
    (token, token_hash)
}

pub fn micros_to_secs(micros: i64) -> i64 {
    micros / 1_000_000
}

pub fn post_auth_destination_after_session(has_organization: bool) -> &'static str {
    if has_organization {
        "/overview"
    } else {
        "/onboarding"
    }
}

fn admin_client(state: &AppState) -> Result<StdbClient, ApiError> {
    let t = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|s| is_usable_admin_token(s))
        .ok_or_else(|| ApiError::Internal("STDB_SERVER_TOKEN is not configured".into()))?;
    Ok(state.client_with_token(t))
}

fn value_as_u64(v: &Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn value_as_i64(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_u64().map(|u| u as i64))
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn value_as_str(v: &Value) -> Option<String> {
    v.as_str().map(|s| s.to_string())
}

/// Match SpacetimeDB 2.x SATS-SQL identity shapes.
pub fn identity_cell_to_hex(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        let s = s
            .trim()
            .trim_start_matches("0x")
            .trim_start_matches("0X")
            .to_ascii_lowercase();
        return Some(s);
    }
    if let Some(arr) = v.as_array() {
        if arr.len() == 1 {
            return identity_cell_to_hex(arr.first()?);
        }
        if arr.len() == 32 {
            let mut bytes = Vec::with_capacity(32);
            for x in arr {
                let b = x.as_u64().unwrap_or(0) as u8;
                bytes.push(b);
            }
            return Some(hex::encode(bytes));
        }
    }
    if let Some(obj) = v.as_object() {
        if let Some(inner) = obj.get("__identity__") {
            return identity_cell_to_hex(inner);
        }
    }
    None
}

#[derive(Debug, Clone)]
pub struct StdbCredential {
    /// Opaque platform-control key; never derived from organization or STDB ids.
    pub platform_user_id: String,
    pub identity_hex: String,
    pub password_hash: Option<String>,
    pub stdb_token_enc: String,
}

fn parse_credential(row: &tokio_postgres::Row) -> Result<StdbCredential, ApiError> {
    let platform_user_id: String = row
        .try_get("platform_user_id")
        .map_err(|e| ApiError::Internal(format!("invalid platform credential id: {e}")))?;
    PlatformId::new(platform_user_id.clone())
        .map_err(|e| ApiError::Internal(format!("invalid platform credential id: {e}")))?;
    let identity_hex: String = row
        .try_get("stdb_identity_hex")
        .map_err(|e| ApiError::Internal(format!("invalid STDB credential binding: {e}")))?;
    let password_hash = row
        .try_get::<_, Option<String>>("password_hash")
        .map_err(|e| ApiError::Internal(format!("invalid password hash: {e}")))?;
    let stdb_token_enc: String = row
        .try_get("stdb_token_enc")
        .map_err(|e| ApiError::Internal(format!("invalid STDB token binding: {e}")))?;
    Ok(StdbCredential {
        platform_user_id,
        identity_hex,
        password_hash,
        stdb_token_enc,
    })
}

fn platform_pool() -> Result<&'static deadpool_postgres::Pool, ApiError> {
    pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })
}

pub async fn find_credential_by_email(
    _state: &AppState,
    email: &str,
) -> Result<Option<StdbCredential>, ApiError> {
    let row = platform_control::find_user_credential_by_email(platform_pool()?, email)
        .await
        .map_err(ApiError::internal)?;
    row.as_ref().map(parse_credential).transpose()
}

/// Resolve the canonical credential after a platform-control operation.
pub async fn find_credential_by_platform_id(
    _state: &AppState,
    platform_user_id: &str,
) -> Result<Option<StdbCredential>, ApiError> {
    let platform_id = PlatformId::new(platform_user_id.to_owned())
        .map_err(|e| ApiError::Internal(format!("invalid platform credential id: {e}")))?;
    let row = platform_control::find_user_credential_by_platform_id(platform_pool()?, &platform_id)
        .await
        .map_err(ApiError::internal)?;
    row.as_ref().map(parse_credential).transpose()
}

#[derive(Debug, Clone)]
pub struct StdbInvite {
    pub id: u64,
    pub organization_id: u64,
    pub role_id: u64,
    pub email: String,
    pub expires_at: i64,
    pub accepted_at: Option<i64>,
}

fn parse_invite(row: &Value) -> Option<StdbInvite> {
    Some(StdbInvite {
        id: value_as_u64(row.get("id")?)?,
        organization_id: value_as_u64(
            row.get("organizationId")
                .or_else(|| row.get("organization_id"))?,
        )?,
        role_id: value_as_u64(row.get("roleId").or_else(|| row.get("role_id"))?)?,
        email: value_as_str(row.get("email")?)?,
        expires_at: value_as_i64(row.get("expiresAt").or_else(|| row.get("expires_at"))?)?,
        accepted_at: row
            .get("acceptedAt")
            .or_else(|| row.get("accepted_at"))
            .and_then(|v| if v.is_null() { None } else { value_as_i64(v) }),
    })
}

pub async fn find_invite_by_token_hash(
    state: &AppState,
    token_hash: &str,
) -> Result<Option<StdbInvite>, ApiError> {
    let client = admin_client(state)?;
    let safe = token_hash.replace('\'', "''");
    let sql = format!(
        "SELECT id, organization_id, role_id, email, token_hash, invited_by, expires_at, accepted_at FROM user_invite WHERE token_hash = '{safe}'"
    );
    let rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    Ok(rows.first().and_then(|r| parse_invite(r)))
}

#[derive(Debug, Clone)]
pub struct StdbResetToken {
    pub platform_reset_token_id: String,
    pub platform_user_id: String,
    pub expires_at: SystemTime,
    pub used_at: Option<SystemTime>,
}

fn parse_reset_token(row: &tokio_postgres::Row) -> Result<StdbResetToken, ApiError> {
    let platform_reset_token_id: String = row
        .try_get("platform_reset_token_id")
        .map_err(|e| ApiError::Internal(format!("invalid reset token id: {e}")))?;
    PlatformId::new(platform_reset_token_id.clone())
        .map_err(|e| ApiError::Internal(format!("invalid reset token id: {e}")))?;
    let platform_user_id: String = row
        .try_get("platform_user_id")
        .map_err(|e| ApiError::Internal(format!("invalid reset token platform id: {e}")))?;
    PlatformId::new(platform_user_id.clone())
        .map_err(|e| ApiError::Internal(format!("invalid reset token platform id: {e}")))?;
    let expires_at: std::time::SystemTime = row
        .try_get("expires_at")
        .map_err(|e| ApiError::Internal(format!("invalid reset token expiry: {e}")))?;
    let used_at: Option<std::time::SystemTime> = row
        .try_get("used_at")
        .map_err(|e| ApiError::Internal(format!("invalid reset token state: {e}")))?;
    Ok(StdbResetToken {
        platform_reset_token_id,
        platform_user_id,
        expires_at,
        used_at,
    })
}

pub async fn find_reset_token_by_hash(
    _state: &AppState,
    token_hash: &str,
) -> Result<Option<StdbResetToken>, ApiError> {
    let row = platform_control::find_password_reset_token(platform_pool()?, token_hash)
        .await
        .map_err(ApiError::internal)?;
    row.as_ref().map(parse_reset_token).transpose()
}

pub async fn get_role_name_in_organization(
    state: &AppState,
    role_id: u64,
    organization_id: u64,
) -> Result<Option<String>, ApiError> {
    let client = admin_client(state)?;
    let sql = format!(
        "SELECT name FROM role WHERE id = {role_id} AND organization_id = {organization_id} AND is_active = true"
    );
    let rows = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    Ok(rows
        .first()
        .and_then(|r| r.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

pub async fn user_has_organization_rows(state: &AppState, identity_hex: &str) -> bool {
    let Ok(client) = admin_client(state) else {
        return false;
    };
    let id = normalize_identity_hex_for_sql(identity_hex);
    let Ok(sql) = select_user_organization_for_identity_sql(&id, None) else {
        return false;
    };
    match client.query_sql(&sql).await {
        Ok(rows) => !rows.is_empty(),
        Err(_) => false,
    }
}

pub async fn send_resend_email(
    http: &reqwest::Client,
    api_key: &str,
    from: &str,
    to: &str,
    subject: &str,
    text: &str,
) -> Result<(), String> {
    let body = json!({
        "from": from,
        "to": [to],
        "subject": subject,
        "text": text,
    });
    let r = http
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = r.status();
    if !status.is_success() {
        let txt = r.text().await.unwrap_or_default();
        return Err(format!("Resend HTTP {status}: {txt}"));
    }
    Ok(())
}

/// Bound normalized addresses before storage, comparisons, or email delivery.
pub fn normalized_auth_email(raw: &str) -> Result<String, ApiError> {
    let email = raw.trim().to_ascii_lowercase();
    if email.len() > 254
        || email.is_empty()
        || !email.is_ascii()
        || email
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        || email.split('@').count() != 2
        || email.starts_with('@')
        || email.ends_with('@')
    {
        return Err(ApiError::BadRequest("Invalid email address".into()));
    }
    Ok(email)
}

pub fn validate_native_password(password: &str) -> Result<(), ApiError> {
    // bcrypt only authenticates the first 72 bytes. Never silently truncate.
    if !(8..=72).contains(&password.len()) {
        return Err(ApiError::BadRequest(
            "Password must be 8 to 72 bytes".into(),
        ));
    }
    Ok(())
}

static PASSWORD_WORK: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

pub async fn hash_native_password(password: String) -> Result<String, ApiError> {
    validate_native_password(&password)?;
    let permit = PASSWORD_WORK
        .try_acquire()
        .map_err(|_| ApiError::Unavailable("Authentication busy; retry shortly".into()))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        bcrypt::hash(password, bcrypt::DEFAULT_COST)
    })
    .await
    .map_err(ApiError::internal)?
    .map_err(ApiError::internal)
}

pub async fn verify_native_password(password: String, hash: String) -> Result<bool, ApiError> {
    validate_native_password(&password)?;
    let permit = PASSWORD_WORK
        .try_acquire()
        .map_err(|_| ApiError::Unavailable("Authentication busy; retry shortly".into()))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        bcrypt::verify(password, &hash)
    })
    .await
    .map_err(ApiError::internal)?
    .map_err(ApiError::internal)
}

/// An invitation proves admission to an organization, never account ownership.
pub async fn authenticate_invite_credential(
    credential: &StdbCredential,
    password: String,
    key: &[u8; 32],
) -> Result<String, ApiError> {
    let hash = credential
        .password_hash
        .as_ref()
        .filter(|hash| !hash.is_empty())
        .ok_or(ApiError::AccountUsesSso)?;
    if !verify_native_password(password, hash.clone()).await? {
        return Err(ApiError::InvalidEmailOrPassword);
    }
    decrypt_token(key, &credential.stdb_token_enc)
}

#[cfg(test)]
mod native_input_tests {
    use super::*;
    #[test]
    fn address_normalization_rejects_header_injection_and_oversized_input() {
        assert_eq!(
            normalized_auth_email(" Owner@Example.com ").unwrap(),
            "owner@example.com"
        );
        for email in [
            "a@example.com\r\nBcc:victim@example.com",
            "a@@example.com",
            "@example.com",
        ] {
            assert!(normalized_auth_email(email).is_err());
        }
        assert!(normalized_auth_email(&format!("{}@example.com", "a".repeat(255))).is_err());
    }
    #[tokio::test]
    async fn invitation_does_not_release_existing_token_without_account_password() {
        let key = [7; 32];
        let mut credential = StdbCredential {
            platform_user_id: "p_user".into(),
            identity_hex: "binding".into(),
            password_hash: Some(bcrypt::hash("correct password", 4).unwrap()),
            stdb_token_enc: encrypt_token(&key, "private-stdb-token").unwrap(),
        };
        assert!(matches!(
            authenticate_invite_credential(&credential, "wrong password".into(), &key).await,
            Err(ApiError::InvalidEmailOrPassword)
        ));
        assert_eq!(
            authenticate_invite_credential(&credential, "correct password".into(), &key)
                .await
                .unwrap(),
            "private-stdb-token"
        );
        credential.password_hash = None;
        assert!(matches!(
            authenticate_invite_credential(&credential, "correct password".into(), &key).await,
            Err(ApiError::AccountUsesSso)
        ));
    }
    #[test]
    fn passwords_cannot_exceed_bcrypt_authenticated_bytes() {
        assert!(validate_native_password(&"a".repeat(72)).is_ok());
        assert!(validate_native_password(&"a".repeat(73)).is_err());
        assert!(validate_native_password("short").is_err());
    }
}

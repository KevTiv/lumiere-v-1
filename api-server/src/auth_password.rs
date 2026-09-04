//! Password auth + credential helpers (port of `frontend/web/lib/stdb-auth-server.ts`).

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
use crate::session::{normalize_identity_hex_for_sql, query_user_organization_with_fallback};
use crate::state::AppState;

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
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| ApiError::Internal(e.to_string()))?;
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);
    let mut ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let mut combined = iv.to_vec();
    combined.append(&mut ciphertext);
    Ok(STANDARD.encode(&combined))
}

pub fn decrypt_token(key: &[u8; 32], b64: &str) -> Result<String, ApiError> {
    let combined = STANDARD
        .decode(b64.trim())
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    if combined.len() < 13 {
        return Err(ApiError::Internal("invalid encrypted token payload".into()));
    }
    let (iv, ct) = combined.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| ApiError::Internal(e.to_string()))?;
    let plain = cipher
        .decrypt(Nonce::from_slice(iv), ct)
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    String::from_utf8(plain).map_err(|e| ApiError::Internal(e.to_string()))
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

/// Match SpacetimeDB 2.x SATS-SQL shapes (see `stdb-auth-server.ts` `normalizeIdentitySqlValue`).
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
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    row.as_ref().map(parse_credential).transpose()
}

pub async fn find_credential_by_identity(
    _state: &AppState,
    identity_hex: &str,
) -> Result<Option<StdbCredential>, ApiError> {
    let identity_hex = identity_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    let row =
        platform_control::find_user_credential_by_stdb_identity(platform_pool()?, identity_hex)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
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
        .map_err(|e| ApiError::Internal(e.to_string()))?;
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
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(rows.first().and_then(|r| parse_invite(r)))
}

#[derive(Debug, Clone)]
pub struct StdbResetToken {
    pub platform_reset_token_id: String,
    pub platform_user_id: String,
    pub expires_at: i64,
    pub used_at: Option<i64>,
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
    let expires_at = expires_at
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| ApiError::Internal(format!("invalid reset token expiry: {e}")))?
        .as_secs() as i64;
    Ok(StdbResetToken {
        platform_reset_token_id,
        platform_user_id,
        expires_at,
        used_at: used_at.map(|value| {
            value
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or_default()
        }),
    })
}

pub async fn find_reset_token_by_hash(
    state: &AppState,
    token_hash: &str,
) -> Result<Option<StdbResetToken>, ApiError> {
    let row = platform_control::find_password_reset_token(platform_pool()?, token_hash)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    row.as_ref().map(parse_reset_token).transpose()
}

pub async fn get_role_name_in_organization(
    state: &AppState,
    role_id: u64,
    organization_id: u64,
) -> Result<Option<String>, ApiError> {
    let client = admin_client(state)?;
    let sql = format!(
        "SELECT name FROM role WHERE id = {role_id} AND organization_id = {organization_id}"
    );
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(rows
        .first()
        .and_then(|r| r.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

pub async fn user_has_organization_rows(state: &AppState, identity_hex: &str, token: &str) -> bool {
    let client = state.client_with_token(token);
    let id = normalize_identity_hex_for_sql(identity_hex);
    match query_user_organization_with_fallback(
        &client,
        &id,
        state.config.stdb_server_token.as_deref(),
    )
    .await
    {
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

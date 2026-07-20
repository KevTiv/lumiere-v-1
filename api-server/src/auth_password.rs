//! Password auth + credential helpers (port of `frontend/web/lib/stdb-auth-server.ts`).

use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stdb_client::StdbClient;

use crate::error::ApiError;
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
    pub identity_hex: String,
    pub password_hash: Option<String>,
    pub stdb_token_enc: String,
}

fn parse_credential(row: &Value) -> Option<StdbCredential> {
    let identity_hex = identity_cell_to_hex(row.get("identity")?)?;
    let password_hash = row
        .get("passwordHash")
        .or_else(|| row.get("password_hash"))
        .and_then(|v| if v.is_null() { None } else { value_as_str(v) });
    let stdb_token_enc = row
        .get("stdbTokenEnc")
        .or_else(|| row.get("stdb_token_enc"))
        .and_then(|v| value_as_str(v))?;
    Some(StdbCredential {
        identity_hex,
        password_hash,
        stdb_token_enc,
    })
}

pub async fn find_credential_by_email(
    state: &AppState,
    email: &str,
) -> Result<Option<StdbCredential>, ApiError> {
    let client = admin_client(state)?;
    let safe = email.replace('\'', "''");
    let sql = format!(
        "SELECT identity, password_hash, stdb_token_enc FROM user_credential WHERE email = '{safe}'"
    );
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(rows.first().and_then(|r| parse_credential(r)))
}

pub async fn find_credential_by_identity(
    state: &AppState,
    identity_hex: &str,
) -> Result<Option<StdbCredential>, ApiError> {
    let client = admin_client(state)?;
    let hex = identity_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    let sql = format!(
        "SELECT identity, password_hash, stdb_token_enc FROM user_credential WHERE identity = 0x{hex}"
    );
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(rows.first().and_then(|r| parse_credential(r)))
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
    pub id: u64,
    pub identity_hex: String,
    pub expires_at: i64,
    pub used_at: Option<i64>,
}

fn parse_reset_token(row: &Value) -> Option<StdbResetToken> {
    Some(StdbResetToken {
        id: value_as_u64(row.get("id")?)?,
        identity_hex: identity_cell_to_hex(row.get("identity")?)?,
        expires_at: value_as_i64(row.get("expiresAt").or_else(|| row.get("expires_at"))?)?,
        used_at: row
            .get("usedAt")
            .or_else(|| row.get("used_at"))
            .and_then(|v| if v.is_null() { None } else { value_as_i64(v) }),
    })
}

pub async fn find_reset_token_by_hash(
    state: &AppState,
    token_hash: &str,
) -> Result<Option<StdbResetToken>, ApiError> {
    let client = admin_client(state)?;
    let safe = token_hash.replace('\'', "''");
    let sql = format!(
        "SELECT id, identity, token_hash, expires_at, used_at FROM password_reset_token WHERE token_hash = '{safe}'"
    );
    let rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(rows.first().and_then(|r| parse_reset_token(r)))
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

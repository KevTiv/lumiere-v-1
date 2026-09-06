//! Password reset request and completion handlers.
use super::cookies::set_stdb_session_cookies;
use crate::auth_password::{
    decrypt_token, find_credential_by_email, find_credential_by_platform_id,
    find_reset_token_by_hash, generate_secure_token, is_usable_admin_token, micros_to_secs,
    now_micros, send_resend_email,
};
use crate::cold_tier::pg_pool;
use crate::error::ApiError;
use crate::platform_control::{self, PlatformId};
use crate::session::{identity_json_for_reducer_call, normalize_identity_hex_for_sql};
use crate::state::AppState;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tower_cookies::Cookies;

#[derive(Debug, Deserialize)]
pub(super) struct ForgotBody {
    email: String,
}

pub(super) async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ForgotBody>,
) -> Result<Json<Value>, ApiError> {
    if state.config.workos_client_id.is_some() {
        return Err(ApiError::Gone(
            "Password reset is handled by WorkOS. Use the WorkOS sign-in screen.".into(),
        ));
    }

    let msg = "If that email exists, a reset link has been sent.";
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Ok(Json(json!({ "message": msg })));
    }

    let cred = match find_credential_by_email(&state, &email).await {
        Ok(c) => c,
        Err(_) => return Ok(Json(json!({ "message": msg }))),
    };

    if let Some(cred) = cred {
        let (token, token_hash) = generate_secure_token();
        let expires_at_micros = now_micros() + (60_i128 * 60 * 1_000_000);
        let expires_at = std::time::SystemTime::now()
            .checked_add(std::time::Duration::from_secs(60 * 60))
            .ok_or_else(|| ApiError::Internal("invalid reset-token expiry".into()))?;
        let platform_id =
            PlatformId::new(cred.platform_user_id.clone()).map_err(ApiError::internal)?;
        let pool = pg_pool::shared_pool().ok_or_else(|| {
            ApiError::Unavailable("platform authentication storage is unavailable".into())
        })?;
        let platform_reset_token_id = platform_control::insert_password_reset_token(
            pool,
            &platform_id,
            &token_hash,
            expires_at,
        )
        .await
        .map_err(ApiError::internal)?;
        let admin = state
            .config
            .stdb_server_token
            .as_deref()
            .filter(|t| is_usable_admin_token(t))
            .ok_or_else(|| ApiError::Internal("STDB_SERVER_TOKEN is not configured".into()))?;
        state
            .client_with_token(admin)
            .call_reducer(stdb_client::reducer_call!(
                "bind_password_reset_token",
                json!([
                    platform_id.as_str(),
                    platform_reset_token_id.as_str(),
                    identity_json_for_reducer_call(&cred.identity_hex),
                    expires_at_micros.to_string(),
                ]),
            ))
            .await
            .map_err(ApiError::internal)?;

        if let Some(ref api_key) = state.config.resend_api_key {
            let from = state.config.resend_from_email.clone();
            let app = state.config.app_url.clone();
            let link = format!("{app}/reset-password?token={}", urlencoding::encode(&token));
            let text = format!(
                "You requested a password reset.\n\nReset your password:\n{link}\n\nThis link expires in 1 hour."
            );
            let http = state.http.clone();
            let api_key = api_key.clone();
            tokio::spawn(async move {
                if let Err(e) = send_resend_email(
                    &http,
                    &api_key,
                    &from,
                    &email,
                    "Reset your Lumiere ERP password",
                    &text,
                )
                .await
                {
                    tracing::warn!(target: "api_server::auth", "reset email failed: {e}");
                }
            });
        }
    }

    Ok(Json(json!({ "message": msg })))
}

#[derive(Debug, Deserialize)]
pub(super) struct ResetBody {
    token: String,
    #[serde(rename = "newPassword")]
    new_password: String,
}

pub(super) async fn reset_password(
    State(state): State<Arc<AppState>>,
    cookies: Cookies,
    Json(body): Json<ResetBody>,
) -> Result<impl IntoResponse, ApiError> {
    if state.config.workos_client_id.is_some() {
        return Err(ApiError::Gone(
            "Password reset is handled by WorkOS.".into(),
        ));
    }

    if body.new_password.len() < 8 {
        return Err(ApiError::BadRequest(
            "Password must be at least 8 characters".into(),
        ));
    }

    let key = state
        .config
        .stdb_credential_encryption_key
        .as_ref()
        .ok_or_else(|| {
            ApiError::Internal("STDB_CREDENTIAL_ENCRYPTION_KEY not configured".into())
        })?;

    let hash = hex::encode(Sha256::digest(body.token.as_bytes()));
    let reset_token = find_reset_token_by_hash(&state, &hash)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Invalid or expired reset link".into()))?;

    if reset_token.used_at.is_some() {
        return Err(ApiError::BadRequest(
            "Reset link has already been used".into(),
        ));
    }

    let now_s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    if micros_to_secs(reset_token.expires_at) < now_s {
        return Err(ApiError::BadRequest("Reset link has expired".into()));
    }

    let new_hash =
        bcrypt::hash(body.new_password, bcrypt::DEFAULT_COST).map_err(ApiError::internal)?;

    let platform_id =
        PlatformId::new(reset_token.platform_user_id.clone()).map_err(ApiError::internal)?;
    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })?;
    if !platform_control::consume_password_reset_token(pool, &hash)
        .await
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::BadRequest("Invalid or expired reset link".into()));
    }
    if !platform_control::replace_password_hash(pool, &platform_id, &new_hash)
        .await
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::BadRequest("Invalid or expired reset link".into()));
    }

    if let Some(cred) = find_credential_by_platform_id(&state, platform_id.as_str()).await? {
        let admin = state
            .config
            .stdb_server_token
            .as_deref()
            .filter(|t| is_usable_admin_token(t))
            .ok_or_else(|| ApiError::Internal("STDB_SERVER_TOKEN is not configured".into()))?;
        state
            .client_with_token(admin)
            .call_reducer(stdb_client::reducer_call!(
                "mark_password_reset_token_projection_used",
                json!([reset_token.platform_reset_token_id]),
            ))
            .await
            .map_err(ApiError::internal)?;
        let raw = decrypt_token(key, &cred.stdb_token_enc)?;
        let id_hex = normalize_identity_hex_for_sql(&cred.identity_hex);
        set_stdb_session_cookies(&state.config, &cookies, &raw, &id_hex);
    }

    Ok(Json(json!({ "redirectTo": "/overview" })))
}

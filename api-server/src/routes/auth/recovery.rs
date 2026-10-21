//! Password reset request and completion handlers.
use super::cookies::clear_stdb_session_cookies;
use crate::auth_password::{
    find_credential_by_email, find_reset_token_by_hash, generate_secure_token,
    hash_native_password, normalized_auth_email, now_micros, send_resend_email,
    validate_native_password,
};
use crate::cold_tier::pg_pool;
use crate::commands::{dispatch_internal_reducer, InternalRouteAuthority};
use crate::error::ApiError;
use crate::platform_control::{self, PlatformId};
use crate::session::identity_json_for_reducer_call;
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
    require_supported_password_recovery(state.config.workos_client_id.is_some())?;

    let msg = "If that email exists, a reset link has been sent.";
    let Ok(email) = normalized_auth_email(&body.email) else {
        return Ok(Json(json!({ "message": msg })));
    };

    let cred = match find_credential_by_email(&state, &email).await {
        Ok(c) => c,
        Err(_) => return Ok(Json(json!({ "message": msg }))),
    };

    if let Some(cred) = cred.filter(|c| c.password_hash.is_some()) {
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
        dispatch_internal_reducer(
            &state,
            InternalRouteAuthority::PasswordRecovery,
            None,
            "bind_password_reset_token",
            json!([
                platform_id.as_str(),
                platform_reset_token_id.as_str(),
                identity_json_for_reducer_call(&cred.identity_hex),
                expires_at_micros.to_string(),
            ]),
        )
        .await?;

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
    require_supported_password_recovery(state.config.workos_client_id.is_some())?;

    validate_native_password(&body.new_password)?;
    if body.token.len() != 43 {
        return Err(ApiError::BadRequest("Invalid or expired reset link".into()));
    }

    let hash = hex::encode(Sha256::digest(body.token.as_bytes()));
    let reset_token = find_reset_token_by_hash(&state, &hash)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Invalid or expired reset link".into()))?;

    validate_reset_state(&reset_token, std::time::SystemTime::now())?;
    let new_hash = hash_native_password(body.new_password).await?;

    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })?;
    if !platform_control::complete_password_reset(pool, &hash, &new_hash)
        .await
        .map_err(ApiError::internal)?
    {
        return Err(ApiError::BadRequest("Invalid or expired reset link".into()));
    }
    dispatch_internal_reducer(
        &state,
        InternalRouteAuthority::PasswordRecovery,
        None,
        "mark_password_reset_token_projection_used",
        json!([reset_token.platform_reset_token_id]),
    )
    .await?;
    // Password recovery must not reissue the previous persistent STDB token.
    clear_stdb_session_cookies(&state.config, &cookies);

    Ok(Json(json!({ "redirectTo": "/sign-in" })))
}

fn validate_reset_state(
    token: &crate::auth_password::StdbResetToken,
    now: std::time::SystemTime,
) -> Result<(), ApiError> {
    if token.used_at.is_some() || token.expires_at <= now {
        return Err(ApiError::BadRequest("Invalid or expired reset link".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_is_fail_closed_until_sessions_are_revocable() {
        assert!(matches!(
            require_supported_password_recovery(false),
            Err(ApiError::Gone(_))
        ));
        assert!(matches!(
            require_supported_password_recovery(true),
            Err(ApiError::Gone(_))
        ));
    }
    #[test]
    fn reset_expiry_uses_system_time_and_rejects_used_links() {
        let now = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_800_000_000);
        let mut token = crate::auth_password::StdbResetToken {
            platform_reset_token_id: "p_token".into(),
            platform_user_id: "p_user".into(),
            expires_at: now + std::time::Duration::from_secs(3600),
            used_at: None,
        };
        assert!(validate_reset_state(&token, now).is_ok());
        assert!(validate_reset_state(&token, token.expires_at).is_err());
        assert!(
            validate_reset_state(&token, token.expires_at + std::time::Duration::from_secs(1))
                .is_err()
        );
        token.used_at = Some(now);
        assert!(validate_reset_state(&token, now).is_err());
    }
}

fn require_supported_password_recovery(workos: bool) -> Result<(), ApiError> {
    Err(ApiError::Gone(if workos {
        "Password reset is handled by WorkOS. Use the WorkOS sign-in screen."
    } else {
        "Native password recovery is unavailable until revocable sessions are supported. Contact your alpha administrator."
    }.into()))
}

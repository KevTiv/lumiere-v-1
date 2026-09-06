//! Password sign-in, sign-up, and sign-out handlers.
use super::cookies::{clear_stdb_session_cookies, set_stdb_session_cookies};
use crate::auth_password::{
    decrypt_token, encrypt_token, find_credential_by_email, post_auth_destination_after_session,
    send_resend_email, user_has_organization_rows,
};
use crate::cold_tier::pg_pool;
use crate::error::ApiError;
use crate::platform_control::{self, PlatformId};
use crate::session::normalize_identity_hex_for_sql;
use crate::state::AppState;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tower_cookies::Cookies;

#[derive(Debug, Deserialize)]
pub(super) struct SignInBody {
    email: String,
    password: String,
}

pub(super) async fn signin(
    State(state): State<Arc<AppState>>,
    cookies: Cookies,
    Json(body): Json<SignInBody>,
) -> Result<impl IntoResponse, ApiError> {
    if state.config.workos_client_id.is_some() {
        return Err(ApiError::Gone(
            "Password sign-in is disabled. Use the WorkOS sign-in page (Continue with WorkOS)."
                .into(),
        ));
    }

    let key = state
        .config
        .stdb_credential_encryption_key
        .as_ref()
        .ok_or_else(|| {
            ApiError::Internal("STDB_CREDENTIAL_ENCRYPTION_KEY not configured".into())
        })?;

    // Match sign-up / forgot-password: emails are stored lowercased in `user_credential`.
    let email = body.email.trim().to_lowercase();
    let cred = find_credential_by_email(&state, &email)
        .await?
        .ok_or(ApiError::InvalidEmailOrPassword)?;

    let ph = cred.password_hash.as_deref().unwrap_or("");
    if ph.is_empty() {
        return Err(ApiError::AccountUsesSso);
    }

    let ok = bcrypt::verify(body.password.as_bytes(), ph).map_err(ApiError::internal)?;
    if !ok {
        return Err(ApiError::InvalidEmailOrPassword);
    }

    let token = decrypt_token(key, &cred.stdb_token_enc)?;
    let identity_hex = normalize_identity_hex_for_sql(&cred.identity_hex);
    set_stdb_session_cookies(&state.config, &cookies, &token, &identity_hex);

    let has_org = user_has_organization_rows(&state, &identity_hex, &token).await;
    let dest = post_auth_destination_after_session(has_org);

    Ok(Json(json!({ "redirectTo": dest })))
}

#[derive(Debug, Deserialize)]
pub(super) struct SignUpBody {
    email: String,
    password: String,
}

pub(super) async fn signup(
    State(state): State<Arc<AppState>>,
    cookies: Cookies,
    Json(body): Json<SignUpBody>,
) -> Result<impl IntoResponse, ApiError> {
    if state.config.workos_client_id.is_some() {
        return Err(ApiError::Gone(
            "Password sign-up is disabled. Use the WorkOS sign-up page (Continue with WorkOS)."
                .into(),
        ));
    }

    if body.password.len() < 8 {
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

    let email = body.email.trim().to_lowercase();
    if let Some(_) = find_credential_by_email(&state, &email).await? {
        return Err(ApiError::Conflict("Email already registered".into()));
    }

    let (identity, token) = state
        .stdb
        .provision_identity()
        .await
        .map_err(ApiError::internal)?;

    let password_hash =
        bcrypt::hash(body.password, bcrypt::DEFAULT_COST).map_err(ApiError::internal)?;
    let token_enc = encrypt_token(key, &token)?;

    let identity_hex = normalize_identity_hex_for_sql(&identity);
    let platform_user_id = PlatformId::generate();
    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })?;
    platform_control::insert_user_credential(
        pool,
        &platform_control::UserCredential {
            platform_user_id: platform_user_id.clone(),
            email: email.clone(),
            stdb_identity_hex: identity_hex.clone(),
            password_hash: Some(password_hash),
            workos_user_id: None,
            stdb_token_enc: token_enc,
            email_verified: false,
        },
    )
    .await
    .map_err(ApiError::internal)?;
    platform_control::upsert_user_profile(
        pool,
        &platform_control::UserProfile {
            platform_user_id,
            stdb_identity_hex: identity_hex.clone(),
            email: email.clone(),
            email_verified: false,
            name: String::new(),
            first_name: None,
            last_name: None,
            timezone: "UTC".into(),
            language: "en".into(),
            is_active: true,
            is_superuser: false,
        },
    )
    .await
    .map_err(ApiError::internal)?;
    set_stdb_session_cookies(&state.config, &cookies, &token, &identity_hex);

    if let Some(ref api_key) = state.config.resend_api_key {
        let from = state.config.resend_from_email.clone();
        let app = state.config.app_url.clone();
        let to = email.clone();
        let http = state.http.clone();
        let api_key = api_key.clone();
        tokio::spawn(async move {
            let text = format!(
                "Welcome! Your account has been created.\n\nGet started at {app}/onboarding"
            );
            if let Err(e) =
                send_resend_email(&http, &api_key, &from, &to, "Welcome to Lumiere ERP", &text)
                    .await
            {
                tracing::warn!(target: "api_server::auth", "welcome email failed: {e}");
            }
        });
    }

    let dest = post_auth_destination_after_session(false);
    Ok(Json(json!({ "redirectTo": dest })))
}

pub(super) async fn signout(
    State(state): State<Arc<AppState>>,
    cookies: Cookies,
) -> impl IntoResponse {
    clear_stdb_session_cookies(&cookies);
    let _ = state; // WorkOS: clear STDB cookies only; AuthKit session end stays client-side if needed.
    Json(json!({ "redirectTo": "/sign-in" }))
}

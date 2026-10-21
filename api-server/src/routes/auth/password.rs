//! Password sign-in, sign-up, and sign-out handlers.
use super::cookies::{clear_stdb_session_cookies, set_stdb_session_cookies};
use crate::auth_password::{
    decrypt_token, find_credential_by_email, normalized_auth_email,
    post_auth_destination_after_session, user_has_organization_rows, verify_native_password,
};
use crate::error::ApiError;
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
    let email = normalized_auth_email(&body.email)?;
    let cred = find_credential_by_email(&state, &email)
        .await?
        .ok_or(ApiError::InvalidEmailOrPassword)?;

    let ph = cred.password_hash.as_deref().unwrap_or("");
    if ph.is_empty() {
        return Err(ApiError::AccountUsesSso);
    }

    let ok = verify_native_password(body.password, ph.to_owned()).await?;
    if !ok {
        return Err(ApiError::InvalidEmailOrPassword);
    }

    let token = decrypt_token(key, &cred.stdb_token_enc)?;
    let identity_hex = normalize_identity_hex_for_sql(&cred.identity_hex);
    set_stdb_session_cookies(&state.config, &cookies, &token, &identity_hex);

    let has_org = user_has_organization_rows(&state, &identity_hex).await;
    let dest = post_auth_destination_after_session(has_org);

    Ok(Json(json!({ "redirectTo": dest })))
}

#[derive(Debug, Deserialize)]
pub(super) struct SignUpBody {
    email: String,
    password: String,
}

pub(super) async fn signup(
    State(_state): State<Arc<AppState>>,
    _cookies: Cookies,
    Json(_body): Json<SignUpBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    // Alpha admission is invitation-only at the API boundary too. Gateway
    // filtering is defense in depth, not the registration authority.
    Err(ApiError::Gone(
        "Public registration is disabled for the alpha. Ask your organization administrator for an invitation.".into(),
    ))
}

pub(super) async fn signout(
    State(state): State<Arc<AppState>>,
    cookies: Cookies,
) -> impl IntoResponse {
    clear_stdb_session_cookies(&state.config, &cookies);
    // WorkOS: clear STDB cookies only; AuthKit session end stays client-side if needed.
    Json(json!({ "redirectTo": "/sign-in" }))
}

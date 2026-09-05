//! WorkOS bootstrap and internal service-token credential bridging.
use crate::auth_password::{decrypt_token, encrypt_token, is_usable_admin_token};
use crate::cold_tier::pg_pool;
use crate::error::ApiError;
use crate::platform_control::{self, PlatformId};
use crate::session::normalize_identity_hex_for_sql;
use crate::state::AppState;
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkosBridgeBody {
    email: String,
    workos_user_id: String,
    email_verified: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct BootstrapCredentialBody {
    email: String,
    password: String,
}

pub(super) fn require_service_token<'a>(
    state: &'a AppState,
    headers: &axum::http::HeaderMap,
) -> Result<&'a str, ApiError> {
    let expected = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|token| is_usable_admin_token(token))
        .ok_or_else(|| ApiError::Internal("STDB_SERVER_TOKEN is not configured".into()))?;
    let supplied = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    if supplied != Some(expected) {
        return Err(ApiError::Unauthorized);
    }
    Ok(expected)
}

pub(super) async fn workos_bridge(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(body): Json<WorkosBridgeBody>,
) -> Result<Json<Value>, ApiError> {
    require_service_token(&state, &headers)?;

    let email = body.email.trim().to_lowercase();
    let workos_user_id = body.workos_user_id.trim();
    if email.is_empty() || !email.contains('@') || workos_user_id.is_empty() {
        return Err(ApiError::BadRequest("WorkOS identity is incomplete".into()));
    }
    let key = state
        .config
        .stdb_credential_encryption_key
        .as_ref()
        .ok_or_else(|| {
            ApiError::Internal("STDB_CREDENTIAL_ENCRYPTION_KEY not configured".into())
        })?;
    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })?;

    let existing = platform_control::find_user_credential_by_workos_user_id(pool, workos_user_id)
        .await
        .map_err(ApiError::internal)?
        .or(
            platform_control::find_user_credential_by_email(pool, &email)
                .await
                .map_err(ApiError::internal)?,
        );

    let (platform_user_id, identity_hex, token) = if let Some(row) = existing {
        let linked_subject = row.get::<_, Option<String>>("workos_user_id");
        if linked_subject
            .as_deref()
            .is_some_and(|subject| subject != workos_user_id)
        {
            return Err(ApiError::Conflict(
                "This email is already linked to a different SSO identity".into(),
            ));
        }
        let platform_user_id = PlatformId::new(row.get::<_, String>("platform_user_id"))
            .map_err(ApiError::internal)?;
        if !platform_control::attach_workos_subject(
            pool,
            &platform_user_id,
            workos_user_id,
            body.email_verified,
        )
        .await
        .map_err(ApiError::internal)?
        {
            return Err(ApiError::Conflict(
                "WorkOS identity could not be linked".into(),
            ));
        }
        let identity_hex = row.get::<_, String>("stdb_identity_hex");
        let token = decrypt_token(key, &row.get::<_, String>("stdb_token_enc"))?;
        (platform_user_id, identity_hex, token)
    } else {
        let (identity, token) = state
            .stdb
            .provision_identity()
            .await
            .map_err(ApiError::internal)?;
        let identity_hex = normalize_identity_hex_for_sql(&identity);
        let platform_user_id = PlatformId::generate();
        platform_control::insert_user_credential(
            pool,
            &platform_control::UserCredential {
                platform_user_id: platform_user_id.clone(),
                email: email.clone(),
                stdb_identity_hex: identity_hex.clone(),
                password_hash: None,
                workos_user_id: Some(workos_user_id.to_string()),
                stdb_token_enc: encrypt_token(key, &token)?,
                email_verified: body.email_verified,
            },
        )
        .await
        .map_err(ApiError::internal)?;
        platform_control::upsert_user_profile(
            pool,
            &platform_control::UserProfile {
                platform_user_id: platform_user_id.clone(),
                stdb_identity_hex: identity_hex.clone(),
                email: email.clone(),
                email_verified: body.email_verified,
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
        (platform_user_id, identity_hex, token)
    };

    Ok(Json(json!({
        "platformUserId": platform_user_id.as_str(),
        "identity": identity_hex,
        "token": token,
    })))
}

pub(super) async fn bootstrap_credential(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Json(body): Json<BootstrapCredentialBody>,
) -> Result<Json<Value>, ApiError> {
    require_service_token(&state, &headers)?;
    let email = body.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') || body.password.len() < 8 {
        return Err(ApiError::BadRequest(
            "A valid email and password of at least 8 characters are required".into(),
        ));
    }
    let key = state
        .config
        .stdb_credential_encryption_key
        .as_ref()
        .ok_or_else(|| {
            ApiError::Internal("STDB_CREDENTIAL_ENCRYPTION_KEY not configured".into())
        })?;
    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })?;

    let (platform_user_id, identity_hex, token) = if let Some(row) =
        platform_control::find_user_credential_by_email(pool, &email)
            .await
            .map_err(ApiError::internal)?
    {
        let platform_user_id = PlatformId::new(row.get::<_, String>("platform_user_id"))
            .map_err(ApiError::internal)?;
        let identity_hex = row.get::<_, String>("stdb_identity_hex");
        let token = decrypt_token(key, &row.get::<_, String>("stdb_token_enc"))?;
        (platform_user_id, identity_hex, token)
    } else {
        let (identity, token) = state
            .stdb
            .provision_identity()
            .await
            .map_err(ApiError::internal)?;
        let identity_hex = normalize_identity_hex_for_sql(&identity);
        let platform_user_id = PlatformId::generate();
        let password_hash =
            bcrypt::hash(body.password, bcrypt::DEFAULT_COST).map_err(ApiError::internal)?;
        platform_control::insert_user_credential(
            pool,
            &platform_control::UserCredential {
                platform_user_id: platform_user_id.clone(),
                email: email.clone(),
                stdb_identity_hex: identity_hex.clone(),
                password_hash: Some(password_hash),
                workos_user_id: None,
                stdb_token_enc: encrypt_token(key, &token)?,
                email_verified: false,
            },
        )
        .await
        .map_err(ApiError::internal)?;
        platform_control::upsert_user_profile(
            pool,
            &platform_control::UserProfile {
                platform_user_id: platform_user_id.clone(),
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
        (platform_user_id, identity_hex, token)
    };

    Ok(Json(json!({
        "platformUserId": platform_user_id.as_str(),
        "identity": identity_hex,
        "token": token,
    })))
}

//! Authenticated PostgreSQL profile reads and updates.
use crate::auth_password::is_usable_admin_token;
use crate::cold_tier::pg_pool;
use crate::error::ApiError;
use crate::platform_control::{self, PlatformId};
use crate::session::identity_json_for_reducer_call;
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};
use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tower_cookies::Cookies;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileUpdateBody {
    email: Option<String>,
    name: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    timezone: Option<String>,
    language: Option<String>,
}

pub(super) async fn profile_get(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    cookies: Cookies,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    require_org(&session)?;
    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })?;
    let row = platform_control::find_user_profile_by_stdb_identity(pool, &session.identity_hex)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound("User profile not found".into()))?;
    let profile = json!({
        "platformUserId": row.get::<_, String>("platform_user_id"),
        "email": row.get::<_, String>("email"),
        "emailVerified": row.get::<_, bool>("email_verified"),
        "name": row.get::<_, String>("name"),
        "firstName": row.get::<_, Option<String>>("first_name"),
        "lastName": row.get::<_, Option<String>>("last_name"),
        "timezone": row.get::<_, String>("timezone"),
        "language": row.get::<_, String>("language"),
        "isActive": row.get::<_, bool>("is_active"),
        "isSuperuser": row.get::<_, bool>("is_superuser"),
    });
    Ok(Json(json!({ "data": profile })))
}

pub(super) async fn profile_update(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    cookies: Cookies,
    Json(body): Json<ProfileUpdateBody>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let organization_id = require_org(&session)?;
    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })?;
    let profile = platform_control::find_user_profile_by_stdb_identity(pool, &session.identity_hex)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound("User profile not found".into()))?;
    let platform_id = profile.get::<_, String>("platform_user_id");
    let platform_id = PlatformId::new(platform_id).map_err(ApiError::internal)?;
    if let Some(email) = body.email.as_deref() {
        let email = email.trim().to_lowercase();
        if email.is_empty() || !email.contains('@') {
            return Err(ApiError::BadRequest("Email must be valid".into()));
        }
        if !platform_control::update_user_email(pool, &platform_id, &email)
            .await
            .map_err(ApiError::internal)?
        {
            return Err(ApiError::NotFound("User profile not found".into()));
        }
    }
    if !platform_control::update_user_profile(
        pool,
        &platform_id,
        body.name.as_deref(),
        body.first_name.as_deref(),
        body.last_name.as_deref(),
        body.timezone.as_deref(),
        body.language.as_deref(),
    )
    .await
    .map_err(ApiError::internal)?
    {
        return Err(ApiError::NotFound("User profile not found".into()));
    }

    // PostgreSQL is canonical; immediately refresh the organization-owned
    // compatibility projection through the operator-only reducer. The target
    // identity and organization are derived from the authenticated session,
    // never accepted from the browser payload.
    let projected = platform_control::find_user_profile_by_platform_id(pool, &platform_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::NotFound("User profile not found".into()))?;
    let admin = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|token| is_usable_admin_token(token))
        .ok_or_else(|| ApiError::Internal("STDB_SERVER_TOKEN is not configured".into()))?;
    state
        .client_with_token(admin)
        .call_reducer(stdb_client::reducer_call!(
            "project_user_profile",
            json!([
                identity_json_for_reducer_call(&session.identity_hex),
                organization_id,
                projected.get::<_, String>("email"),
                projected.get::<_, bool>("email_verified"),
                projected.get::<_, String>("name"),
                projected.get::<_, Option<String>>("first_name"),
                projected.get::<_, Option<String>>("last_name"),
                projected.get::<_, String>("timezone"),
                projected.get::<_, String>("language"),
            ]),
        ))
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "success": true })))
}

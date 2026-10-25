//! Authenticated PostgreSQL profile reads and updates.
use crate::cold_tier::pg_pool;
use crate::commands::{dispatch_internal_reducer, InternalRouteAuthority};
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
        "isActive": platform_control::profile_is_active(&row),
        "isSuperuser": platform_control::profile_is_active(&row) && row.get::<_, bool>("is_superuser"),
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
    if state.config.workos_client_id.is_some() && body.email.is_some() {
        return Err(ApiError::BadRequest("Email changes require WorkOS verification and updated alpha approval; contact your administrator".into()));
    }
    if body
        .timezone
        .as_ref()
        .is_some_and(|zone| zone.parse::<chrono_tz::Tz>().is_err())
    {
        return Err(ApiError::BadRequest("Choose a valid IANA timezone".into()));
    }
    for value in [
        &body.name,
        &body.first_name,
        &body.last_name,
        &body.timezone,
        &body.language,
    ]
    .into_iter()
    .flatten()
    {
        if value.len() > 256 || value.chars().any(char::is_control) {
            return Err(ApiError::BadRequest(
                "Profile values must be at most 256 characters without control characters".into(),
            ));
        }
    }
    let email = body.email.map(|email| email.trim().to_lowercase());
    if email
        .as_deref()
        .is_some_and(|email| email.is_empty() || !email.contains('@'))
    {
        return Err(ApiError::BadRequest("Email must be valid".into()));
    }
    let memberships =
        crate::session::membership_rows_for_identity(&state, &session.identity_hex, true).await?;
    let organizations: Vec<i64> = memberships
        .iter()
        .filter_map(|row| {
            row.get("organizationId")
                .or_else(|| row.get("organization_id"))
        })
        .filter_map(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
        .filter(|id| *id > 0)
        .collect();
    if !platform_control::save_profile_patch(
        pool,
        &platform_id,
        &organizations,
        email.as_deref(),
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
    // Canonical data is committed even if the module is temporarily unavailable.
    // Session resolution automatically retries the durable per-organization work.
    let projection_pending =
        flush_profile_projection(&state, &platform_id, &session.identity_hex, organization_id)
            .await
            .is_err();
    Ok(Json(
        json!({ "success": true, "projectionPending": projection_pending }),
    ))
}

/// Serialize projection attempts with the outbox row so older writes cannot win.
pub(crate) async fn flush_profile_projection(
    state: &AppState,
    platform_id: &PlatformId,
    identity_hex: &str,
    organization_id: u64,
) -> Result<(), ApiError> {
    let pool = pg_pool::shared_pool()
        .ok_or_else(|| ApiError::Unavailable("Profile storage unavailable".into()))?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let org = i64::try_from(organization_id).map_err(ApiError::internal)?;
    if tx.query_opt("SELECT revision FROM lumiere_platform.profile_projection_pending WHERE platform_user_id=$1 AND organization_id=$2 FOR UPDATE", &[&platform_id.as_str(), &org]).await.map_err(ApiError::internal)?.is_none() {
        return Ok(());
    }
    let projected = tx.query_opt("SELECT email,email_verified,name,first_name,last_name,timezone,language FROM lumiere_platform.user_profile WHERE platform_user_id=$1 AND stdb_identity_hex=$2", &[&platform_id.as_str(), &identity_hex])
        .await.map_err(ApiError::internal)?.ok_or(ApiError::Unauthorized)?;
    dispatch_internal_reducer(
        state,
        InternalRouteAuthority::PlatformProfileProjection,
        Some(organization_id),
        "project_user_profile",
        json!([
            identity_json_for_reducer_call(identity_hex),
            organization_id,
            projected.get::<_, String>("email"),
            projected.get::<_, bool>("email_verified"),
            projected.get::<_, String>("name"),
            projected.get::<_, Option<String>>("first_name"),
            projected.get::<_, Option<String>>("last_name"),
            projected.get::<_, String>("timezone"),
            projected.get::<_, String>("language")
        ]),
    )
    .await?;
    tx.execute("DELETE FROM lumiere_platform.profile_projection_pending WHERE platform_user_id=$1 AND organization_id=$2", &[&platform_id.as_str(), &org]).await.map_err(ApiError::internal)?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(())
}

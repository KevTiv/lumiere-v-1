//! Organization invitation creation and acceptance handlers.
use super::cookies::set_stdb_session_cookies;
use crate::auth_password::{
    authenticate_invite_credential, encrypt_token, find_credential_by_email,
    find_invite_by_token_hash, generate_secure_token, get_role_name_in_organization,
    hash_native_password, normalized_auth_email, now_micros, send_resend_email,
    validate_native_password,
};
use crate::cold_tier::pg_pool;
use crate::commands::{dispatch_internal_reducer, InternalRouteAuthority};
use crate::error::ApiError;
use crate::platform_control::{self, PlatformId};
use crate::session::{identity_json_for_reducer_call, normalize_identity_hex_for_sql};
use crate::state::AppState;
use crate::trusted_context::TrustedOperationContext;
use crate::web_session::{require_org, resolve_session};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tower_cookies::Cookies;

#[derive(Debug, Deserialize)]
pub(super) struct InviteBody {
    email: String,
    #[serde(rename = "roleId")]
    role_id: u64,
    #[serde(rename = "organizationId")]
    organization_id: u64,
}

pub(super) async fn invite(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<InviteBody>,
) -> Result<impl IntoResponse, ApiError> {
    if state.config.workos_client_id.is_some() {
        return Err(ApiError::Gone(
            "Invitations use the WorkOS membership flow".into(),
        ));
    }
    let email = normalized_auth_email(&body.email)?;
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    let session_organization_id = require_org(&session)?;
    if body.organization_id != session_organization_id {
        return Err(ApiError::Forbidden(
            "invitation organization does not match the authenticated session".into(),
        ));
    }
    let identity_hex = session.identity_hex.clone();

    let context = TrustedOperationContext::for_resource_read(&state, &session)?;
    let client = context.client();
    let sql = stdb_auth::select_user_role_assignments_for_identity_sql(&identity_hex, None)
        .map_err(ApiError::Internal)?;
    let assignments = client.query_sql(&sql).await.map_err(ApiError::internal)?;
    let assignments: Vec<_> = assignments
        .into_iter()
        .filter(|row| {
            row.get("organizationId")
                .or_else(|| row.get("organization_id"))
                .and_then(json_u64)
                == Some(body.organization_id)
                && row
                    .get("expiresAt")
                    .or_else(|| row.get("expires_at"))
                    .filter(|v| !v.is_null())
                    .map(|v| {
                        v.as_i64()
                            .or_else(|| v.as_str()?.parse().ok())
                            .is_some_and(|expiry| i128::from(expiry) > now_micros())
                    })
                    .unwrap_or(true)
        })
        .collect();
    if assignments.is_empty() {
        return Err(ApiError::Forbidden(
            "Forbidden: not a member of this organization".into(),
        ));
    }

    let role_ids: Vec<u64> = assignments
        .iter()
        .filter_map(|r| {
            r.get("roleId")
                .or_else(|| r.get("role_id"))
                .and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
        })
        .collect();

    if role_ids.is_empty() {
        return Err(ApiError::Forbidden(
            "Forbidden: not a member of this organization".into(),
        ));
    }

    // SpacetimeDB HTTP SQL does not support `IN (...)` — fetch org roles and filter in Rust.
    let roles_sql = format!(
        "SELECT id, name FROM role WHERE is_active = true AND organization_id = {}",
        body.organization_id
    );
    let all_roles = client
        .query_sql(&roles_sql)
        .await
        .map_err(ApiError::internal)?;
    let role_id_set: std::collections::HashSet<u64> = role_ids.iter().copied().collect();
    let roles: Vec<serde_json::Value> = all_roles
        .into_iter()
        .filter(|r| {
            r.get("id")
                .and_then(|v| {
                    v.as_u64()
                        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                })
                .is_some_and(|id| role_id_set.contains(&id))
        })
        .collect();

    let is_admin = roles.iter().any(|r| {
        r.get("name")
            .and_then(|v| v.as_str())
            .map(|n| {
                let l = n.to_lowercase();
                l == "owner" || l == "admin" || l == "administrator"
            })
            .unwrap_or(false)
    });
    if !is_admin {
        return Err(ApiError::Forbidden(
            "Forbidden: insufficient permissions".into(),
        ));
    }

    let (token, token_hash) = generate_secure_token();
    let expires_at = now_micros() + (7_i128 * 24 * 60 * 60 * 1_000_000);

    dispatch_internal_reducer(
        &state,
        InternalRouteAuthority::InvitationCreation,
        Some(body.organization_id),
        "create_user_invite",
        json!([
            body.organization_id,
            body.role_id,
            email.clone(),
            token_hash,
            identity_json_for_reducer_call(&identity_hex),
            expires_at.to_string()
        ]),
    )
    .await?;

    let org_sql = format!(
        "SELECT name FROM organization WHERE id = {}",
        body.organization_id
    );
    let org_rows = client
        .query_sql(&org_sql)
        .await
        .map_err(ApiError::internal)?;
    let org_name: String = org_rows
        .first()
        .and_then(|r| r.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Lumiere ERP")
        .to_string();

    if let Some(ref api_key) = state.config.resend_api_key {
        let from = state.config.resend_from_email.clone();
        let app = state.config.app_url.clone();
        let to = email.clone();
        let link = format!("{app}/accept-invite?token={}", urlencoding::encode(&token));
        let text = format!(
            "Your colleague has invited you to join {org_name} on Lumiere ERP.\n\nAccept:\n{link}\n\nExpires in 7 days."
        );
        let http = state.http.clone();
        let api_key = api_key.clone();
        tokio::spawn(async move {
            if let Err(e) = send_resend_email(
                &http,
                &api_key,
                &from,
                &to,
                &format!("You've been invited to {org_name} on Lumiere ERP"),
                &text,
            )
            .await
            {
                tracing::warn!(target: "api_server::auth", "invite email failed: {e}");
            }
        });
    }

    Ok(Json(json!({ "success": true })))
}

#[derive(Debug, Deserialize)]
pub(super) struct AcceptInviteBody {
    token: String,
    email: String,
    password: String,
}

pub(super) async fn accept_invite(
    State(state): State<Arc<AppState>>,
    cookies: Cookies,
    Json(body): Json<AcceptInviteBody>,
) -> Result<impl IntoResponse, ApiError> {
    if state.config.workos_client_id.is_some() {
        return Err(ApiError::Gone(
            "Invitation acceptance uses WorkOS. Open the invitation link and use Continue with WorkOS."
                .into(),
        ));
    }

    validate_native_password(&body.password)?;
    let email = normalized_auth_email(&body.email)?;
    if body.token.len() != 43 {
        return Err(ApiError::BadRequest("Invalid or expired invitation".into()));
    }

    let key = state
        .config
        .stdb_credential_encryption_key
        .as_ref()
        .ok_or_else(|| {
            ApiError::Internal("STDB_CREDENTIAL_ENCRYPTION_KEY not configured".into())
        })?;

    let hash = hex::encode(Sha256::digest(body.token.as_bytes()));
    let invite = find_invite_by_token_hash(&state, &hash)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Invalid or expired invitation".into()))?;

    if invite.accepted_at.is_some() {
        return Err(ApiError::BadRequest(
            "Invitation has already been used".into(),
        ));
    }

    let now_micros_i = now_micros() as i64;
    if invite.expires_at <= now_micros_i {
        return Err(ApiError::BadRequest("Invitation has expired".into()));
    }

    if normalized_auth_email(&invite.email)? != email {
        return Err(ApiError::BadRequest(
            "Email does not match invitation".into(),
        ));
    }

    let role_name = get_role_name_in_organization(&state, invite.role_id, invite.organization_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Invite role not found".into()))?;
    let (member_identity, stdb_token, platform_user_id, new_credential) =
        if let Some(existing) = find_credential_by_email(&state, &email).await? {
            let tok = authenticate_invite_credential(&existing, body.password.clone(), key).await?;
            (
                existing.identity_hex.clone(),
                tok,
                PlatformId::new(existing.platform_user_id.clone()).map_err(ApiError::internal)?,
                None,
            )
        } else {
            let password_hash = hash_native_password(body.password.clone()).await?;
            let (identity, token) = state
                .stdb
                .provision_identity()
                .await
                .map_err(ApiError::internal)?;
            let token_enc = encrypt_token(key, &token)?;
            (
                identity,
                token,
                PlatformId::generate(),
                Some((password_hash, token_enc)),
            )
        };

    if let Some((password_hash, token_enc)) = new_credential {
        let pool = pg_pool::shared_pool().ok_or_else(|| {
            ApiError::Unavailable("platform authentication storage is unavailable".into())
        })?;
        let identity_hex = normalize_identity_hex_for_sql(&member_identity);
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
                platform_user_id: platform_user_id.clone(),
                stdb_identity_hex: identity_hex,
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
    }

    // Claim before granting membership: a replay can never mutate access. If a
    // later backend step fails the invite stays consumed and an owner must reissue.
    dispatch_internal_reducer(
        &state,
        InternalRouteAuthority::InvitationAcceptance,
        Some(invite.organization_id),
        "mark_invite_accepted",
        json!([invite.id]),
    )
    .await?;

    // Establish the validated organization membership before materializing the
    // organization-owned credential/profile rows.
    dispatch_internal_reducer(
        &state,
        InternalRouteAuthority::InvitationAcceptance,
        Some(invite.organization_id),
        "add_org_member",
        json!([
                identity_json_for_reducer_call(&member_identity),
                invite.organization_id,
                {
                    "role_name": role_name,
                    "company_id": Value::Null,
                    "job_title": Value::Null,
                    "department_id": Value::Null,
                    "employee_id": Value::Null,
                    "is_active": true,
                    "is_default": true,
                    "metadata": Value::Null,
                }
        ]),
    )
    .await?;

    // The membership reducer derives organization ownership. Only after it
    // succeeds may this opaque platform binding be projected into ERP.
    dispatch_internal_reducer(
        &state,
        InternalRouteAuthority::InvitationAcceptance,
        Some(invite.organization_id),
        "bind_user_credential",
        json!([
            platform_user_id.as_str(),
            identity_json_for_reducer_call(&member_identity),
            email.clone(),
        ]),
    )
    .await?;
    dispatch_internal_reducer(
        &state,
        InternalRouteAuthority::InvitationAcceptance,
        Some(invite.organization_id),
        "bind_user_profile",
        json!([
            platform_user_id.as_str(),
            identity_json_for_reducer_call(&member_identity),
        ]),
    )
    .await?;

    let id_hex = normalize_identity_hex_for_sql(&member_identity);
    set_stdb_session_cookies(&state.config, &cookies, &stdb_token, &id_hex);

    Ok(Json(json!({ "redirectTo": "/overview" })))
}

fn json_u64(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

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
    // Hosted users may create invitations only through this same authenticated,
    // scoped administrator path. Acceptance separately requires exact WorkOS admission.
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
    let access = session
        .field_access
        .as_ref()
        .ok_or(ApiError::Unauthorized)?;
    if !stdb_auth::permission_allowed(access, "user_organization", "create")
        || !stdb_auth::permission_allowed(access, "user_role_assignment", "create")
    {
        return Err(ApiError::Forbidden(
            "You cannot invite organization members".into(),
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
        let path = if state.config.workos_client_id.is_some() {
            "/auth/invite/prepare"
        } else {
            "/accept-invite"
        };
        let link = format!("{app}{path}?token={}", urlencoding::encode(&token));
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
    // Hosted acceptance derives identity and email solely from the verified provider.
    email: Option<String>,
    password: Option<String>,
}

pub(super) async fn accept_invite(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    cookies: Cookies,
    Json(body): Json<AcceptInviteBody>,
) -> Result<impl IntoResponse, ApiError> {
    if state.config.workos_client_id.is_some() {
        return Ok(Json(
            accept_workos_invite(&state, &headers, &body.token).await?,
        ));
    }

    let password = body.password.as_deref().ok_or_else(|| {
        ApiError::BadRequest("A password is required for native invitation acceptance".into())
    })?;
    let email = normalized_auth_email(body.email.as_deref().ok_or_else(|| {
        ApiError::BadRequest("An email is required for native invitation acceptance".into())
    })?)?;
    validate_native_password(password)?;
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
            let tok = authenticate_invite_credential(&existing, password.to_owned(), key).await?;
            (
                existing.identity_hex.clone(),
                tok,
                PlatformId::new(existing.platform_user_id.clone()).map_err(ApiError::internal)?,
                None,
            )
        } else {
            let password_hash = hash_native_password(password.to_owned()).await?;
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

/** A hosted invitation is never a substitute for alpha admission. All three
 * authorities must agree: WorkOS subject+verified email, admission org, and
 * an unexpired administrator-issued single-use invitation.
 */
fn hosted_invite_matches(
    approved_organization_id: Option<u64>,
    verified_email: &str,
    invite_organization_id: u64,
    invite_email: &str,
) -> bool {
    approved_organization_id == Some(invite_organization_id)
        && !verified_email.is_empty()
        && verified_email.eq_ignore_ascii_case(invite_email)
}

async fn accept_workos_invite(
    state: &AppState,
    headers: &HeaderMap,
    token: &str,
) -> Result<Value, ApiError> {
    let bearer = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or(ApiError::Unauthorized)?;
    // Verify immutable WorkOS subject, canonical verified email, live session,
    // explicit admission and token/identity binding before touching the invite.
    let binding = crate::session::workos::verify_binding(state, bearer, false).await?;
    if token.len() != 43
        || !token
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err(ApiError::BadRequest("Invalid or expired invitation".into()));
    }
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    let invite = find_invite_by_token_hash(state, &hash)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Invalid or expired invitation".into()))?;
    if !hosted_invite_matches(
        binding.organization_id,
        &binding.email,
        invite.organization_id,
        &invite.email,
    ) {
        return Err(ApiError::Forbidden(
            "Invitation is not approved for this WorkOS identity and organization".into(),
        ));
    }
    // The trusted module transaction validates expiry, issuer authority and role,
    // then consumes the invite and materializes membership/bindings together.
    dispatch_internal_reducer(
        state,
        InternalRouteAuthority::InvitationAcceptance,
        Some(invite.organization_id),
        "accept_user_invite",
        json!([
            invite.organization_id,
            invite.id,
            binding.platform_user_id.as_str(),
            identity_json_for_reducer_call(&binding.identity_hex),
            binding.email,
        ]),
    )
    .await?;

    // Hosted sessions remain provider-owned; never mint a native STDB cookie.
    Ok(json!({ "redirectTo": "/overview" }))
}

#[cfg(test)]
mod hosted_invite_tests {
    use super::hosted_invite_matches;

    #[test]
    fn requires_matching_approved_organization_and_verified_email() {
        let cases = [
            (
                Some(7),
                "approved@example.test",
                7,
                "approved@example.test",
                true,
            ),
            (
                Some(7),
                "APPROVED@example.test",
                7,
                "approved@example.test",
                true,
            ),
            (
                None,
                "approved@example.test",
                7,
                "approved@example.test",
                false,
            ),
            (
                Some(8),
                "approved@example.test",
                7,
                "approved@example.test",
                false,
            ),
            (
                Some(7),
                "other@example.test",
                7,
                "approved@example.test",
                false,
            ),
            (Some(7), "", 7, "approved@example.test", false),
        ];
        for (org, email, invite_org, invite_email, expected) in cases {
            assert_eq!(
                hosted_invite_matches(org, email, invite_org, invite_email),
                expected
            );
        }
    }
}

fn json_u64(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

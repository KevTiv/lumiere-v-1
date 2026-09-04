use std::sync::Arc;

use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use cookie::time::Duration;
use cookie::{Cookie, SameSite};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tower_cookies::Cookies;

use crate::auth_password::{
    decrypt_token, encrypt_token, find_credential_by_email, find_credential_by_platform_id,
    find_invite_by_token_hash, find_reset_token_by_hash, generate_secure_token,
    get_role_name_in_organization, is_usable_admin_token, micros_to_secs, now_micros,
    post_auth_destination_after_session, send_resend_email, user_has_organization_rows,
};
use crate::cold_tier::pg_pool;
use crate::error::ApiError;
use crate::platform_control::{self, PlatformId};
use crate::session::{identity_json_for_reducer_call, normalize_identity_hex_for_sql};
use crate::state::AppState;
use crate::web_session::{require_org, resolve_session};

fn set_stdb_session_cookies(
    config: &crate::config::Config,
    cookies: &Cookies,
    token: &str,
    identity_hex: &str,
) {
    let id = normalize_identity_hex_for_sql(identity_hex);
    let max_age = Duration::seconds(60 * 60 * 24 * 30);
    let mut t = Cookie::build(("stdb_token", token.to_string()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(max_age)
        .build();
    t.set_secure(config.cookie_secure);
    cookies.add(t);
    let mut i = Cookie::build(("stdb_identity", id))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(max_age)
        .build();
    i.set_secure(config.cookie_secure);
    cookies.add(i);
}

fn clear_stdb_session_cookies(cookies: &Cookies) {
    cookies.remove(Cookie::new("stdb_token", ""));
    cookies.remove(Cookie::new("stdb_identity", ""));
}

#[derive(Debug, Deserialize)]
struct SignInBody {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileUpdateBody {
    name: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    timezone: Option<String>,
    language: Option<String>,
}

async fn profile_get(
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
        .map_err(|e| ApiError::Internal(e.to_string()))?
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

async fn profile_update(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    cookies: Cookies,
    Json(body): Json<ProfileUpdateBody>,
) -> Result<Json<Value>, ApiError> {
    let session = resolve_session(&state, &headers, &cookies)
        .await?
        .ok_or(ApiError::Unauthorized)?;
    require_org(&session)?;
    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })?;
    let profile = platform_control::find_user_profile_by_stdb_identity(pool, &session.identity_hex)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or(ApiError::NotFound("User profile not found".into()))?;
    let platform_id = profile.get::<_, String>("platform_user_id");
    let platform_id =
        PlatformId::new(platform_id).map_err(|e| ApiError::Internal(e.to_string()))?;
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
    .map_err(|e| ApiError::Internal(e.to_string()))?
    {
        return Err(ApiError::NotFound("User profile not found".into()));
    }
    Ok(Json(json!({ "success": true })))
}

async fn signin(
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

    let ok = bcrypt::verify(body.password.as_bytes(), ph)
        .map_err(|e| ApiError::Internal(e.to_string()))?;
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
struct SignUpBody {
    email: String,
    password: String,
}

async fn signup(
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
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let password_hash = bcrypt::hash(body.password, bcrypt::DEFAULT_COST)
        .map_err(|e| ApiError::Internal(e.to_string()))?;
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
    .map_err(|e| ApiError::Internal(e.to_string()))?;
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
    .map_err(|e| ApiError::Internal(e.to_string()))?;
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

async fn signout(State(state): State<Arc<AppState>>, cookies: Cookies) -> impl IntoResponse {
    clear_stdb_session_cookies(&cookies);
    let _ = state; // WorkOS: clear STDB cookies only; AuthKit session end stays client-side if needed.
    Json(json!({ "redirectTo": "/sign-in" }))
}

#[derive(Debug, Deserialize)]
struct ForgotBody {
    email: String,
}

async fn forgot_password(
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
        let platform_id = PlatformId::new(cred.platform_user_id.clone())
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        let pool = pg_pool::shared_pool().ok_or_else(|| {
            ApiError::Unavailable("platform authentication storage is unavailable".into())
        })?;
        platform_control::insert_password_reset_token(pool, &platform_id, &token_hash, expires_at)
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
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
                    identity_json_for_reducer_call(&cred.identity_hex),
                    expires_at_micros.to_string(),
                ]),
            ))
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;

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
struct ResetBody {
    token: String,
    #[serde(rename = "newPassword")]
    new_password: String,
}

async fn reset_password(
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

    let new_hash = bcrypt::hash(body.new_password, bcrypt::DEFAULT_COST)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let platform_id = PlatformId::new(reset_token.platform_user_id.clone())
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let pool = pg_pool::shared_pool().ok_or_else(|| {
        ApiError::Unavailable("platform authentication storage is unavailable".into())
    })?;
    if !platform_control::consume_password_reset_token(pool, &hash)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
    {
        return Err(ApiError::BadRequest("Invalid or expired reset link".into()));
    }
    if !platform_control::update_user_password(pool, &platform_id, &new_hash)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
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
                json!([platform_id.as_str()]),
            ))
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        let raw = decrypt_token(key, &cred.stdb_token_enc)?;
        let id_hex = normalize_identity_hex_for_sql(&cred.identity_hex);
        set_stdb_session_cookies(&state.config, &cookies, &raw, &id_hex);
    }

    Ok(Json(json!({ "redirectTo": "/overview" })))
}

#[derive(Debug, Deserialize)]
struct InviteBody {
    email: String,
    #[serde(rename = "roleId")]
    role_id: u64,
    #[serde(rename = "organizationId")]
    organization_id: u64,
}

async fn invite(
    State(state): State<Arc<AppState>>,
    cookies: Cookies,
    Json(body): Json<InviteBody>,
) -> Result<impl IntoResponse, ApiError> {
    let identity_hex = cookies
        .get("stdb_identity")
        .map(|c| c.value().to_string())
        .ok_or(ApiError::Unauthorized)?;

    let hex = identity_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    let admin = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|t| is_usable_admin_token(t))
        .ok_or_else(|| ApiError::Internal("STDB_SERVER_TOKEN is not configured".into()))?;
    let client = state.client_with_token(admin);

    let sql = format!(
        "SELECT role_id, organization_id, is_active FROM user_role_assignment WHERE identity = 0x{hex} AND organization_id = {} AND is_active = true",
        body.organization_id
    );
    let assignments = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
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
        "SELECT id, name FROM role WHERE organization_id = {}",
        body.organization_id
    );
    let all_roles = client
        .query_sql(&roles_sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
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

    client
        .call_reducer(stdb_client::reducer_call!(
            "create_user_invite",
            json!([
                body.organization_id,
                body.role_id,
                body.email.trim(),
                token_hash,
                identity_json_for_reducer_call(&identity_hex),
                expires_at.to_string()
            ]),
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let org_sql = format!(
        "SELECT name FROM organization WHERE id = {}",
        body.organization_id
    );
    let org_rows = client
        .query_sql(&org_sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let org_name: String = org_rows
        .first()
        .and_then(|r| r.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Lumiere ERP")
        .to_string();

    if let Some(ref api_key) = state.config.resend_api_key {
        let from = state.config.resend_from_email.clone();
        let app = state.config.app_url.clone();
        let to = body.email.trim().to_string();
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
struct AcceptInviteBody {
    token: String,
    email: String,
    password: String,
}

async fn accept_invite(
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
    if invite.expires_at < now_micros_i {
        return Err(ApiError::BadRequest("Invitation has expired".into()));
    }

    if invite.email.to_lowercase() != body.email.trim().to_lowercase() {
        return Err(ApiError::BadRequest(
            "Email does not match invitation".into(),
        ));
    }

    let admin = state
        .config
        .stdb_server_token
        .as_deref()
        .filter(|t| is_usable_admin_token(t))
        .ok_or_else(|| ApiError::Internal("STDB_SERVER_TOKEN is not configured".into()))?;
    let client = state.client_with_token(admin);

    let email = body.email.trim().to_lowercase();
    let role_name = get_role_name_in_organization(&state, invite.role_id, invite.organization_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Invite role not found".into()))?;
    let (member_identity, stdb_token, platform_user_id, new_credential) =
        if let Some(existing) = find_credential_by_email(&state, &email).await? {
            let tok = decrypt_token(key, &existing.stdb_token_enc)?;
            (
                existing.identity_hex.clone(),
                tok,
                PlatformId::new(existing.platform_user_id.clone())
                    .map_err(|e| ApiError::Internal(e.to_string()))?,
                None,
            )
        } else {
            let (identity, token) = state
                .stdb
                .provision_identity()
                .await
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let password_hash = bcrypt::hash(body.password.as_str(), bcrypt::DEFAULT_COST)
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let token_enc = encrypt_token(key, &token)?;
            (
                identity,
                token,
                PlatformId::generate(),
                Some((password_hash, token_enc)),
            )
        };

    // Establish the validated organization membership before materializing the
    // organization-owned credential/profile rows.
    client
        .call_reducer(stdb_client::reducer_call!(
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
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

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
        .map_err(|e| ApiError::Internal(e.to_string()))?;
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
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    }

    // The membership reducer derives organization ownership. Only after it
    // succeeds may this opaque platform binding be projected into ERP.
    client
        .call_reducer(stdb_client::reducer_call!(
            "bind_user_credential",
            json!([
                platform_user_id.as_str(),
                identity_json_for_reducer_call(&member_identity),
                email.clone(),
            ]),
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    client
        .call_reducer(stdb_client::reducer_call!(
            "bind_user_profile",
            json!([
                platform_user_id.as_str(),
                identity_json_for_reducer_call(&member_identity),
            ]),
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    client
        .call_reducer(stdb_client::reducer_call!(
            "mark_invite_accepted",
            json!([invite.id])
        ))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let id_hex = normalize_identity_hex_for_sql(&member_identity);
    set_stdb_session_cookies(&state.config, &cookies, &stdb_token, &id_hex);

    Ok(Json(json!({ "redirectTo": "/overview" })))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/signin", post(signin))
        .route("/auth/signup", post(signup))
        .route("/auth/profile", get(profile_get).patch(profile_update))
        .route("/auth/signout", post(signout))
        .route("/auth/forgot-password", post(forgot_password))
        .route("/auth/reset-password", post(reset_password))
        .route("/auth/invite", post(invite))
        .route("/auth/accept-invite", post(accept_invite))
}

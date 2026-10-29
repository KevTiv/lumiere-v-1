//! Provider-verified sessions. No browser receives a SpacetimeDB credential.
use super::{load_field_access_context, parse_stdb_identity_hex, ApiSession};
use crate::{
    auth_password::{decrypt_token, encrypt_token},
    cold_tier::pg_pool,
    error::ApiError,
    platform_control::{self, PlatformId},
    state::AppState,
};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Admission {
    pub user_id: String,
    pub email: String,
    pub organization_id: Option<u64>,
    pub workos_organization_id: Option<String>,
    #[serde(default)]
    pub allow_provision: bool,
    /// Explicit operator-approved migration target; never inferred from email.
    #[serde(default)]
    pub link_platform_user_id: Option<String>,
}

#[derive(Clone)]
pub struct WorkosAuthConfig {
    pub client_id: String,
    pub issuer: String,
    api_key: String,
    pub admissions: Vec<Admission>,
}
impl std::fmt::Debug for WorkosAuthConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkosAuthConfig")
            .field("client_id", &self.client_id)
            .finish_non_exhaustive()
    }
}
impl WorkosAuthConfig {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let client_id = std::env::var("WORKOS_CLIENT_ID").unwrap_or_default();
        let client_id = client_id.trim();
        if client_id.is_empty() {
            return Ok(None);
        }
        anyhow::ensure!(safe_id(client_id, "client_"), "invalid WORKOS_CLIENT_ID");
        let api_key = std::env::var("WORKOS_API_KEY")?;
        anyhow::ensure!(!api_key.trim().is_empty(), "WORKOS_API_KEY is required");
        let issuer = std::env::var("WORKOS_ISSUER")?;
        anyhow::ensure!(
            issuer == "https://api.workos.com/"
                || issuer == "https://api.workos.com"
                || issuer == format!("https://api.workos.com/user_management/{client_id}"),
            "WORKOS_ISSUER must identify the trusted WorkOS tenant"
        );
        let admissions: Vec<Admission> =
            serde_json::from_str(&std::env::var("LUMIERE_WORKOS_ALPHA_ADMISSIONS")?)?;
        validate_admissions(&admissions)?;
        Ok(Some(Self {
            client_id: client_id.into(),
            issuer,
            api_key,
            admissions,
        }))
    }
}
fn safe_id(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix)
        && value.len() > prefix.len()
        && value.len() <= 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
}
fn validate_admissions(entries: &[Admission]) -> anyhow::Result<()> {
    anyhow::ensure!(
        !entries.is_empty() && entries.len() <= 1000,
        "alpha admissions must contain 1..=1000 entries"
    );
    let mut users = std::collections::HashSet::new();
    let mut emails = std::collections::HashSet::new();
    for a in entries {
        anyhow::ensure!(
            safe_id(&a.user_id, "user_")
                && a.email == a.email.trim().to_lowercase()
                && a.email.contains('@')
                && !a.email.chars().any(char::is_whitespace),
            "invalid alpha identity/email"
        );
        anyhow::ensure!(
            users.insert(&a.user_id) && emails.insert(&a.email),
            "duplicate alpha identity/email"
        );
        anyhow::ensure!(a.organization_id != Some(0), "invalid alpha organization");
        if let Some(id) = &a.link_platform_user_id {
            anyhow::ensure!(
                a.allow_provision && platform_control::PlatformId::new(id.clone()).is_ok(),
                "identity linking requires explicit provisioning approval and a valid platform id"
            );
        }
        anyhow::ensure!(
            a.workos_organization_id
                .as_deref()
                .is_none_or(|id| safe_id(id, "org_")),
            "invalid WorkOS organization"
        );
    }
    Ok(())
}
#[derive(Clone, Debug, Deserialize)]
struct Claims {
    sub: String,
    sid: String,
    exp: u64,
    iat: u64,
    org_id: Option<String>,
}
#[derive(Deserialize)]
struct ProviderUser {
    id: String,
    email: String,
    email_verified: bool,
    first_name: Option<String>,
    last_name: Option<String>,
}
#[derive(Deserialize)]
struct ProviderSession {
    id: String,
    status: String,
    user_id: String,
    organization_id: Option<String>,
}
#[derive(Deserialize)]
struct SessionList {
    data: Vec<ProviderSession>,
}

fn verify_claims(
    token: &str,
    keys: &JwkSet,
    config: &WorkosAuthConfig,
    now: u64,
) -> Result<Claims, ApiError> {
    if token.len() > 16_384 {
        return Err(ApiError::Unauthorized);
    }
    let header = decode_header(token).map_err(|_| ApiError::Unauthorized)?;
    if header.alg != Algorithm::RS256 {
        return Err(ApiError::Unauthorized);
    }
    let kid = header
        .kid
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or(ApiError::Unauthorized)?;
    let key = keys.find(kid).ok_or(ApiError::Unauthorized)?;
    let key = DecodingKey::from_jwk(key).map_err(|_| ApiError::Unauthorized)?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_issuer(&[&config.issuer]);
    validation.set_required_spec_claims(&["exp", "iat", "iss", "sub"]);
    validation.leeway = 0;
    validation.validate_nbf = true;
    // WorkOS access JWTs do not promise an audience claim. If present it must
    // match this client; signature comes exclusively from this client's JWKS.
    validation.set_audience(&[&config.client_id]);
    let claims = decode::<Claims>(token, &key, &validation)
        .map_err(|_| ApiError::Unauthorized)?
        .claims;
    if !safe_id(&claims.sub, "user_")
        || !safe_id(&claims.sid, "session_")
        || claims.iat > now.saturating_add(30)
        || claims.exp <= now
        || claims.exp <= claims.iat
        || claims.exp.saturating_sub(claims.iat) > 3600
    {
        return Err(ApiError::Unauthorized);
    }
    Ok(claims)
}
fn admitted<'a>(
    config: &'a WorkosAuthConfig,
    claims: &Claims,
    user: &ProviderUser,
) -> Result<&'a Admission, ApiError> {
    if user.id != claims.sub || !user.email_verified {
        return Err(ApiError::Unauthorized);
    }
    config
        .admissions
        .iter()
        .find(|a| {
            a.user_id == user.id
                && a.email == user.email.trim().to_lowercase()
                && a.workos_organization_id == claims.org_id
        })
        .ok_or_else(|| ApiError::Forbidden("This identity is not approved for the alpha".into()))
}
async fn provider_get<T: serde::de::DeserializeOwned>(
    state: &AppState,
    config: &WorkosAuthConfig,
    url: String,
) -> Result<T, ApiError> {
    let response = state
        .http
        .get(url)
        .bearer_auth(&config.api_key)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|_| ApiError::Unavailable("Authentication provider unavailable".into()))?;
    if !response.status().is_success() {
        return Err(ApiError::Unauthorized);
    }
    response.json().await.map_err(|_| ApiError::Unauthorized)
}
pub struct VerifiedBinding {
    pub platform_user_id: PlatformId,
    /// Canonical, provider-verified and explicitly admitted email (not user input).
    pub email: String,
    pub identity_hex: String,
    pub stdb_token: String,
    pub organization_id: Option<u64>,
}

pub async fn verify_binding(
    state: &AppState,
    token: &str,
    allow_provision: bool,
) -> Result<VerifiedBinding, ApiError> {
    if token.len() > 16_384 {
        return Err(ApiError::Unauthorized);
    }
    let _permit = state.workos_auth_gate.try_acquire().map_err(|_| {
        ApiError::Unavailable("Authentication capacity reached; retry shortly".into())
    })?;
    let config = state
        .config
        .workos_auth
        .as_ref()
        .ok_or(ApiError::Unauthorized)?;
    // Reject master credentials before making provider requests.
    if state.config.stdb_server_token.as_deref() == Some(token)
        || state.config.stdb_finalization_token.as_deref() == Some(token)
    {
        return Err(ApiError::Unauthorized);
    }
    let header = decode_header(token).map_err(|_| ApiError::Unauthorized)?;
    if header.alg != Algorithm::RS256 || header.kid.is_none() {
        return Err(ApiError::Unauthorized);
    }
    let cached = state
        .workos_jwks
        .read()
        .await
        .as_ref()
        .filter(|(at, _)| at.elapsed() < Duration::from_secs(300))
        .map(|(_, keys)| keys.clone());
    let keys = if let Some(keys) = cached {
        keys
    } else {
        let keys: JwkSet = state
            .http
            .get(format!(
                "https://api.workos.com/sso/jwks/{}",
                config.client_id
            ))
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|_| ApiError::Unavailable("Authentication provider unavailable".into()))?
            .error_for_status()
            .map_err(|_| ApiError::Unauthorized)?
            .json()
            .await
            .map_err(|_| ApiError::Unauthorized)?;
        *state.workos_jwks.write().await = Some((std::time::Instant::now(), keys.clone()));
        keys
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(ApiError::internal)?
        .as_secs();
    let claims = verify_claims(token, &keys, config, now)?;
    let user: ProviderUser = provider_get(
        state,
        config,
        format!(
            "https://api.workos.com/user_management/users/{}",
            claims.sub
        ),
    )
    .await?;
    let admission = admitted(config, &claims, &user)?;
    // Live provider lookup makes logout/revocation effective without waiting for
    // JWT expiration or relying on an eventually delivered webhook.
    let sessions: SessionList = provider_get(
        state,
        config,
        format!(
            "https://api.workos.com/user_management/users/{}/sessions?limit=100",
            claims.sub
        ),
    )
    .await?;
    if !sessions.data.iter().any(|s| {
        s.id == claims.sid
            && s.status == "active"
            && s.user_id == claims.sub
            && s.organization_id == claims.org_id
    }) {
        return Err(ApiError::Unauthorized);
    }
    let pool = pg_pool::shared_pool()
        .ok_or_else(|| ApiError::Unavailable("Authentication storage unavailable".into()))?;
    let key = state
        .config
        .stdb_credential_encryption_key
        .as_ref()
        .ok_or(ApiError::Unauthorized)?;
    let row = platform_control::find_user_credential_by_workos_user_id(pool, &claims.sub)
        .await
        .map_err(ApiError::internal)?;
    let (platform_user_id, identity_hex, stdb_token) = if let Some(row) = row {
        if row.get::<_, Option<String>>("workos_user_id").as_deref() != Some(claims.sub.as_str()) {
            return Err(ApiError::Unauthorized);
        }
        if row.get::<_, String>("email").to_lowercase() != admission.email {
            // A verified address update for the same immutable subject is accepted
            // only after the operator has changed the exact alpha admission pin.
            let id = PlatformId::new(row.get::<_, String>("platform_user_id"))
                .map_err(ApiError::internal)?;
            let identity =
                stdb_auth::identity_sql_literal(&row.get::<_, String>("stdb_identity_hex"))
                    .map_err(ApiError::Internal)?;
            let memberships = state.stdb.query_sql(&format!("SELECT organization_id FROM user_organization WHERE user_identity = {identity} AND is_active = true"))
                .await.map_err(ApiError::internal)?;
            let organizations: Vec<i64> = memberships
                .iter()
                .filter_map(|r| r.get("organizationId").or_else(|| r.get("organization_id")))
                .filter_map(|v| v.as_i64().or_else(|| v.as_str()?.parse().ok()))
                .filter(|id| *id > 0)
                .collect();
            if !platform_control::sync_workos_email(
                pool,
                &id,
                &claims.sub,
                &admission.email,
                &organizations,
            )
            .await
            .map_err(|_| {
                ApiError::Conflict(
                    "Verified email change conflicts with an existing account".into(),
                )
            })? {
                return Err(ApiError::Unauthorized);
            }
        }
        (
            PlatformId::new(row.get::<_, String>("platform_user_id"))
                .map_err(ApiError::internal)?,
            row.get::<_, String>("stdb_identity_hex"),
            decrypt_token(key, &row.get::<_, String>("stdb_token_enc"))?,
        )
    } else {
        if !allow_provision || !admission.allow_provision {
            return Err(ApiError::Forbidden(
                "Identity provisioning requires operator approval".into(),
            ));
        }
        if let Some(existing) =
            platform_control::find_user_credential_by_email(pool, &admission.email)
                .await
                .map_err(ApiError::internal)?
        {
            let target = existing.get::<_, String>("platform_user_id");
            if admission.link_platform_user_id.as_deref() != Some(target.as_str()) {
                return Err(ApiError::Conflict(
                    "Existing account requires explicit identity linking".into(),
                ));
            }
            let id = PlatformId::new(target).map_err(ApiError::internal)?;
            let profile = platform_control::find_user_profile_by_platform_id(pool, &id)
                .await
                .map_err(ApiError::internal)?
                .ok_or(ApiError::Unauthorized)?;
            if !platform_control::profile_is_active(&profile) {
                return Err(ApiError::Unauthorized);
            }
            if !platform_control::attach_workos_subject(pool, &id, &claims.sub, true)
                .await
                .map_err(ApiError::internal)?
            {
                return Err(ApiError::Conflict(
                    "Account is linked to another provider identity".into(),
                ));
            }
        } else {
            if admission.link_platform_user_id.is_some() {
                return Err(ApiError::Conflict(
                    "Approved account linking target was not found".into(),
                ));
            }
            let (identity, token) = state
                .stdb
                .provision_identity()
                .await
                .map_err(ApiError::internal)?;
            let identity = parse_stdb_identity_hex(&identity).ok_or(ApiError::Unauthorized)?;
            platform_control::insert_workos_identity(
                pool,
                &platform_control::UserCredential {
                    platform_user_id: PlatformId::generate(),
                    email: admission.email.clone(),
                    stdb_identity_hex: identity,
                    password_hash: None,
                    workos_user_id: Some(claims.sub.clone()),
                    stdb_token_enc: encrypt_token(key, &token)?,
                    email_verified: true,
                },
                user.first_name.as_deref(),
                user.last_name.as_deref(),
            )
            .await
            .map_err(ApiError::internal)?;
        }
        // Unique subject constraints choose the winner of simultaneous callbacks.
        // Always read that canonical binding, including after an insert conflict.
        let row = platform_control::find_user_credential_by_workos_user_id(pool, &claims.sub)
            .await
            .map_err(ApiError::internal)?
            .ok_or_else(|| {
                ApiError::Conflict("Identity provisioning conflicted; retry sign-in".into())
            })?;
        if row.get::<_, String>("email") != admission.email {
            return Err(ApiError::Unauthorized);
        }
        (
            PlatformId::new(row.get::<_, String>("platform_user_id"))
                .map_err(ApiError::internal)?,
            row.get::<_, String>("stdb_identity_hex"),
            decrypt_token(key, &row.get::<_, String>("stdb_token_enc"))?,
        )
    };
    let profile = platform_control::find_user_profile_by_platform_id(pool, &platform_user_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    if !platform_control::profile_is_active(&profile)
        || profile.get::<_, String>("stdb_identity_hex") != identity_hex
    {
        return Err(ApiError::Unauthorized);
    }
    if state.config.stdb_server_token.as_deref() == Some(stdb_token.as_str())
        || state.config.stdb_finalization_token.as_deref() == Some(stdb_token.as_str())
    {
        return Err(ApiError::Unauthorized);
    }
    let actual_identity = state
        .client_with_token(&stdb_token)
        .authenticated_identity()
        .await
        .map_err(|_| ApiError::Unauthorized)?;
    let identity_hex = parse_stdb_identity_hex(&identity_hex).ok_or(ApiError::Unauthorized)?;
    if parse_stdb_identity_hex(&actual_identity).as_deref() != Some(identity_hex.as_str()) {
        return Err(ApiError::Unauthorized);
    }
    if allow_provision {
        if let Some(org) = admission
            .organization_id
            .and_then(|org| i64::try_from(org).ok())
        {
            pool.get().await.map_err(ApiError::internal)?.execute(
                "INSERT INTO lumiere_platform.profile_projection_pending (platform_user_id,organization_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                &[&platform_user_id.as_str(), &org],
            ).await.map_err(ApiError::internal)?;
        }
    }
    Ok(VerifiedBinding {
        platform_user_id,
        email: admission.email.clone(),
        identity_hex,
        stdb_token,
        organization_id: admission.organization_id,
    })
}

pub async fn resolve_session(
    state: &AppState,
    authorization: Option<&str>,
    cookie: Option<&str>,
) -> Result<Option<ApiSession>, ApiError> {
    let token = match authorization {
        Some(value) => Some(
            value
                .strip_prefix("Bearer ")
                .filter(|s| !s.is_empty())
                .ok_or(ApiError::Unauthorized)?,
        ),
        None => cookie.filter(|s| !s.is_empty()),
    };
    let Some(token) = token else { return Ok(None) };
    let binding = verify_binding(state, token, false).await?;
    let sql = stdb_auth::select_user_organization_for_identity_sql(&binding.identity_hex, None)
        .map_err(ApiError::Internal)?;
    let rows = state
        .stdb
        .query_sql(&sql)
        .await
        .map_err(ApiError::internal)?;
    let org_id = |row: &serde_json::Value| {
        row.get("organizationId")
            .and_then(|v| v.as_u64().or_else(|| v.as_str()?.parse().ok()))
    };
    let Some(member) = rows.iter().find(|row| {
        binding
            .organization_id
            .is_none_or(|id| org_id(row) == Some(id))
    }) else {
        if may_bootstrap_without_membership(binding.organization_id, rows.is_empty()) {
            // This conveys authenticated identity only. Bootstrap still requires
            // the reducer's operator-owned founder approval and rejects identities
            // with historical membership. Every ERP operation requires an org.
            return Ok(Some(ApiSession {
                stdb_token: binding.stdb_token,
                identity_hex: binding.identity_hex,
                organization_id: None,
                field_access: None,
            }));
        }
        return Err(ApiError::Forbidden(
            "An active organization membership is required".into(),
        ));
    };
    let organization_id = org_id(member).ok_or(ApiError::Unauthorized)?;
    // This projection copies display fields only. A temporarily unavailable
    // projection must not turn a saved language preference into a login outage.
    // Canonical identity/admission was verified above; authorization is still
    // resolved independently from the active ERP profile, membership and roles.
    let projection_result = crate::routes::auth::profile::flush_profile_projection(
        state,
        &binding.platform_user_id,
        &binding.identity_hex,
        organization_id,
    )
    .await;
    let field_access_result =
        load_field_access_context(&state.stdb, &binding.identity_hex, organization_id).await;
    complete_verified_session(
        binding,
        organization_id,
        projection_result,
        field_access_result,
    )
    .map(Some)
}

fn complete_verified_session(
    binding: VerifiedBinding,
    organization_id: u64,
    projection_result: Result<(), ApiError>,
    field_access_result: Result<Option<stdb_auth::FieldAccessContext>, String>,
) -> Result<ApiSession, ApiError> {
    if let Err(error) = projection_result {
        // flush_profile_projection leaves its durable outbox row intact on
        // failure. Log the cause, which would otherwise be a silent 4xx retry.
        tracing::warn!(
            organization_id,
            error = ?error,
            "profile display projection deferred; retaining pending synchronization"
        );
    }
    let field_access = field_access_result
        .map_err(ApiError::Internal)?
        .ok_or(ApiError::Unauthorized)?;
    if field_access.organization_id != organization_id
        || field_access.identity_hex != binding.identity_hex
    {
        return Err(ApiError::Unauthorized);
    }
    Ok(ApiSession {
        stdb_token: binding.stdb_token,
        identity_hex: binding.identity_hex,
        organization_id: Some(organization_id),
        field_access: Some(field_access),
    })
}

fn may_bootstrap_without_membership(
    approved_org: Option<u64>,
    no_active_memberships: bool,
) -> bool {
    approved_org.is_none() && no_active_memberships
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use jsonwebtoken::{encode, EncodingKey, Header};
    use rsa::{pkcs8::EncodePrivateKey, traits::PublicKeyParts, RsaPrivateKey};
    use serde_json::json;

    fn verified_profile_session() -> (VerifiedBinding, stdb_auth::FieldAccessContext) {
        let identity = "ab".repeat(32);
        (
            VerifiedBinding {
                platform_user_id: PlatformId::new("usr_profile_language_test").unwrap(),
                email: "verified@example.test".into(),
                identity_hex: identity.clone(),
                stdb_token: "verified-actor-token".into(),
                organization_id: Some(1),
            },
            stdb_auth::FieldAccessContext {
                organization_id: 1,
                role_id: 7,
                role_name: "Bookkeeper".into(),
                is_superuser: false,
                role_permissions: vec!["accounting:read".into()],
                identity_hex: identity,
                field_permissions: vec![],
                role_ids: vec![7],
                org_permissions: vec![],
            },
        )
    }

    #[test]
    fn pending_language_projection_does_not_block_verified_workos_session() {
        for projection in [
            Ok(()),
            Err(ApiError::Unavailable("profile storage unavailable".into())),
            Err(ApiError::Unprocessable(
                "profile projection rejected".into(),
            )),
        ] {
            let (binding, access) = verified_profile_session();
            let session = complete_verified_session(binding, 1, projection, Ok(Some(access)))
                .expect("display synchronization is independent of authentication");
            assert_eq!(session.identity_hex, "ab".repeat(32));
            assert_eq!(session.stdb_token, "verified-actor-token");
            assert_eq!(session.organization_id, Some(1));
            let access = session.field_access.expect("verified authorization");
            assert!(!access.is_superuser);
            assert_eq!(access.role_ids, vec![7]);
            assert_eq!(access.role_permissions, vec!["accounting:read"]);
        }
    }

    #[test]
    fn deferred_profile_projection_cannot_bypass_unavailable_or_denied_authorization() {
        for access in [Ok(None), Err("authorization query unavailable".into())] {
            let (binding, _) = verified_profile_session();
            assert!(complete_verified_session(
                binding,
                1,
                Err(ApiError::Unprocessable(
                    "profile projection rejected".into()
                )),
                access,
            )
            .is_err());
        }
    }

    #[test]
    fn deferred_profile_projection_cannot_rebind_identity_or_organization() {
        for wrong_identity in [false, true] {
            let (binding, mut access) = verified_profile_session();
            if wrong_identity {
                access.identity_hex = "cd".repeat(32);
            } else {
                access.organization_id = 2;
            }
            assert!(matches!(
                complete_verified_session(
                    binding,
                    1,
                    Err(ApiError::Unprocessable(
                        "profile projection rejected".into()
                    )),
                    Ok(Some(access)),
                ),
                Err(ApiError::Unauthorized)
            ));
        }
    }

    fn test_signing_key() -> &'static (EncodingKey, JwkSet) {
        static KEY: std::sync::OnceLock<(EncodingKey, JwkSet)> = std::sync::OnceLock::new();
        KEY.get_or_init(|| {
            let key = RsaPrivateKey::new(&mut rand::thread_rng(), 2048)
                .expect("generate ephemeral test key");
            let pem = key
                .to_pkcs8_pem(rsa::pkcs8::LineEnding::LF)
                .expect("encode test key");
            let jwks = serde_json::from_value(json!({"keys":[{
                "kty":"RSA", "kid":"test-key", "alg":"RS256", "use":"sig",
                "n":URL_SAFE_NO_PAD.encode(key.n().to_bytes_be()),
                "e":URL_SAFE_NO_PAD.encode(key.e().to_bytes_be()),
            }]}))
            .expect("ephemeral test JWKS");
            (
                EncodingKey::from_rsa_pem(pem.as_bytes()).expect("test encoding key"),
                jwks,
            )
        })
    }
    fn config() -> WorkosAuthConfig {
        WorkosAuthConfig {
            client_id: "client_test".into(),
            issuer: "https://api.workos.com".into(),
            api_key: "test".into(),
            admissions: vec![Admission {
                user_id: "user_allowed".into(),
                email: "approved@example.test".into(),
                organization_id: Some(1),
                workos_organization_id: Some("org_allowed".into()),
                allow_provision: false,
                link_platform_user_id: None,
            }],
        }
    }
    fn claims() -> serde_json::Value {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        json!({"iss":"https://api.workos.com", "sub":"user_allowed", "sid":"session_allowed", "iat":now, "exp":now+300, "org_id":"org_allowed"})
    }
    fn token(claims: &serde_json::Value, kid: &str) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(kid.into());
        encode(&header, claims, &test_signing_key().0).unwrap()
    }
    #[test]
    fn only_trusted_current_rsa_tokens_are_accepted() {
        let config = config();
        let keys = test_signing_key().1.clone();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        assert!(verify_claims(&token(&claims(), "test-key"), &keys, &config, now).is_ok());
        for (name, value) in [
            ("iss", json!("https://attacker.test")),
            ("exp", json!(now - 1)),
            ("sub", json!("")),
            ("sid", json!("")),
            ("iat", json!(now + 600)),
            ("nbf", json!(now + 600)),
            ("aud", json!("client_other")),
        ] {
            let mut c = claims();
            c[name] = value;
            assert!(
                verify_claims(&token(&c, "test-key"), &keys, &config, now).is_err(),
                "{name}"
            );
        }
        assert!(verify_claims(&token(&claims(), "unknown-key"), &keys, &config, now).is_err());
        let hs = encode(
            &Header::default(),
            &claims(),
            &EncodingKey::from_secret(b"test"),
        )
        .unwrap();
        assert!(verify_claims(&hs, &keys, &config, now).is_err());
        let mut long = claims();
        long["exp"] = json!(now + 3601);
        assert!(verify_claims(&token(&long, "test-key"), &keys, &config, now).is_err());
    }
    #[test]
    fn admission_requires_exact_verified_subject_email_and_organization() {
        let config = config();
        let c: Claims = serde_json::from_value(claims()).unwrap();
        let mut user = ProviderUser {
            first_name: None,
            last_name: None,
            id: "user_allowed".into(),
            email: "approved@example.test".into(),
            email_verified: true,
        };
        assert!(admitted(&config, &c, &user).is_ok());
        user.email_verified = false;
        assert!(admitted(&config, &c, &user).is_err());
        user.email_verified = true;
        user.email = "other@example.test".into();
        assert!(admitted(&config, &c, &user).is_err());
        user.email = "approved@example.test".into();
        user.id = "user_other".into();
        assert!(admitted(&config, &c, &user).is_err());
        user.id = "user_allowed".into();
        let mut other = c.clone();
        other.org_id = Some("org_other".into());
        assert!(admitted(&config, &other, &user).is_err());
        other.org_id = None;
        assert!(admitted(&config, &other, &user).is_err());
    }
    #[test]
    fn only_unscoped_approved_founders_can_reach_bootstrap_without_membership() {
        assert!(may_bootstrap_without_membership(None, true));
        assert!(!may_bootstrap_without_membership(Some(1), true));
        assert!(!may_bootstrap_without_membership(None, false));
    }
    #[test]
    fn malformed_or_ambiguous_admission_configuration_fails_closed() {
        assert!(validate_admissions(&[]).is_err());
        let config = config();
        assert!(validate_admissions(&config.admissions).is_ok());
        assert!(
            validate_admissions(&[config.admissions[0].clone(), config.admissions[0].clone()])
                .is_err()
        );
    }
    #[tokio::test]
    async fn configured_workos_authority_disables_native_password_signin() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;

        let mut config = super::super::test_support::test_config(Some("master-token"));
        config.workos_auth = Some(self::config());
        let app = crate::routes::auth::router()
            .with_state(std::sync::Arc::new(AppState::new(config)))
            .layer(tower_cookies::CookieManagerLayer::new());
        let response = app
            .oneshot(
                Request::post("/auth/signin")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"email":"approved@example.test","password":"native-password"}"#,
                    ))
                    .expect("valid request"),
            )
            .await
            .expect("route response");
        assert_eq!(response.status(), axum::http::StatusCode::GONE);
    }

    #[tokio::test]
    async fn workos_mode_rejects_native_bearer_and_cookie_without_mock_fallback() {
        let mut config = super::super::test_support::test_config(Some("master-token"));
        config.dev_mock_org_id = Some(1);
        config.workos_auth = Some(self::config());
        let state = AppState::new(config);
        for (auth, cookie) in [
            (Some("Bearer master-token"), None),
            (Some("Bearer legacy-stdb-token"), None),
            (None, Some("legacy-stdb-token")),
            (Some("Basic bad"), Some("legacy-stdb-token")),
        ] {
            assert!(
                super::super::resolve_api_session(&state, auth, cookie, None)
                    .await
                    .is_err()
            );
        }
        assert!(super::super::resolve_api_session(&state, None, None, None)
            .await
            .unwrap()
            .is_none());
    }
}

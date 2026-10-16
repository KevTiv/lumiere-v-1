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
    pub fn from_env(client_id: Option<&str>) -> anyhow::Result<Option<Self>> {
        let Some(client_id) = client_id else {
            return Ok(None);
        };
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
        if row.get::<_, String>("email").to_lowercase() != admission.email
            || row.get::<_, Option<String>>("workos_user_id").as_deref()
                != Some(claims.sub.as_str())
        {
            return Err(ApiError::Unauthorized);
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
        if platform_control::find_user_credential_by_email(pool, &admission.email)
            .await
            .map_err(ApiError::internal)?
            .is_some()
        {
            return Err(ApiError::Conflict(
                "Existing account requires explicit identity linking".into(),
            ));
        }
        let (identity, token) = state
            .stdb
            .provision_identity()
            .await
            .map_err(ApiError::internal)?;
        let identity = parse_stdb_identity_hex(&identity).ok_or(ApiError::Unauthorized)?;
        let id = PlatformId::generate();
        platform_control::insert_workos_identity(
            pool,
            &platform_control::UserCredential {
                platform_user_id: id.clone(),
                email: admission.email.clone(),
                stdb_identity_hex: identity.clone(),
                password_hash: None,
                workos_user_id: Some(claims.sub.clone()),
                stdb_token_enc: encrypt_token(key, &token)?,
                email_verified: true,
            },
        )
        .await
        .map_err(ApiError::internal)?;
        (id, identity, token)
    };
    let profile = platform_control::find_user_profile_by_platform_id(pool, &platform_user_id)
        .await
        .map_err(ApiError::internal)?
        .ok_or(ApiError::Unauthorized)?;
    if !profile.get::<_, bool>("is_active")
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
    Ok(VerifiedBinding {
        platform_user_id,
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
    let field_access =
        load_field_access_context(&state.stdb, &binding.identity_hex, organization_id)
            .await
            .map_err(ApiError::Internal)?
            .ok_or(ApiError::Unauthorized)?;
    Ok(Some(ApiSession {
        stdb_token: binding.stdb_token,
        identity_hex: binding.identity_hex,
        organization_id: Some(organization_id),
        field_access: Some(field_access),
    }))
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
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde_json::json;
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
        encode(
            &header,
            claims,
            &EncodingKey::from_rsa_pem(include_bytes!("fixtures/workos-test-private.pem")).unwrap(),
        )
        .unwrap()
    }
    #[test]
    fn only_trusted_current_rsa_tokens_are_accepted() {
        let config = config();
        let keys = serde_json::from_str(include_str!("fixtures/workos-test-jwks.json")).unwrap();
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
    async fn workos_mode_rejects_native_bearer_and_cookie_without_mock_fallback() {
        let mut config = super::super::test_support::test_config(Some("master-token"));
        config.dev_mock_org_id = Some(1);
        config.workos_client_id = Some("client_test".into());
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

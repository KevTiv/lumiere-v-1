//! Exchanges an approved GitHub release job's identity for company-scoped test sessions.

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, OnceLock},
    time::Duration,
};

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{
        header::{AUTHORIZATION, CACHE_CONTROL},
        HeaderMap, HeaderValue, StatusCode,
    },
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use chrono::{DateTime, Utc};
use jsonwebtoken::{
    decode, decode_header, encode, jwk::JwkSet, Algorithm, DecodingKey, EncodingKey, Header,
    Validation,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;

use crate::{
    acceptance_registry::AcceptanceRegistry, error::ApiError, session::workos, state::AppState,
};

const ISSUER: &str = "https://token.actions.githubusercontent.com";
const AUDIENCE: &str = "lumiere-grounded-chat-acceptance";
const ACTIVATION_ISSUER: &str = "lumiere-acceptance-cutover-v1";
const MAIN_REF: &str = "refs/heads/main";
const MAX_ACTORS: usize = 16;
const SCENARIOS: &[&str] = &[
    "fresh",
    "upgraded",
    "journal",
    "namedRecord",
    "followUp",
    "emptyCompany",
    "summaryHandoff",
    "revoked",
    "importContinuation",
];
static EXCHANGE_SLOTS: Semaphore = Semaphore::const_new(2);
static HTTP: OnceLock<reqwest::Client> = OnceLock::new();

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BrokerConfig {
    repository: String,
    repository_id: String,
    environment: String,
    organization_id: u64,
    actors: Vec<TestActor>,
    fresh_actor: TestCredentials,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TestActor {
    company_id: u64,
    user_id: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TestCredentials {
    user_id: String,
    password: String,
}

impl BrokerConfig {
    fn credentials(
        &self,
        company: u64,
        fresh_company: Option<u64>,
    ) -> Result<(&str, &str), ApiError> {
        if fresh_company == Some(company) {
            return Ok((&self.fresh_actor.user_id, &self.fresh_actor.password));
        }
        self.actors
            .iter()
            .find(|actor| actor.company_id == company)
            .map(|actor| (actor.user_id.as_str(), actor.password.as_str()))
            .ok_or_else(|| {
                ApiError::Unavailable("Dedicated acceptance actor is not configured".into())
            })
    }
}

#[derive(Deserialize)]
struct JobClaims {
    repository: String,
    repository_id: String,
    environment: String,
    #[serde(rename = "ref")]
    git_ref: String,
    workflow_ref: String,
    job_workflow_ref: Option<String>,
    event_name: String,
    iat: u64,
    exp: u64,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Stage {
    Preflight,
    Verify,
    Nightly,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExchangeRequest {
    stage: Stage,
    release_sha: Option<String>,
}

struct ServedBuild<'a> {
    sha: &'a str,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ActivationProof {
    iss: String,
    aud: String,
    release_sha: String,
    organization_id: u64,
    environment: String,
    observed_at_micros: i64,
}

fn proof_key(name: &str) -> Result<String, ApiError> {
    std::env::var(name)
        .map_err(|_| ApiError::Unavailable("Acceptance cutover key is not configured".into()))
}

fn sign_activation(
    config: &BrokerConfig,
    sha: &str,
    key: &[u8],
    now: i64,
) -> Result<String, ApiError> {
    let proof = ActivationProof {
        iss: ACTIVATION_ISSUER.into(),
        aud: AUDIENCE.into(),
        release_sha: sha.into(),
        organization_id: config.organization_id,
        environment: config.environment.clone(),
        observed_at_micros: now,
    };
    encode(
        &Header::new(Algorithm::EdDSA),
        &proof,
        &EncodingKey::from_ed_pem(key).map_err(|_| {
            ApiError::Unavailable("Acceptance cutover signing key is invalid".into())
        })?,
    )
    .map_err(ApiError::internal)
}

fn verify_activation(
    raw: &str,
    config: &BrokerConfig,
    build: &ServedBuild<'_>,
    key: &[u8],
    now: i64,
) -> Result<i64, ApiError> {
    let invalid =
        || ApiError::Conflict("Acceptance cutover receipt is invalid for this release".into());
    if raw.len() > 2048 {
        return Err(invalid());
    }
    let mut validation = Validation::new(Algorithm::EdDSA);
    validation.set_issuer(&[ACTIVATION_ISSUER]);
    validation.set_audience(&[AUDIENCE]);
    validation.set_required_spec_claims(&["iss", "aud"]);
    // This is a historical receipt, not an authentication token.
    validation.validate_exp = false;
    let verifier = DecodingKey::from_ed_pem(key).map_err(|_| {
        ApiError::Unavailable("Acceptance cutover verification key is invalid".into())
    })?;
    let proof = decode::<ActivationProof>(raw, &verifier, &validation)
        .map_err(|_| invalid())?
        .claims;
    if proof.release_sha != build.sha
        || proof.organization_id != config.organization_id
        || proof.environment != config.environment
        || !(1..=now).contains(&proof.observed_at_micros)
    {
        return Err(invalid());
    }
    Ok(proof.observed_at_micros)
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/ai/acceptance/session", post(exchange))
        .layer(DefaultBodyLimit::max(1024))
}

fn config() -> Result<BrokerConfig, ApiError> {
    let raw = std::env::var("AI_CHAT_ACCEPTANCE_BROKER_CONFIG")
        .map_err(|_| ApiError::NotFound("Acceptance broker is disabled".into()))?;
    let invalid = || ApiError::Unavailable("Acceptance broker configuration is invalid".into());
    let config: BrokerConfig = serde_json::from_str(&raw).map_err(|_| invalid())?;
    let companies = config
        .actors
        .iter()
        .map(|a| a.company_id)
        .collect::<BTreeSet<_>>();
    let users = config
        .actors
        .iter()
        .map(|a| a.user_id.as_str())
        .chain([config.fresh_actor.user_id.as_str()])
        .collect::<BTreeSet<_>>();
    if config.organization_id == 0
        || !matches!(config.environment.as_str(), "production" | "dev")
        || config.repository.split('/').count() != 2
        || config
            .repository_id
            .parse::<u64>()
            .ok()
            .filter(|id| *id > 0)
            .is_none()
        || companies.contains(&0)
        || config.actors.is_empty()
        || config.actors.len() >= MAX_ACTORS
        || companies.len() != config.actors.len()
        || users.len() != config.actors.len() + 1
        || !users
            .iter()
            .all(|user| user.starts_with("user_") && user.len() <= 128)
        || config
            .actors
            .iter()
            .map(|a| a.password.as_str())
            .chain([config.fresh_actor.password.as_str()])
            .any(|password| password.is_empty() || password.len() > 1024)
    {
        return Err(invalid());
    }
    Ok(config)
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or(ApiError::Unauthorized)
}

fn valid_sha(raw: &str) -> bool {
    raw.len() == 40
        && raw
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn served_build(headers: &HeaderMap) -> Result<ServedBuild<'_>, ApiError> {
    let secret = std::env::var("LUMIERE_AI_GATEWAY_INTERNAL_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ApiError::Unavailable("Acceptance web attestation is disabled".into()))?;
    let provided = header(headers, "x-lumiere-gateway-secret")?;
    let different = Sha256::digest(secret)
        .iter()
        .zip(Sha256::digest(provided))
        .fold(0, |acc, (a, b)| acc | (a ^ b));
    if different != 0 {
        return Err(ApiError::Unauthorized);
    }

    let sha = header(headers, "x-lumiere-acceptance-release")?;
    let built_at = header(headers, "x-lumiere-acceptance-built-at")?
        .parse::<DateTime<Utc>>()
        .map_err(|_| ApiError::BadRequest("Invalid acceptance web build stamp".into()))?;
    if !valid_sha(sha) || built_at > Utc::now() {
        return Err(ApiError::BadRequest(
            "Invalid acceptance web build stamp".into(),
        ));
    }
    Ok(ServedBuild { sha })
}

/// Read authority minted only by the signed GitHub job verification below.
pub(crate) struct VerifiedAcceptanceJob<'a> {
    organization_id: u64,
    environment: &'a str,
    fixture_release: &'a str,
}

impl VerifiedAcceptanceJob<'_> {
    pub(crate) fn registry_scope(&self) -> (u64, &str, &str) {
        (self.organization_id, self.environment, self.fixture_release)
    }
}

fn verify_job<'a>(
    token: &str,
    keys: &JwkSet,
    config: &'a BrokerConfig,
    stage: Stage,
    served_release: &'a str,
) -> Result<VerifiedAcceptanceJob<'a>, ApiError> {
    let header = decode_header(token).map_err(|_| ApiError::Unauthorized)?;
    let key = header
        .kid
        .as_deref()
        .and_then(|kid| keys.find(kid))
        .ok_or(ApiError::Unauthorized)?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[AUDIENCE]);
    validation.set_issuer(&[ISSUER]);
    validation.set_required_spec_claims(&["aud", "iss", "sub", "exp", "nbf"]);
    validation.leeway = 0;
    validation.validate_nbf = true;
    let claims = decode::<JobClaims>(
        token,
        &DecodingKey::from_jwk(key).map_err(|_| ApiError::Unauthorized)?,
        &validation,
    )
    .map_err(|_| ApiError::Unauthorized)?
    .claims;
    let now = Utc::now().timestamp() as u64;
    if claims.iat > now.saturating_add(5)
        || claims.exp <= claims.iat
        || claims.exp - claims.iat > 600
        || !authorized_job(&claims, config, stage)
    {
        return Err(ApiError::Unauthorized);
    }
    Ok(VerifiedAcceptanceJob {
        organization_id: config.organization_id,
        environment: &config.environment,
        fixture_release: if stage == Stage::Preflight {
            ""
        } else {
            served_release
        },
    })
}

fn authorized_job(claims: &JobClaims, config: &BrokerConfig, stage: Stage) -> bool {
    if !claims.repository.eq_ignore_ascii_case(&config.repository)
        || claims.repository_id != config.repository_id
        || claims.environment != config.environment
        || claims.git_ref != MAIN_REF
    {
        return false;
    }
    let workflow = |name: &str| {
        format!(
            "{}/.github/workflows/{name}.yml@{MAIN_REF}",
            claims.repository
        )
    };
    let caller = claims.workflow_ref.as_str();
    let job = claims.job_workflow_ref.as_deref().unwrap_or(caller);
    let manual = claims.event_name == "workflow_dispatch";
    if stage == Stage::Nightly {
        return caller == workflow("grounded-chat-nightly")
            && caller == job
            && (manual || claims.event_name == "schedule");
    }
    (manual
        && caller == job
        && (caller == workflow("release-railway-stack")
            || caller == workflow("release-railway-web")))
        || (caller == workflow("release-main")
            && job == workflow("release-railway-stack")
            && (manual || matches!(claims.event_name.as_str(), "push" | "workflow_run")))
}

fn company_ids(fixtures: &Value) -> Result<BTreeSet<u64>, ApiError> {
    let languages = fixtures.get("nonEnglish").and_then(Value::as_object);
    SCENARIOS
        .iter()
        .filter_map(|name| fixtures.get(*name))
        .chain(languages.into_iter().flat_map(serde_json::Map::values))
        .map(|fixture| {
            fixture["companyId"]
                .as_u64()
                .filter(|id| *id > 0 && *id <= 9_007_199_254_740_991)
                .ok_or_else(|| {
                    ApiError::Unavailable("Acceptance registry has an invalid company".into())
                })
        })
        .collect()
}

fn fresh_scope(fixtures: &Value, sha: &str) -> Result<(u64, u64), ApiError> {
    let fresh = &fixtures["fresh"];
    let company = fresh["companyId"].as_u64().filter(|id| *id > 0);
    let document = fresh["documentId"].as_u64().filter(|id| *id > 0);
    if fixtures["upgraded"]["companyId"]
        .as_u64()
        .filter(|id| *id > 0)
        .is_none()
        || fresh["provisionedReleaseSha"].as_str() != Some(sha)
        || company == fixtures["upgraded"]["companyId"].as_u64()
    {
        return Err(ApiError::Conflict(
            "Acceptance fixtures do not match the release and upgraded baseline".into(),
        ));
    }
    company
        .zip(document)
        .ok_or_else(|| ApiError::Conflict("Fresh acceptance fixture is incomplete".into()))
}

async fn exchange(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<ExchangeRequest>,
) -> Result<Response, ApiError> {
    let config = config()?;
    let build = served_build(&headers)?;
    let stage = request.stage;
    match (stage, request.release_sha.as_deref()) {
        (Stage::Nightly, None) => (),
        (Stage::Preflight | Stage::Verify, Some(sha)) if valid_sha(sha) => (),
        _ => {
            return Err(ApiError::BadRequest(
                "Invalid acceptance stage or release SHA".into(),
            ))
        }
    }
    let token = header(&headers, AUTHORIZATION.as_str())?
        .strip_prefix("Bearer ")
        .filter(|token| !token.is_empty() && token.len() <= 16_384)
        .ok_or(ApiError::Unauthorized)?;
    // Reject malformed input before a network request.
    let jwt_header = decode_header(token).map_err(|_| ApiError::Unauthorized)?;
    if jwt_header.alg != Algorithm::RS256 || jwt_header.kid.is_none() {
        return Err(ApiError::Unauthorized);
    }
    let _permit = EXCHANGE_SLOTS
        .try_acquire()
        .map_err(|_| ApiError::RateLimited("Acceptance broker is busy".into()))?;
    let client = HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(8))
            .build()
            .expect("construct acceptance HTTP client")
    });
    let keys: JwkSet = client
        .get(format!("{ISSUER}/.well-known/jwks"))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(ApiError::unavailable)?
        .json()
        .await
        .map_err(ApiError::unavailable)?;
    let job = verify_job(token, &keys, &config, stage, build.sha)?;
    if stage == Stage::Verify && request.release_sha.as_deref() != Some(build.sha) {
        return Err(ApiError::Conflict(
            "Public web build does not match the requested candidate".into(),
        ));
    }

    let registry = AcceptanceRegistry::for_verified_job(state.as_ref(), &job)?;
    let public_key = proof_key("AI_CHAT_ACCEPTANCE_PROOF_PUBLIC_KEY")?;
    let fixtures = if stage == Stage::Preflight {
        let baseline = registry.manifest().await?.ok_or_else(|| {
            ApiError::Unavailable("Upgraded acceptance baseline is missing".into())
        })?;
        json!({"upgraded": baseline["upgraded"]})
    } else {
        let Some(mut fixtures) = registry.manifest().await? else {
            if stage != Stage::Verify {
                return Err(ApiError::Conflict(
                    "The active release has no acceptance fixture".into(),
                ));
            }
            let now = Utc::now().timestamp_micros();
            let private_key = proof_key("AI_CHAT_ACCEPTANCE_PROOF_PRIVATE_KEY")?;
            let proof = sign_activation(&config, build.sha, private_key.as_bytes(), now)?;
            verify_activation(&proof, &config, &build, public_key.as_bytes(), now)?;
            return Ok((
                StatusCode::CONFLICT,
                [(CACHE_CONTROL, HeaderValue::from_static("no-store"))],
                Json(json!({"code":"fresh_fixture_pending","releaseSha":build.sha,"activationProof":proof})),
            )
                .into_response());
        };
        let (company, document) = fresh_scope(&fixtures, build.sha)?;
        let proof = fixtures["activationProof"]
            .as_str()
            .ok_or_else(|| ApiError::Conflict("Acceptance cutover receipt is missing".into()))?;
        let activated_at = verify_activation(
            proof,
            &config,
            &build,
            public_key.as_bytes(),
            Utc::now().timestamp_micros(),
        )?;
        registry
            .verify_provisioning_dates(company, document, activated_at)
            .await?;
        fixtures
            .as_object_mut()
            .ok_or_else(|| {
                ApiError::Unavailable("Acceptance registry has an invalid manifest".into())
            })?
            .remove("activationProof");
        fixtures
    };
    registry
        .verify_upgraded_source(&fixtures["upgraded"])
        .await?;
    let companies = company_ids(&fixtures)?;
    if companies.is_empty() || companies.len() > MAX_ACTORS {
        return Err(ApiError::Unavailable(
            "Acceptance registry has no eligible companies".into(),
        ));
    }
    let fresh_company = fixtures["fresh"]["companyId"].as_u64();
    let config = &config;
    let state = state.as_ref();
    let exchanges = companies.into_iter().map(|company| async move {
        let (user, password) = config.credentials(company, fresh_company)?;
        let token = workos::authenticate_acceptance_actor(
            state,
            client,
            user,
            password,
            config.organization_id,
            company,
        )
        .await?;
        Ok::<_, ApiError>((company.to_string(), token))
    });
    let access_tokens: BTreeMap<_, _> = futures_util::future::try_join_all(exchanges)
        .await?
        .into_iter()
        .collect();
    Ok((
        [(CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(json!({
            "releaseSha": build.sha, "fixtures": fixtures, "accessTokens": access_tokens,
        })),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "abababababababababababababababababababab";

    fn settings() -> BrokerConfig {
        serde_json::from_value(json!({
            "repository":"owner/repo", "repositoryId":"42", "environment":"production",
            "organizationId":4097, "actors":[],
            "freshActor":{"userId":"user_fresh","password":"fixture"},
        }))
        .unwrap()
    }

    fn job() -> JobClaims {
        serde_json::from_value(json!({
            "repository":"owner/repo","repository_id":"42","environment":"production",
            "ref":"refs/heads/main",
            "workflow_ref":"owner/repo/.github/workflows/release-main.yml@refs/heads/main",
            "job_workflow_ref":"owner/repo/.github/workflows/release-railway-stack.yml@refs/heads/main",
            "event_name":"workflow_run","iat":1,"exp":2,
        })).unwrap()
    }

    #[test]
    fn job_must_match_the_repository_environment_and_both_workflows() {
        let config = settings();
        assert!(authorized_job(&job(), &config, Stage::Verify));
        assert!(!authorized_job(&job(), &config, Stage::Nightly));
        let mut wrong = job();
        wrong.repository_id = "43".into();
        assert!(!authorized_job(&wrong, &config, Stage::Verify));
        let mut wrong = job();
        wrong.environment = "dev".into();
        assert!(!authorized_job(&wrong, &config, Stage::Verify));
        let mut wrong = job();
        wrong.git_ref = "refs/heads/other".into();
        assert!(!authorized_job(&wrong, &config, Stage::Verify));
        let mut wrong = job();
        wrong.event_name = "pull_request_target".into();
        assert!(!authorized_job(&wrong, &config, Stage::Verify));
        let mut wrong = job();
        wrong.workflow_ref = "owner/repo/.github/workflows/untrusted.yml@refs/heads/main".into();
        assert!(!authorized_job(&wrong, &config, Stage::Verify));
    }

    #[test]
    fn cutover_receipt_is_bound_to_build_tenant_environment_and_key() {
        use std::{
            io::Write,
            process::{Command, Stdio},
        };

        let signing_key = Command::new("openssl")
            .args(["genpkey", "-algorithm", "Ed25519"])
            .output()
            .unwrap();
        assert!(signing_key.status.success());
        let mut public = Command::new("openssl")
            .args(["pkey", "-pubout"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        public
            .stdin
            .take()
            .unwrap()
            .write_all(&signing_key.stdout)
            .unwrap();
        let public = public.wait_with_output().unwrap();
        assert!(public.status.success());
        let config = settings();
        let build = ServedBuild { sha: SHA };
        let key = public.stdout.as_slice();
        let proof = sign_activation(&config, SHA, &signing_key.stdout, 20).unwrap();
        assert_eq!(
            verify_activation(&proof, &config, &build, key, 22).unwrap(),
            20
        );
        assert!(verify_activation(&proof, &config, &build, b"wrong", 22).is_err());
        assert!(verify_activation(&proof, &config, &build, key, 19).is_err());
        assert!(
            verify_activation(&proof, &config, &ServedBuild { sha: "other" }, key, 22).is_err()
        );
        let mut other = settings();
        other.organization_id = 1;
        assert!(verify_activation(&proof, &other, &build, key, 22).is_err());
        other.organization_id = config.organization_id;
        other.environment = "dev".into();
        assert!(verify_activation(&proof, &other, &build, key, 22).is_err());
    }

    #[test]
    fn localized_fixtures_use_their_own_company_sessions() {
        let fixtures = json!({
            "fresh":{"companyId":1}, "upgraded":{"companyId":2},
            "nonEnglish":{"fr":{"companyId":3},"rw":{"companyId":2}},
        });
        assert_eq!(company_ids(&fixtures).unwrap(), BTreeSet::from([1, 2, 3]));
    }
}

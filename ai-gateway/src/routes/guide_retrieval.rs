//! Direct, acting-user-authorized discovery of saved ERP guide revisions.
//!
//! These are related documents, not independent corroboration for a model
//! answer. In particular, saving a generated draft does not turn it into a
//! verified evidence passage. Bodies never enter the generation prompt here.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{harness::ActorCredentials, state::AppState};

pub(super) const MAX_RELATED_GUIDES: usize = 4;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_MARKDOWN_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

fn bounded_query(query: &str) -> String {
    query
        .chars()
        .scan(0, |bytes, ch| {
            *bytes += ch.len_utf8();
            (*bytes <= 240).then_some(ch)
        })
        .collect()
}

/// An explicit reference is only a selector. The API reauthorizes its read.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuideIdentity {
    pub guide_id: String,
    pub revision: u32,
}

/// A saved historical document reference, separate from live ERP evidence.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelatedGuide {
    pub guide_id: String,
    pub revision: u32,
    pub title: String,
    pub module: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow: Option<String>,
    pub language: String,
    pub review_state: String,
    pub company_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_version: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AuthorizedGuide {
    reference: RelatedGuide,
    // Used only to verify the immutable content hash; never sent to a model.
    markdown: String,
}

#[derive(Default)]
pub(super) struct GuideRetrieval {
    pub references: Vec<RelatedGuide>,
    pub degraded: bool,
}

pub(super) fn validate_guide_refs(refs: &[GuideIdentity]) -> Result<()> {
    if refs.len() > MAX_RELATED_GUIDES {
        bail!("too many guide references");
    }
    if refs
        .iter()
        .any(|reference| canonical_id(&reference.guide_id).is_none() || reference.revision == 0)
    {
        bail!("guide references require canonical positive u64 IDs and revisions");
    }
    Ok(())
}

fn canonical_id(value: &str) -> Option<u64> {
    let id = value.parse::<u64>().ok().filter(|id| *id > 0)?;
    (id.to_string() == value).then_some(id)
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str().filter(|text| !text.is_empty())
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    string_field(value, key).map(str::to_owned)
}

fn parse_document(value: &Value, org_id: u64, company_id: u64) -> Result<AuthorizedGuide> {
    let id = string_field(value, "guideId").context("guide identity is missing")?;
    if canonical_id(id).is_none()
        || string_field(value, "organizationId") != Some(org_id.to_string().as_str())
        || string_field(value, "companyId") != Some(company_id.to_string().as_str())
    {
        bail!("guide response scope mismatch");
    }
    let revision = value
        .get("revision")
        .and_then(Value::as_u64)
        .and_then(|revision| u32::try_from(revision).ok())
        .filter(|revision| *revision > 0)
        .context("guide revision is invalid")?;
    let title = string_field(value, "title").context("guide title is missing")?;
    let module = string_field(value, "module").context("guide module is missing")?;
    let markdown = value
        .get("markdown")
        .and_then(Value::as_str)
        .context("guide body is missing")?;
    let content_hash = string_field(value, "contentHash").context("guide hash is missing")?;
    if title.len() > 300
        || module.len() > 120
        || markdown.len() > MAX_MARKDOWN_BYTES
        || markdown.trim().is_empty()
        || content_hash != format!("{:x}", Sha256::digest(markdown.as_bytes()))
    {
        bail!("guide content is invalid or changed");
    }
    let review_state = string_field(value, "reviewState").context("guide state is missing")?;
    if !matches!(
        review_state,
        "draft" | "verified" | "needs_review" | "superseded"
    ) {
        bail!("guide review state is unsupported");
    }
    Ok(AuthorizedGuide {
        reference: RelatedGuide {
            guide_id: id.to_string(),
            revision,
            title: title.to_string(),
            module: module.to_string(),
            workflow: optional_string(value, "workflow"),
            language: optional_string(value, "language").unwrap_or_else(|| "en".into()),
            review_state: review_state.to_string(),
            company_id: company_id.to_string(),
            updated_at: optional_string(value, "updatedAt"),
            content_hash: content_hash.to_string(),
            product_version: optional_string(value, "productVersion"),
        },
        markdown: markdown.to_string(),
    })
}

async fn bounded_json(response: reqwest::Response) -> Result<Value> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        bail!("guide response exceeds byte limit");
    }
    let mut body = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.context("guide response unavailable")?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            bail!("guide response exceeds byte limit");
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).context("guide response is invalid JSON")
}

async fn fetch_document(
    http: &reqwest::Client,
    api_base: &str,
    actor: &ActorCredentials,
    org_id: u64,
    company_id: u64,
    reference: &GuideIdentity,
) -> Result<Option<AuthorizedGuide>> {
    validate_guide_refs(std::slice::from_ref(reference))?;
    let response = http
        .get(format!(
            "{api_base}/v1/knowledge/guides/{}",
            reference.guide_id
        ))
        .bearer_auth(&actor.stdb_token)
        .header("x-stdb-identity", &actor.identity_hex)
        .query(&[
            ("companyId", company_id.to_string()),
            ("revision", reference.revision.to_string()),
        ])
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .context("guide authority unavailable")?;
    if matches!(response.status().as_u16(), 401 | 403 | 404) {
        return Ok(None);
    }
    if !response.status().is_success() {
        bail!("guide authority unavailable");
    }
    let envelope = bounded_json(response).await?;
    if envelope.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        bail!("unsupported guide response schema");
    }
    let guide = parse_document(
        envelope.get("guide").context("guide response is missing")?,
        org_id,
        company_id,
    )?;
    if guide.reference.guide_id != reference.guide_id
        || guide.reference.revision != reference.revision
    {
        bail!("guide response identity mismatch");
    }
    Ok(Some(guide))
}

/// Load references only, through the API's fresh company/member authority.
/// A failure is distinct from an empty result and never returns unverified text.
pub(super) async fn retrieve_related_guides(
    state: &AppState,
    actor: &ActorCredentials,
    org_id: u64,
    company_id: u64,
    query: &str,
    module: Option<&str>,
    explicit: &[GuideIdentity],
) -> GuideRetrieval {
    let Some(api_base) = state
        .config
        .api_server_url
        .as_deref()
        .map(str::trim)
        .filter(|base| !base.is_empty())
    else {
        return GuideRetrieval {
            references: Vec::new(),
            degraded: true,
        };
    };
    match retrieve_for_scope(
        &state.http,
        api_base.trim_end_matches('/'),
        actor,
        org_id,
        company_id,
        query,
        module,
        explicit,
    )
    .await
    {
        Ok(references) => GuideRetrieval {
            references,
            degraded: false,
        },
        Err(error) => {
            // Never include a guide title/body or credentials in the diagnostic.
            tracing::warn!(org_id, company_id, error = %error, "saved guide discovery unavailable");
            GuideRetrieval {
                references: Vec::new(),
                degraded: true,
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn retrieve_for_scope(
    http: &reqwest::Client,
    api_base: &str,
    actor: &ActorCredentials,
    org_id: u64,
    company_id: u64,
    query: &str,
    module: Option<&str>,
    explicit: &[GuideIdentity],
) -> Result<Vec<RelatedGuide>> {
    validate_guide_refs(explicit)?;
    let mut selected = Vec::new();
    for reference in explicit {
        let guide = fetch_document(http, api_base, actor, org_id, company_id, reference)
            .await?
            .context("selected guide is unavailable")?;
        selected.push(guide);
    }
    // Explicit guide follow-ups retain their exact historical revision rather
    // than swapping it for the current head selected by a search.
    if explicit.is_empty() {
        let mut params = vec![
            ("companyId", company_id.to_string()),
            ("query", bounded_query(query)),
            ("limit", MAX_RELATED_GUIDES.to_string()),
        ];
        if let Some(module) = module.filter(|value| !value.is_empty()) {
            params.push(("module", module.chars().take(120).collect()));
        }
        let response = http
            .get(format!("{api_base}/v1/knowledge/guides"))
            .bearer_auth(&actor.stdb_token)
            .header("x-stdb-identity", &actor.identity_hex)
            .query(&params)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .context("guide authority unavailable")?;
        if matches!(response.status().as_u16(), 401 | 403) {
            bail!("saved guide access denied");
        }
        if !response.status().is_success() {
            bail!("guide authority unavailable");
        }
        let envelope = bounded_json(response).await?;
        if envelope.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
            bail!("unsupported guide response schema");
        }
        let guides = envelope
            .get("guides")
            .and_then(Value::as_array)
            .context("guide list is missing")?;
        for value in guides.iter().take(MAX_RELATED_GUIDES) {
            let guide = parse_document(value, org_id, company_id)?;
            if module.is_some_and(|module| module != guide.reference.module)
                || matches!(
                    guide.reference.review_state.as_str(),
                    "needs_review" | "superseded"
                )
            {
                continue;
            }
            selected.push(guide);
        }
    }
    recheck_for_scope(http, api_base, actor, org_id, company_id, &selected).await
}

async fn recheck_for_scope(
    http: &reqwest::Client,
    api_base: &str,
    actor: &ActorCredentials,
    org_id: u64,
    company_id: u64,
    selected: &[AuthorizedGuide],
) -> Result<Vec<RelatedGuide>> {
    let mut references = Vec::new();
    for guide in selected {
        let identity = GuideIdentity {
            guide_id: guide.reference.guide_id.clone(),
            revision: guide.reference.revision,
        };
        let fresh = fetch_document(http, api_base, actor, org_id, company_id, &identity).await?;
        if fresh.as_ref() != Some(guide) {
            bail!("saved guide changed or became unavailable");
        }
        if !references.contains(&guide.reference) {
            references.push(guide.reference.clone());
        }
    }
    Ok(references)
}

/// Repeat current authorization immediately before the RAG response leaves.
/// No body or reference survives a revoked or changed exact revision.
pub(super) async fn recheck_related_guides(
    state: &AppState,
    actor: &ActorCredentials,
    org_id: u64,
    company_id: u64,
    references: &[RelatedGuide],
) -> GuideRetrieval {
    if references.is_empty() {
        return GuideRetrieval::default();
    }
    let Some(api_base) = state
        .config
        .api_server_url
        .as_deref()
        .map(str::trim)
        .filter(|base| !base.is_empty())
    else {
        return GuideRetrieval {
            references: Vec::new(),
            degraded: true,
        };
    };
    let mut outcome = GuideRetrieval::default();
    for reference in references.iter().take(MAX_RELATED_GUIDES) {
        let identity = GuideIdentity {
            guide_id: reference.guide_id.clone(),
            revision: reference.revision,
        };
        match fetch_document(
            &state.http,
            api_base.trim_end_matches('/'),
            actor,
            org_id,
            company_id,
            &identity,
        )
        .await
        {
            Ok(Some(guide)) if guide.reference == *reference => {
                outcome.references.push(guide.reference)
            }
            Ok(_) => outcome.degraded = true,
            Err(_) => outcome.degraded = true,
        }
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn document() -> Value {
        json!({
            "guideId":"9007199254740993", "revision":2, "organizationId":"1", "companyId":"2",
            "title":"Posting a vendor bill", "module":"accounting", "markdown":"Check the bill first.",
            "contentHash":format!("{:x}", Sha256::digest(b"Check the bill first.")),
            "reviewState":"draft", "language":"en"
        })
    }

    #[test]
    fn identities_preserve_u64_precision_and_reject_noncanonical_paths() {
        let valid = GuideIdentity {
            guide_id: "9007199254740993".into(),
            revision: 1,
        };
        assert!(validate_guide_refs(&[valid]).is_ok());
        for invalid in ["0", "01", "../2", "1?companyId=3", "18446744073709551616"] {
            assert!(validate_guide_refs(&[GuideIdentity {
                guide_id: invalid.into(),
                revision: 1
            }])
            .is_err());
        }
    }

    #[test]
    fn saved_drafts_are_references_with_no_body_or_false_verification() {
        let guide = parse_document(&document(), 1, 2).expect("authorized guide");
        let serialized = serde_json::to_value(&guide.reference).expect("reference JSON");
        assert_eq!(serialized["guideId"], "9007199254740993");
        assert_eq!(serialized["reviewState"], "draft");
        assert!(serialized.get("markdown").is_none());
        assert!(serialized.get("html").is_none());
    }

    #[test]
    fn scope_body_and_version_must_match_the_authority() {
        let mut value = document();
        assert!(parse_document(&value, 1, 3).is_err());
        value["markdown"] = json!("Replaced text");
        assert!(parse_document(&value, 1, 2).is_err());
        value = document();
        value["revision"] = json!(0);
        assert!(parse_document(&value, 1, 2).is_err());
        value = document();
        value["reviewState"] = json!("published_by_model");
        assert!(parse_document(&value, 1, 2).is_err());
    }

    #[test]
    fn guide_search_query_is_bounded_on_utf8_boundaries() {
        let query = "é".repeat(300);
        assert_eq!(bounded_query(&query).len(), 240);
        assert_eq!(bounded_query("short"), "short");
    }

    use axum::{
        extract::{Query, State},
        http::{HeaderMap, StatusCode},
        routing::get,
        Json, Router,
    };
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
    };

    #[derive(Clone)]
    struct FakeAuthority {
        revoked: Arc<AtomicBool>,
        changed: bool,
    }

    fn authenticated(headers: &HeaderMap, query: &HashMap<String, String>) -> bool {
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            == Some("Bearer actor-token")
            && headers
                .get("x-stdb-identity")
                .and_then(|value| value.to_str().ok())
                == Some("actor")
            && query.get("companyId").map(String::as_str) == Some("2")
    }

    async fn search(
        State(authority): State<FakeAuthority>,
        headers: HeaderMap,
        Query(query): Query<HashMap<String, String>>,
    ) -> Result<Json<Value>, StatusCode> {
        if !authenticated(&headers, &query) || authority.revoked.load(Ordering::SeqCst) {
            return Err(StatusCode::FORBIDDEN);
        }
        Ok(Json(json!({"schemaVersion":1,"guides":[document()]})))
    }

    async fn read(
        State(authority): State<FakeAuthority>,
        headers: HeaderMap,
        Query(query): Query<HashMap<String, String>>,
    ) -> Result<Json<Value>, StatusCode> {
        if !authenticated(&headers, &query) || authority.revoked.load(Ordering::SeqCst) {
            return Err(StatusCode::NOT_FOUND);
        }
        let mut value = document();
        if authority.changed {
            value["markdown"] = json!("Replacement revision content.");
            value["contentHash"] = json!(format!(
                "{:x}",
                Sha256::digest(b"Replacement revision content.")
            ));
        }
        Ok(Json(json!({"schemaVersion":1,"guide":value})))
    }

    async fn authority(changed: bool) -> (String, Arc<AtomicBool>, tokio::task::JoinHandle<()>) {
        let revoked = Arc::new(AtomicBool::new(false));
        let router = Router::new()
            .route("/v1/knowledge/guides", get(search))
            .route("/v1/knowledge/guides/9007199254740993", get(read))
            .with_state(FakeAuthority {
                revoked: revoked.clone(),
                changed,
            });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("fixture listener");
        let address = listener.local_addr().expect("fixture address");
        let server =
            tokio::spawn(
                async move { axum::serve(listener, router).await.expect("fixture server") },
            );
        (format!("http://{address}"), revoked, server)
    }

    #[tokio::test]
    async fn retrieval_and_next_read_use_actor_auth_and_observe_revocation() {
        let (base, revoked, server) = authority(false).await;
        let actor = ActorCredentials::new("actor-token", "actor").expect("actor");
        let http = reqwest::Client::new();
        let references =
            retrieve_for_scope(&http, &base, &actor, 1, 2, "bill", Some("accounting"), &[])
                .await
                .expect("authorized lookup");
        assert_eq!(references.len(), 1);
        assert_eq!(references[0].revision, 2);
        revoked.store(true, Ordering::SeqCst);
        let selected = [parse_document(&document(), 1, 2).expect("original guide")];
        let after = recheck_for_scope(&http, &base, &actor, 1, 2, &selected).await;
        assert!(after.is_err());
        server.abort();
    }

    #[tokio::test]
    async fn replaced_body_is_removed_between_search_and_exact_revision_read() {
        let (base, _, server) = authority(true).await;
        let actor = ActorCredentials::new("actor-token", "actor").expect("actor");
        let references = retrieve_for_scope(
            &reqwest::Client::new(),
            &base,
            &actor,
            1,
            2,
            "bill",
            Some("accounting"),
            &[],
        )
        .await;
        assert!(references.is_err());
        server.abort();
    }

    /// Invoked only by the isolated hosted lifecycle job against its actual
    /// authenticated API/STDB/PostgreSQL stack. No fake authority or model runs.
    #[tokio::test]
    #[ignore = "requires the real-service guide lifecycle fixture"]
    async fn real_authority_guides_lifecycle() {
        let path = std::env::var("GUIDE_LIVE_FIXTURE").expect("live fixture is required");
        let fixture: Value =
            serde_json::from_slice(&std::fs::read(path).expect("live fixture must be readable"))
                .expect("live fixture JSON");
        let text = |key: &str| {
            fixture[key]
                .as_str()
                .filter(|value| !value.is_empty())
                .expect("required live fixture string")
        };
        let number = |key: &str| {
            fixture[key]
                .as_u64()
                .filter(|value| *value > 0)
                .expect("required live fixture identity")
        };
        let base = text("apiBase");
        assert_eq!(base, "http://127.0.0.1:8082");
        let org = number("orgId");
        let company = number("companyId");
        let actor = ActorCredentials::new(text("token"), text("identity")).expect("live actor");
        let denied = ActorCredentials::new(text("deniedToken"), text("deniedIdentity"))
            .expect("denied live actor");
        let non_member = ActorCredentials::new(text("nonMemberToken"), text("nonMemberIdentity"))
            .expect("non-member live actor");
        let identity = GuideIdentity {
            guide_id: text("guideId").to_string(),
            revision: u32::try_from(number("revision")).expect("live revision"),
        };
        let http = reqwest::Client::new();
        if let Some(key) = fixture["verificationKey"].as_str() {
            use crate::orchestrator::evidence_inspector::{
                retrieve_reusable_knowledge, ActorIdentity, KnowledgeRetrieval, Viewer,
            };
            let host = std::env::var("STDB_HOST").expect("isolated STDB host");
            assert_eq!(host, "http://127.0.0.1:3000");
            let owner = stdb_client::StdbClient::new(
                host,
                std::env::var("STDB_MODULE").expect("isolated module"),
                std::env::var("STDB_SERVER_TOKEN").expect("isolated owner token"),
            );
            owner.call_reducer(stdb_client::ReducerCall::from_name("register_cold_tier_service_identity",serde_json::json!([org,format!("guide-acceptance-reader-{org}"),"ai_spend_reader",{"__identity__":format!("0x{}",text("identity").trim_start_matches("0x"))}])).expect("reader registration contract")).await.expect("isolated service reader binding");
            let client = owner.with_token(text("token"));
            let profiles = client
                .query_sql("SELECT * FROM knowledge_guide_actor_profile_read")
                .await
                .expect("bound minimal profile view");
            assert!(
                !profiles.is_empty(),
                "bound reader must have current profile authority"
            );
            for profile in profiles {
                assert!(
                    !profile
                        .as_object()
                        .expect("profile row")
                        .keys()
                        .any(|key| matches!(
                            key.as_str(),
                            "name" | "email" | "phone" | "avatarUrl"
                        )),
                    "profile authority view must not expose directory PII"
                );
            }
            assert!(
                owner
                    .with_token(text("deniedToken"))
                    .query_sql("SELECT * FROM knowledge_guide_actor_profile_read")
                    .await
                    .expect("ordinary authority read")
                    .is_empty(),
                "ordinary user cannot read trusted source authority"
            );
            let viewer = Viewer {
                organization_id: org,
                company_id: company,
                actor_identity: ActorIdentity::parse(text("identity")),
            };
            let result = retrieve_reusable_knowledge(&client, viewer, key)
                .await
                .expect("real guide knowledge authority");
            assert_eq!(
                matches!(result, KnowledgeRetrieval::Reusable(_)),
                fixture["expectReusable"]
                    .as_bool()
                    .expect("expected authority result"),
                "actual guide knowledge authority: {result:?}"
            );
            return;
        }
        let discovered = retrieve_for_scope(
            &http,
            base,
            &actor,
            org,
            company,
            text("query"),
            Some("accounting"),
            &[],
        )
        .await
        .expect("real fresh-request discovery");
        if fixture["revoked"].as_bool() == Some(true) {
            assert!(discovered.is_empty());
            assert!(
                retrieve_for_scope(&http, base, &actor, org, company, "", None, &[identity])
                    .await
                    .is_err()
            );
            return;
        }
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].guide_id, identity.guide_id);
        assert_eq!(discovered[0].revision, identity.revision);
        assert_eq!(discovered[0].review_state, "draft");
        // No previous conversation references are supplied. A second independent
        // HTTP client must discover the same exact authorized saved document.
        let fresh = retrieve_for_scope(
            &reqwest::Client::new(),
            base,
            &actor,
            org,
            company,
            text("query"),
            Some("accounting"),
            &[],
        )
        .await
        .expect("independent conversation discovery");
        assert_eq!(fresh, discovered);
        let historical = GuideIdentity {
            revision: 1,
            ..identity.clone()
        };
        let reattached =
            retrieve_for_scope(&http, base, &actor, org, company, "", None, &[historical])
                .await
                .expect("exact historical reattachment");
        assert_eq!(reattached[0].revision, 1);
        assert_eq!(reattached[0].review_state, "superseded");
        assert!(retrieve_for_scope(
            &http,
            base,
            &denied,
            org,
            company,
            "",
            None,
            std::slice::from_ref(&identity),
        )
        .await
        .is_err());
        assert!(retrieve_for_scope(
            &http,
            base,
            &non_member,
            org,
            company,
            "",
            None,
            std::slice::from_ref(&identity),
        )
        .await
        .is_err());
        assert!(retrieve_for_scope(
            &http,
            base,
            &actor,
            org,
            number("otherCompanyId"),
            "",
            None,
            &[identity],
        )
        .await
        .is_err());
    }
}

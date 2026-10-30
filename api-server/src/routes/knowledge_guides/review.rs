//! The guide adapter delegates nomination and all review decisions to the existing
//! knowledge-entry/evidence owners. It never writes a guide review flag.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct NominateRequest {
    company_id: String,
    revision: u32,
    source_passage_ids: Vec<String>,
    claim_ids: Vec<String>,
    decision_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReviewRequest {
    company_id: String,
    revision: u32,
    review_kind: String,
    outcome: String,
    note: Option<String>,
}

fn ids(values: &[String]) -> Result<Vec<u64>, ApiError> {
    if values.len() > 32 {
        return Err(ApiError::BadRequest(
            "too many guide evidence references".into(),
        ));
    }
    values.iter().map(|value| positive_id(value)).collect()
}

fn key(id: u64, revision: u64) -> String {
    format!("guide:{id}:revision:{revision}")
}

/// The existing evidence inspection grant and canonical evidence scope own this
/// named picker. Saved source pointers are selectors, never read authority.
pub(super) async fn choices(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(q): Query<ReadQuery>,
    OrgSession { session, .. }: OrgSession,
) -> Result<Json<Value>, ApiError> {
    let ctx = context(&state, &session, q.company_id).await?;
    let grants = crate::routes::ai_capabilities::resolve_effective_capability_grants(
        &state,
        ctx.organization_id(),
        ctx.actor_identity(),
        chrono::Utc::now().timestamp_micros(),
    )
    .await?;
    let Some(bound) = grants
        .iter()
        .find(|grant| grant.capability_key == "ai.evidence.inspect")
    else {
        return Err(ApiError::Forbidden(
            "guide evidence inspection is not permitted".into(),
        ));
    };
    let id = positive_id(&id)?;
    let current = head(&state, &ctx, q.company_id, id).await?;
    let guide = revision(&state, &ctx, q.company_id, &current, q.revision).await?;
    if guide["revision"] != guide["headRevision"] {
        return Err(ApiError::Conflict(
            "choose evidence for the current guide revision".into(),
        ));
    }
    let mut passage_ids = Vec::new();
    for source in guide["sources"].as_array().into_iter().flatten() {
        if let Some(id) = source
            .get("passage_id")
            .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
            .filter(|id| *id > 0)
        {
            if !passage_ids.contains(&id) {
                passage_ids.push(id);
            }
        }
    }
    let org = ctx.organization_id();
    let company = q.company_id;
    let mut passages = std::collections::BTreeMap::new();
    for passage_id in passage_ids.into_iter().take(30) {
        let rows = state.stdb.query_sql(&format!("SELECT id, organization_id, company_id, source_kind, source_key, source_version, source_version_id, status, text_state FROM ai_evidence_passage WHERE organization_id = {org} AND id = {passage_id} LIMIT 1")).await.map_err(ApiError::internal)?;
        let Some(passage) = rows.first() else {
            continue;
        };
        if string(passage, "status") != Some("current")
            || string(passage, "text_state") != Some("present")
        {
            continue;
        }
        let label = if let Some(version_id) = u64_value(passage, "source_version_id") {
            let versions = state.stdb.query_sql(&format!("SELECT source_id, status FROM ai_evidence_source_version WHERE organization_id = {org} AND id = {version_id} LIMIT 1")).await.map_err(ApiError::internal)?;
            let Some(version) = versions.first() else {
                continue;
            };
            if string(version, "status") != Some("current") {
                continue;
            }
            let Some(source_id) = u64_value(version, "source_id") else {
                continue;
            };
            let sources = state.stdb.query_sql(&format!("SELECT title, organization_id, company_id, scope FROM ai_evidence_source WHERE organization_id = {org} AND id = {source_id} LIMIT 1")).await.map_err(ApiError::internal)?;
            let Some(source) = sources.first() else {
                continue;
            };
            if !(string(source, "scope") == Some("organization")
                || (string(source, "scope") == Some("company")
                    && u64_value(source, "company_id") == Some(company)))
            {
                continue;
            }
            string(source, "title").unwrap_or("Source").to_owned()
        } else {
            if u64_value(passage, "company_id") != Some(company) {
                continue;
            }
            format!(
                "{} · {}",
                string(passage, "source_kind").unwrap_or("Source"),
                string(passage, "source_key").unwrap_or("")
            )
        };
        passages.insert(passage_id, label);
    }
    let mut options = Vec::new();
    if !passages.is_empty() {
        let claims = state.stdb.query_sql(&format!("SELECT id, supporting_passage_ids, verification_method, verification_outcome FROM ai_evidence_claim WHERE organization_id = {org} AND company_id = {company} AND status = 'current' LIMIT 201")).await.map_err(ApiError::internal)?;
        let decisions = state.stdb.query_sql(&format!("SELECT id, title, rationale, adopted_claim_ids, supporting_claim_ids FROM ai_evidence_decision WHERE organization_id = {org} AND company_id = {company} AND status = 'accepted' LIMIT 201")).await.map_err(ApiError::internal)?;
        if claims.len() > 200 || decisions.len() > 200 {
            return Err(ApiError::Unprocessable(
                "guide evidence selection exceeds its current bound".into(),
            ));
        }
        let eligible: std::collections::BTreeMap<u64, Vec<u64>> = claims
            .iter()
            .filter_map(|claim| {
                let refs = row_ids(claim, "supporting_passage_ids");
                (string(claim, "verification_method") == Some("human_reviewed")
                    && string(claim, "verification_outcome") == Some("supported")
                    && !refs.is_empty()
                    && refs.iter().all(|id| passages.contains_key(id)))
                .then(|| Some((u64_value(claim, "id")?, refs)))
                .flatten()
            })
            .collect();
        for decision in decisions {
            let mut claims = row_ids(&decision, "adopted_claim_ids");
            claims.extend(row_ids(&decision, "supporting_claim_ids"));
            claims.sort_unstable();
            claims.dedup();
            if claims.is_empty() || !claims.iter().all(|id| eligible.contains_key(id)) {
                continue;
            }
            let mut refs: Vec<u64> = claims
                .iter()
                .flat_map(|id| eligible[id].iter().copied())
                .collect();
            refs.sort_unstable();
            refs.dedup();
            let Some(decision_id) = u64_value(&decision, "id") else {
                continue;
            };
            options.push(json!({"decisionId":decision_id.to_string(),"title":string(&decision,"title").unwrap_or("Reviewed decision"),"summary":string(&decision,"rationale").unwrap_or("").chars().take(400).collect::<String>(),"sourceLabels":refs.iter().filter_map(|id|passages.get(id)).collect::<Vec<_>>(),"sourcePassageIds":refs.iter().map(u64::to_string).collect::<Vec<_>>(),"claimIds":claims.iter().map(u64::to_string).collect::<Vec<_>>()}));
        }
    }
    let final_head = head(&state, &ctx, company, id).await?;
    if field(&final_head, "latest_revision") != &guide["revision"] {
        return Err(ApiError::Conflict(
            "guide changed while loading evidence".into(),
        ));
    }
    resolve_membership_company_id(
        &state.stdb,
        org,
        ctx.actor_identity(),
        Some(company),
        "guide membership changed",
    )
    .await?;
    ctx.require_current_placement(&state.organization_placements)?;
    let rows: usize = options
        .iter()
        .map(|option| {
            1 + option["sourcePassageIds"].as_array().map_or(0, Vec::len)
                + option["claimIds"].as_array().map_or(0, Vec::len)
        })
        .sum();
    let payload = json!({"schemaVersion":1,"guideId":id.to_string(),"companyId":company.to_string(),"revision":guide["revision"],"choices":options});
    if rows as u64 > u64::from(bound.max_rows)
        || serde_json::to_vec(&payload)
            .map_err(ApiError::internal)?
            .len() as u64
            > bound.max_bytes
    {
        return Err(ApiError::Unprocessable(
            "guide evidence exceeds the current inspection grant; narrow its sources".into(),
        ));
    }
    let fresh_grants = crate::routes::ai_capabilities::resolve_effective_capability_grants(
        &state,
        org,
        ctx.actor_identity(),
        chrono::Utc::now().timestamp_micros(),
    )
    .await?;
    if !fresh_grants.iter().any(|grant| {
        grant.capability_key == "ai.evidence.inspect"
            && u64::from(grant.max_rows) >= rows as u64
            && grant.max_bytes
                >= serde_json::to_vec(&payload).map_or(u64::MAX, |bytes| bytes.len() as u64)
    }) {
        return Err(ApiError::Forbidden(
            "guide evidence inspection grant changed".into(),
        ));
    }
    Ok(Json(payload))
}

fn row_ids(row: &Value, key: &str) -> Vec<u64> {
    field(row, key)
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
        .collect()
}

pub(super) async fn evidence(
    state: &AppState,
    ctx: &TrustedOperationContext,
    company: u64,
    head: &Value,
    rev: &Value,
) -> Result<Value, ApiError> {
    let org = ctx.organization_id();
    let id =
        u64_value(head, "id").ok_or_else(|| ApiError::Internal("invalid guide identity".into()))?;
    let version = u64_value(rev, "revision")
        .ok_or_else(|| ApiError::Internal("invalid guide revision".into()))?;
    let key = key(id, version);
    let entries = state.stdb.query_sql(&format!("SELECT id, owner_uid, kind, share_scope FROM ai_knowledge_entry WHERE organization_id = {org} AND company_id = {company} AND entry_key = '{key}' LIMIT 2")).await.map_err(ApiError::internal)?;
    let author = actor(rev, "create_uid");
    let current_actor = identity_sql_literal(ctx.actor_identity()).ok();
    let can_nominate = can_write(ctx.field_access()) && author.is_some() && author == current_actor;
    let can_review =
        stdb_auth::permission_allowed(ctx.field_access(), "ai_knowledge_review", "update")
            && author.is_some()
            && author != current_actor;
    let [entry] = entries.as_slice() else {
        return Ok(
            json!({"state":"not_requested","verified":false,"canNominate":can_nominate,"canReview":false}),
        );
    };
    let entry_id = u64_value(entry, "id")
        .ok_or_else(|| ApiError::Internal("invalid guide review entry".into()))?;
    let versions = state.stdb.query_sql(&format!("SELECT id, title, body, create_uid, review_state, review_epoch, applicability, source_passage_ids, claim_ids, decision_ids FROM ai_knowledge_entry_version WHERE organization_id = {org} AND company_id = {company} AND entry_id = {entry_id} LIMIT 2")).await.map_err(ApiError::internal)?;
    let [candidate] = versions.as_slice() else {
        return Ok(json!({"state":"conflict","verified":false}));
    };
    let candidate_id = u64_value(candidate, "id")
        .ok_or_else(|| ApiError::Internal("invalid guide review version".into()))?;
    let reviews = state.stdb.query_sql(&format!("SELECT id, review_kind, outcome, review_epoch, reviewer_uid FROM ai_knowledge_review WHERE organization_id = {org} AND company_id = {company} AND version_id = {candidate_id} LIMIT 201")).await.map_err(ApiError::internal)?;
    let dependencies = state.stdb.query_sql(&format!("SELECT requirement, state, acknowledged_by FROM ai_evidence_dependency WHERE organization_id = {org} AND company_id = {company} AND dependent_kind = 'knowledge_version' AND dependent_id = {candidate_id} LIMIT 201")).await.map_err(ApiError::internal)?;
    let sources_current = references_current(state, org, company, candidate).await?;
    let verified = sources_current
        && verification_allowed(head, rev, entry, candidate, &reviews, &dependencies);
    let mut current_reviews: Vec<Value> = ["source_fidelity", "domain_interpretation", "implementation"].into_iter().filter_map(|kind| {
        reviews.iter().filter(|row| string(row,"review_kind") == Some(kind) && u64_value(row,"review_epoch") == u64_value(candidate,"review_epoch")).max_by_key(|row|u64_value(row,"id").unwrap_or(0)).map(|row|json!({"kind":kind,"outcome":field(row,"outcome"),"reviewer":field(row,"reviewer_uid")}))
    }).collect();
    if stdb_auth::has_resource_field_read_permission(
        Some(ctx.field_access()),
        "user-profile",
        "name",
    ) {
        for review in &mut current_reviews {
            let Some(reviewer) = review["reviewer"]
                .as_str()
                .and_then(|identity| identity_sql_literal(identity).ok())
            else {
                continue;
            };
            let profiles = state.stdb.query_sql(&format!("SELECT name FROM user_profile WHERE organization_id = {org} AND identity = {reviewer} LIMIT 2")).await.map_err(ApiError::internal)?;
            if let [profile] = profiles.as_slice() {
                if let Some(name) = string(profile, "name").filter(|name| !name.trim().is_empty()) {
                    review["reviewerName"] = json!(name);
                }
            }
        }
    }
    Ok(
        json!({"state":if !sources_current && string(candidate,"review_state")==Some("approved") {"needs_review"}else{string(candidate,"review_state").unwrap_or("candidate")},"verified":verified,"entryId":entry_id.to_string(),"versionId":candidate_id.to_string(),"reviewEpoch":u64_value(candidate,"review_epoch"),"canNominate":false,"canReview":can_review,"reviews":current_reviews}),
    )
}

/// Recheck canonical records as well as dependency edges: legacy passage status
/// changes do not necessarily append a source-change event or escalate an edge.
async fn references_current(
    state: &AppState,
    org: u64,
    company: u64,
    candidate: &Value,
) -> Result<bool, ApiError> {
    use std::collections::BTreeSet;
    let mut claims: BTreeSet<u64> = row_ids(candidate, "claim_ids").into_iter().collect();
    let decisions: BTreeSet<u64> = row_ids(candidate, "decision_ids").into_iter().collect();
    let mut passages: BTreeSet<u64> = row_ids(candidate, "source_passage_ids")
        .into_iter()
        .collect();
    if decisions.is_empty() || decisions.len() > 32 || claims.len() > 32 || passages.len() > 32 {
        return Ok(false);
    }
    let csv = |ids: &BTreeSet<u64>| ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
    let decision_rows=state.stdb.query_sql(&format!("SELECT id, status, adopted_claim_ids, supporting_claim_ids FROM ai_evidence_decision WHERE organization_id = {org} AND company_id = {company} AND id IN ({}) LIMIT 201",csv(&decisions))).await.map_err(ApiError::internal)?;
    if decision_rows.len() != decisions.len()
        || decision_rows
            .iter()
            .any(|row| string(row, "status") != Some("accepted"))
    {
        return Ok(false);
    }
    for row in &decision_rows {
        claims.extend(row_ids(row, "adopted_claim_ids"));
        claims.extend(row_ids(row, "supporting_claim_ids"));
    }
    if claims.is_empty() || claims.len() > 200 {
        return Ok(false);
    }
    let claim_rows=state.stdb.query_sql(&format!("SELECT id, status, supporting_passage_ids, contradicting_passage_ids FROM ai_evidence_claim WHERE organization_id = {org} AND company_id = {company} AND id IN ({}) LIMIT 201",csv(&claims))).await.map_err(ApiError::internal)?;
    if claim_rows.len() != claims.len()
        || claim_rows
            .iter()
            .any(|row| string(row, "status") != Some("current"))
    {
        return Ok(false);
    }
    for row in &claim_rows {
        passages.extend(row_ids(row, "supporting_passage_ids"));
        passages.extend(row_ids(row, "contradicting_passage_ids"));
    }
    if passages.is_empty() || passages.len() > 200 {
        return Ok(false);
    }
    let passage_rows=state.stdb.query_sql(&format!("SELECT id, company_id, status, text_state, source_version_id FROM ai_evidence_passage WHERE organization_id = {org} AND id IN ({}) LIMIT 201",csv(&passages))).await.map_err(ApiError::internal)?;
    if passage_rows.len() != passages.len()
        || passage_rows.iter().any(|row| {
            string(row, "status") != Some("current")
                || string(row, "text_state") != Some("present")
                || (u64_value(row, "source_version_id").is_none()
                    && u64_value(row, "company_id") != Some(company))
        })
    {
        return Ok(false);
    }
    let versions: BTreeSet<u64> = passage_rows
        .iter()
        .filter_map(|row| u64_value(row, "source_version_id"))
        .collect();
    if versions.is_empty() {
        return Ok(true);
    }
    let version_rows=state.stdb.query_sql(&format!("SELECT id, source_id, status, verification FROM ai_evidence_source_version WHERE organization_id = {org} AND id IN ({}) LIMIT 201",csv(&versions))).await.map_err(ApiError::internal)?;
    if version_rows.len() != versions.len()
        || version_rows.iter().any(|row| {
            string(row, "status") != Some("current")
                || string(row, "verification") != Some("inspected")
        })
    {
        return Ok(false);
    }
    let sources: BTreeSet<u64> = version_rows
        .iter()
        .filter_map(|row| u64_value(row, "source_id"))
        .collect();
    if sources.is_empty() {
        return Ok(false);
    }
    let source_rows=state.stdb.query_sql(&format!("SELECT id, company_id, scope FROM ai_evidence_source WHERE organization_id = {org} AND id IN ({}) LIMIT 201",csv(&sources))).await.map_err(ApiError::internal)?;
    Ok(source_rows.len() == sources.len()
        && source_rows.iter().all(|row| {
            string(row, "scope") == Some("organization")
                || (string(row, "scope") == Some("company")
                    && u64_value(row, "company_id") == Some(company))
        }))
}

fn actor(value: &Value, key: &str) -> Option<String> {
    string(value, key).and_then(|id| identity_sql_literal(id).ok())
}

fn verification_allowed(
    head: &Value,
    rev: &Value,
    entry: &Value,
    candidate: &Value,
    reviews: &[Value],
    dependencies: &[Value],
) -> bool {
    let Some(author) = actor(rev, "create_uid") else {
        return false;
    };
    let Some(epoch) = u64_value(candidate, "review_epoch") else {
        return false;
    };
    if u64_value(head, "latest_revision") != u64_value(rev, "revision")
        || actor(entry, "owner_uid").as_ref() != Some(&author)
        || actor(candidate, "create_uid").as_ref() != Some(&author)
        || string(entry, "kind") != Some("procedure")
        || string(entry, "share_scope") != Some("personal")
        || string(candidate, "title") != string(rev, "title")
        || string(candidate, "body") != string(rev, "markdown")
        || string(candidate, "review_state") != Some("approved")
        || reviews.len() > 200
        || dependencies.is_empty()
        || dependencies.len() > 200
        || dependencies
            .iter()
            .any(|row| string(row, "state") != Some("valid"))
    {
        return false;
    }
    let Some(applicability) = field(candidate, "applicability").as_array() else {
        return false;
    };
    if ![
        format!("language:{}", string(rev, "language").unwrap_or("")),
        format!("module:{}", string(head, "module").unwrap_or("")),
        format!("guide:{}", u64_value(head, "id").unwrap_or(0)),
        format!("guide-revision:{}", u64_value(rev, "revision").unwrap_or(0)),
    ]
    .iter()
    .all(|tag| {
        applicability
            .iter()
            .any(|value| value.as_str() == Some(tag.as_str()))
    }) {
        return false;
    }
    for kind in ["source_fidelity", "domain_interpretation", "implementation"] {
        let latest = reviews
            .iter()
            .filter(|row| {
                u64_value(row, "review_epoch") == Some(epoch)
                    && string(row, "review_kind") == Some(kind)
            })
            .max_by_key(|row| u64_value(row, "id").unwrap_or(0));
        let Some(review) = latest else {
            return false;
        };
        if string(review, "outcome") != Some("accepted")
            || actor(review, "reviewer_uid").is_none_or(|reviewer| reviewer == author)
        {
            return false;
        }
    }
    true
}

pub(super) async fn nominate(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<NominateRequest>,
) -> Result<Json<Value>, ApiError> {
    let company = positive_id(&body.company_id)?;
    let ctx = context(&state, &session, company).await?;
    let id = positive_id(&id)?;
    let current = head(&state, &ctx, company, id).await?;
    if body.revision == 0 || u64_value(&current, "latest_revision") != Some(body.revision.into()) {
        return Err(ApiError::Conflict("guide revision changed".into()));
    }
    dispatch_session_reducer(
        &state,
        &session,
        "nominate_knowledge_guide",
        json!([
            ctx.organization_id(),
            company,
            id,
            body.revision,
            ids(&body.source_passage_ids)?,
            ids(&body.claim_ids)?,
            ids(&body.decision_ids)?
        ]),
    )
    .await?;
    let guide = revision(&state, &ctx, company, &current, Some(body.revision)).await?;
    Ok(Json(json!({"schemaVersion":1,"guide":guide})))
}

pub(super) async fn record_review(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<ReviewRequest>,
) -> Result<Json<Value>, ApiError> {
    let company = positive_id(&body.company_id)?;
    let ctx = context(&state, &session, company).await?;
    let id = positive_id(&id)?;
    let current = head(&state, &ctx, company, id).await?;
    let guide = revision(&state, &ctx, company, &current, Some(body.revision)).await?;
    let version_id = guide["reviewEvidence"]["versionId"]
        .as_str()
        .ok_or_else(|| {
            ApiError::BadRequest("request guide verification before reviewing".into())
        })?;
    if body.revision == 0 || u64_value(&current, "latest_revision") != Some(body.revision.into()) {
        return Err(ApiError::Conflict("guide revision changed".into()));
    }
    if !["source_fidelity", "domain_interpretation", "implementation"]
        .contains(&body.review_kind.as_str())
        || !["accepted", "rejected"].contains(&body.outcome.as_str())
        || body.note.as_ref().is_some_and(|note| note.len() > 2000)
    {
        return Err(ApiError::BadRequest("invalid guide review".into()));
    }
    dispatch_session_reducer(&state,&session,"review_ai_knowledge_entry_version",json!([ctx.organization_id(),company,positive_id(version_id)?,{"review_kind":body.review_kind,"outcome":body.outcome,"note":body.note.as_ref().map(|note|json!({"some":note})).unwrap_or_else(||json!({"none":[]}))}])).await?;
    let guide = revision(&state, &ctx, company, &current, Some(body.revision)).await?;
    Ok(Json(json!({"schemaVersion":1,"guide":guide})))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Value, Value, Value, Value, Vec<Value>, Vec<Value>) {
        let author = "a".repeat(64);
        (json!({"id":7,"latest_revision":2,"module":"accounting"}),
         json!({"revision":2,"title":"Posting checks","markdown":"Review the bill","language":"en","create_uid":author}),
         json!({"owner_uid":author,"kind":"procedure","share_scope":"personal"}),
         json!({"title":"Posting checks","body":"Review the bill","create_uid":author,"review_state":"approved","review_epoch":1,"applicability":["language:en","module:accounting","guide:7","guide-revision:2"]}),
         ["source_fidelity","domain_interpretation","implementation"].into_iter().enumerate().map(|(id,kind)|json!({"id":id+1,"review_kind":kind,"outcome":"accepted","review_epoch":1,"reviewer_uid":"b".repeat(64)})).collect(),
         vec![json!({"requirement":"required","state":"valid"})])
    }

    #[test]
    fn verification_requires_exact_author_content_and_all_current_independent_reviews() {
        let (head, rev, entry, candidate, mut reviews, deps) = fixture();
        assert!(verification_allowed(
            &head, &rev, &entry, &candidate, &reviews, &deps
        ));
        reviews[0]["reviewer_uid"] = json!("a".repeat(64));
        assert!(!verification_allowed(
            &head, &rev, &entry, &candidate, &reviews, &deps
        ));
        let (_, _, _, _, mut reviews, _) = fixture();
        reviews[0]["review_epoch"] = json!(0);
        assert!(!verification_allowed(
            &head, &rev, &entry, &candidate, &reviews, &deps
        ));
        let (_, _, _, _, mut reviews, _) = fixture();
        reviews.push(json!({"id":10,"review_kind":"implementation","outcome":"rejected","review_epoch":1,"reviewer_uid":"c".repeat(64)}));
        assert!(!verification_allowed(
            &head, &rev, &entry, &candidate, &reviews, &deps
        ));
    }

    #[test]
    fn stale_sources_revision_or_scope_metadata_cannot_keep_verified_status() {
        let (mut head, rev, entry, mut candidate, reviews, mut deps) = fixture();
        deps[0]["state"] = json!("needs_review");
        assert!(!verification_allowed(
            &head, &rev, &entry, &candidate, &reviews, &deps
        ));
        deps[0]["state"] = json!("valid");
        head["latest_revision"] = json!(3);
        assert!(!verification_allowed(
            &head, &rev, &entry, &candidate, &reviews, &deps
        ));
        head["latest_revision"] = json!(2);
        candidate["body"] = json!("A changed instruction");
        assert!(!verification_allowed(
            &head, &rev, &entry, &candidate, &reviews, &deps
        ));
        candidate["body"] = rev["markdown"].clone();
        candidate["applicability"] = json!([
            "language:fr",
            "module:accounting",
            "guide:7",
            "guide-revision:2"
        ]);
        assert!(!verification_allowed(
            &head, &rev, &entry, &candidate, &reviews, &deps
        ));
        assert!(!verification_allowed(
            &head,
            &rev,
            &entry,
            &candidate,
            &reviews,
            &[]
        ));
    }

    #[test]
    fn review_requests_cannot_supply_authority_and_reference_ids_preserve_u64_precision() {
        assert!(serde_json::from_value::<ReviewRequest>(json!({"companyId":"2","revision":1,"reviewKind":"source_fidelity","outcome":"accepted","verified":true})).is_err());
        assert_eq!(
            ids(&["9007199254740993".into()]).unwrap(),
            vec![9_007_199_254_740_993]
        );
        assert!(ids(&["0".into()]).is_err());
    }
}

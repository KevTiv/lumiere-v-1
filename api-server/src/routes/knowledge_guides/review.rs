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
    let versions = state.stdb.query_sql(&format!("SELECT id, title, body, create_uid, review_state, review_epoch, applicability FROM ai_knowledge_entry_version WHERE organization_id = {org} AND company_id = {company} AND entry_id = {entry_id} LIMIT 2")).await.map_err(ApiError::internal)?;
    let [candidate] = versions.as_slice() else {
        return Ok(json!({"state":"conflict","verified":false}));
    };
    let candidate_id = u64_value(candidate, "id")
        .ok_or_else(|| ApiError::Internal("invalid guide review version".into()))?;
    let reviews = state.stdb.query_sql(&format!("SELECT id, review_kind, outcome, review_epoch, reviewer_uid FROM ai_knowledge_review WHERE organization_id = {org} AND company_id = {company} AND version_id = {candidate_id} LIMIT 201")).await.map_err(ApiError::internal)?;
    let dependencies = state.stdb.query_sql(&format!("SELECT requirement, state, acknowledged_by FROM ai_evidence_dependency WHERE organization_id = {org} AND company_id = {company} AND dependent_kind = 'knowledge_version' AND dependent_id = {candidate_id} LIMIT 201")).await.map_err(ApiError::internal)?;
    let verified = verification_allowed(head, rev, entry, candidate, &reviews, &dependencies);
    let current_reviews: Vec<Value> = ["source_fidelity", "domain_interpretation", "implementation"].into_iter().filter_map(|kind| {
        reviews.iter().filter(|row| string(row,"review_kind") == Some(kind) && u64_value(row,"review_epoch") == u64_value(candidate,"review_epoch")).max_by_key(|row|u64_value(row,"id").unwrap_or(0)).map(|row|json!({"kind":kind,"outcome":field(row,"outcome"),"reviewer":field(row,"reviewer_uid")}))
    }).collect();
    Ok(
        json!({"state":string(candidate,"review_state").unwrap_or("candidate"),"verified":verified,"entryId":entry_id.to_string(),"versionId":candidate_id.to_string(),"reviewEpoch":u64_value(candidate,"review_epoch"),"canNominate":false,"canReview":can_review,"reviews":current_reviews}),
    )
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
    dispatch_session_reducer(&state,&session,"review_ai_knowledge_entry_version",json!([ctx.organization_id(),company,positive_id(version_id)?,{"review_kind":body.review_kind,"outcome":body.outcome,"note":body.note}])).await?;
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

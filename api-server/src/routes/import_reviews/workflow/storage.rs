use serde_json::{json, Value};
use tokio_postgres::{Row, Transaction};

use super::super::StorageScope;
use super::model::*;
use crate::error::ApiError;

const COLUMNS: &str = "id,request_key,revision,proposal_sha256,definition_json,state,execution_json,verification_json,last_error,created_at::text,approved_at::text";

pub(super) struct SavedProposal {
    pub id: i64,
    pub request_key: String,
    pub revision: i32,
    pub digest: String,
    pub definition: Definition,
    pub state: String,
    pub execution: Execution,
    pub result: Option<VerifiedResult>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub approved_at: Option<String>,
}

impl SavedProposal {
    fn from_row(row: &Row) -> Result<Self, ApiError> {
        Ok(Self {
            id: row.get("id"),
            request_key: row.get("request_key"),
            revision: row.get("revision"),
            digest: row.get("proposal_sha256"),
            definition: serde_json::from_value(row.get("definition_json"))
                .map_err(ApiError::internal)?,
            state: row.get("state"),
            execution: serde_json::from_value(row.get("execution_json"))
                .map_err(ApiError::internal)?,
            result: row
                .get::<_, Option<Value>>("verification_json")
                .map(serde_json::from_value)
                .transpose()
                .map_err(ApiError::internal)?,
            last_error: row.get("last_error"),
            created_at: row.get("created_at"),
            approved_at: row.get("approved_at"),
        })
    }

    pub fn view(&self) -> Value {
        json!({"id":self.id.to_string(),"requestKey":self.request_key,"revision":self.revision,"digest":self.digest,
            "kind":self.definition.kind,"status":self.state,"createdAt":self.created_at,"approvedAt":self.approved_at,
            "summary":self.definition.summary,"sources":self.definition.sources,"entries":self.definition.entries,
            "issues":self.definition.issues,"configuration":self.definition.configuration,"execution":self.execution,
            "result":self.result,"lastError":self.last_error})
    }

    pub fn require_approval(&self, body: &ActionBody, company: u64) -> Result<(), ApiError> {
        if body.company_id != company
            || body.expected_revision != self.revision
            || body.expected_digest != self.digest
        {
            return Err(ApiError::Conflict(
                "the import proposal changed; reload and review its current effects".into(),
            ));
        }
        Ok(())
    }
}

pub(super) async fn require_task(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    preparing: bool,
) -> Result<(), ApiError> {
    if !request_key(task) {
        return Err(ApiError::BadRequest("invalid import task identity".into()));
    }
    let row = tx.query_opt("SELECT state,approved_mode FROM lumiere_platform.import_task WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4", &[&scope.organization.to_string(), &scope.company.to_string(), &scope.actor, &task]).await.map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::NotFound("import task not found".into()))?;
    if preparing
        && (row.get::<_, String>("state") != "needs_review"
            || row.get::<_, Option<String>>("approved_mode").as_deref() != Some("prepare_import"))
    {
        return Err(ApiError::Conflict(
            "prepare the saved files for import review before creating ERP proposals".into(),
        ));
    }
    Ok(())
}

pub(super) async fn list(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
) -> Result<Vec<Value>, ApiError> {
    require_task(tx, scope, task, false).await?;
    let rows = tx.query(&format!("SELECT {COLUMNS} FROM lumiere_platform.import_workflow_proposal WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND task_request_id=$4 ORDER BY id DESC LIMIT 100"), &[&scope.organization.to_string(), &scope.company.to_string(), &scope.actor, &task]).await.map_err(ApiError::internal)?;
    rows.iter()
        .map(|row| SavedProposal::from_row(row).map(|proposal| proposal.view()))
        .collect()
}

pub(super) async fn load(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    proposal: i64,
) -> Result<SavedProposal, ApiError> {
    let row = tx.query_opt(&format!("SELECT {COLUMNS} FROM lumiere_platform.import_workflow_proposal WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND task_request_id=$4 AND id=$5 FOR UPDATE"), &[&scope.organization.to_string(), &scope.company.to_string(), &scope.actor, &task, &proposal]).await.map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::NotFound("import proposal not found".into()))?;
    SavedProposal::from_row(&row)
}

pub(super) async fn replay(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    request: &str,
    request_hash: &str,
) -> Result<Option<SavedProposal>, ApiError> {
    let row = tx.query_opt(&format!("SELECT {COLUMNS},company_id::text,task_request_id,request_sha256 FROM lumiere_platform.import_workflow_proposal WHERE organization_id=$1::text::numeric AND actor_identity=$2 AND request_key=$3"), &[&scope.organization.to_string(), &scope.actor, &request]).await.map_err(ApiError::internal)?;
    let Some(row) = row else { return Ok(None) };
    if row.get::<_, String>("company_id") != scope.company.to_string()
        || row.get::<_, String>("task_request_id") != task
        || row.get::<_, String>("request_sha256") != request_hash
    {
        return Err(ApiError::Conflict(
            "this proposal request belongs to different sources, scope or accounting choices"
                .into(),
        ));
    }
    SavedProposal::from_row(&row).map(Some)
}

pub(super) async fn read_request(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    request: &str,
) -> Result<SavedProposal, ApiError> {
    if !request_key(request) {
        return Err(ApiError::BadRequest(
            "invalid proposal request identity".into(),
        ));
    }
    require_task(tx, scope, task, false).await?;
    let row = tx.query_opt(&format!("SELECT {COLUMNS} FROM lumiere_platform.import_workflow_proposal WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND task_request_id=$4 AND request_key=$5"), &[&scope.organization.to_string(),&scope.company.to_string(),&scope.actor,&task,&request]).await.map_err(ApiError::internal)?
        .ok_or_else(||ApiError::NotFound("import proposal request not found".into()))?;
    SavedProposal::from_row(&row)
}

pub(super) async fn reviews(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    selected: &[RowSelection],
) -> Result<Vec<ReviewedRow>, ApiError> {
    let ids = selected
        .iter()
        .map(|row| {
            positive_id(&row.item_id).and_then(|id| {
                i64::try_from(id)
                    .map_err(|_| ApiError::BadRequest("review item ID is too large".into()))
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let rows = tx.query("SELECT item.id,item.batch_id,item.revision,item.state,item.source_json,item.proposed_json,item.confirmed_fields,batch.target_entity FROM lumiere_platform.import_review_item item JOIN lumiere_platform.import_review_batch batch ON batch.organization_id=item.organization_id AND batch.company_id=item.company_id AND batch.id=item.batch_id JOIN lumiere_platform.import_task_review link ON link.organization_id=batch.organization_id AND link.company_id=batch.company_id AND link.batch_id=batch.id WHERE item.organization_id=$1::text::numeric AND item.company_id=$2::text::numeric AND link.actor_identity=$3 AND link.request_id=$4 AND item.id=ANY($5::bigint[]) ORDER BY item.id FOR SHARE OF item", &[&scope.organization.to_string(), &scope.company.to_string(), &scope.actor, &task, &ids]).await.map_err(ApiError::internal)?;
    if rows.len() != selected.len() {
        return Err(ApiError::Conflict(
            "selected source rows do not belong to this saved import task".into(),
        ));
    }
    rows.iter()
        .map(|row| {
            let id = row.get::<_, i64>("id");
            let revision = row.get::<_, i32>("revision");
            if !selected
                .iter()
                .any(|value| value.item_id == id.to_string() && value.expected_revision == revision)
            {
                return Err(ApiError::Conflict(
                    "source facts changed after preview; prepare a new proposal".into(),
                ));
            }
            Ok(ReviewedRow {
                id,
                batch: row.get("batch_id"),
                revision,
                state: row.get("state"),
                target: row.get("target_entity"),
                source: serde_json::from_value(row.get("source_json"))
                    .map_err(ApiError::internal)?,
                values: serde_json::from_value(row.get("proposed_json"))
                    .map_err(ApiError::internal)?,
                confirmed: serde_json::from_value(row.get("confirmed_fields"))
                    .map_err(ApiError::internal)?,
            })
        })
        .collect()
}

pub(super) async fn insert(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    body: &PrepareBody,
    request_hash: &str,
    definition: &Definition,
) -> Result<SavedProposal, ApiError> {
    let definition_json = serde_json::to_value(definition).map_err(ApiError::internal)?;
    let digest = hash(&serde_json::to_vec(&json!({"organizationId":scope.organization.to_string(),"companyId":scope.company.to_string(),"actor":scope.actor,"task":task,"definition":definition_json})).map_err(ApiError::internal)?);
    let state = if definition.entries.is_empty() {
        "blocked"
    } else {
        "prepared"
    };
    let execution = serde_json::to_value(Execution::default()).map_err(ApiError::internal)?;
    let inserted = tx.query_opt("INSERT INTO lumiere_platform.import_workflow_proposal (organization_id,company_id,actor_identity,task_request_id,request_key,request_sha256,proposal_sha256,definition_json,state,execution_json) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id", &[&scope.organization.to_string(), &scope.company.to_string(), &scope.actor, &task, &body.request_key, &request_hash, &digest, &definition_json, &state, &execution]).await.map_err(ApiError::internal)?;
    match inserted {
        Some(row) => load(tx, scope, task, row.get("id")).await,
        None => replay(tx, scope, task, &body.request_key, request_hash)
            .await?
            .ok_or_else(|| {
                ApiError::Conflict("proposal creation changed; retry the same request".into())
            }),
    }
}

pub(super) async fn validate_sources(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    proposal: &SavedProposal,
    currency_decimals: u8,
) -> Result<(), ApiError> {
    let selected = proposal
        .definition
        .sources
        .iter()
        .map(|source| RowSelection {
            item_id: source.item_id.clone(),
            expected_revision: source.revision,
        })
        .collect::<Vec<_>>();
    let current = reviews(tx, scope, task, &selected).await?;
    let mut definition = build_definition(
        &current,
        &proposal.definition.configuration,
        currency_decimals,
    )?;
    super::overlap::hold_candidates(tx, scope, &mut definition, Some(proposal.id)).await?;
    if serde_json::to_value(&definition).map_err(ApiError::internal)?
        != serde_json::to_value(&proposal.definition).map_err(ApiError::internal)?
    {
        return Err(ApiError::Conflict(
            "confirmed facts or reference precision changed; prepare a new proposal".into(),
        ));
    }
    Ok(())
}

/// Approval already reserved these source effects against the then-current
/// candidate set. Later explicitly distinguished approvals do not revoke that
/// proof. Recheck and lock only the executable entries: held rows remain
/// independently reviewable after approval. The full preview and accepted
/// distinction evidence stay immutable; executing source facts and reference
/// precision still must match before writing.
pub(super) async fn validate_approved_sources(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    proposal: &SavedProposal,
    currency_decimals: u8,
) -> Result<(), ApiError> {
    let selected = proposal
        .definition
        .entries
        .iter()
        .map(|entry| RowSelection {
            item_id: entry.item_id.clone(),
            expected_revision: entry.source_revision,
        })
        .collect::<Vec<_>>();
    let rows = reviews(tx, scope, task, &selected).await?;
    let current = build_definition(&rows, &proposal.definition.configuration, currency_decimals)?;
    for approved in &proposal.definition.entries {
        let matched = current
            .entries
            .iter()
            .find(|entry| entry.item_id == approved.item_id)
            .map(serde_json::to_value)
            .transpose()
            .map_err(ApiError::internal)?;
        if matched.as_ref() != Some(&serde_json::to_value(approved).map_err(ApiError::internal)?) {
            return Err(ApiError::Conflict("approved source facts or reference precision changed; inspect the saved receipts before preparing another proposal".into()));
        }
    }
    Ok(())
}

pub(super) async fn claim_sources(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    proposal: &SavedProposal,
) -> Result<(), ApiError> {
    for entry in &proposal.definition.entries {
        let item = entry.item_id.parse::<i64>().map_err(ApiError::internal)?;
        let key = claim_key(entry);
        tx.execute("INSERT INTO lumiere_platform.import_workflow_source_claim (organization_id,company_id,effect_kind,source_key,proposal_id,item_id,source_revision,posting_date,business_date_from,business_date_to,amount,currency_id,external_reference) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8::text::date,$9::text::date,$10::text::date,$11::text::numeric,$12::text::numeric,$13) ON CONFLICT DO NOTHING", &[&scope.organization.to_string(), &scope.company.to_string(), &KIND, &key, &proposal.id, &item, &entry.source_revision,&entry.date,&entry.business_identity.date_from,&entry.business_identity.date_to_exclusive,&entry.amount,&proposal.definition.configuration.currency_id,&entry.business_identity.external_reference]).await.map_err(ApiError::internal)?;
        let row = tx.query_opt("SELECT proposal_id,item_id,source_revision FROM lumiere_platform.import_workflow_source_claim WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND effect_kind=$3 AND source_key=$4 AND released_at IS NULL FOR UPDATE", &[&scope.organization.to_string(), &scope.company.to_string(), &KIND, &key]).await.map_err(ApiError::internal)?;
        if !row.is_some_and(|row| {
            row.get::<_, i64>("proposal_id") == proposal.id
                && row.get::<_, i64>("item_id") == item
                && row.get::<_, i32>("source_revision") == entry.source_revision
        }) {
            return Err(ApiError::Conflict("another approved import already owns an expense in this group; inspect its result before importing again".into()));
        }
    }
    Ok(())
}

pub(super) async fn require_claims(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    proposal: &SavedProposal,
) -> Result<(), ApiError> {
    let row = tx.query_one("SELECT count(*)::bigint AS count FROM lumiere_platform.import_workflow_source_claim WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND proposal_id=$3 AND released_at IS NULL", &[&scope.organization.to_string(), &scope.company.to_string(), &proposal.id]).await.map_err(ApiError::internal)?;
    if row.get::<_, i64>("count") as usize != proposal.definition.entries.len() {
        return Err(ApiError::Conflict(
            "this import's source claims were released or changed; prepare a new proposal".into(),
        ));
    }
    Ok(())
}

pub(super) async fn approve(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    task: &str,
    proposal: &mut SavedProposal,
    currency_decimals: u8,
) -> Result<(), ApiError> {
    if proposal.state != "prepared" || proposal.definition.entries.is_empty() {
        return Err(ApiError::Conflict(
            "only a prepared group with ready records can be approved".into(),
        ));
    }
    super::overlap::lock_company(tx, scope).await?;
    validate_sources(tx, scope, task, proposal, currency_decimals).await?;
    claim_sources(tx, scope, proposal).await?;
    let row = tx.query_one("UPDATE lumiere_platform.import_workflow_proposal SET state='approved',approved_at=now(),last_error=NULL WHERE id=$1 RETURNING approved_at::text", &[&proposal.id]).await.map_err(ApiError::internal)?;
    proposal.approved_at = Some(row.get("approved_at"));
    proposal.state = "approved".into();
    proposal.last_error = None;
    Ok(())
}

pub(super) async fn save_progress(
    tx: &Transaction<'_>,
    proposal: &SavedProposal,
) -> Result<(), ApiError> {
    let execution = serde_json::to_value(&proposal.execution).map_err(ApiError::internal)?;
    let result = proposal
        .result
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(ApiError::internal)?;
    tx.execute("UPDATE lumiere_platform.import_workflow_proposal SET state=$2,execution_json=$3,verification_json=$4,last_error=$5,verified_at=CASE WHEN $4::jsonb IS NULL THEN NULL ELSE now() END WHERE id=$1", &[&proposal.id, &proposal.state, &execution, &result, &proposal.last_error]).await.map_err(ApiError::internal)?;
    Ok(())
}

pub(super) async fn record_receipt(
    tx: &Transaction<'_>,
    scope: StorageScope<'_>,
    proposal: i64,
    phase: &str,
    request: &str,
    content_hash: &str,
    receipt: &Value,
) -> Result<(), ApiError> {
    tx.execute("INSERT INTO lumiere_platform.import_workflow_receipt (organization_id,company_id,proposal_id,phase,request_id,content_sha256,receipt_json) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", &[&scope.organization.to_string(), &scope.company.to_string(), &proposal, &phase, &request, &content_hash, &receipt]).await.map_err(ApiError::internal)?;
    let row = tx.query_one("SELECT request_id,content_sha256,receipt_json FROM lumiere_platform.import_workflow_receipt WHERE proposal_id=$1 AND phase=$2", &[&proposal, &phase]).await.map_err(ApiError::internal)?;
    // Inspection metadata can be absent on a recovered response. Bind stable
    // native receipt identity, not presentation-only fields.
    let saved: Value = row.get("receipt_json");
    if row.get::<_, String>("request_id") != request
        || row.get::<_, String>("content_sha256") != content_hash
        || saved["jobId"] != receipt["jobId"]
    {
        return Err(ApiError::Conflict(
            "native import receipt identity changed".into(),
        ));
    }
    Ok(())
}

pub(super) async fn release_empty_claims(
    tx: &Transaction<'_>,
    proposal: i64,
) -> Result<(), ApiError> {
    tx.execute("UPDATE lumiere_platform.import_workflow_source_claim SET released_at=now() WHERE proposal_id=$1 AND released_at IS NULL", &[&proposal]).await.map_err(ApiError::internal)?;
    Ok(())
}

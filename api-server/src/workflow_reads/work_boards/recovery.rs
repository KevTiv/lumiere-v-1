//! Current management authority and immutable evidence for an explicit retry.
//! Cancellation history remains on the old task; a retry creates a linked task.

use super::*;
use lumiere_contracts::bindings::GuardedActionKey;
use std::collections::HashSet;
use stdb_auth::permission_allowed;

const MAX_BANK_LINES: usize = 512;
const LINK_COLUMNS: &str = "previous_task_id, scope_key, organization_id, company_id, \
expected_task_revision, expected_instance_revision, expected_subject_revision_hash, \
result_task_revision, event_id, successor_task_id, successor_instance_id, \
successor_task_revision, successor_instance_revision, idempotency_key, input_hash, created_by";

#[derive(Default)]
enum BankLinks {
    #[default]
    Unloaded,
    Complete(HashSet<u64>),
    Incomplete,
}

#[derive(Default)]
pub(super) struct RecoveryCache {
    bank_links: BankLinks,
}

/// Management uses the actual actor's grants. The caller already passed the
/// board's current candidate/claim/delegation visibility and source-record read.
/// A delegated principal cannot lend these recovery permissions to the actor.
pub(super) fn has_authority(row: &Value, access: &FieldAccessContext) -> bool {
    if number(row, "organizationId", "organization_id") != Some(access.organization_id)
        || !permission_allowed(access, "workflow_instance", "create")
        || !permission_allowed(access, "workflow_task", "write")
        || source_for(row, WorkScope::Finance, access).is_none()
    {
        return false;
    }
    let Some(action) = guarded_actions::guarded_action(row) else {
        return false;
    };
    match (
        cell(row, "subjectModel", "subject_model").and_then(Value::as_str),
        action.key,
    ) {
        (
            Some("purchase_order"),
            GuardedActionKey::SendPurchaseOrder | GuardedActionKey::ConfirmPurchaseOrder,
        ) => permission_allowed(access, "purchase_order", "write"),
        (Some("account_payment"), GuardedActionKey::PostPayment) => {
            permission_allowed(access, "payment", "post")
        }
        _ => false,
    }
}

pub(super) async fn available(
    row: &Value,
    source: &Value,
    instances: &[Value],
    projection: &ProjectionContext<'_>,
    cache: &mut RecoveryCache,
) -> Result<bool, ApiError> {
    if !has_authority(row, projection.access)
        || enum_tag(row, "status").as_deref() != Some("Cancelled")
        || !instances.iter().any(|instance| {
            number(instance, "id", "id")
                == number(row, "workflowInstanceId", "workflow_instance_id")
                && enum_tag(instance, "state").as_deref() == Some("Cancelled")
        })
    {
        return Ok(false);
    }
    let Some(task) = number(row, "id", "id").filter(|id| *id > 0) else {
        return Ok(false);
    };
    let Some(subject) = number(row, "subjectId", "subject_id").filter(|id| *id > 0) else {
        return Ok(false);
    };
    let model = cell(row, "subjectModel", "subject_model").and_then(Value::as_str);
    let state = enum_tag(source, "state");
    let Some(action) = guarded_actions::guarded_action(row) else {
        return Ok(false);
    };
    if !source_state_permits(&action.key, state.as_deref()) {
        return Ok(false);
    }
    let org = projection.org;
    let company = projection.company;
    let existing = projection.owner.query_sql(&format!(
        "SELECT previous_task_id FROM workflow_human_task_resubmission WHERE organization_id = {org} AND company_id = {company} AND previous_task_id = {task} LIMIT 1"
    )).await.map_err(ApiError::internal)?;
    if !existing.is_empty() {
        return Ok(false);
    }
    if model == Some("account_payment") {
        let settlement = projection.owner.query_sql(&format!(
            "SELECT payment_id FROM bank_statement_settlement_attempt WHERE organization_id = {org} AND payment_id = {subject} LIMIT 1"
        )).await.map_err(ApiError::internal)?;
        if !settlement.is_empty() {
            return Ok(false);
        }
        if matches!(cache.bank_links, BankLinks::Unloaded) {
            // Unordered LIMIT is sufficient only when the entire set fits.
            // Cache it per board request; an incomplete/malformed set cannot
            // certify an ordinary payment or expose a misleading action.
            let lines = projection.owner.query_sql(&format!(
                "SELECT payment_ids FROM account_bank_statement_line WHERE organization_id = {org} LIMIT {}",
                MAX_BANK_LINES + 1,
            )).await.map_err(ApiError::internal)?;
            cache.bank_links = complete_bank_links(&lines)
                .map(BankLinks::Complete)
                .unwrap_or(BankLinks::Incomplete);
        }
        return Ok(
            matches!(&cache.bank_links, BankLinks::Complete(ids) if !ids.contains(&subject)),
        );
    }
    Ok(true)
}

fn source_state_permits(action: &GuardedActionKey, state: Option<&str>) -> bool {
    matches!(
        (action, state),
        (GuardedActionKey::SendPurchaseOrder, Some("Draft"))
            | (
                GuardedActionKey::ConfirmPurchaseOrder,
                Some("Draft" | "Sent" | "ToApprove")
            )
            | (GuardedActionKey::PostPayment, Some("NotPaid"))
    )
}

fn complete_bank_links(lines: &[Value]) -> Option<HashSet<u64>> {
    if lines.len() > MAX_BANK_LINES {
        return None;
    }
    let mut ids = HashSet::new();
    for line in lines {
        for value in cell(line, "paymentIds", "payment_ids")?.as_array()? {
            let id = value
                .as_u64()
                .or_else(|| value.as_str().and_then(decimal_id))?;
            if id == 0 {
                return None;
            }
            ids.insert(id);
        }
    }
    Some(ids)
}

pub(super) async fn read_linked_evidence(
    row: &Value,
    evidence: Value,
    projection: &ProjectionContext<'_>,
) -> Result<Option<Value>, ApiError> {
    let (Some(task), Some(key), Some(hash)) = (
        number(&evidence, "taskId", "task_id"),
        evidence.get("idempotencyKey").and_then(Value::as_str),
        evidence.get("inputHash").and_then(Value::as_str),
    ) else {
        return Ok(None);
    };
    let org = projection.org;
    let company = projection.company;
    let actor = identity_sql_literal(projection.caller).map_err(ApiError::Internal)?;
    let scope_key = readback::sql_text(&format!("{org}:{company}:{}:{key}", key.len()));
    let input_hash = readback::sql_text(hash);
    let links = projection.owner.query_sql(&format!(
        "SELECT {LINK_COLUMNS} FROM workflow_human_task_resubmission WHERE organization_id = {org} AND company_id = {company} AND previous_task_id = {task} AND scope_key = {scope_key} AND created_by = {actor} AND input_hash = {input_hash} LIMIT 2"
    )).await.map_err(ApiError::internal)?;
    let [link] = links.as_slice() else {
        return Ok(None);
    };
    Ok(matching_link(
        row,
        link,
        evidence,
        org,
        company,
        projection.caller,
    ))
}

fn matching_link(
    row: &Value,
    link: &Value,
    mut evidence: Value,
    org: u64,
    company: u64,
    caller: &str,
) -> Option<Value> {
    let task = number(&evidence, "taskId", "task_id")?;
    let key = evidence.get("idempotencyKey")?.as_str()?;
    let hash = evidence.get("inputHash")?.as_str()?;
    let instance = number(&evidence, "workflowInstanceId", "workflow_instance_id")?;
    let prior_instance = number(
        link,
        "expectedInstanceRevision",
        "expected_instance_revision",
    )
    .filter(|id| *id > 0)?;
    let subject_hash = cell(
        link,
        "expectedSubjectRevisionHash",
        "expected_subject_revision_hash",
    )?
    .as_str()?;
    let successor_task =
        number(link, "successorTaskId", "successor_task_id").filter(|id| *id > 0 && *id != task)?;
    let successor_instance = number(link, "successorInstanceId", "successor_instance_id")
        .filter(|id| *id > 0 && *id != instance)?;
    let successor_task_revision =
        number(link, "successorTaskRevision", "successor_task_revision").filter(|id| *id > 0)?;
    let successor_instance_revision = number(
        link,
        "successorInstanceRevision",
        "successor_instance_revision",
    )
    .filter(|id| *id > 0)?;
    if number(link, "organizationId", "organization_id") != Some(org)
        || number(link, "companyId", "company_id") != Some(company)
        || number(link, "previousTaskId", "previous_task_id") != Some(task)
        || number(link, "eventId", "event_id") != number(&evidence, "eventId", "event_id")
        || number(link, "expectedTaskRevision", "expected_task_revision")
            != number(&evidence, "priorRevision", "prior_revision")
        || number(link, "resultTaskRevision", "result_task_revision")
            != number(&evidence, "resultRevision", "result_revision")
        || prior_instance > number(row, "instanceRevision", "instance_revision")?
        || subject_hash.is_empty()
        || cell(row, "subjectRevisionHash", "subject_revision_hash")?.as_str()? != subject_hash
        || cell(link, "scopeKey", "scope_key")?.as_str()?
            != format!("{org}:{company}:{}:{key}", key.len())
        || cell(link, "idempotencyKey", "idempotency_key")?.as_str()? != key
        || cell(link, "inputHash", "input_hash")?.as_str()? != hash
        || identity(link, "createdBy", "created_by").as_deref() != Some(caller)
    {
        return None;
    }
    let output = evidence.as_object_mut()?;
    output.insert(
        "priorInstanceRevision".into(),
        json!(prior_instance.to_string()),
    );
    output.insert("subjectRevisionHash".into(), json!(subject_hash));
    output.insert("successorTaskId".into(), json!(successor_task.to_string()));
    output.insert(
        "successorInstanceId".into(),
        json!(successor_instance.to_string()),
    );
    output.insert(
        "successorTaskRevision".into(),
        json!(successor_task_revision.to_string()),
    );
    output.insert(
        "successorInstanceRevision".into(),
        json!(successor_instance_revision.to_string()),
    );
    Some(evidence)
}

#[cfg(test)]
mod tests;

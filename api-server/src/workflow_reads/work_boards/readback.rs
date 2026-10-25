//! Exact, currently authorized readback of one board task and one command.
//! Private evidence is never listed: an actor must supply the exact command
//! kind, idempotency key, native input hash and delegated principal, if any.

use super::actions::{may_read_command_evidence, WorkAction};
use super::*;

const RECEIPT_COLUMNS: &str = "scope_key, organization_id, company_id, task_id, command_kind, \
idempotency_key, input_hash, result_status, result_revision, created_by";
const EVENT_COLUMNS: &str = "id, organization_id, company_id, workflow_instance_id, task_id, \
command_kind, prior_status, next_status, decision, actor, acting_for, prior_revision, \
next_revision, idempotency_key, input_hash";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CommandKind {
    Claim,
    Decision,
    Resubmit,
}

impl CommandKind {
    fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "claim" => Ok(Self::Claim),
            "decision" => Ok(Self::Decision),
            "resubmit" => Ok(Self::Resubmit),
            _ => Err(ApiError::BadRequest("unsupported commandKind".into())),
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Claim => "claim",
            Self::Decision => "decision",
            Self::Resubmit => "resubmit",
        }
    }

    fn tag(self) -> &'static str {
        match self {
            Self::Claim => "Claim",
            Self::Decision => "Decision",
            Self::Resubmit => "Resubmit",
        }
    }

    fn actions(self) -> &'static [WorkAction] {
        match self {
            Self::Claim => &[WorkAction::Claim],
            Self::Decision => &[
                WorkAction::Approve,
                WorkAction::Reject,
                WorkAction::Complete,
            ],
            Self::Resubmit => &[WorkAction::Resubmit],
        }
    }
}

#[derive(Debug)]
struct CommandAttempt {
    kind: CommandKind,
    idempotency_key: String,
    input_hash: String,
    acting_for: Option<String>,
}

impl CommandAttempt {
    fn scope_key(&self, org: u64, task: u64) -> String {
        format!("{org}:{task}:{}:{}", self.kind.key(), self.idempotency_key)
    }
}

#[derive(Debug)]
pub(crate) struct WorkTaskReadbackRequest {
    task_id: u64,
    attempt: Option<CommandAttempt>,
}

impl WorkTaskReadbackRequest {
    /// Evidence parameters are accepted only for a single module-scoped task.
    /// Existing task-assignee lookups retain their separate `taskId` meaning.
    pub(crate) fn parse(
        resource: &str,
        scope: Option<&str>,
        task_id: Option<u64>,
        command_kind: Option<&str>,
        idempotency_key: Option<&str>,
        input_hash: Option<&str>,
        acting_for: Option<&str>,
    ) -> Result<Option<Self>, ApiError> {
        let has_attempt = command_kind.is_some()
            || idempotency_key.is_some()
            || input_hash.is_some()
            || acting_for.is_some();
        if !has_attempt && (task_id.is_none() || resource == "task-assignees") {
            return Ok(None);
        }
        if resource != "workflow-human-tasks" || scope.is_none() {
            return Err(ApiError::BadRequest(
                "exact workflow task readback requires workflow-human-tasks and workScope".into(),
            ));
        }
        let task_id = task_id.filter(|id| *id > 0).ok_or_else(|| {
            ApiError::BadRequest("taskId is required for command readback".into())
        })?;
        let attempt = if has_attempt {
            let kind = CommandKind::parse(command_kind.ok_or_else(|| {
                ApiError::BadRequest("commandKind is required for command readback".into())
            })?)?;
            let idempotency_key = idempotency_key
                .filter(|key| {
                    !key.trim().is_empty() && key.len() <= 256 && !key.chars().any(char::is_control)
                })
                .ok_or_else(|| ApiError::BadRequest("invalid command idempotencyKey".into()))?;
            let input_hash = input_hash
                .filter(|hash| {
                    hash.strip_prefix("sha256:")
                        .is_some_and(|hex| canonical_hex(hex))
                })
                .ok_or_else(|| ApiError::BadRequest("invalid command inputHash".into()))?;
            if acting_for.is_some_and(|identity| !canonical_hex(identity)) {
                return Err(ApiError::BadRequest(
                    "invalid command actingFor identity".into(),
                ));
            }
            if kind == CommandKind::Resubmit && acting_for.is_some() {
                return Err(ApiError::BadRequest(
                    "resubmission does not accept actingFor".into(),
                ));
            }
            Some(CommandAttempt {
                kind,
                idempotency_key: idempotency_key.into(),
                input_hash: input_hash.into(),
                acting_for: acting_for.map(str::to_owned),
            })
        } else {
            None
        };
        Ok(Some(Self { task_id, attempt }))
    }
}

fn canonical_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn sql_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(super) async fn read_exact_task(
    context: &TrustedOperationContext,
    request: &WorkBoardRequest,
    readback: &WorkTaskReadbackRequest,
    predicate: &str,
    projection: &ProjectionContext<'_>,
    delegated_access: &mut HashMap<String, Option<FieldAccessContext>>,
    recovery_cache: &mut recovery::RecoveryCache,
) -> Result<WorkBoardPage, ApiError> {
    let candidates = projection
        .owner
        .query_sql(&format!(
            "SELECT {BOARD_COLUMNS} FROM workflow_human_task WHERE {predicate} AND id = {} LIMIT 2",
            readback.task_id
        ))
        .await
        .map_err(ApiError::internal)?;
    if candidates.len() > 1 {
        return Err(ApiError::Internal(
            "exact work task read was not unique".into(),
        ));
    }
    let Some(row) = candidates.into_iter().next() else {
        return Ok(WorkBoardPage::default());
    };
    if number(&row, "id", "id") != Some(readback.task_id)
        || !visible_row(
            &row,
            request,
            projection.org,
            projection.caller,
            projection.scope,
        )
    {
        return Ok(WorkBoardPage::default());
    }
    let Some((source, source_row)) =
        read_board_source(context, &row, request.scope, projection.company).await?
    else {
        return Ok(WorkBoardPage::default());
    };
    let recovery_authorized = recovery::has_authority(&row, projection.access);
    let mut row = project_board_row(
        row,
        &source_row,
        source,
        projection,
        delegated_access,
        recovery_cache,
    )
    .await?;
    let teams = team_refs(&row, projection.scope, projection.company);
    if let Some(object) = row.as_object_mut() {
        object.insert("workTeamRefs".into(), Value::Array(teams));
    }
    let command_evidence = match &readback.attempt {
        Some(attempt) => {
            read_command_evidence(
                &row,
                readback.task_id,
                attempt,
                projection,
                delegated_access,
                recovery_authorized,
            )
            .await?
        }
        None => None,
    };
    Ok(WorkBoardPage {
        rows: vec![row],
        next_cursor: None,
        command_evidence,
    })
}

async fn read_command_evidence(
    row: &Value,
    task: u64,
    attempt: &CommandAttempt,
    projection: &ProjectionContext<'_>,
    delegated_access: &HashMap<String, Option<FieldAccessContext>>,
    recovery_authorized: bool,
) -> Result<Option<Value>, ApiError> {
    let principal = attempt.acting_for.as_deref().unwrap_or(projection.caller);
    let (access, eligible) = if attempt.acting_for.is_none() {
        (
            Some(projection.access),
            projection.scope.directly_eligible(row),
        )
    } else {
        let access = delegated_access.get(principal).and_then(Option::as_ref);
        let eligible = access.is_some_and(|access| {
            projection
                .scope
                .delegated_action_eligible(row, principal, &access.role_ids)
        });
        (access, eligible)
    };
    let authority = ActionContext {
        caller: projection.caller,
        principal,
        eligible,
        access,
        actor_has_sod_conflict: projection.actor_conflict,
        sod_rules: projection.sod_rules,
        // A recorded AllCandidates vote remains readable with current
        // authorization even though it is no longer an available action.
        unvoted_candidates: &[],
    };
    let authorized = if attempt.kind == CommandKind::Resubmit {
        recovery_authorized
    } else {
        attempt
            .kind
            .actions()
            .iter()
            .any(|action| may_read_command_evidence(row, &authority, *action))
    };
    if !authorized {
        return Ok(None);
    }
    let org = projection.org;
    let company = projection.company;
    let actor = identity_sql_literal(projection.caller).map_err(ApiError::Internal)?;
    let scope_key = sql_text(&attempt.scope_key(org, task));
    let key = sql_text(&attempt.idempotency_key);
    let hash = sql_text(&attempt.input_hash);
    let receipts = projection.owner.query_sql(&format!(
        "SELECT {RECEIPT_COLUMNS} FROM workflow_human_task_receipt WHERE organization_id = {org} AND company_id = {company} AND task_id = {task} AND scope_key = {scope_key} AND created_by = {actor} AND input_hash = {hash} LIMIT 2"
    )).await.map_err(ApiError::internal)?;
    let [receipt] = receipts.as_slice() else {
        return Ok(None);
    };
    let events = projection.owner.query_sql(&format!(
        "SELECT {EVENT_COLUMNS} FROM workflow_human_task_event WHERE organization_id = {org} AND company_id = {company} AND task_id = {task} AND idempotency_key = {key} AND input_hash = {hash} AND actor = {actor} LIMIT 2"
    )).await.map_err(ApiError::internal)?;
    let [event] = events.as_slice() else {
        return Ok(None);
    };
    let Some((evidence, action)) = matching_evidence(
        row,
        receipt,
        event,
        attempt,
        org,
        company,
        task,
        projection.caller,
    ) else {
        return Ok(None);
    };
    if action == WorkAction::Resubmit {
        return recovery::read_linked_evidence(row, evidence, projection).await;
    }
    Ok(may_read_command_evidence(row, &authority, action).then_some(evidence))
}

#[allow(clippy::too_many_arguments)]
fn matching_evidence(
    row: &Value,
    receipt: &Value,
    event: &Value,
    attempt: &CommandAttempt,
    org: u64,
    company: u64,
    task: u64,
    caller: &str,
) -> Option<(Value, WorkAction)> {
    if number(row, "organizationId", "organization_id") != Some(org)
        || number(row, "companyId", "company_id") != Some(company)
        || number(row, "id", "id") != Some(task)
    {
        return None;
    }
    for record in [receipt, event] {
        if number(record, "organizationId", "organization_id") != Some(org)
            || number(record, "companyId", "company_id") != Some(company)
            || number(record, "taskId", "task_id") != Some(task)
            || enum_tag(record, "commandKind").as_deref() != Some(attempt.kind.tag())
            || cell(record, "idempotencyKey", "idempotency_key")?.as_str()?
                != attempt.idempotency_key
            || cell(record, "inputHash", "input_hash")?.as_str()? != attempt.input_hash
        {
            return None;
        }
    }
    if cell(receipt, "scopeKey", "scope_key")?.as_str()? != attempt.scope_key(org, task)
        || identity(receipt, "createdBy", "created_by").as_deref() != Some(caller)
        || identity(event, "actor", "actor").as_deref() != Some(caller)
    {
        return None;
    }
    let acting_for = if cell(event, "actingFor", "acting_for")?.is_null() {
        None
    } else {
        Some(identity(event, "actingFor", "acting_for")?)
    };
    if acting_for != attempt.acting_for {
        return None;
    }
    let instance =
        number(row, "workflowInstanceId", "workflow_instance_id").filter(|id| *id > 0)?;
    let event_id = number(event, "id", "id").filter(|id| *id > 0)?;
    let prior = number(event, "priorRevision", "prior_revision").filter(|id| *id > 0)?;
    let result = number(receipt, "resultRevision", "result_revision")?;
    let status = enum_tag(receipt, "resultStatus")?;
    if number(event, "workflowInstanceId", "workflow_instance_id") != Some(instance)
        || prior.checked_add(1) != Some(result)
        || number(event, "nextRevision", "next_revision") != Some(result)
        || result > number(row, "revision", "revision")?
        || enum_tag(event, "nextStatus").as_deref() != Some(status.as_str())
    {
        return None;
    }
    let prior_status = enum_tag(event, "priorStatus")?;
    let (decision, action) = match attempt.kind {
        CommandKind::Claim
            if status == "Claimed"
                && prior_status == "Open"
                && cell(event, "decision", "decision")?.is_null() =>
        {
            (None, WorkAction::Claim)
        }
        CommandKind::Decision if matches!(prior_status.as_str(), "Open" | "Claimed") => {
            let decision = enum_tag(event, "decision")?;
            let partial =
                status == "Open" && enum_tag(row, "assignment").as_deref() == Some("AllCandidates");
            match decision.as_str() {
                "Approve" if status == "Approved" || partial => {
                    (Some("approve"), WorkAction::Approve)
                }
                "Reject" if status == "Rejected" => (Some("reject"), WorkAction::Reject),
                "Complete" if status == "Completed" || partial => {
                    (Some("complete"), WorkAction::Complete)
                }
                _ => return None,
            }
        }
        CommandKind::Resubmit
            if status == "Cancelled"
                && prior_status == "Cancelled"
                && enum_tag(row, "status").as_deref() == Some("Cancelled")
                && cell(event, "decision", "decision")?.is_null() =>
        {
            (None, WorkAction::Resubmit)
        }
        _ => return None,
    };
    Some((
        json!({
            "organizationId": org.to_string(),
            "companyId": company.to_string(),
            "taskId": task.to_string(),
            "workflowInstanceId": instance.to_string(),
            "eventId": event_id.to_string(),
            "commandKind": attempt.kind.key(),
            "idempotencyKey": attempt.idempotency_key,
            "inputHash": attempt.input_hash,
            "actorIdentityHex": caller,
            "actingForIdentityHex": acting_for,
            "decision": decision,
            "priorRevision": prior.to_string(),
            "resultRevision": result.to_string(),
            "resultStatus": status,
        }),
        action,
    ))
}

#[cfg(test)]
mod tests;

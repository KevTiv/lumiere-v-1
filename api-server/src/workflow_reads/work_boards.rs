//! Module-scoped views over canonical workflow human tasks.
//!
//! Detailed owner-token reads use complete, bounded ID windows: HTTP SQL has no
//! ordered LIMIT, so applying LIMIT before sorting would skip rows. Every card
//! additionally requires an actor-authorized, field-projected source read.

mod actions;
mod guarded_actions;
#[cfg(test)]
mod http_tests;
mod readback;

pub(crate) use readback::WorkTaskReadbackRequest;

use super::bounded_windows::{BoundedIdReader, ID_WINDOW};
use super::candidate_scope::CandidateScope;
use super::{allowed_company_ids, enum_tag, project_human_task, u64_list_field};
use crate::auth_password::identity_cell_to_hex;
use crate::error::ApiError;
use crate::query_exec::{execute_authorized_resource_record, resolve_membership_company_id};
use crate::session::{load_field_access_context, normalize_identity_hex_for_sql};
use crate::trusted_context::TrustedOperationContext;
use actions::{has_sod_conflict, work_actions, ActionContext};
use serde_json::{json, Value};
use std::collections::HashMap;
use stdb_auth::{has_resource_read_permission, identity_sql_literal, FieldAccessContext};
use stdb_client::StdbClient;

const MAX_WINDOWS: usize = 4;
const MAX_SOURCE_READS: usize = 100;
const MAX_PAGE_SIZE: u32 = 50;
// No snapshots, guarded-action input, decision comments or free-text metadata.
const BOARD_COLUMNS: &str = "id, organization_id, company_id, workflow_id, workflow_version_id, \
workflow_instance_id, token_id, node_id, node_key, kind, assignment, candidate_role_ids, \
candidate_group_ids, candidate_unit_ids, require_comment_on_reject, subject_model, subject_id, \
condition_revision_hash, subject_revision_hash, guarded_action, status, revision, requested_by, requested_at, \
claimed_by, claimed_at, decided_by, acting_for, decided_at, decision, correlation_id, created_at, updated_at";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkScope {
    Purchasing,
    Sales,
    Accounting,
    Expenses,
    Finance,
}

#[derive(Clone, Copy)]
pub(crate) struct WorkSource {
    pub(crate) model: &'static str,
    pub(crate) resource: &'static str,
    pub(crate) module: &'static str,
}

const SOURCES: &[WorkSource] = &[
    WorkSource {
        model: "purchase_order",
        resource: "purchase-orders",
        module: "purchasing",
    },
    WorkSource {
        model: "sale_order",
        resource: "sale-orders",
        module: "sales",
    },
    WorkSource {
        model: "account_move",
        resource: "account-moves",
        module: "accounting",
    },
    WorkSource {
        model: "account_payment",
        resource: "account-payments",
        module: "accounting",
    },
    WorkSource {
        model: "hr_expense_sheet",
        resource: "expense-sheets",
        module: "expenses",
    },
];

impl WorkScope {
    pub(crate) fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "purchasing" => Ok(Self::Purchasing),
            "sales" => Ok(Self::Sales),
            "accounting" => Ok(Self::Accounting),
            "expenses" => Ok(Self::Expenses),
            "finance" => Ok(Self::Finance),
            _ => Err(ApiError::BadRequest("unsupported workScope".into())),
        }
    }
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::Purchasing => "purchasing",
            Self::Sales => "sales",
            Self::Accounting => "accounting",
            Self::Expenses => "expenses",
            Self::Finance => "finance",
        }
    }
    fn accepts(self, source: &WorkSource) -> bool {
        self == Self::Finance || source.module == self.key()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorkView {
    Eligible,
    Mine,
    Available,
}

impl WorkView {
    fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "eligible" => Ok(Self::Eligible),
            "mine" => Ok(Self::Mine),
            "available" => Ok(Self::Available),
            _ => Err(ApiError::BadRequest("unsupported workView".into())),
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::Eligible => "eligible",
            Self::Mine => "mine",
            Self::Available => "available",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkTeam {
    kind: &'static str,
    id: u64,
}

impl WorkTeam {
    fn parse(raw: &str) -> Result<Self, ApiError> {
        let (kind, id) = raw
            .split_once(':')
            .ok_or_else(|| ApiError::BadRequest("invalid workTeam".into()))?;
        let kind = match kind {
            "department" => "department",
            "workflow-group" => "workflow-group",
            _ => return Err(ApiError::BadRequest("unsupported workTeam kind".into())),
        };
        let id = decimal_id(id)
            .filter(|id| *id > 0)
            .ok_or_else(|| ApiError::BadRequest("invalid workTeam ID".into()))?;
        Ok(Self { kind, id })
    }
    fn key(&self) -> String {
        format!("{}-{}", self.kind, self.id)
    }
    fn matches(&self, row: &Value) -> bool {
        let (camel, snake) = if self.kind == "department" {
            ("candidateUnitIds", "candidate_unit_ids")
        } else {
            ("candidateGroupIds", "candidate_group_ids")
        };
        u64_list_field(row, camel, snake).contains(&self.id)
    }
}

#[derive(Debug)]
pub(crate) struct WorkBoardRequest {
    company_id: u64,
    scope: WorkScope,
    view: WorkView,
    team: Option<WorkTeam>,
    cursor: Option<String>,
    limit: usize,
    readback: Option<WorkTaskReadbackRequest>,
}

impl WorkBoardRequest {
    /// Parse board-only parameters without changing ordinary resource reads.
    pub(crate) fn parse(
        resource: &str,
        company_id: Option<u64>,
        scope: Option<&str>,
        view: Option<&str>,
        team: Option<&str>,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Option<Self>, ApiError> {
        if scope.is_none() && view.is_none() && team.is_none() {
            return Ok(None);
        }
        if resource != "workflow-human-tasks" {
            return Err(ApiError::BadRequest(
                "workScope is only supported for workflow-human-tasks".into(),
            ));
        }
        let scope = WorkScope::parse(
            scope.ok_or_else(|| ApiError::BadRequest("workScope is required".into()))?,
        )?;
        let company_id = company_id
            .filter(|id| *id > 0)
            .ok_or_else(|| ApiError::BadRequest("companyId is required for a work board".into()))?;
        let limit = limit.unwrap_or(MAX_PAGE_SIZE);
        if !(1..=MAX_PAGE_SIZE).contains(&limit) {
            return Err(ApiError::BadRequest(format!(
                "work board limit must be between 1 and {MAX_PAGE_SIZE}"
            )));
        }
        if cursor.is_some_and(|value| value.len() > 256) {
            return Err(ApiError::BadRequest("invalid work board cursor".into()));
        }
        Ok(Some(Self {
            company_id,
            scope,
            view: WorkView::parse(view.unwrap_or("eligible"))?,
            team: team.map(WorkTeam::parse).transpose()?,
            cursor: cursor.map(str::to_owned),
            limit: limit as usize,
            readback: None,
        }))
    }

    /// Exact command readback retains authorization and team scope while
    /// ignoring presentation filters that the command may have changed.
    pub(crate) fn with_readback(
        mut self,
        readback: Option<WorkTaskReadbackRequest>,
    ) -> Result<Self, ApiError> {
        if readback.is_some() && self.cursor.is_some() {
            return Err(ApiError::BadRequest(
                "cursor is not supported for an exact work task read".into(),
            ));
        }
        self.readback = readback;
        Ok(self)
    }

    fn cursor_prefix(&self, organization_id: u64, caller: &str) -> String {
        format!(
            "wb1.{organization_id}.{}.{}.{}.{}.{}.",
            self.company_id,
            self.scope.key(),
            self.view.key(),
            self.team
                .as_ref()
                .map(WorkTeam::key)
                .unwrap_or_else(|| "all".into()),
            caller
        )
    }
    fn after(&self, organization_id: u64, caller: &str) -> Result<u64, ApiError> {
        let Some(cursor) = &self.cursor else {
            return Ok(0);
        };
        cursor
            .strip_prefix(&self.cursor_prefix(organization_id, caller))
            .and_then(decimal_id)
            .ok_or_else(|| ApiError::BadRequest("cursor does not match this work board".into()))
    }
    fn cursor(&self, organization_id: u64, caller: &str, after: u64) -> String {
        format!("{}{after}", self.cursor_prefix(organization_id, caller))
    }
}

#[derive(Default)]
pub(crate) struct WorkBoardPage {
    pub rows: Vec<Value>,
    pub next_cursor: Option<String>,
    pub command_evidence: Option<Value>,
}

fn decimal_id(value: &str) -> Option<u64> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return None;
    }
    value.parse().ok()
}

fn cell<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    row.get(camel).or_else(|| row.get(snake))
}
fn number(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    cell(row, camel, snake).and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_str().and_then(decimal_id))
    })
}
fn identity(row: &Value, camel: &str, snake: &str) -> Option<String> {
    cell(row, camel, snake)
        .and_then(identity_cell_to_hex)
        .map(|value| normalize_identity_hex_for_sql(&value))
}

fn source_for(row: &Value, scope: WorkScope, access: &FieldAccessContext) -> Option<WorkSource> {
    let model = cell(row, "subjectModel", "subject_model")?.as_str()?;
    work_source_for_model(model, scope, access)
}

/// Shared module/source allowlist; reading a source record remains mandatory.
pub(crate) fn work_source_for_model(
    model: &str,
    scope: WorkScope,
    access: &FieldAccessContext,
) -> Option<WorkSource> {
    SOURCES.iter().copied().find(|source| {
        source.model == model
            && scope.accepts(source)
            && has_resource_read_permission(Some(access), source.resource)
    })
}

fn visible_row(
    row: &Value,
    request: &WorkBoardRequest,
    org: u64,
    caller: &str,
    scope: &CandidateScope,
) -> bool {
    if number(row, "organizationId", "organization_id") != Some(org)
        || number(row, "companyId", "company_id") != Some(request.company_id)
        || !scope.can_view_task(row, caller)
        || request.team.as_ref().is_some_and(|team| !team.matches(row))
    {
        return false;
    }
    if request.readback.is_some() {
        return true;
    }
    match request.view {
        WorkView::Eligible => true,
        WorkView::Mine => identity(row, "claimedBy", "claimed_by").as_deref() == Some(caller),
        WorkView::Available => {
            enum_tag(row, "status").as_deref() == Some("Open")
                && cell(row, "claimedBy", "claimed_by").is_some_and(Value::is_null)
                && (scope.directly_eligible(row)
                    || !scope.delegated_options(row, caller).is_empty())
        }
    }
}

fn scope_predicate(org: u64, request: &WorkBoardRequest, sources: &[WorkSource]) -> String {
    let models = sources
        .iter()
        .map(|source| format!("subject_model = '{}'", source.model))
        .collect::<Vec<_>>()
        .join(" OR ");
    format!(
        "organization_id = {org} AND company_id = {} AND ({models})",
        request.company_id
    )
}

/// Return an authorized page, preserving the canonical task/revision shape.
pub(crate) async fn read_work_board(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    request: WorkBoardRequest,
) -> Result<WorkBoardPage, ApiError> {
    let org = context.organization_id();
    let access = context.field_access();
    if access.organization_id != org || !has_resource_read_permission(Some(access), "workflows") {
        return Err(ApiError::Forbidden(
            "work board read permission denied".into(),
        ));
    }
    let company = resolve_membership_company_id(
        context.client(),
        org,
        context.actor_identity(),
        Some(request.company_id),
        "Cannot query another company's work board",
    )
    .await?;
    if company != request.company_id
        || !allowed_company_ids(owner, org, Some(access))
            .await?
            .contains(&company)
    {
        return Err(ApiError::Forbidden(
            "work board company access denied".into(),
        ));
    }
    let caller = normalize_identity_hex_for_sql(context.actor_identity());
    let mut after = request.after(org, &caller)?;
    let scope = CandidateScope::load(owner, org, &caller, Some(access)).await?;
    if request
        .team
        .as_ref()
        .is_some_and(|team| !scope.has_team(company, team.kind, team.id))
    {
        return Err(ApiError::Forbidden(
            "workTeam requires current team membership or delegation".into(),
        ));
    }
    let sources: Vec<_> = SOURCES
        .iter()
        .copied()
        .filter(|source| {
            request.scope.accepts(source)
                && has_resource_read_permission(Some(access), source.resource)
        })
        .collect();
    if sources.is_empty() {
        return Ok(WorkBoardPage::default());
    }
    let predicate = scope_predicate(org, &request, &sources);
    let scan = BoundedIdReader::new(owner, "workflow_human_task", &predicate);
    let sod_rules = owner.query_sql(&format!("SELECT permission_a, permission_b FROM sod_conflict_rule WHERE organization_id = {org} AND is_active = true")).await.map_err(ApiError::internal)?;
    let actor_conflict = has_sod_conflict(access, &sod_rules);
    let projection = ProjectionContext {
        owner,
        org,
        company,
        caller: &caller,
        scope: &scope,
        access,
        actor_conflict,
        sod_rules: &sod_rules,
    };
    let mut delegated_access = HashMap::<String, Option<FieldAccessContext>>::new();
    if let Some(readback) = &request.readback {
        return readback::read_exact_task(
            context,
            &request,
            readback,
            &predicate,
            &projection,
            &mut delegated_access,
        )
        .await;
    }
    let mut rows = Vec::with_capacity(request.limit);
    let mut source_reads = 0;
    let mut seek_probes = 0;

    'windows: for _ in 0..MAX_WINDOWS {
        let Some(witness) = scan.witness(after, None).await? else {
            break;
        };
        scan.seek_window_start(&mut after, witness, &mut seek_probes)
            .await?;
        let end = after.saturating_add(ID_WINDOW);
        let mut candidates = owner
            .query_sql(&scan.window_sql(BOARD_COLUMNS, after, end))
            .await
            .map_err(ApiError::internal)?;
        candidates.sort_by_key(|row| number(row, "id", "id").unwrap_or(0));
        for row in candidates {
            let id = number(&row, "id", "id")
                .ok_or_else(|| ApiError::Internal("work task is missing its ID".into()))?;
            if id <= after || id > end {
                return Err(ApiError::Internal(
                    "work task escaped the bounded ID window".into(),
                ));
            }
            after = id;
            if !visible_row(&row, &request, org, &caller, &scope) {
                continue;
            }
            source_reads += 1;
            if let Some((source, source_row)) =
                read_board_source(context, &row, request.scope, company).await?
            {
                let mut projected =
                    project_board_row(row, &source_row, source, &projection, &mut delegated_access)
                        .await?;
                // Team membership/visibility were checked before any projection.
                let teams = team_refs(&projected, &scope, company);
                if let Some(object) = projected.as_object_mut() {
                    object.insert("workTeamRefs".into(), Value::Array(teams));
                }
                rows.push(projected);
            }
            if rows.len() == request.limit || source_reads == MAX_SOURCE_READS {
                break 'windows;
            }
        }
        after = end;
        if after == u64::MAX {
            break;
        }
    }
    let next_cursor = if scan.witness(after, None).await?.is_some() {
        Some(request.cursor(org, &caller, after))
    } else {
        None
    };
    Ok(WorkBoardPage {
        rows,
        next_cursor,
        command_evidence: None,
    })
}

/// Shared source boundary for paged cards and exact command readback. Owner
/// authority never substitutes for the actual actor's canonical record read.
async fn read_board_source(
    context: &TrustedOperationContext,
    row: &Value,
    scope: WorkScope,
    company: u64,
) -> Result<Option<(WorkSource, Value)>, ApiError> {
    let Some(source) = source_for(row, scope, context.field_access()) else {
        return Ok(None);
    };
    let Some(source_id) = number(row, "subjectId", "subject_id").filter(|id| *id > 0) else {
        return Ok(None);
    };
    match execute_authorized_resource_record(
        context.client(),
        source.resource,
        context.organization_id(),
        company,
        source_id,
        Some(context.field_access()),
    )
    .await
    {
        Ok(row) => Ok(row.map(|row| (source, row))),
        Err(ApiError::NotFound(_) | ApiError::Forbidden(_)) => Ok(None),
        Err(error) => Err(error),
    }
}

fn team_refs(row: &Value, scope: &CandidateScope, company: u64) -> Vec<Value> {
    [
        ("workflow-group", "candidateGroupIds", "candidate_group_ids"),
        ("department", "candidateUnitIds", "candidate_unit_ids"),
    ]
    .into_iter()
    .flat_map(|(kind, camel, snake)| {
        u64_list_field(row, camel, snake)
            .into_iter()
            .filter(move |id| *id > 0 && scope.has_team(company, kind, *id))
            .map(move |id| json!({"kind":kind,"id":id.to_string()}))
    })
    .collect()
}

struct ProjectionContext<'a> {
    owner: &'a StdbClient,
    org: u64,
    company: u64,
    caller: &'a str,
    scope: &'a CandidateScope,
    access: &'a FieldAccessContext,
    actor_conflict: bool,
    sod_rules: &'a [Value],
}

async fn project_board_row(
    row: Value,
    source_row: &Value,
    source: WorkSource,
    projection: &ProjectionContext<'_>,
    delegated_access: &mut HashMap<String, Option<FieldAccessContext>>,
) -> Result<Value, ApiError> {
    let ProjectionContext {
        owner,
        org,
        company,
        caller,
        scope,
        access,
        actor_conflict,
        sod_rules,
    } = *projection;
    let task_id = number(&row, "id", "id")
        .ok_or_else(|| ApiError::Internal("work task is missing its ID".into()))?;
    let instance_id = number(&row, "workflowInstanceId", "workflow_instance_id")
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::Internal("work task is missing its instance".into()))?;
    let instances = owner.query_sql(&format!("SELECT id, revision FROM workflow_instance WHERE organization_id = {org} AND company_id = {company} AND id = {instance_id} LIMIT 1")).await.map_err(ApiError::internal)?;
    let revisions = instances
        .iter()
        .filter_map(|instance| {
            number(instance, "id", "id").zip(number(instance, "revision", "revision"))
        })
        .collect();
    let unvoted_candidates: Vec<String> = if enum_tag(&row, "assignment").as_deref()
        == Some("AllCandidates")
    {
        let candidates = owner.query_sql(&format!("SELECT candidate_identity, decision FROM workflow_human_task_candidate WHERE organization_id = {org} AND company_id = {company} AND task_id = {task_id} LIMIT 65")).await.map_err(ApiError::internal)?;
        if candidates.len() > 64 {
            return Err(ApiError::Internal(
                "workflow candidate projection exceeds its bound".into(),
            ));
        }
        candidates
            .iter()
            .filter(|row| row.get("decision").is_some_and(Value::is_null))
            .filter_map(|row| identity(row, "candidateIdentity", "candidate_identity"))
            .collect()
    } else {
        Vec::new()
    };
    let directly_eligible = scope.directly_eligible(&row);
    let mut options = scope.delegated_options(&row, caller);
    let assigned_to_me = identity(&row, "claimedBy", "claimed_by").as_deref() == Some(caller);
    // Guarded adapters run as the actual JWT actor, even when workflow approval
    // itself uses a delegated principal. Earlier quorum votes execute no adapter.
    let guarded_approve_allowed =
        guarded_actions::may_execute_approval(&row, access, unvoted_candidates.len());
    let mut row = project_human_task(row, &revisions);
    if let Some(object) = row.as_object_mut() {
        object.remove("guardedAction");
        object.remove("guarded_action");
    }
    let mut direct_actions = work_actions(
        &row,
        ActionContext {
            caller,
            principal: caller,
            eligible: directly_eligible,
            access: Some(access),
            actor_has_sod_conflict: actor_conflict,
            sod_rules,
            unvoted_candidates: &unvoted_candidates,
        },
    );
    direct_actions
        .retain(|action| *action != actions::WorkAction::Approve || guarded_approve_allowed);
    for option in &mut options {
        let Some(principal) = option
            .get("identityHex")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        if !delegated_access.contains_key(&principal) {
            identity_sql_literal(&principal).map_err(ApiError::Internal)?;
            let principal_access = load_field_access_context(owner, &principal, org)
                .await
                .map_err(ApiError::Internal)?;
            delegated_access.insert(principal.clone(), principal_access);
        }
        let principal_access = delegated_access.get(&principal).and_then(Option::as_ref);
        let eligible = principal_access.is_some_and(|access| {
            scope.delegated_action_eligible(&row, &principal, &access.role_ids)
        });
        let mut actions = work_actions(
            &row,
            ActionContext {
                caller,
                principal: &principal,
                eligible,
                access: principal_access,
                actor_has_sod_conflict: actor_conflict,
                sod_rules,
                unvoted_candidates: &unvoted_candidates,
            },
        );
        actions.retain(|action| *action != actions::WorkAction::Approve || guarded_approve_allowed);
        if let Some(object) = option.as_object_mut() {
            object.insert("workActions".into(), json!(actions));
        }
    }
    if let Some(object) = row.as_object_mut() {
        object.insert("workModule".into(), json!(source.module));
        object.insert("workAssignedToMe".into(), json!(assigned_to_me));
        object.insert("workActions".into(), json!(direct_actions));
        object.insert("directlyEligible".into(), json!(directly_eligible));
        object.insert("actingForOptions".into(), Value::Array(options));
        if let Some(name) = source_row.get("name").and_then(Value::as_str) {
            object.insert("workSourceTitle".into(), json!(name));
        }
    }
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;
    use stdb_auth::ActionPermission;

    fn request() -> WorkBoardRequest {
        WorkBoardRequest::parse(
            "workflow-human-tasks",
            Some(7),
            Some("finance"),
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap()
    }
    fn access() -> FieldAccessContext {
        FieldAccessContext {
            organization_id: 42,
            role_permissions: vec!["purchase_order:read".into()],
            ..FieldAccessContext::default()
        }
    }

    #[test]
    fn board_parameters_are_explicit_and_fail_closed() {
        assert!(
            WorkBoardRequest::parse("tasks", None, None, None, None, None, None)
                .unwrap()
                .is_none()
        );
        for (resource, company, scope, view, team, limit) in [
            ("tasks", Some(7), Some("finance"), None, None, None),
            (
                "workflow-human-tasks",
                None,
                Some("finance"),
                None,
                None,
                None,
            ),
            (
                "workflow-human-tasks",
                Some(0),
                Some("finance"),
                None,
                None,
                None,
            ),
            (
                "workflow-human-tasks",
                Some(7),
                Some("unknown"),
                None,
                None,
                None,
            ),
            (
                "workflow-human-tasks",
                Some(7),
                None,
                Some("mine"),
                None,
                None,
            ),
            (
                "workflow-human-tasks",
                Some(7),
                Some("finance"),
                Some("all"),
                None,
                None,
            ),
            (
                "workflow-human-tasks",
                Some(7),
                Some("finance"),
                None,
                Some("department:0"),
                None,
            ),
            (
                "workflow-human-tasks",
                Some(7),
                Some("finance"),
                None,
                Some("role:1"),
                None,
            ),
            (
                "workflow-human-tasks",
                Some(7),
                Some("finance"),
                None,
                None,
                Some(0),
            ),
            (
                "workflow-human-tasks",
                Some(7),
                Some("finance"),
                None,
                None,
                Some(51),
            ),
        ] {
            assert!(
                WorkBoardRequest::parse(resource, company, scope, view, team, None, limit).is_err()
            );
        }
    }

    #[test]
    fn cursor_is_bound_to_actor_tenant_company_scope_view_and_team() {
        let mut board = request();
        let caller = "ab".repeat(32);
        board.cursor = Some(board.cursor(42, &caller, 123));
        assert_eq!(board.after(42, &caller).unwrap(), 123);
        assert!(board.after(43, &caller).is_err());
        assert!(board.after(42, &"cd".repeat(32)).is_err());
        board.company_id = 8;
        assert!(board.after(42, &caller).is_err());
        board.company_id = 7;
        board.scope = WorkScope::Purchasing;
        assert!(board.after(42, &caller).is_err());
        board.scope = WorkScope::Finance;
        board.view = WorkView::Mine;
        assert!(board.after(42, &caller).is_err());
        board.view = WorkView::Eligible;
        board.team = Some(WorkTeam {
            kind: "department",
            id: 1,
        });
        assert!(board.after(42, &caller).is_err());
        board.team = None;
        for tail in ["", "01", "-1", "18446744073709551616", "1 OR 1=1"] {
            board.cursor = Some(format!("{}{tail}", board.cursor_prefix(42, &caller)));
            assert!(board.after(42, &caller).is_err());
        }
    }

    #[test]
    fn source_mapping_never_grants_a_sibling_module_read() {
        let mut actor = access();
        assert!(source_for(
            &json!({"subjectModel":"purchase_order"}),
            WorkScope::Finance,
            &actor
        )
        .is_some());
        assert!(source_for(
            &json!({"subjectModel":"sale_order"}),
            WorkScope::Finance,
            &actor
        )
        .is_none());
        assert!(source_for(
            &json!({"subjectModel":"purchase_order"}),
            WorkScope::Sales,
            &actor
        )
        .is_none());
        assert!(source_for(
            &json!({"subjectModel":"hr_employee"}),
            WorkScope::Finance,
            &actor
        )
        .is_none());
        actor.org_permissions.push(ActionPermission {
            resource: "purchase_order".into(),
            action: "read".into(),
            allow: false,
        });
        assert!(source_for(
            &json!({"subjectModel":"purchase_order"}),
            WorkScope::Finance,
            &actor
        )
        .is_none());
    }

    #[test]
    fn row_scope_views_and_team_filters_cannot_broaden_candidate_visibility() {
        let scope = CandidateScope::test_scope();
        let caller = "cd".repeat(32);
        let mut board = request();
        let mut row = json!({"organizationId":42,"companyId":7,"candidateRoleIds":[2],
            "requestedBy":"ab".repeat(32),"status":"Open","claimedBy":null});
        assert!(visible_row(&row, &board, 42, &caller, &scope));
        row["companyId"] = json!(8);
        assert!(!visible_row(&row, &board, 42, &caller, &scope));
        row["companyId"] = json!(7);
        row["organizationId"] = json!(43);
        assert!(!visible_row(&row, &board, 42, &caller, &scope));
        row["organizationId"] = json!(42);
        row["candidateRoleIds"] = json!([99]);
        assert!(!visible_row(&row, &board, 42, &caller, &scope));
        row["candidateRoleIds"] = json!([3]);
        assert!(visible_row(&row, &board, 42, &caller, &scope)); // Effective delegation.
        board.view = WorkView::Mine;
        assert!(!visible_row(&row, &board, 42, &caller, &scope));
        row["claimedBy"] = json!(caller);
        assert!(visible_row(&row, &board, 42, &caller, &scope));
        row["claimedBy"] = json!("ef".repeat(32));
        assert!(!visible_row(&row, &board, 42, &caller, &scope)); // Principal is not the claimant.
        board.view = WorkView::Available;
        assert!(!visible_row(&row, &board, 42, &caller, &scope));
        row["claimedBy"] = Value::Null;
        assert!(visible_row(&row, &board, 42, &caller, &scope));
        row["status"] = json!("Approved");
        assert!(!visible_row(&row, &board, 42, &caller, &scope));
        assert!(scope.has_team(7, "department", 4));
        assert!(scope.has_team(7, "workflow-group", 10));
        assert!(!scope.has_team(8, "workflow-group", 10));
        assert!(!scope.has_team(7, "workflow-group", 99));
    }

    #[test]
    fn detailed_owner_read_is_bounded_and_excludes_source_payloads() {
        let sql = super::super::bounded_windows::window_sql(
            "workflow_human_task",
            BOARD_COLUMNS,
            &scope_predicate(42, &request(), &SOURCES[..1]),
            0,
            ID_WINDOW,
        );
        assert!(sql.contains(
            "organization_id = 42 AND company_id = 7 AND (subject_model = 'purchase_order')"
        ));
        assert!(sql.contains("id > 0 AND id <= 128 LIMIT 128"));
        assert!(!sql.contains("guarded_action"));
        assert!(!sql.contains("decision_comment"));
        assert!(!sql.contains("SELECT *"));
        assert!(!sql.contains("ORDER BY"));
        assert_eq!(u64::MAX.saturating_add(ID_WINDOW), u64::MAX);
    }

    #[test]
    fn team_filters_keep_namespaces_and_exact_ids_distinct() {
        let row = json!({"candidateGroupIds":[8,9,10],"candidateUnitIds":[4,9]});
        assert!(WorkTeam::parse("workflow-group:8").unwrap().matches(&row));
        assert!(!WorkTeam::parse("department:8").unwrap().matches(&row));
        assert_eq!(
            team_refs(&row, &CandidateScope::test_scope(), 7),
            vec![
                json!({"kind":"workflow-group","id":"9"}),
                json!({"kind":"workflow-group","id":"10"}),
                json!({"kind":"department","id":"4"})
            ]
        );
        assert!(team_refs(&row, &CandidateScope::test_scope(), 8).is_empty());
        for raw in [
            "department:01",
            "department:-1",
            "department:18446744073709551616",
            "department:1 OR 1=1",
        ] {
            assert!(WorkTeam::parse(raw).is_err());
        }
    }
}

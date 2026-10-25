//! Company- and source-authorized manual follow-ups. No workflow/task state is copied.
use crate::auth_password::identity_cell_to_hex;
use crate::error::ApiError;
use crate::query_exec::{
    execute_authorized_resource_record, resolve_membership_company_id, row_u64,
};
use crate::trusted_context::TrustedOperationContext;
use crate::workflow_reads::bounded_windows::{BoundedIdReader, ID_WINDOW};
use crate::workflow_reads::{work_source_for_model, WorkScope, WorkSource};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use stdb_auth::{
    has_resource_read_permission, identity_sql_literal, permission_allowed,
    resolve_http_sql_columns,
};
use stdb_client::StdbClient;

const COLUMNS: &str = "id, organization_id, summary, res_model, res_id, assigned_to, is_done, state, date_deadline, updated_at, auto, is_system, deleted_at";
const MODELS: &[&str] = &["purchase_order", "sale_order", "account_move"];
const MAX_WINDOWS: usize = 4;
const MAX_SOURCE_READS: usize = 100;

#[cfg(test)]
mod http_tests;

fn cell<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    row.get(camel).or_else(|| row.get(snake))
}
fn id(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    row_u64(row, camel, snake)
        .ok()
        .flatten()
        .filter(|id| *id > 0)
}
fn text<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a str> {
    cell(row, camel, snake).and_then(Value::as_str)
}
fn identity(row: &Value, camel: &str, snake: &str) -> Option<String> {
    let value = cell(row, camel, snake)?;
    let value = value
        .get("some")
        .or_else(|| value.get("Some"))
        .unwrap_or(value);
    let hex = identity_cell_to_hex(value)?;
    identity_sql_literal(&hex).ok()?;
    Some(hex)
}
fn positive(raw: &str) -> Option<u64> {
    (!raw.is_empty() && raw.bytes().all(|b| b.is_ascii_digit()))
        .then(|| raw.parse().ok())
        .flatten()
        .filter(|id| *id > 0)
}

#[derive(Debug)]
pub(super) struct ActivityWorkRequest {
    company_id: u64,
    scope: WorkScope,
    view: String,
    department: Option<u64>,
    cursor: Option<String>,
    limit: usize,
    activity_id: Option<u64>,
}

impl ActivityWorkRequest {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn parse(
        resource: &str,
        company: Option<u64>,
        scope: Option<&str>,
        view: Option<&str>,
        team: Option<&str>,
        cursor: Option<&str>,
        limit: Option<u32>,
        activity_id: Option<u64>,
    ) -> Result<Option<Self>, ApiError> {
        if resource != "activities" {
            if activity_id.is_some() {
                return Err(ApiError::BadRequest(
                    "activityId requires the activities resource".into(),
                ));
            }
            return Ok(None);
        }
        if scope.is_none() && view.is_none() && team.is_none() && activity_id.is_none() {
            return Ok(None);
        }
        let scope = WorkScope::parse(scope.ok_or_else(|| {
            ApiError::BadRequest("workScope is required for record follow-ups".into())
        })?)?;
        let company_id = company.filter(|id| *id > 0).ok_or_else(|| {
            ApiError::BadRequest("companyId is required for record follow-ups".into())
        })?;
        let view = view.unwrap_or("eligible");
        if !matches!(view, "eligible" | "mine" | "available") {
            return Err(ApiError::BadRequest("unsupported workView".into()));
        }
        let department = team
            .map(|raw| {
                raw.strip_prefix("department:")
                    .and_then(positive)
                    .ok_or_else(|| {
                        ApiError::BadRequest(
                            "Record follow-ups support department teams only".into(),
                        )
                    })
            })
            .transpose()?;
        let limit = limit.unwrap_or(50);
        if !(1..=50).contains(&limit)
            || cursor.is_some_and(|cursor| cursor.len() > 256)
            || activity_id == Some(0)
            || (activity_id.is_some() && cursor.is_some())
        {
            return Err(ApiError::BadRequest(
                "Invalid follow-up pagination or activityId".into(),
            ));
        }
        Ok(Some(Self {
            company_id,
            scope,
            view: view.into(),
            department,
            cursor: cursor.map(str::to_owned),
            limit: limit as usize,
            activity_id,
        }))
    }

    fn prefix(&self, org: u64, caller: &str) -> String {
        format!(
            "aw1.{org}.{}.{}.{}.{}.{caller}.",
            self.company_id,
            self.scope.key(),
            self.view,
            self.department.unwrap_or(0)
        )
    }
    fn after(&self, org: u64, caller: &str) -> Result<u64, ApiError> {
        self.cursor
            .as_ref()
            .map(|cursor| {
                cursor
                    .strip_prefix(&self.prefix(org, caller))
                    .and_then(positive)
                    .ok_or_else(|| {
                        ApiError::BadRequest("Cursor does not match this follow-up board".into())
                    })
            })
            .transpose()
            .map(|after| after.unwrap_or(0))
    }
    fn cursor(&self, org: u64, caller: &str, after: u64) -> String {
        format!("{}{after}", self.prefix(org, caller))
    }
}

pub(super) struct ActivityWorkPage {
    pub rows: Vec<Value>,
    pub next_cursor: Option<String>,
}

fn manual_status(row: &Value, org: u64) -> Option<bool> {
    if id(row, "organizationId", "organization_id") != Some(org)
        || cell(row, "deletedAt", "deleted_at") != Some(&Value::Null)
        || cell(row, "auto", "auto").and_then(Value::as_bool) != Some(false)
        || cell(row, "isSystem", "is_system").and_then(Value::as_bool) != Some(false)
    {
        return None;
    }
    match (
        cell(row, "isDone", "is_done").and_then(Value::as_bool),
        text(row, "state", "state"),
    ) {
        (Some(true), Some("done")) => Some(true),
        (Some(false), Some("planned" | "today" | "overdue" | "open")) => Some(false),
        _ => None,
    }
}

fn matches_view(row: &Value, request: &ActivityWorkRequest, caller: &str, done: bool) -> bool {
    if request.activity_id.is_some() {
        return true;
    }
    match request.view.as_str() {
        "mine" => identity(row, "assignedTo", "assigned_to").as_deref() == Some(caller),
        "available" => !done && cell(row, "assignedTo", "assigned_to") == Some(&Value::Null),
        _ => true,
    }
}

fn micros(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .or_else(|| {
            value
                .get("__timestamp_micros_since_unix_epoch__")
                .and_then(micros)
        })
        .or_else(|| value.get("microsSinceUnixEpoch").and_then(micros))
}
fn timestamp(value: Option<&Value>) -> Option<String> {
    value
        .and_then(micros)
        .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_micros)
        .map(|date| date.to_rfc3339())
}

fn project(
    row: &Value,
    source: WorkSource,
    source_row: &Value,
    request: &ActivityWorkRequest,
    org: u64,
    caller: &str,
    done: bool,
    columns: &HashSet<String>,
    can_complete: bool,
    team: Option<u64>,
) -> Value {
    let activity_id = id(row, "id", "id").expect("checked activity ID");
    let assigned = identity(row, "assignedTo", "assigned_to");
    let mut projected = json!({
        "id": activity_id.to_string(), "organizationId": org.to_string(), "companyId": request.company_id.to_string(),
        "workModule": source.module, "resModel": source.model, "resId": id(row, "resId", "res_id").expect("checked source ID").to_string(),
        "summary": if columns.contains("summary") { text(row, "summary", "summary").map(str::to_owned).unwrap_or_else(|| format!("Follow-up #{activity_id}")) } else { format!("Follow-up #{activity_id}") },
        "state": if done { "done" } else { "open" }, "isDone": done,
        "workAssignedToMe": assigned.as_deref() == Some(caller), "workIsAssigned": assigned.is_some(),
        "workTeamRefs": team.map(|id| vec![json!({"kind":"department", "id":id.to_string()})]).unwrap_or_default(),
        "workActions": if can_complete && !done { vec!["complete"] } else { vec![] },
    });
    let fields = projected.as_object_mut().expect("projection object");
    if columns.contains("assigned_to") {
        fields.insert("assignedTo".into(), json!(assigned));
    }
    if columns.contains("date_deadline") {
        fields.insert(
            "dateDeadline".into(),
            json!(timestamp(cell(row, "dateDeadline", "date_deadline"))),
        );
    }
    if columns.contains("updated_at") {
        if let Some(value) = timestamp(cell(row, "updatedAt", "updated_at")) {
            fields.insert("updatedAt".into(), json!(value));
        }
    }
    if let Some(title) = source_row
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
    {
        fields.insert("workSourceTitle".into(), json!(title));
    }
    projected
}

pub(super) async fn read_activity_work(
    owner: &StdbClient,
    context: &TrustedOperationContext,
    request: ActivityWorkRequest,
) -> Result<ActivityWorkPage, ApiError> {
    let org = context.organization_id();
    let access = context.field_access();
    if access.organization_id != org || !has_resource_read_permission(Some(access), "activities") {
        return Err(ApiError::Forbidden(
            "Activity read permission is required".into(),
        ));
    }
    let columns: HashSet<_> = resolve_http_sql_columns("activities", Some(access))
        .map_err(ApiError::Internal)?
        .into_iter()
        .collect();
    if !columns.contains("state") || !columns.contains("is_done") {
        return Err(ApiError::Forbidden(
            "Activity lifecycle fields are required for this view".into(),
        ));
    }
    let company = resolve_membership_company_id(
        context.client(),
        org,
        context.actor_identity(),
        Some(request.company_id),
        "Cannot query another company's record follow-ups",
    )
    .await?;
    if !crate::workflow_reads::allowed_company_ids(owner, org, Some(access))
        .await?
        .contains(&company)
    {
        return Err(ApiError::Forbidden(
            "Record follow-up company access denied".into(),
        ));
    }
    let company_rows = owner.query_sql(&format!("SELECT id FROM company WHERE id = {company} AND organization_id = {org} AND deleted_at IS NULL LIMIT 1")).await.map_err(ApiError::internal)?;
    if company_rows.is_empty() {
        return Err(ApiError::Forbidden("Company is not active".into()));
    }
    let caller = context
        .actor_identity()
        .trim_start_matches("0x")
        .to_ascii_lowercase();
    let caller_literal = identity_sql_literal(&caller).map_err(ApiError::Internal)?;
    let memberships = owner.query_sql(&format!("SELECT user_identity, organization_id, company_id, department_id, is_active FROM user_organization WHERE organization_id = {org} AND is_active = true AND user_identity = {caller_literal}")).await.map_err(ApiError::internal)?;
    let mut own_department = None;
    for membership in &memberships {
        if cell(membership, "isActive", "is_active").and_then(Value::as_bool) != Some(true)
            || id(membership, "organizationId", "organization_id") != Some(org)
        {
            continue;
        }
        if !cell(membership, "companyId", "company_id").is_some_and(Value::is_null)
            && id(membership, "companyId", "company_id") != Some(company)
        {
            continue;
        }
        if let Some(department) = id(membership, "departmentId", "department_id") {
            let rows = owner.query_sql(&format!("SELECT id FROM hr_department WHERE id = {department} AND organization_id = {org} AND company_id = {company} AND is_active = true LIMIT 1")).await.map_err(ApiError::internal)?;
            if !rows.is_empty() {
                own_department = Some(department);
            }
        }
    }
    if request.department.is_some() && request.department != own_department {
        return Err(ApiError::Forbidden(
            "Department follow-ups require current department membership".into(),
        ));
    }
    let mut teammates = HashSet::new();
    if let Some(department) = own_department {
        let members = owner.query_sql(&format!("SELECT user_identity, organization_id, company_id, is_active FROM user_organization WHERE organization_id = {org} AND department_id = {department} AND is_active = true LIMIT 2001")).await.map_err(ApiError::internal)?;
        if members.len() > 2000 {
            return Err(ApiError::Unavailable(
                "Department exceeds the follow-up directory limit".into(),
            ));
        }
        teammates = super::task_assignees::eligible_identities(&members, org, company);
    }
    let sources: Vec<_> = MODELS
        .iter()
        .filter_map(|model| work_source_for_model(model, request.scope, access))
        .collect();
    if sources.is_empty() {
        return Ok(ActivityWorkPage {
            rows: vec![],
            next_cursor: None,
        });
    }
    let source_predicate = sources
        .iter()
        .map(|source| format!("res_model = '{}'", source.model))
        .collect::<Vec<_>>()
        .join(" OR ");
    let predicate = format!("organization_id = {org} AND ({source_predicate}) AND auto = false AND is_system = false AND deleted_at IS NULL");
    let reader = BoundedIdReader::new(owner, "activity", &predicate);
    let mut after = request.after(org, &caller)?;
    let mut rows = Vec::new();
    let mut cache: HashMap<(&str, u64), Option<Value>> = HashMap::new();
    let mut probes = 0;
    let mut has_more = false;
    for _ in 0..MAX_WINDOWS {
        has_more = false;
        let (mut window, end) = if let Some(activity_id) = request.activity_id {
            (owner.query_sql(&format!("SELECT {COLUMNS} FROM activity WHERE {predicate} AND id = {activity_id} LIMIT 1")).await.map_err(ApiError::internal)?, activity_id)
        } else {
            let Some(witness) = reader.witness(after, None).await? else {
                has_more = false;
                break;
            };
            reader
                .seek_window_start(&mut after, witness, &mut probes)
                .await?;
            let end = after.saturating_add(ID_WINDOW);
            (
                owner
                    .query_sql(&reader.window_sql(COLUMNS, after, end))
                    .await
                    .map_err(ApiError::internal)?,
                end,
            )
        };
        window.sort_by_key(|row| id(row, "id", "id").unwrap_or(0));
        for row in window {
            let activity_id = id(&row, "id", "id")
                .filter(|id| {
                    *id > after
                        && *id <= end
                        && request.activity_id.is_none_or(|exact| exact == *id)
                })
                .ok_or_else(|| ApiError::Internal("Activity escaped ID window".into()))?;
            after = activity_id;
            let Some(done) = manual_status(&row, org) else {
                continue;
            };
            if !matches_view(&row, &request, &caller, done) {
                continue;
            }
            let model = text(&row, "resModel", "res_model").unwrap_or("");
            let Some(source) = sources.iter().copied().find(|source| source.model == model) else {
                continue;
            };
            let Some(source_id) = id(&row, "resId", "res_id") else {
                continue;
            };
            let assigned = identity(&row, "assignedTo", "assigned_to");
            let team = assigned
                .as_ref()
                .filter(|identity| teammates.contains(*identity))
                .and(own_department.as_ref())
                .copied();
            if request.department.is_some() && team != request.department {
                continue;
            }
            if !cache.contains_key(&(source.model, source_id)) {
                if cache.len() == MAX_SOURCE_READS {
                    after = activity_id - 1;
                    has_more = true;
                    break;
                }
                let result = match execute_authorized_resource_record(
                    context.client(),
                    source.resource,
                    org,
                    company,
                    source_id,
                    Some(access),
                )
                .await
                {
                    Ok(row) => row,
                    Err(ApiError::Forbidden(_)) | Err(ApiError::NotFound(_)) => None,
                    Err(error) => return Err(error),
                };
                cache.insert((source.model, source_id), result);
            }
            let Some(source_row) = cache
                .get(&(source.model, source_id))
                .and_then(Option::as_ref)
            else {
                continue;
            };
            rows.push(project(
                &row,
                source,
                source_row,
                &request,
                org,
                &caller,
                done,
                &columns,
                permission_allowed(access, "activity", "write"),
                team,
            ));
            if rows.len() == request.limit {
                has_more = reader.witness(after, None).await?.is_some();
                break;
            }
        }
        if request.activity_id.is_some() {
            has_more = false;
            break;
        }
        if rows.len() == request.limit || has_more {
            break;
        }
        after = end;
        has_more = reader.witness(after, None).await?.is_some();
        if !has_more {
            break;
        }
    }
    Ok(ActivityWorkPage {
        rows,
        next_cursor: has_more.then(|| request.cursor(org, &caller, after)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(view: &str) -> ActivityWorkRequest {
        ActivityWorkRequest::parse(
            "activities",
            Some(7),
            Some("finance"),
            Some(view),
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap()
    }
    fn row() -> Value {
        json!({"id":1,"organizationId":42,"resModel":"purchase_order","resId":9,"isDone":false,"state":"planned","auto":false,"isSystem":false,"deletedAt":null,"assignedTo":null})
    }
    #[test]
    fn parser_rejects_wrong_teams_and_keeps_cursor_scope() {
        assert!(ActivityWorkRequest::parse(
            "workflow-human-tasks",
            Some(7),
            Some("finance"),
            None,
            None,
            None,
            None,
            None
        )
        .unwrap()
        .is_none());
        assert!(ActivityWorkRequest::parse(
            "activities",
            Some(7),
            Some("finance"),
            None,
            Some("workflow-group:5"),
            None,
            None,
            None
        )
        .is_err());
        let mut a = request("mine");
        a.cursor = Some(a.cursor(42, "alice", 128));
        assert_eq!(a.after(42, "alice").unwrap(), 128);
        assert!(a.after(43, "alice").is_err());
        assert!(a.after(42, "bob").is_err());
        a.view = "eligible".into();
        assert!(a.after(42, "alice").is_err());
    }
    #[test]
    fn manual_status_excludes_deleted_system_inconsistent_and_foreign_rows() {
        let original = row();
        assert_eq!(manual_status(&original, 42), Some(false));
        for (key, value) in [
            ("deletedAt", json!(1)),
            ("isSystem", json!(true)),
            ("auto", json!(true)),
            ("isDone", json!(true)),
            ("organizationId", json!(43)),
            ("state", json!("cancelled")),
        ] {
            let mut r = original.clone();
            r[key] = value;
            assert_eq!(manual_status(&r, 42), None);
        }
        let mut done = original;
        done["isDone"] = json!(true);
        done["state"] = json!("done");
        assert_eq!(manual_status(&done, 42), Some(true));
    }
    #[test]
    fn views_use_actual_assignee_and_completion_is_still_readable_exactly() {
        let mut r = row();
        let caller = "a".repeat(64);
        assert!(matches_view(&r, &request("available"), &caller, false));
        assert!(!matches_view(&r, &request("mine"), &caller, false));
        r["assignedTo"] = json!(caller);
        assert!(matches_view(&r, &request("mine"), &caller, false));
        assert!(!matches_view(&r, &request("available"), &caller, false));
        let mut exact = request("available");
        exact.activity_id = Some(1);
        assert!(matches_view(&r, &exact, &caller, true));
    }

    #[test]
    fn projection_preserves_field_restrictions_and_never_returns_notes_or_metadata() {
        let mut r = row();
        r["summary"] = json!("Private summary");
        r["assignedTo"] = json!("a".repeat(64));
        r["note"] = json!("private note");
        r["metadata"] = json!("private metadata");
        r["dateDeadline"] = json!({"microsSinceUnixEpoch": 1_700_000_000_000_000i64});
        let source = WorkSource {
            model: "purchase_order",
            resource: "purchase-orders",
            module: "purchasing",
        };
        let hidden = project(
            &r,
            source,
            &json!({"id":9}),
            &request("eligible"),
            42,
            &"a".repeat(64),
            false,
            &HashSet::new(),
            true,
            None,
        );
        assert_eq!(hidden["summary"], "Follow-up #1");
        assert_eq!(hidden["workAssignedToMe"], true);
        for key in [
            "assignedTo",
            "dateDeadline",
            "updatedAt",
            "note",
            "metadata",
            "workSourceTitle",
        ] {
            assert!(hidden.get(key).is_none(), "{key} must remain hidden");
        }
        let visible = project(
            &r,
            source,
            &json!({"name":"PO-9"}),
            &request("eligible"),
            42,
            &"a".repeat(64),
            true,
            &HashSet::from([
                "summary".into(),
                "assigned_to".into(),
                "date_deadline".into(),
            ]),
            true,
            None,
        );
        assert_eq!(visible["summary"], "Private summary");
        assert_eq!(visible["workSourceTitle"], "PO-9");
        assert_eq!(visible["dateDeadline"], "2023-11-14T22:13:20+00:00");
        assert_eq!(visible["workActions"], json!([]));
    }
}

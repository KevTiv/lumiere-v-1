//! Current source authority for guide reuse. This hydrates the same server-owned
//! role/field context as interactive reads, then uses the canonical evaluator.
use super::{parse_stored_identity, ActorIdentity, Viewer};
use anyhow::{Context, Result};
use serde_json::Value;
use stdb_auth::{ActionPermission, FieldAccessContext, FieldPermissionLike};
use stdb_client::StdbClient;

#[cfg(test)]
#[path = "guide_source_authority_tests.rs"]
mod tests;

fn cell<'a>(row: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    let a = row.get(camel);
    let b = row.get(snake);
    if a.zip(b).is_some_and(|(a, b)| a != b) {
        return None;
    }
    a.or(b)
}
fn id(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|id| *id > 0)
}
fn row_id(row: &Value, camel: &str, snake: &str) -> Option<u64> {
    id(cell(row, camel, snake)?)
}
fn absent(value: &Value) -> bool {
    value.is_null() || value.get("none").is_some()
}
fn unwrap(value: &Value) -> &Value {
    value.get("some").unwrap_or(value)
}
fn actor(value: &Value) -> Option<ActorIdentity> {
    value
        .as_str()
        .or_else(|| value.get("__identity__")?.as_str())
        .and_then(parse_stored_identity)
}
fn micros(value: &Value) -> Option<i64> {
    let value = unwrap(value);
    let value = value
        .get("microsSinceUnixEpoch")
        .or_else(|| value.get("__timestamp_micros_since_unix_epoch__"))
        .unwrap_or(value);
    value.as_i64().or_else(|| value.as_str()?.parse().ok())
}
fn label(value: &Value) -> Option<&str> {
    value
        .as_str()
        .or_else(|| value.get("tag")?.as_str())
        .or_else(|| value.as_object()?.keys().next().map(String::as_str))
}
enum Subject {
    Role(u64),
    User(ActorIdentity),
}
fn subject(row: &Value) -> Option<Subject> {
    let Some(value) = row.get("subject") else {
        return row_id(row, "roleId", "role_id").map(Subject::Role);
    };
    // The HTTP SATS decoder may unwrap a non-unit subject sum to its payload.
    // The canonical denormalized role_id distinguishes Role from User there.
    let kind = label(value).unwrap_or_default();
    if !kind.eq_ignore_ascii_case("role") && !kind.eq_ignore_ascii_case("user") {
        return row_id(row, "roleId", "role_id")
            .map(Subject::Role)
            .or_else(|| actor(value).map(Subject::User));
    }
    let value = value.get("value").or_else(|| value.get(kind))?;
    let value = value
        .as_array()
        .and_then(|items| (items.len() == 1).then(|| &items[0]))
        .unwrap_or(value);
    match kind.to_lowercase().as_str() {
        "role" => id(value).map(Subject::Role),
        "user" => actor(value).map(Subject::User),
        _ => None,
    }
}
fn applies(subject: &Subject, roles: &[u64], identity: ActorIdentity) -> bool {
    match subject {
        Subject::Role(id) => roles.contains(id),
        Subject::User(actor) => *actor == identity,
    }
}

struct Sources<'a> {
    profiles: &'a [Value],
    memberships: &'a [Value],
    roles: &'a [Value],
    assignments: &'a [Value],
    grants: &'a [Value],
    fields: &'a [Value],
    companies: &'a [Value],
}

fn evaluate(source: Sources<'_>, viewer: Viewer, now: i64) -> bool {
    let Some(identity) = viewer.actor_identity else {
        return false;
    };
    let org = viewer.organization_id;
    let company = viewer.company_id;
    if org == 0 || company == 0 {
        return false;
    }
    let [profile] = source.profiles else {
        return false;
    };
    if row_id(profile, "organizationId", "organization_id") != Some(org)
        || profile.get("identity").and_then(actor) != Some(identity)
        || cell(profile, "isActive", "is_active").and_then(Value::as_bool) != Some(true)
        || !stdb_auth::profile_bootstrap_lease_active(profile, now)
    {
        return false;
    }
    let Some(is_superuser) = cell(profile, "isSuperuser", "is_superuser").and_then(Value::as_bool)
    else {
        return false;
    };
    let [membership] = source.memberships else {
        return false;
    };
    if row_id(membership, "organizationId", "organization_id") != Some(org)
        || cell(membership, "userIdentity", "user_identity").and_then(actor) != Some(identity)
        || cell(membership, "isActive", "is_active").and_then(Value::as_bool) != Some(true)
    {
        return false;
    }
    let Some(primary) = row_id(membership, "roleId", "role_id") else {
        return false;
    };
    let current_roles = source
        .roles
        .iter()
        .filter(|row| {
            row_id(row, "organizationId", "organization_id") == Some(org)
                && cell(row, "isActive", "is_active").and_then(Value::as_bool) == Some(true)
        })
        .collect::<Vec<_>>();
    if current_roles
        .iter()
        .filter(|row| row_id(row, "id", "id") == Some(primary))
        .count()
        != 1
    {
        return false;
    }
    let mut role_ids = vec![primary];
    for assignment in source.assignments {
        if row_id(assignment, "organizationId", "organization_id") != Some(org)
            || cell(assignment, "userIdentity", "user_identity").and_then(actor) != Some(identity)
            || cell(assignment, "isActive", "is_active").and_then(Value::as_bool) != Some(true)
        {
            continue;
        }
        let Some(expiry) = cell(assignment, "expiresAt", "expires_at") else {
            continue;
        };
        if !absent(expiry) && !micros(expiry).is_some_and(|expiry| expiry > now) {
            continue;
        }
        if let Some(role) = row_id(assignment, "roleId", "role_id").filter(|role| {
            current_roles
                .iter()
                .any(|row| row_id(row, "id", "id") == Some(*role))
        }) {
            role_ids.push(role);
        }
    }
    role_ids.sort_unstable();
    role_ids.dedup();
    let mut permissions = Vec::new();
    for role in &current_roles {
        if !row_id(role, "id", "id").is_some_and(|id| role_ids.contains(&id)) {
            continue;
        }
        let Some(values) = role.get("permissions").and_then(Value::as_array) else {
            return false;
        };
        for value in values {
            let Some(value) = value.as_str() else {
                return false;
            };
            permissions.push(value.to_owned());
        }
    }
    let mut companies = Vec::new();
    for row in source.companies {
        if row_id(row, "organizationId", "organization_id") != Some(org) {
            return false;
        }
        let Some(deleted) = cell(row, "deletedAt", "deleted_at") else {
            return false;
        };
        if !absent(deleted) {
            continue;
        }
        let (Some(id), Some(parent)) = (
            row_id(row, "id", "id"),
            cell(row, "isParent", "is_parent").and_then(Value::as_bool),
        ) else {
            return false;
        };
        companies.push((!parent, id));
    }
    companies.sort_unstable();
    if !companies.iter().any(|(_, id)| *id == company) {
        return false;
    }
    if !permissions.iter().any(|permission| permission == "*:*") {
        let Some(bound) = cell(membership, "companyId", "company_id") else {
            return false;
        };
        let allowed = if absent(bound) {
            companies.first().map(|(_, id)| *id)
        } else {
            id(unwrap(bound))
        };
        if allowed != Some(company) {
            return false;
        }
    }
    let mut grants = Vec::new();
    for row in source.grants {
        if row_id(row, "organizationId", "organization_id") != Some(org) {
            return false;
        }
        let Some(subject) = subject(row) else {
            return false;
        };
        if !applies(&subject, &role_ids, identity) {
            continue;
        }
        let (Some(resource), Some(action), Some(effect)) = (
            row.get("resource").and_then(Value::as_str),
            row.get("action").and_then(label),
            row.get("effect").and_then(label),
        ) else {
            return false;
        };
        grants.push(ActionPermission {
            resource: resource.into(),
            action: action.to_lowercase(),
            allow: effect.eq_ignore_ascii_case("allow"),
        });
    }
    let mut field_permissions = Vec::new();
    for row in source.fields {
        if row_id(row, "organizationId", "organization_id") != Some(org) {
            return false;
        }
        let Some(subject) = subject(row) else {
            return false;
        };
        let (Some(resource), Some(action), Some(allowed)) = (
            row.get("resource").and_then(Value::as_str),
            row.get("action").and_then(label),
            cell(row, "allowedFields", "allowed_fields").and_then(Value::as_array),
        ) else {
            return false;
        };
        let fields = allowed
            .iter()
            .map(|value| value.as_str().map(str::to_owned))
            .collect::<Option<Vec<_>>>();
        let Some(allowed_fields) = fields else {
            return false;
        };
        let (subject_role_id, subject_user_hex) = match subject {
            Subject::Role(id) => (Some(id), None),
            Subject::User(actor) => (None, Some(actor.to_hex())),
        };
        field_permissions.push(FieldPermissionLike {
            id: row_id(row, "id", "id"),
            organization_id: Some(org),
            role_id: subject_role_id,
            resource: resource.into(),
            action: action.into(),
            allowed_fields,
            subject_role_id,
            subject_user_hex,
        });
    }
    let access = FieldAccessContext {
        organization_id: org,
        role_id: primary,
        role_name: String::new(),
        is_superuser,
        role_permissions: permissions,
        identity_hex: identity.to_hex(),
        field_permissions,
        role_ids,
        org_permissions: grants,
    };
    stdb_auth::has_resource_read_permission(Some(&access), "knowledge-articles")
        && ["name", "body"].iter().all(|field| {
            stdb_auth::has_resource_field_read_permission(
                Some(&access),
                "knowledge-articles",
                field,
            )
        })
}

pub(super) async fn allowed(client: &StdbClient, viewer: Viewer) -> Result<bool> {
    let Some(actor) = viewer.actor_identity else {
        return Ok(false);
    };
    if viewer.organization_id == 0 || viewer.company_id == 0 {
        return Ok(false);
    }
    let org = viewer.organization_id;
    let actor = actor.sql_literal();
    let sqls = [
        format!("SELECT id, organization_id, identity, is_active, is_superuser, metadata FROM knowledge_guide_actor_profile_read WHERE organization_id = {org} AND identity = {actor}"),
        format!("SELECT organization_id, user_identity, company_id, role_id, is_active FROM user_organization WHERE organization_id = {org} AND user_identity = {actor} AND is_active = true"),
        format!("SELECT id, organization_id, permissions, is_active FROM role WHERE organization_id = {org}"),
        format!("SELECT organization_id, user_identity, role_id, is_active, expires_at FROM user_role_assignment WHERE organization_id = {org} AND user_identity = {actor}"),
        format!("SELECT organization_id, subject, role_id, resource, action, effect FROM org_permission WHERE organization_id = {org}"),
        format!("SELECT id, organization_id, subject, role_id, resource, action, allowed_fields FROM field_permission WHERE organization_id = {org}"),
        format!("SELECT id, organization_id, is_parent, deleted_at FROM company WHERE organization_id = {org}"),
    ];
    let (profiles, memberships, roles, assignments, grants, fields, companies) = tokio::try_join!(
        client.query_sql(&sqls[0]),
        client.query_sql(&sqls[1]),
        client.query_sql(&sqls[2]),
        client.query_sql(&sqls[3]),
        client.query_sql(&sqls[4]),
        client.query_sql(&sqls[5]),
        client.query_sql(&sqls[6])
    )
    .context("load current guide source authority")?;
    Ok(evaluate(
        Sources {
            profiles: &profiles,
            memberships: &memberships,
            roles: &roles,
            assignments: &assignments,
            grants: &grants,
            fields: &fields,
            companies: &companies,
        },
        viewer,
        chrono::Utc::now().timestamp_micros(),
    ))
}

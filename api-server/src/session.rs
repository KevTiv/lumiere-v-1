//! Port of `frontend/web/lib/api-session.ts` (JWT + `user_organization` + field-access context).

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;

use crate::error::ApiError;
use crate::state::AppState;
use stdb_auth::{
    select_casbin_rules_in_subjects_sql, select_roles_active_sql,
    select_user_organization_for_identity_sql, select_user_profile_by_identity_sql,
    CasbinRuleLike, FieldAccessContext,
};
use stdb_client::StdbClient;

const ADMIN_TOKEN_PLACEHOLDERS: &[&str] = &[
    "",
    "your-server-token-here",
    "changeme",
    "replace-me",
    "replace_me",
];

fn is_usable_admin_token(raw: &str) -> bool {
    let t = raw.trim();
    !t.is_empty()
        && !ADMIN_TOKEN_PLACEHOLDERS
            .iter()
            .any(|p| p.eq_ignore_ascii_case(t))
}

pub fn normalize_identity_hex_for_sql(identity: &str) -> String {
    let s = identity.trim();
    let s = s.strip_prefix("0x").unwrap_or(s);
    let s = s.strip_prefix("0X").unwrap_or(s);
    if s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        return s.to_ascii_lowercase();
    }
    s.to_string()
}

/// SpacetimeDB `Identity` is 32 bytes = 64 hex chars. Rejects WorkOS UUIDs in `sub` and other junk.
pub fn parse_stdb_identity_hex(raw: &str) -> Option<String> {
    let s = raw.trim();
    let s = s.strip_prefix("0x").unwrap_or(s);
    let s = s.strip_prefix("0X").unwrap_or(s);
    if s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(s.to_ascii_lowercase());
    }
    None
}

fn jwt_claim_as_identity_hex(s: &str) -> Option<String> {
    parse_stdb_identity_hex(s)
}

pub fn decode_identity_hex_from_stdb_token(token: &str) -> Option<String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let mut b64 = parts[1].replace('-', "+").replace('_', "/");
    let pad = (4 - (b64.len() % 4)) % 4;
    b64.push_str(&"=".repeat(pad));
    let bytes = STANDARD.decode(b64.as_bytes()).ok()?;
    let json: Value = serde_json::from_slice(&bytes).ok()?;
    if let Some(s) = json.get("identity").and_then(|v| v.as_str()) {
        if let Some(h) = jwt_claim_as_identity_hex(s) {
            return Some(h);
        }
    }
    // Hybrid / WorkOS tokens: real Spacetime identity is here; `sub` may be a non-hex UUID.
    if let Some(s) = json.get("hex_identity").and_then(|v| v.as_str()) {
        if let Some(h) = jwt_claim_as_identity_hex(s) {
            return Some(h);
        }
    }
    if let Some(s) = json.get("sub").and_then(|v| v.as_str()) {
        if let Some(h) = jwt_claim_as_identity_hex(s) {
            return Some(h);
        }
    }
    None
}

pub async fn query_user_organization_with_fallback(
    client: &StdbClient,
    identity_hex: &str,
    admin_token: Option<&str>,
) -> Result<Vec<Value>, String> {
    let Some(id) = parse_stdb_identity_hex(identity_hex) else {
        return Ok(vec![]);
    };
    let sql = select_user_organization_for_identity_sql(&id, None).map_err(|e| e.to_string())?;

    let try_user = client.query_sql(&sql).await;
    match try_user {
        Ok(rows) if !rows.is_empty() => return Ok(rows),
        Ok(_) | Err(_) => {}
    }

    let Some(admin) = admin_token.filter(|t| is_usable_admin_token(t)) else {
        return Ok(vec![]);
    };

    let admin_client = client.with_token(admin);
    admin_client
        .query_sql(&sql)
        .await
        .map_err(|e| e.to_string())
}

pub async fn load_field_access_context(
    client: &StdbClient,
    identity_hex: &str,
    organization_id: u64,
) -> Result<Option<FieldAccessContext>, String> {
    if identity_hex.is_empty() || identity_hex == "unknown" || parse_stdb_identity_hex(identity_hex).is_none() {
        return Ok(None);
    }

    let sql_profile =
        select_user_profile_by_identity_sql(identity_hex, None).map_err(|e| e.to_string())?;
    let profiles = client
        .query_sql(&sql_profile)
        .await
        .map_err(|e| e.to_string())?;
    let Some(profile) = profiles.first() else {
        return Ok(None);
    };

    let is_superuser = profile
        .get("isSuperuser")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let sql_uo =
        select_user_organization_for_identity_sql(identity_hex, None).map_err(|e| e.to_string())?;
    let orgs = client
        .query_sql(&sql_uo)
        .await
        .map_err(|e| e.to_string())?;
    let uo = orgs.iter().find(|o| {
        o.get("organizationId")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                o.get("organizationId")
                    .and_then(|x| x.as_str())
                    .and_then(|s| s.parse().ok())
            })
            == Some(organization_id)
    });
    let Some(uo) = uo else {
        return Ok(None);
    };

    let roles = match client.query_sql("SELECT * FROM role WHERE is_active = true").await {
        Ok(rows) => rows,
        Err(_) => {
            let sql_roles = select_roles_active_sql(None).map_err(|e| e.to_string())?;
            client
                .query_sql(&sql_roles)
                .await
                .map_err(|e| e.to_string())?
        }
    };

    let role_id = uo
        .get("roleId")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            uo.get("roleId")
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse().ok())
        })
        .ok_or_else(|| "missing roleId on user_organization".to_string())?;

    let role = roles.iter().find(|r| {
        r.get("id")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                r.get("id")
                    .and_then(|x| x.as_str())
                    .and_then(|s| s.parse().ok())
            })
            == Some(role_id)
    });
    let Some(role) = role else {
        return Ok(None);
    };

    let role_name = role
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let esc = |s: &str| s.replace('\'', "''");
    let subjects = [
        format!("'{}'", esc(identity_hex)),
        format!("'{}'", esc(&role_id.to_string())),
        format!("'{}'", esc(&role_name)),
    ]
    .join(", ");
    let sql_casbin =
        select_casbin_rules_in_subjects_sql(&subjects, None).map_err(|e| e.to_string())?;
    let casbin_rows = client
        .query_sql(&sql_casbin)
        .await
        .map_err(|e| e.to_string())?;

    let mut casbin_rules = Vec::new();
    for row in casbin_rows {
        if let Ok(rule) = serde_json::from_value::<CasbinRuleLike>(row) {
            casbin_rules.push(rule);
        }
    }

    let perms = role.get("permissions").cloned().unwrap_or(Value::Null);
    let role_permissions: Vec<String> = match perms {
        Value::Array(a) => a
            .into_iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        _ => vec![],
    };

    Ok(Some(FieldAccessContext {
        organization_id,
        role_id,
        role_name,
        is_superuser,
        role_permissions,
        identity_hex: identity_hex.to_string(),
        casbin_rules,
    }))
}

pub struct ApiSession {
    pub stdb_token: String,
    pub identity_hex: String,
    pub organization_id: Option<u64>,
    pub field_access: Option<FieldAccessContext>,
}

/// Resolve session (no `ensure_dev_admin` — keep parity with minimal Phase 1).
pub async fn resolve_api_session(
    state: &AppState,
    authorization: Option<&str>,
    cookie_token: Option<&str>,
    x_std_identity: Option<&str>,
) -> Result<Option<ApiSession>, ApiError> {
    // Dev mock: DEV_MOCK_ORG_ID + STDB_SERVER_TOKEN
    if let (Some(org), Some(tok)) = (
        state.config.dev_mock_org_id,
        state.config.stdb_server_token.as_deref(),
    ) {
        if !tok.is_empty() {
            let client = state.client_with_token(tok);
            let identity_hex = "dev-mock-identity".to_string();
            let fa = load_field_access_context(&client, &identity_hex, org)
                .await
                .ok()
                .flatten();
            return Ok(Some(ApiSession {
                stdb_token: tok.to_string(),
                identity_hex,
                organization_id: Some(org),
                field_access: fa,
            }));
        }
    }

    let mut token: Option<String> = None;
    if let Some(a) = authorization {
        if let Some(rest) = a.strip_prefix("Bearer ") {
            token = Some(rest.trim().to_string());
        }
    }
    if token.is_none() {
        if let Some(c) = cookie_token {
            token = Some(c.to_string());
        }
    }
    if token.is_none() {
        if let Some(t) = state.config.stdb_server_token.clone() {
            if is_usable_admin_token(&t) {
                token = Some(t);
            }
        }
    }

    let Some(stdb_token) = token.filter(|t| !t.is_empty()) else {
        return Ok(None);
    };

    let client = state.client_with_token(&stdb_token);

    // Prefer identity embedded in the SpacetimeDB JWT; `sub` may be a WorkOS UUID on hybrid tokens.
    let identity_hex = decode_identity_hex_from_stdb_token(&stdb_token).or_else(|| {
        x_std_identity.and_then(|s| parse_stdb_identity_hex(s))
    });

    let admin = state.config.stdb_server_token.as_deref();

    let mut organization_id: Option<u64> = None;
    if let Some(ref id_hex) = identity_hex {
        let rows = query_user_organization_with_fallback(&client, id_hex, admin)
            .await
            .map_err(|e| ApiError::Internal(format!("user_organization query: {e}")))?;
        let org = rows.iter().find(|o| {
            o.get("isDefault")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        });
        let org = org.or_else(|| rows.first());
        if let Some(o) = org {
            organization_id = o
                .get("organizationId")
                .and_then(|v| v.as_u64())
                .or_else(|| {
                    o.get("organizationId")
                        .and_then(|x| x.as_str())
                        .and_then(|s| s.parse().ok())
                });
        }
    }

    let resolved_identity = identity_hex.unwrap_or_else(|| "unknown".into());

    let mut field_access: Option<FieldAccessContext> = None;
    if let Some(oid) = organization_id {
        if resolved_identity != "unknown" {
            field_access = load_field_access_context(&client, &resolved_identity, oid)
                .await
                .ok()
                .flatten();
        }
    }

    Ok(Some(ApiSession {
        stdb_token,
        identity_hex: resolved_identity,
        organization_id,
        field_access,
    }))
}

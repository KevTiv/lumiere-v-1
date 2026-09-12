//! `/v1/crm/*` — parity with `frontend/web/app/api/crm/*/route.ts`.

use std::sync::Arc;

use axum::{
    routing::{get, post, put},
    Router,
};
use serde_json::{json, Value};

use crate::state::AppState;

mod contact_identities;
mod contact_roles;
mod contacts;
mod leads;

use self::contact_identities::{
    contact_identities_get, contact_identities_post, contact_identity_archive,
    contact_identity_put, contact_identity_verify,
};
use self::contact_roles::{contact_role_end, contact_roles_get, contact_roles_post};
use self::contacts::{contacts_get, contacts_post};
use self::leads::{lead_delete, lead_get, lead_put, leads_get, leads_post};

fn paginate_limit_offset(limit: Option<u64>, offset: Option<u64>) -> (usize, usize) {
    let limit = limit.unwrap_or(50).min(100).max(1) as usize;
    let offset = offset.unwrap_or(0) as usize;
    (limit, offset)
}

fn list_meta(total: usize, offset: usize, limit: usize) -> Value {
    json!({
        "total": total,
        "page": (offset / limit).saturating_add(1),
        "limit": limit,
    })
}

fn value_as_u64(v: &Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn value_as_str(v: &Value) -> Option<&str> {
    v.as_str()
}

/// Copies `body[camel_key]` into `out[snake_key]` only when the key is present
/// in the request body (regardless of whether its value is `null`).
///
/// This preserves the reducer's explicit patch contract end to end: a key
/// missing from `out` deserializes as the Rust side's outer `None` (field
/// untouched); a key present with JSON `null` deserializes as an explicit
/// clear; a key present with a value replaces it. Never fill in a default for
/// an absent field — that is exactly the CRM-RI-003 bug (omitted siblings
/// getting cleared) this atomic reducer removes.

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/crm/leads", get(leads_get).post(leads_post))
        .route(
            "/crm/leads/:id",
            get(lead_get).put(lead_put).delete(lead_delete),
        )
        .route("/crm/contacts", get(contacts_get).post(contacts_post))
        .route(
            "/crm/contact-identities",
            get(contact_identities_get).post(contact_identities_post),
        )
        .route("/crm/contact-identities/:id", put(contact_identity_put))
        .route(
            "/crm/contact-identities/:id/verify",
            post(contact_identity_verify),
        )
        .route(
            "/crm/contact-identities/:id/archive",
            post(contact_identity_archive),
        )
        .route(
            "/crm/contact-roles",
            get(contact_roles_get).post(contact_roles_post),
        )
        .route("/crm/contact-roles/:id/end", post(contact_role_end))
}

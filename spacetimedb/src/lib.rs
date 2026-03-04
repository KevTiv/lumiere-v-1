/// Lumiere ERP — SpacetimeDB Module
///
/// # Directory Structure
///
/// ```
/// src/
/// ├── lib.rs          ← crate root: lifecycle reducers + module map (this file)
/// ├── types.rs        ← shared SpacetimeType enums used across domains
/// ├── helpers.rs      ← check_permission, write_audit_log
/// │
/// ├── core/           ← Foundation & Infrastructure  [Phase 1]
/// │   ├── mod.rs
/// │   ├── organization.rs   Organization · OrganizationSettings · Company
/// │   ├── users.rs          UserProfile · UserOrganization · UserSession
/// │   ├── permissions.rs    Role · CasbinRule · UserRoleAssignment
/// │   ├── reference.rs      Country · Currency · CurrencyRate · UOM*
/// │   ├── audit.rs          AuditLog · AuditRule
/// │   ├── queue.rs          QueueJob · QueueWorker
/// │   └── privacy.rs        DataClassification* · PrivacyConsent
/// │
/// ├── integrations/   ← External Service Integrations
/// │   ├── mod.rs            Shared integration utilities
/// │   ├── google_drive.rs   Google Drive connections
/// │   └── whatsapp_business.rs  WhatsApp Business accounts
/// │
/// ├── crm/            ← CRM & Contacts              [Phase 2]  (add next)
/// ├── inventory/      ← Products & Stock             [Phase 3–4]
/// ├── sales/          ← Quotations, POS, Delivery    [Phase 5]
/// ├── purchasing/     ← Purchase Orders & Vendors    [Phase 6] ✓
/// ├── accounting/     ← COA, Journals, Tax, Bank     [Phase 7–8]
/// ├── subscriptions/  ← Plans & Deferred Revenue     [Phase 9]
/// ├── manufacturing/  ← BOM, Work Orders             [Phase 10]
/// ├── projects/       ← Projects, Tasks, Timesheets  [Phase 11]
/// ├── documents/      ← Docs & Knowledge Base        [Phase 12]
/// ├── workflow/       ← Workflow Engine              [Phase 13]
/// ├── ai/             ← AI Agents & Embeddings       [Phase 14]
/// ├── data_ops/       ← Import/Export                [Phase 15]
/// └── analytics/      ← Dashboards & Metrics         [Phase 16]
/// ```
///
/// # Adding a new domain
/// 1. `mkdir src/<domain>/`
/// 2. Create `src/<domain>/mod.rs` declaring sub-modules
/// 3. In each sub-module file: define `#[spacetimedb::table]` structs and
///    `#[spacetimedb::reducer]` fns — tables and reducers co-located
/// 4. Add `pub mod <domain>;` below in this file
/// 5. Use `crate::helpers::check_permission` and `crate::helpers::write_audit_log`
///    for multi-tenancy and auditing
use spacetimedb::{ReducerContext, Table};

// ── Shared utilities ─────────────────────────────────────────────────────────
pub mod helpers;
pub mod types;

// ── Domain modules ────────────────────────────────────────────────────────────
pub mod accounting; // Phase 7–8 — Chart of Accounts, Journal Entries, Tax, Bank
pub mod core;
pub mod crm;
pub mod integrations; // Phase 2 — CRM & Contacts
pub mod inventory; // Phase 3–4 — Products & Inventory
pub mod purchasing; // Phase 6 — Purchase Orders & Supply Chain
pub mod sales; // Phase 5 — Quotations, POS, Delivery
pub mod manufacturing; // Phase 10 — BOM, Work Orders
pub mod subscriptions; // Phase 9 — Subscription & Advanced Billing
pub mod projects;   // Phase 11 — Projects, Tasks, Timesheets
pub mod documents;  // Phase 12 — Docs & Knowledge Base
pub mod workflow;   // Phase 13 — Workflow Engine
pub mod ai;         // Phase 14 — AI Agents & Embeddings
pub mod data_ops;   // Phase 15 — CSV Import/Export
pub mod analytics;  // Phase 16 — Dashboards & Metrics

use crate::core::users::{user_profile, user_session, UserProfile, UserSession};

// ── Lifecycle reducers ────────────────────────────────────────────────────────

/// Called once when the module is first published.
/// Use this to seed system roles, default currencies, etc.
#[spacetimedb::reducer(init)]
pub fn init(_ctx: &ReducerContext) {
    log::info!("Lumiere ERP module initialised");
}

/// Called every time a client connects.
/// Creates a minimal UserProfile on first connection; updates `last_login` otherwise.
#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(ctx: &ReducerContext) {
    if let Some(profile) = ctx.db.user_profile().identity().find(ctx.sender()) {
        ctx.db.user_profile().identity().update(UserProfile {
            last_login: Some(ctx.timestamp),
            updated_at: ctx.timestamp,
            ..profile
        });
    } else {
        ctx.db.user_profile().insert(UserProfile {
            identity: ctx.sender(),
            email: String::new(),
            email_verified: false,
            name: String::new(),
            first_name: None,
            last_name: None,
            avatar_url: None,
            phone: None,
            mobile: None,
            timezone: "UTC".to_string(),
            language: "en".to_string(),
            signature: None,
            notification_preferences: None,
            ui_preferences: None,
            is_active: true,
            is_superuser: false,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
            last_login: Some(ctx.timestamp),
            metadata: None,
        });
    }
}

/// Called every time a client disconnects.
/// Marks all active sessions for this identity as inactive.
#[spacetimedb::reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    let sessions: Vec<_> = ctx
        .db
        .user_session()
        .session_by_user()
        .filter(&ctx.sender())
        .filter(|s| s.is_active)
        .collect();

    for session in sessions {
        ctx.db.user_session().id().update(UserSession {
            is_active: false,
            ..session
        });
    }
}

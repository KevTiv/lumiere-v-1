//! Domain routes mirroring Next.js `/api/*` (Phase 2). Mounted under `/v1` in `http_app`.

mod accounting;
mod admin;
mod auth;
mod billing;
mod bootstrap;
mod crm;
mod documents;
mod import;
mod inventory;
mod mail;
mod messaging;
mod proposals;
pub(crate) mod reports;
mod sales;
mod session;
mod settings;
mod statement_imports;
mod stdb;
mod vertical_packs;

use std::sync::Arc;

use axum::Router;

use crate::state::AppState;

pub fn domain_router() -> Router<Arc<AppState>> {
    Router::new()
        .merge(auth::router())
        .merge(session::router())
        .merge(stdb::router())
        .merge(crm::router())
        .merge(sales::router())
        .merge(accounting::router())
        .merge(documents::router())
        .merge(mail::router())
        .merge(messaging::router())
        .merge(inventory::router())
        .merge(settings::router())
        .merge(statement_imports::router())
        .merge(bootstrap::router())
        .merge(import::router())
        .merge(billing::router())
        .merge(admin::router())
        .merge(proposals::router())
        .merge(reports::router())
        .merge(vertical_packs::router())
}

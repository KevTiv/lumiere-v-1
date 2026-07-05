//! Domain routes mirroring Next.js `/api/*` (Phase 2). Mounted under `/v1` in `http_app`.

mod accounting;
mod auth;
mod bootstrap;
mod crm;
mod documents;
mod inventory;
mod mail;
mod proposals;
mod sales;
mod session;
mod settings;
mod stdb;

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
        .merge(inventory::router())
        .merge(settings::router())
        .merge(bootstrap::router())
        .merge(proposals::router())
}

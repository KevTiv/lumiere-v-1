//! Domain routes mirroring Next.js `/api/*` (Phase 2). Mounted under `/v1` in `http_app`.

mod accounting;
mod admin;
mod ai_capabilities;
mod ai_certifications;
mod ai_evidence;
pub(crate) mod auth;
mod billing;
mod bootstrap;
mod country_packs;
mod crm;
mod documents;
mod evidence_inspection;
mod finance_reviews;
pub(crate) mod health;
mod history;
mod import;
mod import_reviews;
mod inventory;
mod knowledge_guides;
mod mail;
mod messaging;
pub(crate) mod operations;
mod presentation;
mod proposals;
pub(crate) mod queries;
pub(crate) mod reports;
mod rwanda_statutory_readiness;
mod sales;
mod session;
mod settings;
mod statement_imports;
mod statutory_adapters;
mod vertical_packs;
mod whatsapp_webhooks;

use std::sync::Arc;

use axum::Router;

use crate::state::AppState;

pub fn domain_router() -> Router<Arc<AppState>> {
    Router::new()
        .merge(ai_capabilities::router())
        .merge(ai_certifications::router())
        .merge(ai_evidence::router())
        .merge(crate::evidence_ingestion::router())
        .merge(evidence_inspection::router())
        .merge(finance_reviews::router())
        .merge(auth::router())
        .merge(session::router())
        .merge(crm::router())
        .merge(sales::router())
        .merge(accounting::router())
        .merge(history::router())
        .merge(documents::router())
        .merge(knowledge_guides::router())
        .merge(mail::router())
        .merge(messaging::router())
        .merge(inventory::router())
        .merge(settings::router())
        .merge(statement_imports::router())
        .merge(bootstrap::router())
        .merge(import::router())
        .merge(import_reviews::router())
        .merge(billing::router())
        .merge(admin::router())
        .merge(proposals::router())
        .merge(presentation::router())
        .merge(reports::router())
        .merge(country_packs::router())
        .merge(statutory_adapters::router())
        .merge(rwanda_statutory_readiness::router())
        .merge(vertical_packs::router())
        .merge(whatsapp_webhooks::router())
}

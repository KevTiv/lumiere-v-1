//! Fail-closed Phase 1 policy endpoint.
//!
//! This path uses only exact, promoted manifests from the in-process reviewed registry. It does
//! not load remote or bundled skills and performs no live database access.

use axum::Json;

use crate::harness::{
    audit::PolicyResult,
    policy_engine::{PolicyControlledRequest, PolicyEngine},
};

pub async fn post_evaluate(Json(request): Json<PolicyControlledRequest>) -> Json<PolicyResult> {
    Json(PolicyEngine::default().execute_controlled(request))
}

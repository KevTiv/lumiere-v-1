//! Authentication route wiring and feature-module composition.

use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;

use crate::state::AppState;

mod cookies;
mod invitations;
mod password;
mod profile;
mod recovery;
mod service_bridge;

use self::invitations::{accept_invite, invite};
use self::password::{signin, signout, signup};
use self::profile::{profile_get, profile_update};
use self::recovery::{forgot_password, reset_password};
use self::service_bridge::{bootstrap_credential, workos_bridge};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/signin", post(signin))
        .route("/auth/signup", post(signup))
        .route("/auth/workos/bridge", post(workos_bridge))
        .route(
            "/auth/internal/bootstrap-credential",
            post(bootstrap_credential),
        )
        .route("/auth/profile", get(profile_get).patch(profile_update))
        .route("/auth/signout", post(signout))
        .route("/auth/forgot-password", post(forgot_password))
        .route("/auth/reset-password", post(reset_password))
        .route("/auth/invite", post(invite))
        .route("/auth/accept-invite", post(accept_invite))
}

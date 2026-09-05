//! Polls pending project integration intents (payroll / calendar / e-invoice) and applies them.
//!
//! Configure with:
//! - `LUMIERE_PROJECT_WORKER_ORG_IDS` — comma-separated organization ids (required)
//! - `LUMIERE_PROJECT_WORKER_POLL_SECS` — poll interval (default 15)
//! - `LUMIERE_PROJECT_WORKER_PORT` — health port (default 8093)
//! - `LUMIERE_PROJECT_WORKER_BATCH` — max intents per org per tick (default 20)

use crate::integration_worker::{self, IntegrationWorkerSpec};

/// Start the project integration worker.
pub async fn serve() -> anyhow::Result<()> {
    integration_worker::serve(IntegrationWorkerSpec {
        env_prefix: "PROJECT",
        default_port: 8093,
        reducer_name: "apply_pending_project_integration_intents",
        log_label: "project integration worker",
    })
    .await
}

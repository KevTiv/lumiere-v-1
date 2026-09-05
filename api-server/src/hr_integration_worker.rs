//! Polls pending HR integration intents (STP / eSocial / CPF / SARS / bank / partner payroll) and applies them.
//!
//! Workers perform external HTTP/file exchange outside WASM; this service only flushes pending
//! intents via `apply_pending_hr_integration_intents` (payload must contain worker-prepared results).
//!
//! Configure with:
//! - `LUMIERE_HR_WORKER_ORG_IDS` — comma-separated organization ids (required)
//! - `LUMIERE_HR_WORKER_POLL_SECS` — poll interval (default 15)
//! - `LUMIERE_HR_WORKER_PORT` — health port (default 8094)
//! - `LUMIERE_HR_WORKER_BATCH` — max intents per org per tick (default 20)

use crate::integration_worker::{self, IntegrationWorkerSpec};

/// Start the HR integration worker.
pub async fn serve() -> anyhow::Result<()> {
    integration_worker::serve(IntegrationWorkerSpec {
        env_prefix: "HR",
        default_port: 8094,
        reducer_name: "apply_pending_hr_integration_intents",
        log_label: "hr integration worker",
    })
    .await
}

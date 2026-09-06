//! Polls pending expense integration intents (OCR / email inbox / card_feed) and applies them.
//!
//! # Worker contract (OCR / email)
//!
//! Upstream ingest (OCR pipeline, email parser) must **create**
//! `expense_integration_intent` rows with:
//!
//! | Field | Required | Notes |
//! |-------|----------|-------|
//! | `intent_type` | yes | `ocr_receipt` or `email_inbox` (also `card_feed` / `delayed_sync` / `fx_rate`) |
//! | `idempotency_key` | yes | Stable unique key per blob / message |
//! | `payload.employee_id` | yes | u64 |
//! | `payload.currency_id` | yes | u64 |
//! | `payload.storage_key` | **yes for OCR/email** | Opaque object-store key; apply rejects empty/missing |
//! | `payload.content_hash` | optional | Feeds duplicate / fraud_hold when shared across receipts |
//! | `payload.file_name` / `mime_type` | optional | Stored on `hr_expense_receipt` |
//! | `payload.unit_amount` / `quantity` / `name` | optional | Expense line fields |
//!
//! On apply (`apply_pending_expense_integration_intents` / `apply_expense_integration_intent`):
//! 1. Insert `hr_expense_receipt` with `storage_key` (+ optional `content_hash`)
//! 2. `create_expense` with that receipt id in `attachment_ids` — **never** stub id `1`
//!
//! This worker only flushes pending intents; it does not upload blobs.
//!
//! Configure with:
//! - `LUMIERE_EXPENSE_WORKER_ORG_IDS` — comma-separated organization ids (required)
//! - `LUMIERE_EXPENSE_WORKER_POLL_SECS` — poll interval (default 15)
//! - `LUMIERE_EXPENSE_WORKER_PORT` — health port (default 8092)
//! - `LUMIERE_EXPENSE_WORKER_BATCH` — max intents per org per tick (default 20)

use crate::integration_worker::{self, IntegrationWorkerSpec};

/// Start the expense integration worker.
pub async fn serve() -> anyhow::Result<()> {
    integration_worker::serve(IntegrationWorkerSpec {
        env_prefix: "EXPENSE",
        default_port: 8092,
        reducer_name: "apply_pending_expense_integration_intents",
        log_label: "expense integration worker",
    })
    .await
}

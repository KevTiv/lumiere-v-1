export type ReducerClassification =
  | "user-facing"
  | "admin"
  | "import"
  | "internal/background"
  | "dev-only"
  | "deprecated"

export const EXPLICIT_REDUCER_CLASSIFICATIONS: Record<
  string,
  ReducerClassification
> = {
  backfill_external_ids: "internal/background",
  bootstrap_new_tenant: "internal/background",
  dev_promote_caller_superuser: "dev-only",
  ensure_dev_admin: "dev-only",
  link_workos_user: "internal/background",
  mark_embedding_synced: "internal/background",
  mark_reset_token_used: "internal/background",
  record_google_drive_sync: "internal/background",
  record_google_drive_sync_error: "internal/background",
  record_whatsapp_health_check: "internal/background",
  record_whatsapp_message_sent: "internal/background",
  request_embedding_job: "internal/background",
  seed_demo_data: "dev-only",
  upsert_search_embedding: "internal/background",
  update_integration_status: "internal/background",
  update_whatsapp_verification_status: "internal/background",
  worker_heartbeat: "internal/background",
}

export const INTENTIONALLY_API_ONLY_REDUCERS: Record<string, string> = {
  delete_search_embedding: "Search index maintenance is triggered by backend jobs.",
  mark_action_sent: "IoT hub/device bridge lifecycle is not initiated from browser UI.",
  process_pending_scans: "Barcode worker flush; users initiate scans through inventory actions.",
  record_google_drive_sync:
    "Google Drive workers own synchronization timestamps and health state.",
  record_google_drive_sync_error:
    "Google Drive workers own synchronization errors and connection health state.",
  record_whatsapp_health_check:
    "WhatsApp workers own provider health observations.",
  record_whatsapp_message_sent:
    "WhatsApp delivery workers own sent-message quota accounting.",
  update_device_status: "IoT device heartbeat/status is bridge-owned.",
  update_integration_status:
    "Integration lifecycle status is machine-owned and cannot be forged by browser sessions.",
  update_tax_deadlines:
    "Scheduled reducer; browser UI calls refresh_tax_deadline_statuses instead.",
  update_whatsapp_verification_status:
    "WhatsApp verification state is updated only from trusted provider callbacks.",
}

export function classifyReducerByHeuristic(
  reducerName: string,
  moduleName: string,
): ReducerClassification {
  const explicit = EXPLICIT_REDUCER_CLASSIFICATIONS[reducerName]
  if (explicit) return explicit

  if (/^(seed_|ensure_dev|dev_)/.test(reducerName)) return "dev-only"
  if (/^import_/.test(reducerName)) return "import"
  if (
    /^(queue_|worker_|mark_|request_embedding_|upsert_search_embedding|delete_search_embedding)/.test(
      reducerName,
    )
  ) {
    return "internal/background"
  }
  if (
    moduleName === "auth" ||
    moduleName === "settings" ||
    /^(audit_|role_|user_|org_|privacy_|credential_|sso_|invite_|password_)/.test(
      reducerName,
    )
  ) {
    return "admin"
  }
  return "user-facing"
}

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
  request_embedding_job: "internal/background",
  seed_demo_data: "dev-only",
  upsert_search_embedding: "internal/background",
  worker_heartbeat: "internal/background",
}

export const INTENTIONALLY_API_ONLY_REDUCERS: Record<string, string> = {
  delete_search_embedding: "Search index maintenance is triggered by backend jobs.",
  mark_action_sent: "IoT hub/device bridge lifecycle is not initiated from browser UI.",
  process_pending_scans: "Barcode worker flush; users initiate scans through inventory actions.",
  update_device_status: "IoT device heartbeat/status is bridge-owned.",
  update_tax_deadlines:
    "Scheduled reducer; browser UI calls refresh_tax_deadline_statuses instead.",
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

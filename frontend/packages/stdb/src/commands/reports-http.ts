import type { ReducerCommandContractMeta } from "./types";

/**
 * Reports mutations via the api-server BFF `POST /api/operations/:operation`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` reports hooks.
 */
export const REPORTS_BFF_REDUCERS = [
  "add_widget_to_dashboard",
  "archive_financial_report",
  "create_analytics_metric",
  "create_dashboard",
  "create_dashboard_widget",
  "create_financial_report",
  "create_report_template",
  "create_scheduled_report",
  "create_saved_report",
  "create_trial_balance_entry",
  "delete_financial_report",
  "delete_saved_report",
  "export_financial_report",
  "generate_eu_vat_report",
  "generate_financial_report",
  "import_analytics_metric_csv",
  "import_report_template_csv",
  "record_report_run",
  "share_dashboard",
  "update_financial_report",
  "update_metric_values",
  "update_report_template",
  "update_saved_report",
  "update_widget_layout",
] as const;

export type ReportsBffReducerKey = (typeof REPORTS_BFF_REDUCERS)[number];

const REPORTS_MODULE_RESOURCES = [
  "financial-reports",
  "trial-balances",
  "report-templates",
  "scheduled-reports",
  "analytics-metrics",
  "saved-reports",
] as const;

const REPORTS_HINT_OVERRIDES: Partial<
  Record<ReportsBffReducerKey, readonly string[]>
> = {
  import_report_template_csv: ["report-templates"],
  import_analytics_metric_csv: ["analytics-metrics"],
};

function reportsReducerHints(): Record<ReportsBffReducerKey, readonly string[]> {
  const o = {} as Record<ReportsBffReducerKey, readonly string[]>;
  for (const k of REPORTS_BFF_REDUCERS) {
    o[k] = REPORTS_HINT_OVERRIDES[k] ?? REPORTS_MODULE_RESOURCES;
  }
  return o;
}

export const REPORTS_COMMAND_SUBSCRIPTION_HINTS: Record<
  ReportsBffReducerKey,
  readonly string[]
> = reportsReducerHints();

export function reportsCommandContract(
  reducer: ReportsBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Reports reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: REPORTS_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}

import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * HR mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` HR hooks.
 */
export const HR_BFF_REDUCERS = [
  "approve_leave",
  "archive_employee",
  "cancel_contract",
  "cancel_payslip",
  "confirm_payslip",
  "create_contract",
  "create_department",
  "create_employee",
  "create_job_position",
  "create_leave_request",
  "create_leave_type",
  "create_payroll_structure",
  "create_payslip",
  "create_salary_rule",
  "expire_contract",
  "import_hr_contract_csv",
  "import_hr_department_csv",
  "import_hr_employee_csv",
  "import_hr_job_position_csv",
  "import_hr_leave_csv",
  "import_hr_leave_type_csv",
  "import_hr_payroll_structure_csv",
  "import_hr_payslip_csv",
  "import_hr_resource_csv",
  "import_hr_salary_rule_csv",
  "open_contract",
  "refuse_leave",
  "reset_leave_to_draft",
  "update_contract",
  "update_department",
  "update_employee",
  "update_job_position",
  "update_leave_type",
] as const;

export type HrBffReducerKey = (typeof HR_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<HrBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function hrBffCallUrl(reducer: HrBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function hrBffPost(
  reducer: HrBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: hrBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

const HR_HINT_OVERRIDES: Partial<Record<HrBffReducerKey, readonly string[]>> = {
  approve_leave: ["leave-requests"],
  archive_employee: ["employees"],
  cancel_contract: ["contracts"],
  cancel_payslip: ["payslips"],
  confirm_payslip: ["payslips"],
  create_contract: ["contracts"],
  create_department: ["departments"],
  create_employee: ["employees"],
  create_job_position: ["job-positions"],
  create_leave_request: ["leave-requests"],
  create_leave_type: ["leave-types"],
  create_payroll_structure: ["payroll-structures"],
  create_payslip: ["payslips"],
  create_salary_rule: ["salary-rules"],
  expire_contract: ["contracts"],
  import_hr_contract_csv: ["contracts"],
  import_hr_department_csv: ["departments"],
  import_hr_employee_csv: ["employees"],
  import_hr_job_position_csv: ["job-positions"],
  import_hr_leave_csv: ["leave-requests"],
  import_hr_leave_type_csv: ["leave-types"],
  import_hr_payroll_structure_csv: ["payroll-structures"],
  import_hr_payslip_csv: ["payslips"],
  import_hr_resource_csv: [],
  import_hr_salary_rule_csv: ["salary-rules"],
  open_contract: ["contracts"],
  refuse_leave: ["leave-requests"],
  reset_leave_to_draft: ["leave-requests"],
  update_contract: ["contracts"],
  update_department: ["departments"],
  update_employee: ["employees"],
  update_job_position: ["job-positions"],
  update_leave_type: ["leave-types"],
};

function hrReducerHints(): Record<HrBffReducerKey, readonly string[]> {
  const o = {} as Record<HrBffReducerKey, readonly string[]>;
  for (const k of HR_BFF_REDUCERS) {
    o[k] = HR_HINT_OVERRIDES[k] ?? [];
  }
  return o;
}

export const HR_COMMAND_SUBSCRIPTION_HINTS: Record<
  HrBffReducerKey,
  readonly string[]
> = hrReducerHints();

export function hrCommandContract(
  reducer: HrBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `HR reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: HR_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}

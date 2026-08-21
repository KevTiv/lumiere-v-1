
import type { ReducerCommandContractMeta } from "./types";

/**
 * HR mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` HR hooks.
 */
export const HR_BFF_REDUCERS = [
  "approve_leave",
  "archive_employee",
  "assign_onboarding_template",
  "cancel_contract",
  "cancel_payslip",
  "complete_offboarding_item",
  "complete_onboarding_item",
  "confirm_payslip",
  "create_hr_employee_document",
  "create_benefit_plan",
  "create_onboarding_template",
  "create_payroll_export_intent",
  "create_hr_integration_intent",
  "record_hr_integration_result",
  "apply_hr_integration_intent",
  "apply_pending_hr_integration_intents",
  "create_performance_cycle",
  "add_performance_goal",
  "submit_performance_review",
  "complete_performance_review",
  "assign_benefit_enrollment",
  "unenroll_benefit_enrollment",
  "create_contract",
  "create_attendance_punch",
  "create_work_schedule",
  "create_hr_labor_cost_snapshot",
  "create_hr_shift_opt_job",
  "refresh_hr_capacity_forecast",
  "create_hr_global_assignment",
  "update_hr_global_assignment",
  "delete_hr_global_assignment",
  "create_hr_applicant",
  "update_hr_applicant",
  "create_department",
  "create_employee",
  "create_hr_employee_skill",
  "create_hr_skill",
  "create_job_position",
  "create_leave_request",
  "create_leave_type",
  "create_payroll_structure",
  "create_payslip",
  "create_salary_rule",
  "delete_hr_employee_document",
  "delete_hr_employee_skill",
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
  "mark_onboarding_done",
  "open_contract",
  "post_payslip",
  "record_payroll_export_result",
  "refuse_leave",
  "reset_leave_to_draft",
  "start_offboarding",
  "submit_leave",
  "update_contract",
  "update_department",
  "update_employee",
  "update_hr_employee_skill",
  "update_hr_skill",
  "update_job_position",
  "update_leave_type",
  "create_statutory_id",
  "delete_statutory_id",
  "seed_hr_country_pack_overlays",
  "update_statutory_id",
] as const;

export type HrBffReducerKey = (typeof HR_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<HrBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function hrBffCallUrl(reducer: HrBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

const HR_HINT_OVERRIDES: Partial<Record<HrBffReducerKey, readonly string[]>> = {
  approve_leave: ["leave-requests", "leaves-to-approve", "resource-capacity-by-employee"],
  archive_employee: ["employees"],
  assign_onboarding_template: ["onboarding-progress", "employees"],
  complete_offboarding_item: ["employees"],
  complete_onboarding_item: ["onboarding-progress"],
  create_hr_employee_document: ["employee-documents"],
  create_onboarding_template: ["onboarding-templates", "onboarding-template-items"],
  create_performance_cycle: ["performance-cycles"],
  add_performance_goal: ["performance-goals", "performance-reviews"],
  submit_performance_review: ["performance-reviews"],
  complete_performance_review: ["performance-reviews"],
  create_benefit_plan: ["benefit-plans"],
  assign_benefit_enrollment: ["benefit-enrollments"],
  unenroll_benefit_enrollment: ["benefit-enrollments"],
  delete_hr_employee_document: ["employee-documents"],
  mark_onboarding_done: ["onboarding-progress", "employees"],
  cancel_contract: ["contracts"],
  cancel_payslip: ["payslips", "payslips-to-export"],
  confirm_payslip: ["payslips", "payslips-to-export"],
  create_payroll_export_intent: ["payslips", "payslips-to-export", "hr-integration-intents"],
  create_hr_integration_intent: ["hr-integration-intents", "payslips", "payslips-to-export"],
  record_hr_integration_result: ["hr-integration-intents", "payslips", "payslips-to-export"],
  apply_hr_integration_intent: ["hr-integration-intents", "payslips", "payslips-to-export"],
  apply_pending_hr_integration_intents: ["hr-integration-intents", "payslips", "payslips-to-export"],
  create_statutory_id: ["hr-statutory-ids"],
  delete_statutory_id: ["hr-statutory-ids"],
  update_statutory_id: ["hr-statutory-ids"],
  create_contract: ["contracts", "compensation-events"],
  create_attendance_punch: ["attendance"],
  create_work_schedule: ["work-schedules"],
  create_hr_labor_cost_snapshot: ["labor-cost-snapshots"],
  create_hr_shift_opt_job: ["shift-opt-jobs"],
  refresh_hr_capacity_forecast: ["hr-capacity-forecast"],
  create_hr_global_assignment: ["global-assignments"],
  update_hr_global_assignment: ["global-assignments"],
  delete_hr_global_assignment: ["global-assignments"],
  create_hr_applicant: ["applicants"],
  update_hr_applicant: ["applicants"],
  create_department: ["departments"],
  create_employee: ["employees"],
  create_hr_employee_skill: ["hr-employee-skills"],
  create_hr_skill: ["hr-skills"],
  create_job_position: ["job-positions"],
  create_leave_request: ["leave-requests"],
  create_leave_type: ["leave-types"],
  create_payroll_structure: ["payroll-structures"],
  create_payslip: ["payslips"],
  create_salary_rule: ["salary-rules"],
  delete_hr_employee_skill: ["hr-employee-skills"],
  expire_contract: ["contracts"],
  import_hr_contract_csv: ["contracts"],
  import_hr_department_csv: ["departments"],
  import_hr_employee_csv: ["employees"],
  import_hr_job_position_csv: ["job-positions"],
  import_hr_leave_csv: ["leave-requests", "leaves-to-approve"],
  import_hr_leave_type_csv: ["leave-types"],
  import_hr_payroll_structure_csv: ["payroll-structures"],
  import_hr_payslip_csv: ["payslips", "payslips-to-export"],
  import_hr_resource_csv: ["hr-resources"],
  import_hr_salary_rule_csv: ["salary-rules"],
  open_contract: ["contracts"],
  post_payslip: ["payslips", "payslips-to-export"],
  record_payroll_export_result: ["payslips", "payslips-to-export"],
  refuse_leave: ["leave-requests", "leaves-to-approve"],
  reset_leave_to_draft: ["leave-requests", "leaves-to-approve"],
  start_offboarding: ["employees"],
  submit_leave: ["leave-requests", "leaves-to-approve"],
  update_contract: ["contracts", "compensation-events"],
  update_department: ["departments"],
  update_employee: ["employees"],
  update_hr_employee_skill: ["hr-employee-skills"],
  update_hr_skill: ["hr-skills"],
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

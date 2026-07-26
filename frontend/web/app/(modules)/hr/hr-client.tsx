"use client"
import { mapDashboardWidgets, withDashboardSections } from "@lumiere/ui/lib/dashboard-sections"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  ModuleView,
  FormModal,
  CsvImportModal,
  newEmployeeForm,
  newLeaveRequestForm,
  newContractForm,
  newPayslipForm,
  newJobPositionForm,
  newDepartmentForm,
  newLeaveTypeForm,
  newPayrollStructureForm,
  newSalaryRuleForm,
  newAttendancePunchForm,
  editEmployeeForm,
  editDepartmentForm,
  editJobPositionForm,
  editContractForm,
  editLeaveTypeForm,
  MissingOrganization,
  mergeFieldDefaultValues,
  mergeSelectOptionsForFields,
  hrCsvImportForm,
  employeeDetailConfig,
  leaveDetailConfig,
  contractDetailConfig,
  employeeStatusBadges,
  leaveRequestStatusBadges,
  contractStatusBadges,
  type TimeRangeValue,
  isTimestampInRange,
  percentChange,
  previousPeriodMs,
  timeRangeToMs,
} from "@lumiere/ui"
import type { EntityRecordSheetConfig, EntityViewConfig, FormConfig, HrCsvImportKind, ModuleConfig } from "@lumiere/ui"
import type { QueryRows } from "@lumiere/query-hooks/http"
import { hrModuleConfig } from "@/lib/module-dashboard-configs"
import { useHrModuleSubscription } from "@/lib/module-subscription-hooks"
import { groupBy } from "@/lib/utils"
import {
  useEmployees,
  useDepartments,
  useLeaveRequests,
  useLeavesToApprove,
  useContracts,
  usePayslips,
  usePayslipsToExport,
  useHrIntegrationIntentsPending,
  useJobPositions,
  useLeaveTypes,
  usePayrollStructures,
  useSalaryRules,
  useAttendance,
  useCompensationEvents,
  useLaborCostSnapshots,
  useShiftOptJobs,
  useGlobalAssignments,
  useHrCapacityForecast,
  useCreateEmployee,
  useCreateLeaveRequest,
  useCreateContract,
  useCreatePayslip,
  useCreateJobPosition,
  useCreateDepartment,
  useCreateLeaveType,
  useCreatePayrollStructure,
  useCreateSalaryRule,
  useCreateAttendancePunch,
  useUpdateEmployee,
  useUpdateDepartment,
  useUpdateJobPosition,
  useUpdateContract,
  useUpdateLeaveType,
  useArchiveEmployee,
  useStartOffboarding,
  useCompleteOffboardingItem,
  useApproveLeave,
  useRefuseLeave,
  useResetLeaveToDraft,
  useSubmitLeave,
  useOpenContract,
  useExpireContract,
  useCancelContract,
  useConfirmPayslip,
  useCancelPayslip,
  useCreatePayrollExportIntent,
  useCreateHrIntegrationIntent,
  usePostPayslip,
  useHrCsvImportMutations,
  useOnboardingTemplates,
  useCreateOnboardingTemplate,
  useApplicants,
} from "@lumiere/query-hooks/hooks/hr"
import { OrgChartPanel, CompensationTimelinePanel, HrOpsQueuePanel, HrAdvancedWfmPanel, LeaveApprovalTimelinePanel } from "./hr-panels"
import { HrOnboardingPanel } from "./hr-onboarding-panel"
import { HrDocumentsPanel } from "./hr-documents-panel"
import { HrPerformancePanel } from "./hr-performance-panel"
import { HrBenefitsPanel } from "./hr-benefits-panel"
import { HrRecruitmentPanel } from "./hr-recruitment-panel"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { useDefaultOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company"
import { usePricelists } from "@lumiere/query-hooks/hooks/sales"
import {
  toCreateContractParams,
  toCreateDepartmentParams,
  toCreateEmployeeParams,
  toCreateJobPositionParams,
  toCreateLeaveRequestParams,
  toCreateLeaveTypeParams,
  toCreatePayrollStructureParams,
  toCreatePayslipParams,
  toCreateSalaryRuleParams,
  toCreateAttendancePunchParams,
} from "@/lib/hr-create-params"
import {
  contractRowToFormDefaults,
  departmentRowToFormDefaults,
  employeeRowToFormDefaults,
  jobPositionRowToFormDefaults,
  leaveTypeRowToFormDefaults,
  toUpdateContractParams,
  toUpdateDepartmentParams,
  toUpdateEmployeeParams,
  toUpdateJobPositionParams,
  toUpdateLeaveTypeParams,
} from "@/lib/hr-update-params"
import {
  pricelistRowsToSelectOptions,
  employeeRowsToSelectOptions,
  departmentRowsToSelectOptions,
  leaveTypeRowsToSelectOptions,
  payrollStructureRowsToSelectOptions,
} from "@/lib/form-lookup"

export { HR_UI_REDUCERS } from "@/lib/hr-ui-reducers"

type HrUpdateAction =
  | "updateEmployee"
  | "updateDepartment"
  | "updateJobPosition"
  | "updateContract"
  | "updateLeaveType"

type HrRowAction =
  | { action: "archiveEmployee"; rows: Record<string, unknown>[]; form: FormConfig }
  | { action: "confirmPayslip"; rows: Record<string, unknown>[]; form: FormConfig }
  | { action: "postPayslip"; rows: Record<string, unknown>[]; form: FormConfig }
  | { action: HrUpdateAction; row: Record<string, unknown>; form: FormConfig }
  | null

const PENDING_LEAVE_STATES = new Set(["Confirm", "ValidatedOne"])

function isPendingLeaveState(state: unknown): boolean {
  return PENDING_LEAVE_STATES.has(String(state))
}

function payslipState(row: Record<string, unknown>): string {
  return String(row.state ?? row.State ?? "")
}

function employeeRowId(row: Record<string, unknown>): number {
  return Number(row.id ?? row.Id ?? 0)
}

const newOnboardingTemplateForm: FormConfig = {
  id: "new-onboarding-template",
  title: "New onboarding template",
  submitLabel: "Create template",
  sections: [
    {
      id: "template-fields",
      fields: [
        {
          id: "template-name",
          type: "text",
          name: "name",
          label: "Template name",
          required: true,
        },
        {
          id: "template-description",
          type: "text",
          name: "description",
          label: "Description",
        },
      ],
    },
  ],
}

const archiveEmployeeForm: FormConfig = {
  id: "archive-employee",
  title: "Archive Employee",
  submitLabel: "Archive employee",
  sections: [
    {
      id: "offboarding",
      title: "Offboarding checklist",
      description:
        "Complete assets, access, and docs before archive. Unchecked items require an override reason.",
      fields: [
        {
          id: "assets-returned",
          type: "switch",
          name: "assetsReturned",
          label: "Assets returned",
          defaultValue: true,
          width: "1/2",
        },
        {
          id: "access-revoked",
          type: "switch",
          name: "accessRevoked",
          label: "Access revoked",
          defaultValue: true,
          width: "1/2",
        },
        {
          id: "docs-collected",
          type: "switch",
          name: "docsCollected",
          label: "Docs collected",
          defaultValue: true,
          width: "1/2",
        },
        {
          id: "override-reason",
          type: "text",
          name: "overrideReason",
          label: "Override reason (if checklist incomplete)",
        },
        {
          id: "termination-date",
          type: "date",
          name: "terminationDate",
          label: "Termination date",
        },
      ],
    },
  ],
}

const approvePayslipForm: FormConfig = {
  id: "approve-payslip",
  title: "Approve Payslip for Export",
  submitLabel: "Approve for export",
  sections: [
    {
      id: "wages",
      fields: [
        {
          id: "gross-wage",
          type: "number",
          name: "grossWage",
          label: "Proposed gross wage",
          width: "1/2",
        },
        {
          id: "net-wage",
          type: "number",
          name: "netWage",
          label: "Proposed net wage",
          width: "1/2",
        },
      ],
    },
  ],
}

const postPayslipForm: FormConfig = {
  id: "post-payslip",
  title: "Post Payslip to GL",
  submitLabel: "Post to GL",
  sections: [
    {
      id: "accounts",
      fields: [
        {
          id: "journal-id",
          type: "number",
          name: "journalId",
          label: "Journal ID",
          width: "1/2",
        },
        {
          id: "accounting-date",
          type: "date",
          name: "accountingDate",
          label: "Accounting date",
          width: "1/2",
        },
        {
          id: "expense-account-id",
          type: "number",
          name: "expenseAccountId",
          label: "Payroll expense account ID",
          width: "1/2",
        },
        {
          id: "payable-account-id",
          type: "number",
          name: "payableAccountId",
          label: "Salaries payable account ID",
          width: "1/2",
        },
        {
          id: "tax-account-id",
          type: "number",
          name: "taxWithholdingAccountId",
          label: "Tax withholding account ID (if gross ≠ net)",
          width: "1/2",
        },
      ],
    },
  ],
}

function recordTimestampMs(row: Record<string, unknown>): number {
  const raw = row.writeDate ?? row.write_date ?? row.createDate ?? row.create_date
  if (raw == null) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 1e15 ? n / 1000 : n
}

function employeeStartMs(row: Record<string, unknown>): number {
  const raw =
    row.hireDate ?? row.hire_date ?? row.createDate ?? row.create_date ?? row.writeDate ?? row.write_date
  if (raw == null) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n > 1e15 ? n / 1000 : n
}

function attachEmptyStateAction(
  ec: EntityViewConfig,
  onAction: () => void,
): EntityViewConfig {
  if (ec.view.mode !== "table") return ec
  if (!ec.view.emptyState) return ec
  return {
    ...ec,
    view: {
      ...ec.view,
      emptyState: { ...ec.view.emptyState, onAction },
    },
  }
}

interface HrClientProps {
  initialEmployees?: Record<string, unknown>[]
  initialDepartments?: Record<string, unknown>[]
  initialLeaves?: Record<string, unknown>[]
  initialContracts?: Record<string, unknown>[]
  initialPayslips?: Record<string, unknown>[]
  initialPricelists?: Record<string, unknown>[]
  organizationId?: number
}

type HrClientLoadedProps = Omit<HrClientProps, "organizationId"> & {
  organizationId: number
}

export function HrClient(props: HrClientProps) {
  if (!hasValidOrganizationId(props.organizationId)) {
    return <MissingOrganization />
  }
  return <HrClientLoaded {...props} organizationId={props.organizationId} />
}

function HrClientLoaded({
  initialEmployees,
  initialDepartments,
  initialLeaves,
  initialContracts,
  initialPayslips,
  initialPricelists,
  organizationId,
}: HrClientLoadedProps) {
  useHrModuleSubscription()
  const { t } = useTranslation()
  const { orgId } = orgBigInts(organizationId)
  const operatingCompanyId = useDefaultOperatingCompanyBigInt(organizationId)
  const [quickActionForm, setQuickActionForm] = useState<{ form: FormConfig; action: string } | null>(null)
  const [csvKind, setCsvKind] = useState<HrCsvImportKind | null>(null)
  const [toolbarError, setToolbarError] = useState<string | null>(null)
  const [rowAction, setRowAction] = useState<HrRowAction>(null)
  const [rowActionError, setRowActionError] = useState<string | null>(null)
  const [dashboardTimeRange, setDashboardTimeRange] = useState<TimeRangeValue>("30d")

  const { data: employees = [], isLoading: employeesLoading } = useEmployees(orgId, initialEmployees)
  const { data: departments = [] } = useDepartments(orgId, initialDepartments)
  const { data: leaves = [], isLoading: leavesLoading } = useLeaveRequests(orgId, initialLeaves)
  const { data: leavesToApprove = [] } = useLeavesToApprove(orgId)
  const { data: contracts = [], isLoading: contractsLoading } = useContracts(orgId, initialContracts)
  const { data: payslips = [] } = usePayslips(orgId, initialPayslips)
  const { data: payslipsToExport = [] } = usePayslipsToExport(orgId)
  const { data: hrIntegrationIntentsPending = [] } = useHrIntegrationIntentsPending(orgId)
  const { data: jobPositions = [] } = useJobPositions(orgId)
  const { data: applicants = [] } = useApplicants(orgId)
  const { data: leaveTypes = [] } = useLeaveTypes(orgId)
  const { data: payrollStructures = [] } = usePayrollStructures(orgId)
  const { data: salaryRules = [] } = useSalaryRules(orgId)
  const { data: onboardingTemplates = [] } = useOnboardingTemplates(orgId)
  const { data: attendance = [] } = useAttendance(orgId)
  const { data: compensationEvents = [] } = useCompensationEvents(orgId)
  const { data: laborCostSnapshots = [] } = useLaborCostSnapshots(orgId)
  const { data: shiftOptJobs = [] } = useShiftOptJobs(orgId)
  const { data: globalAssignments = [] } = useGlobalAssignments(orgId)
  const { data: hrCapacityForecast = [] } = useHrCapacityForecast(orgId)
  const { data: pricelists = [] } = usePricelists(orgId, initialPricelists)

  const createEmployee = useCreateEmployee(orgId, operatingCompanyId)
  const createLeaveRequest = useCreateLeaveRequest(orgId, operatingCompanyId)
  const createContract = useCreateContract(orgId, operatingCompanyId)
  const createPayslip = useCreatePayslip(orgId, operatingCompanyId)
  const createJobPosition = useCreateJobPosition(orgId, operatingCompanyId)
  const createDepartment = useCreateDepartment(orgId, operatingCompanyId)
  const createLeaveType = useCreateLeaveType(orgId, operatingCompanyId)
  const createPayrollStructure = useCreatePayrollStructure(orgId, operatingCompanyId)
  const createSalaryRule = useCreateSalaryRule(orgId, operatingCompanyId)
  const createAttendancePunch = useCreateAttendancePunch(orgId, operatingCompanyId)
  const updateEmployee = useUpdateEmployee(orgId, operatingCompanyId)
  const updateDepartment = useUpdateDepartment(orgId, operatingCompanyId)
  const updateJobPosition = useUpdateJobPosition(orgId, operatingCompanyId)
  const updateContract = useUpdateContract(orgId, operatingCompanyId)
  const updateLeaveType = useUpdateLeaveType(orgId, operatingCompanyId)
  const archiveEmployee = useArchiveEmployee(orgId, operatingCompanyId)
  const startOffboarding = useStartOffboarding(orgId, operatingCompanyId)
  const completeOffboardingItem = useCompleteOffboardingItem(orgId, operatingCompanyId)
  const approveLeave = useApproveLeave(orgId, operatingCompanyId)
  const refuseLeave = useRefuseLeave(orgId, operatingCompanyId)
  const resetLeave = useResetLeaveToDraft(orgId, operatingCompanyId)
  const submitLeave = useSubmitLeave(orgId, operatingCompanyId)
  const openContract = useOpenContract(orgId, operatingCompanyId)
  const expireContract = useExpireContract(orgId, operatingCompanyId)
  const cancelContract = useCancelContract(orgId, operatingCompanyId)
  const confirmPayslip = useConfirmPayslip(orgId, operatingCompanyId)
  const cancelPayslip = useCancelPayslip(orgId, operatingCompanyId)
  const createPayrollExportIntent = useCreatePayrollExportIntent(orgId, operatingCompanyId)
  const createHrIntegrationIntent = useCreateHrIntegrationIntent(orgId, operatingCompanyId)
  const postPayslip = usePostPayslip(orgId, operatingCompanyId)
  const createOnboardingTemplate = useCreateOnboardingTemplate(orgId, operatingCompanyId)
  const csvImports = useHrCsvImportMutations(orgId)

  const moduleConfig = useMemo(() => hrModuleConfig(t), [t])

  const addCsvToolbar = (
    ec: EntityViewConfig,
    actions: Array<{
      id: string
      label: string
      requiresSelection?: boolean
      onClick: (selectedRows: Record<string, unknown>[]) => void
    }>,
  ): EntityViewConfig => {
    if (ec.view.mode !== "table") return ec
    return {
      ...ec,
      view: {
        ...ec.view,
        rowSelectionToggleOnClick: false,
        actions,
      },
    }
  }

  const runSelectedRows = async (
    rows: Record<string, unknown>[],
    label: string,
    fn: (row: Record<string, unknown>) => Promise<unknown>,
  ) => {
    setToolbarError(null)
    if (rows.length === 0) {
      setToolbarError(`Select at least one ${label}.`)
      return
    }
    try {
      for (const row of rows) await fn(row)
    } catch (e) {
      setToolbarError(e instanceof Error ? e.message : String(e))
    }
  }

  const openEditRow = useCallback(
    (
      rows: Record<string, unknown>[],
      action: HrUpdateAction,
      buildForm: (row: Record<string, unknown>) => FormConfig,
    ) => {
      setToolbarError(null)
      if (rows.length !== 1) {
        setToolbarError("Select one row to edit.")
        return
      }
      setRowActionError(null)
      setRowAction({ action, row: rows[0]!, form: buildForm(rows[0]!) })
    },
    [],
  )

  const pricelistFieldOptions = useMemo(() => {
    const fromApi = pricelistRowsToSelectOptions(pricelists)
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPricelists"), disabled: true }]
  }, [pricelists, t])

  const employeeFieldOptions = useMemo(() => {
    const fromApi = employeeRowsToSelectOptions(employees as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noEmployees"), disabled: true }]
  }, [employees, t])

  const departmentFieldOptions = useMemo(() => {
    const fromApi = departmentRowsToSelectOptions(departments as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noDepartments"), disabled: true }]
  }, [departments, t])

  const leaveTypeFieldOptions = useMemo(() => {
    const fromApi = leaveTypeRowsToSelectOptions(leaveTypes as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noLeaveTypes"), disabled: true }]
  }, [leaveTypes, t])

  const payrollStructureFieldOptions = useMemo(() => {
    const fromApi = payrollStructureRowsToSelectOptions(payrollStructures as Record<string, unknown>[])
    if (fromApi.length > 0) return fromApi
    return [{ value: "", label: t("common.lookup.noPayrollStructures"), disabled: true }]
  }, [payrollStructures, t])

  const employeeFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newEmployeeForm(t), {
        departmentId: departmentFieldOptions,
      }),
    [t, departmentFieldOptions],
  )

  const leaveFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newLeaveRequestForm(t), {
        employeeId: employeeFieldOptions,
        leaveTypeId: leaveTypeFieldOptions,
      }),
    [t, employeeFieldOptions, leaveTypeFieldOptions],
  )

  const contractFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newContractForm(t), {
        pricelistId: pricelistFieldOptions,
        employeeId: employeeFieldOptions,
      }),
    [t, pricelistFieldOptions, employeeFieldOptions],
  )

  const attendanceFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newAttendancePunchForm(t), {
        employeeId: employeeFieldOptions,
      }),
    [t, employeeFieldOptions],
  )

  const jobFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newJobPositionForm(t), {
        departmentId: departmentFieldOptions,
      }),
    [t, departmentFieldOptions],
  )

  const payslipFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newPayslipForm(t), {
        structId: payrollStructureFieldOptions,
      }),
    [t, payrollStructureFieldOptions],
  )

  const salaryRuleFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newSalaryRuleForm(t), {
        structureId: payrollStructureFieldOptions,
      }),
    [t, payrollStructureFieldOptions],
  )

  const editEmployeeFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(editEmployeeForm(t), {
        departmentId: departmentFieldOptions,
      }),
    [t, departmentFieldOptions],
  )

  const editDepartmentFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(editDepartmentForm(t), {
        parentId: departmentFieldOptions,
        managerId: employeeFieldOptions,
      }),
    [t, departmentFieldOptions, employeeFieldOptions],
  )

  const editJobPositionFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(editJobPositionForm(t), {
        departmentId: departmentFieldOptions,
      }),
    [t, departmentFieldOptions],
  )

  const buildEditEmployeeForm = useCallback(
    (row: Record<string, unknown>) =>
      mergeFieldDefaultValues(editEmployeeFormConfig, employeeRowToFormDefaults(row)),
    [editEmployeeFormConfig],
  )

  const buildEditDepartmentForm = useCallback(
    (row: Record<string, unknown>) =>
      mergeFieldDefaultValues(editDepartmentFormConfig, departmentRowToFormDefaults(row)),
    [editDepartmentFormConfig],
  )

  const buildEditJobPositionForm = useCallback(
    (row: Record<string, unknown>) =>
      mergeFieldDefaultValues(editJobPositionFormConfig, jobPositionRowToFormDefaults(row)),
    [editJobPositionFormConfig],
  )

  const buildEditContractForm = useCallback(
    (row: Record<string, unknown>) =>
      mergeFieldDefaultValues(editContractForm(t), contractRowToFormDefaults(row)),
    [t],
  )

  const buildEditLeaveTypeForm = useCallback(
    (row: Record<string, unknown>) =>
      mergeFieldDefaultValues(editLeaveTypeForm(t), leaveTypeRowToFormDefaults(row)),
    [t],
  )

  const openCreateEmployee = useCallback(
    () => setQuickActionForm({ form: employeeFormConfig, action: "createEmployee" }),
    [employeeFormConfig],
  )

  const openCreateLeaveRequest = useCallback(
    () => setQuickActionForm({ form: leaveFormConfig, action: "createLeaveRequest" }),
    [leaveFormConfig],
  )

  const openCreateContract = useCallback(
    () => setQuickActionForm({ form: contractFormConfig, action: "createContract" }),
    [contractFormConfig],
  )

  const employeeRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const status = employeeStatusBadges(t)
    return {
      titleKey: "name",
      statusKey: "employmentType",
      statusBadgeVariants: status.badgeVariants,
      statusBadgeLabels: status.badgeLabels,
      detailConfig: employeeDetailConfig(t),
      auditTableName: "hr_employee",
      customTabs: [
        {
          id: "onboarding",
          label: "Onboarding",
          content: (record) => (
            <HrOnboardingPanel
              organizationId={orgId}
              companyId={operatingCompanyId}
              employeeId={employeeRowId(record)}
            />
          ),
        },
        {
          id: "documents",
          label: "Documents",
          content: (record) => (
            <HrDocumentsPanel
              organizationId={orgId}
              companyId={operatingCompanyId}
              employeeId={employeeRowId(record)}
            />
          ),
        },
      ],
    }
  }, [t, orgId, operatingCompanyId])

  const leaveRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const status = leaveRequestStatusBadges(t)
    return {
      titleKey: "name",
      statusKey: "state",
      statusBadgeVariants: status.badgeVariants,
      statusBadgeLabels: status.badgeLabels,
      detailConfig: leaveDetailConfig(t),
      auditTableName: "hr_leave",
      customTabs: [
        {
          id: "approval",
          label: t("hr.workflow.approvalTimeline", { defaultValue: "Approval timeline" }),
          content: (record) => <LeaveApprovalTimelinePanel record={record} />,
        },
      ],
    }
  }, [t])

  const contractRecordSheet = useMemo((): EntityRecordSheetConfig => {
    const status = contractStatusBadges(t)
    return {
      titleKey: "name",
      statusKey: "state",
      statusBadgeVariants: status.badgeVariants,
      statusBadgeLabels: status.badgeLabels,
      detailConfig: contractDetailConfig(t),
      auditTableName: "hr_contract",
      customTabs: [
        {
          id: "compensation",
          label: t("hr.contracts.compensationTimeline"),
          content: (record) => (
            <CompensationTimelinePanel
              contractId={String(record.id ?? "")}
              events={compensationEvents as QueryRows}
            />
          ),
        },
      ],
    }
  }, [t, compensationEvents])

  const recruitmentPositions = useMemo(
    () => jobPositions.filter((j) => String(j.state ?? "") === "recruit"),
    [jobPositions],
  )

  const orgChartTab = useMemo(
    () => ({
      id: "org-chart",
      label: "Org Chart",
      type: "custom" as const,
      customContent: (
        <OrgChartPanel
          departments={departments as Record<string, unknown>[]}
          employees={employees as Record<string, unknown>[]}
        />
      ),
    }),
    [departments, employees],
  )

  const performanceTab = useMemo(
    () => ({
      id: "performance",
      label: "Performance",
      type: "custom" as const,
      customContent: (
        <HrPerformancePanel
          organizationId={orgId}
          companyId={operatingCompanyId}
          employees={employees as QueryRows}
        />
      ),
    }),
    [orgId, operatingCompanyId, employees],
  )

  const benefitsTab = useMemo(
    () => ({
      id: "benefits",
      label: "Benefits",
      type: "custom" as const,
      customContent: (
        <HrBenefitsPanel
          organizationId={orgId}
          companyId={operatingCompanyId}
          employees={employees as QueryRows}
        />
      ),
    }),
    [orgId, operatingCompanyId, employees],
  )

  const recruitmentTab = useMemo(
    () => ({
      id: "recruitment",
      label: "Recruitment",
      type: "custom" as const,
      customContent: (
        <HrRecruitmentPanel
          organizationId={orgId}
          companyId={operatingCompanyId}
        />
      ),
    }),
    [orgId, operatingCompanyId],
  )

  const liveSections = useMemo(() => {
    const { startMs, endMs } = timeRangeToMs(dashboardTimeRange)
    const previousRange = previousPeriodMs(dashboardTimeRange)
    const inCurrentRange = (row: Record<string, unknown>) =>
      isTimestampInRange(recordTimestampMs(row), startMs, endMs)
    const inPreviousRange = (row: Record<string, unknown>) =>
      isTimestampInRange(recordTimestampMs(row), previousRange.startMs, previousRange.endMs)

    const activeEmployees = employees.filter((e) => e.isActive)
    const pendingLeaves = leavesToApprove.length
    const payslipExportQueue = payslipsToExport.length
    const runningContracts = contracts.filter((c) => String(c.state) === "Open").length
    const openPositions = jobPositions.filter((j) => String(j.state) === "recruit").length

    const currentLeaves = leaves.filter((l) => inCurrentRange(l as Record<string, unknown>)).length
    const previousLeaves = leaves.filter((l) => inPreviousRange(l as Record<string, unknown>)).length
    const currentContracts = contracts.filter((c) => inCurrentRange(c as Record<string, unknown>)).length
    const previousContracts = contracts.filter((c) => inPreviousRange(c as Record<string, unknown>)).length

    return mapDashboardWidgets(moduleConfig, (w) => {
            if (w.type === "stat-cards") {
              return {
                ...w,
                data: {
                  stats: [
                    { label: t("hr.dashboard.totalHeadcount"), value: activeEmployees.length.toString(), icon: "Users" },
                    { label: t("hr.dashboard.openPositions"), value: openPositions.toString(), icon: "UserPlus" },
                    {
                      label: t("hr.dashboard.pendingLeaveRequests"),
                      value: pendingLeaves.toString(),
                      change: percentChange(currentLeaves, previousLeaves),
                      icon: "Calendar",
                    },
                    {
                      label: t("hr.dashboard.payslipsToExport", { defaultValue: "Payslips to export" }),
                      value: payslipExportQueue.toString(),
                      icon: "Banknote",
                    },
                    {
                      label: t("hr.dashboard.runningContracts"),
                      value: runningContracts.toString(),
                      change: percentChange(currentContracts, previousContracts),
                      icon: "FileText",
                    },
                  ],
                },
              }
            }
            if (w.type === "quick-actions") {
              const handlers: Record<string, () => void> = {
                create_employee: () => setQuickActionForm({ form: employeeFormConfig, action: "createEmployee" }),
                create_leave: () => setQuickActionForm({ form: leaveFormConfig, action: "createLeaveRequest" }),
                create_contract: () => setQuickActionForm({ form: contractFormConfig, action: "createContract" }),
                create_payslip: () => setQuickActionForm({ form: payslipFormConfig, action: "createPayslip" }),
                create_job_position: () => setQuickActionForm({ form: jobFormConfig, action: "createJobPosition" }),
              }
              return {
                ...w,
                data: {
                  ...w.data,
                  actions: w.data.actions.map((a) => ({ ...a, onClick: handlers[a.id] })),
                },
              }
            }
            if (w.id === "hr-by-department") {
              const byDept = groupBy(
                employees.filter((e) => e.isActive),
                (e) => {
                  if (!e.departmentId) return "Other"
                  const dept = departments.find((d) => d.id === e.departmentId)
                  return String(dept?.name ?? `Dept ${String(e.departmentId).slice(-4)}`)
                },
              )
              const values = Object.entries(byDept)
                .map(([dept, emps]) => ({ dept, Employees: emps.length }))
                .sort((a, b) => b.Employees - a.Employees)
                .slice(0, 7)
              return { ...w, data: { ...(w.data as Record<string, unknown>), values } }
            }
            if (w.id === "hr-leave-usage") {
              const byType = groupBy(leaves, (l) => `Type ${String(l.leaveTypeId ?? "0").slice(-4)}`)
              const colors = ["#6366f1", "#f59e0b", "#22c55e", "#8b5cf6"]
              const totalDays = leaves.reduce((s, l) => s + Number(l.numberOfDays ?? 0), 0)
              const metrics = Object.entries(byType)
                .map(([label, typeLeaves]) => ({
                  label,
                  value: Math.round(typeLeaves.reduce((s, l) => s + Number(l.numberOfDays ?? 0), 0)),
                  max: Math.max(1, Math.round(totalDays)),
                  color: "#6366f1",
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 4)
                .map((m, i) => ({ ...m, color: colors[i] ?? "#6366f1" }))
              return { ...w, data: { metrics } }
            }
            if (w.id === "hr-headcount-trend") {
              const now = new Date()
              const values: Array<{ month: string; Headcount: number }> = []
              for (let i = 5; i >= 0; i--) {
                const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999)
                const monthEndMs = monthEnd.getTime()
                const label = monthEnd.toLocaleDateString("en", { month: "short" })
                const headcount = employees.filter((e) => {
                  const startedMs = employeeStartMs(e as Record<string, unknown>)
                  return startedMs === 0 || startedMs <= monthEndMs
                }).length
                values.push({ month: label, Headcount: headcount })
              }
              return {
                ...w,
                title: t("hr.dashboard.headcountTrend"),
                data: { ...(w.data as Record<string, unknown>), values },
              }
            }
            if (w.id === "hr-open-roles") {
              const applicantRows = applicants as QueryRows
              const rows = jobPositions
                .filter((j) => String(j.state ?? "") === "recruit")
                .slice(0, 5)
                .map((j) => {
                  const dept = departments.find((d) => d.id === j.departmentId)
                  const jobId = Number(j.id)
                  const candidates = applicantRows.filter((a) => {
                    const row = a as Record<string, unknown>
                    return Number(row.job_position_id ?? row.jobPositionId ?? 0) === jobId
                  }).length
                  return {
                    role: String(j.name ?? ""),
                    dept: String(dept?.name ?? "—"),
                    candidates,
                    stage: "Open",
                    posted: "—",
                  }
                })
              return { ...w, data: { ...(w.data as Record<string, unknown>), rows } }
            }
            return w
              })
  }, [
    employees,
    departments,
    leaves,
    leavesToApprove,
    payslipsToExport,
    contracts,
    jobPositions,
    applicants,
    moduleConfig,
    dashboardTimeRange,
    t,
    employeeFormConfig,
    leaveFormConfig,
    contractFormConfig,
    jobFormConfig,
  ])

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    return hrCsvImportForm(t, csvKind)
  }, [csvKind, t])

  const config = useMemo(
    () =>
      ({
        ...moduleConfig,
        tabs: [
          orgChartTab,
          performanceTab,
          benefitsTab,
          recruitmentTab,
          ...withDashboardSections(moduleConfig, liveSections).tabs.map((tab) => {
          if (tab.id === "recruitment") return null
          if (tab.id === "departments" && tab.entityConfig) {
            return {
              ...tab,
              createForm: newDepartmentForm(t),
              createLabel: "New Department",
              createAction: "createDepartment",
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-department",
                  label: t("hr.toolbar.importDepartmentCsv"),
                  onClick: () => setCsvKind("department"),
                },
                {
                  id: "edit-department",
                  label: "Edit",
                  requiresSelection: true,
                  onClick: (rows) => openEditRow(rows, "updateDepartment", buildEditDepartmentForm),
                },
              ]),
            }
          }
          if (tab.id === "leaves" && tab.entityConfig) {
            return {
              ...tab,
              createForm: leaveFormConfig,
              recordSheet: leaveRecordSheet,
              entityConfig: attachEmptyStateAction(
                addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-leave-type",
                  label: t("hr.toolbar.importLeaveTypeCsv"),
                  onClick: () => setCsvKind("leave_type"),
                },
                {
                  id: "csv-leave",
                  label: t("hr.toolbar.importLeaveCsv"),
                  onClick: () => setCsvKind("leave"),
                },
                {
                  id: "submit-leave",
                  label: "Submit",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "leave", (row) => submitLeave.mutateAsync(row.id as string | number)),
                },
                {
                  id: "approve-leave",
                  label: "Approve",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "leave", (row) => approveLeave.mutateAsync(row.id as string | number)),
                },
                {
                  id: "refuse-leave",
                  label: "Refuse",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "leave", (row) => refuseLeave.mutateAsync(row.id as string | number)),
                },
                {
                  id: "reset-leave",
                  label: "Reset to draft",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "leave", (row) => resetLeave.mutateAsync(row.id as string | number)),
                },
              ]),
                openCreateLeaveRequest,
              ),
            }
          }
          if (tab.id === "attendance" && tab.entityConfig) {
            return {
              ...tab,
              createForm: attendanceFormConfig,
              entityConfig: attachEmptyStateAction(tab.entityConfig, () =>
                setQuickActionForm({ form: attendanceFormConfig, action: "createAttendancePunch" }),
              ),
            }
          }
          if (tab.id === "contracts" && tab.entityConfig) {
            return {
              ...tab,
              createForm: contractFormConfig,
              recordSheet: contractRecordSheet,
              entityConfig: attachEmptyStateAction(
                addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-contract",
                  label: t("hr.toolbar.importContractCsv"),
                  onClick: () => setCsvKind("contract"),
                },
                {
                  id: "edit-contract",
                  label: "Edit",
                  requiresSelection: true,
                  onClick: (rows) => openEditRow(rows, "updateContract", buildEditContractForm),
                },
                {
                  id: "open-contract",
                  label: "Open",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "contract", (row) => openContract.mutateAsync(Number(row.id))),
                },
                {
                  id: "expire-contract",
                  label: "Expire",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "contract", (row) => expireContract.mutateAsync({ contractId: Number(row.id) })),
                },
                {
                  id: "cancel-contract",
                  label: "Cancel",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "contract", (row) => cancelContract.mutateAsync(Number(row.id))),
                },
              ]),
                openCreateContract,
              ),
            }
          }
          if (tab.id === "payslips" && tab.entityConfig) {
            return {
              ...tab,
              createForm: payslipFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-payroll-structure",
                  label: t("hr.toolbar.importPayrollStructureCsv"),
                  onClick: () => setCsvKind("payroll_structure"),
                },
                {
                  id: "csv-salary-rule",
                  label: t("hr.toolbar.importSalaryRuleCsv"),
                  onClick: () => setCsvKind("salary_rule"),
                },
                {
                  id: "csv-payslip",
                  label: t("hr.toolbar.importPayslipCsv"),
                  onClick: () => setCsvKind("payslip"),
                },
                {
                  id: "approve-payslip",
                  label: "Approve for export",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setToolbarError(null)
                    const draftRows = rows.filter((row) => payslipState(row) === "Draft")
                    if (draftRows.length === 0) {
                      setToolbarError("Select at least one draft payslip.")
                      return
                    }
                    setRowActionError(null)
                    setRowAction({ action: "confirmPayslip", rows: draftRows, form: approvePayslipForm })
                  },
                },
                {
                  id: "create-stp-intent",
                  label: "Create STP intent",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setToolbarError(null)
                    const verifyRows = rows.filter((row) => payslipState(row) === "Verify")
                    if (verifyRows.length === 0) {
                      setToolbarError("Select Verify (approved) payslips for STP integration.")
                      return
                    }
                    void (async () => {
                      try {
                        for (const row of verifyRows) {
                          const payslipId = Number(row.id)
                          await createHrIntegrationIntent.mutateAsync({
                            intentKind: "stp",
                            idempotencyKey: `stp-${payslipId}-${Date.now()}`,
                            payslipId,
                            payload: JSON.stringify({
                              payslipId,
                              exportStatus: "sent",
                              submissionId: `stp-stub-${payslipId}`,
                            }),
                          })
                        }
                      } catch (e) {
                        setToolbarError(e instanceof Error ? e.message : String(e))
                      }
                    })()
                  },
                },
                {
                  id: "export-payslip",
                  label: "Create export intent",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setToolbarError(null)
                    const verifyRows = rows.filter((row) => payslipState(row) === "Verify")
                    if (verifyRows.length === 0) {
                      setToolbarError("Select Verify (approved) payslips to export.")
                      return
                    }
                    void (async () => {
                      try {
                        for (const row of verifyRows) {
                          const payslipId = Number(row.id)
                          await createPayrollExportIntent.mutateAsync({
                            payslipId,
                            idempotencyKey: `payslip-export-${payslipId}-${Date.now()}`,
                            payload: JSON.stringify({
                              payslipId,
                              grossWage: row.grossWage ?? row.gross_wage,
                              netWage: row.netWage ?? row.net_wage,
                            }),
                          })
                        }
                      } catch (e) {
                        setToolbarError(e instanceof Error ? e.message : String(e))
                      }
                    })()
                  },
                },
                {
                  id: "post-payslip",
                  label: "Post to GL",
                  requiresSelection: true,
                  onClick: (rows) => {
                    setToolbarError(null)
                    const verifyRows = rows.filter((row) => payslipState(row) === "Verify")
                    if (verifyRows.length === 0) {
                      setToolbarError("Select Verify (approved) payslips to post.")
                      return
                    }
                    setRowActionError(null)
                    setRowAction({ action: "postPayslip", rows: verifyRows, form: postPayslipForm })
                  },
                },
                {
                  id: "cancel-payslip",
                  label: "Cancel",
                  requiresSelection: true,
                  onClick: (rows) => void runSelectedRows(rows, "payslip", (row) => cancelPayslip.mutateAsync(Number(row.id))),
                },
              ]),
            }
          }
          if (tab.id === "job-positions" && tab.entityConfig) {
            return {
              ...tab,
              createForm: jobFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-job-position",
                  label: t("hr.toolbar.importJobPositionCsv"),
                  onClick: () => setCsvKind("job_position"),
                },
                {
                  id: "csv-resource",
                  label: t("hr.toolbar.importResourceCsv"),
                  onClick: () => setCsvKind("resource"),
                },
                {
                  id: "edit-job-position",
                  label: "Edit",
                  requiresSelection: true,
                  onClick: (rows) => openEditRow(rows, "updateJobPosition", buildEditJobPositionForm),
                },
              ]),
            }
          }
          if (tab.id === "leave-types" && tab.entityConfig) {
            return {
              ...tab,
              createForm: newLeaveTypeForm(t),
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-leave-type",
                  label: t("hr.toolbar.importLeaveTypeCsv"),
                  onClick: () => setCsvKind("leave_type"),
                },
                {
                  id: "edit-leave-type",
                  label: "Edit",
                  requiresSelection: true,
                  onClick: (rows) => openEditRow(rows, "updateLeaveType", buildEditLeaveTypeForm),
                },
              ]),
            }
          }
          if (tab.id === "payroll-structures" && tab.entityConfig) {
            return {
              ...tab,
              createForm: newPayrollStructureForm(t),
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-payroll-structure",
                  label: t("hr.toolbar.importPayrollStructureCsv"),
                  onClick: () => setCsvKind("payroll_structure"),
                },
              ]),
            }
          }
          if (tab.id === "salary-rules" && tab.entityConfig) {
            return {
              ...tab,
              createForm: salaryRuleFormConfig,
              entityConfig: addCsvToolbar(tab.entityConfig, [
                {
                  id: "csv-salary-rule",
                  label: t("hr.toolbar.importSalaryRuleCsv"),
                  onClick: () => setCsvKind("salary_rule"),
                },
              ]),
            }
          }
          if (tab.id === "onboarding-templates" && tab.entityConfig) {
            return {
              ...tab,
              createForm: newOnboardingTemplateForm,
              createLabel: "New template",
              createAction: "createOnboardingTemplate",
            }
          }
          return tab
        }).filter((tab): tab is NonNullable<typeof tab> => tab != null),
        ],
      }) as ModuleConfig,
    [
      moduleConfig,
      orgChartTab,
      performanceTab,
      benefitsTab,
      recruitmentTab,
      liveSections,
      employeeFormConfig,
      leaveFormConfig,
      contractFormConfig,
      attendanceFormConfig,
      payslipFormConfig,
      jobFormConfig,
      salaryRuleFormConfig,
      departmentFieldOptions,
      employeeRecordSheet,
      leaveRecordSheet,
      contractRecordSheet,
      openCreateEmployee,
      openCreateLeaveRequest,
      openCreateContract,
      t,
      approveLeave,
      refuseLeave,
      resetLeave,
      submitLeave,
      openContract,
      expireContract,
      cancelContract,
      cancelPayslip,
      openEditRow,
      buildEditEmployeeForm,
      buildEditDepartmentForm,
      buildEditJobPositionForm,
      buildEditContractForm,
      buildEditLeaveTypeForm,
    ],
  )

  const data = useMemo(
    () => ({
      employees: employees as unknown as Record<string, unknown>[],
      departments: departments as unknown as Record<string, unknown>[],
      leaves: leaves as unknown as Record<string, unknown>[],
      contracts: contracts as unknown as Record<string, unknown>[],
      payslips: payslips as unknown as Record<string, unknown>[],
      "job-positions": jobPositions as unknown as Record<string, unknown>[],
      recruitment: recruitmentPositions as unknown as Record<string, unknown>[],
      "leave-types": leaveTypes as unknown as Record<string, unknown>[],
      "payroll-structures": payrollStructures as unknown as Record<string, unknown>[],
      "salary-rules": salaryRules as unknown as Record<string, unknown>[],
      "onboarding-templates": onboardingTemplates as unknown as Record<string, unknown>[],
      attendance: attendance as unknown as Record<string, unknown>[],
      "compensation-events": compensationEvents as unknown as Record<string, unknown>[],
    }),
    [employees, departments, leaves, contracts, payslips, jobPositions, recruitmentPositions, leaveTypes, payrollStructures, salaryRules, onboardingTemplates, attendance, compensationEvents]
  )

  const handleFormSubmit = async (
    _tabId: string,
    action: string,
    formData: Record<string, unknown>
  ) => {
    if (action === "createEmployee") {
      await createEmployee.mutateAsync(toCreateEmployeeParams(formData))
    } else if (action === "createLeaveRequest") {
      const empRaw = formData.employeeId
      const ltRaw = formData.leaveTypeId
      if (empRaw === "" || empRaw == null || ltRaw === "" || ltRaw == null) return
      const params = toCreateLeaveRequestParams(formData)
      if (params === null) return
      await createLeaveRequest.mutateAsync(params)
    } else if (action === "createContract") {
      const plRaw = formData.pricelistId
      const empRaw = formData.employeeId
      if (plRaw === "" || plRaw == null || empRaw === "" || empRaw == null) return
      const pl = pricelists.find((p) => String(p.id) === String(plRaw))
      if (pl == null || pl.currencyId === undefined || pl.currencyId === null) return
      const params = toCreateContractParams(formData, {
        currencyId: pl.currencyId,
        pricelistId: plRaw,
      })
      if (params === null) return
      await createContract.mutateAsync(params)
    } else if (action === "createPayslip") {
      const params = toCreatePayslipParams(formData)
      if (params === null) return
      await createPayslip.mutateAsync(params)
    } else if (action === "createJobPosition") {
      await createJobPosition.mutateAsync(toCreateJobPositionParams(formData))
    } else if (action === "createDepartment") {
      await createDepartment.mutateAsync(toCreateDepartmentParams(formData))
    } else if (action === "createLeaveType") {
      const params = toCreateLeaveTypeParams(formData)
      await createLeaveType.mutateAsync(params)
    } else if (action === "createPayrollStructure") {
      await createPayrollStructure.mutateAsync(toCreatePayrollStructureParams(formData))
    } else if (action === "createSalaryRule") {
      const params = toCreateSalaryRuleParams(formData)
      if (!params) return
      await createSalaryRule.mutateAsync(params)
    } else if (action === "createAttendancePunch") {
      const params = toCreateAttendancePunchParams(formData)
      if (params === null) return
      await createAttendancePunch.mutateAsync(params)
    } else if (action === "createOnboardingTemplate") {
      const name = String(formData.name ?? "").trim()
      if (!name) return
      await createOnboardingTemplate.mutateAsync({
        name,
        description: formData.description ? String(formData.description) : undefined,
        active: true,
        items: [
          { title: "HR paperwork", sequence: 10, required: true },
          { title: "IT access & equipment", sequence: 20, required: true },
          { title: "Team introduction", sequence: 30, required: false },
        ],
      })
    }
  }

  const isFormMutationPending =
    createEmployee.isPending ||
    createLeaveRequest.isPending ||
    createContract.isPending ||
    createPayslip.isPending ||
    createJobPosition.isPending ||
    createDepartment.isPending ||
    createLeaveType.isPending ||
    createPayrollStructure.isPending ||
    createSalaryRule.isPending ||
    createAttendancePunch.isPending ||
    createOnboardingTemplate.isPending ||
    updateEmployee.isPending ||
    updateDepartment.isPending ||
    updateJobPosition.isPending ||
    updateContract.isPending ||
    updateLeaveType.isPending ||
    archiveEmployee.isPending ||
    startOffboarding.isPending ||
    completeOffboardingItem.isPending ||
    approveLeave.isPending ||
    refuseLeave.isPending ||
    resetLeave.isPending ||
    submitLeave.isPending ||
    openContract.isPending ||
    expireContract.isPending ||
    cancelContract.isPending ||
    confirmPayslip.isPending ||
    cancelPayslip.isPending ||
    Object.values(csvImports).some((m) => m.isPending)

  const dataLoading = useMemo(
    () => ({
      employees: employeesLoading,
      leaves: leavesLoading,
      contracts: contractsLoading,
    }),
    [employeesLoading, leavesLoading, contractsLoading],
  )

  return (
    <>
      {toolbarError ? (
        <p className="text-sm text-destructive mb-2" role="alert">
          {toolbarError}
        </p>
      ) : null}
      <HrOpsQueuePanel
        leavesToApprove={leavesToApprove.length}
        payslipsToExport={payslipsToExport.length}
        hrIntegrationIntentsPending={hrIntegrationIntentsPending.length}
      />
      <HrAdvancedWfmPanel
        laborCostSnapshots={laborCostSnapshots.length}
        shiftOptJobs={shiftOptJobs.length}
        globalAssignments={globalAssignments.length}
        capacityForecast={hrCapacityForecast.length}
      />
      <ModuleView
        config={config}
        data={data}
        dataLoading={dataLoading}
        onFormSubmit={handleFormSubmit}
        isPending={isFormMutationPending}
        dashboardTimeRange={dashboardTimeRange}
        onDashboardTimeRangeChange={setDashboardTimeRange}
      />
      <FormModal
        open={quickActionForm !== null}
        onOpenChange={(open) => !open && setQuickActionForm(null)}
        config={quickActionForm?.form ?? employeeFormConfig}
        isPending={isFormMutationPending}
        onSubmit={async (formData) => {
          if (quickActionForm) {
            await handleFormSubmit("dashboard", quickActionForm.action, formData)
            setQuickActionForm(null)
          }
        }}
      />
      {rowAction ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setRowAction(null)
              setRowActionError(null)
            }
          }}
          config={rowAction.form}
          isPending={isFormMutationPending}
          closeOnSubmit={false}
          submitError={rowActionError}
          onSubmit={async (formData) => {
            setRowActionError(null)
            try {
              if (rowAction.action === "archiveEmployee") {
                for (const row of rowAction.rows) {
                  const employeeId = Number(row.id)
                  const assetsReturned = formData.assetsReturned !== false
                  const accessRevoked = formData.accessRevoked !== false
                  const docsCollected = formData.docsCollected !== false
                  const allComplete = assetsReturned && accessRevoked && docsCollected
                  const overrideReason =
                    formData.overrideReason != null && String(formData.overrideReason).trim() !== ""
                      ? String(formData.overrideReason).trim()
                      : undefined

                  await startOffboarding.mutateAsync(employeeId)
                  if (assetsReturned) {
                    await completeOffboardingItem.mutateAsync({
                      employeeId,
                      item: "assets_returned",
                    })
                  }
                  if (accessRevoked) {
                    await completeOffboardingItem.mutateAsync({
                      employeeId,
                      item: "access_revoked",
                    })
                  }
                  if (docsCollected) {
                    await completeOffboardingItem.mutateAsync({
                      employeeId,
                      item: "docs_collected",
                    })
                  }

                  await archiveEmployee.mutateAsync({
                    employeeId,
                    terminationDate:
                      formData.terminationDate != null && formData.terminationDate !== ""
                        ? new Date(String(formData.terminationDate))
                        : undefined,
                    overrideIncompleteChecklist: !allComplete,
                    overrideReason: !allComplete ? overrideReason : undefined,
                  })
                }
              } else if (rowAction.action === "confirmPayslip") {
                for (const row of rowAction.rows) {
                  await confirmPayslip.mutateAsync({
                    payslipId: Number(row.id),
                    grossWage: Number(formData.grossWage) || Number(row.grossWage ?? row.gross_wage) || 0,
                    netWage: Number(formData.netWage) || Number(row.netWage ?? row.net_wage) || 0,
                    calculationSource: "manual",
                  })
                }
              } else if (rowAction.action === "postPayslip") {
                const accountingDate =
                  formData.accountingDate != null && formData.accountingDate !== ""
                    ? new Date(String(formData.accountingDate))
                    : new Date()
                for (const row of rowAction.rows) {
                  await postPayslip.mutateAsync({
                    payslipId: Number(row.id),
                    journalId: Number(formData.journalId),
                    expenseAccountId: Number(formData.expenseAccountId),
                    payableAccountId: Number(formData.payableAccountId),
                    taxWithholdingAccountId:
                      formData.taxWithholdingAccountId != null &&
                      String(formData.taxWithholdingAccountId) !== ""
                        ? Number(formData.taxWithholdingAccountId)
                        : undefined,
                    accountingDate,
                  })
                }
              } else if (rowAction.action === "updateEmployee") {
                await updateEmployee.mutateAsync({
                  employeeId: Number(rowAction.row.id),
                  params: toUpdateEmployeeParams(formData),
                })
              } else if (rowAction.action === "updateDepartment") {
                await updateDepartment.mutateAsync({
                  departmentId: Number(rowAction.row.id),
                  params: toUpdateDepartmentParams(formData),
                })
              } else if (rowAction.action === "updateJobPosition") {
                await updateJobPosition.mutateAsync({
                  jobId: Number(rowAction.row.id),
                  params: toUpdateJobPositionParams(formData),
                })
              } else if (rowAction.action === "updateContract") {
                await updateContract.mutateAsync({
                  contractId: Number(rowAction.row.id),
                  params: toUpdateContractParams(formData),
                })
              } else if (rowAction.action === "updateLeaveType") {
                await updateLeaveType.mutateAsync({
                  leaveTypeId: rowAction.row.id as string | number,
                  params: toUpdateLeaveTypeParams(formData),
                })
              }
              setRowAction(null)
            } catch (e) {
              setRowActionError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
      {csvKind && csvFormConfig ? (
        <CsvImportModal
          key={csvKind}
          onClose={() => setCsvKind(null)}
          config={csvFormConfig}
          isPending={isFormMutationPending}
          onImport={async (text) => {
            switch (csvKind) {
                case "resource":
                  await csvImports.importResource.mutateAsync(text)
                  break
                case "department":
                  await csvImports.importDepartment.mutateAsync(text)
                  break
                case "job_position":
                  await csvImports.importJobPosition.mutateAsync(text)
                  break
                case "employee":
                  await csvImports.importEmployee.mutateAsync(text)
                  break
                case "contract":
                  await csvImports.importContract.mutateAsync(text)
                  break
                case "leave_type":
                  await csvImports.importLeaveType.mutateAsync(text)
                  break
                case "leave":
                  await csvImports.importLeave.mutateAsync(text)
                  break
                case "payroll_structure":
                  await csvImports.importPayrollStructure.mutateAsync(text)
                  break
                case "salary_rule":
                  await csvImports.importSalaryRule.mutateAsync(text)
                  break
                case "payslip":
                  await csvImports.importPayslip.mutateAsync(text)
                  break
              default:
                break
            }
          }}
        />
      ) : null}
    </>
  )
}

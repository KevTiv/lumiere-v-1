import type { TFunction } from "i18next"
import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const employmentTypeBadges = (t: TFunction) => ({
  badgeVariants: {
    FullTime: "default",
    PartTime: "outline",
    Contract: "secondary",
    Intern: "secondary",
  },
  badgeLabels: {
    FullTime: t("hr.employees.states.FullTime"),
    PartTime: t("hr.employees.states.PartTime"),
    Contract: t("hr.employees.states.Contract"),
    Intern: t("hr.employees.states.Intern"),
  },
}) as const

const leaveStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Confirm: "outline",
    ValidatedOne: "outline",
    Validated: "default",
    Refused: "destructive",
  },
  badgeLabels: {
    Draft: t("hr.leaveRequests.states.Draft"),
    Confirm: t("hr.leaveRequests.states.Confirm"),
    ValidatedOne: t("hr.leaveRequests.states.ValidatedOne"),
    Validated: t("hr.leaveRequests.states.Validated"),
    Refused: t("hr.leaveRequests.states.Refused"),
  },
}) as const

const contractStateBadges = (t: TFunction) => ({
  badgeVariants: {
    New: "secondary",
    Open: "default",
    Expired: "outline",
    Cancelled: "destructive",
  },
  badgeLabels: {
    New: t("hr.contracts.states.New"),
    Open: t("hr.contracts.states.Open"),
    Expired: t("hr.contracts.states.Expired"),
    Cancelled: t("hr.contracts.states.Cancelled"),
  },
}) as const

const payslipStateBadges = (t: TFunction) => ({
  badgeVariants: {
    Draft: "secondary",
    Verify: "outline",
    Done: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    Draft: t("hr.payslips.states.Draft"),
    Verify: t("hr.payslips.states.Verify"),
    Done: t("hr.payslips.states.Done"),
    Cancelled: t("hr.payslips.states.Cancelled"),
  },
}) as const

const jobPositionStateBadges = (t: TFunction) => ({
  badgeVariants: {
    recruit: "outline",
    open: "default",
  },
  badgeLabels: {
    recruit: t("hr.jobPositions.states.recruit"),
    open: t("hr.jobPositions.states.open"),
  },
}) as const

// ── Employees ─────────────────────────────────────────────────────────────────
export const employeesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "employees-table",
  title: t("hr.employees.title"),
  description: t("hr.employees.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.employees.searchPlaceholder"),
    searchKeys: ["name", "workEmail", "employeeNumber", "jobTitle"],
    filters: [
      {
        key: "employmentType",
        label: t("hr.employees.filters.employmentType.label"),
        type: "select",
        options: [
          { value: "FullTime", label: t("hr.employees.filters.employmentType.options.FullTime") },
          { value: "PartTime", label: t("hr.employees.filters.employmentType.options.PartTime") },
          { value: "Contract", label: t("hr.employees.filters.employmentType.options.Contract") },
          { value: "Intern", label: t("hr.employees.filters.employmentType.options.Intern") },
        ],
      },
    ],
    columns: [
      { key: "employeeNumber", label: t("hr.employees.columns.employeeNumber"), width: "min-w-20" },
      { key: "name", label: t("hr.employees.columns.name"), width: "min-w-40" },
      { key: "jobTitle", label: t("hr.employees.columns.jobTitle"), width: "min-w-36" },
      { key: "departmentId", label: t("hr.employees.columns.departmentId"), width: "min-w-32" },
      { key: "employmentType", label: t("hr.employees.columns.employmentType"), type: "badge", ...employmentTypeBadges(t) },
      { key: "workEmail", label: t("hr.employees.columns.workEmail"), width: "min-w-40" },
      { key: "dateHired", label: t("hr.employees.columns.dateHired"), type: "date" },
      { key: "isActive", label: t("hr.employees.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("hr.employees.emptyMessage"),
  },
})

// ── Departments ───────────────────────────────────────────────────────────────
export const departmentsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "departments-table",
  title: t("hr.departments.title"),
  description: t("hr.departments.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.departments.searchPlaceholder"),
    searchKeys: ["name", "completeName"],
    columns: [
      { key: "name", label: t("hr.departments.columns.name"), width: "min-w-36" },
      { key: "completeName", label: t("hr.departments.columns.completeName"), width: "min-w-48" },
      { key: "managerId", label: t("hr.departments.columns.managerId"), width: "min-w-32" },
      { key: "parentId", label: t("hr.departments.columns.parentId"), width: "min-w-32" },
      { key: "isActive", label: t("hr.departments.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("hr.departments.emptyMessage"),
  },
})

// ── Leave Requests ────────────────────────────────────────────────────────────
export const leaveRequestsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "leave-requests-table",
  title: t("hr.leaveRequests.title"),
  description: t("hr.leaveRequests.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.leaveRequests.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: t("hr.leaveRequests.filters.state.label"),
        type: "select",
        options: [
          { value: "Draft", label: t("hr.leaveRequests.filters.state.options.Draft") },
          { value: "Confirm", label: t("hr.leaveRequests.filters.state.options.Confirm") },
          { value: "ValidatedOne", label: t("hr.leaveRequests.filters.state.options.ValidatedOne") },
          { value: "Validated", label: t("hr.leaveRequests.filters.state.options.Validated") },
          { value: "Refused", label: t("hr.leaveRequests.filters.state.options.Refused") },
        ],
      },
    ],
    columns: [
      { key: "employeeId", label: t("hr.leaveRequests.columns.employeeId"), width: "min-w-36" },
      { key: "leaveTypeId", label: t("hr.leaveRequests.columns.leaveTypeId"), width: "min-w-32" },
      { key: "state", label: t("hr.leaveRequests.columns.state"), type: "badge", ...leaveStateBadges(t) },
      { key: "dateFrom", label: t("hr.leaveRequests.columns.dateFrom"), type: "date" },
      { key: "dateTo", label: t("hr.leaveRequests.columns.dateTo"), type: "date" },
      { key: "numberOfDays", label: t("hr.leaveRequests.columns.numberOfDays"), type: "number", align: "right" },
    ],
    emptyMessage: t("hr.leaveRequests.emptyMessage"),
  },
})

// ── Contracts ─────────────────────────────────────────────────────────────────
export const contractsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "contracts-table",
  title: t("hr.contracts.title"),
  description: t("hr.contracts.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.contracts.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: t("hr.contracts.filters.state.label"),
        type: "select",
        options: [
          { value: "New", label: t("hr.contracts.filters.state.options.New") },
          { value: "Open", label: t("hr.contracts.filters.state.options.Open") },
          { value: "Expired", label: t("hr.contracts.filters.state.options.Expired") },
          { value: "Cancelled", label: t("hr.contracts.filters.state.options.Cancelled") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("hr.contracts.columns.name"), width: "min-w-36" },
      { key: "employeeId", label: t("hr.contracts.columns.employeeId"), width: "min-w-36" },
      { key: "state", label: t("hr.contracts.columns.state"), type: "badge", ...contractStateBadges(t) },
      { key: "dateStart", label: t("hr.contracts.columns.dateStart"), type: "date" },
      { key: "dateEnd", label: t("hr.contracts.columns.dateEnd"), type: "date" },
      { key: "wage", label: t("hr.contracts.columns.wage"), type: "currency", align: "right" },
    ],
    emptyMessage: t("hr.contracts.emptyMessage"),
  },
})

// ── Payslips ──────────────────────────────────────────────────────────────────
export const payslipsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "payslips-table",
  title: t("hr.payslips.title"),
  description: t("hr.payslips.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.payslips.searchPlaceholder"),
    searchKeys: ["name", "number"],
    filters: [
      {
        key: "state",
        label: t("hr.payslips.filters.state.label"),
        type: "select",
        options: [
          { value: "Draft", label: t("hr.payslips.filters.state.options.Draft") },
          { value: "Verify", label: t("hr.payslips.filters.state.options.Verify") },
          { value: "Done", label: t("hr.payslips.filters.state.options.Done") },
          { value: "Cancelled", label: t("hr.payslips.filters.state.options.Cancelled") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("hr.payslips.columns.name"), width: "min-w-36" },
      { key: "employeeId", label: t("hr.payslips.columns.employeeId"), width: "min-w-36" },
      { key: "state", label: t("hr.payslips.columns.state"), type: "badge", ...payslipStateBadges(t) },
      { key: "dateFrom", label: t("hr.payslips.columns.dateFrom"), type: "date" },
      { key: "dateTo", label: t("hr.payslips.columns.dateTo"), type: "date" },
      { key: "basicWage", label: t("hr.payslips.columns.basicWage"), type: "currency", align: "right" },
      { key: "grossWage", label: t("hr.payslips.columns.grossWage"), type: "currency", align: "right" },
      { key: "netWage", label: t("hr.payslips.columns.netWage"), type: "currency", align: "right" },
    ],
    emptyMessage: t("hr.payslips.emptyMessage"),
  },
})

// ── Job Positions ─────────────────────────────────────────────────────────────
export const jobPositionsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "job-positions-table",
  title: t("hr.jobPositions.title"),
  description: t("hr.jobPositions.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.jobPositions.searchPlaceholder"),
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: t("hr.jobPositions.filters.state.label"),
        type: "select",
        options: [
          { value: "recruit", label: t("hr.jobPositions.filters.state.options.recruit") },
          { value: "open", label: t("hr.jobPositions.filters.state.options.open") },
        ],
      },
    ],
    columns: [
      { key: "name", label: t("hr.jobPositions.columns.name"), width: "min-w-48" },
      { key: "departmentId", label: t("hr.jobPositions.columns.departmentId"), width: "min-w-36" },
      { key: "state", label: t("hr.jobPositions.columns.state"), type: "badge", ...jobPositionStateBadges(t) },
      { key: "noOfEmployee", label: t("hr.jobPositions.columns.noOfEmployee"), type: "number", align: "right" },
      { key: "expectedEmployees", label: t("hr.jobPositions.columns.expectedEmployees"), type: "number", align: "right" },
      { key: "isActive", label: t("hr.jobPositions.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("hr.jobPositions.emptyMessage"),
  },
})

// ── Leave Types ───────────────────────────────────────────────────────────────
export const leaveTypesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "leave-types-table",
  title: t("hr.leaveTypes.title"),
  description: t("hr.leaveTypes.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.leaveTypes.searchPlaceholder"),
    searchKeys: ["name", "code"],
    columns: [
      { key: "name", label: t("hr.leaveTypes.columns.name"), width: "min-w-36" },
      { key: "code", label: t("hr.leaveTypes.columns.code"), width: "min-w-24" },
      { key: "allocationType", label: t("hr.leaveTypes.columns.allocationType"), width: "min-w-32" },
      { key: "maxLeaves", label: t("hr.leaveTypes.columns.maxLeaves"), type: "number", align: "right" },
      { key: "isActive", label: t("hr.leaveTypes.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("hr.leaveTypes.emptyMessage"),
  },
})

// ── Payroll Structures ────────────────────────────────────────────────────────
export const payrollStructuresTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "payroll-structures-table",
  title: t("hr.payrollStructures.title"),
  description: t("hr.payrollStructures.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.payrollStructures.searchPlaceholder"),
    searchKeys: ["name", "type"],
    columns: [
      { key: "name", label: t("hr.payrollStructures.columns.name"), width: "min-w-48" },
      { key: "type", label: t("hr.payrollStructures.columns.type"), width: "min-w-32" },
      { key: "isActive", label: t("hr.payrollStructures.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("hr.payrollStructures.emptyMessage"),
  },
})

// ── Salary Rules ──────────────────────────────────────────────────────────────
export const salaryRulesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "salary-rules-table",
  title: t("hr.salaryRules.title"),
  description: t("hr.salaryRules.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.salaryRules.searchPlaceholder"),
    searchKeys: ["name", "code", "category"],
    columns: [
      { key: "name", label: t("hr.salaryRules.columns.name"), width: "min-w-40" },
      { key: "code", label: t("hr.salaryRules.columns.code"), width: "min-w-24" },
      { key: "structureId", label: t("hr.salaryRules.columns.structureId"), width: "min-w-32" },
      { key: "category", label: t("hr.salaryRules.columns.category"), width: "min-w-28" },
      { key: "amountType", label: t("hr.salaryRules.columns.amountType"), width: "min-w-28" },
      { key: "sequence", label: t("hr.salaryRules.columns.sequence"), type: "number", align: "right" },
      { key: "isActive", label: t("hr.salaryRules.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("hr.salaryRules.emptyMessage"),
  },
})

// ── Registry ──────────────────────────────────────────────────────────────────
export const hrEntityConfigs = (t: TFunction): Record<string, EntityViewConfig> => ({
  "employees-table": employeesTableConfig(t),
  "departments-table": departmentsTableConfig(t),
  "leave-requests-table": leaveRequestsTableConfig(t),
  "contracts-table": contractsTableConfig(t),
  "payslips-table": payslipsTableConfig(t),
  "job-positions-table": jobPositionsTableConfig(t),
  "leave-types-table": leaveTypesTableConfig(t),
  "payroll-structures-table": payrollStructuresTableConfig(t),
  "salary-rules-table": salaryRulesTableConfig(t),
})

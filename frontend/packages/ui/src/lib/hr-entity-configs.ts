import type { TFunction } from "i18next"
import type { EntityDetailConfig, EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
export const employeeStatusBadges = (t: TFunction) => ({
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

export const leaveRequestStatusBadges = (t: TFunction) => ({
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

export const contractStatusBadges = (t: TFunction) => ({
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

const employmentTypeBadges = employeeStatusBadges
const leaveStateBadges = leaveRequestStatusBadges
const contractStateBadges = contractStatusBadges

const employeeEmptyState = (t: TFunction) => ({
  title: t("hr.employees.emptyState.title"),
  description: t("hr.employees.emptyState.description"),
  actionLabel: t("hr.employees.emptyState.actionLabel"),
  permission: { resource: "hr_employee", action: "create" as const },
  learnHint: t("hr.employees.emptyState.hint", { defaultValue: "Employees anchor leave, contracts, payslips and expenses." }),
})

const leaveRequestEmptyState = (t: TFunction) => ({
  title: t("hr.leaveRequests.emptyState.title"),
  description: t("hr.leaveRequests.emptyState.description"),
  actionLabel: t("hr.leaveRequests.emptyState.actionLabel"),
})

const contractEmptyState = (t: TFunction) => ({
  title: t("hr.contracts.emptyState.title"),
  description: t("hr.contracts.emptyState.description"),
  actionLabel: t("hr.contracts.emptyState.actionLabel"),
})

// ── Employees ─────────────────────────────────────────────────────────────────
export const employeesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "employees-table",
  title: t("hr.employees.title"),
  description: t("hr.employees.description"),
  view: {
    mode: "table",
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
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
      {
        key: "employeeNumber",
        sensitive: true,
        label: t("hr.employees.columns.employeeNumber"),
        width: "min-w-20",
        sortable: true,
      },
      { key: "name", label: t("hr.employees.columns.name"), width: "min-w-40", sortable: true, sensitive: true },
      { key: "jobTitle", label: t("hr.employees.columns.jobTitle"), width: "min-w-36" },
      { key: "departmentId", label: t("hr.employees.columns.departmentId"), width: "min-w-32" },
      {
        key: "employmentType",
        label: t("hr.employees.columns.employmentType"),
        type: "status",
        sortable: true,
        ...employmentTypeBadges(t),
      },
      { key: "workEmail", label: t("hr.employees.columns.workEmail"), width: "min-w-40", sensitive: true },
      {
        key: "dateHired",
        label: t("hr.employees.columns.dateHired"),
        type: "relative-date",
        sortable: true,
      },
      { key: "isActive", label: t("hr.employees.columns.isActive"), type: "boolean" },
    ],
    emptyMessage: t("hr.employees.emptyMessage"),
    emptyState: employeeEmptyState(t),
  },
})

export const employeeDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "profile",
      title: t("hr.forms.newEmployee.sections.personalInformation"),
      fields: [
        { key: "name", label: t("hr.employees.columns.name"), width: "1/2" },
        { key: "employeeNumber", label: t("hr.employees.columns.employeeNumber"), width: "1/2" },
        { key: "jobTitle", label: t("hr.employees.columns.jobTitle"), width: "1/2" },
        {
          key: "employmentType",
          label: t("hr.employees.columns.employmentType"),
          type: "badge",
          ...employmentTypeBadges(t),
          width: "1/2",
        },
      ],
    },
    {
      id: "contact",
      title: t("hr.forms.newEmployee.sections.contact"),
      fields: [
        { key: "workEmail", label: t("hr.employees.columns.workEmail"), width: "1/2" },
        { key: "workPhone", label: t("hr.forms.newEmployee.fields.workPhone"), width: "1/2" },
        { key: "workLocation", label: t("hr.forms.newEmployee.fields.workLocation"), width: "1/2" },
        {
          key: "dateHired",
          label: t("hr.employees.columns.dateHired"),
          type: "relative-date",
          width: "1/2",
        },
        { key: "departmentId", label: t("hr.employees.columns.departmentId"), width: "1/2" },
        { key: "isActive", label: t("hr.employees.columns.isActive"), type: "boolean", width: "1/2" },
      ],
    },
  ],
})

// ── Departments ───────────────────────────────────────────────────────────────
export const departmentsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "departments-table",
  title: t("hr.departments.title"),
  description: t("hr.departments.description"),
  view: {
    mode: "table",
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
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
    // Leave dates and types disclose individual absence information.
    // Generic CSV has no dedicated export authorization; keep this list in the app.
    allowExport: false,
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
      {
        key: "state",
        label: t("hr.leaveRequests.columns.state"),
        type: "status",
        sortable: true,
        ...leaveStateBadges(t),
      },
      {
        key: "dateFrom",
        label: t("hr.leaveRequests.columns.dateFrom"),
        type: "relative-date",
        sortable: true,
      },
      { key: "dateTo", label: t("hr.leaveRequests.columns.dateTo"), type: "relative-date" },
      {
        key: "numberOfDays",
        label: t("hr.leaveRequests.columns.numberOfDays"),
        type: "number",
        align: "right",
        sortable: true,
      },
    ],
    emptyMessage: t("hr.leaveRequests.emptyMessage"),
    emptyState: leaveRequestEmptyState(t),
  },
})

export const leaveDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "leave",
      title: t("hr.forms.newLeaveRequest.sections.leaveDetails"),
      fields: [
        { key: "employeeId", label: t("hr.leaveRequests.columns.employeeId"), width: "1/2" },
        { key: "leaveTypeId", label: t("hr.leaveRequests.columns.leaveTypeId"), width: "1/2" },
        {
          key: "state",
          label: t("hr.leaveRequests.columns.state"),
          type: "badge",
          ...leaveStateBadges(t),
          width: "1/2",
        },
        {
          key: "dateFrom",
          label: t("hr.leaveRequests.columns.dateFrom"),
          type: "relative-date",
          width: "1/2",
        },
        {
          key: "dateTo",
          label: t("hr.leaveRequests.columns.dateTo"),
          type: "relative-date",
          width: "1/2",
        },
        {
          key: "numberOfDays",
          label: t("hr.leaveRequests.columns.numberOfDays"),
          type: "number",
          width: "1/2",
        },
        { key: "notes", type: "markdown", label: t("hr.forms.newLeaveRequest.fields.notes"), width: "full" },
      ],
    },
  ],
})

// ── Contracts ─────────────────────────────────────────────────────────────────
export const contractsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "contracts-table",
  title: t("hr.contracts.title"),
  description: t("hr.contracts.description"),
  view: {
    mode: "table",
    // Individual contracts include compensation information.
    // Generic CSV has no dedicated export authorization; keep this list in the app.
    allowExport: false,
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
      { key: "name", label: t("hr.contracts.columns.name"), width: "min-w-36", sortable: true },
      { key: "employeeId", label: t("hr.contracts.columns.employeeId"), width: "min-w-36" },
      {
        key: "state",
        label: t("hr.contracts.columns.state"),
        type: "status",
        sortable: true,
        ...contractStateBadges(t),
      },
      {
        key: "dateStart",
        label: t("hr.contracts.columns.dateStart"),
        type: "relative-date",
        sortable: true,
      },
      { key: "dateEnd", label: t("hr.contracts.columns.dateEnd"), type: "relative-date" },
      {
        key: "wage",
        sensitive: true,
        label: t("hr.contracts.columns.wage"),
        type: "currency",
        align: "right",
        sortable: true,
      },
    ],
    emptyMessage: t("hr.contracts.emptyMessage"),
    emptyState: contractEmptyState(t),
  },
})

export const contractDetailConfig = (t: TFunction): EntityDetailConfig => ({
  mode: "detail",
  sections: [
    {
      id: "contract",
      title: t("hr.forms.newContract.sections.contractDetails"),
      fields: [
        { key: "name", label: t("hr.contracts.columns.name"), width: "1/2" },
        { key: "employeeId", label: t("hr.contracts.columns.employeeId"), width: "1/2" },
        {
          key: "state",
          label: t("hr.contracts.columns.state"),
          type: "badge",
          ...contractStateBadges(t),
          width: "1/2",
        },
        {
          key: "dateStart",
          label: t("hr.contracts.columns.dateStart"),
          type: "relative-date",
          width: "1/2",
        },
        {
          key: "dateEnd",
          label: t("hr.contracts.columns.dateEnd"),
          type: "relative-date",
          width: "1/2",
        },
        {
          key: "wage",
          label: t("hr.contracts.columns.wage"),
          type: "currency",
          width: "1/2",
        },
      ],
    },
  ],
})

// ── Attendance ────────────────────────────────────────────────────────────────

export const attendanceTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "attendance-table",
  title: t("hr.attendance.title"),
  description: t("hr.attendance.description"),
  view: {
    mode: "table",
    // Attendance exposes individual work schedules.
    // Generic CSV has no dedicated export authorization; keep this list in the app.
    allowExport: false,
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.attendance.searchPlaceholder"),
    searchKeys: ["employeeId", "source"],
    columns: [
      { key: "employeeId", label: t("hr.attendance.columns.employeeId"), width: "min-w-32" },
      {
        key: "checkIn",
        label: t("hr.attendance.columns.checkIn"),
        type: "relative-date",
        sortable: true,
        width: "min-w-36",
      },
      {
        key: "checkOut",
        label: t("hr.attendance.columns.checkOut"),
        type: "relative-date",
        width: "min-w-36",
      },
      { key: "source", label: t("hr.attendance.columns.source"), width: "min-w-24" },
    ],
    emptyMessage: t("hr.attendance.emptyMessage"),
  },
})

// ── Payslips ──────────────────────────────────────────────────────────────────
export const payslipsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "payslips-table",
  title: t("hr.payslips.title"),
  description: t("hr.payslips.description"),
  view: {
    mode: "table",
    // Payroll uses the explicit payroll export-intent workflow.
    // Generic CSV has no dedicated export authorization; keep this list in the app.
    allowExport: false,
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
      { key: "basicWage", sensitive: true, label: t("hr.payslips.columns.basicWage"), type: "currency", align: "right" },
      { key: "grossWage", sensitive: true, label: t("hr.payslips.columns.grossWage"), type: "currency", align: "right" },
      { key: "netWage", sensitive: true, label: t("hr.payslips.columns.netWage"), type: "currency", align: "right" },
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
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
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
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
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

// ── Leave Allocations ─────────────────────────────────────────────────────────
export interface LeaveAllocationsConfigOptions {
  employeeOptions?: Array<{ value: string; label: string }>
  leaveTypeOptions?: Array<{ value: string; label: string }>
  /** Optional columns, shown only when at least one row carries the data. */
  showPeriod?: boolean
  showValidity?: boolean
  showState?: boolean
  /** Replaces the empty message (e.g. a load error). */
  emptyMessage?: string
}

export const leaveAllocationsTableConfig = (
  t: TFunction,
  opts: LeaveAllocationsConfigOptions = {},
): EntityViewConfig => ({
  id: "leave-allocations-table",
  title: t("hr.leaveAllocations.title", { defaultValue: "Leave Allocations" }),
  description: t("hr.leaveAllocations.description", {
    defaultValue: "Days allocated to each employee per leave type, with usage and remaining balance.",
  }),
  view: {
    mode: "table",
    // Individual leave balances are personnel records.
    // Generic CSV has no dedicated export authorization; keep this list in the app.
    allowExport: false,
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.leaveAllocations.searchPlaceholder", { defaultValue: "Search by employee or leave type" }),
    searchKeys: ["employeeName", "leaveTypeName"],
    filters: [
      {
        key: "employeeId",
        label: t("hr.leaveAllocations.filters.employee", { defaultValue: "Employee" }),
        type: "select",
        options: opts.employeeOptions ?? [],
      },
      {
        key: "leaveTypeId",
        label: t("hr.leaveAllocations.filters.leaveType", { defaultValue: "Leave type" }),
        type: "select",
        options: opts.leaveTypeOptions ?? [],
      },
    ],
    columns: [
      { key: "employeeName", label: t("hr.leaveAllocations.columns.employee", { defaultValue: "Employee" }), width: "min-w-36", sortable: true },
      { key: "leaveTypeName", label: t("hr.leaveAllocations.columns.leaveType", { defaultValue: "Leave type" }), width: "min-w-32", sortable: true },
      ...(opts.showPeriod
        ? [{ key: "periodYear", label: t("hr.leaveAllocations.columns.period", { defaultValue: "Year" }), align: "right" as const, sortable: true }]
        : []),
      { key: "allocatedDays", label: t("hr.leaveAllocations.columns.allocated", { defaultValue: "Allocated" }), type: "number", align: "right", sortable: true },
      { key: "usedDays", label: t("hr.leaveAllocations.columns.used", { defaultValue: "Used" }), type: "number", align: "right", sortable: true },
      { key: "remainingDays", label: t("hr.leaveAllocations.columns.remaining", { defaultValue: "Remaining" }), type: "number", align: "right", sortable: true },
      ...(opts.showValidity
        ? [
            { key: "validFrom", label: t("hr.leaveAllocations.columns.validFrom", { defaultValue: "Valid from" }), width: "min-w-28" },
            { key: "validTo", label: t("hr.leaveAllocations.columns.validTo", { defaultValue: "Valid to" }), width: "min-w-28" },
          ]
        : []),
      ...(opts.showState
        ? [{ key: "state", label: t("hr.leaveAllocations.columns.state", { defaultValue: "State" }) }]
        : []),
    ],
    emptyMessage:
      opts.emptyMessage ?? t("hr.leaveAllocations.emptyMessage", { defaultValue: "No leave allocations yet." }),
  },
})

// ── Payroll Structures ────────────────────────────────────────────────────────
export const payrollStructuresTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "payroll-structures-table",
  title: t("hr.payrollStructures.title"),
  description: t("hr.payrollStructures.description"),
  view: {
    mode: "table",
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
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
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
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

export const onboardingTemplatesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "onboarding-templates-table",
  title: t("hr.builtIn.hrEntityConfigs.onboardingTemplatesTableConfig.onboardingTemplatesTable.title", { defaultValue: "Onboarding templates" }),
  description: t("hr.builtIn.hrEntityConfigs.onboardingTemplatesTableConfig.onboardingTemplatesTable.description", { defaultValue: "Reusable hire checklists assigned to new employees" }),
  view: {
    mode: "table",
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.builtIn.hrEntityConfigs.onboardingTemplatesTableConfig.view.searchPlaceholder", { defaultValue: "Search templates…" }),
    searchKeys: ["name", "description"],
    columns: [
      { key: "name", label: t("hr.employees.columns.name", { defaultValue: "Name" }), width: "min-w-40", sortable: true },
      { key: "description", type: "markdown", label: t("hr.builtIn.hrEntityConfigs.onboardingTemplatesTableConfig.description.label", { defaultValue: "Description" }), width: "min-w-48" },
      { key: "active", label: t("common.active", { defaultValue: "Active" }), type: "boolean", width: "min-w-20" },
      { key: "companyId", label: t("common.builtIn.formConfigs.newOrderForm.customerCompany.label", { defaultValue: "Company" }), width: "min-w-24" },
    ],
    emptyMessage: t("hr.builtIn.hrEntityConfigs.onboardingTemplatesTableConfig.view.emptyMessage", { defaultValue: "No onboarding templates yet — create one to assign on hire." }),
  },
})

export const performanceCyclesTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "performance-cycles-table",
  title: t("hr.performance.cycles.title", { defaultValue: "Performance cycles" }),
  description: t("hr.builtIn.hrEntityConfigs.performanceCyclesTableConfig.performanceCyclesTable.description", { defaultValue: "Review periods for goals and employee evaluations" }),
  view: {
    mode: "table",
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.builtIn.hrEntityConfigs.performanceCyclesTableConfig.view.searchPlaceholder", { defaultValue: "Search cycles…" }),
    searchKeys: ["name", "state"],
    columns: [
      { key: "name", label: t("hr.employees.columns.name", { defaultValue: "Name" }), width: "min-w-40", sortable: true },
      { key: "state", label: t("hr.leaveAllocations.columns.state", { defaultValue: "State" }), type: "badge", width: "min-w-24" },
      { key: "startDate", label: t("hr.contracts.columns.dateStart", { defaultValue: "Start" }), type: "date", width: "min-w-28" },
      { key: "endDate", label: t("hr.contracts.columns.dateEnd", { defaultValue: "End" }), type: "date", width: "min-w-28" },
      { key: "active", label: t("common.active", { defaultValue: "Active" }), type: "boolean", width: "min-w-20" },
    ],
    emptyMessage: t("hr.builtIn.hrEntityConfigs.performanceCyclesTableConfig.view.emptyMessage", { defaultValue: "No performance cycles — create one to start goal setting." }),
  },
})

export const performanceGoalsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "performance-goals-table",
  title: t("hr.builtIn.hrEntityConfigs.performanceGoalsTableConfig.performanceGoalsTable.title", { defaultValue: "Performance goals" }),
  description: t("hr.builtIn.hrEntityConfigs.performanceGoalsTableConfig.performanceGoalsTable.description", { defaultValue: "Employee goals linked to review cycles" }),
  view: {
    mode: "table",
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.builtIn.hrEntityConfigs.performanceGoalsTableConfig.view.searchPlaceholder", { defaultValue: "Search goals…" }),
    searchKeys: ["title", "employeeId", "cycleId"],
    columns: [
      { key: "title", sensitive: true, label: t("hr.builtIn.hrEntityConfigs.performanceGoalsTableConfig.title.label", { defaultValue: "Goal" }), width: "min-w-40" },
      { key: "employeeId", sensitive: true, label: t("hr.leaveRequests.columns.employeeId", { defaultValue: "Employee" }), width: "min-w-28" },
      { key: "cycleId", label: t("hr.performance.cycles.selectPlaceholder", { defaultValue: "Cycle" }), width: "min-w-24" },
      { key: "state", label: t("hr.leaveAllocations.columns.state", { defaultValue: "State" }), type: "badge", width: "min-w-24" },
      { key: "weight", label: t("hr.builtIn.hrEntityConfigs.performanceGoalsTableConfig.weight.label", { defaultValue: "Weight" }), type: "number", align: "right", width: "min-w-20" },
    ],
    emptyMessage: t("hr.builtIn.hrEntityConfigs.performanceGoalsTableConfig.view.emptyMessage", { defaultValue: "No goals yet — add goals from a performance cycle." }),
  },
})

export const performanceReviewsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "performance-reviews-table",
  title: t("hr.builtIn.hrEntityConfigs.performanceReviewsTableConfig.performanceReviewsTable.title", { defaultValue: "Performance reviews" }),
  description: t("hr.builtIn.hrEntityConfigs.performanceReviewsTableConfig.performanceReviewsTable.description", { defaultValue: "Self and manager review workflow per employee and cycle" }),
  view: {
    mode: "table",
    // Individual ratings are personnel records.
    // Generic CSV has no dedicated export authorization; keep this list in the app.
    allowExport: false,
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.builtIn.hrEntityConfigs.performanceReviewsTableConfig.view.searchPlaceholder", { defaultValue: "Search reviews…" }),
    searchKeys: ["employeeId", "cycleId", "state"],
    filters: [
      {
        key: "state",
        label: t("hr.leaveAllocations.columns.state", { defaultValue: "State" }),
        type: "select",
        options: [
          { value: "draft", label: t("hr.leaveRequests.filters.state.options.Draft", { defaultValue: "Draft" }) },
          { value: "submitted", label: t("hr.builtIn.hrEntityConfigs.performanceReviewsTableConfig.submitted.label", { defaultValue: "Submitted" }) },
          { value: "completed", label: t("hr.builtIn.hrEntityConfigs.performanceReviewsTableConfig.completed.label", { defaultValue: "Completed" }) },
        ],
      },
    ],
    columns: [
      { key: "employeeId", label: t("hr.leaveRequests.columns.employeeId", { defaultValue: "Employee" }), width: "min-w-28" },
      { key: "cycleId", label: t("hr.performance.cycles.selectPlaceholder", { defaultValue: "Cycle" }), width: "min-w-24" },
      { key: "state", label: t("hr.leaveAllocations.columns.state", { defaultValue: "State" }), type: "badge", width: "min-w-24" },
      { key: "selfRating", label: t("hr.builtIn.hrEntityConfigs.performanceReviewsTableConfig.selfRating.label", { defaultValue: "Self" }), type: "number", align: "right", width: "min-w-16" },
      { key: "managerRating", label: t("hr.departments.columns.managerId", { defaultValue: "Manager" }), type: "number", align: "right", width: "min-w-20" },
    ],
    emptyMessage: t("hr.builtIn.hrEntityConfigs.performanceReviewsTableConfig.view.emptyMessage", { defaultValue: "Reviews appear when goals are added for an employee in a cycle." }),
  },
})

export const benefitPlansTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "benefit-plans-table",
  title: t("hr.benefits.plans.title", { defaultValue: "Benefit plans" }),
  description: t("hr.builtIn.hrEntityConfigs.benefitPlansTableConfig.benefitPlansTable.description", { defaultValue: "Catalog of benefit offerings for employee enrollment" }),
  view: {
    mode: "table",
    // Reviewed for generic CSV: sensitive columns are excluded from the file.
    allowExport: true,
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.builtIn.hrEntityConfigs.benefitPlansTableConfig.view.searchPlaceholder", { defaultValue: "Search plans…" }),
    searchKeys: ["name", "planType"],
    columns: [
      { key: "name", label: t("hr.employees.columns.name", { defaultValue: "Name" }), width: "min-w-40", sortable: true },
      { key: "planType", label: t("hr.employees.columns.employmentType", { defaultValue: "Type" }), width: "min-w-24" },
      { key: "description", type: "markdown", label: t("hr.builtIn.hrEntityConfigs.onboardingTemplatesTableConfig.description.label", { defaultValue: "Description" }), width: "min-w-48" },
      { key: "active", label: t("common.active", { defaultValue: "Active" }), type: "boolean", width: "min-w-20" },
    ],
    emptyMessage: t("hr.builtIn.hrEntityConfigs.benefitPlansTableConfig.view.emptyMessage", { defaultValue: "No benefit plans — create a plan to enroll employees." }),
  },
})

export const benefitEnrollmentsTableConfig = (t: TFunction): EntityViewConfig => ({
  id: "benefit-enrollments-table",
  title: t("hr.builtIn.hrEntityConfigs.benefitEnrollmentsTableConfig.benefitEnrollmentsTable.title", { defaultValue: "Benefit enrollments" }),
  description: t("hr.builtIn.hrEntityConfigs.benefitEnrollmentsTableConfig.benefitEnrollmentsTable.description", { defaultValue: "Active and terminated employee benefit assignments" }),
  view: {
    mode: "table",
    // Benefit participation is individual personnel information.
    // Generic CSV has no dedicated export authorization; keep this list in the app.
    allowExport: false,
    rowKey: "id",
    searchable: true,
    searchPlaceholder: t("hr.builtIn.hrEntityConfigs.benefitEnrollmentsTableConfig.view.searchPlaceholder", { defaultValue: "Search enrollments…" }),
    searchKeys: ["employeeId", "planId", "state"],
    filters: [
      {
        key: "state",
        label: t("hr.leaveAllocations.columns.state", { defaultValue: "State" }),
        type: "select",
        options: [
          { value: "enrolled", label: t("hr.builtIn.hrEntityConfigs.benefitEnrollmentsTableConfig.enrolled.label", { defaultValue: "Enrolled" }) },
          { value: "terminated", label: t("hr.builtIn.hrEntityConfigs.benefitEnrollmentsTableConfig.terminated.label", { defaultValue: "Terminated" }) },
        ],
      },
    ],
    columns: [
      { key: "employeeId", label: t("hr.leaveRequests.columns.employeeId", { defaultValue: "Employee" }), width: "min-w-28" },
      { key: "planId", label: t("hr.benefits.planPlaceholder", { defaultValue: "Plan" }), width: "min-w-24" },
      { key: "state", label: t("hr.leaveAllocations.columns.state", { defaultValue: "State" }), type: "badge", width: "min-w-24" },
      { key: "effectiveFrom", label: t("hr.leaveRequests.columns.dateFrom", { defaultValue: "From" }), type: "date", width: "min-w-28" },
      { key: "effectiveTo", label: t("hr.leaveRequests.columns.dateTo", { defaultValue: "To" }), type: "date", width: "min-w-28" },
    ],
    emptyMessage: t("hr.builtIn.hrEntityConfigs.benefitEnrollmentsTableConfig.view.emptyMessage", { defaultValue: "No enrollments — assign employees to benefit plans." }),
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
  "onboarding-templates-table": onboardingTemplatesTableConfig(t),
  "attendance-table": attendanceTableConfig(t),
  "performance-cycles-table": performanceCyclesTableConfig(t),
  "performance-goals-table": performanceGoalsTableConfig(t),
  "performance-reviews-table": performanceReviewsTableConfig(t),
  "benefit-plans-table": benefitPlansTableConfig(t),
  "benefit-enrollments-table": benefitEnrollmentsTableConfig(t),
})


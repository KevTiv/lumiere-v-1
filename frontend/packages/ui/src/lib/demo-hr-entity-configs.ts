import type { EntityViewConfig } from "./entity-view-types"

// ── Badge maps ────────────────────────────────────────────────────────────────
const employmentTypeBadges = {
  badgeVariants: {
    FullTime: "default",
    PartTime: "outline",
    Contract: "secondary",
    Intern: "secondary",
  },
  badgeLabels: {
    FullTime: "Full-Time",
    PartTime: "Part-Time",
    Contract: "Contract",
    Intern: "Intern",
  },
} as const

const leaveStateBadges = {
  badgeVariants: {
    Draft: "secondary",
    Confirm: "outline",
    ValidatedOne: "outline",
    Validated: "default",
    Refused: "destructive",
  },
  badgeLabels: {
    Draft: "Draft",
    Confirm: "To Approve",
    ValidatedOne: "Second Approval",
    Validated: "Approved",
    Refused: "Refused",
  },
} as const

const contractStateBadges = {
  badgeVariants: {
    New: "secondary",
    Open: "default",
    Expired: "outline",
    Cancelled: "destructive",
  },
  badgeLabels: {
    New: "New",
    Open: "Running",
    Expired: "Expired",
    Cancelled: "Cancelled",
  },
} as const

const payslipStateBadges = {
  badgeVariants: {
    Draft: "secondary",
    Verify: "outline",
    Done: "default",
    Cancelled: "destructive",
  },
  badgeLabels: {
    Draft: "Draft",
    Verify: "Waiting",
    Done: "Done",
    Cancelled: "Cancelled",
  },
} as const

// ── Employees ─────────────────────────────────────────────────────────────────
export const employeesTableConfig: EntityViewConfig = {
  id: "employees-table",
  title: "Employees",
  description: "All employees and their details",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search by name, email, or employee number…",
    searchKeys: ["name", "workEmail", "employeeNumber", "jobTitle"],
    filters: [
      {
        key: "employmentType",
        label: "Type",
        type: "select",
        options: [
          { value: "FullTime", label: "Full-Time" },
          { value: "PartTime", label: "Part-Time" },
          { value: "Contract", label: "Contract" },
          { value: "Intern", label: "Intern" },
        ],
      },
    ],
    columns: [
      { key: "employeeNumber", label: "#", width: "min-w-20" },
      { key: "name", label: "Name", width: "min-w-40" },
      { key: "jobTitle", label: "Job Title", width: "min-w-36" },
      { key: "departmentId", label: "Department", width: "min-w-32" },
      { key: "employmentType", label: "Type", type: "badge", ...employmentTypeBadges },
      { key: "workEmail", label: "Email", width: "min-w-40" },
      { key: "dateHired", label: "Hire Date", type: "date" },
      { key: "isActive", label: "Active", type: "boolean" },
    ],
    emptyMessage: "No employees found.",
  },
}

// ── Departments ───────────────────────────────────────────────────────────────
export const departmentsTableConfig: EntityViewConfig = {
  id: "departments-table",
  title: "Departments",
  description: "Company departments and structure",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search departments…",
    searchKeys: ["name", "completeName"],
    columns: [
      { key: "name", label: "Name", width: "min-w-36" },
      { key: "completeName", label: "Full Path", width: "min-w-48" },
      { key: "managerId", label: "Manager", width: "min-w-32" },
      { key: "parentId", label: "Parent Dept.", width: "min-w-32" },
      { key: "isActive", label: "Active", type: "boolean" },
    ],
    emptyMessage: "No departments found.",
  },
}

// ── Leave Requests ────────────────────────────────────────────────────────────
export const leaveRequestsTableConfig: EntityViewConfig = {
  id: "leave-requests-table",
  title: "Leave Requests",
  description: "Employee time-off requests",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search leave requests…",
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "Draft", label: "Draft" },
          { value: "Confirm", label: "To Approve" },
          { value: "ValidatedOne", label: "Second Approval" },
          { value: "Validated", label: "Approved" },
          { value: "Refused", label: "Refused" },
        ],
      },
    ],
    columns: [
      { key: "employeeId", label: "Employee", width: "min-w-36" },
      { key: "leaveTypeId", label: "Leave Type", width: "min-w-32" },
      { key: "state", label: "Status", type: "badge", ...leaveStateBadges },
      { key: "dateFrom", label: "From", type: "date" },
      { key: "dateTo", label: "To", type: "date" },
      { key: "numberOfDays", label: "Days", type: "number", align: "right" },
    ],
    emptyMessage: "No leave requests found.",
  },
}

// ── Contracts ─────────────────────────────────────────────────────────────────
export const contractsTableConfig: EntityViewConfig = {
  id: "contracts-table",
  title: "Contracts",
  description: "Employee employment contracts",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search contracts…",
    searchKeys: ["name"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "New", label: "New" },
          { value: "Open", label: "Running" },
          { value: "Expired", label: "Expired" },
          { value: "Cancelled", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Contract", width: "min-w-36" },
      { key: "employeeId", label: "Employee", width: "min-w-36" },
      { key: "state", label: "Status", type: "badge", ...contractStateBadges },
      { key: "dateStart", label: "Start", type: "date" },
      { key: "dateEnd", label: "End", type: "date" },
      { key: "wage", label: "Wage", type: "currency", align: "right" },
    ],
    emptyMessage: "No contracts found.",
  },
}

// ── Payslips ──────────────────────────────────────────────────────────────────
export const payslipsTableConfig: EntityViewConfig = {
  id: "payslips-table",
  title: "Payslips",
  description: "Employee payroll records",
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: "Search payslips…",
    searchKeys: ["name", "number"],
    filters: [
      {
        key: "state",
        label: "Status",
        type: "select",
        options: [
          { value: "Draft", label: "Draft" },
          { value: "Verify", label: "Waiting" },
          { value: "Done", label: "Done" },
          { value: "Cancelled", label: "Cancelled" },
        ],
      },
    ],
    columns: [
      { key: "name", label: "Reference", width: "min-w-36" },
      { key: "employeeId", label: "Employee", width: "min-w-36" },
      { key: "state", label: "Status", type: "badge", ...payslipStateBadges },
      { key: "dateFrom", label: "Period Start", type: "date" },
      { key: "dateTo", label: "Period End", type: "date" },
      { key: "basicWage", label: "Basic Wage", type: "currency", align: "right" },
      { key: "grossWage", label: "Gross", type: "currency", align: "right" },
      { key: "netWage", label: "Net", type: "currency", align: "right" },
    ],
    emptyMessage: "No payslips found.",
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────
export const hrEntityConfigs: Record<string, EntityViewConfig> = {
  "employees-table": employeesTableConfig,
  "departments-table": departmentsTableConfig,
  "leave-requests-table": leaveRequestsTableConfig,
  "contracts-table": contractsTableConfig,
  "payslips-table": payslipsTableConfig,
}

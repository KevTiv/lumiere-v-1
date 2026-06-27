import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const newEmployeeForm = (t: TFunction): FormConfig => ({
  id: "new-employee",
  title: t("hr.forms.newEmployee.title"),
  description: t("hr.forms.newEmployee.description"),
  sections: [
    {
      id: "emp-personal",
      title: t("hr.forms.newEmployee.sections.personalInformation"),
      fields: [
        {
          id: "emp-name",
          type: "text",
          name: "name",
          label: t("hr.forms.newEmployee.fields.name"),
          placeholder: t("hr.forms.newEmployee.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "emp-employment-type",
          type: "select",
          name: "employmentType",
          label: t("hr.forms.newEmployee.fields.employmentType"),
          required: true,
          width: "1/2",
          options: [
            { value: "FullTime", label: t("hr.forms.newEmployee.fields.options.FullTime") },
            { value: "PartTime", label: t("hr.forms.newEmployee.fields.options.PartTime") },
            { value: "Contract", label: t("hr.forms.newEmployee.fields.options.Contract") },
            { value: "Intern", label: t("hr.forms.newEmployee.fields.options.Intern") },
          ],
        },
        {
          id: "emp-job-title",
          type: "text",
          name: "jobTitle",
          label: t("hr.forms.newEmployee.fields.jobTitle"),
          placeholder: t("hr.forms.newEmployee.fields.jobTitlePlaceholder"),
          width: "1/2",
        },
        {
          id: "emp-department",
          type: "select",
          name: "departmentId",
          label: t("hr.forms.newEmployee.fields.departmentId"),
          placeholder: t("hr.forms.newEmployee.fields.departmentPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
      ],
    },
    {
      id: "emp-contact",
      title: t("hr.forms.newEmployee.sections.contact"),
      fields: [
        {
          id: "emp-work-email",
          type: "text",
          name: "workEmail",
          label: t("hr.forms.newEmployee.fields.workEmail"),
          placeholder: t("hr.forms.newEmployee.fields.workEmailPlaceholder"),
          width: "1/2",
        },
        {
          id: "emp-work-phone",
          type: "text",
          name: "workPhone",
          label: t("hr.forms.newEmployee.fields.workPhone"),
          placeholder: t("hr.forms.newEmployee.fields.workPhonePlaceholder"),
          width: "1/2",
        },
        {
          id: "emp-work-location",
          type: "text",
          name: "workLocation",
          label: t("hr.forms.newEmployee.fields.workLocation"),
          placeholder: t("hr.forms.newEmployee.fields.workLocationPlaceholder"),
          width: "1/2",
        },
        {
          id: "emp-hire-date",
          type: "date",
          name: "dateHired",
          label: t("hr.forms.newEmployee.fields.dateHired"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newLeaveRequestForm = (t: TFunction): FormConfig => ({
  id: "new-leave-request",
  title: t("hr.forms.newLeaveRequest.title"),
  description: t("hr.forms.newLeaveRequest.description"),
  sections: [
    {
      id: "leave-details",
      title: t("hr.forms.newLeaveRequest.sections.leaveDetails"),
      fields: [
        {
          id: "leave-emp-id",
          type: "select",
          name: "employeeId",
          label: t("hr.forms.newLeaveRequest.fields.employeeId"),
          placeholder: t("hr.forms.newLeaveRequest.fields.employeePlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "leave-type-id",
          type: "select",
          name: "leaveTypeId",
          label: t("hr.forms.newLeaveRequest.fields.leaveTypeId"),
          placeholder: t("hr.forms.newLeaveRequest.fields.leaveTypePlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "leave-date-from",
          type: "date",
          name: "dateFrom",
          label: t("hr.forms.newLeaveRequest.fields.dateFrom"),
          required: true,
          width: "1/3",
        },
        {
          id: "leave-date-to",
          type: "date",
          name: "dateTo",
          label: t("hr.forms.newLeaveRequest.fields.dateTo"),
          required: true,
          width: "1/3",
        },
        {
          id: "leave-number-of-days",
          type: "number",
          name: "numberOfDays",
          label: t("hr.forms.newLeaveRequest.fields.numberOfDays"),
          placeholder: "0",
          required: true,
          width: "1/3",
        },
        {
          id: "leave-reason",
          type: "textarea",
          name: "notes",
          label: t("hr.forms.newLeaveRequest.fields.notes"),
          placeholder: t("hr.forms.newLeaveRequest.fields.notesPlaceholder"),
          width: "full",
        },
      ],
    },
  ],
})

export const newContractForm = (t: TFunction): FormConfig => ({
  id: "new-contract",
  title: t("hr.forms.newContract.title"),
  description: t("hr.forms.newContract.description"),
  sections: [
    {
      id: "contract-details",
      title: t("hr.forms.newContract.sections.contractDetails"),
      fields: [
        {
          id: "contract-ref",
          type: "text",
          name: "name",
          label: t("hr.forms.newContract.fields.name"),
          placeholder: t("hr.forms.newContract.fields.namePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "contract-emp-id",
          type: "select",
          name: "employeeId",
          label: t("hr.forms.newContract.fields.employeeId"),
          placeholder: t("hr.forms.newContract.fields.employeePlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "contract-wage",
          type: "number",
          name: "wage",
          label: t("hr.forms.newContract.fields.wage"),
          placeholder: "0.00",
          required: true,
          width: "1/2",
        },
        {
          id: "contract-pricelist",
          type: "select",
          name: "pricelistId",
          label: t("hr.forms.newContract.fields.pricelistId"),
          placeholder: t("hr.forms.newContract.fields.pricelistPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "contract-date-start",
          type: "date",
          name: "dateStart",
          label: t("hr.forms.newContract.fields.dateStart"),
          required: true,
          width: "1/2",
        },
        {
          id: "contract-date-end",
          type: "date",
          name: "dateEnd",
          label: t("hr.forms.newContract.fields.dateEnd"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newPayslipForm = (t: TFunction): FormConfig => ({
  id: "new-payslip",
  title: t("hr.forms.newPayslip.title"),
  description: t("hr.forms.newPayslip.description"),
  sections: [
    {
      id: "payslip-details",
      title: t("hr.forms.newPayslip.sections.payslipDetails"),
      fields: [
        {
          id: "payslip-emp-id",
          type: "number",
          name: "employeeId",
          label: t("hr.forms.newPayslip.fields.employeeId"),
          placeholder: t("hr.forms.newPayslip.fields.employeePlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "payslip-struct-id",
          type: "number",
          name: "structId",
          label: t("hr.forms.newPayslip.fields.structId"),
          placeholder: t("hr.forms.newPayslip.fields.structPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "payslip-date-from",
          type: "date",
          name: "dateFrom",
          label: t("hr.forms.newPayslip.fields.dateFrom"),
          required: true,
          width: "1/2",
        },
        {
          id: "payslip-date-to",
          type: "date",
          name: "dateTo",
          label: t("hr.forms.newPayslip.fields.dateTo"),
          required: true,
          width: "1/2",
        },
        {
          id: "payslip-basic-wage",
          type: "number",
          name: "basicWage",
          label: t("hr.forms.newPayslip.fields.basicWage"),
          placeholder: "0.00",
          required: true,
          width: "1/2",
        },
        {
          id: "payslip-contract-id",
          type: "number",
          name: "contractId",
          label: t("hr.forms.newPayslip.fields.contractId"),
          placeholder: t("hr.forms.newPayslip.fields.contractPlaceholder"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newJobPositionForm = (t: TFunction): FormConfig => ({
  id: "new-job-position",
  title: t("hr.forms.newJobPosition.title"),
  description: t("hr.forms.newJobPosition.description"),
  sections: [
    {
      id: "job-details",
      title: t("hr.forms.newJobPosition.sections.positionDetails"),
      fields: [
        {
          id: "job-title",
          type: "text",
          name: "name",
          label: t("hr.forms.newJobPosition.fields.name"),
          placeholder: t("hr.forms.newJobPosition.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "job-department",
          type: "select",
          name: "departmentId",
          label: t("hr.forms.newJobPosition.fields.departmentId"),
          placeholder: t("hr.forms.newJobPosition.fields.departmentPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "job-expected-employees",
          type: "number",
          name: "expectedEmployees",
          label: t("hr.forms.newJobPosition.fields.expectedEmployees"),
          placeholder: t("hr.forms.newJobPosition.fields.expectedEmployeesPlaceholder"),
          width: "1/2",
        },
        {
          id: "job-status",
          type: "select",
          name: "state",
          label: t("hr.forms.newJobPosition.fields.state"),
          width: "1/2",
          options: [
            { value: "recruit", label: t("hr.forms.newJobPosition.fields.options.recruit") },
            { value: "open", label: t("hr.forms.newJobPosition.fields.options.open") },
          ],
        },
      ],
    },
  ],
})

export const newDepartmentForm = (t: TFunction): FormConfig => ({
  id: "new-department",
  title: t("hr.forms.newDepartment.title"),
  description: t("hr.forms.newDepartment.description"),
  sections: [
    {
      id: "dept-details",
      title: t("hr.forms.newDepartment.sections.departmentDetails"),
      fields: [
        {
          id: "dept-name",
          type: "text",
          name: "name",
          label: t("hr.forms.newDepartment.fields.name"),
          placeholder: t("hr.forms.newDepartment.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "dept-parent",
          type: "select",
          name: "parentId",
          label: t("hr.forms.newDepartment.fields.parentId"),
          placeholder: t("hr.forms.newDepartment.fields.parentPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "dept-manager",
          type: "select",
          name: "managerId",
          label: t("hr.forms.newDepartment.fields.managerId"),
          placeholder: t("hr.forms.newDepartment.fields.managerPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "dept-note",
          type: "textarea",
          name: "note",
          label: t("hr.forms.newDepartment.fields.note"),
          placeholder: t("hr.forms.newDepartment.fields.notePlaceholder"),
          width: "full",
        },
      ],
    },
  ],
})

export const newLeaveTypeForm = (t: TFunction): FormConfig => ({
  id: "new-leave-type",
  title: t("hr.forms.newLeaveType.title"),
  description: t("hr.forms.newLeaveType.description"),
  sections: [
    {
      id: "leave-type-details",
      title: t("hr.forms.newLeaveType.sections.details"),
      fields: [
        {
          id: "lt-name",
          type: "text",
          name: "name",
          label: t("hr.forms.newLeaveType.fields.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "lt-code",
          type: "text",
          name: "code",
          label: t("hr.forms.newLeaveType.fields.code"),
          width: "1/2",
        },
        {
          id: "lt-allocation",
          type: "select",
          name: "allocationType",
          label: t("hr.forms.newLeaveType.fields.allocationType"),
          required: true,
          width: "1/2",
          options: [
            { value: "fixed", label: t("hr.forms.newLeaveType.fields.options.fixed") },
            { value: "accrual", label: t("hr.forms.newLeaveType.fields.options.accrual") },
          ],
        },
        {
          id: "lt-max",
          type: "number",
          name: "maxLeaves",
          label: t("hr.forms.newLeaveType.fields.maxLeaves"),
          required: true,
          width: "1/2",
        },
        {
          id: "lt-active",
          type: "checkbox",
          name: "isActive",
          label: t("hr.forms.newLeaveType.fields.isActive"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newPayrollStructureForm = (t: TFunction): FormConfig => ({
  id: "new-payroll-structure",
  title: t("hr.forms.newPayrollStructure.title"),
  description: t("hr.forms.newPayrollStructure.description"),
  sections: [
    {
      id: "struct-details",
      title: t("hr.forms.newPayrollStructure.sections.details"),
      fields: [
        {
          id: "struct-name",
          type: "text",
          name: "name",
          label: t("hr.forms.newPayrollStructure.fields.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "struct-type",
          type: "select",
          name: "type",
          label: t("hr.forms.newPayrollStructure.fields.type"),
          required: true,
          width: "1/2",
          options: [
            { value: "regular", label: t("hr.forms.newPayrollStructure.fields.options.regular") },
            { value: "bonus", label: t("hr.forms.newPayrollStructure.fields.options.bonus") },
          ],
        },
        {
          id: "struct-active",
          type: "checkbox",
          name: "isActive",
          label: t("hr.forms.newPayrollStructure.fields.isActive"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const newSalaryRuleForm = (t: TFunction): FormConfig => ({
  id: "new-salary-rule",
  title: t("hr.forms.newSalaryRule.title"),
  description: t("hr.forms.newSalaryRule.description"),
  sections: [
    {
      id: "rule-details",
      title: t("hr.forms.newSalaryRule.sections.details"),
      fields: [
        {
          id: "rule-name",
          type: "text",
          name: "name",
          label: t("hr.forms.newSalaryRule.fields.name"),
          required: true,
          width: "1/2",
        },
        {
          id: "rule-code",
          type: "text",
          name: "code",
          label: t("hr.forms.newSalaryRule.fields.code"),
          required: true,
          width: "1/2",
        },
        {
          id: "rule-structure",
          type: "select",
          name: "structureId",
          label: t("hr.forms.newSalaryRule.fields.structureId"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "rule-category",
          type: "text",
          name: "category",
          label: t("hr.forms.newSalaryRule.fields.category"),
          required: true,
          width: "1/2",
        },
        {
          id: "rule-condition",
          type: "select",
          name: "conditionType",
          label: t("hr.forms.newSalaryRule.fields.conditionType"),
          required: true,
          width: "1/3",
          options: [
            { value: "none", label: t("hr.forms.newSalaryRule.fields.options.none") },
            { value: "range", label: t("hr.forms.newSalaryRule.fields.options.range") },
          ],
        },
        {
          id: "rule-amount-type",
          type: "select",
          name: "amountType",
          label: t("hr.forms.newSalaryRule.fields.amountType"),
          required: true,
          width: "1/3",
          options: [
            { value: "fixed", label: t("hr.forms.newSalaryRule.fields.options.fixed") },
            { value: "percent", label: t("hr.forms.newSalaryRule.fields.options.percent") },
          ],
        },
        {
          id: "rule-sequence",
          type: "number",
          name: "sequence",
          label: t("hr.forms.newSalaryRule.fields.sequence"),
          required: true,
          width: "1/3",
        },
        {
          id: "rule-amount-fix",
          type: "number",
          name: "amountFix",
          label: t("hr.forms.newSalaryRule.fields.amountFix"),
          width: "1/2",
        },
        {
          id: "rule-amount-pct",
          type: "number",
          name: "amountPercentage",
          label: t("hr.forms.newSalaryRule.fields.amountPercentage"),
          width: "1/2",
        },
        {
          id: "rule-active",
          type: "checkbox",
          name: "isActive",
          label: t("hr.forms.newSalaryRule.fields.isActive"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const hrFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-employee": newEmployeeForm(t),
  "new-leave-request": newLeaveRequestForm(t),
  "new-contract": newContractForm(t),
  "new-payslip": newPayslipForm(t),
  "new-job-position": newJobPositionForm(t),
  "new-department": newDepartmentForm(t),
  "new-leave-type": newLeaveTypeForm(t),
  "new-payroll-structure": newPayrollStructureForm(t),
  "new-salary-rule": newSalaryRuleForm(t),
})

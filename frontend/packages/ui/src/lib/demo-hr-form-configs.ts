import type { FormConfig } from "./form-types"

export const newEmployeeForm: FormConfig = {
  id: "new-employee",
  title: "New Employee",
  description: "Add a new employee to the company",
  sections: [
    {
      id: "emp-personal",
      title: "Personal Information",
      fields: [
        {
          type: "text",
          name: "name",
          label: "Full Name",
          placeholder: "e.g. Jane Doe",
          required: true,
          width: "half",
        },
        {
          type: "select",
          name: "employmentType",
          label: "Employment Type",
          required: true,
          width: "half",
          options: [
            { value: "FullTime", label: "Full-Time" },
            { value: "PartTime", label: "Part-Time" },
            { value: "Contract", label: "Contract" },
            { value: "Intern", label: "Intern" },
          ],
        },
        {
          type: "text",
          name: "jobTitle",
          label: "Job Title",
          placeholder: "e.g. Software Engineer",
          width: "half",
        },
        {
          type: "number",
          name: "departmentId",
          label: "Department",
          placeholder: "Department ID",
          width: "half",
        },
      ],
    },
    {
      id: "emp-contact",
      title: "Contact",
      fields: [
        {
          type: "text",
          name: "workEmail",
          label: "Work Email",
          placeholder: "jane@company.com",
          width: "half",
        },
        {
          type: "text",
          name: "workPhone",
          label: "Work Phone",
          placeholder: "+1 555 000 0000",
          width: "half",
        },
        {
          type: "text",
          name: "workLocation",
          label: "Work Location",
          placeholder: "e.g. Office, Remote",
          width: "half",
        },
        {
          type: "date",
          name: "dateHired",
          label: "Hire Date",
          width: "half",
        },
      ],
    },
  ],
}

export const newLeaveRequestForm: FormConfig = {
  id: "new-leave-request",
  title: "New Leave Request",
  description: "Submit a time-off request",
  sections: [
    {
      id: "leave-details",
      title: "Leave Details",
      fields: [
        {
          type: "number",
          name: "employeeId",
          label: "Employee",
          placeholder: "Employee ID",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "leaveTypeId",
          label: "Leave Type",
          placeholder: "Leave Type ID",
          required: true,
          width: "half",
        },
        {
          type: "date",
          name: "dateFrom",
          label: "From",
          required: true,
          width: "third",
        },
        {
          type: "date",
          name: "dateTo",
          label: "To",
          required: true,
          width: "third",
        },
        {
          type: "number",
          name: "numberOfDays",
          label: "Number of Days",
          placeholder: "0",
          required: true,
          width: "third",
        },
        {
          type: "textarea",
          name: "notes",
          label: "Reason",
          placeholder: "Reason for leave…",
          width: "full",
        },
      ],
    },
  ],
}

export const newContractForm: FormConfig = {
  id: "new-contract",
  title: "New Contract",
  description: "Create an employment contract",
  sections: [
    {
      id: "contract-details",
      title: "Contract Details",
      fields: [
        {
          type: "text",
          name: "name",
          label: "Contract Reference",
          placeholder: "e.g. EMP-001-2024",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "employeeId",
          label: "Employee",
          placeholder: "Employee ID",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "wage",
          label: "Monthly Wage",
          placeholder: "0.00",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "currencyId",
          label: "Currency",
          placeholder: "Currency ID",
          required: true,
          width: "half",
        },
        {
          type: "date",
          name: "dateStart",
          label: "Start Date",
          required: true,
          width: "half",
        },
        {
          type: "date",
          name: "dateEnd",
          label: "End Date",
          width: "half",
        },
      ],
    },
  ],
}

export const newPayslipForm: FormConfig = {
  id: "new-payslip",
  title: "New Payslip",
  description: "Generate an employee payslip",
  sections: [
    {
      id: "payslip-details",
      title: "Payslip Details",
      fields: [
        {
          type: "number",
          name: "employeeId",
          label: "Employee",
          placeholder: "Employee ID",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "structId",
          label: "Payroll Structure",
          placeholder: "Structure ID",
          required: true,
          width: "half",
        },
        {
          type: "date",
          name: "dateFrom",
          label: "Period Start",
          required: true,
          width: "half",
        },
        {
          type: "date",
          name: "dateTo",
          label: "Period End",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "basicWage",
          label: "Basic Wage",
          placeholder: "0.00",
          required: true,
          width: "half",
        },
        {
          type: "number",
          name: "contractId",
          label: "Contract",
          placeholder: "Contract ID",
          width: "half",
        },
      ],
    },
  ],
}

import type { FormConfig } from "./form-types"

export const newLeadForm: FormConfig = {
  id: "new-lead",
  title: "New Lead",
  description: "Capture a new incoming lead",
  sections: [
    {
      id: "lead-contact",
      title: "Contact",
      fields: [
        {
          id: "contactName",
          type: "text",
          label: "Contact Name",
          placeholder: "Jane Smith",
          required: true,
          width: "1/2",
        },
        {
          id: "partnerName",
          type: "text",
          label: "Company",
          placeholder: "Acme Corp",
          width: "1/2",
        },
        {
          id: "emailFrom",
          type: "text",
          label: "Email",
          placeholder: "jane@acme.com",
          width: "1/2",
        },
        {
          id: "phone",
          type: "text",
          label: "Phone",
          placeholder: "+1 555 0100",
          width: "1/2",
        },
      ],
    },
    {
      id: "lead-details",
      title: "Details",
      fields: [
        {
          id: "expectedRevenue",
          type: "number",
          label: "Expected Revenue",
          placeholder: "0",
          width: "1/2",
        },
        {
          id: "probability",
          type: "number",
          label: "Probability %",
          placeholder: "10",
          width: "1/2",
        },
        {
          id: "description",
          type: "textarea",
          label: "Notes",
          placeholder: "Lead context and background…",
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
}

export const newOpportunityForm: FormConfig = {
  id: "new-opportunity",
  title: "New Opportunity",
  description: "Create a new sales opportunity",
  sections: [
    {
      id: "opp-info",
      title: "Opportunity",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Opportunity Name",
          placeholder: "Enterprise deal — Acme Corp",
          required: true,
          width: "full",
        },
        {
          id: "expectedRevenue",
          type: "number",
          label: "Expected Revenue",
          placeholder: "0",
          width: "1/2",
        },
        {
          id: "probability",
          type: "number",
          label: "Win Probability %",
          placeholder: "20",
          width: "1/2",
        },
        {
          id: "dateDeadline",
          type: "date",
          label: "Expected Close Date",
          width: "1/2",
        },
        {
          id: "priority",
          type: "select",
          label: "Priority",
          width: "1/2",
          options: [
            { value: "Low", label: "Low" },
            { value: "Medium", label: "Medium" },
            { value: "High", label: "High" },
          ],
        },
      ],
    },
  ],
}

export const newContactForm: FormConfig = {
  id: "new-contact",
  title: "New Contact",
  description: "Add a customer, vendor, or partner",
  sections: [
    {
      id: "contact-identity",
      title: "Identity",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Full Name / Company Name",
          placeholder: "Acme Corp",
          required: true,
          width: "full",
        },
        {
          id: "isCompany",
          type: "checkbox",
          label: "Is a Company",
          width: "1/2",
        },
      ],
    },
    {
      id: "contact-details",
      title: "Details",
      fields: [
        {
          id: "email",
          type: "text",
          label: "Email",
          placeholder: "contact@example.com",
          width: "1/2",
        },
        {
          id: "phone",
          type: "text",
          label: "Phone",
          placeholder: "+1 555 0100",
          width: "1/2",
        },
        {
          id: "city",
          type: "text",
          label: "City",
          width: "1/2",
        },
        {
          id: "zip",
          type: "text",
          label: "ZIP / Postal Code",
          width: "1/2",
        },
      ],
    },
  ],
}

export const crmFormConfigs: Record<string, FormConfig> = {
  "new-lead": newLeadForm,
  "new-opportunity": newOpportunityForm,
  "new-contact": newContactForm,
}

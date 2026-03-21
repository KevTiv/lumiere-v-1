import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newWorkflowForm = (t: TFunction): FormConfig => ({
  id: "new-workflow",
  title: t("workflows.forms.newWorkflow.title"),
  description: t("workflows.forms.newWorkflow.description"),
  sections: [
    {
      id: "workflow-details",
      title: t("workflows.forms.newWorkflow.sections.workflowDetails"),
      fields: [
        {
          id: "name",
          type: "text",
          label: t("workflows.forms.newWorkflow.fields.name"),
          placeholder: t("workflows.forms.newWorkflow.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "model",
          type: "text",
          label: t("workflows.forms.newWorkflow.fields.model"),
          placeholder: t("workflows.forms.newWorkflow.fields.modelPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "stateField",
          type: "text",
          label: t("workflows.forms.newWorkflow.fields.stateField"),
          placeholder: t("workflows.forms.newWorkflow.fields.stateFieldPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "description",
          type: "textarea",
          label: t("workflows.forms.newWorkflow.fields.description"),
          placeholder: t("workflows.forms.newWorkflow.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
        {
          id: "isActive",
          type: "checkbox",
          label: t("workflows.forms.newWorkflow.fields.isActive"),
          width: "1/2",
        },
        {
          id: "onCreate",
          type: "checkbox",
          label: t("workflows.forms.newWorkflow.fields.onCreate"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const workflowsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-workflow": newWorkflowForm(t),
})

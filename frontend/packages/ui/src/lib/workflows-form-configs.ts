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
          name: "name",
          type: "text",
          label: t("workflows.forms.newWorkflow.fields.name"),
          placeholder: t("workflows.forms.newWorkflow.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "model",
          name: "model",
          type: "text",
          label: t("workflows.forms.newWorkflow.fields.model"),
          placeholder: t("workflows.forms.newWorkflow.fields.modelPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "stateField",
          name: "stateField",
          type: "text",
          label: t("workflows.forms.newWorkflow.fields.stateField"),
          placeholder: t("workflows.forms.newWorkflow.fields.stateFieldPlaceholder"),
          required: true,
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("workflows.forms.newWorkflow.fields.description"),
          placeholder: t("workflows.forms.newWorkflow.fields.descriptionPlaceholder"),
          width: "full",
          rows: 2,
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("workflows.forms.newWorkflow.fields.isActive"),
          width: "1/2",
          defaultValue: true,
        },
        {
          id: "onCreate",
          name: "onCreate",
          type: "checkbox",
          label: t("workflows.forms.newWorkflow.fields.onCreate"),
          width: "1/2",
        },
      ],
    },
  ],
})

export interface WorkflowActivityOption {
  value: string
  label: string
}

export const workflowAddActivityForm = (t: TFunction, workflowId: string): FormConfig => ({
  id: "workflow-add-activity",
  title: t("workflows.forms.addActivity.title"),
  description: t("workflows.forms.addActivity.description"),
  sections: [
    {
      id: "activity",
      title: t("workflows.forms.addActivity.sections.details"),
      fields: [
        {
          id: "workflowId",
          name: "workflowId",
          type: "hidden",
          label: "",
          defaultValue: workflowId,
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("workflows.forms.addActivity.fields.name"),
          required: true,
          width: "full",
        },
        {
          id: "kind",
          name: "kind",
          type: "text",
          label: t("workflows.forms.addActivity.fields.kind"),
          defaultValue: "Dummy",
          width: "1/2",
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("workflows.forms.addActivity.fields.sequence"),
          defaultValue: 0,
          width: "1/2",
        },
        {
          id: "splitMode",
          name: "splitMode",
          type: "text",
          label: t("workflows.forms.addActivity.fields.splitMode"),
          defaultValue: "XOR",
          width: "1/2",
        },
        {
          id: "joinMode",
          name: "joinMode",
          type: "text",
          label: t("workflows.forms.addActivity.fields.joinMode"),
          defaultValue: "XOR",
          width: "1/2",
        },
        {
          id: "flowStart",
          name: "flowStart",
          type: "checkbox",
          label: t("workflows.forms.addActivity.fields.flowStart"),
          width: "1/2",
        },
        {
          id: "flowStop",
          name: "flowStop",
          type: "checkbox",
          label: t("workflows.forms.addActivity.fields.flowStop"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const workflowAddTransitionForm = (
  t: TFunction,
  workflowId: string,
  activityOptions: WorkflowActivityOption[],
): FormConfig => ({
  id: "workflow-add-transition",
  title: t("workflows.forms.addTransition.title"),
  description: t("workflows.forms.addTransition.description"),
  sections: [
    {
      id: "transition",
      title: t("workflows.forms.addTransition.sections.edge"),
      fields: [
        {
          id: "workflowId",
          name: "workflowId",
          type: "hidden",
          label: "",
          defaultValue: workflowId,
        },
        {
          id: "activityFrom",
          name: "activityFrom",
          type: "select",
          label: t("workflows.forms.addTransition.fields.from"),
          required: true,
          options: activityOptions,
          width: "1/2",
        },
        {
          id: "activityTo",
          name: "activityTo",
          type: "select",
          label: t("workflows.forms.addTransition.fields.to"),
          required: true,
          options: activityOptions,
          width: "1/2",
        },
        {
          id: "sequence",
          name: "sequence",
          type: "number",
          label: t("workflows.forms.addTransition.fields.sequence"),
          defaultValue: 0,
          width: "1/2",
        },
        {
          id: "signal",
          name: "signal",
          type: "text",
          label: t("workflows.forms.addTransition.fields.signal"),
          width: "1/2",
        },
      ],
    },
  ],
})

export const workflowImportCsvForm = (t: TFunction): FormConfig => ({
  id: "workflow-import-csv",
  title: t("workflows.forms.importCsv.title"),
  description: t("workflows.forms.importCsv.description"),
  sections: [
    {
      id: "csv",
      title: t("workflows.forms.importCsv.sections.data"),
      fields: [
        {
          id: "csvData",
          name: "csvData",
          type: "textarea",
          label: t("workflows.forms.importCsv.fields.csvData"),
          required: true,
          rows: 12,
          width: "full",
        },
      ],
    },
  ],
})

export const workflowsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-workflow": newWorkflowForm(t),
})

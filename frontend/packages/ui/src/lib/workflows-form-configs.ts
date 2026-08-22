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
          id: "workflowKey",
          name: "workflowKey",
          type: "text",
          label: t("workflows.forms.newWorkflow.fields.workflowKey", {
            defaultValue: "Workflow key",
          }),
          placeholder: "po_confirm",
          required: true,
          width: "1/2",
        },
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("workflows.forms.newWorkflow.fields.name"),
          placeholder: t("workflows.forms.newWorkflow.fields.namePlaceholder"),
          required: true,
          width: "1/2",
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
          id: "trigger",
          name: "trigger",
          type: "select",
          label: t("workflows.forms.newWorkflow.fields.trigger", { defaultValue: "Trigger" }),
          required: true,
          width: "1/2",
          defaultValue: "Manual",
          options: [
            { value: "Manual", label: "Manual" },
            { value: "RecordCreated", label: "Record created" },
            { value: "RecordChanged", label: "Record changed" },
            { value: "Signal", label: "Signal" },
          ],
        },
        {
          id: "schemaVersion",
          name: "schemaVersion",
          type: "number",
          label: t("workflows.forms.newWorkflow.fields.schemaVersion", {
            defaultValue: "Schema version",
          }),
          defaultValue: 1,
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
      ],
    },
  ],
})

export const newWorkflowMigrationPlanForm = (t: TFunction): FormConfig => ({
  id: "create-migration-plan",
  title: t("workflows.forms.migrationPlan.title", { defaultValue: "New migration plan" }),
  description: t("workflows.forms.migrationPlan.description", {
    defaultValue: "Map a published workflow version to its replacement.",
  }),
  sections: [
    {
      id: "migration-plan-details",
      fields: [
        {
          id: "workflowId",
          name: "workflowId",
          type: "number",
          label: t("workflows.forms.migrationPlan.fields.workflowId", { defaultValue: "Workflow ID" }),
          required: true,
        },
        {
          id: "sourceWorkflowVersionId",
          name: "sourceWorkflowVersionId",
          type: "number",
          label: t("workflows.forms.migrationPlan.fields.sourceVersionId", { defaultValue: "Source version ID" }),
          required: true,
        },
        {
          id: "targetWorkflowVersionId",
          name: "targetWorkflowVersionId",
          type: "number",
          label: t("workflows.forms.migrationPlan.fields.targetVersionId", { defaultValue: "Target version ID" }),
          required: true,
        },
      ],
    },
  ],
})

export const workflowImportCsvForm = (t: TFunction): FormConfig => ({
  id: "import-workflow-csv",
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
          rows: 10,
          width: "full",
        },
      ],
    },
  ],
})

/** @deprecated Activity forms removed with Wave 3 graph model. */
export const workflowAddActivityForm = (
  t: TFunction,
  _workflowId: string,
): FormConfig => ({
  id: "workflow-add-activity",
  title: t("workflows.forms.addActivity.title", { defaultValue: "Add node" }),
  description: "Use upsert_workflow_node on a draft version (designer WIP).",
  sections: [],
})

/** @deprecated */
export const workflowAddTransitionForm = (
  t: TFunction,
  _workflowId: string,
  _activityOptions: { value: string; label: string }[] = [],
): FormConfig => ({
  id: "workflow-add-transition",
  title: t("workflows.forms.addTransition.title", { defaultValue: "Add edge" }),
  description: "Use upsert_workflow_edge on a draft version (designer WIP).",
  sections: [],
})

export type WorkflowActivityOption = { value: string; label: string }

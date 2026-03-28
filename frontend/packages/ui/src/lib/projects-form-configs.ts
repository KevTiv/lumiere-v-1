import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

const emptySelect: Array<{ value: string; label: string; disabled?: boolean }> = []

export const newProjectForm = (t: TFunction): FormConfig => ({
  id: "new-project",
  title: t("projects.forms.newProject.title"),
  description: t("projects.forms.newProject.description"),
  sections: [
    {
      id: "proj-info",
      title: t("projects.forms.newProject.sections.projectDetails"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("projects.forms.newProject.fields.name"),
          placeholder: t("projects.forms.newProject.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "pricelistId",
          name: "pricelistId",
          type: "select",
          label: t("projects.forms.newProject.fields.pricelistId"),
          placeholder: t("projects.forms.newProject.fields.pricelistPlaceholder"),
          required: true,
          width: "full",
          options: emptySelect,
        },
        {
          id: "partnerId",
          name: "partnerId",
          type: "select",
          label: t("projects.forms.newProject.fields.partnerId"),
          placeholder: t("projects.forms.newProject.fields.partnerIdPlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "allocatedHours",
          name: "allocatedHours",
          type: "number",
          label: t("projects.forms.newProject.fields.allocatedHours"),
          placeholder: t("projects.forms.newProject.fields.allocatedHoursPlaceholder"),
          width: "1/2",
        },
        {
          id: "dateStart",
          name: "dateStart",
          type: "date",
          label: t("projects.forms.newProject.fields.dateStart"),
          width: "1/2",
        },
        {
          id: "dateEnd",
          name: "dateEnd",
          type: "date",
          label: t("projects.forms.newProject.fields.dateEnd"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("projects.forms.newProject.fields.description"),
          placeholder: t("projects.forms.newProject.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const newTaskForm = (t: TFunction): FormConfig => ({
  id: "new-task",
  title: t("projects.forms.newTask.title"),
  description: t("projects.forms.newTask.description"),
  sections: [
    {
      id: "task-info",
      title: t("projects.forms.newTask.sections.taskDetails"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("projects.forms.newTask.fields.name"),
          placeholder: t("projects.forms.newTask.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "projectId",
          name: "projectId",
          type: "select",
          label: t("projects.forms.newTask.fields.projectId"),
          placeholder: t("projects.forms.newTask.fields.projectIdPlaceholder"),
          required: true,
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "stageId",
          name: "stageId",
          type: "select",
          label: t("projects.forms.newTask.fields.stageId"),
          placeholder: t("projects.forms.newTask.fields.stagePlaceholder"),
          width: "1/2",
          options: emptySelect,
        },
        {
          id: "priority",
          name: "priority",
          type: "select",
          label: t("projects.forms.newTask.fields.priority"),
          width: "1/2",
          options: [
            { value: "0", label: t("projects.forms.newTask.fields.options.0") },
            { value: "1", label: t("projects.forms.newTask.fields.options.1") },
            { value: "2", label: t("projects.forms.newTask.fields.options.2") },
            { value: "3", label: t("projects.forms.newTask.fields.options.3") },
          ],
        },
        {
          id: "plannedHours",
          name: "plannedHours",
          type: "number",
          label: t("projects.forms.newTask.fields.plannedHours"),
          placeholder: t("projects.forms.newTask.fields.plannedHoursPlaceholder"),
          width: "1/2",
        },
        {
          id: "dateDeadline",
          name: "dateDeadline",
          type: "date",
          label: t("projects.forms.newTask.fields.dateDeadline"),
          width: "1/2",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("projects.forms.newTask.fields.description"),
          placeholder: t("projects.forms.newTask.fields.descriptionPlaceholder"),
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
})

export const projectsFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-project": newProjectForm(t),
  "new-task": newTaskForm(t),
})

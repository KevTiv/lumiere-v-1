import type { FormConfig } from "./form-types"

export const newProjectForm: FormConfig = {
  id: "new-project",
  title: "New Project",
  description: "Create a new project",
  sections: [
    {
      id: "proj-info",
      title: "Project Details",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Project Name",
          placeholder: "Website Redesign",
          required: true,
          width: "full",
        },
        {
          id: "partnerId",
          type: "number",
          label: "Customer ID",
          placeholder: "Partner ID",
          width: "1/2",
        },
        {
          id: "allocatedHours",
          type: "number",
          label: "Budget (hours)",
          placeholder: "0",
          width: "1/2",
        },
        {
          id: "dateStart",
          type: "date",
          label: "Start Date",
          width: "1/2",
        },
        {
          id: "dateEnd",
          type: "date",
          label: "Deadline",
          width: "1/2",
        },
        {
          id: "description",
          type: "textarea",
          label: "Description",
          placeholder: "Project scope and objectives…",
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
}

export const newTaskForm: FormConfig = {
  id: "new-task",
  title: "New Task",
  description: "Add a task to a project",
  sections: [
    {
      id: "task-info",
      title: "Task Details",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Task Name",
          placeholder: "Design homepage mockup",
          required: true,
          width: "full",
        },
        {
          id: "projectId",
          type: "number",
          label: "Project ID",
          placeholder: "Project ID",
          required: true,
          width: "1/2",
        },
        {
          id: "priority",
          type: "select",
          label: "Priority",
          width: "1/2",
          options: [
            { value: "0", label: "Normal" },
            { value: "1", label: "Low" },
            { value: "2", label: "High" },
            { value: "3", label: "Urgent" },
          ],
        },
        {
          id: "plannedHours",
          type: "number",
          label: "Planned Hours",
          placeholder: "0",
          width: "1/2",
        },
        {
          id: "dateDeadline",
          type: "date",
          label: "Deadline",
          width: "1/2",
        },
        {
          id: "description",
          type: "textarea",
          label: "Description",
          placeholder: "Task details and acceptance criteria…",
          width: "full",
          rows: 3,
        },
      ],
    },
  ],
}

export const projectsFormConfigs: Record<string, FormConfig> = {
  "new-project": newProjectForm,
  "new-task": newTaskForm,
}

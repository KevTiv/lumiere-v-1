import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export const newRoleForm = (t: TFunction): FormConfig => ({
  id: "new-role",
  title: t("auth.forms.newRole.title"),
  description: t("auth.forms.newRole.description"),
  sections: [
    {
      id: "role-main",
      title: t("auth.forms.newRole.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("auth.forms.newRole.fields.name"),
          placeholder: t("auth.forms.newRole.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("auth.forms.newRole.fields.description"),
          placeholder: t("auth.forms.newRole.fields.descriptionPlaceholder"),
          width: "full",
        },
      ],
    },
  ],
})

export const updateRoleForm = (t: TFunction): FormConfig => ({
  id: "update-role",
  title: t("auth.forms.updateRole.title"),
  description: t("auth.forms.updateRole.description"),
  sections: [
    {
      id: "role-update",
      title: t("auth.forms.updateRole.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("auth.forms.newRole.fields.name"),
          width: "full",
        },
        {
          id: "description",
          name: "description",
          type: "textarea",
          label: t("auth.forms.newRole.fields.description"),
          width: "full",
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("auth.forms.updateRole.fields.isActive"),
          width: "1/2",
          defaultValue: true,
        },
      ],
    },
  ],
})

export const newAuditRuleForm = (t: TFunction): FormConfig => ({
  id: "new-audit-rule",
  title: t("auth.forms.newAuditRule.title"),
  description: t("auth.forms.newAuditRule.description"),
  sections: [
    {
      id: "rule-main",
      title: t("auth.forms.newAuditRule.sections.main"),
      fields: [
        {
          id: "name",
          name: "name",
          type: "text",
          label: t("auth.forms.newAuditRule.fields.name"),
          placeholder: t("auth.forms.newAuditRule.fields.namePlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "resourceType",
          name: "resourceType",
          type: "select",
          label: t("auth.forms.newAuditRule.fields.resourceType"),
          required: true,
          width: "1/2",
          defaultValue: "user",
          options: [
            { value: "user", label: t("auth.forms.newAuditRule.resourceTypes.user") },
            { value: "role", label: t("auth.forms.newAuditRule.resourceTypes.role") },
            { value: "document", label: t("auth.forms.newAuditRule.resourceTypes.document") },
            { value: "invoice", label: t("auth.forms.newAuditRule.resourceTypes.invoice") },
            { value: "product", label: t("auth.forms.newAuditRule.resourceTypes.product") },
            { value: "order", label: t("auth.forms.newAuditRule.resourceTypes.order") },
            { value: "all", label: t("auth.forms.newAuditRule.resourceTypes.all") },
          ],
        },
        {
          id: "actionType",
          name: "actionType",
          type: "select",
          label: t("auth.forms.newAuditRule.fields.actionType"),
          required: true,
          width: "1/2",
          defaultValue: "create",
          options: [
            { value: "create", label: t("auth.forms.newAuditRule.actionTypes.create") },
            { value: "update", label: t("auth.forms.newAuditRule.actionTypes.update") },
            { value: "delete", label: t("auth.forms.newAuditRule.actionTypes.delete") },
            { value: "login", label: t("auth.forms.newAuditRule.actionTypes.login") },
            { value: "logout", label: t("auth.forms.newAuditRule.actionTypes.logout") },
            { value: "export", label: t("auth.forms.newAuditRule.actionTypes.export") },
            { value: "all", label: t("auth.forms.newAuditRule.actionTypes.all") },
          ],
        },
        {
          id: "severity",
          name: "severity",
          type: "select",
          label: t("auth.forms.newAuditRule.fields.severity"),
          width: "1/2",
          defaultValue: "info",
          options: [
            { value: "debug", label: t("auth.forms.newAuditRule.severities.debug") },
            { value: "info", label: t("auth.forms.newAuditRule.severities.info") },
            { value: "warning", label: t("auth.forms.newAuditRule.severities.warning") },
            { value: "error", label: t("auth.forms.newAuditRule.severities.error") },
            { value: "critical", label: t("auth.forms.newAuditRule.severities.critical") },
          ],
        },
        {
          id: "isActive",
          name: "isActive",
          type: "checkbox",
          label: t("auth.forms.newAuditRule.fields.isActive"),
          width: "1/2",
          defaultValue: true,
        },
      ],
    },
  ],
})

export const newUserInviteForm = (t: TFunction): FormConfig => ({
  id: "new-user-invite",
  title: t("auth.forms.newUserInvite.title"),
  description: t("auth.forms.newUserInvite.description"),
  sections: [
    {
      id: "invite-main",
      title: t("auth.forms.newUserInvite.sections.main"),
      fields: [
        {
          id: "email",
          name: "email",
          type: "text",
          label: t("auth.forms.newUserInvite.fields.email"),
          placeholder: t("auth.forms.newUserInvite.fields.emailPlaceholder"),
          required: true,
          width: "full",
        },
        {
          id: "expiresInDays",
          name: "expiresInDays",
          type: "select",
          label: t("auth.forms.newUserInvite.fields.expiresInDays"),
          width: "1/2",
          defaultValue: "7",
          options: [
            { value: "1", label: "1 day" },
            { value: "3", label: "3 days" },
            { value: "7", label: "7 days" },
            { value: "14", label: "14 days" },
            { value: "30", label: "30 days" },
          ],
        },
      ],
    },
  ],
})

export const updateUserPasswordForm = (t: TFunction): FormConfig => ({
  id: "update-user-password",
  title: t("auth.forms.updateUserPassword.title"),
  description: t("auth.forms.updateUserPassword.description"),
  sections: [
    {
      id: "password",
      title: t("auth.forms.updateUserPassword.sections.password"),
      fields: [
        {
          id: "newPassword",
          name: "newPassword",
          type: "text",
          label: t("auth.forms.updateUserPassword.fields.newPassword"),
          required: true,
          width: "full",
        },
        {
          id: "requireReset",
          name: "requireReset",
          type: "checkbox",
          label: t("auth.forms.updateUserPassword.fields.requireReset"),
          width: "full",
          defaultValue: false,
        },
      ],
    },
  ],
})

export const authFormConfigs = (t: TFunction): Record<string, FormConfig> => ({
  "new-role": newRoleForm(t),
  "update-role": updateRoleForm(t),
  "new-audit-rule": newAuditRuleForm(t),
  "new-user-invite": newUserInviteForm(t),
  "update-user-password": updateUserPasswordForm(t),
})

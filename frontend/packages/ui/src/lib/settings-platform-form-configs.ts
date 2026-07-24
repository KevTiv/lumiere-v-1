import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"

export function addOrgMemberForm(t: TFunction, roleOptions: { value: string; label: string }[]): FormConfig {
  return {
    id: "settings-add-org-member",
    title: t("settings.adminOps.members.addByRoleNameTitle"),
    description: t("settings.adminOps.members.addByRoleNameDescription"),
    submitLabel: t("settings.adminOps.members.addSubmit"),
    sections: [
      {
        id: "member",
        fields: [
          {
            id: "userIdentity",
            name: "userIdentity",
            type: "text",
            label: t("settings.adminOps.members.userIdentity"),
            required: true,
            width: "full",
          },
          {
            id: "roleName",
            name: "roleName",
            type: "select",
            label: t("settings.adminOps.members.roleName"),
            required: true,
            options: roleOptions,
            width: "1/2",
          },
          {
            id: "jobTitle",
            name: "jobTitle",
            type: "text",
            label: t("settings.users.department"),
            width: "1/2",
          },
          {
            id: "isActive",
            name: "isActive",
            type: "switch",
            label: t("settings.users.statuses.active"),
            defaultValue: true,
            width: "1/2",
          },
          {
            id: "isDefault",
            name: "isDefault",
            type: "switch",
            label: t("settings.adminOps.members.isDefault"),
            width: "1/2",
          },
        ],
      },
    ],
  }
}

export function addUserToOrganizationForm(
  t: TFunction,
  roleOptions: { value: string; label: string }[],
): FormConfig {
  return {
    id: "settings-add-user-to-organization",
    title: t("settings.adminOps.members.addByRoleIdTitle"),
    description: t("settings.adminOps.members.addByRoleIdDescription"),
    submitLabel: t("settings.adminOps.members.addSubmit"),
    sections: [
      {
        id: "member",
        fields: [
          {
            id: "userIdentity",
            name: "userIdentity",
            type: "text",
            label: t("settings.adminOps.members.userIdentity"),
            required: true,
            width: "full",
          },
          {
            id: "roleId",
            name: "roleId",
            type: "select",
            label: t("settings.users.roles"),
            required: true,
            options: roleOptions,
            width: "1/2",
          },
          {
            id: "jobTitle",
            name: "jobTitle",
            type: "text",
            label: t("settings.users.department"),
            width: "1/2",
          },
          {
            id: "isActive",
            name: "isActive",
            type: "switch",
            label: t("settings.users.statuses.active"),
            defaultValue: true,
            width: "1/2",
          },
          {
            id: "isDefault",
            name: "isDefault",
            type: "switch",
            label: t("settings.adminOps.members.isDefault"),
            width: "1/2",
          },
        ],
      },
    ],
  }
}

export function updateOrgMemberDetailsForm(
  t: TFunction,
  memberOptions: { value: string; label: string }[] = [],
  employeeOptions: { value: string; label: string }[] = [],
): FormConfig {
  return {
    id: "settings-update-org-member-details",
    title: t("settings.adminOps.members.updateDetailsTitle"),
    submitLabel: t("settings.users.saveChanges"),
    sections: [
      {
        id: "details",
        fields: [
          {
            id: "userOrgId",
            name: "userOrgId",
            type: "select",
            label: t("settings.adminOps.members.userOrgId"),
            required: true,
            width: "full",
            options: memberOptions.length > 0 ? memberOptions : [{ value: "", label: "—", disabled: true }],
          },
          {
            id: "jobTitle",
            name: "jobTitle",
            type: "text",
            label: t("settings.users.department"),
            width: "1/2",
          },
          {
            id: "employeeId",
            name: "employeeId",
            type: "select",
            label: t("settings.adminOps.members.employeeId"),
            width: "1/2",
            options: employeeOptions.length > 0 ? employeeOptions : [{ value: "", label: "—", disabled: true }],
          },
        ],
      },
    ],
  }
}

export function updateOrgMemberRoleForm(
  t: TFunction,
  roleOptions: { value: string; label: string }[],
  memberOptions: { value: string; label: string }[] = [],
): FormConfig {
  return {
    id: "settings-update-org-member-role",
    title: t("settings.adminOps.members.updateRoleTitle"),
    submitLabel: t("settings.users.saveChanges"),
    sections: [
      {
        id: "role",
        fields: [
          {
            id: "userOrgId",
            name: "userOrgId",
            type: "select",
            label: t("settings.adminOps.members.userOrgId"),
            required: true,
            width: "1/2",
            options: memberOptions.length > 0 ? memberOptions : [{ value: "", label: "—", disabled: true }],
          },
          {
            id: "roleName",
            name: "roleName",
            type: "select",
            label: t("settings.adminOps.members.roleName"),
            required: true,
            options: roleOptions,
            width: "1/2",
          },
        ],
      },
    ],
  }
}

export function createCountryForm(t: TFunction): FormConfig {
  return {
    id: "settings-create-country",
    title: t("settings.adminOps.reference.createCountryTitle"),
    description: t("settings.adminOps.reference.superuserNote"),
    submitLabel: t("settings.adminOps.reference.createCountrySubmit"),
    sections: [
      {
        id: "country",
        fields: [
          { id: "code", name: "code", type: "text", label: t("settings.adminOps.reference.countryCode"), required: true, width: "1/3" },
          { id: "name", name: "name", type: "text", label: t("settings.adminOps.reference.countryName"), required: true, width: "2/3" },
          { id: "iso3", name: "iso3", type: "text", label: "ISO3", required: true, width: "1/3" },
          { id: "numcode", name: "numcode", type: "number", label: t("settings.adminOps.reference.numcode"), defaultValue: 0, width: "1/3" },
          { id: "phoneCode", name: "phoneCode", type: "text", label: t("settings.adminOps.reference.phoneCode"), required: true, width: "1/3" },
          {
            id: "isActive",
            name: "isActive",
            type: "switch",
            label: t("settings.users.statuses.active"),
            defaultValue: true,
            width: "1/2",
          },
        ],
      },
    ],
  }
}

export function createCurrencyForm(t: TFunction): FormConfig {
  return {
    id: "settings-create-currency",
    title: t("settings.adminOps.reference.createCurrencyTitle"),
    description: t("settings.adminOps.reference.superuserNote"),
    submitLabel: t("settings.adminOps.reference.createCurrencySubmit"),
    sections: [
      {
        id: "currency",
        fields: [
          { id: "code", name: "code", type: "text", label: t("settings.adminOps.reference.currencyCode"), required: true, width: "1/4" },
          { id: "name", name: "name", type: "text", label: t("settings.adminOps.reference.currencyName"), required: true, width: "2/3" },
          { id: "symbol", name: "symbol", type: "text", label: t("settings.adminOps.reference.symbol"), required: true, width: "1/4" },
          { id: "decimalPlaces", name: "decimalPlaces", type: "number", label: t("settings.adminOps.reference.decimalPlaces"), defaultValue: 2, width: "1/4" },
          {
            id: "position",
            name: "position",
            type: "select",
            label: t("settings.adminOps.reference.position"),
            defaultValue: "before",
            width: "1/4",
            options: [
              { value: "before", label: t("settings.adminOps.reference.positionBefore") },
              { value: "after", label: t("settings.adminOps.reference.positionAfter") },
            ],
          },
          {
            id: "active",
            name: "active",
            type: "switch",
            label: t("settings.users.statuses.active"),
            defaultValue: true,
            width: "1/4",
          },
        ],
      },
    ],
  }
}

export function logAuditEventForm(t: TFunction): FormConfig {
  return {
    id: "settings-log-audit-event",
    title: t("settings.adminOps.audit.logEventTitle"),
    description: t("settings.adminOps.audit.logEventDescription"),
    submitLabel: t("settings.adminOps.audit.logEventSubmit"),
    sections: [
      {
        id: "event",
        fields: [
          { id: "tableName", name: "tableName", type: "text", label: t("settings.adminOps.audit.tableName"), required: true, width: "1/2" },
          { id: "recordId", name: "recordId", type: "number", label: t("settings.adminOps.audit.recordId"), required: true, width: "1/2" },
          { id: "action", name: "action", type: "text", label: t("settings.adminOps.audit.action"), required: true, width: "1/2" },
          { id: "companyId", name: "companyId", type: "select", label: t("settings.adminOps.audit.companyId"), width: "1/2", options: [{ value: "", label: "—" }] },
          { id: "oldValues", name: "oldValues", type: "textarea", label: t("settings.adminOps.audit.oldValues"), rows: 2, width: "full" },
          { id: "newValues", name: "newValues", type: "textarea", label: t("settings.adminOps.audit.newValues"), rows: 2, width: "full" },
          { id: "changedFields", name: "changedFields", type: "text", label: t("settings.adminOps.audit.changedFields"), width: "full" },
        ],
      },
    ],
  }
}

export function createUserSessionForm(t: TFunction): FormConfig {
  return {
    id: "settings-create-user-session",
    title: t("settings.adminOps.sessions.createTitle"),
    description: t("settings.adminOps.sessions.createDescription"),
    submitLabel: t("settings.adminOps.sessions.createSubmit"),
    sections: [
      {
        id: "session",
        fields: [
          {
            id: "sessionToken",
            name: "sessionToken",
            type: "text",
            label: t("settings.adminOps.sessions.sessionToken"),
            required: true,
            width: "full",
          },
          {
            id: "expiresAt",
            name: "expiresAt",
            type: "datetime",
            label: t("settings.adminOps.sessions.expiresAt"),
            required: true,
            width: "1/2",
          },
          { id: "ipAddress", name: "ipAddress", type: "text", label: "IP", width: "1/2" },
          { id: "userAgent", name: "userAgent", type: "text", label: "User agent", width: "full" },
        ],
      },
    ],
  }
}

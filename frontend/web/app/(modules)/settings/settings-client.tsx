"use client"

import { i18n as rootI18n, useTranslation as useRootTranslation } from "@lumiere/i18n"
import { i18n as uiI18n } from "@lumiere/i18n"
import { useWorkOsAuthMode } from "@/lib/auth-mode-context"

import { useMemo, useState } from "react"
import { useConfirmDialog } from "@lumiere/ui/hooks/use-confirm-dialog"
import { useTranslation, i18n } from "@lumiere/i18n"
import { useWorkspaceProfile } from "@lumiere/ui/lib/workspace-profile-context"
import { isWorkspaceSurfaceVisible } from "@lumiere/ui/lib/workspace-profile"
import { Plug, Upload, Wrench } from "lucide-react"
import { DashboardHeader, FormModal, MissingOrganization, SettingsModule, type FormConfig, type SettingsExtraSection } from "@lumiere/ui"
import {
  toCreateCompanyParams,
  toCreateWhatsAppBusinessAccountParams,
} from "@lumiere/erp-shared/settings-create-params"
import {
  archiveAiChatSession,
  createGoogleDriveConnection,
  createWhatsAppBusinessAccount,
  deleteIntegration,
  deleteWhatsAppBusinessAccount,
  grantPermission,
  revokePermission,
  setWhatsAppPrimaryAccount,
  updateGoogleDriveConnection,
  updateWhatsAppBusinessAccount,
} from "@lumiere/stdb/client-ui-bridge"
import {
  useCreateAuditRule,
  useCreateUserInviteReducer,
  useCreateUserSession,
  useEndUserSession,
  useLogAuditEvent,
  useRecordPrivacyConsent,
  useUpdateAuditRule,
  useUpdateGoogleDriveCredentials,
  useUpdateOrgMemberRole,
  useUpdateUserEmail,
  useUpdateWhatsappCredentials,
} from "@lumiere/query-hooks/hooks/auth"
import { GuidedImportWizard } from "@/lib/guided-import-wizard"
import { useSettingsModuleSubscription } from "@/lib/module-subscription-hooks"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"
import { currencyOptionsFromRows } from "@/lib/form-lookup"
import { recordOptions, withLinkedPickers } from "@/lib/linked-options"
import { useCompanies, useCreateCompany } from "@lumiere/query-hooks/hooks/organization-company"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { uploadDocumentBlob } from "@/lib/document-blob-upload"

async function uploadInvoiceLogo(file: File, companyId: string | null): Promise<string> {
  if (companyId !== null && (!/^[1-9]\d*$/.test(companyId) || !Number.isSafeInteger(Number(companyId)))) {
    throw new Error("This company identifier cannot be safely used for logo upload")
  }
  const uploaded = await uploadDocumentBlob({ file, companyId: companyId === null ? undefined : BigInt(companyId), purpose: "branding" })
  return `${uploaded.url}?sha256=${uploaded.checksum}`
}

type SettingsAction =
  | "createAuditRule"
  | "updateAuditRule"
  | "endSession"
  | "updateEmail"
  | "recordPrivacyConsent"
  | "googleDriveCredentials"
  | "whatsappCredentials"
  | "createGoogleDriveConnection"
  | "updateGoogleDriveConnection"
  | "deleteIntegration"
  | "createWhatsappBusinessAccount"
  | "updateWhatsappBusinessAccount"
  | "deleteWhatsappBusinessAccount"
  | "setWhatsappPrimaryAccount"
  | "grantPermission"
  | "revokePermission"
  | "archiveAiChatSession"
  | "updateOrgMemberRole"
  | "createUserInviteDirect"
  | "createUserSession"
  | "logAuditEvent"

const INTEGRATION_SETTINGS_ACTIONS: SettingsAction[] = [
  "googleDriveCredentials",
  "whatsappCredentials",
  "createGoogleDriveConnection",
  "updateGoogleDriveConnection",
  "deleteIntegration",
  "createWhatsappBusinessAccount",
  "updateWhatsappBusinessAccount",
  "deleteWhatsappBusinessAccount",
  "setWhatsappPrimaryAccount",
]

const syncDirectionOptions = [
  { value: "UploadOnly", get label() { return uiI18n.t("settings.builtIn.settingsClient.syncDirectionOptions.uploadOnly.label") } },
  { value: "DownloadOnly", get label() { return uiI18n.t("settings.builtIn.settingsClient.syncDirectionOptions.downloadOnly.label") } },
  { value: "Bidirectional", get label() { return uiI18n.t("settings.builtIn.settingsClient.syncDirectionOptions.bidirectional.label") } },
]

const integrationTypeOptions = [
  { value: "GoogleDrive", label: "Google Drive" },
  { value: "WhatsAppBusiness", label: "WhatsApp Business" },
]

const permissionActionOptions = [
  { value: "Read", get label() { return uiI18n.t("settings.builtIn.settingsClient.permissionActionOptions.read.label") } },
  { value: "Write", get label() { return uiI18n.t("settings.builtIn.settingsClient.permissionActionOptions.write.label") } },
  { value: "Create", get label() { return uiI18n.t("common.create") } },
  { value: "Delete", get label() { return uiI18n.t("common.delete") } },
  { value: "All", get label() { return uiI18n.t("settings.builtIn.settingsClient.permissionActionOptions.all.label") } },
]

// `createCompany` is only used by the first-organization setup; Settings edits companies inline.
const settingsActionForms: Record<SettingsAction | "createCompany", FormConfig> = {
  createCompany: {
    id: "settings-create-company",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsCreateCompany.title") },
    get submitLabel() { return uiI18n.t("settings.organization.company.createSubmit") },
    sections: [
      {
        id: "company",
        fields: [
          { id: "name", type: "text", name: "name", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.name.label") }, required: true, width: "1/2" },
          { id: "code", type: "text", name: "code", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.code.label") }, required: true, width: "1/2" },
          { id: "currency", type: "number", name: "currencyId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.currency.label") }, required: true, width: "1/2" },
          { id: "country", type: "text", name: "addressCountryCode", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.country.label") }, width: "1/2" },
        ],
      },
    ],
  },
  createAuditRule: {
    id: "settings-create-audit-rule",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsCreateAuditRule.title") },
    get submitLabel() { return uiI18n.t("settings.roles.sod.submit") },
    sections: [
      {
        id: "rule",
        fields: [
          { id: "name", type: "text", name: "name", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.name.label") }, required: true, width: "full" },
          { id: "resource", type: "text", name: "resourceType", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.resource.label") }, required: true, width: "1/2" },
          { id: "action", type: "text", name: "actionType", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.action.label") }, required: true, width: "1/2" },
          { id: "severity", type: "text", name: "severity", get label() { return uiI18n.t("settings.ai.severity") }, defaultValue: "info", width: "1/2" },
          { id: "active", type: "switch", name: "isActive", get label() { return uiI18n.t("common.active") }, defaultValue: true, width: "1/2" },
        ],
      },
    ],
  },
  updateAuditRule: {
    id: "settings-update-audit-rule",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateAuditRule.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateAuditRule.submitLabel") },
    sections: [
      {
        id: "rule",
        fields: [
          { id: "rule-id", type: "number", name: "ruleId", get label() { return uiI18n.t("settings.adminOps.casbin.ruleId") }, required: true, width: "1/2" },
          { id: "name", type: "text", name: "name", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.name.label") }, width: "1/2" },
          { id: "resource", type: "text", name: "resourceType", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.resource.label") }, width: "1/2" },
          { id: "action", type: "text", name: "actionType", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.action.label") }, width: "1/2" },
          { id: "severity", type: "text", name: "severity", get label() { return uiI18n.t("settings.ai.severity") }, width: "1/2" },
          { id: "active", type: "switch", name: "isActive", get label() { return uiI18n.t("common.active") }, width: "1/2" },
        ],
      },
    ],
  },
  endSession: {
    id: "settings-end-session",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsEndSession.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsEndSession.submitLabel") },
    sections: [{ id: "session", fields: [{ id: "session-id", type: "number", name: "sessionId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.sessionId.label") }, required: true }] }],
  },
  updateEmail: {
    id: "settings-update-email",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateEmail.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateEmail.submitLabel") },
    sections: [
      {
        id: "email",
        fields: [
          { id: "email", type: "email", name: "email", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.email.label") }, required: true, width: "1/2" },
          { id: "verified", type: "switch", name: "emailVerified", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.verified.label") }, width: "1/2" },
        ],
      },
    ],
  },
  recordPrivacyConsent: {
    id: "settings-record-privacy-consent",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsRecordPrivacyConsent.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsRecordPrivacyConsent.submitLabel") },
    sections: [
      {
        id: "privacy",
        fields: [
          { id: "contact", type: "number", name: "contactId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.contact.label") }, required: true, width: "1/2" },
          { id: "type", type: "text", name: "consentType", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.type.label") }, required: true, width: "1/2" },
          { id: "granted", type: "switch", name: "granted", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.granted.label") }, defaultValue: true, width: "1/2" },
          { id: "ip", type: "text", name: "ipAddress", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.ip.label") }, width: "1/2" },
          { id: "agent", type: "text", name: "userAgent", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.agent.label") }, width: "full" },
          { id: "metadata", type: "textarea", name: "metadata", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.metadata.label") }, rows: 3, width: "full" },
        ],
      },
    ],
  },
  googleDriveCredentials: {
    id: "settings-google-drive-credentials",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsGoogleDriveCredentials.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsGoogleDriveCredentials.submitLabel") },
    sections: [
      {
        id: "credentials",
        fields: [
          { id: "user", type: "number", name: "userId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.user.label") }, required: true, width: "full" },
          { id: "json", type: "textarea", name: "credentialsJson", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.json.label") }, required: true, rows: 6, width: "full" },
        ],
      },
    ],
  },
  whatsappCredentials: {
    id: "settings-whatsapp-credentials",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsWhatsappCredentials.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsWhatsappCredentials.submitLabel") },
    sections: [
      {
        id: "credentials",
        fields: [
          { id: "user", type: "number", name: "userId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.user.label") }, required: true, width: "full" },
          { id: "json", type: "textarea", name: "credentialsJson", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.json.label") }, required: true, rows: 6, width: "full" },
        ],
      },
    ],
  },
  createGoogleDriveConnection: {
    id: "settings-create-google-drive-connection",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsCreateGoogleDriveConnection.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsCreateGoogleDriveConnection.submitLabel") },
    sections: [
      {
        id: "connection",
        fields: [
          { id: "name", type: "text", name: "name", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.name.label") }, required: true, width: "1/2" },
          { id: "account-email", type: "email", name: "accountEmail", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.accountEmail.label") }, required: true, width: "1/2" },
          { id: "account-id", type: "text", name: "accountId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.accountId.label") }, required: true, width: "1/2" },
          { id: "credentials-ref", type: "text", name: "credentialsReference", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.credentialsRef.label") }, required: true, width: "1/2" },
          { id: "root-folder", type: "text", name: "rootFolderId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.rootFolder.label") }, width: "1/2" },
          { id: "shared-drive", type: "text", name: "sharedDriveId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.sharedDrive.label") }, width: "1/2" },
          { id: "sync-enabled", type: "switch", name: "syncEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.syncEnabled.label") }, defaultValue: true, width: "1/3" },
          { id: "webhook-enabled", type: "switch", name: "webhookEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookEnabled.label") }, width: "1/3" },
          { id: "sync-direction", type: "select", name: "syncDirection", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.syncDirection.label") }, defaultValue: "Bidirectional", options: syncDirectionOptions, width: "1/3" },
          { id: "webhook-url", type: "url", name: "webhookUrl", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookUrl.label") }, width: "1/2" },
          { id: "webhook-secret", type: "text", name: "webhookSecretReference", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookSecret.label") }, width: "1/2" },
          { id: "sync-frequency", type: "number", name: "syncFrequencyMinutes", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.syncFrequency.label") }, defaultValue: 60, width: "1/2" },
          { id: "max-file-size", type: "number", name: "maxFileSizeMb", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.maxFileSize.label") }, defaultValue: 50, width: "1/2" },
          { id: "file-types", type: "text", name: "allowedFileTypes", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.fileTypes.label") }, defaultValue: "pdf,docx,xlsx", width: "full" },
        ],
      },
    ],
  },
  updateGoogleDriveConnection: {
    id: "settings-update-google-drive-connection",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateGoogleDriveConnection.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateGoogleDriveConnection.submitLabel") },
    sections: [
      {
        id: "connection",
        fields: [
          { id: "connection-id", type: "number", name: "connectionId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.connectionId.label") }, required: true, width: "1/2" },
          { id: "name", type: "text", name: "name", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.name.label") }, width: "1/2" },
          { id: "root-folder", type: "text", name: "rootFolderId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.rootFolder.label") }, width: "1/2" },
          { id: "shared-drive", type: "text", name: "sharedDriveId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.sharedDrive.label") }, width: "1/2" },
          { id: "sync-enabled", type: "switch", name: "syncEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.syncEnabled.label") }, width: "1/3" },
          { id: "auto-sync", type: "switch", name: "autoSyncFiles", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.autoSync.label") }, width: "1/3" },
          { id: "webhook-enabled", type: "switch", name: "webhookEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookEnabled.label") }, width: "1/3" },
          { id: "webhook-url", type: "url", name: "webhookUrl", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookUrl.label") }, width: "1/2" },
          { id: "sync-direction", type: "select", name: "syncDirection", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.syncDirection.label") }, defaultValue: "Bidirectional", options: syncDirectionOptions, width: "1/2" },
          { id: "sync-frequency", type: "number", name: "syncFrequencyMinutes", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.syncFrequency.label") }, width: "1/2" },
          { id: "max-file-size", type: "number", name: "maxFileSizeMb", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.maxFileSize.label") }, width: "1/2" },
          { id: "file-types", type: "text", name: "allowedFileTypes", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.fileTypes.label") }, width: "full" },
        ],
      },
    ],
  },
  deleteIntegration: {
    id: "settings-delete-integration",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsDeleteIntegration.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsDeleteIntegration.submitLabel") },
    sections: [{ id: "integration", fields: [
      { id: "integration-id", type: "number", name: "integrationId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.integrationId.label") }, required: true, width: "1/2" },
      { id: "integration-type", type: "select", name: "integrationType", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.integrationType.label") }, defaultValue: "GoogleDrive", options: integrationTypeOptions, width: "1/2" },
    ] }],
  },
  createWhatsappBusinessAccount: {
    id: "settings-create-whatsapp-business-account",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsCreateWhatsappBusinessAccount.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsCreateWhatsappBusinessAccount.submitLabel") },
    sections: [
      {
        id: "account",
        fields: [
          { id: "name", type: "text", name: "name", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.name.label") }, required: true, width: "1/2" },
          { id: "phone", type: "text", name: "phoneNumber", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.phone.label") }, required: true, width: "1/2" },
          { id: "phone-id", type: "text", name: "phoneNumberId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.phoneId.label") }, required: true, width: "1/2" },
          { id: "business-id", type: "text", name: "businessAccountId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.businessId.label") }, required: true, width: "1/2" },
          { id: "display-name", type: "text", name: "displayName", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.displayName.label") }, required: true, width: "1/2" },
          { id: "language", type: "text", name: "defaultLanguage", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.language.label") }, defaultValue: "en", width: "1/2" },
          { id: "credentials-ref", type: "text", name: "credentialsReference", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.credentialsRef.label") }, required: true, width: "1/2" },
          { id: "webhook-secret", type: "text", name: "webhookSecretReference", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookSecret.label") }, required: true, width: "1/2" },
          { id: "messaging", type: "switch", name: "messagingEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.messaging.label") }, defaultValue: true, width: "1/4" },
          { id: "notifications", type: "switch", name: "notificationsEnabled", get label() { return uiI18n.t("settings.sections.notifications.title") }, defaultValue: true, width: "1/4" },
          { id: "templates", type: "switch", name: "templateMessagingEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.templates.label") }, defaultValue: true, width: "1/4" },
          { id: "interactive", type: "switch", name: "interactiveMessagingEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.interactive.label") }, defaultValue: true, width: "1/4" },
          { id: "primary", type: "switch", name: "isPrimary", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.primary.label") }, width: "1/3" },
          { id: "webhook-enabled", type: "switch", name: "webhookEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookEnabled.label") }, width: "1/3" },
          { id: "daily-limit", type: "number", name: "dailyMessageLimit", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.dailyLimit.label") }, defaultValue: 1000, width: "1/3" },
          { id: "webhook-url", type: "url", name: "webhookUrl", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookUrl.label") }, width: "1/2" },
          { id: "events", type: "text", name: "subscribedWebhookEvents", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.events.label") }, defaultValue: "messages,message_status,account_alerts", width: "1/2" },
          { id: "namespace", type: "text", name: "templateNamespace", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.namespace.label") }, width: "1/2" },
          { id: "media", type: "text", name: "mediaProvider", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.media.label") }, width: "1/2" },
          { id: "metadata", type: "textarea", name: "metadata", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.metadata.label") }, rows: 3, width: "full" },
        ],
      },
    ],
  },
  updateWhatsappBusinessAccount: {
    id: "settings-update-whatsapp-business-account",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateWhatsappBusinessAccount.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateWhatsappBusinessAccount.submitLabel") },
    sections: [{ id: "account", fields: [
      { id: "account-id", type: "number", name: "accountId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.accountId.label") }, required: true, width: "1/2" },
      { id: "name", type: "text", name: "name", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.name.label") }, width: "1/2" },
      { id: "display-name", type: "text", name: "displayName", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.displayName.label") }, width: "1/2" },
      { id: "language", type: "text", name: "defaultLanguage", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.language.label") }, width: "1/2" },
      { id: "messaging", type: "switch", name: "messagingEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.messaging.label") }, width: "1/4" },
      { id: "notifications", type: "switch", name: "notificationsEnabled", get label() { return uiI18n.t("settings.sections.notifications.title") }, width: "1/4" },
      { id: "templates", type: "switch", name: "templateMessagingEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.templates.label") }, width: "1/4" },
      { id: "interactive", type: "switch", name: "interactiveMessagingEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.interactive.label") }, width: "1/4" },
      { id: "webhook-enabled", type: "switch", name: "webhookEnabled", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookEnabled.label") }, width: "1/2" },
      { id: "daily-limit", type: "number", name: "dailyMessageLimit", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.dailyLimit.label") }, width: "1/2" },
      { id: "webhook-url", type: "url", name: "webhookUrl", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.webhookUrl.label") }, width: "1/2" },
      { id: "events", type: "text", name: "subscribedWebhookEvents", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.events.label") }, width: "1/2" },
      { id: "namespace", type: "text", name: "templateNamespace", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.namespace.label") }, width: "1/2" },
      { id: "media", type: "text", name: "mediaProvider", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.media.label") }, width: "1/2" },
    ] }],
  },
  deleteWhatsappBusinessAccount: {
    id: "settings-delete-whatsapp-business-account",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsDeleteWhatsappBusinessAccount.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsDeleteWhatsappBusinessAccount.submitLabel") },
    sections: [{ id: "account", fields: [{ id: "account-id", type: "number", name: "accountId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.accountId.label") }, required: true }] }],
  },
  setWhatsappPrimaryAccount: {
    id: "settings-set-whatsapp-primary-account",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsSetWhatsappPrimaryAccount.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsSetWhatsappPrimaryAccount.submitLabel") },
    sections: [{ id: "account", fields: [{ id: "account-id", type: "number", name: "accountId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.accountId.label") }, required: true }] }],
  },
  grantPermission: {
    id: "settings-grant-permission",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsGrantPermission.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsGrantPermission.submitLabel") },
    sections: [{ id: "permission", fields: [
      { id: "subject-type", type: "select", name: "subjectType", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.subjectType.label") }, defaultValue: "Role", options: [{ value: "Role", get label() { return uiI18n.t("settings.ai.role") } }, { value: "User", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.subjectType.labeluserIdentity") } }], width: "1/2" },
      { id: "subject-value", type: "text", name: "subjectValue", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.subjectValue.label") }, required: true, width: "1/2" },
      { id: "resource", type: "text", name: "resource", get label() { return uiI18n.t("settings.fieldPermissions.resource") }, required: true, width: "1/2" },
      { id: "action", type: "select", name: "action", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.action.labelaction") }, defaultValue: "Read", options: permissionActionOptions, width: "1/4" },
      { id: "effect", type: "select", name: "effect", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.effect.label") }, defaultValue: "Allow", options: [{ value: "Allow", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.effect.labelallow") } }, { value: "Deny", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.effect.labeldeny") } }], width: "1/4" },
    ] }],
  },
  revokePermission: {
    id: "settings-revoke-permission",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsRevokePermission.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsRevokePermission.submitLabel") },
    sections: [{ id: "permission", fields: [{ id: "permission-id", type: "number", name: "permissionId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.permissionId.label") }, required: true }] }],
  },
  archiveAiChatSession: {
    id: "settings-archive-ai-chat-session",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsArchiveAiChatSession.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsArchiveAiChatSession.submitLabel") },
    sections: [{ id: "session", fields: [
      { id: "company-id", type: "number", name: "companyId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.companyId.label") }, required: true, width: "1/2" },
      { id: "session-key", type: "text", name: "sessionKey", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.sessionKey.label") }, required: true, width: "1/2" },
      { id: "archived", type: "switch", name: "archived", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.archived.label") }, defaultValue: true, width: "1/2" },
    ] }],
  },
  updateOrgMemberRole: {
    id: "settings-update-org-member-role",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateOrgMemberRole.title") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsUpdateOrgMemberRole.submitLabel") },
    sections: [
      {
        id: "member",
        fields: [
          { id: "user-org-id", type: "number", name: "userOrgId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.userOrgId.label") }, required: true, width: "1/2" },
          { id: "role-name", type: "text", name: "roleName", get label() { return uiI18n.t("settings.adminOps.members.roleName") }, required: true, width: "1/2" },
        ],
      },
    ],
  },
  createUserInviteDirect: {
    id: "settings-create-user-invite-direct",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsCreateUserInviteDirect.title") },
    get description() { return uiI18n.t("settings.adminOps.credentials.inviteDirectDescription") },
    get submitLabel() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsCreateUserInviteDirect.submitLabel") },
    sections: [
      {
        id: "invite",
        fields: [
          { id: "email", type: "email", name: "email", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.email.label") }, required: true, width: "1/2" },
          { id: "role-id", type: "number", name: "roleId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.roleId.label") }, required: true, width: "1/2" },
          { id: "hash", type: "textarea", name: "tokenHash", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.hash.label") }, required: true, rows: 2, width: "full" },
          { id: "invited-by", type: "text", name: "invitedBy", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.invitedBy.label") }, required: true, width: "1/2" },
          { id: "expires", type: "datetime", name: "expiresAt", get label() { return uiI18n.t("settings.adminOps.sessions.expiresAt") }, required: true, width: "1/2" },
        ],
      },
    ],
  },
  createUserSession: {
    id: "settings-create-user-session-advanced",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsCreateUserSessionAdvanced.title") },
    get submitLabel() { return uiI18n.t("settings.adminOps.sessions.createSubmit") },
    sections: [
      {
        id: "session",
        fields: [
          { id: "token", type: "text", name: "sessionToken", get label() { return uiI18n.t("settings.adminOps.sessions.sessionToken") }, required: true, width: "full" },
          { id: "expires", type: "datetime", name: "expiresAt", get label() { return uiI18n.t("settings.adminOps.sessions.expiresAt") }, required: true, width: "1/2" },
          { id: "ip", type: "text", name: "ipAddress", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.ip.label") }, width: "1/2" },
        ],
      },
    ],
  },
  logAuditEvent: {
    id: "settings-log-audit-event-advanced",
    get title() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.settingsLogAuditEventAdvanced.title") },
    get submitLabel() { return uiI18n.t("settings.adminOps.audit.logEventSubmit") },
    sections: [
      {
        id: "event",
        fields: [
          { id: "table", type: "text", name: "tableName", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.table.label") }, required: true, width: "1/2" },
          { id: "record", type: "number", name: "recordId", get label() { return uiI18n.t("settings.adminOps.audit.recordId") }, required: true, width: "1/2" },
          { id: "action", type: "text", name: "action", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.action.labelaction") }, required: true, width: "1/2" },
          { id: "company", type: "number", name: "companyId", get label() { return uiI18n.t("settings.builtIn.settingsClient.settingsActionForms.company.label") }, width: "1/2" },
          { id: "old", type: "textarea", name: "oldValues", get label() { return uiI18n.t("settings.adminOps.audit.oldValues") }, rows: 2, width: "full" },
          { id: "new", type: "textarea", name: "newValues", get label() { return uiI18n.t("settings.adminOps.audit.newValues") }, rows: 2, width: "full" },
          { id: "fields", type: "text", name: "changedFields", get label() { return uiI18n.t("settings.adminOps.audit.changedFields") }, width: "full" },
        ],
      },
    ],
  },
}

function compactParams(formData: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const key of keys) {
    const value = formData[key]
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params[key] = value
    }
  }
  return params
}

function parseCredentials(value: unknown): Record<string, unknown> {
  const raw = String(value ?? "").trim()
  if (!raw) throw new Error("Credentials JSON is required")
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Credentials must be a JSON object")
  }
  return parsed as Record<string, unknown>
}

function toBigIntId(value: unknown, label: string): bigint {
  const raw = String(value ?? "").trim()
  if (!raw) throw new Error(`${label} is required`)
  return BigInt(raw)
}

function optionalText(value: unknown): string | null {
  const raw = String(value ?? "").trim()
  return raw ? raw : null
}

function csvList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function optionalTimestamp(value: unknown): { microsSinceUnixEpoch: bigint } | null {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  const millis = Date.parse(raw)
  if (!Number.isFinite(millis)) throw new Error("Timestamp must be a valid date/time")
  return { microsSinceUnixEpoch: BigInt(millis) * 1000n }
}

export function SettingsClient({
  organizationId,
  firstOrgProfile = false,
  financeSetup = false,
}: {
  organizationId?: number
  firstOrgProfile?: boolean
  financeSetup?: boolean
}) {
  const { t } = useTranslation()
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  if (firstOrgProfile && financeSetup) {
    return (
      <FinanceAlphaSetup
        organizationId={organizationId}
        title={t("settings.page.title")}
        description={t("settings.page.description")}
      />
    )
  }
  if (firstOrgProfile) {
    return (
      <div className="space-y-6">
        <DashboardHeader title={t("settings.page.title")} description={t("settings.page.description")} />
        <SettingsModule firstOrgProfile />
      </div>
    )
  }
  return <SettingsLoaded organizationId={organizationId} title={t("settings.page.title")} description={t("settings.page.description")} />
}

function FinanceAlphaSetup({
  organizationId,
  title,
  description,
}: {
  organizationId: number
  title: string
  description: string
}) {
  const { i18n: setupI18n } = useRootTranslation()
  const [formOpen, setFormOpen] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { data: currencyRows = [] } = useCurrencies()
  const companiesQuery = useCompanies(organizationId, true)
  const createCompany = useCreateCompany(organizationId)
  const form = useMemo(
    () =>
      withLinkedPickers(settingsActionForms.createCompany, {
        currencyId: currencyOptionsFromRows(currencyRows),
      }),
    [currencyRows, setupI18n.language],
  )

  return (
    <div className="space-y-6">
      <DashboardHeader title={title} description={description} />
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold">{rootI18n.t("settings.ui.settingsClient.completeFinanceSetup")}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          {rootI18n.t("settings.ui.settingsClient.createAnOperatingCompanyAndChooseItsBase")}</p>
        <button
          type="button"
          className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
          onClick={() => setFormOpen(true)}
        >
          {rootI18n.t("settings.ui.settingsClient.createOperatingCompany")}</button>
      </section>
      <SettingsModule firstOrgProfile />
      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        config={form}
        isPending={createCompany.isPending}
        closeOnSubmit={false}
        submitError={submitError}
        onSubmit={async (formData) => {
          setSubmitError(null)
          try {
            const currentCompanies = await companiesQuery.refetch()
            const existingIds = new Set(
              (currentCompanies.data ?? []).map((company) => String(company.id)),
            )
            const params = toCreateCompanyParams(formData)
            if (!params) throw new Error(i18n.t("common.paramsMapper.invalidCompany"))
            await createCompany.mutateAsync(params)
            const refreshed = await companiesQuery.refetch()
            const createdCompany = refreshed.data?.find(
              (company) => !existingIds.has(String(company.id)),
            )
            const createdCompanyId = Number(createdCompany?.id)
            window.location.assign(
              Number.isSafeInteger(createdCompanyId) && createdCompanyId > 0
                ? `/accounting?companyId=${createdCompanyId}`
                : "/accounting",
            )
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : String(error))
          }
        }}
      />
    </div>
  )
}

function SettingsLoaded({
  organizationId,
  title,
  description,
}: {
  organizationId: number
  title: string
  description: string
}) {
  useRootTranslation()
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog()
  useSettingsModuleSubscription()
  const { orgId } = orgBigInts(organizationId)
  const hostedAuth = useWorkOsAuthMode()
  const workspaceProfile = useWorkspaceProfile()
  const [activeAction, setActiveAction] = useState<SettingsAction | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const { data: companyRows = [] } = useCompanies(organizationId, true)
  const linkedOptions = useMemo(() => {
    const companyOptions = recordOptions(companyRows as unknown as Record<string, unknown>[], (row) => row.name)
    return {
      companyId: companyOptions,
    }
  },
    [companyRows],
  )

  const createAuditRule = useCreateAuditRule(orgId)
  const updateAuditRule = useUpdateAuditRule(orgId)
  const endSession = useEndUserSession(orgId)
  const updateEmail = useUpdateUserEmail(orgId)
  const recordPrivacyConsent = useRecordPrivacyConsent(orgId)
  const updateGoogleDriveCredentials = useUpdateGoogleDriveCredentials(orgId)
  const updateWhatsappCredentials = useUpdateWhatsappCredentials(orgId)
  const updateOrgMemberRole = useUpdateOrgMemberRole(orgId)
  const createUserInviteDirect = useCreateUserInviteReducer(orgId)
  const createUserSession = useCreateUserSession(orgId)
  const logAuditEvent = useLogAuditEvent(orgId)

  const isPending =
    createAuditRule.isPending ||
    updateAuditRule.isPending ||
    endSession.isPending ||
    updateEmail.isPending ||
    recordPrivacyConsent.isPending ||
    updateGoogleDriveCredentials.isPending ||
    updateWhatsappCredentials.isPending ||
    updateOrgMemberRole.isPending ||
    createUserInviteDirect.isPending ||
    createUserSession.isPending ||
    logAuditEvent.isPending

  const handleSubmit = async (formData: Record<string, unknown>) => {
    if (!activeAction) return
    setSubmitError(null)
    setSuccessMessage(null)
    try {
      const submittedAction = activeAction
      if (activeAction === "createAuditRule") {
        await createAuditRule.mutateAsync(formData)
      } else if (activeAction === "updateAuditRule") {
        await updateAuditRule.mutateAsync({
          ruleId: formData.ruleId as string | number,
          params: compactParams(formData, ["name", "resourceType", "actionType", "severity", "isActive"]),
        })
      } else if (activeAction === "endSession") {
        await endSession.mutateAsync(formData.sessionId as string | number)

      } else if (activeAction === "updateEmail") {
        await updateEmail.mutateAsync({
          email: String(formData.email ?? ""),
          emailVerified: Boolean(formData.emailVerified),
        })
      } else if (activeAction === "recordPrivacyConsent") {
        await recordPrivacyConsent.mutateAsync({
          contactId: formData.contactId as string | number,
          consentType: String(formData.consentType ?? ""),
          granted: Boolean(formData.granted),
          ipAddress: formData.ipAddress ? String(formData.ipAddress) : null,
          userAgent: formData.userAgent ? String(formData.userAgent) : null,
          metadata: formData.metadata ? String(formData.metadata) : null,
        })
      } else if (activeAction === "googleDriveCredentials") {
        await updateGoogleDriveCredentials.mutateAsync({
          userId: formData.userId as string | number,
          credentials: parseCredentials(formData.credentialsJson),
        })
      } else if (activeAction === "whatsappCredentials") {
        await updateWhatsappCredentials.mutateAsync({
          userId: formData.userId as string | number,
          credentials: parseCredentials(formData.credentialsJson),
        })
      } else if (activeAction === "createGoogleDriveConnection") {
        await createGoogleDriveConnection(orgId, {
          name: String(formData.name ?? ""),
          accountEmail: String(formData.accountEmail ?? ""),
          accountId: String(formData.accountId ?? ""),
          credentialsReference: String(formData.credentialsReference ?? ""),
          rootFolderId: optionalText(formData.rootFolderId),
          sharedDriveId: optionalText(formData.sharedDriveId),
          syncEnabled: Boolean(formData.syncEnabled),
          webhookEnabled: Boolean(formData.webhookEnabled),
          webhookUrl: optionalText(formData.webhookUrl),
          webhookSecretReference: optionalText(formData.webhookSecretReference),
          syncDirection: String(formData.syncDirection ?? "Bidirectional") as "UploadOnly" | "DownloadOnly" | "Bidirectional",
          syncFrequencyMinutes: Number(formData.syncFrequencyMinutes ?? 60),
          allowedFileTypes: csvList(formData.allowedFileTypes),
          maxFileSizeMb: Number(formData.maxFileSizeMb ?? 50),
        })
      } else if (activeAction === "updateGoogleDriveConnection") {
        await updateGoogleDriveConnection(orgId, toBigIntId(formData.connectionId, "Connection ID"), {
          name: optionalText(formData.name) ?? undefined,
          rootFolderId: optionalText(formData.rootFolderId),
          sharedDriveId: optionalText(formData.sharedDriveId),
          syncEnabled: formData.syncEnabled === undefined ? undefined : Boolean(formData.syncEnabled),
          autoSyncFiles: formData.autoSyncFiles === undefined ? undefined : Boolean(formData.autoSyncFiles),
          allowedFileTypes: csvList(formData.allowedFileTypes).length ? csvList(formData.allowedFileTypes) : undefined,
          maxFileSizeMb: formData.maxFileSizeMb === undefined || formData.maxFileSizeMb === "" ? undefined : Number(formData.maxFileSizeMb),
          webhookEnabled: formData.webhookEnabled === undefined ? undefined : Boolean(formData.webhookEnabled),
          webhookUrl: optionalText(formData.webhookUrl),
          syncDirection: formData.syncDirection ? (String(formData.syncDirection) as "UploadOnly" | "DownloadOnly" | "Bidirectional") : undefined,
          syncFrequencyMinutes:
            formData.syncFrequencyMinutes === undefined || formData.syncFrequencyMinutes === "" ? undefined : Number(formData.syncFrequencyMinutes),
        })
      } else if (activeAction === "deleteIntegration") {
        if (!(await confirmDialog({ get description() { return uiI18n.t("settings.builtIn.settingsClient.handleSubmit.deleteThisIntegration.description") } }))) return
        await deleteIntegration(
          orgId,
          toBigIntId(formData.integrationId, "Integration ID"),
          String(formData.integrationType ?? "GoogleDrive") as "GoogleDrive" | "WhatsAppBusiness",
        )
      } else if (activeAction === "createWhatsappBusinessAccount") {
        const params = toCreateWhatsAppBusinessAccountParams(formData)
        if (!params) throw new Error(i18n.t("common.paramsMapper.invalidWhatsappAccount"))
        await createWhatsAppBusinessAccount(orgId, params)
      } else if (activeAction === "updateWhatsappBusinessAccount") {
        const events = csvList(formData.subscribedWebhookEvents)
        await updateWhatsAppBusinessAccount(orgId, toBigIntId(formData.accountId, "Account ID"), {
          name: optionalText(formData.name) ?? undefined,
          displayName: optionalText(formData.displayName) ?? undefined,
          messagingEnabled: formData.messagingEnabled === undefined ? undefined : Boolean(formData.messagingEnabled),
          notificationsEnabled: formData.notificationsEnabled === undefined ? undefined : Boolean(formData.notificationsEnabled),
          templateMessagingEnabled: formData.templateMessagingEnabled === undefined ? undefined : Boolean(formData.templateMessagingEnabled),
          interactiveMessagingEnabled: formData.interactiveMessagingEnabled === undefined ? undefined : Boolean(formData.interactiveMessagingEnabled),
          defaultLanguage: optionalText(formData.defaultLanguage) ?? undefined,
          webhookEnabled: formData.webhookEnabled === undefined ? undefined : Boolean(formData.webhookEnabled),
          webhookUrl: optionalText(formData.webhookUrl),
          subscribedWebhookEvents: events.length ? events : undefined,
          dailyMessageLimit:
            formData.dailyMessageLimit === undefined || formData.dailyMessageLimit === "" ? undefined : Number(formData.dailyMessageLimit),
          templateNamespace: optionalText(formData.templateNamespace),
          mediaProvider: optionalText(formData.mediaProvider),
        })
      } else if (activeAction === "deleteWhatsappBusinessAccount") {
        if (!(await confirmDialog({ get description() { return uiI18n.t("settings.builtIn.settingsClient.handleSubmit.deleteThisWhatsAppBusinessAccount.description") } }))) return
        await deleteWhatsAppBusinessAccount(orgId, toBigIntId(formData.accountId, "Account ID"))
      } else if (activeAction === "setWhatsappPrimaryAccount") {
        await setWhatsAppPrimaryAccount(orgId, toBigIntId(formData.accountId, "Account ID"))
      } else if (activeAction === "grantPermission") {
        const subjectType = String(formData.subjectType ?? "Role") as "Role" | "User"
        await grantPermission(orgId, {
          subjectType,
          subjectValue: subjectType === "Role" ? toBigIntId(formData.subjectValue, "Role ID") : String(formData.subjectValue ?? ""),
          resource: String(formData.resource ?? ""),
          action: String(formData.action ?? "Read") as "Read" | "Write" | "Create" | "Delete" | "All",
          effect: String(formData.effect ?? "Allow") as "Allow" | "Deny",
        })
      } else if (activeAction === "revokePermission") {
        if (!(await confirmDialog({ get description() { return uiI18n.t("settings.builtIn.settingsClient.handleSubmit.revokeThisPermission.description") } }))) return
        await revokePermission(orgId, toBigIntId(formData.permissionId, "Permission ID"))
      } else if (activeAction === "archiveAiChatSession") {
        await archiveAiChatSession(
          orgId,
          toBigIntId(formData.companyId, "Company ID"),
          String(formData.sessionKey ?? ""),
          Boolean(formData.archived),
        )








      } else if (activeAction === "updateOrgMemberRole") {
        await updateOrgMemberRole.mutateAsync({
          userOrgId: formData.userOrgId as string | number,
          roleName: String(formData.roleName ?? ""),
        })
      } else if (activeAction === "createUserInviteDirect") {
        await createUserInviteDirect.mutateAsync({
          email: String(formData.email ?? ""),
          roleId: formData.roleId as string | number,
          tokenHash: String(formData.tokenHash ?? ""),
          invitedBy: String(formData.invitedBy ?? ""),
          expiresAt: formData.expiresAt,
        })
      } else if (activeAction === "createUserSession") {
        const expiresTs = optionalTimestamp(formData.expiresAt)
        if (!expiresTs) throw new Error("Expires at is required")
        await createUserSession.mutateAsync({
          sessionToken: String(formData.sessionToken ?? ""),
          ipAddress: optionalText(formData.ipAddress),
          userAgent: null,
          deviceInfo: null,
          expiresAtMicros: expiresTs.microsSinceUnixEpoch,
          metadata: null,
        })
      } else if (activeAction === "logAuditEvent") {
        const companyRaw = formData.companyId
        const companyId =
          companyRaw != null && String(companyRaw).trim() !== ""
            ? (typeof companyRaw === "object" ? null : companyRaw)
            : null
        await logAuditEvent.mutateAsync({
          companyId: companyId as string | number | bigint | null,
          tableName: String(formData.tableName ?? ""),
          recordId: formData.recordId as string | number,
          action: String(formData.action ?? ""),
          oldValues: optionalText(formData.oldValues),
          newValues: optionalText(formData.newValues),
          changedFields: csvList(formData.changedFields),
          sessionId: null,
          ipAddress: null,
          userAgent: null,
          metadata: null,
        })
      }
      const completed = actions.find((action) => action.id === submittedAction)
      setSuccessMessage(`${completed?.title ?? "Settings action"} completed.`)
      setActiveAction(null)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    }
  }

  const actions: Array<{ id: SettingsAction; title: string; description: string }> = [
    { id: "createAuditRule", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.createAuditRule.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.createAuditRule.description") } },
    { id: "updateAuditRule", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateAuditRule.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateAuditRule.description") } },
    { id: "endSession", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.endSession.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.endSession.description") } },
    { id: "updateEmail", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateEmail.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateEmail.description") } },
    { id: "recordPrivacyConsent", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.recordPrivacyConsent.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.recordPrivacyConsent.description") } },
    { id: "googleDriveCredentials", title: "Google Drive", get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.googleDriveCredentials.description") } },
    { id: "whatsappCredentials", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.whatsappCredentials.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.whatsappCredentials.description") } },
    { id: "createGoogleDriveConnection", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.createGoogleDriveConnection.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.createGoogleDriveConnection.description") } },
    { id: "updateGoogleDriveConnection", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateGoogleDriveConnection.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateGoogleDriveConnection.description") } },
    { id: "deleteIntegration", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.deleteIntegration.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.deleteIntegration.description") } },
    { id: "createWhatsappBusinessAccount", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.createWhatsappBusinessAccount.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.createWhatsappBusinessAccount.description") } },
    { id: "updateWhatsappBusinessAccount", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateWhatsappBusinessAccount.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateWhatsappBusinessAccount.description") } },
    { id: "deleteWhatsappBusinessAccount", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.deleteWhatsappBusinessAccount.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.deleteWhatsappBusinessAccount.description") } },
    { id: "setWhatsappPrimaryAccount", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.setWhatsappPrimaryAccount.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.setWhatsappPrimaryAccount.description") } },
    { id: "grantPermission", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.grantPermission.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.grantPermission.description") } },
    { id: "revokePermission", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.revokePermission.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.revokePermission.description") } },
    { id: "archiveAiChatSession", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.archiveAiChatSession.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.archiveAiChatSession.description") } },
    { id: "updateOrgMemberRole", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateOrgMemberRole.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.updateOrgMemberRole.description") } },
    { id: "createUserInviteDirect", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.createUserInviteDirect.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.createUserInviteDirect.description") } },
    { id: "createUserSession", get title() { return uiI18n.t("settings.adminOps.sessions.createSubmit") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.createUserSession.description") } },
    { id: "logAuditEvent", get title() { return uiI18n.t("settings.builtIn.settingsClient.actions.logAuditEvent.title") }, get description() { return uiI18n.t("settings.builtIn.settingsClient.actions.logAuditEvent.description") } },
  ]

  const visibleActions = actions.filter((action) => action.id !== "archiveAiChatSession" || isWorkspaceSurfaceVisible(workspaceProfile, "ai-skills"))
  const integrationActions = visibleActions.filter((action) =>
    INTEGRATION_SETTINGS_ACTIONS.includes(action.id),
  )
  const adminActions = visibleActions.filter(
    (action) => !INTEGRATION_SETTINGS_ACTIONS.includes(action.id) && !(hostedAuth && action.id === "updateEmail"),
  )

  const openAction = (id: SettingsAction) => {
    setSubmitError(null)
    setSuccessMessage(null)
    setActiveAction(id)
  }

  const actionCards = (list: typeof actions, testIdPrefix?: string) => (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {list.map((action) => (
        <button
          key={action.id}
          type="button"
          className="rounded-lg border border-border bg-background p-3 text-left shadow-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
          data-testid={testIdPrefix ? `${testIdPrefix}${action.id}` : undefined}
          onClick={() => openAction(action.id)}
        >
          <p className="text-sm font-medium">{action.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.description}</p>
        </button>
      ))}
    </div>
  )

  const extraSections: SettingsExtraSection[] = [
    {
      id: "imports",
      groupId: "data",
      get title() { return uiI18n.t("settings.builtIn.settingsClient.extraSections.imports.title") },
      get description() { return uiI18n.t("settings.builtIn.settingsClient.extraSections.imports.description") },
      icon: Upload,
      content: (
        <section className="rounded-xl border border-border bg-card p-4">
          <GuidedImportWizard organizationId={organizationId} />
        </section>
      ),
    },
    {
      id: "integrations",
      groupId: "data",
      get title() { return uiI18n.t("settings.organization.integrations.title") },
      get description() { return uiI18n.t("settings.builtIn.settingsClient.extraSections.integrations.description") },
      icon: Plug,
      content: (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {rootI18n.t("settings.ui.settingsClient.oAuthFlowsAndWebhooksAreRecordedViaThese")}</p>
          {actionCards(integrationActions)}
        </section>
      ),
    },
    {
      id: "advanced",
      groupId: "platform",
      get title() { return uiI18n.t("settings.builtIn.settingsClient.extraSections.advanced.title") },
      get description() { return uiI18n.t("settings.builtIn.settingsClient.extraSections.advanced.description") },
      icon: Wrench,
      content: (
        <section className="rounded-xl border border-dashed border-border bg-card p-4">
          {actionCards(adminActions, "settings-admin-action-")}
        </section>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <DashboardHeader title={title} description={description} />
      {successMessage ? (
        <div role="status" className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
          {successMessage}
        </div>
      ) : null}
      <SettingsModule extraSections={extraSections} uploadInvoiceLogo={uploadInvoiceLogo} />

      {activeAction ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setActiveAction(null)
              setSubmitError(null)
            }
          }}
          config={withLinkedPickers(settingsActionForms[activeAction], linkedOptions)}
          // Connector forms carry account ids and credential references; keep them out of browser storage.
          draft={false}
          isPending={isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleSubmit}
        />
      ) : null}
      {confirmDialogNode}
    </div>
  )
}

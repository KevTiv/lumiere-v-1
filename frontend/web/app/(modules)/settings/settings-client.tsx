"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { DashboardHeader, FormModal, MissingOrganization, SettingsModule, type FormConfig } from "@lumiere/ui"
import {
  archiveAiChatSession,
  createGoogleDriveConnection,
  createWhatsAppBusinessAccount,
  deleteIntegration,
  deleteWhatsAppBusinessAccount,
  grantPermission,
  recordGoogleDriveSync,
  recordGoogleDriveSyncError,
  recordWhatsAppHealthCheck,
  recordWhatsAppMessageSent,
  revokePermission,
  setWhatsAppPrimaryAccount,
  updateGoogleDriveConnection,
  updateIntegrationStatus,
  updateWhatsAppBusinessAccount,
  updateWhatsAppVerificationStatus,
} from "@lumiere/stdb/client-ui-bridge"
import {
  useCreateAuditRule,
  useCreatePasswordResetToken,
  useCreateUserInviteReducer,
  useCreateUserSession,
  useEndUserSession,
  useLogAuditEvent,
  useRecordPrivacyConsent,
  useStoreSsoUserCredential,
  useStoreUserCredential,
  useUpdateAuditRule,
  useUpdateGoogleDriveCredentials,
  useUpdateOrgMemberRole,
  useUpdateUserEmail,
  useUpdateUserPassword,
  useUpdateUserProfile,
  useUpdateWhatsappCredentials,
} from "@lumiere/query-hooks/hooks/auth"
import {
  useCreateCompany,
  useCreateDataClassification,
  useCreateDataClassificationRule,
  useDeleteCompany,
  useUpdateCompany,
  useUpdateCompanyAddress,
  useUpdateCompanyBusiness,
  useUpdateCompanyHierarchy,
} from "@lumiere/query-hooks/hooks/organization-company"
import { hasValidOrganizationId, orgBigInts } from "@/lib/org-scoped"

type SettingsAction =
  | "createAuditRule"
  | "updateAuditRule"
  | "endSession"
  | "updateProfile"
  | "updatePassword"
  | "updateEmail"
  | "recordPrivacyConsent"
  | "googleDriveCredentials"
  | "whatsappCredentials"
  | "createGoogleDriveConnection"
  | "updateGoogleDriveConnection"
  | "recordGoogleDriveSync"
  | "recordGoogleDriveSyncError"
  | "updateIntegrationStatus"
  | "deleteIntegration"
  | "createWhatsappBusinessAccount"
  | "updateWhatsappBusinessAccount"
  | "deleteWhatsappBusinessAccount"
  | "setWhatsappPrimaryAccount"
  | "updateWhatsappVerificationStatus"
  | "recordWhatsappHealthCheck"
  | "recordWhatsappMessageSent"
  | "grantPermission"
  | "revokePermission"
  | "archiveAiChatSession"
  | "createCompany"
  | "updateCompany"
  | "updateCompanyAddress"
  | "updateCompanyBusiness"
  | "updateCompanyHierarchy"
  | "deleteCompany"
  | "createDataClassification"
  | "createDataClassificationRule"
  | "updateOrgMemberRole"
  | "createPasswordResetToken"
  | "createUserInviteDirect"
  | "storeUserCredential"
  | "storeSsoUserCredential"
  | "createUserSession"
  | "logAuditEvent"

const syncDirectionOptions = [
  { value: "UploadOnly", label: "Upload only" },
  { value: "DownloadOnly", label: "Download only" },
  { value: "Bidirectional", label: "Bidirectional" },
]

const integrationTypeOptions = [
  { value: "GoogleDrive", label: "Google Drive" },
  { value: "WhatsAppBusiness", label: "WhatsApp Business" },
]

const integrationStatusOptions = [
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
  { value: "Pending", label: "Pending" },
  { value: "Suspended", label: "Suspended" },
]

const syncStatusOptions = [
  { value: "Connected", label: "Connected" },
  { value: "Disconnected", label: "Disconnected" },
  { value: "Syncing", label: "Syncing" },
  { value: "Error", label: "Error" },
  { value: "PendingAuth", label: "Pending auth" },
]

const verificationStatusOptions = [
  { value: "Pending", label: "Pending" },
  { value: "Approved", label: "Approved" },
  { value: "Rejected", label: "Rejected" },
  { value: "Expired", label: "Expired" },
  { value: "Revoked", label: "Revoked" },
]

const verificationLevelOptions = [
  { value: "Unverified", label: "Unverified" },
  { value: "BusinessPortfolio", label: "Business portfolio" },
  { value: "BusinessVerified", label: "Business verified" },
]

const permissionActionOptions = [
  { value: "Read", label: "Read" },
  { value: "Write", label: "Write" },
  { value: "Create", label: "Create" },
  { value: "Delete", label: "Delete" },
  { value: "All", label: "All" },
]

const settingsActionForms: Record<SettingsAction, FormConfig> = {
  createAuditRule: {
    id: "settings-create-audit-rule",
    title: "Create Audit Rule",
    submitLabel: "Create rule",
    sections: [
      {
        id: "rule",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", required: true, width: "full" },
          { id: "resource", type: "text", name: "resourceType", label: "Resource type", required: true, width: "1/2" },
          { id: "action", type: "text", name: "actionType", label: "Action type", required: true, width: "1/2" },
          { id: "severity", type: "text", name: "severity", label: "Severity", defaultValue: "info", width: "1/2" },
          { id: "active", type: "switch", name: "isActive", label: "Active", defaultValue: true, width: "1/2" },
        ],
      },
    ],
  },
  updateAuditRule: {
    id: "settings-update-audit-rule",
    title: "Update Audit Rule",
    submitLabel: "Update rule",
    sections: [
      {
        id: "rule",
        fields: [
          { id: "rule-id", type: "number", name: "ruleId", label: "Rule ID", required: true, width: "1/2" },
          { id: "name", type: "text", name: "name", label: "Name", width: "1/2" },
          { id: "resource", type: "text", name: "resourceType", label: "Resource type", width: "1/2" },
          { id: "action", type: "text", name: "actionType", label: "Action type", width: "1/2" },
          { id: "severity", type: "text", name: "severity", label: "Severity", width: "1/2" },
          { id: "active", type: "switch", name: "isActive", label: "Active", width: "1/2" },
        ],
      },
    ],
  },
  endSession: {
    id: "settings-end-session",
    title: "End User Session",
    submitLabel: "End session",
    sections: [{ id: "session", fields: [{ id: "session-id", type: "number", name: "sessionId", label: "Session ID", required: true }] }],
  },
  updateProfile: {
    id: "settings-update-profile",
    title: "Update Profile",
    submitLabel: "Update profile",
    sections: [
      {
        id: "profile",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", width: "1/2" },
          { id: "department", type: "text", name: "department", label: "Department", width: "1/2" },
          { id: "timezone", type: "text", name: "timezone", label: "Timezone", width: "1/2" },
          { id: "locale", type: "text", name: "locale", label: "Locale", width: "1/2" },
        ],
      },
    ],
  },
  updatePassword: {
    id: "settings-update-password",
    title: "Update User Password",
    description: "Admin flow expects a target identity and a server-produced password hash.",
    submitLabel: "Update password",
    sections: [
      {
        id: "password",
        fields: [
          { id: "identity", type: "text", name: "targetIdentity", label: "Target identity", required: true, width: "full" },
          { id: "hash", type: "textarea", name: "newPasswordHash", label: "New password hash", required: true, rows: 3, width: "full" },
        ],
      },
    ],
  },
  updateEmail: {
    id: "settings-update-email",
    title: "Update Email",
    submitLabel: "Update email",
    sections: [
      {
        id: "email",
        fields: [
          { id: "email", type: "text", name: "email", label: "Email", required: true, width: "1/2" },
          { id: "verified", type: "switch", name: "emailVerified", label: "Email verified", width: "1/2" },
        ],
      },
    ],
  },
  recordPrivacyConsent: {
    id: "settings-record-privacy-consent",
    title: "Record Privacy Consent",
    submitLabel: "Record consent",
    sections: [
      {
        id: "privacy",
        fields: [
          { id: "contact", type: "number", name: "contactId", label: "Contact ID", required: true, width: "1/2" },
          { id: "type", type: "text", name: "consentType", label: "Consent type", required: true, width: "1/2" },
          { id: "granted", type: "switch", name: "granted", label: "Granted", defaultValue: true, width: "1/2" },
          { id: "ip", type: "text", name: "ipAddress", label: "IP address", width: "1/2" },
          { id: "agent", type: "text", name: "userAgent", label: "User agent", width: "full" },
          { id: "metadata", type: "textarea", name: "metadata", label: "Metadata JSON/string", rows: 3, width: "full" },
        ],
      },
    ],
  },
  googleDriveCredentials: {
    id: "settings-google-drive-credentials",
    title: "Update Google Drive Credentials",
    submitLabel: "Save credentials",
    sections: [
      {
        id: "credentials",
        fields: [
          { id: "user", type: "number", name: "userId", label: "User ID", required: true, width: "full" },
          { id: "json", type: "textarea", name: "credentialsJson", label: "Credentials JSON", required: true, rows: 6, width: "full" },
        ],
      },
    ],
  },
  whatsappCredentials: {
    id: "settings-whatsapp-credentials",
    title: "Update WhatsApp Credentials",
    submitLabel: "Save credentials",
    sections: [
      {
        id: "credentials",
        fields: [
          { id: "user", type: "number", name: "userId", label: "User ID", required: true, width: "full" },
          { id: "json", type: "textarea", name: "credentialsJson", label: "Credentials JSON", required: true, rows: 6, width: "full" },
        ],
      },
    ],
  },
  createGoogleDriveConnection: {
    id: "settings-create-google-drive-connection",
    title: "Create Google Drive Connection",
    submitLabel: "Create connection",
    sections: [
      {
        id: "connection",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", required: true, width: "1/2" },
          { id: "account-email", type: "text", name: "accountEmail", label: "Account email", required: true, width: "1/2" },
          { id: "account-id", type: "text", name: "accountId", label: "Account ID", required: true, width: "1/2" },
          { id: "credentials-ref", type: "text", name: "credentialsReference", label: "Credentials reference", required: true, width: "1/2" },
          { id: "root-folder", type: "text", name: "rootFolderId", label: "Root folder ID", width: "1/2" },
          { id: "shared-drive", type: "text", name: "sharedDriveId", label: "Shared drive ID", width: "1/2" },
          { id: "sync-enabled", type: "switch", name: "syncEnabled", label: "Sync enabled", defaultValue: true, width: "1/3" },
          { id: "webhook-enabled", type: "switch", name: "webhookEnabled", label: "Webhook enabled", width: "1/3" },
          { id: "sync-direction", type: "select", name: "syncDirection", label: "Sync direction", defaultValue: "Bidirectional", options: syncDirectionOptions, width: "1/3" },
          { id: "webhook-url", type: "text", name: "webhookUrl", label: "Webhook URL", width: "1/2" },
          { id: "webhook-secret", type: "text", name: "webhookSecretReference", label: "Webhook secret reference", width: "1/2" },
          { id: "sync-frequency", type: "number", name: "syncFrequencyMinutes", label: "Sync frequency minutes", defaultValue: 60, width: "1/2" },
          { id: "max-file-size", type: "number", name: "maxFileSizeMb", label: "Max file size MB", defaultValue: 50, width: "1/2" },
          { id: "file-types", type: "text", name: "allowedFileTypes", label: "Allowed file types (CSV)", defaultValue: "pdf,docx,xlsx", width: "full" },
        ],
      },
    ],
  },
  updateGoogleDriveConnection: {
    id: "settings-update-google-drive-connection",
    title: "Update Google Drive Connection",
    submitLabel: "Update connection",
    sections: [
      {
        id: "connection",
        fields: [
          { id: "connection-id", type: "number", name: "connectionId", label: "Connection ID", required: true, width: "1/2" },
          { id: "name", type: "text", name: "name", label: "Name", width: "1/2" },
          { id: "root-folder", type: "text", name: "rootFolderId", label: "Root folder ID", width: "1/2" },
          { id: "shared-drive", type: "text", name: "sharedDriveId", label: "Shared drive ID", width: "1/2" },
          { id: "sync-enabled", type: "switch", name: "syncEnabled", label: "Sync enabled", width: "1/3" },
          { id: "auto-sync", type: "switch", name: "autoSyncFiles", label: "Auto sync files", width: "1/3" },
          { id: "webhook-enabled", type: "switch", name: "webhookEnabled", label: "Webhook enabled", width: "1/3" },
          { id: "webhook-url", type: "text", name: "webhookUrl", label: "Webhook URL", width: "1/2" },
          { id: "sync-direction", type: "select", name: "syncDirection", label: "Sync direction", defaultValue: "Bidirectional", options: syncDirectionOptions, width: "1/2" },
          { id: "sync-frequency", type: "number", name: "syncFrequencyMinutes", label: "Sync frequency minutes", width: "1/2" },
          { id: "max-file-size", type: "number", name: "maxFileSizeMb", label: "Max file size MB", width: "1/2" },
          { id: "file-types", type: "text", name: "allowedFileTypes", label: "Allowed file types (CSV)", width: "full" },
        ],
      },
    ],
  },
  recordGoogleDriveSync: {
    id: "settings-record-google-drive-sync",
    title: "Record Google Drive Sync",
    submitLabel: "Record sync",
    sections: [{ id: "sync", fields: [
      { id: "connection-id", type: "number", name: "connectionId", label: "Connection ID", required: true, width: "1/2" },
      { id: "next-sync", type: "datetime", name: "nextSyncAt", label: "Next sync at", width: "1/2" },
    ] }],
  },
  recordGoogleDriveSyncError: {
    id: "settings-record-google-drive-sync-error",
    title: "Record Google Drive Sync Error",
    submitLabel: "Record error",
    sections: [{ id: "sync-error", fields: [
      { id: "connection-id", type: "number", name: "connectionId", label: "Connection ID", required: true, width: "1/2" },
      { id: "error", type: "textarea", name: "errorMessage", label: "Error message", required: true, rows: 3, width: "full" },
    ] }],
  },
  updateIntegrationStatus: {
    id: "settings-update-integration-status",
    title: "Update Integration Status",
    submitLabel: "Update status",
    sections: [{ id: "status", fields: [
      { id: "integration-id", type: "number", name: "integrationId", label: "Integration ID", required: true, width: "1/2" },
      { id: "integration-type", type: "select", name: "integrationType", label: "Integration type", defaultValue: "GoogleDrive", options: integrationTypeOptions, width: "1/2" },
      { id: "status", type: "select", name: "status", label: "Status", defaultValue: "Active", options: integrationStatusOptions, width: "1/2" },
      { id: "sync-status", type: "select", name: "syncStatus", label: "Sync status", defaultValue: "Connected", options: syncStatusOptions, width: "1/2" },
      { id: "error", type: "textarea", name: "errorMessage", label: "Error message", rows: 3, width: "full" },
    ] }],
  },
  deleteIntegration: {
    id: "settings-delete-integration",
    title: "Delete Integration",
    submitLabel: "Delete integration",
    sections: [{ id: "integration", fields: [
      { id: "integration-id", type: "number", name: "integrationId", label: "Integration ID", required: true, width: "1/2" },
      { id: "integration-type", type: "select", name: "integrationType", label: "Integration type", defaultValue: "GoogleDrive", options: integrationTypeOptions, width: "1/2" },
    ] }],
  },
  createWhatsappBusinessAccount: {
    id: "settings-create-whatsapp-business-account",
    title: "Create WhatsApp Business Account",
    submitLabel: "Create account",
    sections: [
      {
        id: "account",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", required: true, width: "1/2" },
          { id: "phone", type: "text", name: "phoneNumber", label: "Phone number", required: true, width: "1/2" },
          { id: "phone-id", type: "text", name: "phoneNumberId", label: "Phone number ID", required: true, width: "1/2" },
          { id: "business-id", type: "text", name: "businessAccountId", label: "Business account ID", required: true, width: "1/2" },
          { id: "display-name", type: "text", name: "displayName", label: "Display name", required: true, width: "1/2" },
          { id: "language", type: "text", name: "defaultLanguage", label: "Default language", defaultValue: "en", width: "1/2" },
          { id: "credentials-ref", type: "text", name: "credentialsReference", label: "Credentials reference", required: true, width: "1/2" },
          { id: "webhook-secret", type: "text", name: "webhookSecretReference", label: "Webhook secret reference", required: true, width: "1/2" },
          { id: "messaging", type: "switch", name: "messagingEnabled", label: "Messaging", defaultValue: true, width: "1/4" },
          { id: "notifications", type: "switch", name: "notificationsEnabled", label: "Notifications", defaultValue: true, width: "1/4" },
          { id: "templates", type: "switch", name: "templateMessagingEnabled", label: "Templates", defaultValue: true, width: "1/4" },
          { id: "interactive", type: "switch", name: "interactiveMessagingEnabled", label: "Interactive", defaultValue: true, width: "1/4" },
          { id: "primary", type: "switch", name: "isPrimary", label: "Primary account", width: "1/3" },
          { id: "webhook-enabled", type: "switch", name: "webhookEnabled", label: "Webhook enabled", width: "1/3" },
          { id: "daily-limit", type: "number", name: "dailyMessageLimit", label: "Daily message limit", defaultValue: 1000, width: "1/3" },
          { id: "webhook-url", type: "text", name: "webhookUrl", label: "Webhook URL", width: "1/2" },
          { id: "events", type: "text", name: "subscribedWebhookEvents", label: "Subscribed events (CSV)", defaultValue: "messages,message_status,account_alerts", width: "1/2" },
          { id: "namespace", type: "text", name: "templateNamespace", label: "Template namespace", width: "1/2" },
          { id: "media", type: "text", name: "mediaProvider", label: "Media provider", width: "1/2" },
          { id: "metadata", type: "textarea", name: "metadata", label: "Metadata JSON/string", rows: 3, width: "full" },
        ],
      },
    ],
  },
  updateWhatsappBusinessAccount: {
    id: "settings-update-whatsapp-business-account",
    title: "Update WhatsApp Business Account",
    submitLabel: "Update account",
    sections: [{ id: "account", fields: [
      { id: "account-id", type: "number", name: "accountId", label: "Account ID", required: true, width: "1/2" },
      { id: "name", type: "text", name: "name", label: "Name", width: "1/2" },
      { id: "display-name", type: "text", name: "displayName", label: "Display name", width: "1/2" },
      { id: "language", type: "text", name: "defaultLanguage", label: "Default language", width: "1/2" },
      { id: "messaging", type: "switch", name: "messagingEnabled", label: "Messaging", width: "1/4" },
      { id: "notifications", type: "switch", name: "notificationsEnabled", label: "Notifications", width: "1/4" },
      { id: "templates", type: "switch", name: "templateMessagingEnabled", label: "Templates", width: "1/4" },
      { id: "interactive", type: "switch", name: "interactiveMessagingEnabled", label: "Interactive", width: "1/4" },
      { id: "webhook-enabled", type: "switch", name: "webhookEnabled", label: "Webhook enabled", width: "1/2" },
      { id: "daily-limit", type: "number", name: "dailyMessageLimit", label: "Daily message limit", width: "1/2" },
      { id: "webhook-url", type: "text", name: "webhookUrl", label: "Webhook URL", width: "1/2" },
      { id: "events", type: "text", name: "subscribedWebhookEvents", label: "Subscribed events (CSV)", width: "1/2" },
      { id: "namespace", type: "text", name: "templateNamespace", label: "Template namespace", width: "1/2" },
      { id: "media", type: "text", name: "mediaProvider", label: "Media provider", width: "1/2" },
    ] }],
  },
  deleteWhatsappBusinessAccount: {
    id: "settings-delete-whatsapp-business-account",
    title: "Delete WhatsApp Business Account",
    submitLabel: "Delete account",
    sections: [{ id: "account", fields: [{ id: "account-id", type: "number", name: "accountId", label: "Account ID", required: true }] }],
  },
  setWhatsappPrimaryAccount: {
    id: "settings-set-whatsapp-primary-account",
    title: "Set WhatsApp Primary Account",
    submitLabel: "Set primary",
    sections: [{ id: "account", fields: [{ id: "account-id", type: "number", name: "accountId", label: "Account ID", required: true }] }],
  },
  updateWhatsappVerificationStatus: {
    id: "settings-update-whatsapp-verification-status",
    title: "Update WhatsApp Verification Status",
    submitLabel: "Update verification",
    sections: [{ id: "verification", fields: [
      { id: "account-id", type: "number", name: "accountId", label: "Account ID", required: true, width: "1/3" },
      { id: "status", type: "select", name: "verificationStatus", label: "Status", defaultValue: "Pending", options: verificationStatusOptions, width: "1/3" },
      { id: "level", type: "select", name: "verificationLevel", label: "Level", defaultValue: "Unverified", options: verificationLevelOptions, width: "1/3" },
    ] }],
  },
  recordWhatsappHealthCheck: {
    id: "settings-record-whatsapp-health-check",
    title: "Record WhatsApp Health Check",
    submitLabel: "Record health",
    sections: [{ id: "health", fields: [
      { id: "account-id", type: "number", name: "accountId", label: "Account ID", required: true, width: "1/2" },
      { id: "healthy", type: "switch", name: "isHealthy", label: "Healthy", defaultValue: true, width: "1/2" },
    ] }],
  },
  recordWhatsappMessageSent: {
    id: "settings-record-whatsapp-message-sent",
    title: "Record WhatsApp Message Sent",
    submitLabel: "Record message",
    sections: [{ id: "message", fields: [{ id: "account-id", type: "number", name: "accountId", label: "Account ID", required: true }] }],
  },
  grantPermission: {
    id: "settings-grant-permission",
    title: "Grant Permission",
    submitLabel: "Grant permission",
    sections: [{ id: "permission", fields: [
      { id: "subject-type", type: "select", name: "subjectType", label: "Subject type", defaultValue: "Role", options: [{ value: "Role", label: "Role" }, { value: "User", label: "User identity" }], width: "1/2" },
      { id: "subject-value", type: "text", name: "subjectValue", label: "Role ID or user identity", required: true, width: "1/2" },
      { id: "resource", type: "text", name: "resource", label: "Resource", required: true, width: "1/2" },
      { id: "action", type: "select", name: "action", label: "Action", defaultValue: "Read", options: permissionActionOptions, width: "1/4" },
      { id: "effect", type: "select", name: "effect", label: "Effect", defaultValue: "Allow", options: [{ value: "Allow", label: "Allow" }, { value: "Deny", label: "Deny" }], width: "1/4" },
    ] }],
  },
  revokePermission: {
    id: "settings-revoke-permission",
    title: "Revoke Permission",
    submitLabel: "Revoke permission",
    sections: [{ id: "permission", fields: [{ id: "permission-id", type: "number", name: "permissionId", label: "Permission ID", required: true }] }],
  },
  archiveAiChatSession: {
    id: "settings-archive-ai-chat-session",
    title: "Archive AI Chat Session",
    submitLabel: "Update archive state",
    sections: [{ id: "session", fields: [
      { id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true, width: "1/2" },
      { id: "session-key", type: "text", name: "sessionKey", label: "Session key", required: true, width: "1/2" },
      { id: "archived", type: "switch", name: "archived", label: "Archived", defaultValue: true, width: "1/2" },
    ] }],
  },
  createCompany: {
    id: "settings-create-company",
    title: "Create Company",
    submitLabel: "Create company",
    sections: [
      {
        id: "company",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", required: true, width: "1/2" },
          { id: "code", type: "text", name: "code", label: "Code", required: true, width: "1/2" },
          { id: "currency", type: "number", name: "currencyId", label: "Currency ID", width: "1/2" },
          { id: "country", type: "text", name: "addressCountryCode", label: "Country code", width: "1/2" },
        ],
      },
    ],
  },
  updateCompany: {
    id: "settings-update-company",
    title: "Update Company",
    submitLabel: "Update company",
    sections: [
      {
        id: "company",
        fields: [
          { id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true, width: "1/2" },
          { id: "name", type: "text", name: "name", label: "Name", width: "1/2" },
          { id: "code", type: "text", name: "code", label: "Code", width: "1/2" },
          { id: "active", type: "switch", name: "isActive", label: "Active", width: "1/2" },
        ],
      },
    ],
  },
  updateCompanyAddress: {
    id: "settings-update-company-address",
    title: "Update Company Address",
    submitLabel: "Update address",
    sections: [
      {
        id: "address",
        fields: [
          { id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true, width: "1/2" },
          { id: "street", type: "text", name: "addressStreet", label: "Street", width: "1/2" },
          { id: "city", type: "text", name: "addressCity", label: "City", width: "1/2" },
          { id: "zip", type: "text", name: "addressZip", label: "Zip", width: "1/2" },
          { id: "country", type: "text", name: "addressCountryCode", label: "Country code", width: "1/2" },
        ],
      },
    ],
  },
  updateCompanyBusiness: {
    id: "settings-update-company-business",
    title: "Update Company Business",
    submitLabel: "Update business",
    sections: [
      {
        id: "business",
        fields: [
          { id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true, width: "1/2" },
          { id: "tax", type: "text", name: "taxId", label: "Tax ID", width: "1/2" },
          { id: "registry", type: "text", name: "companyRegistry", label: "Company registry", width: "1/2" },
        ],
      },
    ],
  },
  updateCompanyHierarchy: {
    id: "settings-update-company-hierarchy",
    title: "Update Company Hierarchy",
    submitLabel: "Update hierarchy",
    sections: [
      {
        id: "hierarchy",
        fields: [
          { id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true, width: "1/3" },
          { id: "parent-id", type: "number", name: "parentId", label: "Parent ID", width: "1/3" },
          { id: "is-parent", type: "switch", name: "isParent", label: "Is parent", width: "1/3" },
        ],
      },
    ],
  },
  deleteCompany: {
    id: "settings-delete-company",
    title: "Delete Company",
    submitLabel: "Delete company",
    sections: [{ id: "company", fields: [{ id: "company-id", type: "number", name: "companyId", label: "Company ID", required: true }] }],
  },
  createDataClassification: {
    id: "settings-create-data-classification",
    title: "Create Data Classification",
    submitLabel: "Create classification",
    sections: [
      {
        id: "classification",
        fields: [
          { id: "name", type: "text", name: "name", label: "Name", required: true, width: "1/2" },
          { id: "level", type: "number", name: "level", label: "Level", defaultValue: 2, width: "1/2" },
          { id: "description", type: "textarea", name: "description", label: "Description", rows: 3, width: "full" },
          { id: "retention", type: "number", name: "retentionDays", label: "Retention days", width: "1/2" },
          { id: "encrypt", type: "switch", name: "encryptionRequired", label: "Encryption required", width: "1/2" },
        ],
      },
    ],
  },
  createDataClassificationRule: {
    id: "settings-create-data-classification-rule",
    title: "Create Data Classification Rule",
    submitLabel: "Create rule",
    sections: [
      {
        id: "rule",
        fields: [
          { id: "table", type: "text", name: "tableName", label: "Table name", required: true, width: "1/2" },
          { id: "column", type: "text", name: "columnName", label: "Column name", required: true, width: "1/2" },
          { id: "classification", type: "number", name: "classificationId", label: "Classification ID", required: true, width: "1/2" },
          { id: "applies", type: "text", name: "appliesTo", label: "Applies to", defaultValue: "all", width: "1/2" },
        ],
      },
    ],
  },
  updateOrgMemberRole: {
    id: "settings-update-org-member-role",
    title: "Update Org Member Role",
    submitLabel: "Update role",
    sections: [
      {
        id: "member",
        fields: [
          { id: "user-org-id", type: "number", name: "userOrgId", label: "User org membership ID", required: true, width: "1/2" },
          { id: "role-name", type: "text", name: "roleName", label: "Role name", required: true, width: "1/2" },
        ],
      },
    ],
  },
  createPasswordResetToken: {
    id: "settings-create-password-reset-token",
    title: "Create Password Reset Token",
    description: "Superuser-only. Requires target identity hex and a server-produced token hash.",
    submitLabel: "Create token",
    sections: [
      {
        id: "reset",
        fields: [
          { id: "identity", type: "text", name: "targetIdentity", label: "Target identity", required: true, width: "full" },
          { id: "hash", type: "textarea", name: "tokenHash", label: "Token hash", required: true, rows: 2, width: "full" },
          { id: "expires", type: "datetime", name: "expiresAt", label: "Expires at", required: true, width: "full" },
        ],
      },
    ],
  },
  createUserInviteDirect: {
    id: "settings-create-user-invite-direct",
    title: "Create User Invite (direct reducer)",
    description: "Superuser-only. Prefer User Management invite for production onboarding.",
    submitLabel: "Create invite",
    sections: [
      {
        id: "invite",
        fields: [
          { id: "email", type: "text", name: "email", label: "Email", required: true, width: "1/2" },
          { id: "role-id", type: "number", name: "roleId", label: "Role ID", required: true, width: "1/2" },
          { id: "hash", type: "textarea", name: "tokenHash", label: "Token hash", required: true, rows: 2, width: "full" },
          { id: "invited-by", type: "text", name: "invitedBy", label: "Invited by identity", required: true, width: "1/2" },
          { id: "expires", type: "datetime", name: "expiresAt", label: "Expires at", required: true, width: "1/2" },
        ],
      },
    ],
  },
  storeUserCredential: {
    id: "settings-store-user-credential",
    title: "Store User Credential",
    description: "Superuser-only. Provision password credentials after server-side identity creation.",
    submitLabel: "Store credential",
    sections: [
      {
        id: "credential",
        fields: [
          { id: "identity", type: "text", name: "newIdentity", label: "New identity", required: true, width: "full" },
          { id: "email", type: "text", name: "email", label: "Email", required: true, width: "1/2" },
          { id: "hash", type: "textarea", name: "passwordHash", label: "Password hash", required: true, rows: 2, width: "full" },
          { id: "token-enc", type: "textarea", name: "stdbTokenEnc", label: "Encrypted STDB token", required: true, rows: 2, width: "full" },
        ],
      },
    ],
  },
  storeSsoUserCredential: {
    id: "settings-store-sso-user-credential",
    title: "Store SSO User Credential",
    description: "Superuser-only. Link WorkOS SSO to a SpacetimeDB identity.",
    submitLabel: "Store SSO credential",
    sections: [
      {
        id: "credential",
        fields: [
          { id: "identity", type: "text", name: "newIdentity", label: "New identity", required: true, width: "full" },
          { id: "email", type: "text", name: "email", label: "Email", required: true, width: "1/2" },
          { id: "workos", type: "text", name: "workosUserId", label: "WorkOS user ID", required: true, width: "1/2" },
          { id: "token-enc", type: "textarea", name: "stdbTokenEnc", label: "Encrypted STDB token", required: true, rows: 2, width: "full" },
          { id: "verified", type: "switch", name: "emailVerified", label: "Email verified", defaultValue: true, width: "1/2" },
        ],
      },
    ],
  },
  createUserSession: {
    id: "settings-create-user-session-advanced",
    title: "Create User Session",
    submitLabel: "Create session",
    sections: [
      {
        id: "session",
        fields: [
          { id: "token", type: "text", name: "sessionToken", label: "Session token", required: true, width: "full" },
          { id: "expires", type: "datetime", name: "expiresAt", label: "Expires at", required: true, width: "1/2" },
          { id: "ip", type: "text", name: "ipAddress", label: "IP address", width: "1/2" },
        ],
      },
    ],
  },
  logAuditEvent: {
    id: "settings-log-audit-event-advanced",
    title: "Log Audit Event",
    submitLabel: "Log event",
    sections: [
      {
        id: "event",
        fields: [
          { id: "table", type: "text", name: "tableName", label: "Table name", required: true, width: "1/2" },
          { id: "record", type: "number", name: "recordId", label: "Record ID", required: true, width: "1/2" },
          { id: "action", type: "text", name: "action", label: "Action", required: true, width: "1/2" },
          { id: "company", type: "number", name: "companyId", label: "Company ID", width: "1/2" },
          { id: "old", type: "textarea", name: "oldValues", label: "Old values JSON", rows: 2, width: "full" },
          { id: "new", type: "textarea", name: "newValues", label: "New values JSON", rows: 2, width: "full" },
          { id: "fields", type: "text", name: "changedFields", label: "Changed fields (CSV)", width: "full" },
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

export function SettingsClient({ organizationId }: { organizationId?: number }) {
  const { t } = useTranslation()
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />
  return <SettingsLoaded organizationId={organizationId} title={t("settings.page.title")} description={t("settings.page.description")} />
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
  const { orgId } = orgBigInts(organizationId)
  const [activeAction, setActiveAction] = useState<SettingsAction | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const createAuditRule = useCreateAuditRule(orgId)
  const updateAuditRule = useUpdateAuditRule(orgId)
  const endSession = useEndUserSession(orgId)
  const updateProfile = useUpdateUserProfile(orgId)
  const updatePassword = useUpdateUserPassword(orgId)
  const updateEmail = useUpdateUserEmail(orgId)
  const recordPrivacyConsent = useRecordPrivacyConsent(orgId)
  const updateGoogleDriveCredentials = useUpdateGoogleDriveCredentials(orgId)
  const updateWhatsappCredentials = useUpdateWhatsappCredentials(orgId)
  const createCompany = useCreateCompany(organizationId)
  const updateCompany = useUpdateCompany()
  const updateCompanyAddress = useUpdateCompanyAddress()
  const updateCompanyBusiness = useUpdateCompanyBusiness()
  const updateCompanyHierarchy = useUpdateCompanyHierarchy()
  const deleteCompany = useDeleteCompany()
  const createDataClassification = useCreateDataClassification(organizationId)
  const createDataClassificationRule = useCreateDataClassificationRule(organizationId)
  const updateOrgMemberRole = useUpdateOrgMemberRole(orgId)
  const createPasswordResetToken = useCreatePasswordResetToken(orgId)
  const createUserInviteDirect = useCreateUserInviteReducer(orgId)
  const storeUserCredential = useStoreUserCredential(orgId)
  const storeSsoUserCredential = useStoreSsoUserCredential(orgId)
  const createUserSession = useCreateUserSession(orgId)
  const logAuditEvent = useLogAuditEvent(orgId)

  const isPending =
    createAuditRule.isPending ||
    updateAuditRule.isPending ||
    endSession.isPending ||
    updateProfile.isPending ||
    updatePassword.isPending ||
    updateEmail.isPending ||
    recordPrivacyConsent.isPending ||
    updateGoogleDriveCredentials.isPending ||
    updateWhatsappCredentials.isPending ||
    createCompany.isPending ||
    updateCompany.isPending ||
    updateCompanyAddress.isPending ||
    updateCompanyBusiness.isPending ||
    updateCompanyHierarchy.isPending ||
    deleteCompany.isPending ||
    createDataClassification.isPending ||
    createDataClassificationRule.isPending ||
    updateOrgMemberRole.isPending ||
    createPasswordResetToken.isPending ||
    createUserInviteDirect.isPending ||
    storeUserCredential.isPending ||
    storeSsoUserCredential.isPending ||
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
      } else if (activeAction === "updateProfile") {
        await updateProfile.mutateAsync(compactParams(formData, ["name", "department", "timezone", "locale"]))
      } else if (activeAction === "updatePassword") {
        await updatePassword.mutateAsync({
          targetIdentity: String(formData.targetIdentity ?? ""),
          newPasswordHash: String(formData.newPasswordHash ?? ""),
        })
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
      } else if (activeAction === "recordGoogleDriveSync") {
        await recordGoogleDriveSync(orgId, toBigIntId(formData.connectionId, "Connection ID"), optionalTimestamp(formData.nextSyncAt))
      } else if (activeAction === "recordGoogleDriveSyncError") {
        await recordGoogleDriveSyncError(orgId, toBigIntId(formData.connectionId, "Connection ID"), String(formData.errorMessage ?? ""))
      } else if (activeAction === "updateIntegrationStatus") {
        await updateIntegrationStatus(
          orgId,
          toBigIntId(formData.integrationId, "Integration ID"),
          String(formData.integrationType ?? "GoogleDrive") as "GoogleDrive" | "WhatsAppBusiness",
          String(formData.status ?? "Active") as "Active" | "Inactive" | "Pending" | "Suspended",
          String(formData.syncStatus ?? "Connected") as "Connected" | "Disconnected" | "Syncing" | "Error" | "PendingAuth",
          optionalText(formData.errorMessage),
        )
      } else if (activeAction === "deleteIntegration") {
        if (!confirm("Delete this integration?")) return
        await deleteIntegration(
          orgId,
          toBigIntId(formData.integrationId, "Integration ID"),
          String(formData.integrationType ?? "GoogleDrive") as "GoogleDrive" | "WhatsAppBusiness",
        )
      } else if (activeAction === "createWhatsappBusinessAccount") {
        await createWhatsAppBusinessAccount(orgId, {
          name: String(formData.name ?? ""),
          phoneNumber: String(formData.phoneNumber ?? ""),
          phoneNumberId: String(formData.phoneNumberId ?? ""),
          businessAccountId: String(formData.businessAccountId ?? ""),
          displayName: String(formData.displayName ?? ""),
          credentialsReference: String(formData.credentialsReference ?? ""),
          webhookSecretReference: String(formData.webhookSecretReference ?? ""),
          messagingEnabled: Boolean(formData.messagingEnabled),
          notificationsEnabled: Boolean(formData.notificationsEnabled),
          templateMessagingEnabled: Boolean(formData.templateMessagingEnabled),
          interactiveMessagingEnabled: Boolean(formData.interactiveMessagingEnabled),
          defaultLanguage: String(formData.defaultLanguage ?? "en"),
          webhookEnabled: Boolean(formData.webhookEnabled),
          webhookUrl: optionalText(formData.webhookUrl),
          subscribedWebhookEvents: csvList(formData.subscribedWebhookEvents),
          dailyMessageLimit: Number(formData.dailyMessageLimit ?? 1000),
          isPrimary: Boolean(formData.isPrimary),
          templateNamespace: optionalText(formData.templateNamespace),
          mediaProvider: optionalText(formData.mediaProvider),
          metadata: optionalText(formData.metadata),
        })
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
        if (!confirm("Delete this WhatsApp Business account?")) return
        await deleteWhatsAppBusinessAccount(orgId, toBigIntId(formData.accountId, "Account ID"))
      } else if (activeAction === "setWhatsappPrimaryAccount") {
        await setWhatsAppPrimaryAccount(orgId, toBigIntId(formData.accountId, "Account ID"))
      } else if (activeAction === "updateWhatsappVerificationStatus") {
        await updateWhatsAppVerificationStatus(
          orgId,
          toBigIntId(formData.accountId, "Account ID"),
          String(formData.verificationStatus ?? "Pending") as "Pending" | "Approved" | "Rejected" | "Expired" | "Revoked",
          String(formData.verificationLevel ?? "Unverified") as "Unverified" | "BusinessPortfolio" | "BusinessVerified",
        )
      } else if (activeAction === "recordWhatsappHealthCheck") {
        await recordWhatsAppHealthCheck(orgId, toBigIntId(formData.accountId, "Account ID"), Boolean(formData.isHealthy))
      } else if (activeAction === "recordWhatsappMessageSent") {
        await recordWhatsAppMessageSent(orgId, toBigIntId(formData.accountId, "Account ID"))
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
        if (!confirm("Revoke this permission?")) return
        await revokePermission(orgId, toBigIntId(formData.permissionId, "Permission ID"))
      } else if (activeAction === "archiveAiChatSession") {
        await archiveAiChatSession(
          orgId,
          toBigIntId(formData.companyId, "Company ID"),
          String(formData.sessionKey ?? ""),
          Boolean(formData.archived),
        )
      } else if (activeAction === "createCompany") {
        await createCompany.mutateAsync(compactParams(formData, ["name", "code", "currencyId", "addressCountryCode"]))
      } else if (activeAction === "updateCompany") {
        await updateCompany.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
          params: compactParams(formData, ["name", "code", "isActive"]),
        })
      } else if (activeAction === "updateCompanyAddress") {
        await updateCompanyAddress.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
          params: compactParams(formData, ["addressStreet", "addressCity", "addressZip", "addressCountryCode"]),
        })
      } else if (activeAction === "updateCompanyBusiness") {
        await updateCompanyBusiness.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
          params: compactParams(formData, ["taxId", "companyRegistry"]),
        })
      } else if (activeAction === "updateCompanyHierarchy") {
        const parentRaw = String(formData.parentId ?? "").trim()
        await updateCompanyHierarchy.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
          params: {
            ...compactParams(formData, ["isParent"]),
            parentId: parentRaw !== "" ? BigInt(parentRaw) : null,
          },
        })
      } else if (activeAction === "deleteCompany") {
        if (!confirm("Delete this company?")) return
        await deleteCompany.mutateAsync({
          companyId: toBigIntId(formData.companyId, "Company ID"),
          organizationId,
        })
      } else if (activeAction === "createDataClassification") {
        await createDataClassification.mutateAsync(compactParams(formData, ["name", "level", "description", "retentionDays", "encryptionRequired"]))
      } else if (activeAction === "createDataClassificationRule") {
        await createDataClassificationRule.mutateAsync(compactParams(formData, ["tableName", "columnName", "classificationId", "appliesTo"]))
      } else if (activeAction === "updateOrgMemberRole") {
        await updateOrgMemberRole.mutateAsync({
          userOrgId: formData.userOrgId as string | number,
          roleName: String(formData.roleName ?? ""),
        })
      } else if (activeAction === "createPasswordResetToken") {
        await createPasswordResetToken.mutateAsync({
          targetIdentity: String(formData.targetIdentity ?? ""),
          tokenHash: String(formData.tokenHash ?? ""),
          expiresAt: formData.expiresAt,
        })
      } else if (activeAction === "createUserInviteDirect") {
        await createUserInviteDirect.mutateAsync({
          email: String(formData.email ?? ""),
          roleId: formData.roleId as string | number,
          tokenHash: String(formData.tokenHash ?? ""),
          invitedBy: String(formData.invitedBy ?? ""),
          expiresAt: formData.expiresAt,
        })
      } else if (activeAction === "storeUserCredential") {
        await storeUserCredential.mutateAsync({
          newIdentity: String(formData.newIdentity ?? ""),
          email: String(formData.email ?? ""),
          passwordHash: String(formData.passwordHash ?? ""),
          stdbTokenEnc: String(formData.stdbTokenEnc ?? ""),
        })
      } else if (activeAction === "storeSsoUserCredential") {
        await storeSsoUserCredential.mutateAsync({
          newIdentity: String(formData.newIdentity ?? ""),
          email: String(formData.email ?? ""),
          stdbTokenEnc: String(formData.stdbTokenEnc ?? ""),
          workosUserId: String(formData.workosUserId ?? ""),
          emailVerified: Boolean(formData.emailVerified),
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
    { id: "createAuditRule", title: "Create audit rule", description: "Add a new audit rule for monitored resources." },
    { id: "updateAuditRule", title: "Update audit rule", description: "Patch an existing audit rule by ID." },
    { id: "endSession", title: "End session", description: "Terminate a user session by session ID." },
    { id: "updateProfile", title: "Profile", description: "Update profile fields for the current identity." },
    { id: "updatePassword", title: "Password", description: "Admin password hash update flow." },
    { id: "updateEmail", title: "Email", description: "Update email and verification state." },
    { id: "recordPrivacyConsent", title: "Privacy consent", description: "Record a contact consent decision." },
    { id: "googleDriveCredentials", title: "Google Drive", description: "Update integration credentials." },
    { id: "whatsappCredentials", title: "WhatsApp", description: "Update integration credentials." },
    { id: "createGoogleDriveConnection", title: "Create Google Drive", description: "Create a Google Drive connection record." },
    { id: "updateGoogleDriveConnection", title: "Update Google Drive", description: "Patch Google Drive sync and webhook settings." },
    { id: "recordGoogleDriveSync", title: "Google Drive sync", description: "Record a successful sync timestamp." },
    { id: "recordGoogleDriveSyncError", title: "Google Drive error", description: "Record the latest sync error." },
    { id: "updateIntegrationStatus", title: "Integration status", description: "Update status for a supported integration." },
    { id: "deleteIntegration", title: "Delete integration", description: "Soft-delete a supported integration." },
    { id: "createWhatsappBusinessAccount", title: "Create WhatsApp account", description: "Create a WhatsApp Business connection." },
    { id: "updateWhatsappBusinessAccount", title: "Update WhatsApp account", description: "Patch WhatsApp Business settings." },
    { id: "deleteWhatsappBusinessAccount", title: "Delete WhatsApp account", description: "Soft-delete a WhatsApp Business account." },
    { id: "setWhatsappPrimaryAccount", title: "Primary WhatsApp account", description: "Set the organization primary account." },
    { id: "updateWhatsappVerificationStatus", title: "WhatsApp verification", description: "Update Meta verification state." },
    { id: "recordWhatsappHealthCheck", title: "WhatsApp health", description: "Record the latest health check result." },
    { id: "recordWhatsappMessageSent", title: "WhatsApp sent count", description: "Increment the sent-message quota counter." },
    { id: "grantPermission", title: "Grant permission", description: "Create a role or user permission grant." },
    { id: "revokePermission", title: "Revoke permission", description: "Delete an organization permission by ID." },
    { id: "archiveAiChatSession", title: "AI chat archive", description: "Archive or restore an AI chat session." },
    { id: "createCompany", title: "Create company", description: "Create a company record in the organization." },
    { id: "updateCompany", title: "Update company", description: "Patch core company fields." },
    { id: "updateCompanyAddress", title: "Company address", description: "Update company address fields." },
    { id: "updateCompanyBusiness", title: "Company business", description: "Update tax and registry fields." },
    { id: "updateCompanyHierarchy", title: "Company hierarchy", description: "Update parent/company hierarchy settings." },
    { id: "deleteCompany", title: "Delete company", description: "Delete a company by ID." },
    { id: "createDataClassification", title: "Data classification", description: "Create a data privacy classification." },
    { id: "createDataClassificationRule", title: "Classification rule", description: "Map a classification to a table column." },
    { id: "updateOrgMemberRole", title: "Org member role", description: "Set membership role by role display name." },
    { id: "createPasswordResetToken", title: "Password reset token", description: "Superuser: store a hashed reset token." },
    { id: "createUserInviteDirect", title: "Invite (direct reducer)", description: "Superuser: create invite row directly." },
    { id: "storeUserCredential", title: "Store credential", description: "Superuser: provision password credentials." },
    { id: "storeSsoUserCredential", title: "Store SSO credential", description: "Superuser: link WorkOS SSO identity." },
    { id: "createUserSession", title: "Create session", description: "Record a user session row (admin/testing)." },
    { id: "logAuditEvent", title: "Log audit event", description: "Insert a manual audit log entry." },
  ]

  return (
    <div className="space-y-6">
      <DashboardHeader title={title} description={description} />
      <SettingsModule />

      <section className="rounded-xl border border-dashed border-border bg-card">
        <div className="border-b border-border px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Advanced</p>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.01em]">Admin action coverage</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Direct form-builder surfaces for settings reducers that are not yet embedded in the polished settings sections.
          </p>
        </div>
        {successMessage ? (
          <div className="mx-4 mt-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
            {successMessage}
          </div>
        ) : null}
        <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="rounded-lg border border-border bg-background p-3 text-left shadow-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
              onClick={() => {
                setSubmitError(null)
                setSuccessMessage(null)
                setActiveAction(action.id)
              }}
            >
              <p className="text-sm font-medium">{action.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{action.description}</p>
            </button>
          ))}
        </div>
      </section>

      {activeAction ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setActiveAction(null)
              setSubmitError(null)
            }
          }}
          config={settingsActionForms[activeAction]}
          isPending={isPending}
          closeOnSubmit={false}
          submitError={submitError}
          onSubmit={handleSubmit}
        />
      ) : null}
    </div>
  )
}

"use client"

import { stdbBrowserCall } from "../browser-http"

type UnitEnum =
  | "Active"
  | "Inactive"
  | "Pending"
  | "Suspended"
  | "Connected"
  | "Disconnected"
  | "Syncing"
  | "Error"
  | "PendingAuth"
  | "GoogleDrive"
  | "WhatsAppBusiness"
  | "UploadOnly"
  | "DownloadOnly"
  | "Bidirectional"
  | "Approved"
  | "Rejected"
  | "Expired"
  | "Revoked"
  | "Unverified"
  | "BusinessPortfolio"
  | "BusinessVerified"
  | "Read"
  | "Write"
  | "Create"
  | "Delete"
  | "All"
  | "Allow"
  | "Deny"

function unit(tag: UnitEnum): { tag: UnitEnum } {
  return { tag }
}

export interface CreateGoogleDriveConnectionArgs {
  name: string
  accountEmail: string
  accountId: string
  credentialsReference: string
  rootFolderId?: string | null
  sharedDriveId?: string | null
  syncEnabled: boolean
  webhookEnabled: boolean
  webhookUrl?: string | null
  webhookSecretReference?: string | null
  syncDirection: "UploadOnly" | "DownloadOnly" | "Bidirectional"
  syncFrequencyMinutes: number
  allowedFileTypes: string[]
  maxFileSizeMb: number
}

export function createGoogleDriveConnection(
  organizationId: bigint,
  args: CreateGoogleDriveConnectionArgs,
) {
  return stdbBrowserCall("create_google_drive_connection", [
    organizationId,
    args.name,
    args.accountEmail,
    args.accountId,
    args.credentialsReference,
    args.rootFolderId ?? null,
    args.sharedDriveId ?? null,
    args.syncEnabled,
    args.webhookEnabled,
    args.webhookUrl ?? null,
    args.webhookSecretReference ?? null,
    unit(args.syncDirection),
    args.syncFrequencyMinutes,
    args.allowedFileTypes,
    args.maxFileSizeMb,
  ])
}

export function updateGoogleDriveConnection(
  organizationId: bigint,
  connectionId: bigint,
  args: Partial<
    Omit<CreateGoogleDriveConnectionArgs, "accountEmail" | "accountId" | "credentialsReference"> & {
      autoSyncFiles: boolean
    }
  >,
) {
  return stdbBrowserCall("update_google_drive_connection", [
    connectionId,
    organizationId,
    args.name ?? null,
    args.rootFolderId ?? null,
    args.sharedDriveId ?? null,
    args.syncEnabled ?? null,
    args.autoSyncFiles ?? null,
    args.allowedFileTypes ?? null,
    args.maxFileSizeMb ?? null,
    args.webhookEnabled ?? null,
    args.webhookUrl ?? null,
    args.syncDirection ? unit(args.syncDirection) : null,
    args.syncFrequencyMinutes ?? null,
  ])
}

export function recordGoogleDriveSync(
  organizationId: bigint,
  connectionId: bigint,
  nextSyncAt: { microsSinceUnixEpoch: bigint } | null,
) {
  return stdbBrowserCall("record_google_drive_sync", [connectionId, organizationId, nextSyncAt])
}

export function recordGoogleDriveSyncError(
  organizationId: bigint,
  connectionId: bigint,
  errorMessage: string,
) {
  return stdbBrowserCall("record_google_drive_sync_error", [
    connectionId,
    organizationId,
    errorMessage,
  ])
}

export type IntegrationKind = "GoogleDrive" | "WhatsAppBusiness"
export type IntegrationStatusKind = "Active" | "Inactive" | "Pending" | "Suspended"
export type SyncStatusKind = "Connected" | "Disconnected" | "Syncing" | "Error" | "PendingAuth"

export function updateIntegrationStatus(
  organizationId: bigint,
  integrationId: bigint,
  integrationType: IntegrationKind,
  status: IntegrationStatusKind,
  syncStatus: SyncStatusKind,
  errorMessage?: string | null,
) {
  return stdbBrowserCall("update_integration_status", [
    organizationId,
    integrationId,
    unit(integrationType),
    unit(status),
    unit(syncStatus),
    errorMessage ?? null,
  ])
}

export function deleteIntegration(
  organizationId: bigint,
  integrationId: bigint,
  integrationType: IntegrationKind,
) {
  return stdbBrowserCall("delete_integration", [
    organizationId,
    integrationId,
    unit(integrationType),
  ])
}

export interface CreateWhatsAppBusinessAccountArgs {
  name: string
  phoneNumber: string
  phoneNumberId: string
  businessAccountId: string
  displayName: string
  credentialsReference: string
  webhookSecretReference: string
  messagingEnabled: boolean
  notificationsEnabled: boolean
  templateMessagingEnabled: boolean
  interactiveMessagingEnabled: boolean
  defaultLanguage: string
  webhookEnabled: boolean
  webhookUrl?: string | null
  subscribedWebhookEvents: string[]
  dailyMessageLimit: number
  isPrimary: boolean
  templateNamespace?: string | null
  mediaProvider?: string | null
  metadata?: string | null
}

export function createWhatsAppBusinessAccount(
  organizationId: bigint,
  args: CreateWhatsAppBusinessAccountArgs,
) {
  return stdbBrowserCall("create_whatsapp_business_account", [organizationId, args])
}

export function updateWhatsAppBusinessAccount(
  organizationId: bigint,
  accountId: bigint,
  args: Partial<Omit<CreateWhatsAppBusinessAccountArgs, "phoneNumber" | "phoneNumberId" | "businessAccountId" | "credentialsReference" | "webhookSecretReference" | "isPrimary" | "metadata">>,
) {
  return stdbBrowserCall("update_whatsapp_business_account", [organizationId, accountId, args])
}

export function deleteWhatsAppBusinessAccount(organizationId: bigint, accountId: bigint) {
  return stdbBrowserCall("delete_whatsapp_business_account", [organizationId, accountId])
}

export function setWhatsAppPrimaryAccount(organizationId: bigint, accountId: bigint) {
  return stdbBrowserCall("set_whatsapp_primary_account", [organizationId, accountId])
}

export function updateWhatsAppVerificationStatus(
  organizationId: bigint,
  accountId: bigint,
  verificationStatus: "Pending" | "Approved" | "Rejected" | "Expired" | "Revoked",
  verificationLevel: "Unverified" | "BusinessPortfolio" | "BusinessVerified",
) {
  return stdbBrowserCall("update_whatsapp_verification_status", [
    organizationId,
    accountId,
    {
      verificationStatus: unit(verificationStatus),
      businessVerificationLevel: unit(verificationLevel),
    },
  ])
}

export function recordWhatsAppHealthCheck(
  organizationId: bigint,
  accountId: bigint,
  isHealthy: boolean,
) {
  return stdbBrowserCall("record_whatsapp_health_check", [
    organizationId,
    accountId,
    { isHealthy },
  ])
}

export function recordWhatsAppMessageSent(organizationId: bigint, accountId: bigint) {
  return stdbBrowserCall("record_whatsapp_message_sent", [organizationId, accountId])
}

export function grantPermission(
  organizationId: bigint,
  args: {
    subjectType: "Role" | "User"
    subjectValue: bigint | string
    resource: string
    action: "Read" | "Write" | "Create" | "Delete" | "All"
    effect: "Allow" | "Deny"
  },
) {
  const subject =
    args.subjectType === "Role"
      ? { tag: "Role", value: args.subjectValue }
      : { tag: "User", value: String(args.subjectValue) }

  return stdbBrowserCall("grant_permission", [
    organizationId,
    {
      subject,
      resource: args.resource,
      action: unit(args.action),
      effect: unit(args.effect),
    },
  ])
}

export function revokePermission(organizationId: bigint, permissionId: bigint) {
  return stdbBrowserCall("revoke_permission", [organizationId, permissionId])
}

export function archiveAiChatSession(
  organizationId: bigint,
  companyId: bigint,
  sessionKey: string,
  archived: boolean,
) {
  return stdbBrowserCall("archive_ai_chat_session", [
    organizationId,
    companyId,
    sessionKey,
    archived,
  ])
}

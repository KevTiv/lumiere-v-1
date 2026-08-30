"use client"

import { stdbBrowserCommand } from "../browser-http"
import { stdbParamsToJson } from "../stdb-params-json"

type UnitEnum =
  | "GoogleDrive"
  | "WhatsAppBusiness"
  | "UploadOnly"
  | "DownloadOnly"
  | "Bidirectional"
  | "PreferRemote"
  | "PreferLocal"
  | "Skip"
  | "Manual"

function unit(tag: UnitEnum): { tag: UnitEnum } {
  return { tag }
}

export interface CreateGoogleDriveConnectionArgs {
  companyId?: bigint | null
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
  conflictPolicy?: "PreferRemote" | "PreferLocal" | "Skip" | "Manual" | null
  syncFrequencyMinutes: number
  allowedFileTypes: string[]
  maxFileSizeMb: number
}

export function createGoogleDriveConnection(
  _organizationId: bigint,
  args: CreateGoogleDriveConnectionArgs,
) {
  return stdbBrowserCommand("create_google_drive_connection", {
    companyId: args.companyId ?? null,
    name: args.name,
    accountEmail: args.accountEmail,
    accountId: args.accountId,
    credentialsReference: args.credentialsReference,
    rootFolderId: args.rootFolderId ?? null,
    sharedDriveId: args.sharedDriveId ?? null,
    syncEnabled: args.syncEnabled,
    webhookEnabled: args.webhookEnabled,
    webhookUrl: args.webhookUrl ?? null,
    webhookSecretReference: args.webhookSecretReference ?? null,
    syncDirection: unit(args.syncDirection),
    conflictPolicy: args.conflictPolicy ? unit(args.conflictPolicy) : null,
    syncFrequencyMinutes: args.syncFrequencyMinutes,
    allowedFileTypes: args.allowedFileTypes,
    maxFileSizeMb: args.maxFileSizeMb,
  })
}

export function updateGoogleDriveConnection(
  _organizationId: bigint,
  connectionId: bigint,
  args: Partial<
    Omit<
      CreateGoogleDriveConnectionArgs,
      "companyId" | "accountEmail" | "accountId" | "credentialsReference" | "conflictPolicy"
    > & {
      autoSyncFiles: boolean
    }
  >,
) {
  return stdbBrowserCommand("update_google_drive_connection", {
    connectionId,
    name: args.name ?? null,
    rootFolderId: args.rootFolderId ?? null,
    sharedDriveId: args.sharedDriveId ?? null,
    syncEnabled: args.syncEnabled ?? null,
    autoSyncFiles: args.autoSyncFiles ?? null,
    allowedFileTypes: args.allowedFileTypes ?? null,
    maxFileSizeMb: args.maxFileSizeMb ?? null,
    webhookEnabled: args.webhookEnabled ?? null,
    webhookUrl: args.webhookUrl ?? null,
    syncDirection: args.syncDirection ? unit(args.syncDirection) : null,
    syncFrequencyMinutes: args.syncFrequencyMinutes ?? null,
  })
}

export type IntegrationKind = "GoogleDrive" | "WhatsAppBusiness"

export function deleteIntegration(
  _organizationId: bigint,
  integrationId: bigint,
  integrationType: IntegrationKind,
) {
  return stdbBrowserCommand("delete_integration", {
    integrationId,
    integrationType: unit(integrationType),
  })
}

export interface CreateWhatsAppBusinessAccountArgs {
  companyId?: bigint | null
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
  _organizationId: bigint,
  args: CreateWhatsAppBusinessAccountArgs,
) {
  return stdbBrowserCommand("create_whatsapp_business_account", {
    params: stdbParamsToJson(args, "CreateWhatsAppBusinessAccountParams"),
  })
}

export function updateWhatsAppBusinessAccount(
  _organizationId: bigint,
  accountId: bigint,
  args: Partial<
    Omit<
      CreateWhatsAppBusinessAccountArgs,
      | "companyId"
      | "phoneNumber"
      | "phoneNumberId"
      | "businessAccountId"
      | "credentialsReference"
      | "webhookSecretReference"
      | "isPrimary"
      | "metadata"
    >
  >,
) {
  return stdbBrowserCommand("update_whatsapp_business_account", {
    accountId,
    params: stdbParamsToJson(args, "UpdateWhatsAppBusinessAccountParams"),
  })
}

export function deleteWhatsAppBusinessAccount(_organizationId: bigint, accountId: bigint) {
  return stdbBrowserCommand("delete_whatsapp_business_account", { accountId })
}

export function setWhatsAppPrimaryAccount(_organizationId: bigint, accountId: bigint) {
  return stdbBrowserCommand("set_whatsapp_primary_account", { accountId })
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
  const actionKey = args.action.charAt(0).toLowerCase() + args.action.slice(1)
  const effectKey = args.effect.charAt(0).toLowerCase() + args.effect.slice(1)
  const subject =
    args.subjectType === "Role"
      ? { role: Number(args.subjectValue) }
      : {
          user: {
            __identity__: `0x${String(args.subjectValue).replace(/^0x/i, "")}`,
          },
        }

  return stdbBrowserCommand("grant_permission", {
    params: {
      subject,
      resource: args.resource,
      action: { [actionKey]: [] },
      effect: { [effectKey]: [] },
    },
  })
}

export function revokePermission(_organizationId: bigint, permissionId: bigint) {
  return stdbBrowserCommand("revoke_permission", { permissionId })
}

export function archiveAiChatSession(
  _organizationId: bigint,
  companyId: bigint,
  sessionKey: string,
  archived: boolean,
) {
  return stdbBrowserCommand("archive_ai_chat_session", { companyId, sessionKey, archived })
}

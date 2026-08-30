"use client"

import { createBrowserStdbSdk, stdbBrowserCommand } from "../browser-http"

type UnitEnum =
  | "UploadOnly"
  | "DownloadOnly"
  | "Bidirectional"
  | "PreferRemote"
  | "PreferLocal"
  | "Skip"
  | "Manual"

function unit<T extends UnitEnum>(tag: T): { tag: T } {
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

type UpdateGoogleDriveConnectionArgs = Partial<
  Omit<
    CreateGoogleDriveConnectionArgs,
    "companyId" | "accountEmail" | "accountId" | "credentialsReference" | "conflictPolicy"
  > & {
    autoSyncFiles: boolean
  }
>

export type IntegrationKind = "GoogleDrive" | "WhatsAppBusiness"

export function createGoogleDriveConnection(
  _organizationId: bigint,
  args: CreateGoogleDriveConnectionArgs,
) {
  return createBrowserStdbSdk().settings.integrations.googleDrive.create({
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
  args: UpdateGoogleDriveConnectionArgs,
) {
  return createBrowserStdbSdk().settings.integrations.googleDrive.update({
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

export function deleteIntegration(
  _organizationId: bigint,
  integrationId: bigint,
  integrationType: IntegrationKind,
) {
  return createBrowserStdbSdk().settings.integrations.delete(integrationId, integrationType)
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

type UpdateWhatsAppBusinessAccountArgs = Partial<
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
>

export function createWhatsAppBusinessAccount(
  _organizationId: bigint,
  args: CreateWhatsAppBusinessAccountArgs,
) {
  return createBrowserStdbSdk().settings.integrations.whatsapp.create({
    ...args,
    companyId: args.companyId ?? undefined,
    webhookUrl: args.webhookUrl ?? undefined,
    templateNamespace: args.templateNamespace ?? undefined,
    mediaProvider: args.mediaProvider ?? undefined,
    metadata: args.metadata ?? undefined,
  })
}

export function updateWhatsAppBusinessAccount(
  _organizationId: bigint,
  accountId: bigint,
  args: UpdateWhatsAppBusinessAccountArgs,
) {
  return createBrowserStdbSdk().settings.integrations.whatsapp.update(accountId, {
    ...args,
    webhookUrl: args.webhookUrl ?? undefined,
    templateNamespace: args.templateNamespace ?? undefined,
    mediaProvider: args.mediaProvider ?? undefined,
  })
}

export function deleteWhatsAppBusinessAccount(_organizationId: bigint, accountId: bigint) {
  return createBrowserStdbSdk().settings.integrations.whatsapp.delete(accountId)
}

export function setWhatsAppPrimaryAccount(_organizationId: bigint, accountId: bigint) {
  return createBrowserStdbSdk().settings.integrations.whatsapp.setPrimary(accountId)
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
  return createBrowserStdbSdk().forCompany(companyId).settings.aiChats.setArchived(
    sessionKey,
    archived,
  )
}

"use client"

import { createBrowserStdbSdk, stdbBrowserCommand } from "../browser-http"
import type {
  CreateGoogleDriveConnectionInput,
  CreateWhatsAppBusinessAccountInput,
  IntegrationKind,
  UpdateGoogleDriveConnectionInput,
  UpdateWhatsAppBusinessAccountInput,
} from "../sdk"

export type CreateGoogleDriveConnectionArgs = CreateGoogleDriveConnectionInput

export function createGoogleDriveConnection(
  _organizationId: bigint,
  args: CreateGoogleDriveConnectionArgs,
) {
  return createBrowserStdbSdk().settings.integrations.googleDrive.create(args)
}

export function updateGoogleDriveConnection(
  _organizationId: bigint,
  connectionId: bigint,
  args: UpdateGoogleDriveConnectionInput,
) {
  return createBrowserStdbSdk().settings.integrations.googleDrive.update(connectionId, args)
}

export type { IntegrationKind }

export function deleteIntegration(
  _organizationId: bigint,
  integrationId: bigint,
  integrationType: IntegrationKind,
) {
  return createBrowserStdbSdk().settings.integrations.delete(integrationId, integrationType)
}

export type CreateWhatsAppBusinessAccountArgs = CreateWhatsAppBusinessAccountInput

export function createWhatsAppBusinessAccount(
  _organizationId: bigint,
  args: CreateWhatsAppBusinessAccountArgs,
) {
  return createBrowserStdbSdk().settings.integrations.whatsapp.create(args)
}

export function updateWhatsAppBusinessAccount(
  _organizationId: bigint,
  accountId: bigint,
  args: UpdateWhatsAppBusinessAccountInput,
) {
  return createBrowserStdbSdk().settings.integrations.whatsapp.update(accountId, args)
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

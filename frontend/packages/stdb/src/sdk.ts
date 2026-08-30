import type { LumiereHttpFetch } from "@lumiere/api-client"

import {
  stdbBffCommandPost,
  type StdbBffCommandInput,
  type StdbBffNamedReducerKey,
} from "./commands"
import { stdbParamsToJson } from "./stdb-params-json"
import type { CreateAccountAccountParams } from "./types"

export type StdbCompanyId = bigint
export type CreateAccountInput = Omit<CreateAccountAccountParams, "companyId">

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

function unit<T extends UnitEnum>(tag: T): { tag: T } {
  return { tag }
}

export interface CreateGoogleDriveConnectionInput {
  companyId?: StdbCompanyId | null
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

export type UpdateGoogleDriveConnectionInput = Partial<
  Omit<
    CreateGoogleDriveConnectionInput,
    "companyId" | "accountEmail" | "accountId" | "credentialsReference" | "conflictPolicy"
  > & {
    autoSyncFiles: boolean
  }
>

export type IntegrationKind = "GoogleDrive" | "WhatsAppBusiness"

export interface CreateWhatsAppBusinessAccountInput {
  companyId?: StdbCompanyId | null
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

export type UpdateWhatsAppBusinessAccountInput = Partial<
  Omit<
    CreateWhatsAppBusinessAccountInput,
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

export interface StdbSdk {
  settings: {
    integrations: {
      googleDrive: {
        create(input: CreateGoogleDriveConnectionInput): Promise<void>
        update(connectionId: bigint, input: UpdateGoogleDriveConnectionInput): Promise<void>
        delete(integrationId: bigint): Promise<void>
      }
      whatsapp: {
        create(input: CreateWhatsAppBusinessAccountInput): Promise<void>
        update(accountId: bigint, input: UpdateWhatsAppBusinessAccountInput): Promise<void>
        delete(accountId: bigint): Promise<void>
        setPrimary(accountId: bigint): Promise<void>
      }
      delete(integrationId: bigint, integrationType: IntegrationKind): Promise<void>
    }
  }
  forCompany(companyId: StdbCompanyId): {
    accounting: {
      accounts: {
        create(params: CreateAccountInput): Promise<void>
      }
    }
    settings: {
      aiChats: {
        setArchived(sessionKey: string, archived: boolean): Promise<void>
      }
    }
  }
}

async function executeOperation<K extends StdbBffNamedReducerKey>(
  apiFetch: LumiereHttpFetch,
  operation: K,
  input: StdbBffCommandInput<K>,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost(operation, input)
  const response = await apiFetch(urlPath, init)
  if (response.ok) return

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
    message?: string
  }
  throw new Error(payload.message ?? payload.error ?? `Operation ${operation} failed`)
}

/**
 * Contract-backed domain SDK pilot. Operation names, input shapes, immutable
 * IDs, and wire serialization are checked by generated contracts. Session
 * organization remains server-owned; selected company is always explicit.
 */
export function createStdbSdk(apiFetch: LumiereHttpFetch): StdbSdk {
  const deleteIntegration = (integrationId: bigint, integrationType: IntegrationKind) =>
    executeOperation(apiFetch, "delete_integration", {
      integrationId,
      integrationType: unit(integrationType),
    })

  return {
    settings: {
      integrations: {
        googleDrive: {
          create(input) {
            return executeOperation(apiFetch, "create_google_drive_connection", {
              companyId: input.companyId ?? null,
              name: input.name,
              accountEmail: input.accountEmail,
              accountId: input.accountId,
              credentialsReference: input.credentialsReference,
              rootFolderId: input.rootFolderId ?? null,
              sharedDriveId: input.sharedDriveId ?? null,
              syncEnabled: input.syncEnabled,
              webhookEnabled: input.webhookEnabled,
              webhookUrl: input.webhookUrl ?? null,
              webhookSecretReference: input.webhookSecretReference ?? null,
              syncDirection: unit(input.syncDirection),
              conflictPolicy: input.conflictPolicy ? unit(input.conflictPolicy) : null,
              syncFrequencyMinutes: input.syncFrequencyMinutes,
              allowedFileTypes: input.allowedFileTypes,
              maxFileSizeMb: input.maxFileSizeMb,
            })
          },
          update(connectionId, input) {
            return executeOperation(apiFetch, "update_google_drive_connection", {
              connectionId,
              name: input.name ?? null,
              rootFolderId: input.rootFolderId ?? null,
              sharedDriveId: input.sharedDriveId ?? null,
              syncEnabled: input.syncEnabled ?? null,
              autoSyncFiles: input.autoSyncFiles ?? null,
              allowedFileTypes: input.allowedFileTypes ?? null,
              maxFileSizeMb: input.maxFileSizeMb ?? null,
              webhookEnabled: input.webhookEnabled ?? null,
              webhookUrl: input.webhookUrl ?? null,
              syncDirection: input.syncDirection ? unit(input.syncDirection) : null,
              syncFrequencyMinutes: input.syncFrequencyMinutes ?? null,
            })
          },
          delete(integrationId) {
            return deleteIntegration(integrationId, "GoogleDrive")
          },
        },
        whatsapp: {
          create(input) {
            return executeOperation(apiFetch, "create_whatsapp_business_account", {
              params: stdbParamsToJson(input, "CreateWhatsAppBusinessAccountParams"),
            })
          },
          update(accountId, input) {
            return executeOperation(apiFetch, "update_whatsapp_business_account", {
              accountId,
              params: stdbParamsToJson(input, "UpdateWhatsAppBusinessAccountParams"),
            })
          },
          delete(accountId) {
            return executeOperation(apiFetch, "delete_whatsapp_business_account", { accountId })
          },
          setPrimary(accountId) {
            return executeOperation(apiFetch, "set_whatsapp_primary_account", { accountId })
          },
        },
        delete: deleteIntegration,
      },
    },
    forCompany(companyId) {
      return {
        accounting: {
          accounts: {
            create(params) {
              return executeOperation(apiFetch, "create_account_account", {
                params: stdbParamsToJson(
                  { ...params, companyId } satisfies CreateAccountAccountParams,
                  "CreateAccountAccountParams",
                ),
              })
            },
          },
        },
        settings: {
          aiChats: {
            setArchived(sessionKey, archived) {
              return executeOperation(apiFetch, "archive_ai_chat_session", {
                companyId,
                sessionKey,
                archived,
              })
            },
          },
        },
      }
    },
  }
}

import type { LumiereHttpFetch } from "@lumiere/api-client"

import {
  stdbBffCommandPost,
  type StdbBffCommandInput,
  type StdbBffNamedReducerKey,
} from "./commands"
import { stdbParamsToJson } from "./stdb-params-json"
import {
  decodeAccountAccountsQueryResponse,
  decodeAccountJournalsQueryResponse,
  decodeAccountTaxesQueryResponse,
  decodeCompaniesQueryResponse,
  type AccountAccountQueryRow,
  type AccountJournalQueryRow,
  type AccountTaxQueryRow,
  type CompanyQueryRow,
} from "./resource-reads"

type CreateAccountParams = Omit<
  Exclude<StdbBffCommandInput<"create_account_account">["params"], null>,
  "companyId"
>
type CreateAccountTaxParams = StdbBffCommandInput<"create_account_tax">["params"]
type UpdateAccountTaxParams = StdbBffCommandInput<"update_account_tax">["params"]
type CreateWhatsAppParams =
  StdbBffCommandInput<"create_whatsapp_business_account">["params"]
type UpdateWhatsAppParams =
  StdbBffCommandInput<"update_whatsapp_business_account">["params"]

export interface StdbSdk {
  readonly organization: {
    readonly companies: {
      list(): Promise<CompanyQueryRow[]>
    }
  }
  readonly settings: {
    readonly integrations: {
      readonly googleDrive: {
        create(input: StdbBffCommandInput<"create_google_drive_connection">): Promise<void>
        update(input: StdbBffCommandInput<"update_google_drive_connection">): Promise<void>
        delete(integrationId: bigint): Promise<void>
      }
      readonly whatsapp: {
        create(params: CreateWhatsAppParams): Promise<void>
        update(accountId: bigint, params: UpdateWhatsAppParams): Promise<void>
        delete(accountId: bigint): Promise<void>
        setPrimary(accountId: bigint): Promise<void>
      }
      delete(
        integrationId: bigint,
        integrationType: "GoogleDrive" | "WhatsAppBusiness",
      ): Promise<void>
    }
  }
  forCompany(companyId: bigint): {
    readonly accounting: {
      readonly accounts: {
        list(): Promise<AccountAccountQueryRow[]>
        create(params: CreateAccountParams): Promise<void>
      }
      readonly journals: {
        list(): Promise<AccountJournalQueryRow[]>
      }
      readonly taxes: {
        list(): Promise<AccountTaxQueryRow[]>
        create(params: CreateAccountTaxParams): Promise<void>
        update(taxId: bigint, params: UpdateAccountTaxParams): Promise<void>
      }
    }
    readonly settings: {
      readonly aiChats: {
        setArchived(sessionKey: string, archived: boolean): Promise<void>
      }
    }
  }
}

const PARAM_STRUCT_BY_OPERATION = {
  create_account_account: "CreateAccountAccountParams",
  create_account_tax: "CreateAccountTaxParams",
  create_whatsapp_business_account: "CreateWhatsAppBusinessAccountParams",
  update_account_tax: "UpdateAccountTaxParams",
  update_whatsapp_business_account: "UpdateWhatsAppBusinessAccountParams",
} as const satisfies Partial<Record<StdbBffNamedReducerKey, string>>

type EncodableOperationInput = {
  syncDirection?: unknown
  conflictPolicy?: unknown
  params?: unknown
}

function encodeOperationInput<K extends StdbBffNamedReducerKey>(
  operation: K,
  input: StdbBffCommandInput<K>,
): StdbBffCommandInput<K> {
  let encoded = input as StdbBffCommandInput<K> & EncodableOperationInput
  if (
    operation === "create_google_drive_connection" ||
    operation === "update_google_drive_connection"
  ) {
    encoded = { ...encoded }
    if (typeof encoded.syncDirection === "string") {
      encoded.syncDirection = { tag: encoded.syncDirection }
    }
    if (typeof encoded.conflictPolicy === "string") {
      encoded.conflictPolicy = { tag: encoded.conflictPolicy }
    }
  }

  const structName = PARAM_STRUCT_BY_OPERATION[
    operation as keyof typeof PARAM_STRUCT_BY_OPERATION
  ]
  if (!structName) return encoded as StdbBffCommandInput<K>

  const params = encoded.params
  if (params === null || typeof params !== "object") {
    return encoded as StdbBffCommandInput<K>
  }
  return {
    ...encoded,
    params: stdbParamsToJson(params, structName),
  } as StdbBffCommandInput<K>
}

async function executeOperation<K extends StdbBffNamedReducerKey>(
  apiFetch: LumiereHttpFetch,
  operation: K,
  input: StdbBffCommandInput<K>,
): Promise<void> {
  const { urlPath, init } = stdbBffCommandPost(
    operation,
    encodeOperationInput(operation, input),
  )
  const response = await apiFetch(urlPath, init)
  if (response.ok) return

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string
    message?: string
  }
  throw new Error(payload.message ?? payload.error ?? `Operation ${operation} failed`)
}

async function executeQuery<Row>(
  apiFetch: LumiereHttpFetch,
  url: string,
  errorMessage: string,
  decode: (payload: unknown) => Row[],
): Promise<Row[]> {
  const response = await apiFetch(url)
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string
      message?: string
    }
    throw new Error(payload.message ?? payload.error ?? errorMessage)
  }
  return decode(await response.json())
}

function integrationTag(tag: "GoogleDrive" | "WhatsAppBusiness") {
  return { tag }
}

/** Build Lumiere's domain API over immutable, generated operation contracts. */
export function createStdbSdk(apiFetch: LumiereHttpFetch): StdbSdk {
  const execute = <K extends StdbBffNamedReducerKey>(
    operation: K,
    input: StdbBffCommandInput<K>,
  ) => executeOperation(apiFetch, operation, input)
  const deleteIntegration = (
    integrationId: bigint,
    integrationType: "GoogleDrive" | "WhatsAppBusiness",
  ) => execute("delete_integration", {
    integrationId,
    integrationType: integrationTag(integrationType),
  })

  return {
    organization: {
      companies: {
        list: () => executeQuery(
          apiFetch,
          "/api/query/companies",
          "Query companies failed",
          decodeCompaniesQueryResponse,
        ),
      },
    },
    settings: {
      integrations: {
        googleDrive: {
          create: (input) => execute("create_google_drive_connection", input),
          update: (input) => execute("update_google_drive_connection", input),
          delete: (integrationId) => deleteIntegration(integrationId, "GoogleDrive"),
        },
        whatsapp: {
          create: (params) => execute("create_whatsapp_business_account", { params }),
          update: (accountId, params) =>
            execute("update_whatsapp_business_account", { accountId, params }),
          delete: (accountId) =>
            execute("delete_whatsapp_business_account", { accountId }),
          setPrimary: (accountId) =>
            execute("set_whatsapp_primary_account", { accountId }),
        },
        delete: deleteIntegration,
      },
    },
    forCompany(companyId) {
      return {
        accounting: {
          accounts: {
            list: () => executeQuery(
              apiFetch,
              `/api/query/account-accounts?companyId=${encodeURIComponent(companyId.toString())}`,
              "Query account-accounts failed",
              decodeAccountAccountsQueryResponse,
            ),
            create: (params) => execute("create_account_account", {
              params: { ...params, companyId },
            }),
          },
          journals: {
            list: () => executeQuery(
              apiFetch,
              `/api/query/account-journals?companyId=${encodeURIComponent(companyId.toString())}`,
              "Query account-journals failed",
              decodeAccountJournalsQueryResponse,
            ),
          },
          taxes: {
            list: () => executeQuery(
              apiFetch,
              `/api/query/account-taxes?companyId=${encodeURIComponent(companyId.toString())}`,
              "Query account-taxes failed",
              decodeAccountTaxesQueryResponse,
            ),
            create: (params) => execute("create_account_tax", { companyId, params }),
            update: (taxId, params) =>
              execute("update_account_tax", { companyId, taxId, params }),
          },
        },
        settings: {
          aiChats: {
            setArchived: (sessionKey, archived) => execute("archive_ai_chat_session", {
              companyId,
              sessionKey,
              archived,
            }),
          },
        },
      }
    },
  }
}

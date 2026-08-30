import type { LumiereHttpFetch } from "@lumiere/api-client"

import { stdbBffCommandPost } from "./commands"
import { stdbParamsToJson } from "./stdb-params-json"
import type { CreateAccountAccountParams } from "./types"

export type StdbCompanyId = bigint
export type CreateAccountInput = Omit<CreateAccountAccountParams, "companyId">

export interface StdbSdk {
  forCompany(companyId: StdbCompanyId): {
    accounting: {
      accounts: {
        create(params: CreateAccountInput): Promise<void>
      }
    }
  }
}

/**
 * Generated-contract SDK pilot for the accounting account-create operation.
 * The selected company is placed in the generated params envelope; the Rust
 * operation boundary validates it against the authenticated organization.
 */
export function createStdbSdk(apiFetch: LumiereHttpFetch): StdbSdk {
  return {
    forCompany(companyId) {
      return {
        accounting: {
          accounts: {
            async create(params) {
              const { urlPath, init } = stdbBffCommandPost("create_account_account", {
                params: stdbParamsToJson(
                  { ...params, companyId } satisfies CreateAccountAccountParams,
                  "CreateAccountAccountParams",
                ),
              })
              const response = await apiFetch(urlPath, init)
              if (!response.ok) {
                const payload = (await response.json().catch(() => ({}))) as {
                  error?: string
                  message?: string
                }
                throw new Error(
                  payload.message ?? payload.error ?? "Account creation failed",
                )
              }
            },
          },
        },
      }
    },
  }
}

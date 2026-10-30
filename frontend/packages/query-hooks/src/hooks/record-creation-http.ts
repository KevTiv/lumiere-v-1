import { useEffect, useRef } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { WorkflowError } from "@lumiere/erp-workflows"
import { apiFetch, fetchQueryList } from "../http"
import {
  executeRecordCreation, recordCreationStorageKey, RecordCreationRejected, withRecordCreationEnvelope,
  type ConfigurableCreationModel,
} from "./record-creation-invocation"

const resources = { crm_lead: "lead-creations", opportunity: "opportunity-creations", contact: "contact-creations", sale_order: "quotation-creations" } as const

/** Shared transport for canonical creates. Automatic mutation retries stay disabled. */
export function useRecordCreationTransport(organizationId: bigint, companyId: bigint | undefined, model: ConfigurableCreationModel) {
  const { identity } = useErpSession()
  const actorHex = identity?.replace(/^0x/i, "").toLowerCase() ?? ""
  const stamp = `${organizationId}:${companyId}:${actorHex}`
  const live = useRef(stamp)
  live.current = stamp
  useEffect(() => () => { live.current = "unmounted" }, [])

  return async (payloadJson: string, metadata: unknown, makeCommand: (metadata: string) => { urlPath: string; init: RequestInit }): Promise<string> => {
    if (companyId == null || companyId <= 0n) throw new WorkflowError("validation", "Company scope is required to create this record")
    const scope = { organizationId, companyId, actorHex }
    const assertScope = () => { if (live.current !== stamp) throw new WorkflowError("conflict", "Actor or company changed. The saved attempt remains in its original scope.") }
    assertScope()
    if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.locks) {
      throw new WorkflowError("validation", "This browser cannot safely coordinate record creation retries")
    }
    const storage = window.localStorage
    const key = recordCreationStorageKey(scope, model)
    let commandPath: string | undefined
    let result: string | undefined
    await navigator.locks.request(key, async () => {
      assertScope()
      result = await executeRecordCreation(scope, model, payloadJson, storage, {
        assertScope,
        makeKey: () => crypto.randomUUID(),
        makeRequest: (operationKey) => {
          const command = makeCommand(withRecordCreationEnvelope(metadata, companyId, operationKey))
          if (typeof command.init.body !== "string") throw new WorkflowError("validation", "Creation request cannot be retained")
          commandPath = command.urlPath
          return command.init.body
        },
        read: (operationKey) => {
          const query = new URLSearchParams({ companyId: companyId.toString(), operationKey })
          return fetchQueryList(`/api/query/${resources[model]}?${query}`, "Could not check the exact saved record")
        },
        dispatch: async (requestJson) => {
          if (!commandPath) throw new WorkflowError("validation", "Creation command is unavailable")
          const response = await apiFetch(commandPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: requestJson })
          if (!response.ok) {
            const message = await response.text().catch(() => "")
            if ([400, 401, 403, 404, 409, 422].includes(response.status)) throw new RecordCreationRejected(message || "Record creation was rejected. Your input is retained.")
            throw new WorkflowError("server_failure", message || "Save outcome is unknown. Check the retained attempt before creating a replacement.")
          }
        },
      })
    })
    if (!result) throw new WorkflowError("server_failure", "Record creation could not be confirmed")
    return result
  }
}

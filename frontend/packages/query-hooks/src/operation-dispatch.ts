import {
  decodeOperationDispatch,
  type OperationDispatchReceipt,
} from "@lumiere/api-client"
import {
  stdbBffCommandPost,
  type StdbBffCommandInput,
  type StdbBffNamedReducerKey,
} from "@lumiere/stdb/commands"

import { apiFetch } from "./http"

/** Dispatch one generated named operation and decode its typed receipt. */
export async function dispatchNamedOperation<K extends StdbBffNamedReducerKey>(
  operation: K,
  input: StdbBffCommandInput<K>,
  failureMessage: string,
): Promise<OperationDispatchReceipt> {
  const { urlPath, init } = stdbBffCommandPost(operation, input)
  return decodeOperationDispatch(await apiFetch(urlPath, init), failureMessage)
}

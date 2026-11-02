import { HttpResponseError } from "@lumiere/api-client/response-error"

/** A dispatched write has no authoritative terminal observation yet. Never redispatch it to check. */
export class AiActionDraftOutcomeUnknown extends Error {
  constructor() {
    super(
      "The outcome is not confirmed. Check the saved draft before taking another action.",
    )
    this.name = "AiActionDraftOutcomeUnknown"
  }
}

export function isAiActionDraftOutcomeUnknown(error: unknown): boolean {
  return error instanceof Error && error.name === "AiActionDraftOutcomeUnknown"
}

/** One command attempt followed by one exact read. A lost reply never reissues the command. */
export async function mutateAiActionDraftWithReadback<
  T extends { status?: string },
>(args: {
  dispatch: () => Promise<void>
  read: () => Promise<T>
  expectedStatus: "approved" | "rejected" | "pending"
}): Promise<T> {
  let dispatchUncertain = false
  try {
    await args.dispatch()
  } catch (error) {
    if (
      error instanceof HttpResponseError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408
    )
      throw error
    dispatchUncertain = true
  }
  let observed: T
  try {
    observed = await args.read()
  } catch {
    throw new AiActionDraftOutcomeUnknown()
  }
  // A terminal server observation is useful even when another reviewer won the race.
  if (
    ["approved", "rejected", "failed", "expired"].includes(
      observed.status ?? "",
    )
  )
    return observed
  if (!dispatchUncertain && observed.status === args.expectedStatus)
    return observed
  throw new AiActionDraftOutcomeUnknown()
}

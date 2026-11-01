export const CHAT_DECISION_OTHER_OPTION_ID = "other"
export const CHAT_DECISION_MAX_OTHER_TEXT = 2_000

export type ChatDecisionOption = {
  id: string
  label: string
  description?: string
  recommended?: boolean
}

export type ChatDecisionRequest = {
  id: string
  revision: number
  question: string
  options: readonly ChatDecisionOption[]
  allowOther: boolean
  otherLabel?: string
}

export type ChatDecisionAnswer = {
  requestId: string
  expectedRevision: number
  optionId: string
  otherText?: string
}

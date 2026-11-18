/**
 * Mirror of `lumiere_policy_core::withheld_answer::WITHHELD_ANSWER_NOTICE`
 * (crates/policy-core/src/withheld_answer.rs), the gate's single source of truth.
 * A test compares the two so the wording cannot drift.
 */
export const WITHHELD_ANSWER_NOTICE = "This answer could not be verified and was withheld"

/** Mirror of `WITHHELD_VERIFICATION_OUTCOMES`. */
export const WITHHELD_VERIFICATION_OUTCOMES = ["blocked", "requires_review"] as const

export function isWithheldAnswerNotice(text: unknown): boolean {
  return typeof text === "string" && text.trimStart().startsWith(WITHHELD_ANSWER_NOTICE)
}

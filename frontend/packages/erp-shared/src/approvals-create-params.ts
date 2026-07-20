/**
 * Legacy approval-rule form mapper — rules were replaced by published workflow versions.
 * Kept so existing imports compile; always returns null.
 */

export function toCreateApprovalRuleParams(
  _formData: Record<string, unknown>,
): null {
  return null
}

export const HR_STP_PROVIDER_UNAVAILABLE =
  "STP submission is unavailable because no provider adapter is configured. No integration intent was created."

export function hrStpProviderState(): { available: false; reason: string } {
  return { available: false, reason: HR_STP_PROVIDER_UNAVAILABLE }
}

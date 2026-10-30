/**
 * Config-driven onboarding: add steps or copy here without scattering magic strings across pages.
 */
export const ONBOARDING_TIMEZONES = [
  'UTC',
  'Africa/Kigali',
  'Africa/Nairobi',
  'Africa/Bujumbura',
  'Africa/Dar_es_Salaam',
  'Africa/Kampala',
  'Africa/Johannesburg',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Dubai',
  'Australia/Sydney',
] as const

export function isOnboardingTimezone(value: string): boolean {
  if (!value.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

/** Use the runtime's IANA catalog while retaining regional aliases and UTC. */
export function onboardingTimezones(suggested?: string): string[] {
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [...new Set<string>([...ONBOARDING_TIMEZONES, ...supported, ...(suggested && isOnboardingTimezone(suggested) ? [suggested] : [])])].sort()
}

/** A fiscal year-end recurs annually, so the month/day must exist in a non-leap year. */
export function onboardingFiscalYearEnd(monthValue: unknown, dayValue: unknown): { month: number; day: number } | null {
  if (!/^\d{1,2}$/.test(String(monthValue)) || !/^\d{1,2}$/.test(String(dayValue))) return null
  const month = Number(monthValue)
  const day = Number(dayValue)
  const date = new Date(Date.UTC(2001, month - 1, day))
  return month >= 1 && month <= 12 && day >= 1 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { month, day } : null
}

export const DEFAULT_FISCAL_YEAR_END_MONTH = 12
export const DEFAULT_FISCAL_YEAR_END_DAY = 31

/** Parse only the exact code returned by the authenticated bootstrap authority. */
export function additionalOnboardingCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('additionalOrganizationCode' in payload)) return null
  const code = payload.additionalOrganizationCode
  return typeof code === 'string' && /^[A-Z0-9_]{2,32}$/.test(code) ? code : null
}

export type OnboardingStepId = 'welcome' | 'create-tenant'

export const ONBOARDING_STEPS: ReadonlyArray<{
  id: OnboardingStepId
  /** Route segment under /onboarding — future multi-step routing */
  segment: string
}> = [
  { id: 'welcome', segment: 'welcome' },
  { id: 'create-tenant', segment: 'create-tenant' },
]

/**
 * Config-driven onboarding: add steps or copy here without scattering magic strings across pages.
 */
export const ONBOARDING_TIMEZONES = [
  'UTC',
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

export const DEFAULT_FISCAL_YEAR_END_MONTH = 12
export const DEFAULT_FISCAL_YEAR_END_DAY = 31

export type OnboardingStepId = 'welcome' | 'create-tenant'

export const ONBOARDING_STEPS: ReadonlyArray<{
  id: OnboardingStepId
  /** Route segment under /onboarding — future multi-step routing */
  segment: string
}> = [
  { id: 'welcome', segment: 'welcome' },
  { id: 'create-tenant', segment: 'create-tenant' },
]

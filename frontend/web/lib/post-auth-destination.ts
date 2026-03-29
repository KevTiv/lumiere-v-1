/**
 * Single source of truth for where to send a user after authentication completes.
 * Use these paths from callbacks, API routes, and server actions so WorkOS and password flows stay aligned.
 */
export const POST_AUTH_PATHS = {
  /** First-time tenant setup (no organization membership yet). */
  onboarding: '/onboarding',
  /** Main app entry once the user belongs to an organization. */
  overview: '/overview',
  signIn: '/sign-in',
} as const

export type PostAuthDestinationInput = {
  /** True when session resolved a default organization for the identity. */
  hasOrganization: boolean
}

/**
 * Where to send the user after sign-in / sign-up / OAuth when not completing an invite out-of-band.
 */
export function postAuthDestinationAfterSession(input: PostAuthDestinationInput): string {
  if (!input.hasOrganization) {
    return POST_AUTH_PATHS.onboarding
  }
  return POST_AUTH_PATHS.overview
}

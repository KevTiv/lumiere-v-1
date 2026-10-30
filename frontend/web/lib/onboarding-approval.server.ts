import 'server-only'

import type { ApiSession } from './api-session'
import { resolveApiServerBaseUrl } from './api-server-forward'
import { additionalOnboardingCode } from './onboarding-config'

/** A current member sees setup only when the API confirms its unused approval. */
export async function approvedAdditionalOrganizationCode(session: ApiSession): Promise<string | null> {
  const base = resolveApiServerBaseUrl()
  if (!base) return null
  try {
    const response = await fetch(`${base}/v1/bootstrap/currencies`, {
      headers: { Authorization: `Bearer ${session.stdbToken}` },
      cache: 'no-store',
    })
    return response.ok ? additionalOnboardingCode(await response.json()) : null
  } catch {
    return null
  }
}

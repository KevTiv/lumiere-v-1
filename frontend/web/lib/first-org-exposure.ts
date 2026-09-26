import 'server-only'

import {
  getProductSurfaceForPathname,
  isFirstOrgSurfaceAdmitted,
} from '@lumiere/ui/lib/product-surface-catalog'
import type { ApiSession } from '@/lib/api-session'

export function configuredFirstTestOrganizationId(): number | null {
  const raw = process.env['LUMIERE_FIRST_TEST_ORGANIZATION_ID']?.trim()
  if (!raw) return null
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('LUMIERE_FIRST_TEST_ORGANIZATION_ID must be a positive integer')
  }
  return value
}

export function isFirstTestOrganization(
  organizationId: number | undefined,
): boolean {
  const configuredId = configuredFirstTestOrganizationId()
  return configuredId !== null && organizationId === configuredId
}

export function sessionIsOrganizationAdmin(session: ApiSession): boolean {
  const fieldAccess = session.fieldAccess
  if (!fieldAccess) return false
  const normalizedRole = fieldAccess.roleName
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
  return (
    fieldAccess.isSuperuser ||
    normalizedRole === 'admin' ||
    normalizedRole === 'organization-admin'
  )
}

export function isFirstOrgPathAdmitted(
  pathname: string,
  isAdmin: boolean,
): boolean {
  const surface = getProductSurfaceForPathname(pathname)
  return surface !== null && isFirstOrgSurfaceAdmitted(surface.id, isAdmin)
}

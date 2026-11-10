import type { SessionPermissionAuthority } from "./session-permissions"

/** Presentation/BFF preflight only; the platform reducer checks authority again. */
export function canManagePlatformAiProfile(session: SessionPermissionAuthority): boolean {
  const access = session.fieldAccess
  const normalize = (identity: string) => identity.trim().replace(/^0x/i, "").toLowerCase()
  return access?.isSuperuser === true
    && access.organizationId === session.organizationId
    && /^[a-f0-9]{64}$/.test(normalize(session.identityHex))
    && normalize(access.identityHex) === normalize(session.identityHex)
}

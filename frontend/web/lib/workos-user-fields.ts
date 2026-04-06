/**
 * Normalizes WorkOS / AuthKit user shapes (directory User uses `emails[]`; some paths expose `email`).
 */

export type WorkOsAuthKitUser = {
  id: string
  email?: string | null
  emails?: readonly { value: string; primary?: boolean }[]
  emailVerified?: boolean
}

export function workOsPrimaryEmail(user: WorkOsAuthKitUser): string {
  const direct = typeof user.email === "string" ? user.email.trim() : ""
  if (direct) return direct
  const list = user.emails
  if (list?.length) {
    const primary = list.find((e) => e.primary)?.value?.trim()
    if (primary) return primary
    return list[0]?.value?.trim() ?? ""
  }
  return ""
}

export function workOsEmailVerified(user: WorkOsAuthKitUser): boolean {
  return user.emailVerified === true
}

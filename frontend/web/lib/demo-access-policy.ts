export function canInspectDemo(configuredId: string | undefined, organizationId: number | undefined, roleName: string | undefined): boolean {
  const selected = Number(configuredId)
  return Number.isSafeInteger(selected) && selected > 0 && organizationId === selected &&
    ['owner', 'admin', 'administrator', 'organization-admin'].includes(roleName?.trim().toLowerCase() ?? '')
}

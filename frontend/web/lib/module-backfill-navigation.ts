export const moduleBackfillTabs = {
  sales: 'customer-sales',
  warehouse: 'recorded-counts',
} as const

export type BackfillModule = keyof typeof moduleBackfillTabs

export function moduleBackfillHref(
  module: BackfillModule,
  task?: { id: string; companyId: number },
) {
  const params = new URLSearchParams({ tab: moduleBackfillTabs[module] })
  if (task) {
    params.set('backfillTask', task.id)
    params.set('backfillCompany', String(task.companyId))
  }
  return `/${module}?${params}`
}

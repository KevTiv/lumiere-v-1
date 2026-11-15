export const moduleBackfillTabs = {
  sales: 'customer-sales',
  shop_sales: 'shop-sales',
  warehouse: 'recorded-counts',
} as const

export type BackfillModule = keyof typeof moduleBackfillTabs

function moduleBackfillWorkspace(module: BackfillModule) {
  return module === 'shop_sales' ? 'sales' : module
}

export function moduleBackfillHref(
  module: BackfillModule,
  task?: { id: string; companyId: number },
) {
  const params = new URLSearchParams({ tab: moduleBackfillTabs[module] })
  if (task) {
    params.set('backfillTask', task.id)
    params.set('backfillCompany', String(task.companyId))
  }
  return `/${moduleBackfillWorkspace(module)}?${params}`
}

/** Saved IDs are Postgres BIGINTs and must remain exact across URLs. */
export function isModuleBackfillRecordId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9_223_372_036_854_775_807n
  )
}

export function moduleBackfillRecordHref(
  module: BackfillModule,
  {
    companyId,
    recordId,
    taskId,
  }: { companyId: number; recordId: string; taskId?: string },
  query = '',
) {
  const params = new URLSearchParams(query)
  params.set('tab', moduleBackfillTabs[module])
  params.set('backfillCompany', String(companyId))
  params.set('backfillRecord', recordId)
  if (taskId) params.set('backfillTask', taskId)
  else params.delete('backfillTask')
  return `/${moduleBackfillWorkspace(module)}?${params}`
}

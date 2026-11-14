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
  return `/${module}?${params}`
}

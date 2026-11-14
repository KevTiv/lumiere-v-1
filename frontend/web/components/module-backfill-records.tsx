'use client'

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useErpSession } from '@lumiere/erp-session'
import {
  historyPeriodDates,
  type HistoryPeriod,
} from '@lumiere/erp-shared/history-period'
import { formattingLocale, useTranslation } from '@lumiere/i18n'
import { useOperatingCompanyId } from '@lumiere/query-hooks/hooks/use-operating-company'
import { sourceReviewHistoryHref } from '@lumiere/query-hooks/hooks/source-review-navigation'
import { Button } from '@lumiere/ui/components/button'
import { HistoryPeriodSelect } from '@lumiere/ui/components/history-period-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lumiere/ui/components/table'
import { useRBAC } from '@lumiere/ui/lib/rbac-context'
import { apiFetch } from '@/lib/api-fetch'
import type { BackfillModule } from '@/lib/module-backfill-navigation'

type Facts =
  | {
      kind: 'sales'
      customer: string
      product: string
      quantity: string
      unit: string | null
      unitPrice: string
      amount: string
      currency: string
      reportedPayment: string | null
    }
  | {
      kind: 'warehouse'
      product: string
      pieces: string
      kilograms: string
      location: string | null
    }

type Page = {
  data: Array<{
    id: string
    batchId: string
    itemId: string
    sourceRevision: number
    sourceFile: string
    sourceRow: number
    periodStart: string
    periodEnd: string
    facts: Facts
  }>
  nextBeforeId: string | null
}

export function useCanReadModuleBackfill(organizationId: number) {
  const { organizationId: activeOrganization } = useErpSession()
  const { isAdmin, permissionsReady } = useRBAC()
  return permissionsReady && isAdmin() && activeOrganization === organizationId
}

export function ModuleBackfillRecords({
  organizationId,
  module,
}: {
  organizationId: number
  module: BackfillModule
}) {
  const companyId = useOperatingCompanyId(organizationId)
  const { identity, activeCompanyReady } = useErpSession()
  const allowed = useCanReadModuleBackfill(organizationId)
  if (!allowed || !activeCompanyReady || !identity || !companyId) return null

  return (
    <Records
      key={`${identity}:${organizationId}:${companyId}:${module}`}
      organizationId={organizationId}
      companyId={companyId}
      identity={identity}
      module={module}
    />
  )
}

function Records({
  organizationId,
  companyId,
  identity,
  module,
}: {
  organizationId: number
  companyId: number
  identity: string
  module: BackfillModule
}) {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const taskId = search.get('backfillTask')
  const otherCompany =
    !!taskId && search.get('backfillCompany') !== String(companyId)
  const [period, setPeriod] = useState<HistoryPeriod>('all')
  const { from, through } = historyPeriodDates(period)
  const records = useInfiniteQuery({
    queryKey: [
      'module-backfill',
      organizationId,
      companyId,
      identity,
      module,
      taskId,
      from,
      through,
    ],
    enabled: !otherCompany,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Page> => {
      const params = new URLSearchParams({ companyId: String(companyId) })
      if (taskId) params.set('taskId', taskId)
      if (from) params.set('from', from)
      if (through) params.set('through', through)
      if (pageParam) params.set('beforeId', pageParam)
      const response = await apiFetch(
        `/api/module-backfill/${module}?${params}`,
        { signal, cache: 'no-store' },
      )
      if (!response.ok) throw new Error(String(response.status))
      return response.json()
    },
    getNextPageParam: (last) => last.nextBeforeId ?? undefined,
    retry: false,
    refetchOnMount: 'always',
  })
  const title = t(
    module === 'sales' ? 'moduleRecords.sales' : 'moduleRecords.warehouse',
  )
  const rows = records.data?.pages.flatMap((page) => page.data) ?? []
  const dateFormatter = new Intl.DateTimeFormat(
    formattingLocale(i18n.language),
    {
      dateStyle: 'medium',
      timeZone: 'UTC',
    },
  )
  const formatDate = (day: string) =>
    dateFormatter.format(new Date(`${day}T00:00:00Z`))
  const showAllRecords = () => {
    const params = new URLSearchParams(search.toString())
    params.delete('backfillTask')
    params.delete('backfillCompany')
    router.replace(`${pathname}?${params}`, { scroll: false })
  }

  if (otherCompany) {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm">
          {t('moduleRecords.otherCompany')}
        </p>
        <Button type="button" variant="outline" onClick={showAllRecords}>
          {t('moduleRecords.showAll')}
        </Button>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-3" aria-busy={records.isPending}>
      <div className="flex flex-wrap items-end gap-2">
        <HistoryPeriodSelect value={period} onChange={setPeriod} />
        {taskId && (
          <Button type="button" variant="outline" onClick={showAllRecords}>
            {t('moduleRecords.showAll')}
          </Button>
        )}
      </div>
      {records.isPending && <p role="status">{t('common.loading')}</p>}
      {records.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <p>{t('moduleRecords.loadError')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void (records.isFetchNextPageError
                ? records.fetchNextPage()
                : records.refetch())
            }
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {records.isSuccess && rows.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(
            period === 'all' && !taskId
              ? module === 'sales'
                ? 'moduleRecords.emptySales'
                : 'moduleRecords.emptyCounts'
              : 'moduleRecords.emptyFiltered',
          )}
        </p>
      )}
      {rows.length > 0 &&
        (!records.isError || records.isFetchNextPageError) && (
          <Table viewportLabel={title} pagination={false}>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">
                  {t(
                    module === 'sales'
                      ? 'moduleRecords.period'
                      : 'moduleRecords.countDate',
                  )}
                </TableHead>
                {module === 'sales' && (
                  <TableHead scope="col">
                    {t('moduleRecords.customer')}
                  </TableHead>
                )}
                <TableHead scope="col">{t('moduleRecords.product')}</TableHead>
                {module === 'sales' ? (
                  <>
                    <TableHead scope="col" className="text-right">
                      {t('moduleRecords.quantity')}
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      {t('moduleRecords.unitPrice')}
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      {t('moduleRecords.reportedTotal')}
                    </TableHead>
                    <TableHead scope="col">
                      {t('moduleRecords.paymentComment')}
                    </TableHead>
                  </>
                ) : (
                  <>
                    <TableHead scope="col" className="text-right">
                      {t('moduleRecords.pieces')}
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      {t('moduleRecords.kilograms')}
                    </TableHead>
                    <TableHead scope="col">
                      {t('moduleRecords.location')}
                    </TableHead>
                  </>
                )}
                <TableHead scope="col">{t('moduleRecords.source')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ id, periodStart, periodEnd, facts, ...source }) => (
                <TableRow key={id}>
                  <TableCell>
                    <time dateTime={periodStart}>
                      {formatDate(periodStart)}
                    </time>
                    {periodStart !== periodEnd && (
                      <>
                        {' '}
                        –{' '}
                        <time dateTime={periodEnd}>
                          {formatDate(periodEnd)}
                        </time>
                      </>
                    )}
                  </TableCell>
                  {facts.kind === 'sales' ? (
                    <>
                      <TableCell>{facts.customer}</TableCell>
                      <TableCell>{facts.product}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {[facts.quantity, facts.unit].filter(Boolean).join(' ')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {facts.unitPrice} {facts.currency}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {facts.amount} {facts.currency}
                      </TableCell>
                      <TableCell>{facts.reportedPayment ?? '—'}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>{facts.product}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {facts.pieces}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {facts.kilograms}
                      </TableCell>
                      <TableCell>{facts.location ?? '—'}</TableCell>
                    </>
                  )}
                  <TableCell className="max-w-[16rem] whitespace-normal [overflow-wrap:anywhere]">
                    <a
                      className="underline underline-offset-4"
                      href={sourceReviewHistoryHref(String(companyId), {
                        batchId: source.batchId,
                        itemId: source.itemId,
                        revision: source.sourceRevision,
                      })}
                    >
                      {t('moduleRecords.sourceRow', {
                        file: source.sourceFile,
                        row: source.sourceRow,
                      })}
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      {records.hasNextPage && !records.isError && (
        <Button
          type="button"
          variant="outline"
          disabled={records.isFetchingNextPage}
          onClick={() => void records.fetchNextPage()}
        >
          {records.isFetchingNextPage
            ? t('common.loading')
            : t('moduleRecords.loadMore')}
        </Button>
      )}
    </div>
  )
}

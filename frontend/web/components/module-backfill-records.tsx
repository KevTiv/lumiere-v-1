'use client'

import { useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
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
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@lumiere/ui/components/sheet'
import { HistoryFieldDiff } from '@lumiere/ui/entity-views/history-field-diff'
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
import {
  isModuleBackfillRecordId,
  moduleBackfillRecordHref,
  type BackfillModule,
} from '@/lib/module-backfill-navigation'
import {
  moduleBackfillSavedFields,
  moduleBackfillRecordKind,
  moduleBackfillSourceName,
  type ModuleBackfillRecord,
} from '@/lib/module-backfill-record'

type Page = {
  data: ModuleBackfillRecord[]
  nextBeforeId: string | null
}

async function loadRecords(
  module: BackfillModule,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<Page> {
  const response = await apiFetch(
    `/api/module-backfill/${module}?${params}`,
    { signal, cache: 'no-store' },
  )
  if (!response.ok) throw new Error(String(response.status))
  return response.json()
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
  const recordId = search.get('backfillRecord')
  const historyTrigger = useRef<HTMLAnchorElement | null>(null)
  const validRecordId = isModuleBackfillRecordId(recordId) ? recordId : null
  const otherCompany =
    (!!taskId || recordId !== null) &&
    search.get('backfillCompany') !== String(companyId)
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
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ companyId: String(companyId) })
      if (taskId) params.set('taskId', taskId)
      if (from) params.set('from', from)
      if (through) params.set('through', through)
      if (pageParam) params.set('beforeId', pageParam)
      return loadRecords(module, params, signal)
    },
    getNextPageParam: (last) => last.nextBeforeId ?? undefined,
    retry: false,
    refetchOnMount: 'always',
  })
  const selected = useQuery({
    queryKey: [
      'module-backfill',
      organizationId,
      companyId,
      identity,
      module,
      'record',
      validRecordId,
      taskId,
    ],
    enabled: !otherCompany && validRecordId !== null,
    queryFn: async ({ signal }) => {
      if (!validRecordId) return null
      const params = new URLSearchParams({
        companyId: String(companyId),
        recordId: validRecordId,
      })
      if (taskId) params.set('taskId', taskId)
      const { data } = await loadRecords(module, params, signal)
      return data.length === 1 &&
        data[0]?.id === validRecordId &&
        data[0].facts.kind === moduleBackfillRecordKind[module]
        ? data[0]
        : null
    },
    retry: false,
    refetchOnMount: 'always',
  })
  const title = t({
    sales: 'moduleRecords.sales',
    shop_sales: 'moduleRecords.shopSales',
    warehouse: 'moduleRecords.warehouse',
  }[module])
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
  const clearSelection = (showAll = false) => {
    const params = new URLSearchParams(search.toString())
    params.delete('backfillRecord')
    if (showAll) params.delete('backfillTask')
    if (!params.has('backfillTask')) params.delete('backfillCompany')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  if (otherCompany) {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm">
          {t('moduleRecords.otherCompany')}
        </p>
        <Button type="button" variant="outline" onClick={() => clearSelection(true)}>
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
          <Button type="button" variant="outline" onClick={() => clearSelection(true)}>
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
              ? ({
                  sales: 'moduleRecords.emptySales',
                  shop_sales: 'moduleRecords.emptyShopSales',
                  warehouse: 'moduleRecords.emptyCounts',
                } as const)[module]
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
                    {
                      sales: 'moduleRecords.period',
                      shop_sales: 'moduleRecords.saleDate',
                      warehouse: 'moduleRecords.countDate',
                    }[module],
                  )}
                </TableHead>
                {module !== 'warehouse' && (
                  <TableHead scope="col">
                    {t(module === 'sales' ? 'moduleRecords.customer' : 'moduleRecords.shop')}
                  </TableHead>
                )}
                <TableHead scope="col">{t('moduleRecords.product')}</TableHead>
                {module !== 'warehouse' ? (
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
                    {module === 'sales' && (
                      <TableHead scope="col">
                        {t('moduleRecords.paymentComment')}
                      </TableHead>
                    )}
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
                  {facts.kind !== 'warehouse' ? (
                    <>
                      <TableCell>{facts.kind === 'sales' ? facts.customer : facts.shop}</TableCell>
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
                      {facts.kind === 'sales' && (
                        <TableCell>{facts.reportedPayment ?? '—'}</TableCell>
                      )}
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
                        file: moduleBackfillSourceName(source),
                        row: source.sourceRow,
                      })}
                    </a>
                    <div className="mt-1">
                      <Link
                        className="underline underline-offset-4"
                        href={moduleBackfillRecordHref(
                          module,
                          { companyId, recordId: id, taskId: taskId ?? undefined },
                          search.toString(),
                        )}
                        scroll={false}
                        prefetch={false}
                        onClick={(event) => {
                          historyTrigger.current = event.currentTarget
                        }}
                        aria-label={t('moduleRecords.recordHistoryLabel', {
                          file: moduleBackfillSourceName(source),
                          row: source.sourceRow,
                        })}
                      >
                        {t('moduleRecords.recordHistory')}
                      </Link>
                    </div>
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
      <Sheet
        open={recordId !== null}
        onOpenChange={(open) => {
          if (!open) clearSelection()
        }}
      >
        <SheetContent
          size="review"
          layout="bounded"
          finalFocus={() => historyTrigger.current?.isConnected ? historyTrigger.current : true}
        >
          <SheetHeader>
            <SheetTitle>
              {t({
                sales: 'moduleRecords.savedSale',
                shop_sales: 'moduleRecords.savedShopSale',
                warehouse: 'moduleRecords.savedCount',
              }[module])}
            </SheetTitle>
            <SheetDescription>{title}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {validRecordId && (selected.isPending || selected.isFetching) ? (
              <p role="status">{t('common.loading')}</p>
            ) : selected.isError ? (
              <div role="alert" className="flex flex-wrap items-center gap-2">
                <p>{t('moduleRecords.loadError')}</p>
                <Button variant="outline" onClick={() => void selected.refetch()}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : selected.data ? (
              <SavedRecord
                record={selected.data}
                companyId={companyId}
                dateFormatter={dateFormatter}
              />
            ) : (
              <p role="status">
                {t('moduleRecords.recordUnavailable')}
              </p>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function SavedRecord({
  record,
  companyId,
  dateFormatter,
}: {
  record: ModuleBackfillRecord
  companyId: number
  dateFormatter: Intl.DateTimeFormat
}) {
  const { t, i18n } = useTranslation()
  const { periodStart, periodEnd, savedAt } = record
  const start = new Date(`${periodStart}T00:00:00Z`)
  const end = new Date(`${periodEnd}T00:00:00Z`)
  const saveTime = savedAt ? new Date(savedAt) : null
  const fields = moduleBackfillSavedFields(record.facts, (key) => t(key))
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-4 gap-y-3 rounded-md border border-border px-3 py-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            {t({
              sales: 'moduleRecords.period',
              shop_sale: 'moduleRecords.saleDate',
              warehouse: 'moduleRecords.countDate',
            }[record.facts.kind])}
          </dt>
          <dd className="tabular-nums">
            <time dateTime={periodStart}>{dateFormatter.format(start)}</time>
            {periodStart !== periodEnd && (
              <>
                {' – '}
                <time dateTime={periodEnd}>{dateFormatter.format(end)}</time>
              </>
            )}
          </dd>
        </div>
        {saveTime && Number.isFinite(saveTime.getTime()) && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              {t('moduleRecords.savedAt')}
            </dt>
            <dd className="tabular-nums">
              <time dateTime={savedAt}>
                {new Intl.DateTimeFormat(formattingLocale(i18n.language), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(saveTime)}
              </time>
            </dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">
            {t('moduleRecords.source')}
          </dt>
          <dd>
            <a
              className="underline underline-offset-4"
              href={sourceReviewHistoryHref(String(companyId), {
                batchId: record.batchId,
                itemId: record.itemId,
                revision: record.sourceRevision,
              })}
            >
              {t('moduleRecords.sourceRow', {
                file: moduleBackfillSourceName(record),
                row: record.sourceRow,
              })}
              {' · '}
              {t('moduleRecords.sourceRevision', {
                revision: record.sourceRevision,
              })}
            </a>
          </dd>
        </div>
      </dl>
      <HistoryFieldDiff fields={fields} />
    </div>
  )
}

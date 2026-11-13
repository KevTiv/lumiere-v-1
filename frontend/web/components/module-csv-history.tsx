'use client'

import { useDeferredValue, useId, useState } from 'react'
import Link from 'next/link'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useErpSession } from '@lumiere/erp-session'
import { useTranslation } from '@lumiere/i18n'
import { useOperatingCompanyId } from '@lumiere/query-hooks/hooks/use-operating-company'
import { useRBAC } from '@lumiere/ui/lib/rbac-context'
import { Button } from '@lumiere/ui/components/button'
import { HistoryPeriodSelect } from '@lumiere/ui/components/history-period-select'
import { Input } from '@lumiere/ui/components/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lumiere/ui/components/table'
import { TablePager, usePagedRows } from '@lumiere/ui/components/table-pager'
import { apiFetch } from '../lib/api-fetch'
import {
  historyQueryKey,
  historyRowsUrl,
  parseHistoryRows,
  resetHistoryQueries,
  shiftHistoryDate,
  type HistoryFilters,
  type HistoryRow,
  type HistoryScope,
  type SourceHistoryView,
} from '../lib/history-data'
import { csvFact, csvMoney, csvQuantity } from '../lib/module-csv-history'
import { sourceHistoryLink } from '../lib/source-observation'

type Props = { organizationId: number; view: SourceHistoryView }
type PageCursor = { cursor: string | null; snapshot?: string }

export function useCanReadModuleCsvHistory(organizationId: number) {
  const session = useErpSession()
  const { isAdmin, permissionsReady } = useRBAC()
  return (
    permissionsReady && isAdmin() && session.organizationId === organizationId
  )
}

/** Source observations for the active company, displayed inside the owning module. */
export function ModuleCsvHistory({ organizationId, view }: Props) {
  const companyId = useOperatingCompanyId(organizationId)
  const { identity, activeCompanyReady } = useErpSession()
  const allowed = useCanReadModuleCsvHistory(organizationId)
  if (!allowed || !activeCompanyReady || !identity || !companyId) return null
  return (
    <CsvHistoryTable
      key={`${identity}:${organizationId}:${companyId}:${view}`}
      scope={{ actorIdentity: identity, organizationId, companyId }}
      view={view}
    />
  )
}

/** Keep the normal module visible and load its CSV history when opened. */
export function ModuleCsvHistoryDisclosure(props: Props) {
  const [open, setOpen] = useState(false)
  const allowed = useCanReadModuleCsvHistory(props.organizationId)
  const { t } = useTranslation()
  if (!allowed) return null
  return (
    <details
      className="mx-4 my-3 rounded-lg border px-4 py-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">
        {t('moduleCsvHistory.title', { defaultValue: 'CSV history' })}
      </summary>
      {open ? <ModuleCsvHistory {...props} /> : null}
    </details>
  )
}

function CsvHistoryTable({
  scope,
  view,
}: {
  scope: HistoryScope
  view: SourceHistoryView
}) {
  const { t, i18n } = useTranslation()
  const cache = useQueryClient()
  const searchId = useId()
  const [period, setPeriod] = useState<HistoryFilters['period']>('all')
  const [search, setSearch] = useState('')
  const searchTerm = useDeferredValue(search.trim())
  const filters: HistoryFilters = {
    batchId: null,
    period,
    view,
    search: searchTerm,
    timeZone: 'UTC',
    dateMode: 'all',
    state: 'confirmed',
  }
  const query = useInfiniteQuery({
    queryKey: historyQueryKey('rows', scope, filters),
    initialPageParam: { cursor: null } as PageCursor,
    queryFn: async ({ pageParam, signal }) => {
      const response = await apiFetch(
        historyRowsUrl(
          scope.companyId,
          filters,
          pageParam.cursor,
          pageParam.snapshot,
        ),
        { signal },
      )
      if (!response.ok) throw new Error(String(response.status))
      return parseHistoryRows(await response.json(), scope, pageParam.snapshot)
    },
    getNextPageParam: (last, pages): PageCursor | undefined =>
      last.nextCursor
        ? { cursor: last.nextCursor, snapshot: pages[0]?.snapshot }
        : undefined,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const rows = query.data?.pages.flatMap((page) => page.data) ?? []
  const pager = usePagedRows(rows, `${JSON.stringify(period)}:${searchTerm}`)
  const formatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  })
  const formatDate = (date: string) =>
    formatter.format(new Date(`${date}T00:00:00Z`))
  const dateRange = (row: HistoryRow) => {
    const { from, toExclusive } = row.businessDate
    if (!from || !toExclusive) return '—'
    const through = shiftHistoryDate(toExclusive, -1)
    return through === from
      ? formatDate(from)
      : `${formatDate(from)} – ${formatDate(through)}`
  }
  const field = (row: HistoryRow, ...keys: string[]) =>
    csvFact(row, keys)?.value
  const sales = view === 'sales'
  const salesAmountKeys = ['sale_amount', 'amount', 'sales_total', 'total']
  const loading =
    search.trim() !== searchTerm ||
    query.isPending ||
    (query.isFetching && !query.isFetchingNextPage)
  const error =
    query.isError ||
    rows.some((row) => row.state !== 'confirmed') ||
    new Set(rows.map((row) => row.id)).size !== rows.length

  return (
    <section
      className="min-w-0 space-y-4 p-4"
      aria-label={t('moduleCsvHistory.title', { defaultValue: 'CSV history' })}
    >
      <p className="text-sm text-muted-foreground">
        {sales
          ? t('moduleCsvHistory.salesDescription', {
              defaultValue:
                'Confirmed sales reported in CSV files. Shop and period summaries may overlap.',
            })
          : t('moduleCsvHistory.description', {
              defaultValue:
                'Confirmed source records from the company’s CSV imports.',
            })}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <HistoryPeriodSelect
          value={period}
          onChange={setPeriod}
          timeZone="UTC"
        />
        <label htmlFor={searchId} className="min-w-48 space-y-1 text-sm">
          <span>
            {t('moduleCsvHistory.search', {
              defaultValue: 'Search CSV history',
            })}
          </span>
          <Input
            id={searchId}
            maxLength={100}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Link
          className="self-center text-sm underline underline-offset-4"
          href={sourceHistoryLink(scope.companyId)}
        >
          {t('moduleCsvHistory.openReview', {
            defaultValue: 'Open source review',
          })}
        </Link>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void resetHistoryQueries(cache, scope)}
        >
          {t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>
      {loading ? (
        <p role="status">
          {t('availableHistory.loadingRows', {
            defaultValue: 'Loading source rows…',
          })}
        </p>
      ) : error ? (
        <p role="alert">
          {t('availableHistory.unavailable', {
            defaultValue: 'History could not be loaded',
          })}
        </p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('availableHistory.noMatches', {
                defaultValue: 'No saved source rows match these filters.',
              })}
            </p>
          ) : (
            <Table pagination={false}>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('availableHistory.businessDate', {
                      defaultValue: 'Business date',
                    })}
                  </TableHead>
                  <TableHead>
                    {sales
                      ? t('moduleCsvHistory.productCustomer', {
                          defaultValue: 'Product or customer',
                        })
                      : t('availableHistory.item', { defaultValue: 'Item' })}
                  </TableHead>
                  <TableHead>
                    {t('moduleCsvHistory.location', {
                      defaultValue: 'Location',
                    })}
                  </TableHead>
                  {sales ? (
                    <>
                      <TableHead className="text-right">
                        {t('moduleCsvHistory.quantity', {
                          defaultValue: 'Quantity',
                        })}
                      </TableHead>
                      <TableHead className="text-right">
                        {t('moduleCsvHistory.unitPrice', {
                          defaultValue: 'Unit price',
                        })}
                      </TableHead>
                    </>
                  ) : null}
                  <TableHead className="text-right">
                    {t('moduleCsvHistory.amount', {
                      defaultValue: 'Recorded amount',
                    })}
                  </TableHead>
                  <TableHead>
                    {t('availableHistory.source', { defaultValue: 'Source' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.pageRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{dateRange(row)}</TableCell>
                    <TableCell className="min-w-40 whitespace-normal font-medium">
                      {sales
                        ? (field(
                            row,
                            'product',
                            'product_label',
                            'customer',
                            'customer_label',
                          ) ?? row.label)
                        : row.label}
                    </TableCell>
                    <TableCell>
                      {field(
                        row,
                        'shop',
                        'location',
                        'location_name',
                        'business_location',
                      ) ?? '—'}
                    </TableCell>
                    {sales ? (
                      <>
                        <TableCell className="text-right tabular-nums">
                          {csvQuantity(row, ['sold_quantity', 'quantity']) ??
                            '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {csvMoney(row, [
                            'sale_unit_price',
                            'unit_price',
                            'price_unit',
                          ]) ?? '—'}
                        </TableCell>
                      </>
                    ) : null}
                    <TableCell className="text-right tabular-nums">
                      {csvMoney(
                        row,
                        sales
                          ? salesAmountKeys
                          : [
                              'amount',
                              'balance',
                              'sale_amount',
                              'purchase_amount',
                            ],
                      ) ?? '—'}
                    </TableCell>
                    <TableCell className="min-w-40 whitespace-normal">
                      <Link
                        className="break-words text-sm underline underline-offset-4"
                        href={sourceHistoryLink(
                          scope.companyId,
                          row.batchId,
                          row.id,
                        )}
                      >
                        {t('moduleCsvHistory.sourceRow', {
                          defaultValue: '{{file}} · row {{row}}',
                          file: row.source.file,
                          row: row.source.row,
                        })}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {query.hasNextPage ? (
              <Button
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {t('availableHistory.moreRows', {
                  defaultValue: 'Load more rows',
                })}
              </Button>
            ) : (
              <span />
            )}
            <TablePager {...pager} />
          </div>
        </>
      )}
    </section>
  )
}

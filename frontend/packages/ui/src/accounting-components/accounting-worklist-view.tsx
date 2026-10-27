"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import { MoreHorizontal } from "lucide-react"
import { Card, CardContent, CardHeader } from "../components/card"
import { Button } from "../components/button"
import { Badge } from "../components/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/dropdown-menu"
import { KpiStrip } from "../components/kpi-strip"
import { EmptyStateCard } from "../components/empty-state-card"
import { useEntityTable } from "../entity-views/use-entity-table"
import { useEntityTableExport } from "../entity-views/use-entity-table-export"
import { useRBAC } from "../lib/rbac-context"
import type { AccountMove } from "../lib/accounting-types"
import type { ModuleDataState } from "../lib/module-data-state"
import type { EntityColumn } from "../lib/entity-view-types"
import { workspaceStyles } from "../lib/workspace-styles"
import { accountingListStatusBadgeClass } from "../lib/theme-colors"
import {
  moveStateIsDraft,
  moveTypeIsInvoiceOrRefund,
  stbEnumTag,
} from "../lib/accounting-move-utils"
import {
  accountingListReturnHref,
  commitRecordListFor,
  consumeRecordListReturnContext,
  readRecordListReturnContext,
  rememberRecordList,
  type RecordListReturnContext,
} from "../lib/record-list-context"
import { ModuleDataNotice } from "../pages/module-data-notice"
import { formatInvoiceMoney } from "./invoice-document"
import {
  accountingCurrencySummaries,
  accountingDocumentHref,
  accountingListMoney,
  matchesAccountingListFilters,
  type AccountingListDisplayProps,
} from "./accounting-list-display"
import { AccountingWorklistToolbar } from "./accounting-worklist-toolbar"
import {
  accountingWorklistKey,
  accountingWorklistRow,
  EMPTY_WORKLIST,
  readAccountingWorklistPreferences,
  saveAccountingWorklist,
  scopedAccountingMoves,
  worklistId,
  type AccountingWorklistPreferences,
  type AccountingWorklistRow,
  type AccountingWorklistScope,
  type AccountingWorklistView,
} from "./accounting-worklist-model"

export interface AccountingWorklistProps extends AccountingListDisplayProps {
  worklistScope?: AccountingWorklistScope
  sourceState?: ModuleDataState
}
interface AccountingWorklistViewProps extends AccountingWorklistProps {
  viewSettings?: ReactNode
  kind: "invoice" | "bill"
  rows: AccountMove[]
  onSelect?: (move: AccountMove) => void
  onCreate?: () => void
  onPay?: (move: AccountMove) => void
  onSend?: (move: AccountMove) => void
  onDownload?: (move: AccountMove) => void
  onRecalculateTotals?: (move: AccountMove) => void
}

/** Hard boundary: never render cached rows/totals or actions from an unavailable or changed scope. */
export function AccountingWorklistView(props: AccountingWorklistViewProps) {
  const { t } = useTranslation()
  if (props.sourceState && props.sourceState.status !== "ready")
    return props.sourceState.status === "loading" ? (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        {t("common.loading", { defaultValue: "Loading…" })}
      </p>
    ) : (
      <ModuleDataNotice state={props.sourceState} />
    )
  if (
    !worklistId(props.worklistScope?.organizationId) ||
    !worklistId(props.worklistScope?.companyId)
  )
    return (
      <ModuleDataNotice
        state={{
          status: "error",
          message: t("accounting.worklists.scopeRequired", {
            defaultValue:
              "Select an organization and company to view these records.",
          }),
        }}
      />
    )
  const uncertainScope = props.rows.some(
    (row) =>
      !worklistId(row.organizationId) ||
      !worklistId(row.companyId) ||
      (worklistId(row.organizationId) ===
        worklistId(props.worklistScope?.organizationId) &&
        worklistId(row.companyId) ===
          worklistId(props.worklistScope?.companyId) &&
        !worklistId(row.id))
  )
  if (uncertainScope)
    return (
      <ModuleDataNotice
        state={{
          status: "error",
          message: t("accounting.worklists.incompleteScope", {
            defaultValue:
              "Record identity or company scope is unavailable. Refresh the complete records before using this worklist.",
          }),
        }}
      />
    )
  const key = `${props.kind}:${props.worklistScope?.organizationId}:${props.worklistScope?.companyId}:${props.worklistScope?.userId ?? "session"}`
  return <ReadyAccountingWorklist key={key} {...props} />
}

function useWorklistPreferences(key: string | null) {
  const [preferences, setPreferences] =
    useState<AccountingWorklistPreferences | null>(
      key ? null : { current: EMPTY_WORKLIST, saved: [] }
    )
  const [persistent, setPersistent] = useState(false)
  useEffect(() => {
    if (!key) return
    try {
      const raw: unknown = JSON.parse(
        window.localStorage.getItem(key) ?? "null"
      )
      setPreferences(readAccountingWorklistPreferences(raw))
      setPersistent(true)
    } catch {
      setPreferences({ current: EMPTY_WORKLIST, saved: [] })
      setPersistent(false)
    }
  }, [key])
  const update = (next: AccountingWorklistPreferences) => {
    setPreferences(next)
    if (key && persistent) {
      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({ version: 1, ...next })
        )
      } catch {
        setPersistent(false)
      }
    }
  }
  return { preferences, update, persistent }
}

function ReadyAccountingWorklist(props: AccountingWorklistViewProps) {
  const { t } = useTranslation()
  const storageKey = accountingWorklistKey(props.worklistScope, props.kind)
  const { preferences, update, persistent } = useWorklistPreferences(storageKey)
  // Mount the table owner only after its effective saved filters are known.
  if (!preferences) return <p role="status" className="p-4 text-sm text-muted-foreground">{t("common.loading", { defaultValue: "Loading…" })}</p>
  return <AccountingWorklistTable {...props} preferences={preferences} update={update} persistent={persistent} storageKey={storageKey} />
}

function AccountingWorklistTable({
  kind,
  viewSettings,
  rows,
  worklistScope,
  currencyOptions = [],
  initialFilters = {},
  onInitialFilterClear,
  onSelect,
  onCreate,
  onPay,
  onSend,
  onDownload,
  onRecalculateTotals,
  preferences,
  update,
  persistent,
  storageKey,
}: AccountingWorklistViewProps & {
  preferences: AccountingWorklistPreferences
  update: (next: AccountingWorklistPreferences) => void
  persistent: boolean
  storageKey: string | null
}) {
  const { t } = useTranslation()
  const { checkPermission } = useRBAC()
  const current = preferences.current
  const worklistRef = useRef<HTMLDivElement>(null)
  const restoredOnce = useRef(false)
  const isBill = kind === "bill"
  const canCreate = checkPermission("account_move", "create").allowed
  const canWrite = checkPermission("account_move", "write").allowed
  const canRead = checkPermission("account_move", "read").allowed
  const title = isBill
    ? t("accounting.bills.title")
    : t("accounting.invoices.title")
  const newLabel = isBill
    ? t("accounting.actions.newBill")
    : t("accounting.actions.newInvoice")
  const openLabel = t("accounting.worklists.openStatus", {
    defaultValue: "Open",
  })
  const statusLabels = {
    draft: t("accounting.states.draft"),
    sent: openLabel,
    pending: openLabel,
    approved: t("accounting.states.approved"),
    partial: t("accounting.states.partial"),
    paid: t("accounting.states.paid"),
    overdue: t("accounting.states.overdue"),
    cancelled: t("accounting.states.cancelled"),
    unavailable: t("accounting.worklists.unavailable", {
      defaultValue: "Unavailable",
    }),
  }
  const statuses = (
    isBill
      ? [
          "draft",
          "pending",
          "partial",
          "paid",
          "overdue",
          "cancelled",
          "unavailable",
        ]
      : [
          "draft",
          "sent",
          "partial",
          "paid",
          "overdue",
          "cancelled",
          "unavailable",
        ]
  ).map((value) => ({
    value,
    label: statusLabels[value as keyof typeof statusLabels],
  }))
  const columns: EntityColumn[] = [
    {
      key: "name",
      label: isBill
        ? t("accounting.bills.billNumber")
        : t("accounting.invoices.title"),
    },
    {
      key: "partner",
      label: isBill
        ? t("accounting.bills.vendor")
        : t("accounting.invoices.customer"),
    },
    {
      key: "issueDate",
      label: isBill
        ? t("accounting.bills.billDate")
        : t("accounting.invoices.issueDate"),
      type: "date",
    },
    { key: "dueDate", label: t("accounting.invoices.dueDate"), type: "date" },
    {
      key: "amountTotal",
      label: t("accounting.invoices.amount"),
      type: "number",
    },
    {
      key: "amountResidual",
      label: t("accounting.invoices.balanceDue"),
      type: "number",
    },
    {
      key: "currency",
      label: t("accounting.worklists.currency", { defaultValue: "Currency" }),
    },
    { key: "status", label: t("accounting.journalEntries.state") },
  ]
  const scoped = useMemo(
    () => scopedAccountingMoves(rows, worklistScope),
    [rows, worklistScope]
  )
  const normalized = useMemo(
    () =>
      scoped.map((move) => {
        const id = worklistId(move.currencyId)
        const option = currencyOptions.find((currency) => currency.value === id)
        return accountingWorklistRow(
          move,
          kind,
          option?.label || option?.code || (id ? `Currency #${id}` : "—")
        )
      }),
    [scoped, currencyOptions, kind]
  )
  const linked = { ...initialFilters }
  delete linked.search
  delete linked.status
  delete linked.currencyId
  delete linked.queue
  const effective = { ...current.filters }
  // Explicit URL values override local equivalents, rather than intersecting with hidden preferences.
  for (const key of ["status", "currencyId", "queue"] as const)
    if (initialFilters[key] !== undefined) effective[key] = initialFilters[key]
  const matching = normalized.filter((row) => {
    const move = {
      ...row.source,
      invoiceDateDue:
        row.dueDate === undefined
          ? null
          : { microsSinceUnixEpoch: BigInt(row.dueDate) * 1000n },
    }
    if (!matchesAccountingListFilters(move, linked, kind)) return false
    if (
      effective.queue &&
      !["pending", "open", "overdue"].includes(effective.queue)
    )
      return false
    if (
      effective.queue === "pending" &&
      !["sent", "pending", "approved", "partial"].includes(row.status)
    )
      return false
    if (
      effective.queue === "open" &&
      !(
        stbEnumTag(move.state).toLowerCase() === "posted" &&
        typeof move.amountResidual === "number" &&
        move.amountResidual > 0
      )
    )
      return false
    if (effective.queue === "overdue" && row.status !== "overdue") return false
    return true
  })
  const filterKey = JSON.stringify([initialFilters.search ?? current.search, Object.entries({ ...linked, ...effective }).sort(([a], [b]) => a.localeCompare(b))])
  const [restored] = useState(() => storageKey && typeof window !== "undefined"
    ? readRecordListReturnContext("/accounting/invoices", { key: storageKey, href: window.location.pathname + window.location.search, filterKey })
    : undefined)
  const engine = useEntityTable({
    columns,
    data: matching,
    rowKey: "id",
    pageSize: 25,
    searchKeys: ["name", "partner"],
    search: initialFilters.search ?? current.search,
    filters: { status: effective.status, currencyId: effective.currencyId },
    initialSorting: restored?.sorting,
    initialPage: restored?.page,
  })
  const visibleColumns = columns.filter(
    (column) => !current.hiddenColumns.includes(column.key)
  )
  // CSV always retains currency context, even when that display column is hidden.
  const exportColumns = visibleColumns.some(
    (column) => column.key === "currency"
  )
    ? visibleColumns
    : [...visibleColumns, columns[6]!]
  const { exportCsv } = useEntityTableExport({
    columns: exportColumns,
    filteredRows: engine.sortedRows,
    selectedRows: engine.selectedRows,
    listViewKey: `accounting-${kind}s`,
  })
  useEffect(() => {
    if (!restored || restoredOnce.current) return
    const frame = requestAnimationFrame(() => {
      const owner = worklistRef.current
      if (!owner) return
      restoredOnce.current = true
      const scroller = owner.closest<HTMLElement>('[data-slot="sidebar-inset"]') ?? document.scrollingElement
      if (scroller) scroller.scrollTop = restored.scrollTop
      const table = owner.querySelector<HTMLElement>('[data-slot="table-container"]')
      if (table) table.scrollLeft = restored.scrollLeft
      const row = [...owner.querySelectorAll<HTMLElement>("[data-record-return-id]")].find((element) => element.dataset.recordReturnId === restored.rowId)
      const target = restored.focus === "row" && row?.tabIndex === 0 ? row : row?.querySelector<HTMLElement>("a[href]")
      target?.focus({ preventScroll: true })
      consumeRecordListReturnContext("/accounting/invoices", restored.key)
    })
    return () => cancelAnimationFrame(frame)
  }, [restored])
  const rememberSelection = (rowId: string, focus: "link" | "row") => {
    const ids = (engine.sortedRows as AccountingWorklistRow[]).map((row) => row.id)
    const owner = worklistRef.current
    const href = storageKey ? accountingListReturnHref(window.location.pathname + window.location.search, storageKey) : undefined
    const scroller = owner?.closest<HTMLElement>('[data-slot="sidebar-inset"]') ?? document.scrollingElement
    const table = owner?.querySelector<HTMLElement>('[data-slot="table-container"]')
    const snapshot: RecordListReturnContext | undefined = storageKey && href ? {
      key: storageKey, href, filterKey, sorting: engine.sorting.map((sort) => ({ ...sort })),
      page: engine.currentPage, rowId, focus, scrollTop: scroller?.scrollTop ?? 0, scrollLeft: table?.scrollLeft ?? 0,
    } : undefined
    rememberRecordList(ids, snapshot)
    return { ids, snapshot }
  }
  const filtered = engine.sortedRows as AccountingWorklistRow[]
  const summaries = accountingCurrencySummaries(
    filtered.map((row) => row.source),
    currencyOptions
  ).map((group) => ({
    ...group,
    total:
      group.total !== null && Number.isFinite(group.total) ? group.total : null,
    residual:
      group.residual !== null && Number.isFinite(group.residual)
        ? group.residual
        : null,
  }))
  const currencies = [
    ...new Set(normalized.map((row) => row.currencyId).filter(Boolean)),
  ].map((id) => ({
    value: id,
    label:
      currencyOptions.find((currency) => currency.value === id)?.label ||
      currencyOptions.find((currency) => currency.value === id)?.code ||
      `Currency #${id}`,
  }))
  const change = (next: AccountingWorklistView) => {
    if (preferences) update({ ...preferences, current: next })
    engine.clearSelection()
  }
  const clear = () => {
    change({
      ...current,
      search: "",
      filters: { status: "", currencyId: "", queue: "" },
    })
    onInitialFilterClear?.("*")
  }
  const selectQueue = (queue: string) =>
    change({
      ...current,
      filters: {
        ...current.filters,
        status: "",
        queue: current.filters.queue === queue ? "" : queue,
      },
    })
  return (
    <div
      className="min-w-0 space-y-5"
      ref={worklistRef}
      data-testid={`accounting-${kind}-worklist`}
    >
      <KpiStrip
        tiles={[
          {
            key: "total",
            label: isBill
              ? t("accounting.bills.totalBills")
              : t("accounting.invoices.totalInvoices"),
            value: normalized.length,
            active: false,
          },
          ...(["paid", "pending", "overdue"] as const).map((key) => ({
            key,
            label: key === "pending" ? openLabel : statusLabels[key],
            value: normalized.filter((row) =>
              key === "pending"
                ? ["sent", "pending", "approved", "partial"].includes(
                    row.status
                  )
                : row.status === key
            ).length,
            active:
              key === "paid"
                ? current.filters.status === "paid"
                : current.filters.queue === key,
            onSelect: () =>
              key === "paid"
                ? change({
                    ...current,
                    filters: {
                      ...current.filters,
                      status: current.filters.status === "paid" ? "" : "paid",
                      queue: "",
                    },
                  })
                : selectQueue(key),
          })),
        ]}
      />
      <Card className="min-w-0">
        <CardHeader className="min-w-0 space-y-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <h2 className={workspaceStyles.sectionTitle}>{title}</h2>
            {canCreate && onCreate && (
              <Button className="min-h-11" onClick={onCreate}>
                {newLabel}
              </Button>
            )}
          </div>
          <AccountingWorklistToolbar
            value={current}
            onChange={change}
            saved={preferences.saved}
            onSave={(name) =>
              update({
                ...preferences,
                saved: saveAccountingWorklist(preferences.saved, name, current),
              })
            }
            onRemove={(name) =>
              update({
                ...preferences,
                saved: preferences.saved.filter((view) => view.name !== name),
              })
            }
            columns={columns}
            currencies={currencies}
            statuses={statuses}
            persistent={persistent}
            viewSettings={viewSettings}
            initialFilters={initialFilters}
            onInitialFilterClear={onInitialFilterClear}
            selectedCount={engine.selectedRows.length}
            onClearSelection={engine.clearSelection}
            onExport={canRead && filtered.length > 0 ? exportCsv : undefined}
          />
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <p className={workspaceStyles.sectionDescription}>
            {filtered.length}{" "}
            {t("accounting.worklists.matchingRecords", {
              defaultValue:
                "matching records · totals reflect the current filters, across all pages",
            })}
          </p>
          {filtered.length === 0 ? (
            <div className="min-w-0 [&_button]:min-h-11">
              <EmptyStateCard
                compact
                data-testid={
                  normalized.length === 0
                    ? "entity-empty-first-time"
                    : "entity-empty-no-results"
                }
                title={
                  normalized.length === 0
                    ? isBill
                      ? t("accounting.bills.emptyState.title", {
                          defaultValue: "No vendor bills yet",
                        })
                      : t("accounting.invoices.emptyState.title", {
                          defaultValue: "No invoices yet",
                        })
                    : t("common.entityView.noResults.title", {
                        defaultValue: "No matching records",
                      })
                }
                primaryAction={
                  normalized.length === 0
                    ? canCreate && onCreate
                      ? { label: newLabel, onClick: onCreate }
                      : undefined
                    : {
                        label: t("common.entityView.noResults.clear", {
                          defaultValue: "Clear filters",
                        }),
                        onClick: clear,
                      }
                }
              />
            </div>
          ) : (
            <div
              className="min-w-0 max-w-full"
              onClickCapture={(event) => {
                if (!(event.target instanceof Element)) return
                const row = event.target.closest<HTMLElement>("[data-record-return-id]")
                if (!row?.dataset.recordReturnId) return
                const anchor = event.target.closest("a[href]")
                const { ids, snapshot } = rememberSelection(row.dataset.recordReturnId, anchor ? "link" : "row")
                if (anchor) commitRecordListFor(anchor.getAttribute("href") ?? undefined, ids, snapshot)
              }}
            >
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <span className="sr-only">
                        {t("accounting.worklists.selection", {
                          defaultValue: "Export selection",
                        })}
                      </span>
                    </TableHead>
                    {visibleColumns.map((column) => (
                      <TableHead
                        key={column.key}
                        aria-sort={
                          engine.sortedBy?.id === column.key
                            ? engine.sortedBy.desc
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        <button
                          type="button"
                          className="min-h-11 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => engine.toggleSort(column.key)}
                        >
                          {column.label}
                          {engine.sortedBy?.id === column.key
                            ? engine.sortedBy.desc
                              ? " ↓"
                              : " ↑"
                            : ""}
                        </button>
                      </TableHead>
                    ))}
                    <TableHead className="w-12">
                      <span className="sr-only">
                        {t("accounting.worklists.actions", {
                          defaultValue: "Actions",
                        })}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {engine.pageRows.map((tableRow) => {
                    const row = tableRow.original as AccountingWorklistRow
                    const move = row.source
                    const canRecalculate =
                      canWrite &&
                      onRecalculateTotals &&
                      moveStateIsDraft(move.state) &&
                      moveTypeIsInvoiceOrRefund(move.moveType)
                    const canPay =
                      canWrite &&
                      isBill &&
                      onPay &&
                      row.status !== "unavailable" &&
                      stbEnumTag(move.state).toLowerCase() === "posted" &&
                      typeof move.amountResidual === "number" &&
                      Number.isFinite(move.amountResidual) &&
                      move.amountResidual > 0
                    return (
                      <TableRow
                        key={row.id}
                        data-testid={`entity-row-${row.id}`}
                        data-record-return-id={row.id}
                        data-state={
                          tableRow.getIsSelected() ? "selected" : undefined
                        }
                        className={onSelect ? "cursor-pointer" : undefined}
                        onClick={() => onSelect?.(move)}
                        onKeyDown={(event) => {
                          if (
                            event.target === event.currentTarget &&
                            onSelect &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault()
                            rememberSelection(row.id, "row")
                            onSelect(move)
                          }
                        }}
                        tabIndex={onSelect ? 0 : undefined}
                      >
                        <TableCell className="p-0">
                          <label
                            className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select ${row.name}`}
                              checked={tableRow.getIsSelected()}
                              onChange={tableRow.getToggleSelectedHandler()}
                              className="size-4 accent-primary"
                            />
                          </label>
                        </TableCell>
                        {visibleColumns.map((column) => (
                          <TableCell
                            key={column.key}
                            className={
                              column.key === "amountTotal" ||
                              column.key === "amountResidual"
                                ? "whitespace-nowrap tabular-nums"
                                : undefined
                            }
                          >
                            {column.key === "name" ? (
                              <a
                                className="inline-flex min-h-11 items-center rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                href={accountingDocumentHref(move)}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {row.name}
                              </a>
                            ) : column.key === "issueDate" ||
                              column.key === "dueDate" ? (
                              row[column.key] === undefined ? (
                                "—"
                              ) : (
                                new Date(row[column.key]!).toLocaleDateString(
                                  undefined,
                                  {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                    timeZone: "UTC",
                                  }
                                )
                              )
                            ) : column.key === "amountTotal" ||
                              column.key === "amountResidual" ? (
                              accountingListMoney(
                                row[column.key],
                                move,
                                currencyOptions
                              )
                            ) : column.key === "status" ? (
                              <Badge
                                className={
                                  row.status === "unavailable"
                                    ? undefined
                                    : accountingListStatusBadgeClass[row.status]
                                }
                              >
                                {statusLabels[row.status]}
                              </Badge>
                            ) : (
                              String(row[column.key] ?? "—")
                            )}
                          </TableCell>
                        ))}
                        <TableCell>
                          {(onSelect ||
                            canRecalculate ||
                            canPay ||
                            (canRead && (onSend || onDownload))) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                asChild
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-11 min-h-11 min-w-11"
                                  aria-label={`Actions for ${move.name || move.id}`}
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {onSelect && (
                                  <DropdownMenuItem
                                    className="min-h-11"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      rememberSelection(row.id, "row")
                                      onSelect(move)
                                    }}
                                  >
                                    {t(
                                      "accounting.invoices.invoiceActions.viewDetails"
                                    )}
                                  </DropdownMenuItem>
                                )}
                                {canRead && onSend && !isBill && (
                                  <DropdownMenuItem
                                    className="min-h-11"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onSend(move)
                                    }}
                                  >
                                    {t(
                                      "accounting.invoices.invoiceActions.send"
                                    )}
                                  </DropdownMenuItem>
                                )}
                                {canRead && onDownload && (
                                  <DropdownMenuItem
                                    className="min-h-11"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onDownload(move)
                                    }}
                                  >
                                    {t(
                                      "accounting.invoices.invoiceActions.downloadPDF"
                                    )}
                                  </DropdownMenuItem>
                                )}
                                {canRecalculate && (
                                  <DropdownMenuItem
                                    className="min-h-11"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onRecalculateTotals?.(move)
                                    }}
                                  >
                                    {isBill
                                      ? t(
                                          "accounting.bills.billActions.recalculateTotals"
                                        )
                                      : t(
                                          "accounting.invoices.invoiceActions.recalculateTotals"
                                        )}
                                  </DropdownMenuItem>
                                )}
                                {canPay && (
                                  <DropdownMenuItem
                                    className="min-h-11"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onPay?.(move)
                                    }}
                                  >
                                    {t("accounting.bills.billActions.payBill")}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {engine.pageCount > 1 && (
            <nav
              aria-label={t("accounting.worklists.pagination", {
                defaultValue: "Worklist pages",
              })}
              className="flex flex-wrap items-center justify-end gap-2"
            >
              <Button
                className="min-h-11"
                variant="outline"
                disabled={engine.currentPage === 1}
                onClick={() => engine.setPage(engine.currentPage - 1)}
              >
                {t("accounting.worklists.previous", {
                  defaultValue: "Previous",
                })}
              </Button>
              <span className="text-xs tabular-nums">
                {engine.currentPage} / {engine.pageCount}
              </span>
              <Button
                className="min-h-11"
                variant="outline"
                disabled={engine.currentPage === engine.pageCount}
                onClick={() => engine.setPage(engine.currentPage + 1)}
              >
                {t("common.next", { defaultValue: "Next" })}
              </Button>
            </nav>
          )}
          <section
            aria-label="Totals by currency"
            className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {summaries.map((group) => (
              <dl
                key={group.key}
                className={`${workspaceStyles.surface} min-w-0 space-y-2 p-3 text-sm`}
              >
                <dt className="font-medium [overflow-wrap:anywhere]">
                  {group.label}
                </dt>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-xs text-muted-foreground">
                    {t("accounting.invoices.total", { defaultValue: "Total" })}
                  </dt>
                  <dd className={workspaceStyles.metricValue}>
                    {group.total === null
                      ? "—"
                      : formatInvoiceMoney(group.total, group.currency)}
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-xs text-muted-foreground">
                    {t("accounting.invoices.balanceDue")}
                  </dt>
                  <dd className={workspaceStyles.metricValue}>
                    {group.residual === null
                      ? "—"
                      : formatInvoiceMoney(group.residual, group.currency)}
                  </dd>
                </div>
              </dl>
            ))}
          </section>
        </CardContent>
      </Card>
    </div>
  )
}

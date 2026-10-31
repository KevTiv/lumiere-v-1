"use client"

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import { useIdentityLabelMap } from "@lumiere/ui/hooks/use-identity-label-map"
import { resolveIdentityLabel } from "@lumiere/ui/lib/identity-label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiFetch } from "@/lib/api-fetch"
import {
  reviewedImportSource,
  type ReviewBatch,
  type ReviewDetail,
  type ReviewHistory,
  type ReviewRow,
  type ReviewedImportSource,
} from "./import-review-model"
import {
  validateProductReviewReferences,
  type ProductReviewReferences,
  type ProductReviewReference,
} from "./import-review-product-references"
import {
  confirmedReviewFields,
  reviewIssueGroups,
  undoReviewDecision,
  verifyBulkReviewReceipt,
  verifyReviewReceipt,
  type ReviewDecision,
} from "./import-review-uncertainty"
import { ImportReviewEditor, ReviewRequestError } from "./import-review-editor"
import { ImportReviewBulk } from "./import-review-bulk"

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init)
  const body = await response.json()
  if (!response.ok)
    throw new ReviewRequestError(
      typeof body.error === "string"
        ? body.error
        : "Source review is unavailable.",
      response.status < 500,
    )
  return body as T
}

async function loadProductReferences(
  companyId: number,
): Promise<ProductReviewReferences> {
  const [categories, uoms] = await Promise.all([
    request<{ data: ProductReviewReference[] }>(
      `/api/query/product-categories?companyId=${companyId}`,
    ),
    request<{ data: ProductReviewReference[] }>(
      `/api/query/uoms?companyId=${companyId}`,
    ),
  ])
  return { categories: categories.data, uoms: uoms.data }
}

export function ImportReviewWorkspace({
  organizationId,
  selectedId,
  onContinue,
  continuationBlock,
}: {
  organizationId: number
  selectedId?: string
  onContinue: (source: ReviewedImportSource) => void
  continuationBlock?: "busy" | "unresolved" | null
}) {
  const companyId = useOperatingCompanyId(organizationId)
  const { t } = useTranslation()
  if (!companyId) return <p>{t("settings.importReview.companyRequired")}</p>
  return (
    <ImportReviewPanel
      organizationId={organizationId}
      companyId={companyId}
      initialId={selectedId}
      onContinue={onContinue}
      continuationBlock={continuationBlock}
    />
  )
}

export function ImportReviewPanel(props: {
  organizationId: number
  companyId: number
  initialId?: string
  onContinue: (source: ReviewedImportSource) => void
  continuationBlock?: "busy" | "unresolved" | null
}) {
  const { identity } = useErpSession()
  const { t } = useTranslation()
  if (!identity) return <p>{t("common.loading")}</p>
  const actor = identity.replace(/^0x/, "").toLowerCase()
  return (
    <ReviewWorkspace
      key={`${actor}:${props.organizationId}:${props.companyId}:${props.initialId ?? ""}`}
      actor={actor}
      {...props}
    />
  )
}

function ReviewWorkspace({
  actor,
  organizationId,
  companyId,
  initialId,
  onContinue,
  continuationBlock,
}: {
  actor: string
  organizationId: number
  companyId: number
  initialId?: string
  onContinue: (source: ReviewedImportSource) => void
  continuationBlock?: "busy" | "unresolved" | null
}) {
  const { t } = useTranslation()
  const mounted = useRef(true)
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const requireCurrentScope = () => {
    if (!mounted.current)
      throw new ReviewRequestError(
        "The active review account or company changed. Reopen the saved review in the current scope.",
        true,
      )
  }
  const cache = useQueryClient()
  const identityLabels = useIdentityLabelMap(organizationId)
  const [selectedId, setSelectedId] = useState(initialId ?? "")
  const [selected, setSelected] = useState<ReviewRow | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [historyId, setHistoryId] = useState("")
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState("needs_review")
  const [group, setGroup] = useState("all")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const pendingUndo = useRef<{
    decision: ReviewDecision
    requestKey: string
  } | null>(null)
  const [uncertainUndo, setUncertainUndo] = useState(false)
  useEffect(() => {
    if (initialId) return
    const url = new URL(window.location.href)
    if (url.searchParams.get("sourceReviewCompany") === String(companyId))
      setSelectedId(url.searchParams.get("sourceReview") ?? "")
  }, [initialId, companyId])
  const listKey = ["import-reviews", organizationId, companyId, actor]
  const detailKey = [
    "import-review",
    organizationId,
    companyId,
    selectedId,
    actor,
  ]
  const list = useQuery({
    queryKey: listKey,
    queryFn: () =>
      request<{ data: ReviewBatch[] }>(
        `/api/import-reviews?companyId=${companyId}`,
      ),
    retry: false,
  })
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () =>
      request<ReviewDetail>(
        `/api/import-reviews/${selectedId}?companyId=${companyId}`,
      ),
    enabled: !!selectedId,
    retry: false,
  })
  const productReview = detail.data?.targetEntity === "product"
  const productReferenceQuery = {
    queryKey: [
      "import-review-product-references",
      organizationId,
      companyId,
      actor,
    ],
    queryFn: () => loadProductReferences(companyId),
    staleTime: 30_000,
  }
  const productReferences = useQuery({
    ...productReferenceQuery,
    enabled: productReview && (!!selected || checked.size > 0),
    retry: false,
  })
  const history = useInfiniteQuery({
    queryKey: [
      "import-review-history",
      organizationId,
      companyId,
      selectedId,
      historyId,
      actor,
    ],
    enabled: !!historyId,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      request<{ history: ReviewHistory[]; nextBeforeRevision: number | null }>(
        `/api/import-reviews/${selectedId}/items/${historyId}/history?companyId=${companyId}${pageParam ? `&beforeRevision=${pageParam}` : ""}`,
      ),
    getNextPageParam: (last) => last.nextBeforeRevision ?? undefined,
    retry: false,
  })
  const groups = useMemo(
    () => reviewIssueGroups(detail.data?.items ?? []),
    [detail.data],
  )
  const activeGroup = groups.find((entry) => entry.key === group)
  const matching = useMemo(
    () =>
      (detail.data?.items ?? []).filter(
        (item) =>
          (filter === "all" || item.state === filter) &&
          (group === "all" ||
            !activeGroup ||
            activeGroup.itemIds.includes(item.id)) &&
          `${item.source.label} ${item.source.source.file} ${item.source.issue}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
      ),
    [detail.data, filter, group, activeGroup, search],
  )
  const pages = Math.max(1, Math.ceil(matching.length / 50))
  const currentPage = Math.min(page, pages - 1)
  const visible = matching.slice(currentPage * 50, currentPage * 50 + 50)
  const unavailable = busy || locked || uncertainUndo
  const sourceLabel = (item: ReviewRow) =>
    `${item.source.source.file} · ${t(item.source.source.rowBasis === "import_row" ? "settings.importReview.importRow" : "settings.importReview.sourceLine", { row: item.source.source.row })}`
  const chooseBatch = (id: string) => {
    requireCurrentScope()
    setSelectedId(id)
    setSelected(null)
    setChecked(new Set())
    setHistoryId("")
    setError(null)
    setPage(0)
    setGroup("all")
    const url = new URL(window.location.href)
    url.searchParams.set("sourceReview", id)
    url.searchParams.set("sourceReviewCompany", String(companyId))
    window.history.replaceState(window.history.state, "", url)
  }
  const refresh = () => {
    requireCurrentScope()
    return Promise.all([
      cache.invalidateQueries({ queryKey: detailKey }),
      cache.invalidateQueries({ queryKey: listKey }),
      cache.invalidateQueries({
        queryKey: [
          "import-review-history",
          organizationId,
          companyId,
          selectedId,
        ],
      }),
    ])
  }
  const upload = async (file: File) => {
    requireCurrentScope()
    setBusy(true)
    setError(null)
    try {
      if (file.size > 4_000_000)
        throw new Error(t("settings.importReview.fileTooLarge"))
      const text = await file.text()
      requireCurrentScope()
      const dataset: unknown = JSON.parse(text)
      const result = await request<{ id: string }>("/api/import-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, dataset }),
      })
      requireCurrentScope()
      chooseBatch(result.id)
      await cache.invalidateQueries({ queryKey: listKey })
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const saveDecision = async (decision: ReviewDecision, requestKey: string) => {
    requireCurrentScope()
    const item = detail.data?.items.find((item) => item.id === decision.itemId)
    if (productReview && decision.state === "confirmed" && item) {
      try {
        validateProductReviewReferences(
          item,
          decision.values,
          await cache.fetchQuery(productReferenceQuery),
          organizationId,
        )
      } catch (failure) {
        throw new ReviewRequestError(
          failure instanceof Error ? failure.message : String(failure),
          true,
        )
      }
    }
    requireCurrentScope()
    const { itemId, ...body } = decision
    const receipt = await request<unknown>(
      `/api/import-reviews/${selectedId}/items/${itemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, ...body, requestKey }),
      },
    )
    requireCurrentScope()
    verifyReviewReceipt(receipt, decision)
    await refresh()
    requireCurrentScope()
  }
  const open = (item: ReviewRow) => {
    setSelected(item)
    setHistoryId(item.id)
    setChecked(new Set())
    setError(null)
  }
  const nextItem = selected
    ? matching[matching.findIndex((item) => item.id === selected.id) + 1]
    : undefined
  const save = async (
    decision: ReviewDecision,
    requestKey: string,
    next: boolean,
  ) => {
    await saveDecision(decision, requestKey)
    requireCurrentScope()
    const fresh = cache.getQueryData<ReviewDetail>(detailKey)
    const nextRow =
      next && nextItem
        ? (fresh?.items.find((item) => item.id === nextItem.id) ?? nextItem)
        : null
    setSelected(nextRow)
    setHistoryId(nextRow?.id ?? decision.itemId)
    if (nextRow)
      setPage(
        Math.floor(matching.findIndex((item) => item.id === nextRow.id) / 50),
      )
  }
  const saveBulk = async (decisions: ReviewDecision[], requestKey: string) => {
    requireCurrentScope()
    const receipt = await request<unknown>(
      `/api/import-reviews/${selectedId}/decisions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, requestKey, decisions }),
      },
    )
    requireCurrentScope()
    verifyBulkReviewReceipt(receipt, decisions)
    await refresh()
    requireCurrentScope()
  }
  const undo = async (entry?: ReviewHistory) => {
    setError(null)
    try {
      if (!pendingUndo.current && entry) {
        const item = detail.data?.items.find((item) => item.id === entry.itemId)
        if (!item) return
        pendingUndo.current = {
          decision: undoReviewDecision(item, entry),
          requestKey: crypto.randomUUID(),
        }
      }
      if (!pendingUndo.current) return
      setBusy(true)
      await saveDecision(
        pendingUndo.current.decision,
        pendingUndo.current.requestKey,
      )
      requireCurrentScope()
      pendingUndo.current = null
      setUncertainUndo(false)
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : String(failure))
      const unknown =
        !(failure instanceof ReviewRequestError) || !failure.definitive
      if (mounted.current) setUncertainUndo(unknown)
      if (!unknown) pendingUndo.current = null
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const confirmed =
    detail.data?.items.filter((item) => item.state === "confirmed").length ?? 0
  const continueImport = async () => {
    if (!detail.data || continuationBlock) return
    setBusy(true)
    setError(null)
    try {
      if (productReview) {
        const references = await cache.fetchQuery(productReferenceQuery)
        for (const item of detail.data.items.filter(
          (item) => item.state === "confirmed",
        ))
          validateProductReviewReferences(
            item,
            item.values,
            references,
            organizationId,
          )
      }
      requireCurrentScope()
      onContinue(reviewedImportSource(detail.data))
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const historyEntries = historyId
    ? (history.data?.pages.flatMap((page) => page.history) ?? [])
    : (detail.data?.history ?? [])
  return (
    <section
      className="flex min-w-0 flex-col gap-4"
      aria-label={t("settings.importReview.title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t("settings.importReview.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.importReview.description")}
          </p>
        </div>
        <FieldGroup className="max-w-xs">
          <Field>
            <FieldLabel htmlFor="source-review-upload">
              {t("settings.importReview.upload")}
            </FieldLabel>
            <Input
              id="source-review-upload"
              type="file"
              accept=".json,application/json"
              disabled={unavailable || !!selected}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void upload(file)
                event.target.value = ""
              }}
            />
          </Field>
        </FieldGroup>
      </div>
      {error || list.error || detail.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("settings.importReview.error")}</AlertTitle>
          <AlertDescription>
            {error ?? list.error?.message ?? detail.error?.message}
          </AlertDescription>
        </Alert>
      ) : null}
      {uncertainUndo ? (
        <div>
          <p>{t("settings.importReview.grouped.uncertainSave")}</p>
          <Button onClick={() => void undo()} disabled={busy}>
            {t("settings.importReview.grouped.retrySave")}
          </Button>
        </div>
      ) : null}
      {list.isPending ? <p>{t("common.loading")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {list.data?.data.map((batch) => (
          <Button
            key={batch.id}
            variant={selectedId === batch.id ? "secondary" : "outline"}
            disabled={unavailable || !!selected}
            onClick={() => chooseBatch(batch.id)}
            aria-pressed={selectedId === batch.id}
          >
            {batch.title} ({batch.pending}{" "}
            {t("settings.importReview.remaining")})
          </Button>
        ))}
      </div>
      {list.data?.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.importReview.empty")}
        </p>
      ) : null}
      {detail.data && !detail.error ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{detail.data.title}</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  !confirmed ||
                  unavailable ||
                  !!selected ||
                  !!continuationBlock ||
                  !["product", "stock_location"].includes(
                    detail.data.targetEntity,
                  )
                }
                onClick={() => void continueImport()}
              >
                {t("settings.importReview.continue", { count: confirmed })}
              </Button>
              <Button
                variant="outline"
                disabled={unavailable || !!selected}
                onClick={() => {
                  setError(null)
                  void refresh()
                }}
              >
                {t("common.refresh")}
              </Button>
            </div>
          </div>
          {continuationBlock ? (
            <p role="status" data-testid="import-review-handoff-status">
              {continuationBlock === "busy"
                ? t("common.formSubmit.busy")
                : t("settings.importReview.resolveCurrent", {
                    defaultValue:
                      "Check the current import result before loading another source.",
                  })}
            </p>
          ) : null}
          {!["product", "stock_location"].includes(detail.data.targetEntity) ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.importReview.moduleSpecific")}
            </p>
          ) : null}
          <p className="text-sm" role="status">
            {t("settings.importReview.grouped.summary", {
              rows: detail.data.items.length,
              unresolved: detail.data.items.filter(
                (item) => item.state === "needs_review",
              ).length,
              confirmed,
              excluded: detail.data.items.filter(
                (item) => item.state === "excluded",
              ).length,
            })}
          </p>
          <div
            className="flex flex-wrap gap-2"
            aria-label={t("settings.importReview.filterLabel")}
          >
            {(["needs_review", "confirmed", "excluded", "all"] as const).map(
              (state) => (
                <Button
                  key={state}
                  size="sm"
                  variant={filter === state ? "secondary" : "outline"}
                  aria-pressed={filter === state}
                  disabled={unavailable || !!selected}
                  onClick={() => {
                    setFilter(state)
                    setGroup("all")
                    setPage(0)
                  }}
                >
                  {t(`settings.importReview.filter.${state}`)}
                </Button>
              ),
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="review-search">
                {t("settings.importReview.search")}
              </FieldLabel>
              <Input
                id="review-search"
                type="search"
                value={search}
                disabled={unavailable || !!selected}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(0)
                }}
              />
            </Field>
            <Field>
              <FieldLabel>
                {t("settings.importReview.grouped.issueGroup")}
              </FieldLabel>
              <Select
                value={activeGroup ? group : "all"}
                onValueChange={(value) => {
                  setGroup(value)
                  setPage(0)
                  setChecked(new Set())
                }}
                disabled={unavailable || !!selected}
              >
                <SelectTrigger
                  aria-label={t("settings.importReview.grouped.issueGroup")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("settings.importReview.grouped.allIssues")}
                  </SelectItem>
                  {groups.map((entry) => (
                    <SelectItem key={entry.key} value={entry.key}>
                      {entry.label} ({entry.itemIds.length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={unavailable || !!selected || !matching.length}
              onClick={() =>
                setChecked(new Set(matching.map((item) => item.id)))
              }
            >
              {t("settings.importReview.grouped.selectMatching", {
                count: matching.length,
              })}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={unavailable || !checked.size}
              onClick={() => setChecked(new Set())}
            >
              {t("settings.importReview.grouped.clearSelection")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t("settings.importReview.grouped.page", {
                page: currentPage + 1,
                pages,
              })}
            </span>
          </div>
          {checked.size ? (
            <ImportReviewBulk
              key={`${selectedId}:${activeGroup?.fieldKey ?? ""}`}
              items={detail.data.items}
              selectedIds={checked}
              initialField={activeGroup?.fieldKey}
              product={productReview}
              organizationId={organizationId}
              references={productReferences.data}
              onSave={saveBulk}
              onClear={() => setChecked(new Set())}
              onLockChange={setLocked}
            />
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox
                    aria-label={t("settings.importReview.grouped.selectPage")}
                    disabled={unavailable || !!selected || !visible.length}
                    checked={
                      !!visible.length &&
                      visible.every((item) => checked.has(item.id))
                    }
                    onCheckedChange={(checked) =>
                      setChecked((current) => {
                        const next = new Set(current)
                        for (const item of visible) {
                          if (checked) next.add(item.id)
                          else next.delete(item.id)
                        }
                        return next
                      })
                    }
                  />
                </TableHead>
                <TableHead>{t("settings.importReview.item")}</TableHead>
                <TableHead>{t("settings.importReview.source")}</TableHead>
                <TableHead>{t("settings.importReview.question")}</TableHead>
                <TableHead>{t("settings.importReview.status")}</TableHead>
                <TableHead>{t("settings.importReview.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => (
                <Fragment key={item.id}>
                  <TableRow>
                    <TableCell>
                      <Checkbox
                        aria-label={t(
                          "settings.importReview.grouped.selectItem",
                          {
                            name: item.source.label,
                            row: item.source.source.row,
                          },
                        )}
                        disabled={unavailable || !!selected}
                        checked={checked.has(item.id)}
                        onCheckedChange={(value) =>
                          setChecked((current) => {
                            const next = new Set(current)
                            if (value) next.add(item.id)
                            else next.delete(item.id)
                            return next
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>{item.source.label}</TableCell>
                    <TableCell>{sourceLabel(item)}</TableCell>
                    <TableCell className="max-w-sm whitespace-normal">
                      {item.source.issue}
                    </TableCell>
                    <TableCell>
                      {t(`settings.importReview.filter.${item.state}`)}
                      {confirmedReviewFields(item).length ? (
                        <p className="text-xs text-muted-foreground">
                          {t("settings.importReview.grouped.fieldsConfirmed", {
                            count: confirmedReviewFields(item).length,
                          })}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          unavailable || (!!selected && selected.id !== item.id)
                        }
                        onClick={() => open(item)}
                      >
                        {t("settings.importReview.correct")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={unavailable || !!selected}
                        onClick={() => setHistoryId(item.id)}
                      >
                        {t("settings.importReview.grouped.historyAction")}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {selected?.id === item.id ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <ImportReviewEditor
                          key={`${selected.id}:${selected.revision}`}
                          item={selected}
                          product={productReview}
                          organizationId={organizationId}
                          references={productReferences.data}
                          referenceError={productReferences.error?.message}
                          hasNext={!!nextItem}
                          onNext={() => {
                            if (nextItem) {
                              open(nextItem)
                              setPage(
                                Math.floor(
                                  matching.findIndex(
                                    (item) => item.id === nextItem.id,
                                  ) / 50,
                                ),
                              )
                            }
                          }}
                          onSave={save}
                          onClose={() => setSelected(null)}
                          onLockChange={setLocked}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={unavailable || !!selected || currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {t("settings.importReview.grouped.previousPage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={unavailable || !!selected || currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              {t("settings.importReview.grouped.nextPage")}
            </Button>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              {historyId
                ? t("settings.importReview.grouped.itemHistory")
                : t("settings.importReview.history")}
            </summary>
            {history.error ? <p role="alert">{history.error.message}</p> : null}
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {historyEntries.map((entry) => {
                const item = detail.data.items.find(
                  (item) => item.id === entry.itemId,
                )
                return (
                  <li
                    className="flex flex-wrap items-center gap-2"
                    key={`${entry.itemId}:${entry.revision}`}
                  >
                    <span>
                      {item?.source.label} · {entry.createdAt} ·{" "}
                      {resolveIdentityLabel(entry.actor, identityLabels)} ·{" "}
                      {entry.reason}
                    </span>
                    {item &&
                    entry.previousValues &&
                    item.revision === entry.revision ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={unavailable || !!selected}
                        onClick={() => void undo(entry)}
                      >
                        {t("settings.importReview.grouped.undo")}
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            {historyId && history.hasNextPage ? (
              <Button
                variant="outline"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {t("settings.importReview.grouped.olderHistory")}
              </Button>
            ) : null}
          </details>
        </>
      ) : null}
    </section>
  )
}

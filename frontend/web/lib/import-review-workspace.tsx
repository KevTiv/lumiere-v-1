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
import { FileUploadField } from "@lumiere/ui/components/file-upload-field"
import { Field, FieldLabel } from "@/components/ui/field"
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
import { ImportReviewDecisionSummary } from "./import-review-decision-summary"
import { resetHistoryQueries } from "./history-data"
import { sourceHistoryLink } from "./source-observation"
import { exactSourceReviewRevision, pinnedSourceReview, sourceReviewBeforeRevision, type PinnedSourceReview } from "@lumiere/query-hooks/hooks/source-review-navigation"

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
  allowImport = true,
  allowedReviewIds,
  allowUpload = true,
  syncUrl = true,
  onSelectedIdChange,
  onChanged,
}: {
  organizationId: number
  selectedId?: string
  onContinue: (source: ReviewedImportSource) => void
  continuationBlock?: "busy" | "unresolved" | null
  allowImport?: boolean
  allowedReviewIds?: readonly string[]
  allowUpload?: boolean
  syncUrl?: boolean
  onSelectedIdChange?: (id: string) => void
  onChanged?: () => void
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
      allowImport={allowImport}
      allowedReviewIds={allowedReviewIds}
      allowUpload={allowUpload}
      syncUrl={syncUrl}
      onSelectedIdChange={onSelectedIdChange}
      onChanged={onChanged}
    />
  )
}

export function ImportReviewPanel(props: {
  organizationId: number
  companyId: number
  initialId?: string
  onContinue: (source: ReviewedImportSource) => void
  continuationBlock?: "busy" | "unresolved" | null
  allowImport?: boolean
  allowedReviewIds?: readonly string[]
  allowUpload?: boolean
  syncUrl?: boolean
  onSelectedIdChange?: (id: string) => void
  onChanged?: () => void
}) {
  const { identity } = useErpSession()
  const { t } = useTranslation()
  if (!identity) return <p>{t("common.loading")}</p>
  const actor = identity.replace(/^0x/, "").toLowerCase()
  return (
    <ReviewWorkspace
      key={`${actor}:${props.organizationId}:${props.companyId}:${props.initialId ?? ""}:${props.allowImport ?? true}`}
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
  allowImport = true,
  allowedReviewIds,
  allowUpload = true,
  syncUrl = true,
  onSelectedIdChange,
  onChanged,
}: {
  actor: string
  organizationId: number
  companyId: number
  initialId?: string
  onContinue: (source: ReviewedImportSource) => void
  continuationBlock?: "busy" | "unresolved" | null
  allowImport?: boolean
  allowedReviewIds?: readonly string[]
  allowUpload?: boolean
  syncUrl?: boolean
  onSelectedIdChange?: (id: string) => void
  onChanged?: () => void
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
  const [selectedId, setSelectedId] = useState(initialId && (!allowedReviewIds || allowedReviewIds.includes(initialId)) ? initialId : "")
  const [selected, setSelected] = useState<ReviewRow | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [historyId, setHistoryId] = useState("")
  const [pinnedReview, setPinnedReview] = useState<PinnedSourceReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const validatedBulkRequest = useRef<string | null>(null)
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
    if (!syncUrl) return
    const url = new URL(window.location.href)
    const pinned = pinnedSourceReview(url.search, String(companyId))
    if (pinned && (!initialId || initialId === pinned.batchId) && (!allowedReviewIds || allowedReviewIds.includes(pinned.batchId))) {
      setSelectedId(pinned.batchId)
      setHistoryId(pinned.itemId)
      setPinnedReview(pinned)
      return
    }
    if (initialId) return
    const linkedId = url.searchParams.get("sourceReview") ?? ""
    if (url.searchParams.get("sourceReviewCompany") === String(companyId) && (!allowedReviewIds || allowedReviewIds.includes(linkedId)))
      setSelectedId(linkedId)
  }, [initialId, companyId, allowedReviewIds, syncUrl])
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
    enabled: !!selectedId && (!allowedReviewIds || allowedReviewIds.includes(selectedId)),
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
      pinnedReview?.revision,
      actor,
    ],
    enabled: !!historyId,
    initialPageParam: sourceReviewBeforeRevision(pinnedReview),
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
    if (allowedReviewIds && !allowedReviewIds.includes(id)) return
    setSelectedId(id)
    onSelectedIdChange?.(id)
    setSelected(null)
    setChecked(new Set())
    setHistoryId("")
    setPinnedReview(null)
    setError(null)
    setPage(0)
    setGroup("all")
    if (!syncUrl) return
    const url = new URL(window.location.href)
    url.searchParams.set("sourceReview", id)
    url.searchParams.set("sourceReviewCompany", String(companyId))
    url.searchParams.delete("sourceReviewItem")
    url.searchParams.delete("sourceReviewRevision")
    window.history.replaceState(window.history.state, "", url)
  }
  const refresh = () => {
    requireCurrentScope()
    return Promise.all([
      resetHistoryQueries(cache, { organizationId, companyId, actorIdentity: actor }),
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
    ]).then(() => { requireCurrentScope(); onChanged?.() })
  }
  const upload = async (file: File) => {
    requireCurrentScope()
    if (!allowUpload) return
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
      await Promise.all([
        cache.invalidateQueries({ queryKey: listKey }),
        resetHistoryQueries(cache, { organizationId, companyId, actorIdentity: actor }),
      ])
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
    setPinnedReview(null)
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
    if (
      productReview &&
      validatedBulkRequest.current !== requestKey &&
      decisions.some((decision) => decision.state === "confirmed")
    ) {
      try {
        const references = await cache.fetchQuery(productReferenceQuery)
        requireCurrentScope()
        for (const decision of decisions) {
          if (decision.state !== "confirmed") continue
          const item = detail.data?.items.find((item) => item.id === decision.itemId)
          if (!item)
            throw new Error("Reload the saved review before confirming these rows.")
          validateProductReviewReferences(
            item,
            decision.values,
            references,
            organizationId,
          )
        }
        // A retry reconciles the exact prior submission. Changed lookup data
        // must not discard its request key after an unknown write outcome.
        validatedBulkRequest.current = requestKey
      } catch (failure) {
        throw new ReviewRequestError(
          failure instanceof Error ? failure.message : String(failure),
          true,
        )
      }
    }
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
  const confirmedRows =
    detail.data?.items.filter((item) => item.state === "confirmed") ?? []
  const confirmed = confirmedRows.length
  const canPrepareImport = ["product", "stock_location", "contact"].includes(
    detail.data?.targetEntity ?? "",
  )
  const continueImport = async () => {
    if (!allowImport || !canPrepareImport || !confirmed || continuationBlock)
      return
    const confirmedRevisions = new Map(
      confirmedRows.map((item) => [item.id, item.revision]),
    )
    setBusy(true)
    setError(null)
    try {
      const fresh = (await detail.refetch({ throwOnError: true })).data
      requireCurrentScope()
      const rows = fresh?.items.filter((item) => item.state === "confirmed")
      if (
        !fresh ||
        !rows ||
        rows.length !== confirmedRevisions.size ||
        rows.some((item) => confirmedRevisions.get(item.id) !== item.revision)
      )
        throw new Error(t("settings.importReview.decisionSummary.changed"))
      if (productReview) {
        const references = await cache.fetchQuery(productReferenceQuery)
        for (const item of rows)
          validateProductReviewReferences(
            item,
            item.values,
            references,
            organizationId,
          )
      }
      requireCurrentScope()
      onContinue(reviewedImportSource(fresh))
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const loadedHistoryEntries = history.error ? [] : historyId
    ? (history.data?.pages.flatMap((page) => page.history) ?? [])
    : (detail.data?.history ?? [])
  const pinnedEntry = pinnedReview ? exactSourceReviewRevision(loadedHistoryEntries, pinnedReview) : undefined
  const historyEntries = pinnedReview ? (pinnedEntry ? [pinnedEntry] : []) : loadedHistoryEntries
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
        {allowUpload ? (
          <FileUploadField
            id="source-review-upload"
            accept=".json,application/json"
            chooseLabel={t("settings.importReview.upload")}
            disabled={unavailable || !!selected}
            onSelect={([file]) => { if (file) void upload(file) }}
          />
        ) : null}
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
        {list.data?.data.filter(batch => !allowedReviewIds || allowedReviewIds.includes(batch.id)).map((batch) => (
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
      {list.data?.data.filter(batch => !allowedReviewIds || allowedReviewIds.includes(batch.id)).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.importReview.empty")}
        </p>
      ) : null}
      {detail.data && !detail.error ? (
        <>
          {pinnedReview && <p role="status" className="rounded-lg border p-3 text-sm">{t("businessHistory.pinnedReview", { revision: pinnedReview.revision })} <a className="underline underline-offset-4" href="#source-review-history">{t("businessHistory.openSourceReview")}</a></p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{detail.data.title}</h3>
            <div className="flex flex-wrap gap-2">
              {allowImport ? <Button
                variant="outline"
                disabled={
                  !confirmed ||
                  unavailable ||
                  !!selected ||
                  !!continuationBlock ||
                  !canPrepareImport
                }
                onClick={() => void continueImport()}
              >
                {t("settings.importReview.continue", { count: confirmed })}
              </Button> : null}
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
          {allowImport && continuationBlock ? (
            <p role="status" data-testid="import-review-handoff-status">
              {continuationBlock === "busy"
                ? t("common.formSubmit.busy")
                : t("settings.importReview.resolveCurrent", {
                    defaultValue:
                      "Check the current import result before loading another source.",
                  })}
            </p>
          ) : null}
          <ImportReviewDecisionSummary
            detail={detail.data}
            organizationId={organizationId}
            companyId={companyId}
            canPrepareImport={canPrepareImport}
            allowImport={allowImport}
          />
          {allowImport && !canPrepareImport && !selected && !unavailable ? (
            <a
              className="text-sm font-medium underline underline-offset-4"
              href={sourceHistoryLink(companyId, detail.data.id)}
            >
              {t("settings.importReview.viewHistoricalFacts", { defaultValue: "View confirmed historical facts" })}
            </a>
          ) : null}
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
                    setChecked(new Set())
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
                  setChecked(new Set())
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
          {!matching.length ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.importReview.decisionSummary.noMatches")}
            </p>
          ) : null}
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
                        onClick={() => { setPinnedReview(null); setHistoryId(item.id) }}
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
          <details id="source-review-history" open={pinnedReview ? true : undefined}>
            <summary className="cursor-pointer text-sm font-medium">
              {historyId
                ? t("settings.importReview.grouped.itemHistory")
                : t("settings.importReview.history")}
            </summary>
            {history.error ? <p role="alert">{history.error.message}</p> : null}
            {pinnedReview && history.isPending ? <p role="status">{t("businessHistory.savedReviewLoading")}</p> : null}
            {pinnedReview && !history.isPending && !history.error && !pinnedEntry ? <p role="status">{t("businessHistory.savedReviewUnavailable")}</p> : null}
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
                      {pinnedReview ? `${t("businessHistory.reviewReference", { item: entry.itemId, revision: entry.revision })} · ` : ""}
                      {item?.source.label} · {entry.createdAt} ·{" "}
                      {resolveIdentityLabel(entry.actor, identityLabels)} ·{" "}
                      {entry.reason}
                    </span>
                    {pinnedReview && <dl className="w-full space-y-2 rounded border p-3">{Object.entries(entry.values).map(([field, value]) => <div key={field} className="grid min-w-0 gap-1 sm:grid-cols-2"><dt className="break-words text-muted-foreground">{item?.source.fields.find((sourceField) => sourceField.key === field)?.label ?? field}</dt><dd className="whitespace-pre-wrap break-all">{value === null ? t("recordChanges.noValue") : value === "" ? t("recordChanges.emptyText") : value}</dd></div>)}</dl>}
                    {!pinnedReview && item &&
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
            {!pinnedReview && historyId && history.hasNextPage ? (
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

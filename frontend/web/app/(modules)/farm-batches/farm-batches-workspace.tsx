"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { useErpAiSelectionReporter } from "@lumiere/query-hooks/erp-ai-selection-context"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { DashboardHeader, RecordPage } from "@lumiere/ui"
import { useAssistantNativeForms } from "@lumiere/ui/components/assistant-native-form-provider"
import { Button } from "@lumiere/ui/components/button"
import { Skeleton } from "@lumiere/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@lumiere/ui/components/table"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { workspaceStyles } from "@lumiere/ui/lib/workspace-styles"
import { Plus, Upload } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { farmPageCursors, farmPageHref } from "./farm-pagination"
import { FarmNativeLinks } from "./farm-native-links"
import { FarmMetricsView } from "./farm-metric-view"
import { FarmEventHistory } from "./farm-event-history"
import { farmEventPrefill, type FarmPrefill } from "./farm-assistant-prefill"
import { CreateFarmBatchForm, FarmEventForm, FarmField, fieldValue } from "./farm-forms"
import {
  eventSummary,
  farmApiPath,
  farmBatchPath,
  farmDate,
  farmDateLabel,
  farmDetailViews,
  farmEventLabels,
  farmImportHref,
  farmRecordId,
  farmRequest,
  farmResponse,
  selectedFarmEventKind,
  selectedFarmView,
  type FarmBatch,
  type FarmBatchDetail,
  type FarmDetailView,
  type FarmEvent,
  type FarmEventKind,
} from "./farm-batch-model"

const views = {
  overview: "farmBatches.events",
  processing: "farmBatches.processing",
  costs: "farmBatches.costs",
  metrics: "farmBatches.metrics",
  history: "farmBatches.historySources",
} as const satisfies Record<FarmDetailView, string>
const linkClass = "font-medium text-primary underline-offset-4 hover:underline"

export function FarmBatchesWorkspace({
  organizationId,
  batchId,
}: {
  organizationId?: number
  batchId?: string
}) {
  const { identity, activeCompanyReady } = useErpSession()
  const company = useOperatingCompanyId(organizationId)
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  if (!activeCompanyReady) return <FarmLoading />
  if (company == null)
    return <FarmNotice message={t("farmBatches.selectAnOperatingCompanyToViewIts")} />
  const companyId = String(company)
  const listScope = JSON.stringify([organizationId, companyId])
  const scopeKey = JSON.stringify([identity, organizationId, companyId])
  return batchId ? (
    <FarmDetail
      key={`${scopeKey}:${batchId}`}
      listScope={listScope}
      scopeKey={scopeKey}
      companyId={companyId}
      batchId={batchId}
      locale={locale}
    />
  ) : (
    <FarmList key={scopeKey} listScope={listScope} scopeKey={scopeKey} companyId={companyId} locale={locale} />
  )
}

function FarmLoading() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t("farmBatches.loadingFarmBatches")} className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-36 w-full" />
    </div>
  )
}

function FarmNotice({ message, retry }: { message: string; retry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="status" className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
      <p>{message}</p>
      {retry && (
        <Button size="sm" variant="outline" onClick={retry}>
          {t("farmBatches.tryAgain")}
        </Button>
      )}
    </div>
  )
}

function ImportLink({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="outline"
      render={<Link href={farmImportHref(companyId)} />}
      nativeButton={false}
    >
      <Upload className="size-4" /> {t("farmBatches.importCSVOrExcel")}
    </Button>
  )
}

function FarmList({
  listScope,
  scopeKey,
  companyId,
  locale,
}: {
  listScope: string
  scopeKey: string
  companyId: string
  locale: string
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const forms = useAssistantNativeForms()
  const queryClient = useQueryClient()
  const { checkPermission, permissionsReady } = useRBAC()
  const canRead = permissionsReady !== false && checkPermission("farm_batch", "read").allowed
  const canCreate = canRead && checkPermission("farm_batch", "create").allowed
  const cursors = farmPageCursors(searchParams, listScope)
  const beforeId = cursors.at(-1)
  const title = t("farmBatches.farmBatches")
  const listHref = farmPageHref(listScope, cursors)
  const detailHref = (id: string) => farmPageHref(listScope, cursors, `${farmBatchPath}/${id}`)
  const query = useQuery({
    queryKey: ["farm-batches", scopeKey, beforeId],
    queryFn: ({ signal }) =>
      farmResponse<{ data: FarmBatch[]; nextBeforeId: string | null }>(
        farmApiPath(companyId, "", beforeId ? { beforeId } : undefined),
        { signal },
      ),
    retry: false,
    enabled: canRead,
  })
  const [manualForm, setManualForm] = useState(false)
  const openFromUrl = searchParams.get("form") === "new-batch"
  const showForm = canCreate && query.isSuccess && (manualForm || openFromUrl)
  useEffect(() => {
    const pending = forms?.pending
    if (
      !pending ||
      pending.moduleId !== "farm-batches" ||
      pending.tabId !== "batches" ||
      !openFromUrl ||
      permissionsReady === false
    )
      return
    if (!forms.isCurrent(pending.requestId)) {
      forms.settle(pending.requestId, "unavailable")
      return
    }
    if (!canCreate) {
      forms.settle(pending.requestId, "denied")
      return
    }
    if (query.isPending) return
    forms.settle(pending.requestId, query.isError ? "unavailable" : "opened")
  }, [forms, openFromUrl, permissionsReady, canCreate, query.isPending, query.isError])

  function closeForm() {
    setManualForm(false)
    if (openFromUrl) router.replace(listHref, { scroll: false })
  }

  return (
    <section className="min-w-0 space-y-5" data-testid="farm-batches-workspace">
      <DashboardHeader
        title={title}
        description={t("farmBatches.trackAnimalsGrowthProcessingAndFarmCosts")}
        primaryAction={
          canCreate && query.isSuccess ? (
            <Button onClick={() => setManualForm(true)}>
              <Plus className="size-4" /> {t("farmBatches.newBatch")}
            </Button>
          ) : undefined
        }
        secondaryAction={canCreate && query.isSuccess ? <ImportLink companyId={companyId} /> : undefined}
      />
      {permissionsReady === false || (canRead && query.isPending) ? (
        <FarmLoading />
      ) : !canRead ? (
        <FarmNotice message={t("farmBatches.yourRoleDoesNotHaveAccessTo")} />
      ) : query.isError ? (
        <FarmNotice message={t("farmBatches.loadBatchListFailed")} retry={() => void query.refetch()} />
      ) : query.data?.data.length ? (
        <div className={workspaceStyles.surface}>
          <Table viewportLabel={title}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("farmBatches.batchReference")}</TableHead>
                <TableHead>{t("farmBatches.species")}</TableHead>
                <TableHead>{t("farmBatches.farmOrHouse")}</TableHead>
                <TableHead>{t("farmBatches.startDate")}</TableHead>
                <TableHead className="text-right">{t("farmBatches.liveHeadcount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.data.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="max-w-60 whitespace-normal wrap-anywhere">
                    <Link className={linkClass} href={detailHref(batch.id)}>
                      {batch.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-40 whitespace-normal wrap-anywhere">
                    {batch.species}
                  </TableCell>
                  <TableCell className="max-w-52 whitespace-normal wrap-anywhere">
                    {batch.location}
                  </TableCell>
                  <TableCell>{farmDateLabel(batch.startDate, locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {batch.liveHeadcount.toLocaleString(locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <FarmNotice
          message={
            canCreate
              ? t("farmBatches.createABatchOrImportFarmRecords")
              : t("farmBatches.thisOperatingCompanyHasNoFarmBatches")
          }
        />
      )}
      {(beforeId || query.data?.nextBeforeId) && (
        <nav aria-label={t("farmBatches.farmBatchPages")} className="flex flex-wrap gap-2">
          {beforeId && (
            <Button type="button" size="sm" variant="outline" onClick={() => router.push(farmBatchPath, { scroll: false })}>
              {t("farmBatches.firstPage")}
            </Button>
          )}
          {beforeId && (
            <Button type="button" size="sm" variant="outline"
              onClick={() => router.push(farmPageHref(listScope, cursors.slice(0, -1)), { scroll: false })}
            >
              {t("farmBatches.previousPage")}
            </Button>
          )}
          {query.data?.nextBeforeId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const next = query.data?.nextBeforeId
                if (next) router.push(farmPageHref(listScope, [...cursors, next]), { scroll: false })
              }}
            >
              {t("farmBatches.nextPage")}
            </Button>
          )}
        </nav>
      )}
      {showForm && (
        <CreateFarmBatchForm
          companyId={companyId}
          onClose={closeForm}
          onSaved={(batch) => {
            setManualForm(false)
            void queryClient.invalidateQueries({ queryKey: ["farm-batches", scopeKey] })
            if (farmRecordId(batch.id)) router.push(detailHref(batch.id))
            else closeForm()
          }}
        />
      )}
    </section>
  )
}

type FormChoice = {
  initialKind: FarmEventKind
  existing?: FarmEvent
  prefill?: FarmPrefill
  requestId?: string
}

function FarmDetail({
  listScope,
  scopeKey,
  companyId,
  batchId,
  locale,
}: {
  listScope: string
  scopeKey: string
  companyId: string
  batchId: string
  locale: string
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const forms = useAssistantNativeForms()
  const reporter = useErpAiSelectionReporter()
  const queryClient = useQueryClient()
  const { checkPermission, permissionsReady } = useRBAC()
  const canRead = permissionsReady !== false && checkPermission("farm_batch", "read").allowed
  const canWrite = canRead && checkPermission("farm_batch", "write").allowed
  const [manualForm, setManualForm] = useState<FormChoice | null>(null)
  const openFromUrl = searchParams.get("form") === "new-event"
  const eventKind = selectedFarmEventKind(searchParams.get("eventKind"))
  const pending = forms?.pending
  const assistantFormPending =
    pending?.moduleId === "farm-batches" &&
    pending.tabId === "event" &&
    pending.targetRecordId === batchId
  const form = manualForm ?? (openFromUrl && !assistantFormPending ? { initialKind: eventKind } : null)
  const listHref = farmPageHref(listScope, farmPageCursors(searchParams, listScope))
  const asOf = farmDate(searchParams.get("asOf"))
  const view = selectedFarmView(searchParams.get("view"))
  const query = useQuery({
    queryKey: ["farm-batch", scopeKey, batchId, asOf],
    queryFn: ({ signal }) =>
      farmRequest<FarmBatchDetail>(farmApiPath(companyId, `/${batchId}`, asOf ? { asOf } : undefined), {
        signal,
      }),
    retry: false,
    enabled: canRead,
  })
  const batch = query.data
  const reference = batch?.reference
  useEffect(() => {
    if (!forms || !pending || !assistantFormPending || !openFromUrl || permissionsReady === false)
      return
    if (!forms.isCurrent(pending.requestId)) {
      forms.settle(pending.requestId, "unavailable")
      return
    }
    if (!canWrite) {
      forms.settle(pending.requestId, "denied")
      return
    }
    if (query.isPending) return
    if (query.isError || !batch) {
      forms.settle(pending.requestId, "unavailable")
      return
    }
    if (manualForm) {
      forms.settle(pending.requestId, "busy")
      return
    }
    setManualForm({
      initialKind: eventKind,
      prefill: farmEventPrefill(eventKind, pending.prompt ?? ""),
      requestId: pending.requestId,
    })
    forms.settle(pending.requestId, "opened")
  }, [
    forms,
    pending,
    assistantFormPending,
    openFromUrl,
    permissionsReady,
    canWrite,
    query.isPending,
    query.isError,
    batch,
    manualForm,
    eventKind,
  ])
  useEffect(() => {
    if (!reporter || !reference || !canRead) return
    reporter.setSelection({
      activeTab: view,
      entityType: "farm_batch",
      entityId: batchId,
      selectionSummary: reference,
    })
    return () => reporter.clearSelection()
  }, [batchId, reference, canRead, reporter, view])

  function setParams(update: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(update)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const query = params.toString()
    router.replace(`${farmBatchPath}/${batchId}${query ? `?${query}` : ""}`, { scroll: false })
  }

  function closeForm() {
    setManualForm(null)
    if (openFromUrl) setParams({ form: undefined, eventKind: undefined })
  }

  if (permissionsReady === false || (canRead && query.isPending)) return <FarmLoading />
  if (!canRead) return <FarmNotice message={t("farmBatches.yourRoleDoesNotHaveAccessTo")} />
  if (query.isError || !batch) {
    return (
      <div className="space-y-4">
        <Link className={linkClass} href={listHref}>
          {t("farmBatches.backToFarmBatches")}
        </Link>
        <FarmNotice
          message={t("farmBatches.thisFarmBatchIsUnavailable")}
          retry={() => void query.refetch()}
        />
      </div>
    )
  }
  const onCorrect = canWrite
    ? (existing: FarmEvent) => setManualForm({ initialKind: existing.kind, existing })
    : undefined
  const events = batch.events.filter((event) => !asOf || event.businessDate <= asOf)
  return (
    <>
      <RecordPage
        breadcrumbs={[{ label: t("farmBatches.farmBatches"), href: listHref }, { label: batch.reference }]}
        title={batch.reference}
        subtitle={`${batch.species} · ${batch.location} · ${t("farmBatches.started", { date: farmDateLabel(batch.startDate, locale) })}`}
        testIdPrefix="farm-batch"
        activeTab={view}
        onTabChange={(target) => setParams({ view: target === "overview" ? undefined : target })}
        actions={
          canWrite ? (
            <Button
              onClick={() =>
                setManualForm({ initialKind: view === "processing" ? "processing" : "intake" })
              }
            >
              <Plus className="size-4" /> {t("farmBatches.recordEvent")}
            </Button>
          ) : undefined
        }
        guidance={
          <div className="flex flex-wrap items-end justify-between gap-4">
            <p className="text-sm">
              <span className={workspaceStyles.metricValue}>
                {batch.liveHeadcount.toLocaleString(locale)}
              </span>{" "}
              {t("farmBatches.liveAsOf")} {farmDateLabel(batch.asOf, locale)}
            </p>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                setParams({ asOf: farmDate(fieldValue(new FormData(event.currentTarget), "asOf")) })
              }}
            >
              <FarmField
                key={batch.asOf}
                label={t("farmBatches.asOf")}
                name="asOf"
                type="date"
                defaultValue={batch.asOf}
              />
              <Button size="sm" variant="outline" type="submit">
                {t("farmBatches.apply")}
              </Button>
              {asOf && (
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => setParams({ asOf: undefined })}
                >
                  {t("farmBatches.latest")}
                </Button>
              )}
            </form>
          </div>
        }
        tabs={farmDetailViews.map((id) => ({
          id,
          label: t(views[id]),
          content:
            id !== view ? null : id === "overview" ? (
              <FarmEventTable events={events} locale={locale} onCorrect={onCorrect} />
            ) : id === "history" ? (
              <FarmEventHistory
                scopeKey={scopeKey}
                companyId={companyId}
                batchId={batchId}
                events={events}
                locale={locale}
              />
            ) : id === "metrics" ? (
              <FarmMetricsView
                batch={batch}
                companyId={companyId}
                scopeKey={scopeKey}
                locale={locale}
              />
            ) : (
              <FarmNativeLinks
                key={id}
                view={id}
                batch={batch}
                companyId={companyId}
                scopeKey={scopeKey}
                canWrite={canWrite}
                locale={locale}
              />
            ),
        }))}
      />
      {form && canWrite && (
        <FarmEventForm
          key={form.requestId ?? form.existing?.id ?? form.initialKind}
          companyId={companyId}
          batch={batch}
          initialKind={form.initialKind}
          existing={form.existing}
          prefill={form.prefill}
          onClose={closeForm}
          onSaved={() => {
            closeForm()
            void queryClient.invalidateQueries({ queryKey: ["farm-batch", scopeKey, batchId] })
            void queryClient.invalidateQueries({ queryKey: ["farm-batches", scopeKey] })
          }}
        />
      )}
    </>
  )
}

function FarmEventTable({
  events,
  locale,
  onCorrect,
}: {
  events: FarmEvent[]
  locale: string
  onCorrect?: (event: FarmEvent) => void
}) {
  const { t } = useTranslation()
  if (events.length === 0)
    return <FarmNotice message={t("farmBatches.noFarmEventsAreRecordedForThis")} />
  return (
    <div className={workspaceStyles.surface}>
      <Table viewportLabel={t("farmBatches.farmEvents")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("farmBatches.businessDate")}</TableHead>
            <TableHead>{t("farmBatches.event")}</TableHead>
            <TableHead>{t("farmBatches.details")}</TableHead>
            {onCorrect && <TableHead className="text-right">{t("farmBatches.actions")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...events].reverse().map((event) => (
            <TableRow key={event.id}>
              <TableCell>{farmDateLabel(event.businessDate, locale)}</TableCell>
              <TableCell>{t(farmEventLabels[event.kind])}</TableCell>
              <TableCell className="max-w-64 whitespace-normal wrap-anywhere">
                {eventSummary(event, locale, t)}
              </TableCell>
              {onCorrect && (
                <TableCell className="text-right">
                  <Button type="button" size="sm" variant="ghost" onClick={() => onCorrect(event)}>
                    {t("farmBatches.correct")}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

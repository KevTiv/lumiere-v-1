"use client"

import { formattingLocale, useTranslation } from "@lumiere/i18n"
import { useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { accountMoveHref, expenseSheetHref, moduleTabHref } from "@lumiere/erp-shared/record-links"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
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
import { workspaceStyles } from "@lumiere/ui/lib/workspace-styles"
import { FarmField, FarmForm, FarmSelect, fieldValue } from "./farm-forms"
import {
  FarmApiError,
  farmApiPath,
  farmDateLabel,
  farmDateLabel,
  farmRecordId,
  farmRequest,
  farmWrite,
  type FarmBatchDetail,
  type FarmTranslation,
} from "./farm-batch-model"

type ProcessingLink = {
  eventId: string
  manufacturingOrderId: string
  liveLotId: string
  outputLotId: string
  inputMoveId?: string
  outputs: { moveId: string; lotId: string; productId: string; quantity: number; uomId: string }[]
  linkedAt: string
  status?: "pending" | "verified"
}

type CostKind = "vendor_bill" | "expense_report" | "journal"

type CostProof = {
  journalLineId: string
  journalId: string
  currencyId: string
  amount: string
  kind: CostKind
  allocationBasis: string
  expenseReportId: string | null
  businessDate: string
}

type CostLink =
  | (CostProof & { status: "verified" })
  | { status: "source_unavailable"; journalLineId: string }

interface NativeLinks {
  processingLinks: ProcessingLink[]
  costLinks: CostLink[]
  nextProcessingBeforeEventId: string | null
  nextCostBeforeJournalLineId: string | null
  processingAccess: "allowed" | "restricted"
  costAccess: "allowed" | "restricted"
}

const costLabels = {
  vendor_bill: "farmBatches.vendorBill",
  expense_report: "farmBatches.expenseReport",
  journal: "farmBatches.journalEntry",
} as const

const linkClass = "font-medium text-primary underline-offset-4 hover:underline"
const stockLotHref = (id: string) => moduleTabHref("warehouse", "lots", { id })
function recordInput(data: FormData, name: string, label: string, t: FarmTranslation) {
  const value = fieldValue(data, name)
  if (!farmRecordId(value)) throw new FarmApiError(t("farmBatches.invalidRecordId", { label }), 400)
  return value
}

export function FarmNativeLinks({
  view,
  batch,
  companyId,
  scopeKey,
  canWrite,
  locale,
}: {
  view: "processing" | "costs"
  batch: FarmBatchDetail
  companyId: string
  scopeKey: string
  canWrite: boolean
  locale: string
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<"link" | "run" | null>(null)
  const queryClient = useQueryClient()
  const [resumeLink, setResumeLink] = useState<ProcessingLink | undefined>()
  const [before, setBefore] = useState<string | null>(null)
  const path = farmApiPath(
    companyId,
    `/${batch.id}/native-links`,
    before
      ? { [view === "processing" ? "beforeProcessingEventId" : "beforeCostJournalLineId"]: before }
      : {},
  )
  const result = useQuery({
    queryKey: ["farm-native-links", scopeKey, batch.id, view, before],
    queryFn: ({ signal }) => farmRequest<NativeLinks>(path, { signal }),
    retry: false,
  })
  const rows = result.data
  if (result.isPending) return <Skeleton aria-label={t("farmBatches.loadingLinkedRecords")} className="h-36 w-full" />
  if (result.isError || !rows) {
    return (
      <div role="status" className="space-y-3 text-sm">
        <p>{t("farmBatches.linkedRecordsCouldNotBeLoaded")}</p>
        <Button variant="outline" size="sm" onClick={() => void result.refetch()}>
          {t("farmBatches.tryAgain")}
        </Button>
      </div>
    )
  }
  const processing = view === "processing"
  const access = processing ? rows.processingAccess : rows.costAccess
  if (access !== "allowed") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("farmBatches.yourRoleDoesNotHaveAccessToLabel")}
      </p>
    )
  }
  const nextPage = processing ? rows.nextProcessingBeforeEventId : rows.nextCostBeforeJournalLineId
  const events = batch.events.filter((event) => event.kind === "processing")
  const formSaved = () => {
    setForm(null)
    setResumeLink(undefined)
    if (before) setBefore(null)
    else void result.refetch()
    if (!processing)
      void queryClient.invalidateQueries({
        queryKey: ["farm-linked-posted-costs", scopeKey, companyId, batch.id],
      })
  }
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={workspaceStyles.sectionTitle}>
            {processing ? t("farmBatches.processingRuns") : t("farmBatches.postedCosts")}
          </h2>
          <p className={workspaceStyles.sectionDescription}>
            {processing
              ? t("farmBatches.connectAMeasuredRunWithCompletedStock")
              : t("farmBatches.connectExistingPostedCostsAndRecordHow")}
          </p>
        </div>
        {canWrite && (!processing || events.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {processing && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setResumeLink(undefined)
                  setForm("run")
                }}
              >
                {t("farmBatches.runOrResumeProcessing")}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => setForm("link")}>
              {processing ? t("farmBatches.linkCompletedRun") : t("farmBatches.linkPostedCost")}
            </Button>
          </div>
        )}
      </div>
      {processing ? (
        <ProcessingRows
          links={rows.processingLinks}
          onResume={
            canWrite
              ? (link) => {
                  setResumeLink(link)
                  setForm("run")
                }
              : undefined
          }
        />
      ) : (
        <CostRows links={rows.costLinks} locale={locale} />
      )}
      {(before || nextPage) && (
        <nav aria-label={t("farmBatches.linkedRecordPages")} className="flex flex-wrap gap-2">
          {before && (
            <Button type="button" size="sm" variant="outline" onClick={() => setBefore(null)}>
              {t("farmBatches.firstPage")}
            </Button>
          )}
          {nextPage && (
            <Button type="button" size="sm" variant="outline" onClick={() => setBefore(nextPage)}>
              {t("farmBatches.nextPage")}
            </Button>
          )}
        </nav>
      )}
      {form &&
        canWrite &&
        (processing ? (
          <ProcessingForm
            batch={batch}
            companyId={companyId}
            run={form === "run"}
            resume={form === "run" ? resumeLink : undefined}
            onClose={() => setForm(null)}
            onSaved={formSaved}
            onSaveFailed={() => void result.refetch()}
          />
        ) : (
          <CostForm
            batch={batch}
            companyId={companyId}
            onClose={() => setForm(null)}
            onSaved={formSaved}
          />
        ))}
    </section>
  )
}

function ProcessingRows({
  links,
  onResume,
}: {
  links: ProcessingLink[]
  onResume?: (item: ProcessingLink) => void
}) {
  const { t } = useTranslation()
  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("farmBatches.noCompletedProcessingRunsAreLinkedYet")}</p>
  }
  return (
    <div className={workspaceStyles.surface}>
      <Table viewportLabel={t("farmBatches.linkedProcessingRuns")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("farmBatches.farmEvent")}</TableHead>
            <TableHead>{t("farmBatches.manufacturingOrder")}</TableHead>
            <TableHead>{t("farmBatches.inputLot")}</TableHead>
            <TableHead>{t("farmBatches.outputLots")}</TableHead>
            <TableHead>{t("farmBatches.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((item) => (
            <TableRow key={item.eventId}>
              <TableCell>#{item.eventId}</TableCell>
              <TableCell>#{item.manufacturingOrderId}</TableCell>
              <TableCell>
                <Link className={linkClass} href={stockLotHref(item.liveLotId)}>
                  {t("farmBatches.lotIdLabel", { id: item.liveLotId })}
                </Link>
              </TableCell>
              <TableCell>
                {item.status === "pending" ? (
                  t("farmBatches.awaitingCompletion")
                ) : (
                  <ul className="space-y-1">
                    {item.outputs.map((output) => (
                      <li key={output.moveId}>
                        <Link className={linkClass} href={stockLotHref(output.lotId)}>
                          {t("farmBatches.lotIdLabel", { id: output.lotId })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </TableCell>
              <TableCell>
                {item.status === "pending" ? (
                  onResume ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onResume(item)}>
                      {t("farmBatches.resume")}
                    </Button>
                  ) : (
                    t("farmBatches.pending")
                  )
                ) : (
                  t("farmBatches.verified")
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CostRows({ links, locale }: { links: CostLink[]; locale: string }) {
  const { t } = useTranslation()
  const currencies = useCurrencies()
  const currencyById = new Map(currencies.data?.map((row) => [String(row.id), row.code]))
  if (links.length === 0)
    return <p className="text-sm text-muted-foreground">{t("farmBatches.noPostedCostsAreLinkedYet")}</p>
  return (
    <div className={workspaceStyles.surface}>
      <Table viewportLabel={t("farmBatches.linkedCosts")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("farmBatches.date")}</TableHead>
            <TableHead>{t("farmBatches.source")}</TableHead>
            <TableHead>{t("farmBatches.allocationBasis")}</TableHead>
            <TableHead className="text-right">{t("farmBatches.amount")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((item) =>
            item.status === "source_unavailable" ? (
              <TableRow key={item.journalLineId}>
                <TableCell colSpan={4} className="whitespace-normal text-muted-foreground">
                  {t("farmBatches.unverifiedJournalLine", { id: item.journalLineId })}
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={item.journalLineId}>
                <TableCell>{farmDateLabel(item.businessDate, locale)}</TableCell>
                <TableCell>
                  <Link
                    className={linkClass}
                    href={
                      item.expenseReportId
                        ? expenseSheetHref(item.expenseReportId)
                        : accountMoveHref(item.journalId)
                    }
                  >
                    {t(costLabels[item.kind])} #{item.expenseReportId ?? item.journalId}
                  </Link>
                </TableCell>
                <TableCell className="max-w-56 whitespace-normal wrap-anywhere">
                  {item.allocationBasis}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.amount}{" "}
                  {String(currencyById.get(item.currencyId) ?? t("farmBatches.currencyLabel", { id: item.currencyId }))}
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
    </div>
  )
}

type LinkFormProps = {
  batch: FarmBatchDetail
  companyId: string
  onSaved: () => void
  onClose: () => void
}

function ProcessingForm({
  batch,
  companyId,
  run,
  resume,
  onSaved,
  onSaveFailed,
  onClose,
}: LinkFormProps & {
  run: boolean
  resume?: ProcessingLink
  onSaveFailed: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = formattingLocale(i18n.language)
  const events = batch.events.filter((event) => event.kind === "processing")
  const options = events.map(
    (event) => [event.id, `${farmDateLabel(event.businessDate, locale)} · ${t("farmBatches.animals", { countLabel: event.count.toLocaleString(locale) })} · #${event.id}`] as const,
  )
  const [eventId, setEventId] = useState(resume?.eventId ?? options[0]?.[0] ?? "")
  return (
    <FarmForm<ProcessingLink>
      title={run ? t("farmBatches.runOrResumeProcessing") : t("farmBatches.linkCompletedProcessing")}
      description={
        run
          ? t("farmBatches.useTheMeasuredRunItsPreparedManufacturing")
          : t("farmBatches.chooseAMeasuredFarmEventAndEnter")
      }
      submitLabel={run ? t("farmBatches.confirmProcessing") : t("farmBatches.linkProcessing")}
      onSaved={onSaved}
      onSaveFailed={onSaveFailed}
      onClose={onClose}
      onSave={(data) => {
        const event = events.find((row) => row.id === fieldValue(data, "eventId"))
        if (!event) throw new FarmApiError(t("farmBatches.chooseARecordedProcessingEvent"), 400)
        return farmRequest(
          farmApiPath(companyId, `/${batch.id}/${run ? "processing-runs" : "processing-links"}`),
          farmWrite("POST", {
            companyId,
            eventId: event.id,
            manufacturingOrderId: recordInput(data, "manufacturingOrderId", t("farmBatches.manufacturingOrderID"), t),
            liveLotId: recordInput(data, "liveLotId", t("farmBatches.liveLotID"), t),
            outputLotId: recordInput(data, "outputLotId", t("farmBatches.primaryOutputLotID"), t),
            ...(run ? { expectedEventRevision: event.revision } : {}),
          }),
        )
      }}
    >
      <FarmSelect
        label={t("farmBatches.processingEvent")}
        name="eventId"
        value={eventId}
        options={options}
        onChange={setEventId}
      />
      <FarmField
        label={t("farmBatches.manufacturingOrderID")}
        name="manufacturingOrderId"
        defaultValue={resume?.manufacturingOrderId}
        inputMode="numeric"
        maxLength={20}
      />
      <FarmField
        label={t("farmBatches.liveLotID")}
        name="liveLotId"
        defaultValue={resume?.liveLotId}
        inputMode="numeric"
        maxLength={20}
      />
      <FarmField
        label={t("farmBatches.primaryOutputLotID")}
        name="outputLotId"
        defaultValue={resume?.outputLotId}
        inputMode="numeric"
        maxLength={20}
      />
    </FarmForm>
  )
}

function CostForm({ batch, companyId, onSaved, onClose }: LinkFormProps) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<CostKind>("vendor_bill")
  return (
    <FarmForm<CostProof>
      title={t("farmBatches.linkPostedCost")}
      description={t("farmBatches.useThePostedJournalLineThatCarries")}
      submitLabel={t("farmBatches.linkCost")}
      onSaved={onSaved}
      onClose={onClose}
      onSave={(data) =>
        farmRequest(
          farmApiPath(companyId, `/${batch.id}/cost-links`),
          farmWrite("POST", {
            companyId,
            kind,
            journalLineId: recordInput(data, "journalLineId", t("farmBatches.postedJournalLineID"), t),
            allocationBasis: fieldValue(data, "allocationBasis"),
            ...(kind === "expense_report"
              ? { expenseReportId: recordInput(data, "expenseReportId", t("farmBatches.expenseReportID"), t) }
              : {}),
          }),
        )
      }
    >
      <FarmSelect
        label={t("farmBatches.costSource")}
        name="kind"
        value={kind}
        options={Object.entries(costLabels).map(([value, label]) => [value, t(label)])}
        onChange={(value) => {
          if (value === "vendor_bill" || value === "expense_report" || value === "journal")
            setKind(value)
        }}
      />
      <FarmField
        label={t("farmBatches.postedJournalLineID")}
        name="journalLineId"
        inputMode="numeric"
        maxLength={20}
      />
      {kind === "expense_report" && (
        <FarmField
          label={t("farmBatches.expenseReportID")}
          name="expenseReportId"
          inputMode="numeric"
          maxLength={20}
        />
      )}
      <FarmField label={t("farmBatches.allocationBasis")} name="allocationBasis" maxLength={500} />
    </FarmForm>
  )
}

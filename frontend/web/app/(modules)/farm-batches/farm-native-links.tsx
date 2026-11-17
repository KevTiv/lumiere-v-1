"use client"

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
  farmRecordId,
  farmRequest,
  farmWrite,
  type FarmBatchDetail,
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
  vendor_bill: "Vendor bill",
  expense_report: "Expense report",
  journal: "Journal entry",
} as const

const linkClass = "font-medium text-primary underline-offset-4 hover:underline"
const stockLotHref = (id: string) => moduleTabHref("warehouse", "lots", { id })
function recordInput(data: FormData, name: string, label: string) {
  const value = fieldValue(data, name)
  if (!farmRecordId(value)) throw new FarmApiError(`Enter a valid ${label}.`, 400)
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
  if (result.isPending) return <Skeleton aria-label="Loading linked records" className="h-36 w-full" />
  if (result.isError || !rows) {
    return (
      <div role="status" className="space-y-3 text-sm">
        <p>{result.error?.message ?? "Linked records could not be loaded."}</p>
        <Button variant="outline" size="sm" onClick={() => void result.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  const processing = view === "processing"
  const access = processing ? rows.processingAccess : rows.costAccess
  if (access !== "allowed") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Your role does not have access to the related ERP records.
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
            {processing ? "Processing runs" : "Posted costs"}
          </h2>
          <p className={workspaceStyles.sectionDescription}>
            {processing
              ? "Connect a measured run with completed stock movements and output lots."
              : "Connect existing posted costs and record how they were allocated to this batch."}
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
                Run or resume processing
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => setForm("link")}>
              {processing ? "Link completed run" : "Link posted cost"}
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
        <nav aria-label="Linked record pages" className="flex flex-wrap gap-2">
          {before && (
            <Button type="button" size="sm" variant="outline" onClick={() => setBefore(null)}>
              First page
            </Button>
          )}
          {nextPage && (
            <Button type="button" size="sm" variant="outline" onClick={() => setBefore(nextPage)}>
              Next page
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
  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">No completed processing runs are linked yet.</p>
  }
  return (
    <div className={workspaceStyles.surface}>
      <Table viewportLabel="Linked processing runs">
        <TableHeader>
          <TableRow>
            <TableHead>Farm event</TableHead>
            <TableHead>Manufacturing order</TableHead>
            <TableHead>Input lot</TableHead>
            <TableHead>Output lots</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((item) => (
            <TableRow key={item.eventId}>
              <TableCell>#{item.eventId}</TableCell>
              <TableCell>#{item.manufacturingOrderId}</TableCell>
              <TableCell>
                <Link className={linkClass} href={stockLotHref(item.liveLotId)}>
                  Lot #{item.liveLotId}
                </Link>
              </TableCell>
              <TableCell>
                {item.status === "pending" ? (
                  "Awaiting completion"
                ) : (
                  <ul className="space-y-1">
                    {item.outputs.map((output) => (
                      <li key={output.moveId}>
                        <Link className={linkClass} href={stockLotHref(output.lotId)}>
                          Lot #{output.lotId}
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
                      Resume
                    </Button>
                  ) : (
                    "Pending"
                  )
                ) : (
                  "Verified"
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
  const currencies = useCurrencies()
  const currencyById = new Map(currencies.data?.map((row) => [String(row.id), row.code]))
  if (links.length === 0)
    return <p className="text-sm text-muted-foreground">No posted costs are linked yet.</p>
  return (
    <div className={workspaceStyles.surface}>
      <Table viewportLabel="Linked costs">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Allocation basis</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((item) =>
            item.status === "source_unavailable" ? (
              <TableRow key={item.journalLineId}>
                <TableCell colSpan={4} className="whitespace-normal text-muted-foreground">
                  Journal line #{item.journalLineId} could not be verified.
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
                    {costLabels[item.kind]} #{item.expenseReportId ?? item.journalId}
                  </Link>
                </TableCell>
                <TableCell className="max-w-56 whitespace-normal wrap-anywhere">
                  {item.allocationBasis}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.amount}{" "}
                  {String(currencyById.get(item.currencyId) ?? `· currency #${item.currencyId}`)}
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
  const events = batch.events.filter((event) => event.kind === "processing")
  const options = events.map(
    (event) => [event.id, `${event.businessDate} · ${event.count} animals · #${event.id}`] as const,
  )
  const [eventId, setEventId] = useState(resume?.eventId ?? options[0]?.[0] ?? "")
  return (
    <FarmForm<ProcessingLink>
      title={run ? "Run or resume processing" : "Link completed processing"}
      description={
        run
          ? "Use the measured run, its prepared Manufacturing order, and the exact input and output lots. Confirming can move stock."
          : "Choose a measured farm event and enter the matching completed Manufacturing and Warehouse records."
      }
      submitLabel={run ? "Confirm processing" : "Link processing"}
      onSaved={onSaved}
      onSaveFailed={onSaveFailed}
      onClose={onClose}
      onSave={(data) => {
        const event = events.find((row) => row.id === fieldValue(data, "eventId"))
        if (!event) throw new FarmApiError("Choose a recorded processing event.", 400)
        return farmRequest(
          farmApiPath(companyId, `/${batch.id}/${run ? "processing-runs" : "processing-links"}`),
          farmWrite("POST", {
            companyId,
            eventId: event.id,
            manufacturingOrderId: recordInput(data, "manufacturingOrderId", "Manufacturing order ID"),
            liveLotId: recordInput(data, "liveLotId", "live lot ID"),
            outputLotId: recordInput(data, "outputLotId", "output lot ID"),
            ...(run ? { expectedEventRevision: event.revision } : {}),
          }),
        )
      }}
    >
      <FarmSelect
        label="Processing event"
        name="eventId"
        value={eventId}
        options={options}
        onChange={setEventId}
      />
      <FarmField
        label="Manufacturing order ID"
        name="manufacturingOrderId"
        defaultValue={resume?.manufacturingOrderId}
        inputMode="numeric"
        maxLength={20}
      />
      <FarmField
        label="Live lot ID"
        name="liveLotId"
        defaultValue={resume?.liveLotId}
        inputMode="numeric"
        maxLength={20}
      />
      <FarmField
        label="Primary output lot ID"
        name="outputLotId"
        defaultValue={resume?.outputLotId}
        inputMode="numeric"
        maxLength={20}
      />
    </FarmForm>
  )
}

function CostForm({ batch, companyId, onSaved, onClose }: LinkFormProps) {
  const [kind, setKind] = useState<CostKind>("vendor_bill")
  return (
    <FarmForm<CostProof>
      title="Link posted cost"
      description="Use the posted journal line that carries this batch’s allocated cost."
      submitLabel="Link cost"
      onSaved={onSaved}
      onClose={onClose}
      onSave={(data) =>
        farmRequest(
          farmApiPath(companyId, `/${batch.id}/cost-links`),
          farmWrite("POST", {
            companyId,
            kind,
            journalLineId: recordInput(data, "journalLineId", "journal line ID"),
            allocationBasis: fieldValue(data, "allocationBasis"),
            ...(kind === "expense_report"
              ? { expenseReportId: recordInput(data, "expenseReportId", "expense report ID") }
              : {}),
          }),
        )
      }
    >
      <FarmSelect
        label="Cost source"
        name="kind"
        value={kind}
        options={Object.entries(costLabels)}
        onChange={(value) => {
          if (value === "vendor_bill" || value === "expense_report" || value === "journal")
            setKind(value)
        }}
      />
      <FarmField
        label="Posted journal line ID"
        name="journalLineId"
        inputMode="numeric"
        maxLength={20}
      />
      {kind === "expense_report" && (
        <FarmField
          label="Expense report ID"
          name="expenseReportId"
          inputMode="numeric"
          maxLength={20}
        />
      )}
      <FarmField label="Allocation basis" name="allocationBasis" maxLength={500} />
    </FarmForm>
  )
}

"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { useAccountAccounts } from "@lumiere/query-hooks/hooks/accounting/accounts"
import { useAccountJournals } from "@lumiere/query-hooks/hooks/accounting/journals"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@lumiere/ui/components/alert-dialog"
import { sourceReviewHistoryHref } from "@lumiere/query-hooks/hooks/source-review-navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiFetch } from "./api-fetch"
import {
  ImportChoice as Choice,
  ImportTextField as TextField,
} from "./import-task-fields"
import { operatingCompanyCurrencyCode } from "./operating-company-currency"
import type { ReviewDetail } from "./import-review-model"
import {
  transitionImportProposal,
  type DistinctExpenseDecision,
  type ImportCapability,
  type ImportNativeResult,
  type ImportProposal,
  type ImportProposalAction,
  type ImportWorkflow,
} from "./import-workflow"
import { useImportProposalAttempt } from "./use-import-proposal-attempt"
import { importTaskHref } from "./import-task-navigation"
import { importWorkflowKey, useImportWorkflow } from "./use-import-workflow"

interface Props {
  organizationId: number
  companyId: number
  taskId: string
  reviewId?: string
  view: "preview" | "results"
  onChanged?: () => void
  onReviewSource?: (reviewId: string) => void
}

export function ImportTaskExecutionPanel(props: Props) {
  const { identity, activeCompanyId, activeCompanyReady } = useErpSession()
  const { t } = useTranslation()
  if (
    !identity ||
    !activeCompanyReady ||
    Number(activeCompanyId) !== props.companyId
  ) {
    return <p>{t("settings.importWorkflow.companyRequired")}</p>
  }
  return (
    <ExecutionPanel
      key={`${identity}:${props.organizationId}:${props.companyId}:${props.taskId}:${props.reviewId ?? ""}`}
      {...props}
      actor={identity}
    />
  )
}

function ExecutionPanel({
  organizationId,
  companyId,
  taskId,
  reviewId,
  view,
  onChanged,
  onReviewSource,
  actor,
}: Props & { actor: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const scope = { organizationId, companyId, taskId }
  const queryKey = importWorkflowKey(actor, scope)
  const workflow = useImportWorkflow(actor, scope)
  const review = useQuery({
    queryKey: [
      "import-workflow-source",
      actor,
      organizationId,
      companyId,
      reviewId,
    ],
    enabled: !!reviewId && view === "preview",
    queryFn: async (): Promise<ReviewDetail> => {
      const response = await apiFetch(
        `/api/import-reviews/${reviewId}?companyId=${companyId}`,
        { cache: "no-store" },
      )
      if (!response.ok)
        throw new Error(t("settings.importWorkflow.reviewUnavailable"))
      const detail: ReviewDetail = await response.json()
      if (detail.id !== reviewId || !Array.isArray(detail.items))
        throw new Error(t("settings.importWorkflow.reviewUnavailable"))
      return detail
    },
    staleTime: 0,
  })
  const accountsQuery = useAccountAccounts(BigInt(organizationId))
  const journalsQuery = useAccountJournals(BigInt(organizationId))
  const companiesQuery = useCompanies(organizationId, true)
  const currenciesQuery = useCurrencies()
  const accounts = accountsQuery.isError ? [] : (accountsQuery.data ?? [])
  const journals = journalsQuery.isError ? [] : (journalsQuery.data ?? [])
  const companies = companiesQuery.isError ? [] : (companiesQuery.data ?? [])
  const company = companies.find((row) => String(row.id) === String(companyId))
  const currencyId =
    company?.currencyId == null ? "" : String(company.currencyId)
  const currencyCode = currenciesQuery.isError
    ? undefined
    : operatingCompanyCurrencyCode(
        currenciesQuery.data ?? [],
        companies,
        companyId,
      )
  const [journalId, setJournalId] = useState("")
  const [debitAccountId, setDebitAccountId] = useState("")
  const [creditAccountId, setCreditAccountId] = useState("")
  const [amountField, setAmountField] = useState("amount")
  const [dateField, setDateField] = useState("date")
  const [treatment, setTreatment] = useState("expense")
  const openingBalances = treatment === "opening_balances"
  const [dateMode, setDateMode] = useState("source")
  const [postingDate, setPostingDate] = useState("")
  const [reason, setReason] = useState("")
  const [selectedRows, setSelectedRows] = useState<Set<string> | null>(null)
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(
    null,
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const proposals = workflow.isError ? [] : (workflow.data?.proposals ?? [])
  const nativeResults = workflow.isError
    ? []
    : (workflow.data?.nativeResults ?? [])
  // A blocked attempt may have released its rows after verified cleanup.
  // Preparation rechecks unresolved earlier effects on the server.
  const consumedIds = new Set(
    proposals
      .filter((proposal) =>
        ["approved", "executing", "verified"].includes(proposal.status),
      )
      .flatMap((proposal) => proposal.entries.map((entry) => entry.itemId)),
  )
  const availableRows = review.isError
    ? []
    : (review.data?.items ?? []).filter(
        (row) => row.state !== "excluded" && !consumedIds.has(row.id),
      )
  const chosenRows = selectedRows
    ? availableRows.filter((row) => selectedRows.has(row.id))
    : availableRows.slice(0, 200)
  const chosenIds = new Set(chosenRows.map((row) => row.id))
  const fields = useMemo(() => {
    const distinct = new Map<
      string,
      { value: string; label: string; kind: string }
    >()
    if (!review.isError)
      for (const row of review.data?.items ?? [])
        for (const field of row.source.fields) {
          distinct.set(field.key, {
            value: field.key,
            label: field.label,
            kind: field.kind,
          })
        }
    return [...distinct.values()]
  }, [review.data, review.isError])
  const proposal =
    proposals.find((item) => item.id === selectedProposalId) ?? proposals[0]
  const proposalCurrency = currenciesQuery.data?.find(
    (row) => String(row.id) === proposal?.summary.currencyId,
  )?.code
  const nativeHandoff =
    review.data &&
    workflow.data?.capabilities.some(
      (capability) =>
        capability.readiness === "native_preview" &&
        capability.targetEntities.includes(review.data.targetEntity),
    )
  const openingDateFields = fields.filter(
    (field) =>
      ["date", "business_date", "as_of", "balance_date"].includes(
        field.value,
      ) && field.kind === "date",
  )
  const accountingSource = review.data?.targetEntity === "source_observation"
  const canPrepare =
    !!accountingSource &&
    !review.isError &&
    !workflow.isError &&
    !!journalId &&
    !!debitAccountId &&
    !!creditAccountId &&
    !!currencyId &&
    !!currencyCode &&
    debitAccountId !== creditAccountId &&
    chosenRows.length > 0 &&
    chosenRows.length <= 200 &&
    reason.trim().length >= 3 &&
    (openingBalances
      ? !!postingDate &&
        openingDateFields.some((field) => field.value === dateField) &&
        [
          "debit",
          "credit",
          "debit_account_id",
          "credit_account_id",
          "currency_id",
          "observation_kind",
          "document_reference",
          "description",
        ].every((key) => fields.some((field) => field.value === key))
      : (dateMode === "source" || !!postingDate) &&
    fields.some((field) => field.value === amountField) &&
    (dateMode === "posting" ||
      fields.some((field) => field.value === dateField))) &&
    !accountsQuery.isError &&
    !journalsQuery.isError &&
    !companiesQuery.isError

  function accept(next: ImportProposal) {
    queryClient.setQueryData<ImportWorkflow>(queryKey, (previous) =>
      previous
        ? {
            ...previous,
            proposals: [
              next,
              ...previous.proposals.filter((item) => item.id !== next.id),
            ],
          }
        : previous,
    )
    setSelectedProposalId(next.id)
    setActionError(null)
    if (next.status === "verified" || next.status === "rolled_back") {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "stdb" &&
          ["account-moves", "account-move-lines"].includes(
            String(query.queryKey[1]),
          ) &&
          String(query.queryKey[2]) === String(organizationId),
      })
    }
    onChanged?.()
  }
  const preparation = useImportProposalAttempt({
    actor,
    scope,
    onAccepted: accept,
  })
  const transition = useMutation({
    mutationFn: ({
      proposal: current,
      action,
    }: {
      proposal: ImportProposal
      action: ImportProposalAction
    }) => transitionImportProposal(apiFetch, scope, current, action),
    onSuccess: accept,
    onError: async (error: Error, { proposal: attempted, action }) => {
      setActionError(error.message)
      const fresh = await workflow.refetch()
      if (action === "rollback" && !fresh.isError) {
        const recovered = fresh.data?.proposals.find(
          (current) =>
            current.id === attempted.id &&
            current.revision === attempted.revision &&
            current.digest === attempted.digest &&
            current.status === "rolled_back",
        )
        if (recovered) accept(recovered)
      }
    },
  })
  const busy = preparation.busy || transition.isPending
  const preparationLocked = !preparation.ready || preparation.pending !== null
  const accountChoices = accounts
    .filter(
      (row) =>
        row.deprecated === false && String(row.companyId) === String(companyId),
    )
    .map((row) => ({
      value: String(row.id),
      label: [row.code, row.name].filter(Boolean).join(" · "),
    }))
  const journalChoices = journals
    .filter(
      (row) =>
        row.active === true && String(row.companyId) === String(companyId),
    )
    .map((row) => ({
      value: String(row.id),
      label: [row.code, row.name].filter(Boolean).join(" · "),
    }))

  return (
    <section className="space-y-4" data-testid="import-task-execution">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {t(
            view === "preview"
              ? "settings.importWorkflow.previewTitle"
              : "settings.importWorkflow.resultsTitle",
          )}
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || workflow.isFetching}
          onClick={() => {
            void preparation.check()
            void workflow.refetch()
            if (reviewId) void review.refetch()
          }}
        >
          {t("settings.importWorkflow.reload")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("settings.importWorkflow.explanation")}
      </p>
      {workflow.isLoading && <p role="status">{t("common.loading")}</p>}
      {(workflow.error || actionError || preparation.error) && (
        <div
          className="rounded border border-destructive p-3 text-sm"
          role="alert"
        >
          <p>{preparation.error ?? actionError ?? workflow.error?.message}</p>
          <p>{t("settings.importWorkflow.recovery")}</p>
        </div>
      )}
      {preparation.pending && (
        <section
          className="space-y-2 rounded border p-3 text-sm"
          aria-label={t("settings.importWorkflow.savedPreviewAttempt", {
            defaultValue: "Saved preview request",
          })}
        >
          <p>
            {t("settings.importWorkflow.savedPreviewIntent", {
              defaultValue:
                "Retained request for {{count}} source rows · journal #{{journal}}. Its exact source revisions and accounting choices will be reused.",
              count: preparation.pending.input.rows.length,
              journal: preparation.pending.input.journalId,
            })}
          </p>
          <p className="whitespace-pre-wrap">
            {preparation.pending.input.reason}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void preparation.retry()}
            >
              {t("settings.importWorkflow.retrySavedPreview", {
                defaultValue: "Retry saved preview",
              })}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void preparation.check()}
            >
              {t("settings.importWorkflow.checkSavedPreview", {
                defaultValue: "Check saved preview",
              })}
            </Button>
          </div>
        </section>
      )}
      {view === "preview" && !workflow.isError && (
        <>
          {!reviewId && <p>{t("settings.importWorkflow.chooseSource")}</p>}
          {review.error && <p role="alert">{review.error.message}</p>}
          {nativeHandoff && (
            <div className="space-y-2">
              <p>{t("settings.importWorkflow.nativeHandoff")}</p>
              {reviewId && onReviewSource && (
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => onReviewSource(reviewId)}
                >
                  {t("settings.importWorkflow.reviewForNativePreview", {
                    defaultValue: "Open source decisions for native preview",
                  })}
                </Button>
              )}
            </div>
          )}
          {review.data && !accountingSource && !nativeHandoff && (
            <p>{t("settings.importWorkflow.unsupportedSource")}</p>
          )}
          {accountingSource && (
            <fieldset
              disabled={busy || preparationLocked}
              className="space-y-4 rounded border p-4"
            >
              <legend className="px-1 font-medium">
                {t("settings.importWorkflow.accountingTreatment")}
              </legend>
              <p className="text-sm text-muted-foreground">
                {t(
                  openingBalances
                    ? "settings.importWorkflow.openingBalanceFacts"
                    : "settings.importWorkflow.partialFacts",
                )}
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <Choice
                  label={t("settings.importWorkflow.draftType")}
                  value={treatment}
                  onChange={setTreatment}
                  options={[
                    {
                      value: "expense",
                      label: t("settings.importWorkflow.expenseTreatment"),
                    },
                    {
                      value: "opening_balances",
                      label: t(
                        "settings.importWorkflow.openingBalanceTreatment",
                      ),
                    },
                  ]}
                />
                <Choice
                  label={t("settings.importWorkflow.journal")}
                  value={journalId}
                  onChange={setJournalId}
                  options={journalChoices}
                />
                <Choice
                  label={t(
                    openingBalances
                      ? "settings.importWorkflow.openingDebitAccount"
                      : "settings.importWorkflow.debitAccount",
                  )}
                  value={debitAccountId}
                  onChange={setDebitAccountId}
                  options={accountChoices}
                />
                <Choice
                  label={t("settings.importWorkflow.creditAccount")}
                  value={creditAccountId}
                  onChange={setCreditAccountId}
                  options={accountChoices}
                />
                {!openingBalances && (
                  <>
                <Choice
                  label={t("settings.importWorkflow.amountColumn")}
                  value={amountField}
                      onChange={setAmountField}
                      options={fields.filter(
                        (field) => field.kind === "decimal",
                      )}
                    />
                    <Choice
                    label={t("settings.importWorkflow.dateTreatment")}
                      value={dateMode}
                      onChange={setDateMode}
                      options={[
                        {
                          value: "source",
                          label: t("settings.importWorkflow.sourceDate"),
                        },
                        {
                          value: "posting",
                          label: t("settings.importWorkflow.explicitDate"),
                        },
                      ]}
                    />
                  </>
                )}
                {(openingBalances || dateMode === "source") && (
                  <Choice
                    label={t("settings.importWorkflow.dateColumn")}
                    value={dateField}
                    onChange={setDateField}
                    options={
                      openingBalances
                        ? openingDateFields
                        : fields.filter((field) => field.kind === "date")}
                  />
                )}
                {(openingBalances || dateMode === "posting") && (
                  <TextField
                    label={t(
                      openingBalances
                        ? "settings.importWorkflow.cutoverDate"
                        : "settings.importWorkflow.postingDate",
                    )}
                    type="date"
                    value={postingDate}
                    onChange={setPostingDate}
                  />
                )}
              </div>
              <p className="text-sm">
                {currencyCode
                  ? t("settings.importWorkflow.companyCurrency", {
                      currency: currencyCode,
                    })
                  : t("settings.importWorkflow.currencyRequired")}
              </p>
              {(accountsQuery.isError ||
                journalsQuery.isError ||
                companiesQuery.isError) && (
                <p role="alert">
                  {t("settings.importWorkflow.referencesUnavailable")}
                </p>
              )}
              <TextField
                label={t("settings.importWorkflow.reason")}
                value={reason}
                onChange={setReason}
                maxLength={2000}
              />
              <details>
                <summary className="cursor-pointer text-sm">
                  {t("settings.importWorkflow.selectedRows", {
                    selected: chosenRows.length,
                    total: availableRows.length,
                  })}
                </summary>
                <div className="my-2 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSelectedRows(
                        new Set(
                          availableRows.slice(0, 200).map((row) => row.id),
                        ),
                      )
                    }
                  >
                    {t("settings.importWorkflow.firstGroup")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedRows(new Set())}
                  >
                    {t("settings.importWorkflow.clearRows")}
                  </Button>
                </div>
                <div className="max-h-64 overflow-auto">
                  {availableRows.map((row) => (
                    <label
                      key={row.id}
                      className="flex items-start gap-2 py-1 text-sm"
                    >
                      <Checkbox
                        disabled={busy || preparationLocked}
                        aria-label={`${row.source.label} · ${row.source.source.file}:${row.source.source.row}`}
                        checked={chosenIds.has(row.id)}
                        onCheckedChange={(checked) =>
                          setSelectedRows((previous) => {
                            const next = new Set(
                              previous ?? chosenRows.map((chosen) => chosen.id),
                            )
                            if (checked === true) next.add(row.id)
                            else next.delete(row.id)
                            return next
                          })
                        }
                      />
                      <span>
                        {row.source.label} · {row.source.source.file}:
                        {row.source.source.row}
                      </span>
                    </label>
                  ))}
                </div>
              </details>
              <Button
                disabled={!canPrepare || busy || preparationLocked}
                onClick={() =>
                  void preparation.submit({
                    previousProposalId: proposal?.id,
                    rows: chosenRows.map((row) => ({
                      itemId: row.id,
                      expectedRevision: row.revision,
                    })),
                    journalId,
                    debitAccountId,
                    creditAccountId,
                    currencyId,
                    amountField: openingBalances ? "debit" : amountField,
                    dateField,
                    ...(openingBalances ? { openingBalances: true } : {}),
                    ...(openingBalances || dateMode === "posting" ? { postingDate } : {}),
                    reason,
                  })
                }
              >
                {t(
                  busy
                    ? "settings.importWorkflow.working"
                    : "settings.importWorkflow.prepare",
                )}
              </Button>
            </fieldset>
          )}
        </>
      )}
      {!!proposals.length && (
        <fieldset disabled={busy || preparationLocked}>
          <Choice
            label={t("settings.importWorkflow.savedPreview")}
            value={proposal?.id ?? ""}
            onChange={setSelectedProposalId}
            options={proposals.map((item) => ({
              value: item.id,
              label: t("settings.importWorkflow.savedPreviewCounts", {
                defaultValue:
                  "{{date}} · {{status}} · {{drafts}} previewed drafts · {{held}} held",
                date: item.summary.dateFrom ?? "—",
                status: t(`settings.importWorkflow.status.${item.status}`),
                drafts: item.summary.recordCount,
                held: item.summary.blockedCount,
              }),
            }))}
          />
        </fieldset>
      )}
      {proposal && (
        <ProposalDetails
          key={`${proposal.id}:${proposal.revision}:${proposal.digest}`}
          proposal={proposal}
          companyId={companyId}
          currency={
            typeof proposalCurrency === "string"
              ? proposalCurrency
              : t("settings.importWorkflow.currencyUnavailable")
          }
          journal={
            journalChoices.find(
              (choice) => choice.value === proposal.configuration.journalId,
            )?.label
          }
          debit={
            accountChoices.find(
              (choice) =>
                choice.value === proposal.configuration.debitAccountId,
            )?.label
          }
          credit={
            accountChoices.find(
              (choice) =>
                choice.value === proposal.configuration.creditAccountId,
            )?.label
          }
          busy={busy || preparationLocked}
          action={(action) => transition.mutate({ proposal, action })}
          onReviewSource={onReviewSource}
          onResolve={(decisions) => {
            const configuration = proposal.configuration
            const distinct = new Map(
              (configuration.distinctExpenses ?? []).map((decision) => [
                decision.itemId,
                decision,
              ]),
            )
            for (const decision of decisions)
              distinct.set(decision.itemId, decision)
            void preparation.submit({
              previousProposalId: proposal.id,
              rows: proposal.sources.map((source) => ({
                itemId: source.itemId,
                expectedRevision: source.revision,
              })),
              journalId: configuration.journalId,
              debitAccountId: configuration.debitAccountId,
              creditAccountId: configuration.creditAccountId,
              currencyId: configuration.currencyId,
              dateField: configuration.dateField,
              amountField: configuration.amountField,
              ...(configuration.descriptionField
                ? { descriptionField: configuration.descriptionField }
                : {}),
              ...(configuration.postingDate
                ? { postingDate: configuration.postingDate }
                : {}),
              reason: configuration.reason,
              distinctExpenses: [...distinct.values()],
            })
          }}
        />
      )}
      {view === "results" && nativeResults.length > 0 && (
        <section
          className="space-y-3"
          aria-label={t("settings.importWorkflow.nativeResults", {
            defaultValue: "Saved native import receipts",
          })}
        >
          <h4 className="font-medium">
            {t("settings.importWorkflow.nativeResults", {
              defaultValue: "Saved native import receipts",
            })}
          </h4>
          <p className="text-sm text-muted-foreground">
            {t("settings.importWorkflow.nativeReceiptBoundary", {
              defaultValue:
                "These are saved import job receipts. Open a job to inspect row errors and its current status. These receipts do not provide the Accounting adapter’s full ERP readback.",
            })}
          </p>
          {nativeResults.map((result) => (
            <NativeResult
              key={result.requestId}
              result={result}
              capability={workflow.data?.capabilities.find(
                (item) =>
                  item.readiness === "native_preview" &&
                  item.targetEntities.includes(result.entity),
              )}
              companyId={companyId}
              taskId={taskId}
            />
          ))}
          {workflow.data?.nativeResultsMore && (
            <div className="space-y-2 text-sm">
              <p>
                {t("settings.importWorkflow.nativeResultsLimit", {
                  defaultValue:
                    "Only the latest 20 native receipts for this task are shown. More saved receipts exist.",
                })}
              </p>
              <nav
                className="flex flex-wrap gap-3"
                aria-label={t("settings.importWorkflow.nativeModules", {
                  defaultValue: "Open related modules",
                })}
              >
                {workflow.data.capabilities
                  .filter((item) => item.readiness === "native_preview")
                  .map((item) => (
                    <a
                      key={item.key}
                      className="underline"
                      href={item.destination}
                    >
                      {item.label}
                    </a>
                  ))}
              </nav>
            </div>
          )}
        </section>
      )}
      {!proposals.length &&
        !nativeResults.length &&
        view === "results" &&
        !workflow.isLoading &&
        !workflow.isError && <p>{t("settings.importWorkflow.noResults")}</p>}
    </section>
  )
}

function NativeResult({
  result,
  capability,
  companyId,
  taskId,
}: {
  result: ImportNativeResult
  capability?: ImportCapability
  companyId: number
  taskId: string
}) {
  const { t } = useTranslation()
  const receipt = result.receipt
  return (
    <article className="space-y-2 rounded border p-3 text-sm">
      <h5 className="break-words font-medium">
        {result.fileName ??
          t("settings.importWorkflow.savedNativeFile", {
            defaultValue: "Saved import file",
          })}
      </h5>
      {receipt ? (
        <>
          <p>
            {t("settings.importWorkflow.nativeCounts", {
              defaultValue:
                "Saved job #{{job}} · {{status}} · {{imported}} of {{total}} rows imported · {{errors}} errors",
              job: receipt.jobId,
              status: t(
                `settings.importWorkflow.nativeStatus.${receipt.status}`,
                { defaultValue: receipt.status },
              ),
              imported: receipt.rowsImported,
              total: receipt.totalRows,
              errors: receipt.errorRows,
            })}
          </p>
          <a
            className="inline-flex min-h-8 items-center underline"
            href={`/settings/import-jobs/${receipt.jobId}?${new URLSearchParams({ companyId: String(companyId), fromTask: taskId })}`}
          >
            {t("settings.importWorkflow.openNativeJob", {
              defaultValue: "Open import job and row errors",
            })}
          </a>
          {capability &&
            receipt.rowsImported > 0 &&
            (receipt.status === "success" || receipt.status === "partial") && (
              <a
                className="ml-0 inline-flex min-h-8 items-center underline sm:ml-3"
                href={capability.destination}
              >
                {t("settings.importWorkflow.openNativeCorrection", {
                  defaultValue:
                    "Review or correct {{destination}} in the owning module",
                  destination: capability.label,
                })}
              </a>
            )}
        </>
      ) : (
        <p role="status">
          {t("settings.importWorkflow.awaitingNativeReceipt", {
            defaultValue:
              "Submission saved; its native receipt is not available yet. Reload to check the same saved request.",
          })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("settings.importWorkflow.nativeSourceCount", {
          defaultValue:
            "{{count}} reviewed source rows are linked to this request.",
          count: result.reviewItemCount,
        })}
      </p>
      <div className="flex flex-wrap gap-3">
        {result.reviewIds.map((reviewId) => (
          <a
            key={reviewId}
            className="underline"
            href={importTaskHref({
              taskId,
              companyId,
              view: "decisions",
              reviewId,
            })}
          >
            {t("settings.importWorkflow.openNativeSource", {
              defaultValue: "Open source review #{{id}}",
              id: reviewId,
            })}
          </a>
        ))}
      </div>
    </article>
  )
}

function ProposalDetails({
  proposal,
  companyId,
  currency,
  journal,
  debit,
  credit,
  busy,
  action,
  onResolve,
  onReviewSource,
}: {
  proposal: ImportProposal
  companyId: number
  currency: string
  journal?: string
  debit?: string
  credit?: string
  busy: boolean
  action: (action: ImportProposalAction) => void
  onResolve: (decisions: DistinctExpenseDecision[]) => void
  onReviewSource?: (reviewId: string) => void
}) {
  const { t } = useTranslation()
  const { summary, result } = proposal
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [overlapDecisions, setOverlapDecisions] = useState<
    Record<string, { selected: boolean; reason: string }>
  >({})
  const resolvable =
    proposal.status === "prepared"
      ? proposal.issues.flatMap((issue) => {
          const source = proposal.sources.find(
            (source) => source.itemId === issue.itemId,
          )
          if (
            !source ||
            issue.resolution?.kind !== "distinct_expenses" ||
            !issue.candidates?.length ||
            issue.candidates.some(
              (candidate) =>
                candidate.reason === "same_source" ||
                candidate.reason === "same_reference",
            )
          )
            return []
          return [{ issue, source }]
        })
      : []
  const selectedResolutions = resolvable.filter(
    ({ source }) => overlapDecisions[source.itemId]?.selected,
  )
  const resolutionsReady =
    selectedResolutions.length > 0 &&
    selectedResolutions.every(
      ({ source }) =>
        (overlapDecisions[source.itemId]?.reason.trim().length ?? 0) >= 3,
    )
  return (
    <article
      className="space-y-3 rounded border p-4"
      data-testid="import-proposal"
    >
      <h4 className="font-medium">
        {t(`settings.importWorkflow.status.${proposal.status}`)}
      </h4>
      {proposal.kind === "opening_balances" && (
        <p>{t("settings.importWorkflow.openingBalanceTreatment")}</p>
      )}
      <p>
        {t("settings.importWorkflow.previewSummary", {
          records: summary.recordCount,
          lines: summary.lineCount,
          held: summary.blockedCount,
        })}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>{t("settings.importWorkflow.dateRange")}</dt>
        <dd>
          {summary.dateFrom ?? "—"} – {summary.dateTo ?? "—"}
        </dd>
        <dt>{t("settings.importWorkflow.journal")}</dt>
        <dd>{journal ?? t("settings.importWorkflow.referenceUnavailable")}</dd>
        <dt>{t(
            proposal.kind === "opening_balances"
              ? "settings.importWorkflow.openingDebitAccount"
              : "settings.importWorkflow.debitAccount",
          )}</dt>
        <dd>
          {debit ?? t("settings.importWorkflow.referenceUnavailable")} ·{" "}
          {summary.totalDebit} {currency}
        </dd>
        <dt>{t("settings.importWorkflow.creditAccount")}</dt>
        <dd>
          {credit ?? t("settings.importWorkflow.referenceUnavailable")} ·{" "}
          {summary.totalCredit} {currency}
        </dd>
        <dt>{t("settings.importWorkflow.reason")}</dt>
        <dd>{proposal.configuration.reason}</dd>
      </dl>
      {!!proposal.issues.length && (
        <details open>
          <summary>{t("settings.importWorkflow.holds")}</summary>
          <ul className="space-y-3 text-sm">
            {proposal.issues.map((issue, index) => {
              const resolution = resolvable.find(
                (candidate) => candidate.issue === issue,
              )
              const source = proposal.sources.find(
                (source) => source.itemId === issue.itemId,
              )
              const selected = resolution
                ? overlapDecisions[resolution.source.itemId]
                : undefined
              const confirmationLabel = resolution
                ? t("settings.importWorkflow.confirmDistinct", {
                    defaultValue:
                      "I reviewed these matches. Source row #{{id}} is a different expense.",
                    id: resolution.source.itemId,
                  })
                : ""
              return (
                <li
                  key={`${issue.itemId}:${issue.code}:${index}`}
                  className="space-y-2 rounded border p-3"
                >
                  <p>{issue.message}</p>
                  {source && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <a
                        className="inline-flex min-h-8 items-center underline"
                        href={sourceReviewHistoryHref(String(companyId), {
                          batchId: source.batchId,
                          itemId: source.itemId,
                          revision: source.revision,
                        })}
                      >
                        {t("settings.importWorkflow.openHeldSource", {
                          defaultValue:
                            "Inspect source row #{{id}}, revision {{revision}}",
                          id: source.itemId,
                          revision: source.revision,
                        })}
                      </a>
                      {onReviewSource && (
                        <button
                          type="button"
                          className="min-h-8 text-left text-primary underline underline-offset-4"
                          onClick={() => onReviewSource(source.batchId)}
                        >
                          {t("settings.importWorkflow.reviewHeldGroup", {
                            defaultValue: "Review current source decisions",
                          })}
                        </button>
                      )}
                    </div>
                  )}
                  {!!issue.candidates?.length && (
                    <ul className="max-h-72 space-y-2 overflow-auto">
                      {issue.candidates.map((candidate, candidateIndex) => (
                        <li
                          key={`${candidate.proposalId}:${candidate.itemId}:${candidateIndex}`}
                          className="rounded bg-muted/30 p-2"
                        >
                          <p className="font-medium">
                            {candidate.amount}{" "}
                            {candidate.currencyId === summary.currencyId
                              ? currency
                              : `#${candidate.currencyId}`}
                          </p>
                          <p>
                            {t("settings.importWorkflow.overlapPeriod", {
                              defaultValue:
                                "Source period: {{from}} to before {{to}} · posting date: {{date}}",
                              from: candidate.dateFrom,
                              to: candidate.dateToExclusive,
                              date: candidate.postingDate,
                            })}
                          </p>
                          <p>
                            {t("settings.importWorkflow.overlapIdentity", {
                              defaultValue:
                                "Reference: {{reference}} · category: {{category}}",
                              reference: candidate.externalReference ?? "—",
                              category: candidate.category ?? "—",
                            })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {candidate.origin === "selected_rows"
                              ? t("settings.importWorkflow.overlapSelected", {
                                  defaultValue:
                                    "This preview · source row #{{id}} · revision {{revision}}",
                                  id: candidate.itemId,
                                  revision: candidate.sourceRevision,
                                })
                              : t("settings.importWorkflow.overlapSaved", {
                                  defaultValue:
                                    "Saved proposal #{{proposal}} · source row #{{id}} · revision {{revision}}",
                                  proposal: candidate.proposalId,
                                  id: candidate.itemId,
                                  revision: candidate.sourceRevision,
                                })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {resolution && (
                    <fieldset disabled={busy} className="space-y-2">
                      <label className="flex items-start gap-2">
                        <Checkbox
                          disabled={busy}
                          aria-label={confirmationLabel}
                          checked={selected?.selected ?? false}
                          onCheckedChange={(checked) =>
                            setOverlapDecisions((previous) => ({
                              ...previous,
                              [resolution.source.itemId]: {
                                selected: checked === true,
                                reason:
                                  previous[resolution.source.itemId]?.reason ??
                                  "",
                              },
                            }))
                          }
                        />
                        <span>{confirmationLabel}</span>
                      </label>
                      {selected?.selected && (
                        <TextField
                          label={t("settings.importWorkflow.distinctReason", {
                            defaultValue:
                              "Why source row #{{id}} is a different expense",
                            id: resolution.source.itemId,
                          })}
                          value={selected.reason}
                          maxLength={2000}
                          onChange={(reason) =>
                            setOverlapDecisions((previous) => ({
                              ...previous,
                              [resolution.source.itemId]: {
                                selected: true,
                                reason,
                              },
                            }))
                          }
                        />
                      )}
                    </fieldset>
                  )}
                </li>
              )
            })}
          </ul>
          {resolvable.length > 0 && (
            <Button
              className="mt-3"
              disabled={busy || !resolutionsReady}
              onClick={() =>
                onResolve(
                  selectedResolutions.map(({ issue, source }) => ({
                    itemId: source.itemId,
                    sourceRevision: source.revision,
                    candidateDigest: issue.resolution!.candidateDigest,
                    reason: overlapDecisions[source.itemId]!.reason.trim(),
                  })),
                )
              }
            >
              {t("settings.importWorkflow.prepareDistinct", {
                defaultValue: "Prepare new preview with these decisions",
              })}
            </Button>
          )}
        </details>
      )}
      {!!proposal.configuration.distinctExpenses?.length && (
        <details open>
          <summary>
            {t("settings.importWorkflow.savedDistinctDecisions", {
              defaultValue: "Saved decisions about different expenses",
            })}
          </summary>
          <ul className="space-y-1 text-sm">
            {proposal.configuration.distinctExpenses.map((decision) => (
              <li key={decision.itemId}>
                {t("settings.importWorkflow.savedDistinctReason", {
                  defaultValue:
                    "Source row #{{id}}, revision {{revision}}: {{reason}}",
                  id: decision.itemId,
                  revision: decision.sourceRevision,
                  reason: decision.reason,
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
      {proposal.lastError && (
        <p role="alert" className="text-sm text-destructive">
          {proposal.lastError}
        </p>
      )}
      <details>
        <summary className="cursor-pointer">
          {t("settings.importWorkflow.sourceRows")}
        </summary>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings.importWorkflow.source")}</TableHead>
              <TableHead>{t("settings.importWorkflow.date")}</TableHead>
              <TableHead>{t("settings.importWorkflow.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposal.entries.map((entry) => (
              <TableRow key={entry.itemId}>
                <TableCell>
                  <a
                    className="underline"
                    href={sourceReviewHistoryHref(String(companyId), {
                      batchId: entry.batchId,
                      itemId: entry.itemId,
                      revision: entry.sourceRevision,
                    })}
                  >
                    {entry.sourceFile}:{entry.sourceRow}
                  </a>
                  <p>{entry.description}</p>
                </TableCell>
                <TableCell>{entry.date}</TableCell>
                <TableCell>
                  {entry.amount} {currency}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
      {proposal.status === "prepared" && (
        <Button
          disabled={busy || !summary.recordCount}
          onClick={() => action("approve")}
        >
          {t("settings.importWorkflow.approve")}
        </Button>
      )}
      {proposal.status === "approved" && (
        <Button disabled={busy} onClick={() => action("execute")}>
          {t("settings.importWorkflow.execute")}
        </Button>
      )}
      {(proposal.status === "executing" ||
        (proposal.status === "blocked" && proposal.approvedAt)) && (
        <div className="space-y-2">
          <p role="status">{t("settings.importWorkflow.pendingExplanation")}</p>
          {proposal.status === "blocked" && (
            <p className="text-sm text-muted-foreground">
              {t("settings.importWorkflow.blockedReprepare", {
                defaultValue:
                  "You can prepare another preview with revised source rows or accounting choices. Rows whose earlier results remain unresolved will be held. A new preview requires its own approval.",
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => action("execute")}>
              {t("settings.importWorkflow.resume")}
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => action("verify")}
            >
              {t("settings.importWorkflow.verify")}
            </Button>
          </div>
        </div>
      )}
      {proposal.status === "rolled_back" && (
        <p role="status">{t("settings.importWorkflow.rollbackComplete")}</p>
      )}
      {result && (
        <div className="space-y-2" role="status">
          <p>
            {t("settings.importWorkflow.verified", {
              records: result.recordCount,
              lines: result.lineCount,
              amount: result.totalDebit,
              currency,
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("settings.importWorkflow.unposted")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("settings.importWorkflow.correctInAccounting", {
              defaultValue:
                "Open a record in Accounting to make corrections. This import keeps its original approval and receipt.",
            })}
          </p>
          <details>
            <summary className="cursor-pointer">
              {t("settings.importWorkflow.openRecords")}
            </summary>
            <ul className="flex flex-wrap gap-3">
              {result.recordIds.map((id, index) => (
                <li key={id}>
                  <a
                    className="underline"
                    href={`/accounting/invoices/${id}?companyId=${companyId}`}
                  >
                    {proposal.entries[index]?.reference ??
                      t("settings.importWorkflow.record", { id })}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {(proposal.canRollback ?? result !== null) && (
        <AlertDialog open={confirmRollback} onOpenChange={setConfirmRollback}>
          <AlertDialogTrigger
            render={<Button variant="outline" disabled={busy} />}
          >
            {t("settings.importWorkflow.rollbackDrafts")}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings.importWorkflow.rollbackDrafts")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings.importWorkflow.rollbackDescription", {
                  count: summary.recordCount,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                variant="destructive"
                onClick={() => {
                  setConfirmRollback(false)
                  action("rollback")
                }}
              >
                {t("settings.importWorkflow.rollbackConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </article>
  )
}

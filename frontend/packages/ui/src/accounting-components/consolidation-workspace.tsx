"use client"

import { useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { FormModal } from "@/components/forms/form-modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  newConsolidationAccountForm,
  editConsolidationAccountForm,
  newConsolidationJournalForm,
  newEliminationEntryForm,
} from "@/lib/accounting-form-configs"
import { mergeFieldDefaultValues, mergeSelectOptionsForFields } from "@/lib/form-config-merge"
import {
  toCreateConsolidationAccountParams,
  toCreateConsolidationJournalParams,
  toCreateEliminationEntryParams,
} from "@lumiere/erp-shared/accounting-create-params"

function consolidationStateTag(row: Record<string, unknown>): string {
  const v = row.state
  if (v != null && typeof v === "object" && "tag" in v) return String((v as { tag: string }).tag)
  return String(v ?? "Draft")
}

function stateVariant(
  state: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (state) {
    case "Completed":
      return "default"
    case "InProgress":
      return "secondary"
    case "Cancelled":
      return "destructive"
    default:
      return "outline"
  }
}

export interface ConsolidationWorkspaceProps {
  consolidationAccounts: Record<string, unknown>[]
  consolidationJournals: Record<string, unknown>[]
  eliminationEntries: Record<string, unknown>[]
  onCreateConsolidationAccount: (params: Record<string, unknown>) => void | Promise<void>
  onUpdateConsolidationAccount: (
    accountId: bigint,
    params: Record<string, unknown>,
  ) => void | Promise<void>
  onCreateConsolidationJournal: (params: Record<string, unknown>) => void | Promise<void>
  onCreateEliminationEntry: (params: Record<string, unknown>) => void | Promise<void>
  onProcessConsolidation: (journalId: bigint) => void | Promise<void>
  onValidateConsolidation: (journalId: bigint) => void | Promise<void>
  onCancelConsolidation: (journalId: bigint, reason: string) => void | Promise<void>
  onMatchEliminationEntries: (entryId: bigint, matchedEntryId: bigint) => void | Promise<void>
  onUnmatchEliminationEntry: (entryId: bigint) => void | Promise<void>
  processConsolidationPending?: boolean
  validateConsolidationPending?: boolean
  cancelConsolidationPending?: boolean
  /** Companies included in new consolidation accounts/journals when the form omits companyIds. */
  consolidationCompanyIds?: bigint[]
  /**
   * Optional name→id fallback when the journal form has no `periodId`.
   * Prefer selecting a period via the `periodId` relation field.
   */
  resolveConsolidationPeriodId?: (periodName: string) => bigint | undefined
  /** Select options merged into consolidation create/edit forms. */
  companySelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  currencySelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  consolidationJournalSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
  consolidationAccountSelectOptions?: Array<{ value: string; label: string; disabled?: boolean }>
}

export function ConsolidationWorkspace({
  consolidationAccounts,
  consolidationJournals,
  eliminationEntries,
  onCreateConsolidationAccount,
  onUpdateConsolidationAccount,
  onCreateConsolidationJournal,
  onCreateEliminationEntry,
  onProcessConsolidation,
  onValidateConsolidation,
  onCancelConsolidation,
  onMatchEliminationEntries,
  onUnmatchEliminationEntry,
  processConsolidationPending,
  validateConsolidationPending,
  cancelConsolidationPending,
  consolidationCompanyIds = [],
  resolveConsolidationPeriodId,
  companySelectOptions = [],
  currencySelectOptions = [],
  consolidationJournalSelectOptions = [],
  consolidationAccountSelectOptions = [],
}: ConsolidationWorkspaceProps) {
  const { t } = useTranslation()

  const [showNewAccount, setShowNewAccount] = useState(false)
  const [editAccount, setEditAccount] = useState<Record<string, unknown> | null>(null)
  const [showNewJournal, setShowNewJournal] = useState(false)
  const [selectedJournal, setSelectedJournal] = useState<Record<string, unknown> | null>(null)
  const [showNewElimination, setShowNewElimination] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [matchTargetId, setMatchTargetId] = useState("")

  const editAccountFormConfig = useMemo(() => {
    if (!editAccount) return editConsolidationAccountForm(t, {
      accountId: "",
      name: "",
      code: "",
      accountType: "asset",
      consolidationRate: 100,
      currencyId: "1",
      eliminationMethod: "",
      isIntercompany: false,
      isActive: true,
      notes: "",
    })
    return editConsolidationAccountForm(t, {
      accountId: String(editAccount.id ?? ""),
      name: String(editAccount.name ?? ""),
      code: String(editAccount.code ?? ""),
      accountType: String(editAccount.accountType ?? "asset"),
      consolidationRate: Number(editAccount.consolidationRate ?? 100),
      currencyId: String(editAccount.currencyId ?? "1"),
      eliminationMethod:
        editAccount.eliminationMethod != null ? String(editAccount.eliminationMethod) : "",
      isIntercompany: Boolean(editAccount.isIntercompany),
      isActive: Boolean(editAccount.isActive),
      notes: editAccount.notes != null ? String(editAccount.notes) : "",
    })
  }, [editAccount, t])

  const journalEntriesForSelected = useMemo(() => {
    if (!selectedJournal?.id) return []
    const jid = String(selectedJournal.id)
    return eliminationEntries.filter((e) => String(e.journalId) === jid)
  }, [selectedJournal, eliminationEntries])

  const selectedJournalState = useMemo(
    () => (selectedJournal ? consolidationStateTag(selectedJournal) : ""),
    [selectedJournal],
  )

  const newConsolidationAccountFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newConsolidationAccountForm(t), {
        currencyId: currencySelectOptions,
      }),
    [t, currencySelectOptions],
  )

  const newConsolidationJournalFormConfig = useMemo(
    () =>
      mergeSelectOptionsForFields(newConsolidationJournalForm(t), {
        currencyId: currencySelectOptions,
      }),
    [t, currencySelectOptions],
  )

  const newEliminationFormWithJournal = useMemo(() => {
    const base = mergeSelectOptionsForFields(newEliminationEntryForm(t), {
      journalId: consolidationJournalSelectOptions,
      accountId: consolidationAccountSelectOptions,
      companyId: companySelectOptions,
      currencyId: currencySelectOptions,
    })
    if (!selectedJournal?.id) return base
    return mergeFieldDefaultValues(base, { journalId: String(selectedJournal.id) })
  }, [
    selectedJournal,
    t,
    consolidationJournalSelectOptions,
    consolidationAccountSelectOptions,
    companySelectOptions,
    currencySelectOptions,
  ])

  return (
    <div className="space-y-6">
      {/* ── Consolidation accounts ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {t("accounting.consolidation.accounts.title")}
            </CardTitle>
            <CardDescription>
              {t("accounting.consolidation.accounts.description")}
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowNewAccount(true)}>
            {t("accounting.consolidation.accounts.newAccount")}
          </Button>
        </CardHeader>
        <CardContent>
          {consolidationAccounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("accounting.consolidation.accounts.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("accounting.consolidation.accounts.colCode")}</TableHead>
                    <TableHead>{t("accounting.consolidation.accounts.colName")}</TableHead>
                    <TableHead>{t("accounting.consolidation.accounts.colType")}</TableHead>
                    <TableHead className="text-right">
                      {t("accounting.consolidation.accounts.colRate")}
                    </TableHead>
                    <TableHead>{t("accounting.consolidation.accounts.colIntercompany")}</TableHead>
                    <TableHead>{t("accounting.consolidation.accounts.colActive")}</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consolidationAccounts.map((acct) => (
                    <TableRow key={String(acct.id)}>
                      <TableCell className="font-mono text-sm">{String(acct.code ?? "")}</TableCell>
                      <TableCell>{String(acct.name ?? "")}</TableCell>
                      <TableCell>{String(acct.accountType ?? "")}</TableCell>
                      <TableCell className="text-right">
                        {Number(acct.consolidationRate ?? 0).toFixed(2)}%
                      </TableCell>
                      <TableCell>
                        {acct.isIntercompany ? t("common.yes") : t("common.no")}
                      </TableCell>
                      <TableCell>
                        {acct.isActive ? (
                          <Badge variant="default">{t("common.active")}</Badge>
                        ) : (
                          <Badge variant="outline">{t("common.inactive")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => setEditAccount(acct)}
                        >
                          {t("common.edit")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Consolidation journals ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {t("accounting.consolidation.journals.title")}
            </CardTitle>
            <CardDescription>
              {t("accounting.consolidation.journals.description")}
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowNewJournal(true)}>
            {t("accounting.consolidation.journals.newJournal")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {consolidationJournals.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("accounting.consolidation.journals.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("accounting.consolidation.journals.colName")}</TableHead>
                    <TableHead>{t("accounting.consolidation.journals.colPeriod")}</TableHead>
                    <TableHead>{t("accounting.consolidation.journals.colState")}</TableHead>
                    <TableHead className="text-right">
                      {t("accounting.consolidation.journals.colDebit")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("accounting.consolidation.journals.colCredit")}
                    </TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consolidationJournals.map((j) => {
                    const state = consolidationStateTag(j)
                    const isSelected = selectedJournal?.id != null && String(selectedJournal.id) === String(j.id)
                    return (
                      <TableRow
                        key={String(j.id)}
                        className={isSelected ? "bg-muted/40" : "cursor-pointer hover:bg-muted/20"}
                        onClick={() =>
                          setSelectedJournal((prev) =>
                            prev?.id != null && String(prev.id) === String(j.id) ? null : j,
                          )
                        }
                      >
                        <TableCell className="font-medium">{String(j.name ?? "")}</TableCell>
                        <TableCell>{String(j.periodName ?? "")}</TableCell>
                        <TableCell>
                          <Badge variant={stateVariant(state)}>{state}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(j.totalDebit ?? 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(j.totalCredit ?? 0).toLocaleString()}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            {state === "Draft" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2"
                                disabled={processConsolidationPending}
                                onClick={() => onProcessConsolidation(BigInt(String(j.id)))}
                              >
                                {t("accounting.consolidation.journals.process")}
                              </Button>
                            )}
                            {state === "InProgress" && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 px-2"
                                disabled={validateConsolidationPending}
                                onClick={() => onValidateConsolidation(BigInt(String(j.id)))}
                              >
                                {t("accounting.consolidation.journals.validate")}
                              </Button>
                            )}
                            {(state === "Draft" || state === "InProgress") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-destructive"
                                disabled={cancelConsolidationPending}
                                onClick={() => {
                                  setSelectedJournal(j)
                                  setShowCancelDialog(true)
                                }}
                              >
                                {t("common.cancel")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Selected journal: elimination entries */}
          {selectedJournal && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">
                  {t("accounting.consolidation.elimination.title")} —{" "}
                  {String(selectedJournal.name ?? "")}
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedJournalState === "Completed" || selectedJournalState === "Cancelled"}
                  onClick={() => setShowNewElimination(true)}
                >
                  {t("accounting.consolidation.elimination.newEntry")}
                </Button>
              </div>
              {journalEntriesForSelected.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("accounting.consolidation.elimination.empty")}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("accounting.consolidation.elimination.colName")}</TableHead>
                        <TableHead>{t("accounting.consolidation.elimination.colAccount")}</TableHead>
                        <TableHead>{t("accounting.consolidation.elimination.colType")}</TableHead>
                        <TableHead className="text-right">
                          {t("accounting.consolidation.elimination.colDebit")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("accounting.consolidation.elimination.colCredit")}
                        </TableHead>
                        <TableHead>{t("accounting.consolidation.elimination.colMatched")}</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {journalEntriesForSelected.map((entry) => (
                        <TableRow key={String(entry.id)}>
                          <TableCell>{String(entry.name ?? "")}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {String(entry.accountCode ?? "")} {String(entry.accountName ?? "")}
                          </TableCell>
                          <TableCell>{String(entry.eliminationType ?? "")}</TableCell>
                          <TableCell className="text-right">
                            {Number(entry.debit ?? 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(entry.credit ?? 0).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {entry.isMatched ? (
                              <Badge variant="default">{t("common.yes")}</Badge>
                            ) : (
                              <Badge variant="outline">{t("common.no")}</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.isMatched ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2"
                                onClick={() => {
                                  if (!entry.id) return
                                  void onUnmatchEliminationEntry(BigInt(String(entry.id)))
                                }}
                              >
                                {t("accounting.consolidation.elimination.unmatch")}
                              </Button>
                            ) : (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  className="h-7 w-20 rounded-md border px-2 text-xs"
                                  placeholder={t("accounting.consolidation.elimination.matchIdPlaceholder")}
                                  value={matchTargetId}
                                  onChange={(e) => setMatchTargetId(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 px-2"
                                  disabled={!matchTargetId.trim()}
                                  onClick={() => {
                                    if (!entry.id || !matchTargetId.trim()) return
                                    void onMatchEliminationEntries(
                                      BigInt(String(entry.id)),
                                      BigInt(matchTargetId.trim()),
                                    )
                                    setMatchTargetId("")
                                  }}
                                >
                                  {t("accounting.consolidation.elimination.match")}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      <FormModal
        open={showNewAccount}
        onOpenChange={(open) => {
          if (!open) setShowNewAccount(false)
        }}
        config={newConsolidationAccountFormConfig}
        onSubmit={async (fd) => {
          const params = toCreateConsolidationAccountParams(fd, {
            companyIds: consolidationCompanyIds,
          })
          if (!params) throw new Error(t("common.paramsMapper.invalidConsolidationAccount"))
          await onCreateConsolidationAccount(params as unknown as Record<string, unknown>)
          setShowNewAccount(false)
        }}
      />

      <FormModal
        key={editAccount ? `ca-edit-${String(editAccount.id)}` : "ca-edit-closed"}
        open={!!editAccount}
        onOpenChange={(open) => {
          if (!open) setEditAccount(null)
        }}
        config={editAccountFormConfig}
        onSubmit={async (fd) => {
          const idRaw = fd.accountId
          if (idRaw == null || idRaw === "") return
          const { accountId: _id, ...rest } = fd
          await onUpdateConsolidationAccount(BigInt(String(idRaw)), rest)
          setEditAccount(null)
        }}
      />

      <FormModal
        open={showNewJournal}
        onOpenChange={(open) => {
          if (!open) setShowNewJournal(false)
        }}
        config={newConsolidationJournalFormConfig}
        onSubmit={async (fd) => {
          const periodIdFromForm =
            fd.periodId != null && String(fd.periodId).trim() !== ""
              ? BigInt(String(fd.periodId))
              : undefined
          const periodId =
            periodIdFromForm ??
            resolveConsolidationPeriodId?.(String(fd.periodName ?? "").trim())
          if (periodId === undefined) {
            throw new Error(t("common.paramsMapper.periodNotFound"))
          }
          const params = toCreateConsolidationJournalParams(fd, {
            periodId,
            companyIds: consolidationCompanyIds,
          })
          if (!params) throw new Error(t("common.paramsMapper.invalidConsolidationJournal"))
          await onCreateConsolidationJournal(params as unknown as Record<string, unknown>)
          setShowNewJournal(false)
        }}
      />

      <FormModal
        open={showNewElimination && !!selectedJournal?.id}
        onOpenChange={(open) => {
          if (!open) setShowNewElimination(false)
        }}
        config={newEliminationFormWithJournal}
        onSubmit={async (fd) => {
          const params = toCreateEliminationEntryParams(fd)
          if (!params) throw new Error(t("common.paramsMapper.invalidEliminationEntry"))
          await onCreateEliminationEntry(params as unknown as Record<string, unknown>)
          setShowNewElimination(false)
        }}
      />

      {/* Cancel dialog — inline simple prompt */}
      {showCancelDialog && selectedJournal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg space-y-4">
            <h3 className="font-semibold">
              {t("accounting.consolidation.journals.cancelTitle")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("accounting.consolidation.journals.cancelHint")}
            </p>
            <input
              type="text"
              className="h-9 w-full rounded-md border px-3 text-sm"
              placeholder={t("accounting.consolidation.journals.cancelReasonPlaceholder")}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowCancelDialog(false)
                  setCancelReason("")
                }}
              >
                {t("common.back")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={!cancelReason.trim() || cancelConsolidationPending}
                onClick={async () => {
                  await onCancelConsolidation(
                    BigInt(String(selectedJournal.id)),
                    cancelReason.trim(),
                  )
                  setShowCancelDialog(false)
                  setCancelReason("")
                }}
              >
                {t("accounting.consolidation.journals.confirmCancel")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

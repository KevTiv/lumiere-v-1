"use client"

import { useTableDensity } from "../hooks/use-table-density"
import { TableDensityControl } from "../composed/table-density-control"
import type { AccountMove } from "../lib/accounting-types"
import type { ModuleDataState } from "../lib/module-data-state"
import { useMemo, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import { ChevronDown } from "lucide-react"
import { Button } from "../components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/collapsible"
import { BillIntakeReview } from "./bill-intake-review"
import { billIntakeReview, type BillIntakeLine } from "./bill-intake-review-model"
import {
  AccountingWorklistView,
  type AccountingWorklistProps,
} from "./accounting-worklist-view"

export interface BillsListViewProps extends AccountingWorklistProps {
  bills: AccountMove[]
  onSelectBill?: (bill: AccountMove) => void
  onCreateBill?: () => void
  onPayBill?: (bill: AccountMove) => void
  onDownloadBill?: (bill: AccountMove) => void
  onRecalculateTotals?: (bill: AccountMove) => void
  intake?: {
    lines: readonly BillIntakeLine[]
    sourceState: ModuleDataState
    renderDocuments?: (bill: AccountMove) => ReactNode
  }
}

export function BillsListView({
  bills,
  onSelectBill,
  onCreateBill,
  onPayBill,
  onDownloadBill,
  intake,
  ...props
}: BillsListViewProps) {
  const [density, setDensity] = useTableDensity("accounting-bills-list")
  const { t } = useTranslation()
  const review = useMemo(() => intake?.sourceState.status === "ready" && props.worklistScope
    ? billIntakeReview({ bills, lines: intake.lines, organizationId: props.worklistScope.organizationId, companyId: props.worklistScope.companyId })
    : null, [bills, intake?.lines, intake?.sourceState.status, props.worklistScope])
  const intakeStatus = intake?.sourceState.status === "loading"
    ? t("common.loading", { defaultValue: "Loading…" })
    : intake?.sourceState.status === "denied"
      ? t("common.recordsDenied", { defaultValue: "You do not have access to these records." })
      : intake?.sourceState.status === "partial"
        ? t("common.recordsPartial", { defaultValue: "Some records could not be refreshed. Displayed records may be out of date." })
        : intake?.sourceState.status !== "ready"
          ? t("common.recordsUnavailable", { defaultValue: "Records could not be loaded." })
          : !review?.available
            ? t("accounting.billIntake.scopeUnavailable", { defaultValue: "Bill or journal line ownership is incomplete. Refresh the source records before reviewing intake." })
            : null
  return (
    <div
      className="space-y-4 data-[density=compact]:[&_tbody_td]:py-1 data-[density=comfortable]:[&_tbody_td]:py-3 [&_td]:tabular-nums"
      data-density={density}
      data-testid="finance-money-list"
    >
      <div className="space-y-4">
        {intake && props.worklistScope ? (
          <Collapsible key={`${String(props.worklistScope.organizationId)}:${String(props.worklistScope.companyId)}`} className="flex min-w-0 flex-col gap-3" data-testid="bill-intake-disclosure">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <CollapsibleTrigger render={<Button variant="ghost" className="h-auto min-h-11 max-w-full justify-between whitespace-normal text-left" />}>
                {t("accounting.billIntake.title", { defaultValue: "Bill intake review" })}<ChevronDown data-icon="inline-end" />
              </CollapsibleTrigger>
              <p role="status" className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="bill-intake-summary">
                {intakeStatus ?? <>{t("accounting.billIntake.draftCountLabel", { defaultValue: "Draft bills to review" })}: <span className="tabular-nums">{review?.items.length}</span></>}
              </p>
            </div>
            <CollapsibleContent keepMounted>
              <BillIntakeReview
                organizationId={props.worklistScope.organizationId}
                companyId={props.worklistScope.companyId}
                bills={bills}
                lines={intake.lines}
                sourceState={intake.sourceState}
                onOpenBill={onSelectBill}
                renderDocuments={intake.renderDocuments}
              />
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        <AccountingWorklistView
          viewSettings={
            <TableDensityControl value={density} onChange={setDensity} />
          }
          {...props}
          kind="bill"
          rows={bills}
          onSelect={onSelectBill}
          onCreate={onCreateBill}
          onPay={onPayBill}
          onDownload={onDownloadBill}
        />
      </div>
    </div>
  )
}

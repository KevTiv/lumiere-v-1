"use client"
import { useRef, useState, type FormEvent } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useAiFinanceReview } from "@lumiere/query-hooks/hooks/ai-skills"
import { useAiAgents } from "@lumiere/query-hooks/hooks/ai-agents"
import { Button } from "@lumiere/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Textarea } from "@lumiere/ui/components/textarea"
import { Field, FieldLabel } from "@lumiere/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import {
  companyRowsToSelectOptions,
  type CompanyLookupRow,
} from "../../../lib/form-lookup"
import { SavedRunObservation } from "./run-observation-panel"
import {
  financeReviewInput,
  financeReviewSkills,
  type FinanceReviewSkill,
  type FinanceReviewFields,
} from "./finance-review-model"

export function FinanceReviewPanel({
  organizationId,
  companies,
  savedRun,
}: {
  organizationId: bigint
  companies: readonly CompanyLookupRow[]
  savedRun?: { companyId: number; runId: number }
}) {
  const { t } = useTranslation()
  const options = companyRowsToSelectOptions(companies)
  const [company, setCompany] = useState(
    savedRun ? String(savedRun.companyId) : (options[0]?.value ?? ""),
  )
  const [agent, setAgent] = useState("")
  const [skill, setSkill] = useState<FinanceReviewSkill>(
    "finance_report_review",
  )
  const [fields, setFields] = useState<FinanceReviewFields>({
    reportKey: "customer_balances_v1",
    date: "",
    baselineDate: "",
    timezone: "UTC",
    recordId: "",
    recordKind: "expense",
    query: "",
  })
  const agents = useAiAgents(Number(organizationId), organizationId > 0n)
  const review = useAiFinanceReview(skill)
  const submitting = useRef(false)
  const available = (agents.data ?? []).filter(
    (a) =>
      a.isActive &&
      Number.isSafeInteger(Number(a.id)) &&
      Number(a.id) > 0 &&
      Number(a.organizationId) === Number(organizationId) &&
      (a.companyId == null || String(a.companyId) === company),
  )
  const selectedAgent = available.find((a) => String(a.id) === agent)
  const inputs = financeReviewInput(skill, fields)
  const report =
    skill === "finance_report_review" || skill === "finance_variance_review"
  const setField = (key: keyof FinanceReviewFields, value: string) => {
    setFields((previous) => ({ ...previous, [key]: value }))
    review.reset()
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (
      !inputs ||
      !selectedAgent ||
      !Number.isSafeInteger(Number(company)) ||
      Number(company) <= 0 ||
      submitting.current
    )
      return
    submitting.current = true
    try {
      await review.mutateAsync({
        companyId: Number(company),
        agentId: Number(selectedAgent.id),
        inputs,
      })
    } catch {
      /* Preserve the error and inspect before any explicit new run. */
    } finally {
      submitting.current = false
    }
  }
  const choose = (
    id: string,
    label: string,
    value: string,
    change: (value: string) => void,
    items: { value: string; label: string }[],
  ) => (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={change}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
  const textField = (key: keyof FinanceReviewFields, type = "text") => (
    <Field>
      <FieldLabel htmlFor={`finance-${key}`}>
        {t(`aiHarness.finance.${key}`)}
      </FieldLabel>
      <Input
        id={`finance-${key}`}
        type={type}
        value={fields[key]}
        onChange={(event) => setField(key, event.target.value)}
        required
      />
    </Field>
  )
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("aiHarness.finance.title")}</CardTitle>
          <CardDescription>
            {t("aiHarness.finance.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)}>
            <fieldset
              disabled={review.isPending}
              className="flex flex-col gap-4"
            >
              {choose(
                "finance-company",
                t("aiHarness.reportAnalysis.company"),
                company,
                (value) => {
                  setCompany(value)
                  setAgent("")
                  review.reset()
                },
                options,
              )}
              {choose(
                "finance-agent",
                t("aiHarness.reportAnalysis.agent"),
                agent,
                (value) => {
                  setAgent(value)
                  review.reset()
                },
                available.map((a) => ({ value: String(a.id), label: a.name })),
              )}
              {choose(
                "finance-skill",
                t("aiHarness.finance.skill"),
                skill,
                (value) => {
                  setSkill(value as FinanceReviewSkill)
                  review.reset()
                },
                financeReviewSkills.map((value) => ({
                  value,
                  label: t(`aiHarness.finance.${value}`),
                })),
              )}
              {report ? (
                <>
                  {choose(
                    "finance-report",
                    t("aiHarness.finance.reportKey"),
                    fields.reportKey,
                    (value) => setField("reportKey", value),
                    [
                      "cash_mobile_money_v1",
                      "customer_balances_v1",
                      "supplier_payables_v1",
                    ].map((value) => ({
                      value,
                      label: t(`aiHarness.finance.${value}`),
                    })),
                  )}
                  {textField("date", "date")}
                  {skill === "finance_variance_review" &&
                    textField("baselineDate", "date")}
                  {textField("timezone")}
                </>
              ) : (
                <>
                  {skill === "expense_evidence_review" &&
                    choose(
                      "finance-kind",
                      t("aiHarness.finance.recordKind"),
                      fields.recordKind,
                      (value) => setField("recordKind", value),
                      ["expense", "bill"].map((value) => ({
                        value,
                        label: t(`aiHarness.finance.${value}`),
                      })),
                    )}
                  {textField("recordId")}
                </>
              )}
              <Field>
                <FieldLabel htmlFor="finance-query">
                  {t("aiHarness.finance.question")}
                </FieldLabel>
                <Textarea
                  id="finance-query"
                  maxLength={4000}
                  value={fields.query}
                  onChange={(event) => setField("query", event.target.value)}
                />
              </Field>
              <p className="text-sm text-muted-foreground">
                {t("aiHarness.reportAnalysis.spendNotice")}
              </p>
              <Button
                type="submit"
                disabled={
                  !inputs ||
                  !selectedAgent ||
                  !company ||
                  agents.isError ||
                  agents.isPending ||
                  review.isPending
                }
              >
                {t(
                  review.isPending
                    ? "aiHarness.reportAnalysis.running"
                    : "aiHarness.reportAnalysis.run",
                )}
              </Button>
            </fieldset>
          </form>
          {agents.isError && (
            <p role="alert">
              {t("aiHarness.reportAnalysis.agentsUnavailable")}
            </p>
          )}
          {!agents.isPending && available.length === 0 && (
            <p role="status">{t("aiHarness.reportAnalysis.noAgents")}</p>
          )}
        </CardContent>
      </Card>
      {review.isError && <p role="alert">{t("aiHarness.finance.failed")}</p>}
      {review.data && (
        <Card>
          <CardContent className="pt-6">
            <p className="whitespace-pre-wrap">{review.data.summary}</p>
            {review.data.run && review.data.run.run_id > 0 && (
              <a
                className="underline"
                href={`/ai-harness?tab=finance-reviews&companyId=${company}&runId=${review.data.run.run_id}`}
              >
                {t("aiHarness.reportAnalysis.inspect")}
              </a>
            )}
          </CardContent>
        </Card>
      )}
      {savedRun && String(savedRun.companyId) === company && (
        <SavedRunObservation
          key={`${company}:${savedRun.runId}`}
          companyId={savedRun.companyId}
          runId={savedRun.runId}
        />
      )}
    </div>
  )
}

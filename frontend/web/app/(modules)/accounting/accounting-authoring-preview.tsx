"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import type { FormConfig, FormValues } from "@lumiere/ui/lib/form-types"
import { Alert, AlertDescription } from "@lumiere/ui/components/alert"
import { Badge } from "@lumiere/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Field, FieldGroup, FieldLabel } from "@lumiere/ui/components/field"
import { Input } from "@lumiere/ui/components/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@lumiere/ui/components/table"
import { instalmentAmountExample, instalmentDateExample, proposedLedgerTotals, taxAmountExample } from "./accounting-authoring-model"
import { DatePicker } from "@lumiere/ui/components/date-picker"

type LedgerMove = Parameters<typeof proposedLedgerTotals>[2][number]
type LedgerLine = Parameters<typeof proposedLedgerTotals>[3][number]

const supportedForms = new Set(["new-journal-entry", "add-account-move-line", "new-tax", "new-payment-term", "new-payment-term-line", "edit-payment-term-line"])

export function hasAccountingAuthoringPreview(formId: string): boolean {
  return supportedForms.has(formId)
}

export interface AccountingAuthoringPreviewProps {
  config: FormConfig
  values: FormValues
  companyId: string
  companyLabel: string
  currencyLabel: string
  moves: readonly LedgerMove[]
  moveLines: readonly LedgerLine[]
  ledgerLoaded: boolean
}

const money = (amount: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount)

function optionLabel(config: FormConfig, fieldName: string, value: unknown): string {
  const field = config.sections.flatMap((section) => section.fields).find((candidate) => candidate.name === fieldName)
  return field && "options" in field
    ? field.options.find((option) => option.value === String(value ?? ""))?.label ?? "—"
    : String(value ?? "") || "—"
}

export function AccountingAuthoringPreview(props: AccountingAuthoringPreviewProps) {
  const { t } = useTranslation()
  const { config, values, companyLabel, currencyLabel } = props
  if (!hasAccountingAuthoringPreview(config.id)) return null
  const isTax = config.id === "new-tax"
  const isTerm = config.id.includes("payment-term")
  return (
    <Card data-testid={`accounting-authoring-preview-${config.id}`}>
      <CardHeader>
        <CardTitle>{isTax
          ? t("accounting.authoring.taxExampleTitle", { defaultValue: "Try this tax" })
          : isTerm
            ? t("accounting.authoring.termExampleTitle", { defaultValue: "Payment schedule preview" })
            : t("accounting.authoring.journalPreviewTitle", { defaultValue: "Journal preview" })}</CardTitle>
        <CardDescription>{companyLabel} · {currencyLabel}</CardDescription>
        <div><Badge variant="secondary">{t("accounting.authoring.unsavedPreview", { defaultValue: "Unsaved preview" })}</Badge></div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isTax ? <TaxExample values={values} /> : isTerm
          ? <PaymentTermExample values={values} config={config} />
          : <JournalPreview {...props} />}
      </CardContent>
    </Card>
  )
}

function TaxExample({ values }: { values: FormValues }) {
  const { t } = useTranslation()
  const [sample, setSample] = useState("100")
  const example = sample.trim() === "" ? null : taxAmountExample(values, Number(sample))
  return <>
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="tax-preview-sample">{t("accounting.authoring.sampleAmount", { defaultValue: "Example amount" })}</FieldLabel>
        <Input id="tax-preview-sample" type="number" min="0" step="0.01" value={sample} onChange={(event) => setSample(event.target.value)} />
      </Field>
    </FieldGroup>
    <p>{String(values.name ?? "") || t("accounting.authoring.taxName", { defaultValue: "Your tax" })}</p>
    {example ? <Table>
      <TableHeader><TableRow><TableHead>{t("accounting.authoring.invoiceExample", { defaultValue: "Example invoice" })}</TableHead><TableHead className="text-right">{t("accounting.authoring.amount", { defaultValue: "Amount" })}</TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow><TableCell>{t("accounting.authoring.untaxed", { defaultValue: "Untaxed amount" })}</TableCell><TableCell className="text-right">{money(example.base)}</TableCell></TableRow>
        <TableRow><TableCell>{t("accounting.authoring.tax", { defaultValue: "Tax" })} ({String(values.amount)}%)</TableCell><TableCell className="text-right">{money(example.tax)}</TableCell></TableRow>
        <TableRow><TableCell>{t("accounting.authoring.total", { defaultValue: "Total" })}</TableCell><TableCell className="text-right">{money(example.total)}</TableCell></TableRow>
      </TableBody>
    </Table> : <Alert><AlertDescription>{t("accounting.authoring.taxPreviewLimited", { defaultValue: "Enter an amount and a valid percentage rate to see an example. Fixed and division taxes need the invoice calculation." })}</AlertDescription></Alert>}
    <p className="text-sm text-muted-foreground">{t("accounting.authoring.taxExampleOnly", { defaultValue: "Illustration for one tax only. This amount is not saved. The invoice calculation determines tax amounts and rounding." })}</p>
  </>
}

function JournalPreview({ config, values, companyId, moves, moveLines, ledgerLoaded }: AccountingAuthoringPreviewProps) {
  const { t } = useTranslation()
  const addingLine = config.id === "add-account-move-line"
  const totals = addingLine && ledgerLoaded ? proposedLedgerTotals(values, companyId, moves, moveLines) : null
  return <>
    <div className="flex flex-col gap-1">
      <p>{optionLabel(config, addingLine ? "moveId" : "journalId", values[addingLine ? "moveId" : "journalId"])}</p>
      <p className="text-sm text-muted-foreground">{String(addingLine ? values.name ?? "" : values.ref ?? "") || "—"}{!addingLine && values.date ? ` · ${String(values.date)}` : ""}</p>
    </div>
    <Table>
      <TableHeader><TableRow><TableHead>{t("accounting.authoring.account", { defaultValue: "Account" })}</TableHead><TableHead className="text-right">{t("accounting.authoring.debit", { defaultValue: "Debit" })}</TableHead><TableHead className="text-right">{t("accounting.authoring.credit", { defaultValue: "Credit" })}</TableHead></TableRow></TableHeader>
      <TableBody><TableRow>
        <TableCell>{addingLine ? optionLabel(config, "accountId", values.accountId) : t("accounting.authoring.noLines", { defaultValue: "No lines yet" })}</TableCell>
        <TableCell className="text-right">{addingLine && Number.isFinite(Number(values.debit)) && values.debit !== "" ? money(Number(values.debit)) : "—"}</TableCell>
        <TableCell className="text-right">{addingLine && Number.isFinite(Number(values.credit)) && values.credit !== "" ? money(Number(values.credit)) : "—"}</TableCell>
      </TableRow></TableBody>
    </Table>
    {totals ? <>
      <p className="text-sm">{t("accounting.authoring.proposedTotals", { defaultValue: "After adding this line: debit {{debit}}, credit {{credit}}.", debit: money(totals.debit), credit: money(totals.credit) })}</p>
      <p className="text-sm">{t("accounting.authoring.difference", { defaultValue: "Remaining difference: {{amount}}", amount: money(Math.abs(totals.difference)) })}</p>
    </> : null}
    <Alert><AlertDescription>{addingLine
      ? t("accounting.authoring.linePreviewOnly", { defaultValue: "This line is not saved. Totals use the loaded current-company draft when available. The server checks the entry before posting." })
      : t("accounting.authoring.headerOnly", { defaultValue: "This action creates a draft header only. After saving, add debit and credit lines in Journal items, then review and post the entry." })}</AlertDescription></Alert>
  </>
}

function PaymentTermExample({ config, values }: { config: FormConfig; values: FormValues }) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState("1000")
  const [invoiceDate, setInvoiceDate] = useState("")
  const headerOnly = config.id === "new-payment-term"
  const dueDate = instalmentDateExample(invoiceDate, values)
  const instalmentAmount = amount.trim() === "" ? null : instalmentAmountExample(Number(amount), values)
  if (headerOnly) return <>
    <p>{String(values.name ?? "") || t("accounting.authoring.termName", { defaultValue: "Your payment terms" })}</p>
    <Table><TableHeader><TableRow><TableHead>{t("accounting.authoring.instalment", { defaultValue: "Instalment" })}</TableHead><TableHead>{t("accounting.authoring.dueDate", { defaultValue: "Due date" })}</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell colSpan={2}>{t("accounting.authoring.noInstalments", { defaultValue: "No instalments yet" })}</TableCell></TableRow></TableBody></Table>
    <Alert><AlertDescription>{t("accounting.authoring.termHeaderOnly", { defaultValue: "Save the terms, then add payment term lines to define amounts and due dates. A name alone does not create an instalment schedule." })}</AlertDescription></Alert>
  </>
  return <>
    <p>{optionLabel(config, "paymentTermId", values.paymentTermId)}</p>
    <FieldGroup>
      <Field><FieldLabel htmlFor="term-preview-amount">{t("accounting.authoring.exampleInvoiceAmount", { defaultValue: "Example invoice amount" })}</FieldLabel><Input id="term-preview-amount" type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      <Field><FieldLabel htmlFor="term-preview-date">{t("accounting.authoring.exampleInvoiceDate", { defaultValue: "Example invoice date" })}</FieldLabel><DatePicker id="term-preview-date" value={invoiceDate} onChange={(value) => setInvoiceDate(value)} /></Field>
    </FieldGroup>
    <Table><TableHeader><TableRow><TableHead>{t("accounting.authoring.instalment", { defaultValue: "Instalment" })}</TableHead><TableHead>{t("accounting.authoring.dueDate", { defaultValue: "Due date" })}</TableHead></TableRow></TableHeader><TableBody><TableRow>
      <TableCell>{values.value === "Balance" ? t("accounting.authoring.remainingBalance", { defaultValue: "Remaining balance" }) : instalmentAmount == null ? "—" : money(instalmentAmount)}</TableCell>
      <TableCell>{dueDate ?? t("accounting.authoring.calendarRule", { defaultValue: "See date rule below" })}</TableCell>
    </TableRow></TableBody></Table>
    <p className="text-sm">{t("accounting.authoring.offsetRule", { defaultValue: "Date rule: {{months}} month(s), {{days}} day(s).", months: String(values.months ?? 0), days: String(values.days ?? 0) })}{values.daysAfterEndOfMonth === true ? ` ${t("accounting.authoring.fromMonthEnd", { defaultValue: "Count from the end of the month." })}` : ""}</p>
    <p className="text-sm text-muted-foreground">{t("accounting.authoring.termExampleOnly", { defaultValue: "Illustration of this line only. Sample inputs are not saved. The full schedule determines the balance, calendar-month dates, and rounding." })}</p>
  </>
}

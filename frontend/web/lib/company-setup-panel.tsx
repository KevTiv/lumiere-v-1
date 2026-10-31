"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@lumiere/ui/components/button"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import {
  CompanySetupAdmissionError,
  companySetupLinks,
  companySetupValidation,
  decodeCompanySetupDraft,
  type CompanySetupDraft,
  type HistoricalDataMode,
  type SetupOption,
  type TaxRegistration,
} from "./company-setup-model"

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
const countrySuggestions = [
  { value: "RW", label: "Rwanda" },
  { value: "BI", label: "Burundi" },
  { value: "KE", label: "Kenya" },
  { value: "TZ", label: "Tanzania" },
  { value: "UG", label: "Uganda" },
  { value: "CD", label: "Democratic Republic of the Congo" },
  { value: "NL", label: "Netherlands" },
  { value: "FR", label: "France" },
]

export interface CompanySetupPanelProps {
  initialDraft: CompanySetupDraft
  storageKey: string
  currencies: readonly SetupOption[]
  units: readonly SetupOption[]
  canSave: boolean
  onSave: (draft: CompanySetupDraft) => Promise<string>
  onRecover: (draft: CompanySetupDraft) => Promise<string | null>
}

/** The plan stays reviewable; linked books are configured through their existing owners. */
export function CompanySetupPanel({
  initialDraft,
  storageKey,
  currencies,
  units,
  canSave,
  onSave,
  onRecover,
}: CompanySetupPanelProps) {
  const [draft, setDraft] = useState(initialDraft)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const lifetime = useRef(0)
  const mounted = useRef(false)

  useLayoutEffect(() => {
    mounted.current = true
    lifetime.current += 1
    // A permission change interrupts the UI owner's wait, not the native save.
    // Preserve its identity and require a receipt check instead of another save.
    setDraft((current) =>
      current.stage === "submitting"
        ? { ...current, stage: "uncertain" }
        : current,
    )
    setRecovering(false)
    return () => {
      mounted.current = false
      lifetime.current += 1
    }
  }, [storageKey, initialDraft.companyId, canSave])

  const captureLease = () => {
    const captured = lifetime.current
    return () => mounted.current && lifetime.current === captured
  }

  useEffect(() => {
    try {
      const saved = decodeCompanySetupDraft(
        window.localStorage.getItem(storageKey),
        initialDraft.companyId,
      )
      if (saved) setDraft(saved)
    } catch {
      setStorageError(true)
    }
    setReady(true)
  }, [initialDraft.companyId, storageKey])

  const storeDraft = (next: CompanySetupDraft): boolean => {
    let stored = true
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next))
      setStorageError(false)
    } catch {
      setStorageError(true)
      stored = false
    }
    setDraft(next)
    return stored
  }
  const change = <K extends keyof CompanySetupDraft>(
    field: K,
    value: CompanySetupDraft[K],
  ) => {
    setError(null)
    storeDraft({ ...draft, [field]: value, stage: "editing" })
  }
  const isNew = draft.companyId === null
  const locked =
    draft.stage === "submitting" || draft.stage === "uncertain" || recovering
  const reviewed = draft.stage !== "editing"
  const currentCurrency =
    currencies.find((option) => option.value === draft.currencyId)?.label ??
    "Unavailable currency"
  const selectedUnits = draft.unitIds.map(
    (id) =>
      units.find((unit) => unit.value === id)?.label ??
      `Unavailable unit (${id})`,
  )
  const historicalCopy: Record<HistoricalDataMode, string> = {
    undecided: "Keep the historical-data approach undecided",
    "opening-balances": "Opening balances and outstanding documents",
    "full-history": "Historical transactions as drafts for review",
  }
  const taxCopy: Record<TaxRegistration, string> = {
    unknown: "VAT registration still unknown",
    registered: "VAT registered",
    "not-registered": "Not VAT registered",
  }

  if (!ready) return <p role="status">Loading your setup plan…</p>

  return (
    <section
      className="space-y-5 rounded-xl border border-border bg-card p-5"
      aria-labelledby="company-setup-title"
    >
      <header className="space-y-2">
        <h2 id="company-setup-title" className="text-lg font-semibold">
          Guided company setup
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Review your company, units and historical-data choices together, then
          complete the linked accounting settings. Unknown values can stay
          unknown.
        </p>
        <p className="text-xs text-muted-foreground">
          Your setup plan is saved on this device for this account and company.
          Company details are saved separately when you confirm.
        </p>
      </header>
      {storageError ? (
        <p role="alert" className="text-sm text-destructive">
          This browser could not save the plan. Keep this page open and allow
          browser storage before submitting.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!canSave ? (
        <p role="status" className="text-sm">
          You can review the plan. An authorized company administrator must save
          company details.
        </p>
      ) : null}

      {!reviewed ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            const problem = companySetupValidation(draft, currencies, units)
            if (problem) {
              setError(problem)
              return
            }
            setError(null)
            storeDraft({ ...draft, stage: "review" })
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="setup-name">Company name</Label>
              <Input
                id="setup-name"
                value={draft.name}
                readOnly={!isNew}
                maxLength={250}
                onChange={(event) => change("name", event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-code">Company code</Label>
              <Input
                id="setup-code"
                value={draft.code}
                readOnly={!isNew}
                maxLength={80}
                onChange={(event) => change("code", event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-country">Country</Label>
              <Input
                id="setup-country"
                list="setup-countries"
                value={draft.countryCode}
                maxLength={2}
                placeholder="RW — Rwanda"
                onChange={(event) =>
                  change("countryCode", event.target.value.toUpperCase())
                }
                required
              />
              <datalist id="setup-countries">
                {countrySuggestions.map((country) => (
                  <option key={country.value} value={country.value}>
                    {country.label}
                  </option>
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Choose a suggested country or enter another two-letter country
                code.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-currency">Base currency</Label>
              <select
                id="setup-currency"
                className={selectClass}
                value={draft.currencyId}
                disabled={!isNew}
                onChange={(event) => change("currencyId", event.target.value)}
                required
              >
                <option value="">Choose a currency</option>
                {draft.currencyId &&
                !currencies.some(
                  (option) => option.value === draft.currencyId,
                ) ? (
                  <option value={draft.currencyId}>
                    Unavailable currency ({draft.currencyId})
                  </option>
                ) : null}
                {currencies.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {!isNew ? (
                <p className="text-xs text-muted-foreground">
                  This is the company's existing base currency. The setup plan
                  keeps it unchanged.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-vat">VAT registration</Label>
              <select
                id="setup-vat"
                className={selectClass}
                value={draft.taxRegistration}
                onChange={(event) =>
                  change(
                    "taxRegistration",
                    event.target.value as TaxRegistration,
                  )
                }
              >
                <option value="unknown">Still unknown</option>
                <option value="registered">Registered</option>
                <option value="not-registered">Not registered</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-tax-id">
                Tax / VAT registration number
              </Label>
              <Input
                id="setup-tax-id"
                value={draft.taxId}
                maxLength={250}
                onChange={(event) => change("taxId", event.target.value)}
                required={draft.taxRegistration === "registered"}
              />
              <p className="text-xs text-muted-foreground">
                Leaving an existing number blank does not remove it.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-fiscal-month">Fiscal year-end month</Label>
              <Input
                id="setup-fiscal-month"
                type="number"
                min={1}
                max={12}
                readOnly={!isNew}
                value={draft.fiscalYearEndMonth}
                onChange={(event) =>
                  change("fiscalYearEndMonth", event.target.value)
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-fiscal-day">Fiscal year-end day</Label>
              <Input
                id="setup-fiscal-day"
                type="number"
                min={1}
                max={31}
                readOnly={!isNew}
                value={draft.fiscalYearEndDay}
                onChange={(event) =>
                  change("fiscalYearEndDay", event.target.value)
                }
                required
              />
            </div>
          </div>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              Units used in the source files
            </legend>
            <p className="text-xs text-muted-foreground">
              Select known units for the review checklist. A unit choice never
              changes a source quantity or price. Leave this empty if units
              still need investigation.
            </p>
            <div className="grid max-h-56 gap-2 overflow-auto sm:grid-cols-3">
              {units.map((unit) => (
                <label
                  key={unit.value}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={draft.unitIds.includes(unit.value)}
                    onChange={(event) =>
                      change(
                        "unitIds",
                        event.target.checked
                          ? [...draft.unitIds, unit.value]
                          : draft.unitIds.filter((id) => id !== unit.value),
                      )
                    }
                  />
                  {unit.label}
                </label>
              ))}
            </div>
            {draft.unitIds
              .filter((id) => !units.some((unit) => unit.value === id))
              .map((id) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked
                    onChange={() =>
                      change(
                        "unitIds",
                        draft.unitIds.filter((unitId) => unitId !== id),
                      )
                    }
                  />
                  Unavailable unit ({id}) — remove or restore access
                </label>
              ))}
            {units.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No units are available to this account yet. Review or create
                them in Inventory.
              </p>
            ) : null}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="setup-history">Historical data</Label>
            <select
              id="setup-history"
              className={selectClass}
              value={draft.historicalMode}
              onChange={(event) =>
                change(
                  "historicalMode",
                  event.target.value as HistoricalDataMode,
                )
              }
            >
              {Object.entries(historicalCopy).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Historical prices remain source evidence. Review current selling
              prices separately. Imported draft entries do not appear as posted
              activity.
            </p>
          </div>
          <Button type="submit">Review linked setup</Button>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg bg-muted/40 p-4">
            <h3 className="mb-3 font-medium">Review before saving</h3>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Company</dt>
                <dd>
                  {draft.name} ({draft.code})
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Country and currency</dt>
                <dd>
                  {countrySuggestions.find(
                    (country) => country.value === draft.countryCode,
                  )?.label ?? draft.countryCode}{" "}
                  · {currentCurrency}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">VAT</dt>
                <dd>
                  {taxCopy[draft.taxRegistration]}
                  {draft.taxId ? ` · ${draft.taxId}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Units to review</dt>
                <dd>
                  {selectedUnits.join(", ") ||
                    "Still unknown — decide per source row"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Historical data</dt>
                <dd>{historicalCopy[draft.historicalMode]}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Fiscal year-end</dt>
                <dd>
                  {draft.fiscalYearEndMonth.padStart(2, "0")}-
                  {draft.fiscalYearEndDay.padStart(2, "0")}
                </dd>
              </div>
            </dl>
          </div>
          <p className="text-sm text-muted-foreground">
            {isNew
              ? "Confirmation creates the company with these details and keeps the reviewed choices in its setup metadata."
              : "Confirmation saves the country and any entered tax number. VAT status, units and historical-data choices remain in this device's review plan."}{" "}
            Accounts, journals, tax rates and imported records each require
            their own review.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {companySetupLinks(draft.savedCompanyId ?? draft.companyId).map(
              (item) => (
                <article
                  key={item.title}
                  className="space-y-2 rounded-lg border p-3"
                >
                  <h4 className="text-sm font-medium">{item.title}</h4>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {item.detail}
                  </p>
                  {draft.companyId || draft.savedCompanyId ? (
                    <a
                      href={item.href}
                      className="inline-block text-sm font-medium text-primary underline"
                    >
                      Review {item.title.toLowerCase()}
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Available after company creation
                    </p>
                  )}
                </article>
              ),
            )}
          </div>
          {draft.stage === "saved" ? (
            <p
              role="status"
              className="rounded-lg border border-success/30 p-3 text-sm"
            >
              Company details saved. The linked setup checklist remains open for
              review.
            </p>
          ) : null}
          {draft.stage === "uncertain" ? (
            <div className="space-y-3 rounded-lg border border-warning/40 p-3">
              <p role="status" className="text-sm">
                The save result is not confirmed. Check the existing submission
                before continuing; do not create another company.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={recovering}
                onClick={async () => {
                  const isCurrent = captureLease()
                  setRecovering(true)
                  setError(null)
                  try {
                    const companyId = await onRecover(draft)
                    if (!isCurrent()) return
                    if (companyId)
                      storeDraft({
                        ...draft,
                        savedCompanyId: companyId,
                        stage: "saved",
                      })
                    else
                      setError(
                        "The saved company is not visible yet. Keep this plan and check again when the connection is restored.",
                      )
                  } catch (failure) {
                    if (!isCurrent()) return
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "Could not check the saved company.",
                    )
                  } finally {
                    if (isCurrent()) setRecovering(false)
                  }
                }}
              >
                Check saved company
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={locked || (isNew && draft.savedCompanyId !== null)}
              onClick={() => storeDraft({ ...draft, stage: "editing" })}
            >
              Edit setup plan
            </Button>
            {draft.stage === "review" ? (
              <Button
                type="button"
                disabled={!canSave || storageError}
                onClick={async () => {
                  if (!canSave) return
                  const isCurrent = captureLease()
                  const problem = companySetupValidation(
                    draft,
                    currencies,
                    units,
                  )
                  if (problem) {
                    setError(problem)
                    return
                  }
                  const submitting: CompanySetupDraft = {
                    ...draft,
                    stage: "submitting",
                  }
                  if (!storeDraft(submitting)) return
                  setError(null)
                  try {
                    const companyId = await onSave(draft)
                    if (!isCurrent()) return
                    storeDraft({
                      ...draft,
                      savedCompanyId: companyId,
                      stage: "saved",
                    })
                  } catch (failure) {
                    if (!isCurrent()) return
                    storeDraft({
                      ...draft,
                      stage:
                        failure instanceof CompanySetupAdmissionError
                          ? "review"
                          : "uncertain",
                    })
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "The save result could not be confirmed.",
                    )
                  }
                }}
              >
                {isNew
                  ? "Confirm and create company"
                  : "Confirm company details"}
              </Button>
            ) : null}
            {draft.stage === "submitting" ? (
              <p role="status" className="text-sm">
                Saving company details…
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}

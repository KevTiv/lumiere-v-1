"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import {
  useCompanies,
  useCreateCompany,
  useUpdateCompany,
} from "@lumiere/query-hooks/hooks/organization-company"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { useUoms } from "@lumiere/query-hooks/hooks/inventory/uom"
import { toCreateCompanyParams } from "@lumiere/erp-shared/settings-create-params"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { Label } from "@lumiere/ui/components/label"
import type { CompanyQueryRow } from "@lumiere/stdb/resource-reads"
import { currencyOptionsFromRows } from "./form-lookup"
import { CompanySetupPanel } from "./company-setup-panel"
import {
  CompanySetupAdmissionError,
  companySetupMetadata,
  companySetupStorageKey,
  findSubmittedCompany,
  newCompanySetupDraft,
  type CompanySetupCompany,
  type CompanySetupDraft,
} from "./company-setup-model"

function setupCompany(row: CompanyQueryRow): CompanySetupCompany {
  return {
    id: String(row.id),
    name: row.name ?? "",
    code: row.code ?? "",
    countryCode: row.addressCountryCode ?? "",
    currencyId: String(row.currencyId ?? ""),
    taxId: row.taxId ?? "",
    fiscalYearEndMonth: Number(row.fiscalYearEndMonth),
    fiscalYearEndDay: Number(row.fiscalYearEndDay),
    metadata: row.metadata ?? undefined,
  }
}

function savedCompanyMatches(
  company: CompanySetupCompany | undefined,
  draft: CompanySetupDraft,
): boolean {
  return (
    !!company &&
    company.countryCode === draft.countryCode &&
    (!draft.taxId.trim() || company.taxId === draft.taxId.trim())
  )
}

export function CompanySetupWorkspace({
  organizationId,
}: {
  organizationId: number
}) {
  const session = useErpSession()
  const { checkPermission } = useRBAC()
  const companiesQuery = useCompanies(organizationId, !!session.identity)
  const currenciesQuery = useCurrencies()
  const unitsQuery = useUoms(BigInt(organizationId))
  const createCompany = useCreateCompany(organizationId)
  const updateCompany = useUpdateCompany()
  const [selection, setSelection] = useState<string | null>(null)
  const companyId =
    selection ??
    (session.activeCompanyId ? String(session.activeCompanyId) : "new")
  const companies = useMemo(
    () => (companiesQuery.data ?? []).map(setupCompany),
    [companiesQuery.data],
  )
  const company = companies.find((row) => row.id === companyId)
  const currencies = useMemo(
    () => currencyOptionsFromRows(currenciesQuery.data ?? []),
    [currenciesQuery.data],
  )
  const units = useMemo(
    () =>
      (unitsQuery.data ?? [])
        .filter((row) => row.id != null && row.name && row.isActive !== false)
        .map((row) => ({
          value: String(row.id),
          label: `${row.name}${row.symbol ? ` (${row.symbol})` : ""}`,
        })),
    [unitsQuery.data],
  )
  const canSave = checkPermission(
    "company",
    companyId === "new" ? "create" : "write",
  ).allowed
  const accessReady =
    !!session.identity &&
    session.organizationId === organizationId &&
    session.activeCompanyReady
  const lifetime = useRef(0)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    lifetime.current += 1
    return () => {
      mounted.current = false
      lifetime.current += 1
    }
  }, [
    session.identity,
    session.organizationId,
    session.activeCompanyId,
    session.activeCompanyReady,
    organizationId,
    companyId,
    canSave,
  ])
  const captureLease = () => {
    const captured = lifetime.current
    const assertCurrent = () => {
      if (!mounted.current || lifetime.current !== captured || !accessReady)
        throw new Error(
          "Company setup access changed. Reopen the plan in the current company before continuing.",
        )
    }
    assertCurrent()
    return assertCurrent
  }
  const draft = useMemo(
    () => newCompanySetupDraft(crypto.randomUUID(), company),
    [company],
  )

  if (
    !session.identity ||
    session.organizationId !== organizationId ||
    !session.activeCompanyReady
  )
    return <p role="status">Waiting for your company access…</p>
  if (companiesQuery.isLoading || currenciesQuery.isLoading)
    return <p role="status">Loading company setup…</p>
  if (companiesQuery.isError || currenciesQuery.isError)
    return (
      <p role="alert">
        Company setup could not be loaded. Refresh to retry with your current
        access.
      </p>
    )

  const storageKey = companySetupStorageKey(
    session.identity,
    organizationId,
    company?.id ?? null,
  )
  const readCompanies = async (assertCurrent: () => void) => {
    assertCurrent()
    const result = await companiesQuery.refetch()
    assertCurrent()
    if (result.error || !result.data)
      throw new Error(
        "Could not verify company details. Check the connection and try again.",
      )
    return result.data.map(setupCompany)
  }
  const save = async (
    reviewed: CompanySetupDraft,
    assertCurrent: () => void,
  ): Promise<string> => {
    assertCurrent()
    if (
      !canSave ||
      reviewed.companyId !== (companyId === "new" ? null : companyId)
    )
      throw new CompanySetupAdmissionError(
        "Company setup permission or selection changed. Review the plan before saving.",
      )
    let current: CompanySetupCompany[]
    try {
      current = await readCompanies(assertCurrent)
    } catch (failure) {
      // A revoked lease is never a definitive failed save, including after a
      // rapid A → B → A scope change. Keep the retained submission uncertain.
      assertCurrent()
      throw new CompanySetupAdmissionError(
        failure instanceof Error
          ? failure.message
          : "Company details could not be verified.",
      )
    }
    assertCurrent()
    if (reviewed.companyId === null) {
      const recovered = findSubmittedCompany(current, reviewed.submissionId)
      if (recovered) return recovered.id
      if (
        current.some(
          (row) =>
            row.code.toLowerCase() === reviewed.code.trim().toLowerCase(),
        )
      )
        throw new CompanySetupAdmissionError(
          "That company code already exists. Select the existing company or choose a different code.",
        )
      const params = toCreateCompanyParams({
        name: reviewed.name.trim(),
        code: reviewed.code.trim(),
        addressCountryCode: reviewed.countryCode,
        currencyId: reviewed.currencyId,
        taxId: reviewed.taxId.trim(),
        fiscalYearEndMonth: reviewed.fiscalYearEndMonth,
        fiscalYearEndDay: reviewed.fiscalYearEndDay,
        metadata: companySetupMetadata(reviewed),
      })
      if (!params)
        throw new CompanySetupAdmissionError(
          "Review the required company fields before saving.",
        )
      assertCurrent()
      await createCompany.mutateAsync(params)
      assertCurrent()
      const refreshed = await readCompanies(assertCurrent)
      assertCurrent()
      const saved = findSubmittedCompany(refreshed, reviewed.submissionId)
      if (!saved)
        throw new Error(
          "Company creation returned, but its saved record has not been confirmed yet.",
        )
      return saved.id
    }
    const target = current.find((row) => row.id === reviewed.companyId)
    if (!target || target.currencyId !== reviewed.currencyId)
      throw new CompanySetupAdmissionError(
        "Company access or currency changed. Review the company before saving.",
      )
    assertCurrent()
    await updateCompany.mutateAsync({
      companyId: BigInt(reviewed.companyId),
      organizationId,
      params: {
        addressCountryCode: reviewed.countryCode,
        ...(reviewed.taxId.trim() ? { taxId: reviewed.taxId.trim() } : {}),
      },
    })
    assertCurrent()
    const refreshed = await readCompanies(assertCurrent)
    assertCurrent()
    const saved = refreshed.find((row) => row.id === reviewed.companyId)
    if (!savedCompanyMatches(saved, reviewed))
      throw new Error("The company changes have not been confirmed yet.")
    return reviewed.companyId
  }

  return (
    <div className="space-y-4">
      <div className="max-w-lg space-y-2">
        <Label htmlFor="setup-company">Company to set up</Label>
        <select
          id="setup-company"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={companyId}
          onChange={(event) => setSelection(event.target.value)}
        >
          {companies.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} ({row.code})
            </option>
          ))}
          {checkPermission("company", "create").allowed ? (
            <option value="new">New operating company</option>
          ) : null}
        </select>
      </div>
      {unitsQuery.isError ? (
        <p role="status" className="text-sm text-muted-foreground">
          Units could not be read with the current connection or access. Keep
          units unresolved until they can be reviewed.
        </p>
      ) : null}
      {companyId !== "new" && !company ? (
        <p role="alert">Choose a company available to your account.</p>
      ) : (
        <CompanySetupPanel
          key={storageKey}
          initialDraft={draft}
          storageKey={storageKey}
          currencies={currencies}
          units={units}
          canSave={canSave}
          onSave={async (reviewed) => {
            const assertCurrent = captureLease()
            // A same-browser second tab must re-read the first submission's exact result.
            if (navigator.locks) {
              const saved = await navigator.locks.request(
                storageKey,
                { ifAvailable: true },
                async (lock) => {
                  assertCurrent()
                  if (!lock)
                    throw new Error(
                      "This setup is already being saved in another tab. Check its saved result.",
                    )
                  return save(reviewed, assertCurrent)
                },
              )
              assertCurrent()
              return saved
            }
            const saved = await save(reviewed, assertCurrent)
            assertCurrent()
            return saved
          }}
          onRecover={async (reviewed) => {
            const assertCurrent = captureLease()
            const current = await readCompanies(assertCurrent)
            assertCurrent()
            if (reviewed.companyId === null)
              return (
                findSubmittedCompany(current, reviewed.submissionId)?.id ?? null
              )
            return savedCompanyMatches(
              current.find((row) => row.id === reviewed.companyId),
              reviewed,
            )
              ? reviewed.companyId
              : null
          }}
        />
      )}
    </div>
  )
}

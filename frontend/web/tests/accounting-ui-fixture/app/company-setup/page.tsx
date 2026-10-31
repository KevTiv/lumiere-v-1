"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { CompanySetupPanel } from "../../../../lib/company-setup-panel"
import {
  companySetupStorageKey,
  newCompanySetupDraft,
  type CompanySetupDraft,
} from "../../../../lib/company-setup-model"

const company = {
  id: "7",
  name: "Mugisha Farm",
  code: "FARM",
  countryCode: "RW",
  currencyId: "4",
  taxId: "",
  fiscalYearEndMonth: 12,
  fiscalYearEndDay: 31,
}
const currencies = [
  { value: "2", label: "USD — US Dollar" },
  { value: "4", label: "RWF — Rwandan Franc" },
]
const units = [
  { value: "8", label: "Kilograms (kg)" },
  { value: "9", label: "Units" },
]

async function receiptCompany(response: Response): Promise<string | null> {
  if (!response.ok) throw new Error("Synthetic setup response unavailable")
  const result: unknown = await response.json()
  if (
    result !== null &&
    typeof result === "object" &&
    "companyId" in result &&
    (result.companyId === null ||
      (typeof result.companyId === "string" &&
        /^[1-9]\d*$/.test(result.companyId)))
  ) {
    return result.companyId
  }
  throw new Error("Invalid synthetic setup response")
}

export default function Page() {
  const mode = useSearchParams().get("mode")
  const isNew = mode === "new"
  const initialDraft = useMemo(
    () =>
      newCompanySetupDraft(
        "synthetic-company-submission-0001",
        isNew ? undefined : company,
      ),
    [isNew],
  )
  const onSave = async (draft: CompanySetupDraft): Promise<string> => {
    const response = await fetch("/__fixture/company-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
    const id = await receiptCompany(response)
    if (!id) throw new Error("Synthetic saved company not confirmed")
    return id
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <p>
        Synthetic company setup fixture. The production setup panel uses
        simulated HTTP responses; no live ERP effects.
      </p>
      <CompanySetupPanel
        key={isNew ? "new" : "existing"}
        initialDraft={initialDraft}
        storageKey={companySetupStorageKey(
          "synthetic-setup-owner",
          8001,
          isNew ? null : company.id,
        )}
        currencies={currencies}
        units={units}
        canSave={mode !== "read-only"}
        onSave={onSave}
        onRecover={async (draft) =>
          receiptCompany(
            await fetch(
              `/__fixture/company-setup?submissionId=${encodeURIComponent(draft.submissionId)}`,
            ),
          )
        }
      />
    </main>
  )
}

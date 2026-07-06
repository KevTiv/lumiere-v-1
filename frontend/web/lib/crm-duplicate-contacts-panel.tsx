"use client"

import {
  contactRowLabel,
  detectContactDuplicatePairs,
  type ContactDuplicatePair,
} from "@/lib/contact-duplicate-detection"
import { useTranslation } from "@lumiere/i18n"
import { contactPrimaryLabel } from "@lumiere/stdb/read-models"
import {
  useFindDuplicateContacts,
  useMergeContacts,
} from "@lumiere/query-hooks/hooks/crm"
import { Button } from "@lumiere/ui/components/button"
import { FormModal } from "@lumiere/ui/forms/form-modal"
import { mergeContactsForm } from "@lumiere/ui/lib/crm-form-configs"
import { useCallback, useMemo, useState } from "react"

type Props = {
  organizationId: number
  companyId: bigint
  contacts: Record<string, unknown>[]
}

function pairKey(pair: ContactDuplicatePair): string {
  return `${pair.contactIdA}:${pair.contactIdB}`
}

export function CrmDuplicateContacts({ organizationId, companyId, contacts }: Props) {
  const { t } = useTranslation()
  const orgId = BigInt(organizationId)
  const findDuplicates = useFindDuplicateContacts(orgId)
  const mergeContacts = useMergeContacts(orgId, { companyId })

  const pairs = useMemo(
    () => detectContactDuplicatePairs(contacts, companyId),
    [contacts, companyId],
  )

  const [mergePair, setMergePair] = useState<ContactDuplicatePair | null>(null)

  const survivorOptions = useMemo(() => {
    if (!mergePair) return []
    return [
      {
        value: mergePair.contactIdA,
        label: contactRowLabel(mergePair.contactA),
      },
      {
        value: mergePair.contactIdB,
        label: contactRowLabel(mergePair.contactB),
      },
    ]
  }, [mergePair])

  const mergeForm = useMemo(
    () => mergeContactsForm(t, survivorOptions),
    [t, survivorOptions],
  )

  const handleScan = useCallback(() => {
    findDuplicates.mutate(companyId)
  }, [findDuplicates, companyId])

  const handleMergeSubmit = useCallback(
    async (data: Record<string, unknown>) => {
      if (!mergePair) return
      const targetId = String(data.targetContactId ?? "")
      const sourceId =
        targetId === mergePair.contactIdA
          ? mergePair.contactIdB
          : mergePair.contactIdA
      await mergeContacts.mutateAsync({
        sourceContactId: BigInt(sourceId),
        targetContactId: BigInt(targetId),
      })
      setMergePair(null)
    },
    [mergeContacts, mergePair],
  )

  return (
    <div className="space-y-4" data-testid="crm-duplicate-contacts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("crm.duplicates.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("crm.duplicates.description")}</p>
        </div>
        <Button
          variant="outline"
          onClick={handleScan}
          disabled={findDuplicates.isPending || companyId === 0n}
          data-testid="crm-duplicates-scan"
        >
          {findDuplicates.isPending
            ? t("crm.duplicates.scanning")
            : t("crm.duplicates.scan")}
        </Button>
      </div>

      {pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="crm-duplicates-empty">
          {t("crm.duplicates.empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-md border" data-testid="crm-duplicates-list">
          {pairs.map((pair) => (
            <li
              key={pairKey(pair)}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              data-testid={`crm-duplicate-pair-${pair.contactIdA}-${pair.contactIdB}`}
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {contactPrimaryLabel(pair.contactA)} ↔ {contactPrimaryLabel(pair.contactB)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("crm.duplicates.matchReason", { reason: pair.matchReason })}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setMergePair(pair)}
                data-testid={`crm-duplicate-merge-${pair.contactIdA}-${pair.contactIdB}`}
              >
                {t("crm.duplicates.merge")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FormModal
        open={mergePair != null}
        onOpenChange={(open) => !open && setMergePair(null)}
        config={mergeForm}
        isPending={mergeContacts.isPending}
        onSubmit={handleMergeSubmit}
      />
    </div>
  )
}

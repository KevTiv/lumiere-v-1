"use client"
import { useTranslation } from "@lumiere/i18n"


import Link from "next/link"
import type { ManufacturingResultLink } from "@/lib/manufacturing-result-links"

export function ManufacturingActionResult({ links, onDismiss }: { links: readonly ManufacturingResultLink[]; onDismiss: () => void }) {
  const { t } = useTranslation()
  if (links.length === 0) return null
  return (
    <div role="status" data-testid="manufacturing-action-result" className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
      <span>{t("manufacturing.manufacturingActionResult.resultingRecords")}</span>
      {links.map(link => (
        <Link key={`${link.resource}-${link.id}`} href={link.href} className="text-primary hover:underline" data-testid={`manufacturing-result-${link.resource}-${link.id}`}>
          {link.label} #{link.id}
        </Link>
      ))}
      <button type="button" className="ml-auto text-muted-foreground" onClick={onDismiss} aria-label={t("manufacturing.manufacturingActionResult.dismissResultingRecords")}>{t("settings.ai.dismiss")}</button>
    </div>
  )
}

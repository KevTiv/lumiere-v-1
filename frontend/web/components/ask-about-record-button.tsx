"use client"

import { Sparkles } from "lucide-react"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { useOpenErpAiChat } from "@/lib/erp-ai-context"

export function AskAboutRecordButton({
  entityType,
  recordId,
  label,
  activeTab,
  closeRecord,
}: {
  entityType: string
  recordId: unknown
  label: string
  activeTab: string
  closeRecord?: () => void
}) {
  const { t } = useTranslation()
  const openChat = useOpenErpAiChat()
  const id = parseStrictU64(recordId)
  if (id == null || id === 0n || id.toString() !== String(recordId)) return null

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        closeRecord?.()
        openChat({
          selection: {
            entityType,
            entityId: id.toString(),
            activeTab,
            selectionSummary: label.trim() || `#${id}`,
          },
        })
      }}
    >
      <Sparkles className="size-4" aria-hidden="true" />
      {t("aiChat.workspace.askAboutRecord", { defaultValue: "Ask Lumière" })}
    </Button>
  )
}

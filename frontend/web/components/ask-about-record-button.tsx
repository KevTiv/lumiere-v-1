"use client"

import { Sparkles } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { useOpenErpAiChat } from "@/lib/erp-ai-context"

export function AskAboutRecordButton({
  entityType,
  recordId,
  label,
  activeTab,
}: {
  entityType: string
  recordId: string
  label: string
  activeTab: string
}) {
  const { t } = useTranslation()
  const openChat = useOpenErpAiChat()

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => openChat({
        selection: { entityType, entityId: recordId, activeTab, selectionSummary: label },
      })}
    >
      <Sparkles className="size-4" aria-hidden="true" />
      {t("aiChat.workspace.askAboutRecord", { defaultValue: "Ask Lumière" })}
    </Button>
  )
}

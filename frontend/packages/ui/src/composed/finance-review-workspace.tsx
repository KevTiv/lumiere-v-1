"use client"

import { useState, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/tabs"
import { cn } from "../lib/utils"

type ReviewMode = "review" | "edit" | "document"

/** One mounted editor and preview: changing the view never resets input or selected files. */
export function FinanceReviewWorkspace({ editor, preview, context, editorLabel, previewLabel, previewTabTestId }: {
  editor: ReactNode
  preview: ReactNode
  context?: ReactNode
  editorLabel?: string
  previewLabel?: string
  previewTabTestId?: string
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<ReviewMode>("review")
  return (
    <section className="flex min-w-0 flex-col gap-4" data-testid="finance-review-workspace">
      {context}
      <Tabs className="flex-col" value={mode} onValueChange={(value) => setMode(value as ReviewMode)}>
        <TabsList aria-label={t("financeReview.view", { defaultValue: "Review view" })} className="h-auto min-h-10 max-w-full flex-wrap">
          <TabsTrigger value="review">{t("financeReview.sideBySide", { defaultValue: "Side by side" })}</TabsTrigger>
          <TabsTrigger value="edit">{editorLabel ?? t("accounting.authoring.editDocument", { defaultValue: "Edit document" })}</TabsTrigger>
          <TabsTrigger value="document" data-testid={previewTabTestId}>{previewLabel ?? t("accounting.authoring.documentPreview", { defaultValue: "Document preview" })}</TabsTrigger>
        </TabsList>
        <TabsContent value={mode} keepMounted>
          <div className={cn("grid min-w-0 items-start gap-5", mode === "review" && "xl:grid-cols-2")}>
            <div hidden={mode === "document"} className="min-w-0" data-testid="finance-review-editor">{editor}</div>
            <aside hidden={mode === "edit"} className="min-w-0 xl:sticky xl:top-0" data-testid="finance-review-document">{preview}</aside>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}

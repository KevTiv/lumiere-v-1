"use client"

import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import type { SectionConflictField, SectionConflictView } from "./section-conflict"

export interface SectionConflictBannerProps {
  view: SectionConflictView
  /** Keep mine force-writes the draft, so it needs `proposal:write`. */
  canKeepMine: boolean
  isResolving?: boolean
  onKeepMine: () => void
  onKeepTheirs: () => void
}

function fieldLabel(t: ReturnType<typeof useTranslation>["t"], field: SectionConflictField): string {
  switch (field) {
    case "title":
      return t("proposalWorkspace.sectionConflict.fieldTitle", { defaultValue: "Title" })
    case "content":
      return t("proposalWorkspace.sectionConflict.fieldContent", { defaultValue: "Content" })
    case "status":
      return t("proposalWorkspace.sectionConflict.fieldStatus", { defaultValue: "Status" })
    case "sequence":
      return t("proposalWorkspace.sectionConflict.fieldSequence", { defaultValue: "Order" })
    case "aiSuggestion":
      return t("proposalWorkspace.sectionConflict.fieldAiSuggestion", { defaultValue: "AI suggestion" })
  }
}

/** Shown in the section editor when a save was rejected because someone else changed the section. */
export function SectionConflictBanner({
  view,
  canKeepMine,
  isResolving = false,
  onKeepMine,
  onKeepTheirs,
}: SectionConflictBannerProps) {
  const { t } = useTranslation()
  const revisionLabel = t("proposalWorkspace.sectionConflict.revision", { defaultValue: "Revision" })

  return (
    <div
      role="alert"
      data-testid="proposal-section-conflict"
      className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
    >
      <p className="font-medium text-foreground">
        {t("proposalWorkspace.sectionConflict.title", { defaultValue: "This section was changed by someone else" })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("proposalWorkspace.sectionConflict.description", {
          defaultValue: "Your save was not applied. Keep your version to overwrite theirs, or keep theirs to discard your edits.",
        })}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <p className="font-semibold" data-testid="proposal-section-conflict-mine-revision">
          {t("proposalWorkspace.sectionConflict.mine", { defaultValue: "Your version" })} · {revisionLabel} {view.mineRevision}
        </p>
        <p className="font-semibold" data-testid="proposal-section-conflict-theirs-revision">
          {t("proposalWorkspace.sectionConflict.theirs", { defaultValue: "Server version" })} · {revisionLabel} {view.theirsRevision}
        </p>
        {view.fields.map((diff) => (
          <div key={diff.field} className="col-span-2 grid grid-cols-2 gap-3" data-testid={`proposal-section-conflict-field-${diff.field}`}>
            <p className="col-span-2 text-[10px] uppercase tracking-wide text-muted-foreground">{fieldLabel(t, diff.field)}</p>
            <pre className="whitespace-pre-wrap break-words rounded border border-border bg-background p-2 font-sans">{diff.mine}</pre>
            <pre className="whitespace-pre-wrap break-words rounded border border-border bg-background p-2 font-sans">{diff.theirs}</pre>
          </div>
        ))}
      </div>

      {view.identical ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("proposalWorkspace.sectionConflict.identical", { defaultValue: "The server version already matches your edits." })}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        {canKeepMine ? (
          <Button
            type="button"
            size="sm"
            data-testid="proposal-section-keep-mine"
            disabled={isResolving}
            onClick={onKeepMine}
          >
            {t("proposalWorkspace.sectionConflict.keepMine", { defaultValue: "Keep mine" })}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="proposal-section-keep-theirs"
          disabled={isResolving}
          onClick={onKeepTheirs}
        >
          {t("proposalWorkspace.sectionConflict.keepTheirs", { defaultValue: "Keep theirs" })}
        </Button>
      </div>
    </div>
  )
}

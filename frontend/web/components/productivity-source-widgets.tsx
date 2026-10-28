"use client"

import { useTranslation } from "@lumiere/i18n"
import { MiniCalendarWidget, RecentNotesWidget, type MiniCalendarData, type RecentNotesData } from "@lumiere/ui"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice"

function SourceNotice({ state }: { state: ModuleDataState }) {
  const { t } = useTranslation()
  return state.status === "loading"
    ? <p role="status" className="p-4 text-sm text-muted-foreground">{t("common.loading", { defaultValue: "Loading…" })}</p>
    : <ModuleDataNotice state={state} />
}

export function ProductivityCalendar({ data }: { data: MiniCalendarData & { state: ModuleDataState } }) {
  return data.state.status === "ready" ? <MiniCalendarWidget data={data} /> : <SourceNotice state={data.state} />
}

export function ProductivityNotes({ data }: { data: RecentNotesData & { state: ModuleDataState } }) {
  return data.state.status === "ready" ? <RecentNotesWidget data={data} /> : <SourceNotice state={data.state} />
}

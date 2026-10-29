import { projectTimesheetsHref } from "@lumiere/erp-shared/record-links"

type Row = Record<string, unknown>
type Translate = (key: string) => string

/** Chart data keys stay canonical; only the series labels follow the display language. */
export function projectMarginChartData(margins: readonly Row[], projects: readonly { id: unknown; name?: unknown }[], t: Translate) {
  const names = new Map(projects.map(project => [String(project.id), String(project.name ?? project.id)]))
  return {
    categoryKey: "project",
    series: [
      { name: "Budget", label: t("projects.projectsClient.budgetSeries"), color: "#94a3b8" },
      { name: "Spent", label: t("projects.projectsClient.spentSeries"), color: "#6366f1" },
    ],
    values: margins.slice(0, 8).map(margin => ({
      project: names.get(String(margin.projectId ?? "")) ?? String(margin.projectId ?? "—"),
      Budget: Math.round(Number(margin.budgetPlanned ?? 0)),
      Spent: Math.round(Number(margin.budgetActual ?? 0)),
      Margin: Math.round(Number(margin.marginPercent ?? 0)),
      href: margin.projectId == null ? "/projects?tab=timesheets" : projectTimesheetsHref(String(margin.projectId)),
    })),
    testId: "proj-margin-panel",
  }
}

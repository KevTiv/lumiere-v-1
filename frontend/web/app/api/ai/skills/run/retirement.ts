export const GOVERNED_SKILL_REPLACEMENTS = {
  report_composer: "/api/ai/report/compose",
  low_stock: "/api/ai/inventory/low-stock",
  import_mapping: "/api/ai/skills/import-mapping",
  insights_scan: "/api/ai/skills/insights-scan",
  daily_briefing: "/api/ai/skills/daily-briefing",
  report_analysis: "/api/ai/skills/report-analysis",
  process_research: "/api/ai/skills/process-research",
  price_search: "/api/ai/skills/price-search",
  supplier_discovery: "/api/ai/skills/supplier-discovery",
  rag_generation: "/api/ai/rag",
  form_suggestion: "/api/ai/forms/suggest",
  action_draft_generation: "/api/ai/actions/draft",
} as const

export function legacyRunRetirement(skillKey: string) {
  const normalized = skillKey.trim()
  const replacementPath =
    GOVERNED_SKILL_REPLACEMENTS[normalized as keyof typeof GOVERNED_SKILL_REPLACEMENTS]
  return {
    error: replacementPath
      ? `Skill '${normalized}' has migrated from the legacy skill runner; use ${replacementPath}.`
      : `Skill '${normalized}' has no governed execution adapter; register and certify one before execution.`,
    code: "legacy_skill_run_retired" as const,
    skillKey: normalized,
    ...(replacementPath ? { replacementPath } : {}),
  }
}

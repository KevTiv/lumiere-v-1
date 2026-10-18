export interface SectionTemplateInput {
  name: string
  category: string
  locale: string
  countryPackKey: string | null
  sectionsJson: string
  isActive: boolean
  metadata: string | null
}

export type SectionTemplateParseResult =
  | { ok: true; value: SectionTemplateInput }
  | { ok: false; reason: "name" | "category" | "locale" | "sections" }

export const DEFAULT_TEMPLATE_CATEGORY = "general"
export const DEFAULT_TEMPLATE_LOCALE = "en"

/**
 * `apply_proposal_template` reads `sections_json` as a JSON array and takes `title`, `content`
 * and `sequence` from each element (title defaults to "Section", sequence to (index + 1) * 10),
 * so that is exactly the shape written here. Sequences are renumbered from the current order.
 */
export function serializeSectionsForTemplate(sections: readonly Record<string, unknown>[]): string {
  const ordered = [...sections].sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
  return JSON.stringify(
    ordered.map((section, index) => ({
      title: String(section.title ?? ""),
      content: String(section.content ?? ""),
      sequence: (index + 1) * 10,
    })),
  )
}

/**
 * `create_proposal_template` rejects a blank name and non-JSON `sections_json`; category and
 * locale are required here because the library lists templates by them. A template with no
 * sections would apply as a no-op, so it is not saved.
 */
export function parseSectionTemplateInput(
  values: Record<string, unknown> | null | undefined,
  sections: readonly Record<string, unknown>[],
): SectionTemplateParseResult {
  const name = String(values?.name ?? "").trim()
  if (name === "") return { ok: false, reason: "name" }
  const category = String(values?.category ?? "").trim()
  if (category === "") return { ok: false, reason: "category" }
  const locale = String(values?.locale ?? "").trim()
  if (locale === "") return { ok: false, reason: "locale" }
  if (sections.length === 0) return { ok: false, reason: "sections" }
  const countryPackKey = String(values?.countryPackKey ?? "").trim()
  return {
    ok: true,
    value: {
      name,
      category,
      locale,
      countryPackKey: countryPackKey === "" ? null : countryPackKey,
      sectionsJson: serializeSectionsForTemplate(sections),
      isActive: true,
      metadata: null,
    },
  }
}

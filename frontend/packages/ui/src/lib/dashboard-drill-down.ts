/**
 * Build in-app module tab hrefs for dashboard chart drill-down and record links.
 * Matches `useModuleTab` conventions: `?tab=` when not the default dashboard tab.
 * Optional `filter` params use `key:value` pairs (e.g. `filter=state:New`).
 * The implementation lives in `@lumiere/erp-shared/record-links` so non-UI packages share it.
 */
export { moduleTabHref as buildModuleTabHref } from "@lumiere/erp-shared/record-links"

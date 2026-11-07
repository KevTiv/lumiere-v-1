/* Generated from lumiere-presentation-core Rust models. Run pnpm generate:contract. Do not edit. */

/**
 * Existing business page hosts. Administration and AI debugger routes are excluded.
 */
export type PersonalPageModule =
  | 'overview'
  | 'accounting'
  | 'sales'
  | 'crm'
  | 'inventory'
  | 'products'
  | 'warehouse'
  | 'purchasing'
  | 'hr'
  | 'manufacturing'
  | 'projects'
  | 'iot'
  | 'documents'
  | 'calendar'
  | 'reports'
  | 'subscriptions'
  | 'expenses'
  | 'helpdesk'
  | 'workflows'
  | 'messages'
  | 'proposals'
  | 'pos'
  | 'fleet'
  | 'tasks'
  | 'approvals'
  | 'distributor'
  | 'map'
  | 'trackers';
/**
 * Source of an inert widget reference; a reference never grants data access.
 */
export type PersonalPageWidgetSource = 'builtin' | 'saved';

/**
 * Export catalog for generated clients, not an HTTP envelope.
 */
export interface PersonalPageLayoutContract {
  request: SavePersonalPageLayoutRequest;
  saved: PersonalPageLayoutResponse;
}
/**
 * Save or reset intent. Actor, organization and company are not body authority.
 */
export interface SavePersonalPageLayoutRequest {
  /**
   * Null only when this personal page has never been saved.
   */
  expectedRevision: string | null;
  /**
   * Null appends a reset snapshot; it never erases revision history.
   */
  layout: PersonalPageLayout | null;
}
/**
 * Complete personal layout for one existing page.
 */
export interface PersonalPageLayout {
  moduleId: PersonalPageModule;
  pageId: string;
  schemaVersion: 1;
  /**
   * @maxItems 64
   */
  widgets: PersonalPageWidgetPlacement[];
}
/**
 * One independently sized placement. Array order is its visual order.
 */
export interface PersonalPageWidgetPlacement {
  /**
   * Stable instance identifier, independent of the reusable widget identifier.
   */
  id: string;
  source: PersonalPageWidgetSource;
  /**
   * Host-owned builtin key (once per page), or reusable canonical positive decimal saved-widget ID.
   */
  widgetId: string;
  /**
   * Span in the host's twelve-column grid.
   */
  width: 3 | 4 | 6 | 8 | 12;
}
/**
 * Exact saved revision, or an unsaved page's builtin default.
 */
export interface PersonalPageLayoutResponse {
  companyId: string;
  layout: PersonalPageLayout | null;
  moduleId: PersonalPageModule;
  pageId: string;
  revision: string | null;
}

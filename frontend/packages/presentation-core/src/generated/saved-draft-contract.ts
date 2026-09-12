/* Generated from lumiere-presentation-core Rust models. Run pnpm generate:contract. Do not edit. */

/**
 * A supported renderer-neutral page node.
 */
export type PageNode =
  | {
      /**
       * Approved component implementation and version.
       */
      component: ComponentReference;
      /**
       * SQL column identifiers exposed by the actor-filtered capability dictionary.
       */
      fields: string[];
      /**
       * Stable node identifier.
       */
      id: string;
      kind: 'collection';
      /**
       * Requested page size; execution must separately enforce bounded acquisition.
       */
      pageSize: number;
      /**
       * Generated/approved read resource identifier.
       */
      resource: string;
      /**
       * Semantic host slot, independent of layout technology.
       */
      slot: SemanticSlot;
    }
  | {
      /**
       * Approved component implementation and version.
       */
      component: ComponentReference;
      /**
       * SQL column identifiers exposed by the source capability dictionary.
       */
      fields: string[];
      /**
       * Stable node identifier.
       */
      id: string;
      kind: 'detail';
      /**
       * Semantic host slot, independent of layout technology.
       */
      slot: SemanticSlot;
      /**
       * Stable ID of a collection node on the same page.
       */
      sourceNodeId: string;
    };
/**
 * Semantic placement slot understood by platform renderers.
 */
export type SemanticSlot = 'primary' | 'secondary';

/**
 * Export catalog for generated schemas, not an HTTP envelope.
 */
export interface SavedDraftContract {
  /**
   * Bounded list of personal module heads.
   */
  list: SavedDraftList;
  /**
   * Save input.
   */
  request: SaveDraftRequest;
  /**
   * Complete saved snapshot.
   */
  saved: SavedDraft;
}
/**
 * All personal heads, bounded by the database's per-owner module limit.
 */
export interface SavedDraftList {
  /**
   * Summaries of the current actor's saved modules.
   */
  drafts: SavedDraftSummary[];
}
/**
 * Personal module head summary; never includes another actor's module.
 */
export interface SavedDraftSummary {
  /**
   * Stable module slug.
   */
  moduleKey: string;
  /**
   * Canonical positive decimal revision.
   */
  revision: string;
  /**
   * Current snapshot's title.
   */
  title: string;
}
/**
 * Untrusted save intent; organization and actor come from the session.
 */
export interface SaveDraftRequest {
  /**
   * Complete definition, validated against the current actor's catalog.
   */
  definition: ModuleDraft;
  /**
   * Canonical positive decimal revision, or null for a new module.
   */
  expectedRevision?: string | null;
}
/**
 * A draft module definition submitted for validation or publication.
 */
export interface ModuleDraft {
  /**
   * Pinned application-contract release identifier.
   */
  applicationContract: string;
  /**
   * Exact base revision targeted by an update, encoded as a decimal string.
   */
  baseRevision?: string | null;
  /**
   * Pinned component catalog revision.
   */
  componentCatalogVersion: number;
  /**
   * Stable module identifier.
   */
  moduleId: string;
  /**
   * Ordered pages in the module.
   */
  pages: PageDefinition[];
  /**
   * Schema revision for this wire model.
   */
  schemaVersion: number;
  /**
   * Human-facing module title.
   */
  title: string;
}
/**
 * A composed page and its ordered presentation nodes.
 */
export interface PageDefinition {
  /**
   * Stable page identifier.
   */
  id: string;
  /**
   * Ordered nodes rendered on the page.
   */
  nodes: PageNode[];
  /**
   * Human-facing page title.
   */
  title: string;
}
/**
 * Versioned reference into the approved component catalog.
 */
export interface ComponentReference {
  /**
   * Stable catalog identifier.
   */
  id: string;
  /**
   * Exact compatible catalog version.
   */
  version: number;
}
/**
 * Complete immutable snapshot, prepared for editing at its saved revision.
 */
export interface SavedDraft {
  /**
   * Complete definition with baseRevision set to revision for editing.
   */
  definition: ModuleDraft;
  /**
   * Lowercase SHA-256 hex of canonical persisted JSON, before edit revision insertion.
   */
  definitionHash: string;
  /**
   * Stable module slug within the personal organization scope.
   */
  moduleKey: string;
  /**
   * Canonical positive decimal revision.
   */
  revision: string;
}

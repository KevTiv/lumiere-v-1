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
 * Schema catalog used by the contract exporter, not an HTTP envelope.
 */
export interface PreviewContract {
  /**
   * Actor-filtered choices for the read-only composer.
   */
  options: PreviewOptions;
  /**
   * Input to preview acquisition.
   */
  request: PreviewRequest;
  /**
   * Validated definition and bounded display data.
   */
  response: PreviewResponse;
}
/**
 * Actor-filtered choices; acquisition reauthorizes every request.
 */
export interface PreviewOptions {
  /**
   * Currently approved application contract pin.
   */
  applicationContract: string;
  /**
   * Fields available to this actor for the pilot resource.
   */
  fields: string[];
}
/**
 * A complete draft plus the selected company.
 */
export interface PreviewRequest {
  /**
   * Decimal company ID; membership is resolved on the server.
   */
  companyId: string;
  /**
   * Untrusted draft, validated before any acquisition.
   */
  definition: ModuleDraft;
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
 * Read-only preview result; not a published or persisted definition.
 */
export interface PreviewResponse {
  /**
   * Bounded data for its collection nodes.
   */
  collections: PreviewCollection[];
  /**
   * Definition successfully validated for the current actor.
   */
  definition: ModuleDraft;
}
/**
 * A bounded collection page, identified without a second placement model.
 */
export interface PreviewCollection {
  /**
   * Owning collection node.
   */
  nodeId: string;
  /**
   * Owning page.
   */
  pageId: string;
  /**
   * Rows from the authorized bounded acquisition.
   */
  rows: PreviewRow[];
  /**
   * True when an extra fetched row proves the preview is incomplete.
   */
  truncated: boolean;
}
/**
 * Display projection of a row; IDs retain full integer precision.
 */
export interface PreviewRow {
  /**
   * Actor-approved collection and linked detail fields.
   */
  fields: PreviewField[];
  /**
   * Decimal entity ID.
   */
  id: string;
}
/**
 * Text value resolved using canonical SQL-to-DTO metadata on the server.
 */
export interface PreviewField {
  /**
   * Canonical dictionary field ID.
   */
  field: string;
  /**
   * Escaped as ordinary text by renderers; null indicates no value.
   */
  value?: string | null;
}

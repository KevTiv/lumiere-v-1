# GrapesJS templates and Tiptap fields

## Implemented scope

This change builds on PR #233 (`feat/tiptap-rich-text`). GrapesJS **open-source core 0.23.8** provides visual template authoring. Existing Tiptap **3.31.4** editors continue to handle Markdown fields in forms and modals. Neither integration needs a vendor account, API key, Studio SDK or paid Tiptap extension.

In **Documents → Document templates**, users can choose **Design template**, add semantic blocks or basic page layouts, and save a template for the active company. **Customize a copy** reopens a supported saved project, gives it a new name, and saves a new template. In a rich text field, **Templates** inserts an active text template at the selection; users can then edit the inserted text normally.

| Template type | Authoring | Consumption |
| --- | --- | --- |
| Text for editor fields | Headings, paragraphs, lists, quotes, tables, dividers; inline bold/italic/strike | Tiptap insertion followed by the field's existing Markdown persistence |
| Document layout | The text blocks plus sections, two-column tables, color, fill, size, alignment, padding and borders | Saved project and compiled HTML; can be reopened and customized as a new template |

Whole page layouts are deliberately absent from the prose picker. Markdown cannot preserve positioning, page styles, arbitrary containers or fonts. These are two projections of a shared template record, not two independent mutable copies of the same field.

## Storage and rendering contract

The existing `document_template` row remains the persisted entity. No database schema or generated contracts release is changed.

```ts
metadata.documentDesigner = {
  schemaVersion: 1,
  engine: "grapesjs",
  kind: "rich-text" | "document",
  project: { assets: [], styles: [], pages: [/* one validated frame */] }
}
```

The validated project is the editing source. `body_html` is compiled from that project and sent with its metadata in one `create_document_template` operation. Other metadata keys are retained when customizing a copy. Invalid JSON or unsupported designer versions cannot silently overwrite stored state. New records use `lumiere-rich-text-template-v1` or `lumiere-document-layout-v1` as their report type; their generic backend model is `document`. Copies preserve the source model.

The text picker derives HTML from the validated project rather than trusting a separately edited `body_html` value. Tiptap parses that semantic HTML with its existing schema. Insertion dispatches one content transaction, emits the normal Markdown update, and passes through the existing hidden native textarea bridge. Form submission, `name`, `ref`, focus, keyboard handling and controlled values keep the same contract.

Document canvas styles and exported defaults come from the same versioned style map. The HTML projection includes those defaults inline, with authored per-block overrides. Text fragments keep the consuming field's typography. Project JSON is necessary for reopening; an HTML export alone is not an equivalent authoring source.

## Why customization saves a copy

The pinned contracts release exposes `create_document_template` to authenticated sessions. Although a reducer and a legacy frontend list mention `update_document_template`, the canonical generated runtime contract classifies that operation as **Denied**, and it has no session operation descriptor. This change does not introduce an alternate transport or change that exposure.

The supported workflow therefore creates a new template with an explicit **Save template copy** action. The source remains available and unchanged. There is no claim of revision merging, overwriting, atomic publication or conflict-aware collaboration. In-place editing needs a separately reviewed operation exposure and regenerated contracts release before the UI can offer it.

## Scope, lifecycle and content boundaries

- The web provider fetches on first template request and shares the result across fields. Query cache keys include organization, identity and active company; rows must match the organization and either the active company or an explicit organization-global scope.
- Both provider and designer require a ready session, matching RBAC identity and appropriate template permissions. Company/identity changes discard stale picker choices and designer scope. Revoking read access removes the picker while retaining the form and its unsaved text.
- Only active, valid text templates reach the picker. Legacy HTML, page layouts, malformed/future designer versions and reserved invoice profiles are excluded.
- Selection is captured when the picker opens. If the document changes while the picker is open, insertion is rejected rather than applied at an uncertain location. Character limits are checked before dispatch, and an inserted template has its own undo step.
- Save failures keep the design open. Close/navigation guards protect dirty state and block closing while a save is pending. A synchronous save guard prevents duplicate submissions.
- GrapesJS loads only when the designer mounts and is destroyed on unmount. Its default storage, telemetry, external icon CSS, asset uploads, scripts, external drops and remote canvas resources are disabled.
- Project validation admits one page/frame, a bounded tree of built-in components and a restricted set of presentation properties. Scripts, custom component types, global CSS rules, external assets and live data sources cannot be loaded. Unknown model behaviors and wrapper head/document properties are stripped.
- DOMPurify plus explicit attribute, URL and CSS handling sanitizes pasted/exported HTML. Content is bounded to 1 MB of UTF-8 data, 2,000 components and 32 nested component levels.

## Validation

Focused tests exercise real Tiptap and real GrapesJS core, including project serialization/reopening, table semantics, escaped text, placeholder literals, styles, script/resource rejection, Markdown round trips, native `FormData`, selection, character limits, disabled/read-only fields and undo. Provider tests cover lazy loading, scope changes, permission changes and template filtering. Dialog tests cover the existing create transport, copying, failed saves, discard guards and duplicate submit protection.

Run the relevant UI tests with:

```sh
cd frontend/packages/ui
./node_modules/.bin/vitest run \
  src/lib/document-template-designer.test.ts \
  src/components/document-template-designer.test.tsx \
  src/components/rich-text-template-picker.test.tsx \
  src/components/textarea.test.tsx \
  src/lib/rich-text-extensions.test.ts \
  src/documents/document-template-provider.test.tsx \
  src/documents/document-template-designer-dialog.test.tsx
```

Transport tests live in `frontend/packages/query-hooks/src/hooks/templates.test.ts`; existing invoice-personalization tests also protect the legacy creation request. Large workspace type checks may require `NODE_OPTIONS=--max-old-space-size=6144`.

## Next integration boundaries

The current change does not bind arbitrary page layouts to invoice/quote rendering. That requires a typed record-binding contract, repeating line-item blocks, long-table pagination proof and a controlled server renderer before routing to the existing Chromium PDF worker. Existing invoice personalization and issued-document snapshots keep their current pipeline.

Likewise, `{{customer.name}}` and similar text are preserved literally, not evaluated. Record-aware merge fields should use an allowlisted data contract, not arbitrary expressions in template HTML. Durable offline saving, automatic reconnect, image/brand asset management, DOCX export and real-time collaboration are separate capabilities; bundling an open-source editor does not supply those workflows.

## Library references

- [GrapesJS project persistence](https://grapesjs.com/docs/modules/Storage.html)
- [GrapesJS editor API and lifecycle](https://grapesjs.com/docs/api/editor.html)
- [GrapesJS custom rich text editor API](https://grapesjs.com/docs/guides/Replace-Rich-Text-Editor.html) — available if later embedding Tiptap directly inside the canvas is useful.
- [Tiptap insertion commands](https://tiptap.dev/docs/editor/api/commands/content/insert-content-at)

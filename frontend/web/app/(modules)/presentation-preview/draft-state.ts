import type { ModuleDraft } from '@lumiere/presentation-core/module-contract'
import type { SaveDraftRequest, SavedDraft } from '@lumiere/presentation-core'

export interface DraftEditorState {
  definition: ModuleDraft
  revision: string | null
  dirty: boolean
  conflictRevision: string | null
}

export function draftScopeKey(
  organizationId: number,
  identity: string | null,
  moduleKey: string,
): string {
  return `${organizationId}:${identity ?? 'unknown'}:${moduleKey}`
}

export function createInitialDraft(applicationContract: string): ModuleDraft {
  return {
    schemaVersion: 1,
    moduleId: 'collections-preview',
    title: 'Collections preview',
    applicationContract,
    componentCatalogVersion: 1,
    baseRevision: null,
    pages: [{
      id: 'entries',
      title: 'Accounting entries',
      nodes: [
        {
          kind: 'collection',
          id: 'entries',
          slot: 'primary',
          component: { id: 'erp.collection', version: 1 },
          resource: 'account-moves',
          fields: [],
          pageSize: 25,
        },
        {
          kind: 'detail',
          id: 'entry-detail',
          slot: 'secondary',
          component: { id: 'erp.detail', version: 1 },
          sourceNodeId: 'entries',
          fields: [],
        },
      ],
    }],
  }
}

export function stateFromSavedDraft(saved: SavedDraft): DraftEditorState {
  return {
    definition: { ...saved.definition, baseRevision: saved.revision },
    revision: saved.revision,
    dirty: false,
    conflictRevision: null,
  }
}

export function updateDraft(
  state: DraftEditorState,
  definition: ModuleDraft,
): DraftEditorState {
  return { ...state, definition, dirty: true, conflictRevision: null }
}

export function saveRequest(state: DraftEditorState): SaveDraftRequest {
  return {
    expectedRevision: state.revision,
    definition: { ...state.definition, baseRevision: state.revision },
  }
}

export function stateAfterSave(
  state: DraftEditorState,
  saved: SavedDraft,
  submittedDefinition: ModuleDraft,
): DraftEditorState {
  const savedState = stateFromSavedDraft(saved)
  if (JSON.stringify(state.definition) === JSON.stringify(submittedDefinition)) return savedState
  return {
    ...state,
    definition: { ...state.definition, baseRevision: saved.revision },
    revision: saved.revision,
    dirty: true,
    conflictRevision: null,
  }
}

export function stateAfterConflict(
  state: DraftEditorState,
  serverRevision: string | null,
): DraftEditorState {
  return { ...state, conflictRevision: serverRevision }
}

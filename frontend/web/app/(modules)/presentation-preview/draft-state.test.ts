import assert from 'node:assert/strict'
import test from 'node:test'
import type { SavedDraft } from '@lumiere/presentation-core'
import {
  createInitialDraft,
  draftScopeKey,
  saveRequest,
  stateAfterConflict,
  stateAfterSave,
  stateFromSavedDraft,
  updateDraft,
} from './draft-state'

function saved(overrides: Partial<SavedDraft> = {}): SavedDraft {
  return {
    moduleKey: 'collections-preview',
    revision: '7',
    definitionHash: 'hash',
    definition: createInitialDraft('contract'),
    ...overrides,
  }
}

test('draft scope includes actor and organization, but never company', () => {
  assert.equal(draftScopeKey(4, 'actor-a', 'collections-preview'), '4:actor-a:collections-preview')
  assert.equal(draftScopeKey(4, 'actor-a', 'collections-preview'), draftScopeKey(4, 'actor-a', 'collections-preview'))
  assert.notEqual(draftScopeKey(4, 'actor-a', 'collections-preview'), draftScopeKey(5, 'actor-a', 'collections-preview'))
})

test('saved definitions retain every page and node on reopen', () => {
  const definition = createInitialDraft('contract')
  const extraPage = {
    id: 'second',
    title: 'Second',
    nodes: definition.pages[0].nodes,
  }
  const state = stateFromSavedDraft(saved({ definition: { ...definition, pages: [...definition.pages, extraPage] } }))
  assert.equal(state.definition.pages.length, 2)
  assert.equal(state.definition.pages[1]?.nodes[1]?.id, 'entry-detail')
  assert.equal(state.definition.baseRevision, '7')
})

test('stale save conflict preserves dirty edits', () => {
  const initial = stateFromSavedDraft(saved())
  const edited = updateDraft(initial, { ...initial.definition, title: 'Local title' })
  const conflict = stateAfterConflict(edited, '8')
  assert.equal(conflict.definition.title, 'Local title')
  assert.equal(conflict.dirty, true)
  assert.equal(conflict.conflictRevision, '8')
  assert.equal(saveRequest(conflict).expectedRevision, '7')
})

test('save request carries the complete definition and expected revision', () => {
  const state = stateFromSavedDraft(saved())
  const edited = updateDraft(state, { ...state.definition, title: 'Edited' })
  const request = saveRequest(edited)
  assert.equal(request.expectedRevision, '7')
  assert.equal(request.definition.title, 'Edited')
  assert.equal(request.definition.baseRevision, '7')
  assert.equal(request.definition.pages.length, edited.definition.pages.length)
  assert.equal(stateAfterSave(edited, saved({ revision: '8', definition: { ...edited.definition, baseRevision: '8' } }), edited.definition).dirty, false)
})

test('save response advances revision without overwriting a newer local edit', () => {
  const initial = stateFromSavedDraft(saved())
  const submitted = updateDraft(initial, { ...initial.definition, title: 'Submitted' })
  const newer = updateDraft(submitted, { ...submitted.definition, title: 'Typed while saving' })
  const after = stateAfterSave(newer, saved({ revision: '8', definition: { ...submitted.definition, baseRevision: '8' } }), submitted.definition)
  assert.equal(after.definition.title, 'Typed while saving')
  assert.equal(after.definition.baseRevision, '8')
  assert.equal(after.dirty, true)
})

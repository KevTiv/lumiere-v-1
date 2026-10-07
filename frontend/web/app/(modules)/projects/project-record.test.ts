import assert from 'node:assert/strict';
import test from 'node:test';

import { getProjectFieldValue, hoursLogged, projectHref, projectStatusTag, rowsOfProject, taskBoardState } from './project-record';

test('a project links to its own page', () => {
  assert.equal(projectHref({ id: 2 }), '/projects/2');
  assert.equal(projectHref({}), undefined);
});

test('the status reads from a tagged, keyed or plain value', () => {
  assert.equal(projectStatusTag({ tag: 'Paused' }), 'Paused');
  assert.equal(projectStatusTag({ Done: [] }), 'Done');
  assert.equal(projectStatusTag('InProgress'), 'InProgress');
  assert.equal(projectStatusTag(null), '');
});

test('related rows and logged hours belong to one project', () => {
  const rows = [
    { id: 1, projectId: 5, unitAmount: 2 },
    { id: 2, project_id: '5', unit_amount: 1.5 },
    { id: 3, projectId: 6, unitAmount: 9 },
  ];

  const own = rowsOfProject(rows, '5');
  assert.deepEqual(own.map((r) => r.id), [1, 2]);
  assert.equal(hoursLogged(own), 3.5);
  assert.equal(hoursLogged([]), 0);
});

test('edit-form defaults come from the project row', () => {
  const project = { name: 'Site', partnerId: 4, dateStart: 1_700_000_000_000_000 };

  assert.equal(getProjectFieldValue(project, 'name'), 'Site');
  assert.equal(getProjectFieldValue(project, 'partnerId'), '4');
  assert.equal(getProjectFieldValue(project, 'dateStart'), '2023-11-14');
  assert.equal(getProjectFieldValue(project, 'billType'), 'customer_task');
  assert.equal(getProjectFieldValue(project, 'unknown'), '');
});

test('taskBoardState reads the state tag and defaults to InProgress', () => {
  assert.equal(taskBoardState({ state: { tag: 'Done' } }), 'Done');
  assert.equal(taskBoardState({ state: 'ChangesRequested' }), 'ChangesRequested');
  assert.equal(taskBoardState({}), 'InProgress');
  assert.equal(taskBoardState({ state: { tag: 'Bogus' } }), 'InProgress');
});

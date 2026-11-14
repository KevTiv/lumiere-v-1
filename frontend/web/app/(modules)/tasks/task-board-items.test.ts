import assert from 'node:assert/strict';
import test from 'node:test';

import { taskAttachmentCounts, taskBoardItemInState, taskProgressPercent, toTaskBoardItem } from './task-board-items';
import { matchesTaskRecord, taskRecordTarget } from './task-record-link';

test('task link resolves an exact ID only within its active company', () => {
  const link = { id: '9007199254740993', companyId: '7', view: 'edit' as const };
  assert.equal(taskRecordTarget(link, 7n), link.id);
  assert.equal(taskRecordTarget(link, 8n), undefined);
  assert.equal(taskRecordTarget({ ...link, id: '8e1' }, 7n), undefined);
});

test('linked task readback verifies record identity and scope without rounding IDs', () => {
  const row = { id: '9007199254740993', organization_id: '3', companyId: '7' };
  assert.equal(matchesTaskRecord(row, row.id, 3n, 7n), true);
  assert.equal(matchesTaskRecord(row, row.id, 3n, 8n), false);
  assert.equal(matchesTaskRecord(row, row.id, 4n, 7n), false);
  assert.equal(matchesTaskRecord({ ...row, id: 9007199254740992 }, row.id, 3n, 7n), false);
});

const lookups = {
  projectNames: new Map([['7', 'Website']]),
  identityLabels: new Map([['abc123', 'Ada Lovelace']]),
  attachmentCounts: new Map([['3', 2]]),
};

test('optimistic closure and reopening keep column and closed flag consistent', () => {
  const open = toTaskBoardItem({ id: 1, name: 'Overdue task', state: 'InProgress', priority: '1', isClosed: false }, lookups);
  for (const state of ['Done', 'Cancelled'] as const) {
    const closed = taskBoardItemInState(open, state);
    assert.equal(closed.columnId, state);
    assert.equal(closed.isClosed, true);
    const reopened = taskBoardItemInState(closed, 'InProgress');
    assert.equal(reopened.columnId, 'InProgress');
    assert.equal(reopened.isClosed, false);
  }
  assert.equal(open.isClosed, false);
});

test('a task row becomes a board item with names, counts and its column', () => {
  const item = toTaskBoardItem(
    {
      id: 3n,
      name: 'Write copy',
      state: { tag: 'Approved' },
      priority: '2',
      projectId: 7n,
      userIds: ['ABC123', 'ffff0000ffff0000'],
      dateDeadline: { microsSinceUnixEpoch: 1_700_000_000_000_000n },
      isClosed: false,
      messageIds: [1n, 2n, 3n],
      progress: 40,
    },
    lookups,
  );
  assert.equal(item.id, '3');
  assert.equal(item.columnId, 'Approved');
  assert.equal(item.priority, '2');
  assert.equal(item.projectName, 'Website');
  assert.deepEqual(item.assignees.map((p) => p.name), ['Ada Lovelace', 'ffff0000…']);
  assert.equal(item.dueAt, 1_700_000_000_000);
  assert.equal(item.commentCount, 3);
  assert.equal(item.attachmentCount, 2);
  assert.equal(item.progress, 40);
});

test('an unknown state sits in progress and an unnamed task shows its id', () => {
  const item = toTaskBoardItem({ id: 9, name: '', state: undefined, priority: '0', isClosed: false }, lookups);
  assert.equal(item.columnId, 'InProgress');
  assert.equal(item.title, '#9');
  assert.equal(item.dueAt, null);
  assert.equal(item.progress, null);
});

test('progress falls back to effective over planned hours', () => {
  assert.equal(taskProgressPercent({ progress: 0, plannedHours: 8, effectiveHours: 2 }), 25);
  assert.equal(taskProgressPercent({ progress: 0, plannedHours: 4, effectiveHours: 10 }), 100);
  assert.equal(taskProgressPercent({}), null);
});

test('only live documents on tasks count as attachments', () => {
  const counts = taskAttachmentCounts([
    { resModel: 'project_task', resId: 3n },
    { resModel: 'project_task', resId: 3n },
    { resModel: 'project_task', resId: 3n, isDeleted: true },
    { resModel: 'sale_order', resId: 3n },
    { resModel: 'project_task', resId: undefined },
  ]);
  assert.deepEqual([...counts], [['3', 2]]);
});

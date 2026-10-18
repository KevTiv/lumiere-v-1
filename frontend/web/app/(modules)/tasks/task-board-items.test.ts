import assert from 'node:assert/strict';
import test from 'node:test';

import { taskAttachmentCounts, taskProgressPercent, toTaskBoardItem } from './task-board-items';

const lookups = {
  projectNames: new Map([['7', 'Website']]),
  identityLabels: new Map([['abc123', 'Ada Lovelace']]),
  attachmentCounts: new Map([['3', 2]]),
};

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

import assert from 'node:assert/strict';
import test from 'node:test';

import { agendaItems, isTaskDone, myWorkTasks, projectProgress, recentNotes } from './productivity-data';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 18, 12);
const micros = (ms: number) => ({ microsSinceUnixEpoch: BigInt(ms) * 1000n });
const me = 'AB12';

const tasks = [
  { id: 1n, name: 'Overdue', state: { tag: 'InProgress' }, priority: '3', projectId: 7n, userIds: ['ab12'], dateDeadline: micros(now - DAY), isClosed: false },
  { id: 2n, name: 'Later', state: { tag: 'InProgress' }, priority: '0', projectId: 7n, userIds: ['ab12'], dateDeadline: micros(now + 30 * DAY), isClosed: false },
  { id: 3n, name: 'Undated', state: { tag: 'Approved' }, priority: '1', userIds: ['ab12'], isClosed: false },
  { id: 4n, name: 'Done', state: { tag: 'Done' }, priority: '0', projectId: 7n, userIds: ['ab12', 'cd34'], dateDeadline: micros(now), isClosed: true },
  { id: 5n, name: 'Someone else', state: { tag: 'InProgress' }, priority: '0', projectId: 7n, userIds: ['cd34'], dateDeadline: micros(now + DAY), isClosed: false },
];

const options = { identity: me, projectNames: new Map([['7', 'Website']]), priorityLabel: (p: string) => `P${p}`, now };

test('my work lists my open tasks due this week, overdue first, then undated', () => {
  const items = myWorkTasks(tasks, options);
  assert.deepEqual(items.map((i) => i.title), ['Overdue', 'Undated']);
  assert.equal(items[0]!.projectName, 'Website');
  assert.equal(items[0]!.href, '/projects/7?tab=tasks');
  assert.deepEqual(items[0]!.priority, { label: 'P3', tone: 'destructive' });
  assert.equal(items[1]!.href, '/tasks');
});

test('a task just ticked stays listed, and no identity means everyone', () => {
  assert.ok(myWorkTasks(tasks, { ...options, keep: new Set(['4']) }).some((i) => i.id === '4' && i.done));
  assert.ok(myWorkTasks(tasks, { ...options, identity: null }).some((i) => i.title === 'Someone else'));
});

test('project progress is the share of closed tasks with their people', () => {
  const [project] = projectProgress(
    [
      { id: 7n, name: 'Website', active: true, dateEnd: micros(now + DAY) },
      { id: 8n, name: 'Archived', active: false },
    ],
    tasks,
    new Map([['ab12', 'Ada']]),
  );
  assert.equal(project!.name, 'Website');
  assert.equal(project!.totalTasks, 4);
  assert.equal(project!.openTasks, 3);
  assert.equal(project!.progress, 25);
  assert.deepEqual(project!.members.map((m) => m.name), ['Ada', 'cd34']);
});

test('the agenda holds events and open deadlines', () => {
  const items = agendaItems([{ id: 9n, name: 'Standup', start: micros(now) }], tasks);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.title}`), ['event:Standup', 'deadline:Overdue', 'deadline:Later', 'deadline:Someone else']);
  assert.equal(items[0]!.href, '/calendar/events/9');
});

test('recent notes run newest first', () => {
  const notes = recentNotes([
    { id: 1n, name: 'Old', writeDate: micros(now - DAY) },
    { id: 2n, name: 'New', description: 'Fresh', writeDate: micros(now) },
  ]);
  assert.deepEqual(notes.map((n) => n.title), ['New', 'Old']);
  assert.equal(notes[0]!.excerpt, 'Fresh');
  assert.ok(isTaskDone({ state: 'Cancelled', isClosed: false }));
});

import type { AgendaItem, ProjectProgressItem, RecentNoteItem, WorkTaskItem } from '@lumiere/ui';
import { formatTimestampLike } from '@lumiere/ui/lib/entity-row-values';
import { identityToHex, resolveIdentityLabel } from '@lumiere/ui/lib/identity-label';
import { TASK_PRIORITY_TONES } from '@lumiere/ui/lib/task-priority';

const DAY_MS = 86_400_000;

const epochMs = (value: unknown): number | null => formatTimestampLike(value)?.getTime() ?? null;

/** Lower-cased tag of an enum cell (`{ tag }`) or plain string. */
function stateTag(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'tag' in value && typeof value.tag === 'string') return value.tag;
  return '';
}

/** The task fields the widgets read; generated `ProjectTask` rows satisfy it. */
export interface WorkTaskRow {
  id: unknown;
  name: string;
  state: unknown;
  priority: string;
  projectId?: unknown;
  userIds?: readonly unknown[];
  dateDeadline?: unknown;
  isClosed: boolean;
}

export interface WorkProjectRow {
  id: unknown;
  name: string;
  active: boolean;
  dateEnd?: unknown;
  taskCount?: number;
  taskCountClosed?: number;
}

export interface WorkNoteRow {
  id: unknown;
  name: string;
  description?: string | null;
  writeDate?: unknown;
}

export interface WorkEventRow {
  id: unknown;
  name: string;
  start: unknown;
  state?: string;
}

export function isTaskDone(task: Pick<WorkTaskRow, 'state' | 'isClosed'>): boolean {
  const tag = stateTag(task.state);
  return task.isClosed || tag === 'Done' || tag === 'Cancelled';
}

/**
 * The signed-in person's tasks that need attention: open ones due by the end of the week ahead
 * (overdue first), then undated ones, at most `limit`. With no identity, everyone's.
 * Tasks in `keep` stay listed while done, so a just-ticked row does not jump away.
 */
export function myWorkTasks(
  tasks: readonly WorkTaskRow[],
  options: {
    identity: string | null;
    projectNames: ReadonlyMap<string, string>;
    priorityLabel: (priority: string) => string;
    now: number;
    limit?: number;
    keep?: ReadonlySet<string>;
  },
): WorkTaskItem[] {
  const me = options.identity ? identityToHex(options.identity) : '';
  const horizon = options.now + 7 * DAY_MS;
  const mine = tasks.filter((task) => !me || (task.userIds ?? []).some((uid) => identityToHex(uid) === me));
  return mine
    .map((task) => ({ task, dueAt: epochMs(task.dateDeadline), done: isTaskDone(task) }))
    .filter(({ task, dueAt, done }) => options.keep?.has(String(task.id)) || (!done && (dueAt == null || dueAt <= horizon)))
    .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER))
    .slice(0, options.limit ?? 6)
    .map(({ task, dueAt, done }) => {
      const projectId = task.projectId == null ? undefined : String(task.projectId);
      const priority = String(task.priority ?? '0');
      return {
        id: String(task.id),
        title: task.name || `#${String(task.id)}`,
        projectName: projectId ? options.projectNames.get(projectId) : undefined,
        dueAt,
        done,
        priority: { label: options.priorityLabel(priority), tone: TASK_PRIORITY_TONES[priority] ?? 'neutral' },
        href: projectId ? `/projects/${projectId}?tab=tasks` : '/tasks',
      };
    });
}

/** Active projects with their share of closed tasks, soonest end date first. */
export function projectProgress(
  projects: readonly WorkProjectRow[],
  tasks: readonly WorkTaskRow[],
  identityLabels: ReadonlyMap<string, string>,
  limit = 4,
): ProjectProgressItem[] {
  return projects
    .filter((project) => project.active)
    .map((project) => {
      const id = String(project.id);
      const own = tasks.filter((task) => String(task.projectId ?? '') === id);
      const total = own.length > 0 ? own.length : (project.taskCount ?? 0);
      const closed = own.length > 0 ? own.filter(isTaskDone).length : (project.taskCountClosed ?? 0);
      const members = new Map<string, string>();
      for (const task of own) {
        for (const uid of task.userIds ?? []) {
          const hex = identityToHex(uid);
          if (hex) members.set(hex, resolveIdentityLabel(hex, identityLabels));
        }
      }
      return {
        id,
        name: project.name,
        progress: total > 0 ? (closed / total) * 100 : 0,
        openTasks: total - closed,
        totalTasks: total,
        dueAt: epochMs(project.dateEnd),
        members: [...members].map(([memberId, name]) => ({ id: memberId, name })),
        href: `/projects/${id}`,
      };
    })
    .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER) || b.openTasks - a.openTasks)
    .slice(0, limit);
}

/** Calendar events and open task deadlines, for the mini calendar. */
export function agendaItems(events: readonly WorkEventRow[], tasks: readonly WorkTaskRow[]): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const event of events) {
    const at = epochMs(event.start);
    if (at == null || event.state === 'cancelled') continue;
    items.push({ id: String(event.id), title: event.name, at, kind: 'event', href: `/calendar/events/${String(event.id)}` });
  }
  for (const task of tasks) {
    const at = epochMs(task.dateDeadline);
    if (at == null || isTaskDone(task)) continue;
    const projectId = task.projectId == null ? null : String(task.projectId);
    items.push({ id: String(task.id), title: task.name, at, kind: 'deadline', href: projectId ? `/projects/${projectId}?tab=tasks` : '/tasks' });
  }
  return items;
}

/** Most recently changed knowledge articles. */
export function recentNotes(articles: readonly WorkNoteRow[], limit = 5): RecentNoteItem[] {
  return articles
    .map((article) => ({
      id: String(article.id),
      title: article.name,
      excerpt: article.description ?? undefined,
      updatedAt: epochMs(article.writeDate),
      kind: 'article' as const,
      href: '/documents?tab=knowledge-base',
    }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);
}

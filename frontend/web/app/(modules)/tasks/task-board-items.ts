import type { TaskBoardItem } from '@lumiere/ui';
import { identityToHex, resolveIdentityLabel } from '@lumiere/ui/lib/identity-label';
import { formatTimestampLike } from '@lumiere/ui/lib/entity-row-values';
import { taskBoardState } from '../projects/project-record';

/** The task fields the board reads; generated `ProjectTask` rows satisfy it. */
export interface TaskBoardSourceRow {
  id: unknown;
  name: string;
  state: unknown;
  priority: string;
  projectId?: unknown;
  userIds?: readonly unknown[];
  dateDeadline?: unknown;
  isClosed: boolean;
  messageIds?: readonly unknown[];
  progress?: number;
  plannedHours?: number;
  effectiveHours?: number;
}

export interface TaskBoardLookups {
  /** Project id → name. */
  projectNames: ReadonlyMap<string, string>;
  /** Identity hex → display name. */
  identityLabels: ReadonlyMap<string, string>;
  /** Task id → number of documents attached to it. */
  attachmentCounts: ReadonlyMap<string, number>;
}

/** Percent done: the stored progress, else effective over planned hours, else unknown. */
export function taskProgressPercent(row: Pick<TaskBoardSourceRow, 'progress' | 'plannedHours' | 'effectiveHours'>): number | null {
  const stored = Number(row.progress ?? 0);
  if (Number.isFinite(stored) && stored > 0) return Math.min(100, stored);
  const planned = Number(row.plannedHours ?? 0);
  const effective = Number(row.effectiveHours ?? 0);
  if (planned > 0 && Number.isFinite(effective)) return Math.min(100, (effective / planned) * 100);
  return null;
}

export function toTaskBoardItem(row: TaskBoardSourceRow, lookups: TaskBoardLookups): TaskBoardItem {
  const id = String(row.id);
  const projectId = row.projectId == null ? undefined : String(row.projectId);
  return {
    id,
    title: row.name || `#${id}`,
    columnId: taskBoardState({ state: row.state }),
    projectId,
    projectName: projectId ? lookups.projectNames.get(projectId) : undefined,
    priority: String(row.priority ?? '0'),
    assignees: (row.userIds ?? [])
      .map((identity) => identityToHex(identity))
      .filter((hex) => hex !== '')
      .map((hex) => ({ id: hex, name: resolveIdentityLabel(hex, lookups.identityLabels) })),
    dueAt: formatTimestampLike(row.dateDeadline)?.getTime() ?? null,
    isClosed: row.isClosed === true,
    commentCount: row.messageIds?.length ?? 0,
    attachmentCount: lookups.attachmentCounts.get(id) ?? 0,
    progress: taskProgressPercent(row),
  };
}

/** Documents attached to tasks (`resModel` project_task), counted per task id. */
export function taskAttachmentCounts(
  documents: ReadonlyArray<{ resModel?: string | null; resId?: unknown; isDeleted?: boolean }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const doc of documents) {
    if (doc.isDeleted || doc.resModel !== 'project_task' || doc.resId == null) continue;
    const key = String(doc.resId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

type Row = Record<string, unknown>;

/** Where a project's page lives. */
export function projectHref(project: Row): string | undefined {
  return project.id == null ? undefined : `/projects/${String(project.id)}`;
}

/** Lower-cased tag of an enum cell (`{ tag }`, `{ Paused: [] }`) or plain string. */
export function projectStatusTag(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('tag' in value && typeof (value as { tag: unknown }).tag === 'string') return (value as { tag: string }).tag;
    const keys = Object.keys(value);
    if (keys.length === 1) return keys[0]!;
  }
  return '';
}

/** The rows of a related list (tasks, timesheets) that belong to one project. */
export function rowsOfProject(rows: ReadonlyArray<Row>, projectId: string): Row[] {
  return rows.filter((row) => String(row.projectId ?? row.project_id ?? '') === projectId);
}

/** Hours logged on a set of timesheet rows. */
export function hoursLogged(timesheets: ReadonlyArray<Row>): number {
  return timesheets.reduce((sum, row) => sum + (Number(row.unitAmount ?? row.unit_amount ?? 0) || 0), 0);
}

export function getProjectFieldValue(project: Record<string, unknown>, fieldName: string): unknown {
  switch (fieldName) {
    case 'name':
      return project.name ?? ''
    case 'pricelistId':
      return String(project.pricelistId ?? '')
    case 'partnerId':
      return String(project.partnerId ?? '')
    case 'billType':
      return String(project.billType ?? 'customer_task')
    case 'pricingType':
      return String(project.pricingType ?? 'task_rate')
    case 'allocatedHours':
      return project.allocatedHours ?? ''
    case 'dateStart':
      return project.dateStart ? new Date(Number(project.dateStart) / 1000).toISOString().split('T')[0] : ''
    case 'dateEnd':
      return project.dateEnd ? new Date(Number(project.dateEnd) / 1000).toISOString().split('T')[0] : ''
    case 'description':
      return project.description ?? ''
    case 'active':
      return project.active ?? true
    default:
      return ''
  }
}


/** Task states in board column order (the `TaskState` enum of the backend). */
export const TASK_BOARD_STATES = ['InProgress', 'ChangesRequested', 'Approved', 'Done', 'Cancelled'] as const;
export type TaskBoardState = (typeof TASK_BOARD_STATES)[number];

/** The board column a task row sits in: its `state` tag, `InProgress` when absent or unknown. */
export function taskBoardState(task: Row): TaskBoardState {
  const tag = projectStatusTag(task.state);
  return (TASK_BOARD_STATES as readonly string[]).includes(tag) ? (tag as TaskBoardState) : 'InProgress';
}

import type { KanbanCardTone } from "../kanban/kanban-card"

/** Badge tone of a task's backend priority code: "0" normal, "1" low, "2" high, "3" urgent. */
export const TASK_PRIORITY_TONES: Readonly<Partial<Record<string, KanbanCardTone>>> = {
  "0": "info",
  "1": "neutral",
  "2": "warning",
  "3": "destructive",
}

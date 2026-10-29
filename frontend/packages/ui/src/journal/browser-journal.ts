import type { WorkNote, NotePriority, NoteStatus, NoteType } from "../lib/journal-types"

const MAX_BYTES = 1_000_000
const types = new Set<NoteType>(["observation", "task-update", "blocker", "idea", "meeting-note", "reminder", "question", "decision"])
const priorities = new Set<NotePriority>(["low", "normal", "high", "urgent"])
const statuses = new Set<NoteStatus>(["active", "resolved", "archived"])

export function journalStorageKey(scope: string): string { return `lumiere.journal.v1:${scope}` }

function parseNotes(value: unknown): WorkNote[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Invalid saved notes")
  const seen = new Set<string>()
  return value.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid saved note")
    const note = row as WorkNote
    if (typeof note.id !== "string" || note.id.length > 100 || seen.has(note.id)
      || typeof note.userId !== "string" || typeof note.content !== "string" || note.content.length > 20_000
      || !types.has(note.type) || !priorities.has(note.priority) || !statuses.has(note.status)
      || !Array.isArray(note.tags) || note.tags.length > 50 || note.tags.some((tag) => typeof tag !== "string" || tag.length > 100)
      || !Array.isArray(note.mentions) || note.mentions.length > 50 || note.mentions.some((id) => typeof id !== "string")
      || typeof note.createdAt !== "string" || !Number.isFinite(Date.parse(note.createdAt))
      || typeof note.updatedAt !== "string" || !Number.isFinite(Date.parse(note.updatedAt))
      || (note.linkedTaskId !== undefined && typeof note.linkedTaskId !== "string")
      || (note.linkedTaskTitle !== undefined && typeof note.linkedTaskTitle !== "string")
      || (note.resolvedAt !== undefined && (typeof note.resolvedAt !== "string" || !Number.isFinite(Date.parse(note.resolvedAt)))))
      throw new Error("Invalid saved note")
    seen.add(note.id)
    return { id: note.id, userId: note.userId, type: note.type, content: note.content, priority: note.priority,
      status: note.status, tags: [...note.tags], mentions: [...note.mentions], createdAt: note.createdAt,
      updatedAt: note.updatedAt, linkedTaskId: note.linkedTaskId, linkedTaskTitle: note.linkedTaskTitle, resolvedAt: note.resolvedAt }
  })
}

export function readBrowserJournal(storage: Pick<Storage, "getItem">, scope: string): WorkNote[] {
  const raw = storage.getItem(journalStorageKey(scope))
  if (!raw) return []
  if (raw.length > MAX_BYTES) throw new Error("Saved notes exceed their storage limit")
  const envelope: unknown = JSON.parse(raw)
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("Invalid journal storage")
  const value = envelope as { version?: unknown; scope?: unknown; notes?: unknown }
  if (value.version !== 1 || value.scope !== scope) throw new Error("Unsupported journal storage")
  return parseNotes(value.notes)
}

export function writeBrowserJournal(storage: Pick<Storage, "getItem" | "setItem">, scope: string, notes: WorkNote[], expected?: WorkNote[]): void {
  // An unreadable prior version must never be silently replaced.
  const current = readBrowserJournal(storage, scope)
  if (expected && JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("Notes changed in another browser tab. Reopen before changing them.")
  const raw = JSON.stringify({ version: 1, scope, notes: parseNotes(notes) })
  if (raw.length > MAX_BYTES) throw new Error("Saved notes exceed their storage limit")
  storage.setItem(journalStorageKey(scope), raw)
}

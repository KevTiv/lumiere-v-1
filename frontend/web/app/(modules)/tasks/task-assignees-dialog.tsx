"use client"

import { useEffect, useRef, useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useAssignTaskUsers, useTaskAssignees, type ProjectTask } from "@lumiere/query-hooks/hooks/projects"
import { taskIdentityHex } from "@lumiere/query-hooks/hooks/task-assignment"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { Button } from "@lumiere/ui/components/button"
import { Checkbox } from "@lumiere/ui/components/checkbox"
import { Input } from "@lumiere/ui/components/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@lumiere/ui/components/dialog"
import { showWorkflowToast } from "@lumiere/ui/lib/workflow-toast"

export function TaskAssigneesDialog({
  organizationId,
  task,
  onClose,
}: {
  organizationId: bigint
  task: ProjectTask
  onClose: () => void
}) {
  const session = useErpSession()
  const activeCompany = useOperatingCompanyId(Number(organizationId))
  const { currentUser, roles, policies, permissionsReady, checkPermission } = useRBAC()
  const authorizationKey = JSON.stringify({ currentUser, roles, policies })
  const scopeKey = `${organizationId}:${task.companyId}:${task.id}:${session.identity}:${authorizationKey}:${activeCompany}`
  const openedScope = useRef(scopeKey)
  const submitting = useRef(false)
  const [online, setOnline] = useState(true)
  const canAssign = openedScope.current === scopeKey && permissionsReady !== false && !!currentUser && !!session.identity &&
    session.organizationId === Number(organizationId) && session.activeCompanyReady !== false &&
    activeCompany != null && BigInt(activeCompany) === BigInt(task.companyId) && checkPermission("project_task", "write").allowed
  const directory = useTaskAssignees(organizationId, BigInt(task.companyId), task.id, canAssign && online, { actorIdentity: session.identity ?? "", authorizationKey })
  const assign = useAssignTaskUsers(organizationId)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(
    (Array.isArray(task.userIds) ? task.userIds : []).flatMap((value) => {
      const identity = taskIdentityHex(value)
      return identity ? [identity] : []
    }),
  ))
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [invalidAssignment, setInvalidAssignment] = useState(() => !Array.isArray(task.userIds) || task.userIds.some((value) => !taskIdentityHex(value)))
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update) }
  }, [])
  useEffect(() => { if (openedScope.current !== scopeKey) onClose() }, [scopeKey, onClose])
  const options = canAssign && !directory.isError && directory.isSuccess ? directory.data : []
  const eligible = new Set(options.map((option) => option.id))
  const unavailable = [...selected].filter((identity) => !eligible.has(identity))
  const ready = canAssign && online && directory.isSuccess && !directory.isFetching && !directory.isError
  const filtered = options.filter((option) => option.name.toLowerCase().includes(search.trim().toLowerCase()))

  const save = async () => {
    if (!canAssign || !ready || unavailable.length > 0 || invalidAssignment || submitting.current || !navigator.onLine) return
    submitting.current = true
    setError(null)
    try {
      await assign.mutateAsync({ taskId: task.id, companyId: task.companyId, userIds: [...selected] })
      showWorkflowToast({ kind: "success", title: "Task assignment saved" })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the assignment")
    } finally {
      submitting.current = false
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !assign.isPending) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden sm:max-w-lg" showCloseButton={!assign.isPending}>
        <DialogHeader className="shrink-0">
          <DialogTitle>Assign task</DialogTitle>
          <DialogDescription>Select active members of this company. Clear the selection to leave the task unassigned.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain" data-testid="task-assignees-body">
        <p className="break-words text-sm font-medium">{task.name}</p>
        <Input aria-label="Find an assignee" placeholder="Find a person" value={search} onChange={(event) => setSearch(event.target.value)} />
        {canAssign && online && !ready && !directory.isError ? <p role="status">Loading eligible people…</p> : null}
        {!online ? <p role="status">Connect to the network to change assignments.</p> : null}
        {directory.isError ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>Eligible people could not be loaded. Your access may have changed.</p>
            <Button variant="outline" disabled={!canAssign || !online || directory.isFetching || assign.isPending} onClick={() => { void directory.refetch() }}>Retry</Button>
          </div>
        ) : null}
        <div className="flex flex-col gap-1" aria-label="Eligible assignees">
          {filtered.map((option) => (
            <label key={option.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted">
              <Checkbox
                checked={selected.has(option.id)}
                disabled={!ready || assign.isPending}
                onCheckedChange={(checked) => setSelected((current) => {
                  const next = new Set(current)
                  if (checked) next.add(option.id)
                  else next.delete(option.id)
                  return next
                })}
              />
              <span className="min-w-0 break-words">{option.name}</span>
            </label>
          ))}
          {ready && filtered.length === 0 ? <p className="text-sm text-muted-foreground">No eligible people match.</p> : null}
        </div>
        {ready && unavailable.length > 0 ? (
          <p role="alert" className="text-sm text-destructive">{unavailable.length} current assignee(s) are no longer eligible. Clear the selection and choose active members.</p>
        ) : null}
        {invalidAssignment ? <p role="alert" className="text-sm text-destructive">The current assignment could not be read. Clear the selection to replace it explicitly.</p> : null}
        {!canAssign ? <p role="status" className="text-sm text-muted-foreground">You do not have permission to change task assignments.</p> : null}
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="ghost" disabled={!canAssign || assign.isPending} onClick={() => { setSelected(new Set()); setInvalidAssignment(false) }}>Clear selection</Button>
          <Button variant="outline" disabled={assign.isPending} onClick={onClose}>Cancel</Button>
          <Button disabled={!canAssign || !ready || unavailable.length > 0 || invalidAssignment || assign.isPending} onClick={() => void save()}>
            {assign.isPending ? "Saving…" : "Save assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

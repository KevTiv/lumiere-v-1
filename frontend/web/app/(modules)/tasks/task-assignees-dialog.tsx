"use client"
import { useTranslation } from "@lumiere/i18n"


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
  const { t } = useTranslation()
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
      showWorkflowToast({ kind: "success", title: t("tasks.taskAssigneesDialog.taskAssignmentSaved") })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("tasks.taskAssigneesDialog.couldNotSaveTheAssignment"))
    } finally {
      submitting.current = false
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !assign.isPending) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden sm:max-w-lg" showCloseButton={!assign.isPending}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("tasks.taskAssigneesDialog.assignTask")}</DialogTitle>
          <DialogDescription>{t("tasks.taskAssigneesDialog.selectActiveMembersOfThisCompanyClearTheSelectionToLeave")}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain" data-testid="task-assignees-body">
        <p className="break-words text-sm font-medium">{task.name}</p>
        <Input aria-label={t("tasks.taskAssigneesDialog.findAnAssignee")} placeholder={t("tasks.taskAssigneesDialog.findAPerson")} value={search} onChange={(event) => setSearch(event.target.value)} />
        {canAssign && online && !ready && !directory.isError ? <p role="status">{t("tasks.taskAssigneesDialog.loadingEligiblePeople")}</p> : null}
        {!online ? <p role="status">{t("tasks.taskAssigneesDialog.connectToTheNetworkToChangeAssignments")}</p> : null}
        {directory.isError ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{t("tasks.taskAssigneesDialog.eligiblePeopleCouldNotBeLoadedYourAccessMayHaveChanged")}</p>
            <Button variant="outline" disabled={!canAssign || !online || directory.isFetching || assign.isPending} onClick={() => { void directory.refetch() }}>{t("common.retry")}</Button>
          </div>
        ) : null}
        <div className="flex flex-col gap-1" aria-label={t("tasks.taskAssigneesDialog.eligibleAssignees")}>
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
          {ready && filtered.length === 0 ? <p className="text-sm text-muted-foreground">{t("tasks.taskAssigneesDialog.noEligiblePeopleMatch")}</p> : null}
        </div>
        {ready && unavailable.length > 0 ? (
          <p role="alert" className="text-sm text-destructive">{t("tasks.taskAssigneesDialog.ineligibleAssignees", { count: unavailable.length })}</p>
        ) : null}
        {invalidAssignment ? <p role="alert" className="text-sm text-destructive">{t("tasks.taskAssigneesDialog.theCurrentAssignmentCouldNotBeReadClearTheSelectionTo")}</p> : null}
        {!canAssign ? <p role="status" className="text-sm text-muted-foreground">{t("tasks.taskAssigneesDialog.youDoNotHavePermissionToChangeTaskAssignments")}</p> : null}
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="ghost" disabled={!canAssign || assign.isPending} onClick={() => { setSelected(new Set()); setInvalidAssignment(false) }}>{t("accounting.worklists.clearSelection")}</Button>
          <Button variant="outline" disabled={assign.isPending} onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={!canAssign || !ready || unavailable.length > 0 || invalidAssignment || assign.isPending} onClick={() => void save()}>
            {assign.isPending ? t("common.saving") : t("tasks.taskAssigneesDialog.saveAssignment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

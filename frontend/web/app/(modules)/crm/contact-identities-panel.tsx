"use client"

import { useMemo, useState } from "react"
import {
  ArchiveIcon,
  BadgeCheckIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserRoundPlusIcon,
  UserRoundXIcon,
} from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import {
  assignContactRoleForm,
  contactIdentityForm,
  endContactRoleForm,
  RuntimeFormModal,
} from "@lumiere/ui"
import {
  useArchiveContactIdentity,
  useAssignContactRole,
  useContactPhoneIdentities,
  useContactRoleAssignments,
  useCreateContactIdentity,
  useEndContactRole,
  useUpdateContactIdentity,
  useVerifyContactIdentity,
} from "@lumiere/query-hooks/hooks/crm"
import type {
  ContactIdentityKind,
  ContactVerificationState,
} from "@lumiere/stdb/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

type Row = Record<string, unknown>
type IdentityKindName = "Primary" | "WhatsApp" | "MobileMoney"
type VerificationStateName = "Unverified" | "Pending" | "Verified" | "Failed" | "OptedOut"

const IDENTITY_KINDS: Array<{ value: IdentityKindName; label: string }> = [
  { value: "Primary", label: "Primary phone" },
  { value: "WhatsApp", label: "WhatsApp" },
  { value: "MobileMoney", label: "Mobile money" },
]

const VERIFICATION_STATES: Array<{ value: VerificationStateName; label: string }> = [
  { value: "Unverified", label: "Unverified" },
  { value: "Pending", label: "Pending" },
  { value: "Verified", label: "Verified" },
  { value: "Failed", label: "Failed" },
  { value: "OptedOut", label: "Opted out" },
]

function optionValue(value: unknown): unknown {
  if (value != null && typeof value === "object" && "some" in value) {
    return (value as { some: unknown }).some
  }
  return value
}

function asId(value: unknown): bigint | null {
  const raw = optionValue(value)
  if (raw == null || raw === "") return null
  try {
    return typeof raw === "bigint" ? raw : BigInt(String(raw))
  } catch {
    return null
  }
}

function enumName(value: unknown): string {
  if (value != null && typeof value === "object" && "tag" in value) {
    return String((value as { tag: unknown }).tag)
  }
  return String(value ?? "")
}

function enumValue<T>(tag: string): T {
  return { tag } as T
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function isArchived(row: Row): boolean {
  return optionValue(row.archivedAt ?? row.archived_at) != null
}

function isActive(row: Row): boolean {
  return Boolean(row.isActive ?? row.is_active)
}

function rowId(row: Row): bigint | null {
  return asId(row.id)
}

function identityKind(row: Row): IdentityKindName {
  const kind = enumName(row.kind)
  return IDENTITY_KINDS.some((option) => option.value === kind)
    ? (kind as IdentityKindName)
    : "Primary"
}

function verificationState(row: Row): VerificationStateName {
  const state = enumName(row.verificationState ?? row.verification_state)
  return VERIFICATION_STATES.some((option) => option.value === state)
    ? (state as VerificationStateName)
    : "Unverified"
}

function identityStateVariant(state: VerificationStateName) {
  if (state === "Verified") return "default" as const
  if (state === "Failed" || state === "OptedOut") return "destructive" as const
  return "secondary" as const
}

function displayMasked(row: Row): string {
  return String(row.displayMasked ?? row.display_masked ?? "Masked phone")
}

export interface ContactIdentitiesPanelProps {
  organizationId: number
  contactId: bigint
  companyId?: bigint
}

export function ContactIdentitiesPanel({
  organizationId,
  contactId,
  companyId,
}: ContactIdentitiesPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: identityRows = [], isLoading: identitiesLoading } = useContactPhoneIdentities(organization)
  const { data: roleRows = [], isLoading: rolesLoading } = useContactRoleAssignments(organization)
  const createIdentity = useCreateContactIdentity(organization)
  const updateIdentity = useUpdateContactIdentity(organization)
  const verifyIdentity = useVerifyContactIdentity(organization)
  const archiveIdentity = useArchiveContactIdentity(organization)
  const assignRole = useAssignContactRole(organization)
  const endRole = useEndContactRole(organization)

  const [identityDialog, setIdentityDialog] = useState<"create" | Row | null>(null)
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [endingRole, setEndingRole] = useState<Row | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [identityFormError, setIdentityFormError] = useState<string | null>(null)
  const [roleFormError, setRoleFormError] = useState<string | null>(null)
  const [endRoleFormError, setEndRoleFormError] = useState<string | null>(null)

  const identities = useMemo(
    () =>
      identityRows
        .map((row) => row as Row)
        .filter((row) => asId(row.contactId ?? row.contact_id) === contactId && !isArchived(row)),
    [contactId, identityRows],
  )
  const roles = useMemo(
    () =>
      roleRows
        .map((row) => row as Row)
        .filter((row) => asId(row.contactId ?? row.contact_id) === contactId),
    [contactId, roleRows],
  )

  const editingIdentity = identityDialog && identityDialog !== "create" ? identityDialog : null
  const identityConfig = useMemo(
    () =>
      contactIdentityForm(t, {
        mode: editingIdentity ? "edit" : "create",
        kind: editingIdentity ? identityKind(editingIdentity) : "Primary",
        verificationState: editingIdentity ? verificationState(editingIdentity) : "Unverified",
        isPreferred: editingIdentity
          ? Boolean(editingIdentity.isPreferred ?? editingIdentity.is_preferred)
          : true,
      }),
    [editingIdentity, t],
  )

  const saveIdentity = async (formData: Record<string, unknown>) => {
    const rawValue = stringValue(formData.rawValue)
    const state = stringValue(formData.verificationState) || "Unverified"
    try {
      setIdentityFormError(null)
      if (identityDialog === "create") {
        await createIdentity.mutateAsync({
          contactId,
          companyId: companyId && companyId > 0n ? companyId : undefined,
          kind: enumValue<ContactIdentityKind>(stringValue(formData.kind) || "Primary"),
          rawValue,
          isPreferred: booleanValue(formData.isPreferred),
          verificationState: enumValue<ContactVerificationState>(state),
          metadata: undefined,
        })
      } else if (editingIdentity) {
        const identityId = rowId(editingIdentity)
        if (identityId == null) throw new Error("The selected identity has no ID")
        await updateIdentity.mutateAsync({
          identityId,
          params: {
            companyId: companyId && companyId > 0n ? companyId : undefined,
            rawValue: rawValue || undefined,
            isPreferred: booleanValue(formData.isPreferred),
            verificationState: enumValue<ContactVerificationState>(state),
            metadata: undefined,
          },
        })
      }
      setIdentityDialog(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to save the phone identity"
      setIdentityFormError(message)
      throw cause
    }
  }

  const saveRole = async (formData: Record<string, unknown>) => {
    try {
      setRoleFormError(null)
      await assignRole.mutateAsync({
        contactId,
        companyId: companyId && companyId > 0n ? companyId : undefined,
        role: stringValue(formData.role),
        activeFrom: undefined,
        activeUntil: undefined,
        metadata: undefined,
      })
      setRoleDialogOpen(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to assign the role"
      setRoleFormError(message)
      throw cause
    }
  }

  const archive = async (row: Row) => {
    const id = rowId(row)
    if (id == null || !window.confirm("Archive this phone identity? It will remain in the audit history.")) return
    try {
      setActionError(null)
      await archiveIdentity.mutateAsync(id)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to archive the phone identity")
    }
  }

  const verify = async (row: Row) => {
    const id = rowId(row)
    if (id == null) return
    try {
      setActionError(null)
      await verifyIdentity.mutateAsync({
        identityId: id,
        state: enumValue<ContactVerificationState>("Verified"),
      })
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Unable to verify the phone identity")
    }
  }

  const finishRole = async (formData: Record<string, unknown>) => {
    const assignmentId = endingRole ? rowId(endingRole) : null
    if (assignmentId == null) return
    try {
      setEndRoleFormError(null)
      await endRole.mutateAsync({
        assignmentId,
        params: { reason: stringValue(formData.reason) || undefined },
      })
      setEndingRole(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to end the role"
      setEndRoleFormError(message)
      throw cause
    }
  }

  const mutationBusy =
    createIdentity.isPending ||
    updateIdentity.isPending ||
    verifyIdentity.isPending ||
    archiveIdentity.isPending ||
    assignRole.isPending ||
    endRole.isPending

  return (
    <div className="flex flex-col gap-4">
      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Phone identities</CardTitle>
          <CardDescription>Masked by default. Keep the preferred contact method current.</CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => { setActionError(null); setIdentityFormError(null); setIdentityDialog("create") }}>
              <PlusIcon data-icon="inline-start" />
              Add phone
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {identities.length > 0 ? identities.map((identity) => {
            const id = rowId(identity)
            const state = verificationState(identity)
            return (
              <div key={String(id)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{displayMasked(identity)}</span>
                    <Badge variant="outline">{IDENTITY_KINDS.find((option) => option.value === identityKind(identity))?.label ?? identityKind(identity)}</Badge>
                    <Badge variant={identityStateVariant(state)}>{VERIFICATION_STATES.find((option) => option.value === state)?.label ?? state}</Badge>
                    {Boolean(identity.isPreferred ?? identity.is_preferred) ? <Badge variant="secondary">Preferred</Badge> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">The full number is never displayed in this workspace.</span>
                </div>
                <div className="flex items-center gap-1">
                  {state !== "Verified" ? (
                    <Button size="sm" variant="outline" disabled={mutationBusy} onClick={() => void verify(identity)}>
                      <BadgeCheckIcon data-icon="inline-start" />
                      Verify
                    </Button>
                  ) : null}
                  <Button size="icon-sm" variant="ghost" aria-label="Edit phone identity" onClick={() => { setActionError(null); setIdentityFormError(null); setIdentityDialog(identity) }}>
                    <PencilIcon />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Archive phone identity" disabled={mutationBusy} onClick={() => void archive(identity)}>
                    <ArchiveIcon />
                  </Button>
                </div>
              </div>
            )
          }) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><PhoneIcon /></EmptyMedia>
                <EmptyTitle>{identitiesLoading ? "Loading phone identities" : "No phone identities"}</EmptyTitle>
                <EmptyDescription>Add a primary number before creating a reminder or mobile-money transaction.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" onClick={() => { setActionError(null); setIdentityFormError(null); setIdentityDialog("create") }}>
                  <PlusIcon data-icon="inline-start" />
                  Add phone
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <CardDescription>Commercial roles are scoped to the active company when one is selected.</CardDescription>
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => { setActionError(null); setRoleFormError(null); setRoleDialogOpen(true) }}>
              <UserRoundPlusIcon data-icon="inline-start" />
              Assign role
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {roles.length > 0 ? roles.map((role) => {
            const active = isActive(role)
            return (
              <div key={String(rowId(role))} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant={active ? "default" : "secondary"}>{String(role.role ?? "Role")}</Badge>
                  <span className="text-xs text-muted-foreground">{active ? "Active" : "Ended"}</span>
                </div>
                {active ? (
                  <Button size="sm" variant="ghost" disabled={mutationBusy} onClick={() => { setActionError(null); setEndRoleFormError(null); setEndingRole(role) }}>
                    <UserRoundXIcon data-icon="inline-start" />
                    End role
                  </Button>
                ) : null}
              </div>
            )
          }) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><ShieldCheckIcon /></EmptyMedia>
                <EmptyTitle>{rolesLoading ? "Loading roles" : "No roles assigned"}</EmptyTitle>
                <EmptyDescription>Assign customer, supplier, member, or another operational role.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <RuntimeFormModal
        key={editingIdentity ? `identity-${rowId(editingIdentity)}` : "identity-new"}
        open={identityDialog != null}
        onOpenChange={(open) => !open && setIdentityDialog(null)}
        staticConfig={identityConfig}
        moduleId="crm"
        organizationId={organizationId}
        isPending={createIdentity.isPending || updateIdentity.isPending}
        closeOnSubmit={false}
        showSubmitSuccessToast
        submitError={identityFormError}
        onSubmit={saveIdentity}
      />
      <RuntimeFormModal
        open={roleDialogOpen}
        onOpenChange={(open) => !open && setRoleDialogOpen(false)}
        staticConfig={assignContactRoleForm(t)}
        moduleId="crm"
        organizationId={organizationId}
        isPending={assignRole.isPending}
        closeOnSubmit={false}
        showSubmitSuccessToast
        submitError={roleFormError}
        onSubmit={saveRole}
      />
      <RuntimeFormModal
        key={endingRole ? `role-${rowId(endingRole)}` : "role-none"}
        open={endingRole != null}
        onOpenChange={(open) => !open && setEndingRole(null)}
        staticConfig={endContactRoleForm(t)}
        moduleId="crm"
        organizationId={organizationId}
        isPending={endRole.isPending}
        closeOnSubmit={false}
        showSubmitSuccessToast
        submitError={endRoleFormError}
        onSubmit={finishRole}
      />
    </div>
  )
}

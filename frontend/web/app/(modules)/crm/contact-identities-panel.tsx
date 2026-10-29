"use client"

import { useMemo, useState } from "react"
import {
  ArchiveIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserRoundPlusIcon,
  UserRoundXIcon,
} from "lucide-react"

import { i18n, useTranslation } from "@lumiere/i18n"
import { useConfirmDialog } from "@lumiere/ui/hooks/use-confirm-dialog"
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
} from "@lumiere/query-hooks/hooks/crm"
import { nullableBigIntU64 as asId, unwrapSome as optionValue } from "@lumiere/erp-shared/form-coercion"
import type { ContactIdentityKind } from "@lumiere/stdb/types"
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
  { value: "Primary", get label() { return i18n.t("crm.forms.contactIdentity.kinds.primary") } },
  { value: "WhatsApp", get label() { return i18n.t("crm.forms.contactIdentity.kinds.whatsApp") } },
  { value: "MobileMoney", get label() { return i18n.t("crm.forms.contactIdentity.kinds.mobileMoney") } },
]

const VERIFICATION_STATES: Array<{ value: VerificationStateName; label: string }> = [
  { value: "Unverified", get label() { return i18n.t("crm.forms.contactIdentity.states.unverified") } },
  { value: "Pending", get label() { return i18n.t("crm.forms.contactIdentity.states.pending") } },
  { value: "Verified", get label() { return i18n.t("crm.forms.contactIdentity.states.verified") } },
  { value: "Failed", get label() { return i18n.t("crm.forms.contactIdentity.states.failed") } },
  { value: "OptedOut", get label() { return i18n.t("crm.forms.contactIdentity.states.optedOut") } },
]

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
  return String(row.displayMasked ?? row.display_masked ?? i18n.t("crm.contactIdentitiesPanel.maskedPhone"))
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
  const { confirm: confirmDialog, dialog: confirmDialogNode } = useConfirmDialog()
  const organization = BigInt(organizationId)
  const { data: identityRows = [], isLoading: identitiesLoading } = useContactPhoneIdentities(organization)
  const { data: roleRows = [], isLoading: rolesLoading } = useContactRoleAssignments(organization)
  const createIdentity = useCreateContactIdentity(organization)
  const updateIdentity = useUpdateContactIdentity(organization)
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
        isPreferred: editingIdentity
          ? Boolean(editingIdentity.isPreferred ?? editingIdentity.is_preferred)
          : true,
      }),
    [editingIdentity, t],
  )

  const saveIdentity = async (formData: Record<string, unknown>) => {
    const rawValue = stringValue(formData.rawValue)
    try {
      setIdentityFormError(null)
      if (identityDialog === "create") {
        await createIdentity.mutateAsync({
          contactId,
          companyId: companyId && companyId > 0n ? companyId : undefined,
          kind: enumValue<ContactIdentityKind>(stringValue(formData.kind) || "Primary"),
          rawValue,
          isPreferred: booleanValue(formData.isPreferred),
          verificationState: undefined,
          metadata: undefined,
        })
      } else if (editingIdentity) {
        const identityId = rowId(editingIdentity)
        if (identityId == null) throw new Error(t("crm.contactIdentitiesPanel.theSelectedIdentityHasNoID"))
        await updateIdentity.mutateAsync({
          identityId,
          params: {
            companyId: companyId && companyId > 0n ? companyId : undefined,
            rawValue: rawValue || undefined,
            isPreferred: booleanValue(formData.isPreferred),
            verificationState: undefined,
            metadata: undefined,
          },
        })
      }
      setIdentityDialog(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("crm.contactIdentitiesPanel.unableToSaveThePhoneIdentity")
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
      const message = cause instanceof Error ? cause.message : t("crm.contactIdentitiesPanel.unableToAssignTheRole")
      setRoleFormError(message)
      throw cause
    }
  }

  const archive = async (row: Row) => {
    const id = rowId(row)
    if (id == null) return
    if (!(await confirmDialog({ description: t("crm.contactIdentitiesPanel.archiveThisPhoneIdentityItWillRemainInTheAuditHistory") }))) return
    try {
      setActionError(null)
      await archiveIdentity.mutateAsync(id)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("crm.contactIdentitiesPanel.unableToArchiveThePhoneIdentity"))
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
      const message = cause instanceof Error ? cause.message : t("crm.contactIdentitiesPanel.unableToEndTheRole")
      setEndRoleFormError(message)
      throw cause
    }
  }

  const mutationBusy =
    createIdentity.isPending ||
    updateIdentity.isPending ||
    archiveIdentity.isPending ||
    assignRole.isPending ||
    endRole.isPending

  return (
    <div className="flex flex-col gap-4">
      {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("crm.contactIdentitiesPanel.phoneIdentities")}</CardTitle>
          <CardDescription>{t("crm.contactIdentitiesPanel.maskedByDefaultKeepThePreferredContactMethodCurrent")}</CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => { setActionError(null); setIdentityFormError(null); setIdentityDialog("create") }}>
              <PlusIcon data-icon="inline-start" />
              {t("crm.forms.contactIdentity.add")}{" "}</Button>
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
                    {Boolean(identity.isPreferred ?? identity.is_preferred) ? <Badge variant="secondary">{t("crm.contactIdentitiesPanel.preferred")}</Badge> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{t("crm.contactIdentitiesPanel.theFullNumberIsNeverDisplayedInThisWorkspace")}</span>
                  {state !== "Verified" ? (
                    <span className="text-xs text-muted-foreground">{t("crm.contactIdentitiesPanel.verificationCompletesOnlyAfterTrustedOTPProviderProof")}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon-sm" variant="ghost" aria-label={t("crm.forms.contactIdentity.editTitle")} onClick={() => { setActionError(null); setIdentityFormError(null); setIdentityDialog(identity) }}>
                    <PencilIcon />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t("crm.contactIdentitiesPanel.archivePhoneIdentity")} disabled={mutationBusy} onClick={() => void archive(identity)}>
                    <ArchiveIcon />
                  </Button>
                </div>
              </div>
            )
          }) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><PhoneIcon /></EmptyMedia>
                <EmptyTitle>{identitiesLoading ? t("crm.contactIdentitiesPanel.loadingPhoneIdentities") : t("crm.contactIdentitiesPanel.noPhoneIdentities")}</EmptyTitle>
                <EmptyDescription>{t("crm.contactIdentitiesPanel.addAPrimaryNumberBeforeCreatingAReminderOrMobileMoney")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" onClick={() => { setActionError(null); setIdentityFormError(null); setIdentityDialog("create") }}>
                  <PlusIcon data-icon="inline-start" />
                  {t("crm.forms.contactIdentity.add")}{" "}</Button>
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.users.roles")}</CardTitle>
          <CardDescription>{t("crm.contactIdentitiesPanel.commercialRolesAreScopedToTheActiveCompanyWhenOneIs")}</CardDescription>
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => { setActionError(null); setRoleFormError(null); setRoleDialogOpen(true) }}>
              <UserRoundPlusIcon data-icon="inline-start" />
              {t("crm.forms.assignContactRole.submit")}{" "}</Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {roles.length > 0 ? roles.map((role) => {
            const active = isActive(role)
            return (
              <div key={String(rowId(role))} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant={active ? "default" : "secondary"}>{String(role.role ?? t("crm.forms.assignContactRole.sections.role"))}</Badge>
                  <span className="text-xs text-muted-foreground">{active ? t("common.active") : t("crm.contactIdentitiesPanel.ended")}</span>
                </div>
                {active ? (
                  <Button size="sm" variant="ghost" disabled={mutationBusy} onClick={() => { setActionError(null); setEndRoleFormError(null); setEndingRole(role) }}>
                    <UserRoundXIcon data-icon="inline-start" />
                    {t("crm.forms.endContactRole.submit")}{" "}</Button>
                ) : null}
              </div>
            )
          }) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><ShieldCheckIcon /></EmptyMedia>
                <EmptyTitle>{rolesLoading ? t("crm.contactIdentitiesPanel.loadingRoles") : t("crm.contactIdentitiesPanel.noRolesAssigned")}</EmptyTitle>
                <EmptyDescription>{t("crm.contactIdentitiesPanel.assignCustomerSupplierMemberOrAnotherOperationalRole")}</EmptyDescription>
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
      {confirmDialogNode}
    </div>
  )
}

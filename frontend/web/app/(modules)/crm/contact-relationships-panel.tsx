"use client"

import { useMemo, useState } from "react"
import { LinkIcon, PlusIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import {
  useContactRelationships,
  useContacts,
  useCreateContactRelationship,
  useEndContactRelationship,
  useUpdateContactParent,
} from "@lumiere/query-hooks/hooks/crm"
import { contactPrimaryLabel } from "@lumiere/stdb/read-models"
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
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { nullableBigIntU64 as asId, unwrapSome as optionValue } from "@lumiere/erp-shared/form-coercion"

type Row = Record<string, unknown>

function isActive(row: Row): boolean {
  return row.isActive !== false && row.is_active !== false
}

export interface ContactRelationshipsPanelProps {
  organizationId: number
  contactId: bigint
  companyId?: bigint
}

export function ContactRelationshipsPanel({
  organizationId,
  contactId,
  companyId,
}: ContactRelationshipsPanelProps) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: relationshipRows = [], isLoading } = useContactRelationships(organization)
  const { data: contactRows = [] } = useContacts(organization)
  const createRelationship = useCreateContactRelationship(organization)
  const endRelationship = useEndContactRelationship(organization)
  const updateParent = useUpdateContactParent(organization)

  const [formOpen, setFormOpen] = useState(false)
  const [otherContactId, setOtherContactId] = useState("")
  const [relationshipType, setRelationshipType] = useState("related")
  const [parentId, setParentId] = useState<string>("none")
  const [error, setError] = useState<string | null>(null)

  const contacts = contactRows as Row[]
  const contactLabel = (id: bigint | null) => {
    if (id == null) return "—"
    const row = contacts.find((c) => asId(c.id) === id)
    return row ? contactPrimaryLabel(row) : id.toString()
  }

  const relationships = useMemo(
    () =>
      (relationshipRows as Row[]).filter((row) => {
        if (!isActive(row)) return false
        const left = asId(row.leftContactId ?? row.left_contact_id)
        const right = asId(row.rightContactId ?? row.right_contact_id)
        return left === contactId || right === contactId
      }),
    [relationshipRows, contactId],
  )

  const current = contacts.find((c) => asId(c.id) === contactId)
  const currentParent = asId(current?.parentId ?? current?.parent_id)

  async function onCreate() {
    setError(null)
    const other = asId(otherContactId)
    if (other == null) {
      setError(t("crm.relationships.pickContact", "Pick another contact"))
      return
    }
    try {
      await createRelationship.mutateAsync({
        leftContactId: contactId,
        rightContactId: other,
        relationshipType: relationshipType.trim() || "related",
        startDate: undefined,
        notes: undefined,
        metadata: undefined,
      })
      setFormOpen(false)
      setOtherContactId("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onSaveParent() {
    setError(null)
    if (companyId == null || companyId === 0n) {
      setError(t("crm.relationships.needCompany", "Company scope required to set parent"))
      return
    }
    try {
      await updateParent.mutateAsync({
        companyId,
        contactId,
        parentId: parentId === "none" ? null : BigInt(parentId),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const otherOptions = contacts.filter((c) => {
    const id = asId(c.id)
    return id != null && id !== contactId && optionValue(c.deletedAt ?? c.deleted_at) == null
  })

  return (
    <div className="space-y-4" data-testid="contact-relationships-panel">
      <Card>
        <CardHeader>
          <CardTitle>{t("crm.relationships.hierarchyTitle", "Account hierarchy")}</CardTitle>
          <CardDescription>
            {t("crm.relationships.hierarchyDescription", "Optional parent contact for multi-entity accounts.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("crm.relationships.currentParent", "Current parent")}: {contactLabel(currentParent)}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-56 flex-1 gap-1.5">
              <Label>{t("crm.relationships.parent", "Parent contact")}</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger data-testid="contact-parent-select">
                  <SelectValue placeholder={t("crm.relationships.noParent", "None")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("crm.relationships.noParent", "None")}</SelectItem>
                  {otherOptions.map((c) => {
                    const id = asId(c.id)
                    if (id == null) return null
                    return (
                      <SelectItem key={id.toString()} value={id.toString()}>
                        {contactPrimaryLabel(c)}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={updateParent.isPending}
              onClick={() => void onSaveParent()}
              data-testid="contact-parent-save"
            >
              {t("crm.relationships.saveParent", "Save parent")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("crm.relationships.title", "Relationships")}</CardTitle>
          <CardDescription>
            {t("crm.relationships.description", "Explicit links between contacts (partner, subsidiary, spouse, …).")}
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setFormOpen((v) => !v)}
              data-testid="contact-relationship-add"
            >
              <PlusIcon className="size-4" />
              {t("crm.relationships.add", "Add")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {formOpen ? (
            <div className="grid gap-3 rounded-md border p-3" data-testid="contact-relationship-form">
              <div className="grid gap-1.5">
                <Label>{t("crm.relationships.otherContact", "Other contact")}</Label>
                <Select value={otherContactId} onValueChange={setOtherContactId}>
                  <SelectTrigger data-testid="contact-relationship-other">
                    <SelectValue placeholder={t("crm.relationships.pickContact", "Pick another contact")} />
                  </SelectTrigger>
                  <SelectContent>
                    {otherOptions.map((c) => {
                      const id = asId(c.id)
                      if (id == null) return null
                      return (
                        <SelectItem key={id.toString()} value={id.toString()}>
                          {contactPrimaryLabel(c)}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="relationship-type">{t("crm.relationships.type", "Type")}</Label>
                <Input
                  id="relationship-type"
                  value={relationshipType}
                  onChange={(e) => setRelationshipType(e.target.value)}
                  data-testid="contact-relationship-type"
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button
                type="button"
                size="sm"
                disabled={createRelationship.isPending}
                onClick={() => void onCreate()}
                data-testid="contact-relationship-submit"
              >
                {t("crm.relationships.save", "Save")}
              </Button>
            </div>
          ) : null}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("crm.relationships.loading", "Loading…")}</p>
          ) : relationships.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LinkIcon />
                </EmptyMedia>
                <EmptyTitle>{t("crm.relationships.emptyTitle", "No relationships")}</EmptyTitle>
                <EmptyDescription>
                  {t("crm.relationships.emptyDescription", "Link related contacts for hierarchy and partner channels.")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="contact-relationship-list">
              {relationships.map((row) => {
                const id = asId(row.id)
                const left = asId(row.leftContactId ?? row.left_contact_id)
                const right = asId(row.rightContactId ?? row.right_contact_id)
                const other = left === contactId ? right : left
                return (
                  <li key={String(id)} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{contactLabel(other)}</div>
                      <div className="text-muted-foreground">
                        {String(row.relationshipType ?? row.relationship_type ?? "related")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{t("crm.relationships.active", "Active")}</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={id == null || endRelationship.isPending}
                        onClick={() => {
                          if (id == null) return
                          void endRelationship.mutateAsync(id)
                        }}
                        data-testid={`contact-relationship-end-${id}`}
                      >
                        {t("crm.relationships.end", "End")}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

import { useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Button } from "@lumiere/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lumiere/ui/components/dialog"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { NavigationEditorContext } from "@lumiere/ui/forms/navigation-guard-context"
import type { FarmPrefill } from "./farm-assistant-prefill"
import {
  FarmApiError,
  farmApiPath,
  farmEventLabels,
  farmRequest,
  farmWrite,
  selectedFarmEventKind,
  type FarmBatch,
  type FarmBatchInput,
  type FarmEvent,
  type FarmEventInput,
  type FarmEventKind,
} from "./farm-batch-model"

export function FarmField({
  label,
  name,
  required = true,
  ...props
}: {
  label: string
  name: string
  required?: boolean
  type?: "date" | "number" | "text"
  defaultValue?: string | number
  min?: number | string
  max?: number | string
  step?: number | "any"
  maxLength?: number
  inputMode?: "numeric"
}) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} required={required} {...props} />
    </div>
  )
}

export function FarmSelect({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string
  name: string
  value: string
  options: ReadonlyArray<readonly [string, string]>
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select name={name} required value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([key, option]) => (
            <SelectItem key={key} value={key}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function fieldValue(data: FormData, key: string) {
  const value = data.get(key)
  return typeof value === "string" ? value.trim() : ""
}

function numberValue(data: FormData, key: string) {
  const value = fieldValue(data, key)
  return value ? Number(value) : undefined
}

export function FarmForm<T>({
  title,
  description,
  submitLabel,
  children,
  onSave,
  onSaved,
  onSaveFailed,
  onClose,
}: {
  title: string
  description?: string
  submitLabel: string
  children: ReactNode
  onSave: (data: FormData, requestKey: string) => Promise<T>
  onSaved: (result: T) => void
  onSaveFailed?: () => void
  onClose: () => void
}) {
  const editor = useContext(NavigationEditorContext)
  const state = useRef({ dirty: false, pending: false })
  const request = useRef<{ signature: string; save: () => Promise<T> } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  useEffect(() => editor?.register(() => state.current), [editor])

  function change() {
    state.current.dirty = true
    editor?.changed()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.current.pending) return
    const data = new FormData(event.currentTarget)
    const signature = JSON.stringify([...data])
    if (request.current?.signature !== signature) {
      const key = crypto.randomUUID()
      request.current = { signature, save: () => onSave(data, key) }
    }
    state.current.pending = true
    setPending(true)
    setError(null)
    editor?.changed()
    try {
      const result = await request.current.save()
      state.current = { dirty: false, pending: false }
      editor?.changed()
      onSaved(result)
    } catch (caught) {
      const unknown = !(caught instanceof FarmApiError) || caught.status >= 500
      setUncertain(unknown)
      if (!unknown) request.current = null
      const message = caught instanceof Error ? caught.message : "The operation could not complete."
      setError(unknown ? `${message} Retry to check the same operation.` : message)
      onSaveFailed?.()
    } finally {
      state.current.pending = false
      setPending(false)
      editor?.changed()
    }
  }

  function close() {
    if (state.current.pending) return
    const cancel = () => {
      state.current = { dirty: false, pending: false }
      editor?.changed()
      onClose()
    }
    if (editor) editor.proceed(cancel)
    else cancel()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent layout="bounded" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form className="flex min-h-0 min-w-0 flex-col gap-4" onChange={change} onSubmit={submit}>
          <DialogBody className="p-1">
            <fieldset disabled={pending} className="min-w-0 space-y-4">
              {/* A lost response keeps the original inputs enabled for submission and inert for edits. */}
              <div inert={uncertain} className="space-y-4">
                {children}
              </div>
            </fieldset>
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : uncertain ? "Check by retrying" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CreateFarmBatchForm({
  companyId,
  onSaved,
  onClose,
}: {
  companyId: string
  onSaved: (result: FarmBatch) => void
  onClose: () => void
}) {
  return (
    <FarmForm<FarmBatch>
      title="New farm batch"
      description="Add the batch first, then record its intake."
      submitLabel="Create batch"
      onClose={onClose}
      onSaved={onSaved}
      onSave={(data, requestKey) => {
        const input: FarmBatchInput = {
          reference: fieldValue(data, "reference"),
          species: fieldValue(data, "species"),
          startDate: fieldValue(data, "startDate"),
          location: fieldValue(data, "location"),
        }
        return farmRequest(
          farmApiPath(companyId),
          farmWrite("POST", { companyId, requestKey, ...input }),
        )
      }}
    >
      <FarmField label="Batch reference" name="reference" maxLength={120} />
      <FarmField label="Species" name="species" defaultValue="poultry" maxLength={80} />
      <FarmField label="Start date" name="startDate" type="date" />
      <FarmField label="Farm or house" name="location" maxLength={160} />
    </FarmForm>
  )
}

function eventInput(data: FormData, kind: FarmEventKind): FarmEventInput {
  const businessDate = fieldValue(data, "businessDate")
  switch (kind) {
    case "weighIn":
      return {
        kind,
        businessDate,
        sampleCount: Number(fieldValue(data, "sampleCount")),
        totalWeightKg: Number(fieldValue(data, "totalWeightKg")),
      }
    case "feedUsage":
      return {
        kind,
        businessDate,
        feedProduct: fieldValue(data, "feedProduct"),
        quantityKg: Number(fieldValue(data, "quantityKg")),
      }
    case "feedCoverage":
      return { kind, businessDate, fromExclusive: fieldValue(data, "fromExclusive") }
    case "processing":
      return {
        kind,
        businessDate,
        count: Number(fieldValue(data, "count")),
        liveWeightKg: numberValue(data, "liveWeightKg"),
        sellableWeightKg: numberValue(data, "sellableWeightKg"),
      }
    default:
      return { kind, businessDate, count: Number(fieldValue(data, "count")) }
  }
}

export function FarmEventForm({
  companyId,
  batch,
  initialKind,
  existing,
  prefill,
  onClose,
  onSaved,
}: {
  companyId: string
  batch: FarmBatch
  initialKind: FarmEventKind
  existing?: FarmEvent
  prefill?: FarmPrefill
  onClose: () => void
  onSaved: (event: FarmEvent) => void
}) {
  const [kind, setKind] = useState(existing?.kind ?? initialKind)
  const expectedRevision = useRef(batch.revision).current
  const selected = existing?.kind === kind ? existing : undefined
  const suggested = kind === initialKind && !existing ? prefill : undefined
  return (
    <FarmForm<FarmEvent>
      title={existing ? "Correct farm event" : "Record farm event"}
      description={
        kind === "processing"
          ? "Enter the measured run. Link its completed Warehouse and Manufacturing records on the Processing tab."
          : undefined
      }
      submitLabel={existing ? "Save correction" : "Save event"}
      onClose={onClose}
      onSaved={onSaved}
      onSave={(data, requestKey) =>
        farmRequest(
          farmApiPath(companyId, `/${batch.id}/events${existing ? `/${existing.id}` : ""}`),
          farmWrite(existing ? "PATCH" : "POST", {
            companyId,
            requestKey,
            expectedRevision,
            event: eventInput(data, kind),
            ...(existing ? { reason: fieldValue(data, "reason") } : {}),
          }),
        )
      }
    >
      {existing ? (
        <p className="text-sm font-medium">{farmEventLabels[kind]}</p>
      ) : (
        <FarmSelect
          label="Event"
          name="kind"
          value={kind}
          options={Object.entries(farmEventLabels)}
          onChange={(value) => setKind(selectedFarmEventKind(value))}
        />
      )}
      <FarmField
        label={kind === "feedCoverage" ? "Complete through" : "Business date"}
        name="businessDate"
        type="date"
        min={batch.startDate}
        defaultValue={existing?.businessDate ?? prefill?.businessDate}
      />
      {kind === "weighIn" && (
        <>
          <FarmField
            label="Animals weighed"
            name="sampleCount"
            type="number"
            min={1}
            step={1}
            defaultValue={selected?.kind === kind ? selected.sampleCount : suggested?.sampleCount}
          />
          <FarmField
            label="Total sampled weight (kg)"
            name="totalWeightKg"
            type="number"
            min={0.0001}
            step="any"
            defaultValue={selected?.kind === kind ? selected.totalWeightKg : suggested?.totalWeightKg}
          />
        </>
      )}
      {kind === "feedUsage" && (
        <>
          <FarmField
            label="Feed product"
            name="feedProduct"
            maxLength={120}
            defaultValue={selected?.kind === kind ? selected.feedProduct : suggested?.feedProduct}
          />
          <FarmField
            label="Feed consumed (kg)"
            name="quantityKg"
            type="number"
            min={0.0001}
            step="any"
            defaultValue={selected?.kind === kind ? selected.quantityKg : suggested?.quantityKg}
          />
        </>
      )}
      {kind === "feedCoverage" && (
        <FarmField
          label="Complete after (exclusive)"
          name="fromExclusive"
          type="date"
          defaultValue={selected?.kind === kind ? selected.fromExclusive : undefined}
        />
      )}
      {kind !== "weighIn" && kind !== "feedUsage" && kind !== "feedCoverage" && (
        <FarmField
          label="Animal count"
          name="count"
          type="number"
          min={1}
          step={1}
          defaultValue={selected && "count" in selected ? selected.count : suggested?.count}
        />
      )}
      {kind === "processing" && (
        <>
          <FarmField
            label="Live input weight (kg)"
            name="liveWeightKg"
            required={false}
            type="number"
            min={0.0001}
            step="any"
            defaultValue={selected?.kind === kind ? selected.liveWeightKg : suggested?.liveWeightKg}
          />
          <FarmField
            label="Sellable output weight (kg)"
            name="sellableWeightKg"
            required={false}
            type="number"
            min={0}
            step="any"
            defaultValue={
              selected?.kind === kind ? selected.sellableWeightKg : suggested?.sellableWeightKg
            }
          />
        </>
      )}
      {existing && <FarmField label="Reason for correction" name="reason" maxLength={360} />}
    </FarmForm>
  )
}

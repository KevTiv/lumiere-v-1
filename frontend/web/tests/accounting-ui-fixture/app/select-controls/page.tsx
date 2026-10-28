"use client"

import { useState } from "react"
import { I18nProvider } from "@lumiere/i18n"
import { Button } from "@lumiere/ui/components/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@lumiere/ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@lumiere/ui/components/select"
import { MultiRecordPicker } from "@lumiere/ui/components/multi-record-picker"
import { RecordPicker } from "@lumiere/ui/components/record-picker"

const options = Array.from({ length: 15 }, (_, index) => ({
  value: String(index + 1).padStart(2, "0"),
  label: `Account ${String(index + 1).padStart(2, "0")}`,
  disabled: index === 13,
}))

export default function SelectControlsFixture() {
  const [open, setOpen] = useState(false)
  const [single, setSingle] = useState("02")
  const [multiple, setMultiple] = useState(["02", "14", "missing"])
  const [partner, setPartner] = useState("")
  return (
    <I18nProvider language="en">
      <main className="mx-auto max-w-xl space-y-6 p-4">
        <p>Synthetic select fixture. No backend operations.</p>
        <Button onClick={() => setOpen(true)}>Open select dialog</Button>
        <output data-testid="single-value">{single}</output>
        <output data-testid="multiple-value">{multiple.join(",")}</output>
        <output data-testid="record-value">{partner}</output>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Account selectors</DialogTitle>
            </DialogHeader>
            <RecordPicker data-testid="form-field-partnerId" value={partner} onChange={setPartner}
              options={[{ value: "customer-a", label: "Customer" }, { value: "customer-b", label: "Customer" }]}
              placeholder="Choose customer" />
            <Select value={single} onValueChange={setSingle}>
              <SelectTrigger aria-label="Fourteen accounts">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.slice(0, 14).map((option) => (
                  <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={single} onValueChange={setSingle}>
              <SelectTrigger data-testid="long-select" aria-label="Fifteen accounts">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Accounts</SelectLabel>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <MultiRecordPicker
              id="accounts"
              data-testid="multiple-accounts"
              value={multiple}
              onChange={setMultiple}
              options={options}
              placeholder="Add accounts"
              unavailableLabel={(value) => `Unavailable: ${value}`}
            />
          </DialogContent>
        </Dialog>
      </main>
    </I18nProvider>
  )
}

"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

interface CustomSectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (title: string) => void
}

/** In-app replacement for the former `window.prompt("Section title:")`. */
export function CustomSectionDialog({ open, onOpenChange, onSubmit }: CustomSectionDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTitle("")
  }, [open])

  const trimmed = title.trim()

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!trimmed) return
    onSubmit(trimmed)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="confirmation" layout="bounded" initialFocus={inputRef} data-testid="custom-section-dialog">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-auto flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("proposalWorkspace.sectionSidebar.customSectionTitle", { defaultValue: "Section title" })}</DialogTitle>
            <DialogDescription>
              {t("proposalWorkspace.sectionSidebar.customSectionDescription", { defaultValue: "Name the new proposal section." })}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("proposalWorkspace.sectionSidebar.customSectionPlaceholder", { defaultValue: "Section title" })}
              aria-label={t("proposalWorkspace.sectionSidebar.customSectionTitle", { defaultValue: "Section title" })}
              data-testid="custom-section-title-input"
            />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" disabled={!trimmed} data-testid="custom-section-submit">
              {t("proposalWorkspace.sectionSidebar.customSectionAdd", { defaultValue: "Add section" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

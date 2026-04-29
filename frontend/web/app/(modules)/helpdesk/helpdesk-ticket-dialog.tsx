"use client"

import { useTranslation } from "@lumiere/i18n"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ModularForm,
} from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { LifeBuoy } from "lucide-react"

interface HelpdeskTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  formConfig: FormConfig
  stateTag: string
  onSave: (data: Record<string, unknown>) => void | Promise<void>
  onCloseTicket: () => void | Promise<void>
  onReopenTicket: () => void | Promise<void>
  isBusy?: boolean
}

export function HelpdeskTicketDialog({
  open,
  onOpenChange,
  formConfig,
  stateTag,
  onSave,
  onCloseTicket,
  onReopenTicket,
  isBusy,
}: HelpdeskTicketDialogProps) {
  const { t } = useTranslation()
  const canClose = stateTag !== "Closed" && stateTag !== "Cancelled"
  const canReopen = stateTag === "Closed" || stateTag === "Cancelled"

  const HeaderIcon = LifeBuoy

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[85vh] flex flex-col bg-card p-0 gap-0">
        <DialogHeader className="sticky top-0 bg-card z-10 px-6 pt-6 pb-4 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 flex-shrink-0">
              <HeaderIcon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold leading-tight">
                {formConfig.title}
              </DialogTitle>
              {formConfig.description ? (
                <DialogDescription className="text-xs mt-0.5">
                  {formConfig.description}
                </DialogDescription>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <ModularForm
            key={formConfig.id}
            config={{
              ...formConfig,
              title: "",
              description: "",
            }}
            onSubmit={onSave}
            onCancel={() => onOpenChange(false)}
          />
        </div>

        {(canClose || canReopen) && (
          <div className="flex flex-wrap items-center gap-2 px-6 pb-6 pt-0 border-t border-border/50">
            {canClose && (
              <Button
                type="button"
                variant="secondary"
                disabled={isBusy}
                onClick={() => void onCloseTicket()}
              >
                {t("helpdesk.forms.ticketDetail.closeTicket")}
              </Button>
            )}
            {canReopen && (
              <Button
                type="button"
                variant="secondary"
                disabled={isBusy}
                onClick={() => void onReopenTicket()}
              >
                {t("helpdesk.forms.ticketDetail.reopenTicket")}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

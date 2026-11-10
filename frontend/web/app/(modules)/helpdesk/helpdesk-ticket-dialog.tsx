"use client"

import { useTranslation } from "@lumiere/i18n"
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ModularForm,
} from "@lumiere/ui"
import type { FormConfig } from "@lumiere/ui"
import { LifeBuoy } from "lucide-react"
import { phCapture } from "@/lib/posthog-browser"

interface HelpdeskTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  formConfig: FormConfig
  stateTag: string
  onSave: (data: Record<string, unknown>) => void | Promise<void>
  onCloseTicket: () => void | Promise<void>
  onReopenTicket: () => void | Promise<void>
  isBusy?: boolean
  /** Notes and followers for the ticket, shown under the form. */
  discussion?: React.ReactNode
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
  discussion,
}: HelpdeskTicketDialogProps) {
  const { t } = useTranslation()
  const canClose = stateTag !== "Closed" && stateTag !== "Cancelled"
  const canReopen = stateTag === "Closed" || stateTag === "Cancelled"

  const HeaderIcon = LifeBuoy

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="record" layout="bounded" className="bg-card">
        <DialogHeader className="border-b border-border/50 pb-4">
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

        <DialogBody>
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
          {discussion ? (
            <section className="mt-6 border-t border-border/50 pt-5" data-testid="helpdesk-ticket-discussion">
              <h3 className="mb-3 text-sm font-medium">{t("helpdesk.discussion", { defaultValue: "Discussion" })}</h3>
              {discussion}
            </section>
          ) : null}
        </DialogBody>

        {(canClose || canReopen) && (
          <DialogFooter className="sm:justify-start">
            {canClose && (
              <Button
                type="button"
                variant="secondary"
                disabled={isBusy}
                onClick={() => {
                  phCapture('helpdesk_ticket_closed')
                  void onCloseTicket()
                }}
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
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

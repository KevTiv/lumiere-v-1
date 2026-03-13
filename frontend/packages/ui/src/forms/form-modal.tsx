
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/dialog"
import type { FormConfig } from "../lib/form-types"
import { ModularForm } from "./modular-form"

interface FormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: FormConfig
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
}

export function FormModal({
  open,
  onOpenChange,
  config,
  onSubmit,
}: FormModalProps) {
  const handleSubmit = async (data: Record<string, unknown>) => {
    if (onSubmit) {
      await onSubmit(data)
    }
    onOpenChange(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto bg-card">
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          {config.description && (
            <DialogDescription>{config.description}</DialogDescription>
          )}
        </DialogHeader>
        <ModularForm
          config={{ ...config, title: "", description: "" }}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  )
}

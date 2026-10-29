"use client"
import { i18n, useTranslation } from "@lumiere/i18n"
import { cn } from "@lumiere/ui/lib/utils"
import { Loader2Icon } from "lucide-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  useTranslation()
  return (
    <Loader2Icon role="status" aria-label={i18n.t("ui.components.spinner.loading")} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }

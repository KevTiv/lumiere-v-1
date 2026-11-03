"use client"

import type { ComponentProps, ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/collapsible"
import { cn } from "../lib/utils"

/** Presentation only: lists retain their own filtering, selection and persistence. */
export function ListToolbar({ className, ...props }: Omit<ComponentProps<typeof Collapsible>, "className"> & { className?: string }) {
  return <Collapsible className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-xs [&_button]:min-h-11 [&_input]:min-h-11", className)} {...props} />
}

export function ListToolbarFields({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid min-w-0 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]", className)} {...props} />
}

export function ListToolbarField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <label className={cn("flex min-w-0 flex-col gap-1 text-xs font-medium [&>button]:w-full [&>input]:w-full", className)}>
    <span className="[overflow-wrap:anywhere]">{label}</span>
    {children}
  </label>
}

export function ListToolbarActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2", className)} {...props} />
}

export function ListToolbarSettingsTrigger() {
  const { t } = useTranslation()
  return <CollapsibleTrigger render={<Button variant="outline" className="min-h-11 max-w-full whitespace-normal" />}>
    {t("common.listToolbar.viewSettings", { defaultValue: "View settings" })}
    <ChevronDown data-icon="inline-end" aria-hidden />
  </CollapsibleTrigger>
}

export function ListToolbarSettings({ className, ...props }: Omit<ComponentProps<typeof CollapsibleContent>, "className"> & { className?: string }) {
  const { t } = useTranslation()
  return <CollapsibleContent
    keepMounted
    role="region"
    aria-label={t("common.listToolbar.viewSettings", { defaultValue: "View settings" })}
    className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-3", className)}
    {...props}
  />
}

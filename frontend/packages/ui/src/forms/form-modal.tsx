"use client"


import React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/dialog"
import { cn } from "../lib/utils"
import type { FormConfig } from "../lib/form-types"
import { ModularForm } from "./modular-form"
import * as Icons from "lucide-react"

const sizeClasses: Record<string, string> = {
  md: "sm:max-w-[600px]",
  lg: "sm:max-w-[760px]",
  xl: "sm:max-w-[920px]",
}

interface FormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: FormConfig
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>
  className?: string
}

export function FormModal({
  open,
  onOpenChange,
  config,
  onSubmit,
  className,
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

  const size = config.size ?? "md"
  const maxW = sizeClasses[size] ?? sizeClasses.md

  // Resolve optional header icon
  const HeaderIcon = config.icon
    ? (Icons as Record<string, unknown>)[config.icon] as React.ComponentType<{ className?: string }> | undefined
    : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          maxW,
          "max-h-[85vh] flex flex-col bg-card p-0 gap-0",
          className
        )}
      >
        {/* Sticky header */}
        <DialogHeader className="sticky top-0 bg-card z-10 px-6 pt-6 pb-4 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            {HeaderIcon && (
              <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 flex-shrink-0",
                config.iconColor
              )}>
                <HeaderIcon className={cn("h-4 w-4", config.iconColor ?? "text-primary")} />
              </div>
            )}
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold leading-tight">
                {config.title}
              </DialogTitle>
              {config.description && (
                <DialogDescription className="text-xs mt-0.5">
                  {config.description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <ModularForm
            config={{ ...config, title: "", description: "" }}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

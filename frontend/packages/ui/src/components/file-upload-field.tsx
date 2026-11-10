"use client"

import { useId, useRef, type ComponentProps } from "react"
import { FileIcon, XIcon } from "lucide-react"

import { cn } from "../lib/utils"
import { Button } from "./button"
import { FileIdentity } from "./file-identity"

export interface FileUploadFieldProps extends Pick<
  ComponentProps<"input">,
  | "id"
  | "name"
  | "accept"
  | "multiple"
  | "disabled"
  | "required"
  | "onBlur"
  | "aria-invalid"
  | "aria-describedby"
  | "aria-label"
> {
  "data-testid"?: string
  className?: string
  /** Selection is owned by the caller. Omit for an immediate upload with separate receipts. */
  files?: readonly { id: string; name: string; size?: number; mimetype?: string }[]
  onSelect: (files: File[]) => void
  onRemove?: (id: string) => void
  chooseLabel: string
  chooseTestId?: string
  chooseClassName?: string
  removeLabel?: (name: string) => string
  status?: string
  error?: string
}

export function FileUploadField({
  className,
  files,
  onSelect,
  onRemove,
  chooseLabel,
  chooseTestId,
  chooseClassName,
  removeLabel = (name) => `Remove ${name}`,
  status,
  error,
  required,
  disabled,
  onBlur,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  "aria-label": label,
  ...inputProps
}: FileUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const feedbackId = useId()
  const description =
    [
      describedBy,
      status ? `${feedbackId}-status` : undefined,
      error ? `${feedbackId}-error` : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined

  return (
    <div
      data-slot="file-upload-field"
      className={cn("min-w-0 space-y-2", className)}
    >
      <input
        {...inputProps}
        ref={inputRef}
        type="file"
        className="peer sr-only"
        tabIndex={-1}
        disabled={disabled}
        required={required && !files?.length}
        aria-label={label ?? chooseLabel}
        aria-describedby={description}
        aria-invalid={error ? true : invalid}
        onBlur={onBlur}
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? [])
          // Clear the native chooser so reselecting the same file works after removal or failure.
          event.currentTarget.value = ""
          if (selected.length) onSelect(selected)
        }}
      />
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        disabled={disabled}
        data-testid={chooseTestId}
        className={cn(
          "h-auto min-h-8 max-w-full justify-start whitespace-normal peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
          chooseClassName
        )}
        aria-label={label ? `${chooseLabel}: ${label}` : undefined}
        aria-invalid={error ? true : invalid}
        aria-describedby={description}
        onClick={() => inputRef.current?.click()}
      >
        <FileIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{chooseLabel}</span>
      </Button>
      {!!files?.length && (
        <ul className="space-y-1">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex min-h-8 min-w-0 items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm"
            >
              <FileIdentity
                fileName={file.name}
                size={file.size}
                mimetype={file.mimetype}
                className="flex-1"
              />
              {onRemove && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0"
                  aria-label={removeLabel(file.name)}
                  disabled={disabled}
                  onClick={() => {
                    triggerRef.current?.focus()
                    onRemove(file.id)
                  }}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {status && (
        <p
          id={`${feedbackId}-status`}
          role="status"
          className="text-xs text-muted-foreground"
        >
          {status}
        </p>
      )}
      {error && (
        <p
          id={`${feedbackId}-error`}
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  )
}

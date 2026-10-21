"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lumiere/ui/components/card"

/** Local object URLs are revoked when a file is replaced or the preview closes. */
export function CaptureAttachmentPreview({
  file,
  attached = false,
}: {
  file: File
  attached?: boolean
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return (
    <Card
      data-testid="expense-capture-attachment-preview"
      className="min-w-0 max-w-full [overflow-wrap:anywhere]"
    >
      <CardHeader className="min-w-0 max-w-full">
        <CardTitle>{file.name}</CardTitle>
        <CardDescription>
          {attached
            ? t("expenses.capture.attachments.attachedPreview", {
                defaultValue:
                  "Receipt attachment is confirmed. This preview uses the local file.",
              })
            : t("expenses.capture.attachments.localPreview", {
                defaultValue:
                  "Local preview. This file is not attached to a saved expense yet.",
              })}
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 max-w-full">
        {url && file.type.startsWith("image/") ? (
          <img
            src={url}
            alt={t("expenses.capture.attachments.imageAlt", {
              defaultValue: "Selected receipt",
            })}
            className="max-h-64 w-full min-w-0 max-w-full object-contain"
          />
        ) : null}
        {url && file.type === "application/pdf" ? (
          <object
            data={url}
            type="application/pdf"
            aria-label={t("expenses.capture.attachments.pdfLabel", {
              defaultValue: "Selected receipt PDF",
            })}
            className="h-64 w-full min-w-0 max-w-full"
          >
            <p>
              {t("expenses.capture.attachments.pdfFallback", {
                defaultValue:
                  "PDF selected. Your browser cannot display its preview.",
              })}
            </p>
          </object>
        ) : null}
      </CardContent>
    </Card>
  )
}

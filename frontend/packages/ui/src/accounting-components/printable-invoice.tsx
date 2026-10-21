"use client"

import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { InvoicePreview, type InvoicePreviewModel } from "./invoice-preview"

/**
 * An off-screen copy of the invoice sheet, mounted on `document.body` so no dialog transform or
 * overflow can clip it. Invisible on screen; the print stylesheet in globals.css shows only this
 * element when the page is printed.
 */
export function PrintableInvoice({ model, children }: { model?: InvoicePreviewModel; children?: ReactNode }) {
  if (typeof document === "undefined") return null
  return createPortal(
    <div className="invoice-print-only hidden" data-invoice-print-root>
      {children ?? (model ? <InvoicePreview model={model} printRoot /> : null)}
    </div>,
    document.body,
  )
}

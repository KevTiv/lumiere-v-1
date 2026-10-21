/**
 * Prints the invoice sheet. The print stylesheet (globals.css) hides everything except
 * `[data-invoice-print-root]`, so this just asks the browser to print the current page.
 */
export function printInvoice(): void {
  if (typeof window === "undefined") return
  window.print()
}

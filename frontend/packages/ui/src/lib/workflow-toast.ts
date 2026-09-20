import { toast } from "sonner"

/** Toasts for workflow completion, on the same Sonner instance the app's Toaster renders. */
export function showWorkflowToast(notice: {
  kind: "success" | "info" | "error"
  title: string
  description?: string
}) {
  const options = notice.description ? { description: notice.description } : undefined
  if (notice.kind === "error") toast.error(notice.title, options)
  else if (notice.kind === "info") toast.info(notice.title, options)
  else toast.success(notice.title, options)
}

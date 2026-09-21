import { toast } from "sonner"

/** Toasts for workflow completion, on the same Sonner instance the app's Toaster renders. */
export function showWorkflowToast(notice: {
  kind: "success" | "info" | "error"
  title: string
  description?: string
  /** A follow-up the user can take from the toast, such as retrying a failed transition. */
  action?: { label: string; onClick: () => void }
}) {
  const options =
    notice.description || notice.action
      ? {
          ...(notice.description ? { description: notice.description } : {}),
          // A toast with a choice must not vanish before the user can make it.
          ...(notice.action ? { action: notice.action, duration: 12_000 } : {}),
        }
      : undefined
  if (notice.kind === "error") toast.error(notice.title, options)
  else if (notice.kind === "info") toast.info(notice.title, options)
  else toast.success(notice.title, options)
}

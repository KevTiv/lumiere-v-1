import { notFound } from "next/navigation"
import { DashboardPreviewContent } from "./preview-content"

/** Local sample-data preview; unavailable in production. */
export default function DashboardPreview() {
  if (process.env.NODE_ENV !== "development") notFound()
  return <DashboardPreviewContent />
}

import { notFound } from "next/navigation"
import { DashboardPreviewClient } from "./preview-client"

/** Local sample-data preview; unavailable in production. */
export default function DashboardPreview() {
  if (process.env.NODE_ENV !== "development") notFound()
  return <DashboardPreviewClient />
}

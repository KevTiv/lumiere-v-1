import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListAllowEmpty } from "@/lib/server-query"
import { CalendarClient } from "./calendar-client"

export default async function CalendarPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <CalendarClient />
  }

  const events = await serverFetchQueryListAllowEmpty(session, "calendar-events")

  return (
    <CalendarClient
      initialEvents={events}
      organizationId={session.organizationId}
    />
  )
}

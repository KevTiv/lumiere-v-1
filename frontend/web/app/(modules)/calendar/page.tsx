import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListState } from "@/lib/server-query"
import { CalendarClient } from "./calendar-client"

export default async function CalendarPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <CalendarClient />
  }

  const events = await serverFetchQueryListState(session, "calendar-events")
  if (events.status === "denied" || events.status === "unavailable") {
    return (
      <main className="p-6" role="alert">
        Calendar data {events.status}: {events.message}
      </main>
    )
  }

  return (
    <CalendarClient
      initialEvents={events.rows}
      organizationId={session.organizationId}
    />
  )
}

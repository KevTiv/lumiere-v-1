import { getStdbSession } from "@/lib/api-session"
import { serverQueryCalendarEvents } from "@lumiere/stdb/server"
import { CalendarClient } from "./calendar-client"

export default async function CalendarPage() {
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <CalendarClient />
  }
  const { organizationId, opts } = session

  const [events] = await Promise.all([
    serverQueryCalendarEvents(organizationId, opts),
  ]).catch(() => [[]])

  return (
    <CalendarClient
      initialEvents={events as Record<string, unknown>[]}
      organizationId={organizationId}
    />
  )
}

import { getStdbSession } from "@/lib/stdb-session"
import { serverQueryCalendarEvents } from "@lumiere/stdb/server"
import { CalendarClient } from "./calendar-client"

export default async function CalendarPage() {
  const { organizationId, opts } = await getStdbSession()

  if (!organizationId) {
    return <CalendarClient />
  }

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

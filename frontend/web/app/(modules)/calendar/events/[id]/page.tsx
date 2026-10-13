import { getStdbSession } from "@/lib/api-session"
import { serverFetchQueryListsRequired } from "@/lib/server-query"
import { CalendarEventPageClient } from "./event-page-client"

const SSR_RESOURCES = ["calendar-events"] as const

interface CalendarEventPageProps {
  params: Promise<{ id: string }>
}

export default async function CalendarEventPage({ params }: CalendarEventPageProps) {
  const { id } = await params
  const session = await getStdbSession()
  if (!session?.organizationId) {
    return <CalendarEventPageClient eventId={id} />
  }

  const [events] = await serverFetchQueryListsRequired(session, SSR_RESOURCES)

  return <CalendarEventPageClient eventId={id} initialEvents={events} organizationId={session.organizationId} />
}

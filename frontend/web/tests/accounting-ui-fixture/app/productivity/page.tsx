"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { I18nProvider } from "@lumiere/i18n"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"
import { Button } from "../../../../../packages/ui/src/components/button"
import { CalendarView } from "../../../../../packages/ui/src/calendar-components/calendar-view"
import { FileBrowser, type FileBrowserState } from "../../../../../packages/ui/src/documents/file-browser"
import type { CalendarEvent, ViewMode } from "../../../../../packages/ui/src/lib/calendar-types"
import { calendarDate, calendarDayKey, calendarMode } from "../../../../../packages/ui/src/lib/calendar-dates"
import { documentBrowserState } from "../../../../app/(modules)/documents/document-browser-navigation"
import { MessageConversationWorkspace, type MessageReplyInput } from "../../../../app/(modules)/messages/message-conversation-workspace"
import type { MessageRow } from "../../../../app/(modules)/messages/message-conversations"
import { UnconfirmedPostedMessageError } from "@lumiere/query-hooks/hooks/mail-message-post"

const events: CalendarEvent[] = [
  { id: "41", title: "Invoice review", description: "Review customer invoice INV-0041", startTime: new Date(2026, 9, 28, 10), endTime: new Date(2026, 9, 28, 11), type: "meeting", status: "confirmed", createdBy: "Alpha accountant", attendees: [], visibility: "team", location: "Finance desk" },
  { id: "42", title: "Month end close", startTime: new Date(2026, 9, 28, 18), endTime: new Date(2026, 9, 30, 12), type: "meeting", status: "scheduled", createdBy: "Alpha accountant", attendees: [], visibility: "team" },
  { id: "43", title: "Cancelled vendor meeting", startTime: new Date(2026, 9, 29, 9), endTime: new Date(2026, 9, 29, 10), type: "meeting", status: "cancelled", createdBy: "Alpha accountant", attendees: [], visibility: "team" },
  { id: "44", title: "Finance planning day", startTime: new Date(2026, 9, 29), endTime: new Date(2026, 9, 30), allDay: true, type: "meeting", status: "confirmed", createdBy: "Alpha accountant", attendees: [], visibility: "team" },
]
const folders = [{ id: "7", name: "Vendor bills", parentId: null, fileCount: 1, totalSize: 1024, updatedAt: 1793181600000 }]
const files = [
  { id: "91", name: "October vendor bill", fileName: "october-vendor.pdf", mimetype: "application/pdf", size: 1024, folderId: "7", updatedAt: 1793181600000, modifiedBy: "Alpha accountant" },
  { id: "92", name: "Customer evidence", fileName: "customer.png", mimetype: "image/png", size: 2048, folderId: null, updatedAt: 1793095200000, modifiedBy: "Alpha accountant" },
]
const initialMessages: MessageRow[] = [
  { id: "101", model: "account_move", resId: "41", body: "Please review invoice INV-0041", date: 1793178000000, messageType: { tag: "Comment" }, authorId: "accountant" },
  { id: "102", model: "account_move", resId: "41", parentId: "101", body: "The receipt is attached", date: 1793181600000, messageType: { tag: "Comment" }, authorId: "reviewer" },
  // A visible message with a mismatched source must remain a separate conversation.
  { id: "103", model: "account_move", resId: "99", parentId: "101", body: "Separate supplier discussion", date: 1793185200000, messageType: { tag: "Comment" }, authorId: "reviewer" },
]

function Preview() {
  const router = useRouter()
  const params = useSearchParams()
  const [hydrated, setHydrated] = useState(false)
  const [messages, setMessages] = useState(initialMessages)
  const [replies, setReplies] = useState<MessageReplyInput[]>([])
  const [checks, setChecks] = useState(0)
  const [company, setCompany] = useState(7)
  const [createCount, setCreateCount] = useState(0)
  useEffect(() => setHydrated(true), [])
  const update = (changes: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(changes)) value == null ? next.delete(key) : next.set(key, value)
    const href = `/productivity?${next}`
    // Use Next's patched history for presentation-only fixture state.
    // This does not model an ERP route or trigger a server read.
    if (push) window.history.pushState(null, "", href)
    else window.history.replaceState(null, "", href)
  }
  const panel = params.get("panel") ?? "files"
  const browserState = documentBrowserState(params)
  const mode = calendarMode(params.get("view"))
  const date = calendarDate(params.get("date"), new Date(2026, 9, 28))
  const selectedDate = params.get("day") ? calendarDate(params.get("day"), date) : null
  const eventId = params.get("event")
  const setMode = (value: ViewMode) => update({ view: value })
  const onFileState = (state: FileBrowserState) => update({ folder: state.folderId, fileSearch: state.search || null, fileLayout: state.layout, file: state.selectedFileId ?? null })
  const replyEffect = (input: MessageReplyInput) => {
    setMessages((previous) => previous.some((row) => row.id === "104") ? previous : [...previous, { id: "104", ...input, date: 1793188800000, messageType: { tag: "Comment" } }])
    return { id: "104" }
  }
  const reply = async (input: MessageReplyInput) => {
    setReplies((previous) => [...previous, input])
    if (params.get("uncertain") === "1") throw new UnconfirmedPostedMessageError()
    if (replies.length === 0) throw new Error("Synthetic rejection. Your reply was not posted.")
    return replyEffect(input)
  }
  return <main className="mx-auto min-w-0 max-w-7xl space-y-6 p-4 md:p-6">
    <p data-testid="productivity-disclosure" data-hydrated={hydrated}>Synthetic productivity preview. Production components; no authentication or ERP operations.</p>
    <nav aria-label="Preview components" className="flex flex-wrap gap-3">{["files", "calendar", "messages"].map((id) => <Link key={id} href={`/productivity?panel=${id}`} className="rounded-md border px-3 py-2 text-sm capitalize">{id}</Link>)}</nav>
    {panel === "files" && <section aria-label="Files preview" className="space-y-4 rounded-xl border p-4"><h1 className="text-xl font-semibold">Files</h1>{params.get("document") ? <div data-testid="synthetic-document"><h2>Document #{params.get("document")}</h2><p>Synthetic record destination; the file ID comes from the production browser.</p><Button onClick={() => { const next = new URLSearchParams(params.toString()); next.delete("document"); router.push(`/productivity?${next}`) }}>Back to files</Button></div> : <FileBrowser folders={folders} files={files} state={browserState} onStateChange={onFileState} onOpenFile={(id) => update({ document: id }, true)} onUpload={async () => { throw new Error("Synthetic upload failure: file outcome unconfirmed") }} />}</section>}
    {panel === "calendar" && <section aria-label="Calendar preview" className="space-y-4 rounded-xl border p-4"><h1 className="text-xl font-semibold">Calendar</h1><p data-testid="synthetic-create-count">Create callbacks: {createCount}</p><CalendarView events={events} viewMode={mode} currentDate={date} selectedDate={selectedDate} searchTerm={params.get("search") ?? ""} selectedEventId={eventId} onViewModeChange={setMode} onPrevMonth={() => update({ date: calendarDayKey(new Date(date.getFullYear(), date.getMonth()-1, date.getDate())) })} onNextMonth={() => update({ date: calendarDayKey(new Date(date.getFullYear(), date.getMonth()+1, date.getDate())) })} onToday={() => update({ date: "2026-10-28" })} onSelectDate={(value) => update({ day: calendarDayKey(value) })} onSearchChange={(value) => update({ search: value || null })} onSelectEvent={(id) => update({ event: id }, true)} onCreateEvent={() => setCreateCount((count) => count + 1)} eventHref={(id) => `/calendar/events/${id}`} /></section>}
    {panel === "messages" && <section aria-label="Messages preview" className="space-y-4"><div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => { setCompany(8); update({ message: null }) }}>Switch preview company</Button><p data-testid="reply-callback-count">Reply callbacks: {replies.length}; read callbacks: {checks}</p></div><MessageConversationWorkspace key={company} messages={company === 7 ? messages : []} selectedMessageId={params.get("message")} search={params.get("messageSearch") ?? ""} onSearchChange={(value) => update({ messageSearch: value || null })} onSelectMessage={(id) => update({ message: id }, true)} canReply={company === 7} onReply={reply} onCheckOutcome={async (input) => { setChecks((value) => value + 1); return replyEffect(input) }} sourceLabels={new Map([["account_move:41", "Invoice INV-0041"], ["account_move:99", "Bill BILL-0099"]])} /></section>}
  </main>
}
export default function Page() {
  return <I18nProvider language="en"><ThemeProvider defaultTheme="light" storageKey="lumiere-productivity-preview"><Preview /></ThemeProvider></I18nProvider>
}

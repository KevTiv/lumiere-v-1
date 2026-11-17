"use client"

import { useId, type ReactNode } from "react"
import { ArrowLeft, Plus, Search } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Input } from "../components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/select"
import { cn } from "../lib/utils"

export type ChatHistoryEntry = {
  key: string
  title: string
  moduleLabel?: string
  timestamp?: string
  excerpt?: string
  messageId?: string
}

export type ChatHistoryPanelProps = {
  entries: readonly ChatHistoryEntry[]
  selectedKey?: string | null
  archived: boolean
  onArchivedChange: (archived: boolean) => void
  search: string
  onSearchChange: (search: string) => void
  module: string
  modules: readonly { value: string; label: string }[]
  onModuleChange: (module: string) => void
  onSelect: (entry: ChatHistoryEntry) => void
  onNewChat: () => void
  onBack: () => void
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  onMore?: () => void
  actions?: ReactNode
}

export function ChatHistoryPanel({
  entries, selectedKey, archived, onArchivedChange, search, onSearchChange, module,
  modules, onModuleChange, onSelect, onNewChat, onBack, loading, error, onRetry,
  onMore, actions,
}: ChatHistoryPanelProps) {
  const { t } = useTranslation()
  const searchId = useId()
  const filterId = useId()
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="space-y-3 border-b p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            {t("aiChat.history.back", { defaultValue: "Back to chat" })}
          </Button>
          <Button size="sm" onClick={onNewChat}>
            <Plus aria-hidden="true" />
            {t("aiChat.history.newChat", { defaultValue: "New chat" })}
          </Button>
        </div>
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">{t("aiChat.history.search", { defaultValue: "Search conversations" })}</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id={searchId} data-assistant-history-search type="search" value={search} maxLength={80}
            placeholder={t("aiChat.history.search", { defaultValue: "Search conversations" })}
            onChange={event => onSearchChange(event.target.value)} className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("aiChat.history.status", { defaultValue: "Conversation status" })}>
          <Button variant={archived ? "ghost" : "secondary"} size="sm" aria-pressed={!archived}
            onClick={() => onArchivedChange(false)}>{t("aiChat.history.recent", { defaultValue: "Recent" })}</Button>
          <Button variant={archived ? "secondary" : "ghost"} size="sm" aria-pressed={archived}
            onClick={() => onArchivedChange(true)}>{t("aiChat.history.archived", { defaultValue: "Archived" })}</Button>
        </div>
        <span id={filterId} className="sr-only">{t("aiChat.history.module", { defaultValue: "Module" })}</span>
        <Select value={module || "all"} onValueChange={value => onModuleChange(value && value !== "all" ? value : "")}>
          <SelectTrigger aria-labelledby={filterId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("aiChat.history.allModules", { defaultValue: "All modules" })}</SelectItem>
            {modules.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2" aria-busy={loading}>
        <ul className="space-y-0.5">
          {entries.map(entry => (
            <li key={entry.key}>
              <Button variant={selectedKey === entry.key ? "secondary" : "ghost"} size="sm"
                className={cn("h-auto min-h-11 w-full min-w-0 flex-col items-start gap-0.5 whitespace-normal px-2.5 py-2 text-left")}
                aria-current={selectedKey === entry.key ? "true" : undefined} aria-label={entry.title} onClick={() => onSelect(entry)}>
                <span className="max-w-full break-words [overflow-wrap:anywhere]">{entry.title}</span>
                {entry.moduleLabel || entry.timestamp ? (
                  <span className="max-w-full text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">
                    {[entry.moduleLabel, entry.timestamp].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
                {entry.excerpt ? <span className="line-clamp-2 text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">{entry.excerpt}</span> : null}
              </Button>
            </li>
          ))}
        </ul>
        {error ? (
          <div className="space-y-2 p-2" role="alert">
            <p className="text-sm text-destructive">{t("aiChat.history.loadFailed", { defaultValue: "Conversation history could not be loaded." })}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>{t("common.retry", { defaultValue: "Retry" })}</Button>
          </div>
        ) : null}
        {loading ? <p role="status" className="p-2 text-sm text-muted-foreground">{t("aiChat.history.loading", { defaultValue: "Loading conversations…" })}</p> : null}
        {!loading && !error && !entries.length && !onMore ? (
          <p className="p-2 text-sm text-muted-foreground">{t("aiChat.history.empty", { defaultValue: "No matching conversations." })}</p>
        ) : null}
        {onMore && !error ? (
          <Button variant="ghost" size="sm" className="mt-2 w-full" disabled={loading} onClick={onMore}>
            {t("aiChat.history.loadMore", { defaultValue: "Load more conversations" })}
          </Button>
        ) : null}
      </div>
      {actions ? <div className="shrink-0 border-t p-2">{actions}</div> : null}
    </div>
  )
}

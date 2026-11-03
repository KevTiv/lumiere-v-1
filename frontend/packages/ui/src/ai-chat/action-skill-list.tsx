"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { Check, X } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { cn } from "../lib/utils"

export interface ActionSkillItem {
  id: string
  label: string
  description?: string
  icon?: ReactNode
}

export interface ActionSkillListProps {
  items: readonly ActionSkillItem[]
  selectedIds: readonly string[]
  activeId?: string
  onActiveChange: (id: string) => void
  onToggle: (id: string) => void
  onRemove?: (id: string) => void
  /** Search narrows the list without changing existing selections. */
  matchingIds?: readonly string[]
  disabled?: boolean
  className?: string
}

/** A compact, scrollable skill grid with independent focus and selection. */
export function ActionSkillList({ items, selectedIds, activeId, onActiveChange, onToggle, onRemove = onToggle, matchingIds, disabled, className }: ActionSkillListProps) {
  const { t } = useTranslation()
  const viewport = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const visible = matchingIds ? items.filter(item => matchingIds.includes(item.id)) : items
  const active = visible.find(item => item.id === activeId)?.id ?? visible[0]?.id
  const selected = items.filter(item => selectedIds.includes(item.id))
  const searchKey = JSON.stringify(matchingIds ?? null)

  // Scroll only this list, and only when the focused match or search changes.
  // Normal typing must not reset a position the user scrolled to manually.
  useEffect(() => {
    const container = viewport.current
    const button = active ? buttons.current.get(active) : undefined
    if (!container || !button) return
    const bounds = container.getBoundingClientRect()
    const card = button.getBoundingClientRect()
    if (card.top < bounds.top) container.scrollTop += card.top - bounds.top
    else if (card.bottom > bounds.bottom) container.scrollTop += card.bottom - bounds.bottom
  }, [active, searchKey])

  return <div role="group" aria-label={t("aiChat.quickActions.label")} className={cn("min-w-0 space-y-2", className)}>
    <p className="text-xs text-muted-foreground">{t("aiChat.deck.hint")}</p>
    <div ref={viewport} role="region" aria-label={t("aiChat.deck.cards")}
      className="relative max-h-28 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]"
      onKeyDown={event => {
        const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 }
        const step = steps[event.key]
        if (step === undefined || disabled) return
        const index = visible.findIndex(item => item.id === active)
        const next = visible[Math.max(0, Math.min(visible.length - 1, index + step))]
        if (!next) return
        event.preventDefault()
        buttons.current.get(next.id)?.focus()
      }}>
      {visible.length === 0 ? <p role="status" className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">{t("aiChat.deck.noMatches")}</p> : <div className="grid grid-cols-2 gap-2">
        {visible.map(item => {
          const checked = selectedIds.includes(item.id)
          return <button key={item.id} ref={node => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id) }}
            type="button" disabled={disabled} aria-label={item.label} aria-pressed={checked}
            title={item.description ?? item.label} data-active={item.id === active} data-selected={checked}
            onFocus={() => onActiveChange(item.id)} onClick={() => onToggle(item.id)}
            className={cn("flex min-h-11 min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              checked ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-foreground hover:bg-muted")}>
            <span className={cn("shrink-0 [&>svg]:size-3.5", checked ? "text-primary" : "text-muted-foreground")}>{item.icon}</span>
            <span className="line-clamp-2 min-w-0 flex-1 font-medium">{item.label}</span>
            {checked && <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
          </button>
        })}
      </div>}
    </div>
    {selected.length > 0 && <div role="group" aria-label={t("aiChat.deck.selected")} className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
      {selected.map(item => <button key={item.id} type="button" disabled={disabled} onClick={() => onRemove(item.id)} aria-label={t("aiChat.deck.remove", { label: item.label })}
        className="flex max-w-full items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><Check className="size-3 shrink-0 text-primary" aria-hidden="true" /><span className="truncate">{item.label}</span><X className="size-3 shrink-0" aria-hidden="true" /></button>)}
    </div>}
  </div>
}

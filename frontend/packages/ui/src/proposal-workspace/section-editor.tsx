"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { SectionStatus } from "@/lib/proposal-workspace-types"
import type { ProposalLineItem, ProposalComment } from "@lumiere/stdb/proposal-row-types"
import { ProductLineItems } from "./product-line-items"
import { CommentThread } from "./comment-thread"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Section = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Product = Record<string, any>

const getStatusOptions = (t: (key: string) => string): { value: SectionStatus; label: string }[] => [
  { value: "empty", label: t("proposalWorkspace.sectionEditor.statusEmpty") },
  { value: "draft", label: t("proposalWorkspace.sectionEditor.statusDraft") },
  { value: "complete", label: t("proposalWorkspace.sectionEditor.statusComplete") },
  { value: "reviewed", label: t("proposalWorkspace.sectionEditor.statusReviewed") },
]

const STATUS_VARIANT: Record<SectionStatus, "secondary" | "outline" | "default"> = {
  empty: "outline",
  draft: "secondary",
  complete: "default",
  reviewed: "default",
}

interface ProductMention {
  search: string
  startIndex: number
}

interface SectionEditorProps {
  section: Section | null
  lineItems: ProposalLineItem[]
  comments: ProposalComment[]
  products: Product[]
  currentUserId?: string
  isSaving?: boolean
  onSaveContent: (content: string, status: SectionStatus) => void
  onSaveTitle: (title: string) => void
  onAddLineItem: (productId: bigint, productName: string, priceUnit: number) => void
  onUpdateLineItem: (id: bigint, quantity: number, priceUnit: number, discount: number, notes?: string) => void
  onDeleteLineItem: (id: bigint) => void
  onAddComment: (content: string, parentId?: bigint) => void
  onResolveComment: (id: bigint) => void
  onFocus: () => void
}

export function SectionEditor({
  section,
  lineItems,
  comments,
  products,
  currentUserId,
  isSaving,
  onSaveContent,
  onSaveTitle,
  onAddLineItem,
  onUpdateLineItem,
  onDeleteLineItem,
  onAddComment,
  onResolveComment,
  onFocus,
}: SectionEditorProps) {
  const { t } = useTranslation()
  const [localContent, setLocalContent] = useState<string | null>(null)
  const [localTitle, setLocalTitle] = useState<string | null>(null)
  const [status, setStatus] = useState<SectionStatus>("empty")
  const [mention, setMention] = useState<ProductMention | null>(null)
  const [mentionSearch, setMentionSearch] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync from STDB when section changes
  useEffect(() => {
    if (section) {
      setLocalContent(null)
      setLocalTitle(null)
      setStatus((section.status as string)?.toLowerCase() as SectionStatus ?? "empty")
    }
  }, [section?.id])

  const content = localContent ?? (section?.content ?? "")
  const title = localTitle ?? (section?.title ?? "")

  const scheduleContentSave = useCallback(
    (value: string, currentStatus: SectionStatus) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onSaveContent(value, currentStatus)
      }, 1500)
    },
    [onSaveContent]
  )

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setLocalContent(value)

    // Detect @-mention trigger
    const cursorPos = e.target.selectionStart ?? value.length
    const textBefore = value.slice(0, cursorPos)
    const atMatch = textBefore.match(/@([\w\s]*)$/)
    if (atMatch) {
      setMention({ search: atMatch[1], startIndex: cursorPos - atMatch[0].length })
      setMentionSearch(atMatch[1])
    } else {
      setMention(null)
      setMentionSearch("")
    }

    scheduleContentSave(value, status)
  }

  const handleStatusChange = (newStatus: SectionStatus) => {
    setStatus(newStatus)
    onSaveContent(content, newStatus)
  }

  const handleTitleBlur = () => {
    if (localTitle !== null && localTitle !== section?.title) {
      onSaveTitle(localTitle)
    }
  }

  const handleSelectProduct = (product: Product) => {
    if (!mention || !textareaRef.current) {
      setMention(null)
      return
    }
    // Remove the @search text from content
    const before = content.slice(0, mention.startIndex)
    const after = content.slice(mention.startIndex + mention.search.length + 1) // +1 for @
    const newContent = before + after
    setLocalContent(newContent)
    setMention(null)
    setMentionSearch("")

    const priceUnit = product.listPrice ?? product.list_price ?? product.standardPrice ?? 0
    onAddLineItem(BigInt(String(product.id)), String(product.name), Number(priceUnit))
  }

  const filteredProducts = mentionSearch.trim()
    ? products.filter((p) =>
        String(p.name ?? "").toLowerCase().includes(mentionSearch.toLowerCase())
      ).slice(0, 8)
    : products.slice(0, 8)

  if (!section) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">{t("proposalWorkspace.sectionEditor.selectSection")}</p>
          <p className="text-xs mt-1">{t("proposalWorkspace.sectionEditor.addFromSidebar")}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto px-6 py-4" onFocus={onFocus}>
      {/* Title + status row */}
      <div className="flex items-start gap-3 mb-4">
        <input
          value={title}
          onChange={(e) => setLocalTitle(e.target.value)}
          onBlur={handleTitleBlur}
          placeholder={t("proposalWorkspace.sectionEditor.sectionTitle")}
          className="flex-1 text-lg font-semibold bg-transparent border-none outline-none focus:outline-none placeholder:text-muted-foreground/50 text-foreground"
        />
        {/* Status selector */}
        <div className="relative group shrink-0">
          <Badge variant={STATUS_VARIANT[status]} className="cursor-pointer text-xs">
            {getStatusOptions(t).find((o) => o.value === status)?.label ?? status}
          </Badge>
          <div className="absolute top-full right-0 mt-1 z-20 rounded-lg border border-border bg-popover shadow-lg hidden group-hover:block min-w-[120px]">
            {getStatusOptions(t).map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors",
                  status === opt.value && "font-semibold text-primary"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI suggestion strip */}
      {section.aiSuggestion && (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-primary/5 border border-primary/20 px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">{section.aiSuggestion}</p>
        </div>
      )}

      {/* Content editor with @-mention */}
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          placeholder={t("proposalWorkspace.sectionEditor.contentPlaceholder", { sectionName: title || t("proposalWorkspace.sectionEditor.sectionDefaultName") })}
          className="w-full min-h-[300px] resize-none bg-transparent border-none outline-none focus:outline-none text-sm text-foreground placeholder:text-muted-foreground/40 leading-relaxed"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />

        {/* @-mention popover */}
        {mention && (
          <div className="absolute left-0 z-30 w-64 rounded-lg border border-border bg-popover shadow-lg" style={{ top: "2rem" }}>
            <div className="px-3 py-2 border-b border-border">
              <p className="text-xs text-muted-foreground">{t("proposalWorkspace.sectionEditor.linkProductService")}</p>
              {mentionSearch && (
                <p className="text-xs font-medium mt-0.5">&quot;{mentionSearch}&quot;</p>
              )}
            </div>
            {filteredProducts.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">{t("proposalWorkspace.sectionEditor.noProductsFound")}</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto">
                {filteredProducts.map((product) => (
                  <li key={String(product.id)}>
                    <button
                      type="button"
                      onClick={() => handleSelectProduct(product)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="truncate font-medium">{product.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {product.type_ || product.type ? (
                          <span className="text-[10px] text-muted-foreground">{product.type_ ?? product.type}</span>
                        ) : null}
                        {(product.listPrice ?? product.list_price) !== undefined && (
                          <span className="text-[10px] font-mono text-foreground">
                            ${Number(product.listPrice ?? product.list_price).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border px-3 py-1.5">
              <button
                type="button"
                onClick={() => setMention(null)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                {t("proposalWorkspace.sectionEditor.dismissEsc")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Saving indicator */}
      {isSaving && (
        <p className="text-[10px] text-muted-foreground mb-2">{t("proposalWorkspace.sectionEditor.saving")}</p>
      )}

      {/* Product line items */}
      <ProductLineItems
        items={lineItems}
        products={products}
        onUpdate={onUpdateLineItem}
        onDelete={onDeleteLineItem}
      />

      {/* Comments */}
      <CommentThread
        comments={comments}
        currentUserId={currentUserId}
        onAdd={onAddComment}
        onResolve={onResolveComment}
      />
    </div>
  )
}

"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { CheckCheck, MessageSquare, Reply } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ProposalComment } from "@lumiere/stdb/proposal-row-types"
import { rowBigint, rowBool, rowString } from "./row-field-utils"

interface CommentThreadProps {
  comments: ProposalComment[]
  currentUserId?: string
  onAdd: (content: string, parentId?: bigint) => void
  onResolve: (id: bigint) => void
}

interface CommentCardProps {
  comment: ProposalComment
  replies: ProposalComment[]
  currentUserId?: string
  onReply: (parentId: bigint) => void
  onResolve: (id: bigint) => void
}

function formatDate(ts: unknown): string {
  if (ts == null || ts === "") return ""
  try {
    const micros = typeof ts === "bigint" ? ts : BigInt(String(ts))
    const ms = Number(micros) / 1000 // micros → ms
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

function avatarColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 60%, 50%)`
}

function CommentCard({ comment, replies, currentUserId, onReply, onResolve }: CommentCardProps) {
  const { t } = useTranslation()
  const isResolved = rowBool(comment.isResolved)
  const initials = rowString(comment.authorName, "?").slice(0, 2).toUpperCase()
  const userId = rowString(comment.authorId)

  return (
    <div className={cn("space-y-2", isResolved ? "opacity-50" : undefined)}>
      <div className="flex items-start gap-2">
        <div
          className="w-6 h-6 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0 mt-0.5"
          style={{ backgroundColor: avatarColor(userId) }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium">{rowString(comment.authorName)}</span>
            <span className="text-[10px] text-muted-foreground">{formatDate(comment.createDate)}</span>
            {isResolved && (
              <span className="text-[10px] text-success flex items-center gap-0.5">
                <CheckCheck className="h-2.5 w-2.5" /> {t("proposalWorkspace.commentThread.resolved")}
              </span>
            )}
          </div>
          <p className={cn("text-xs mt-0.5 text-foreground", isResolved ? "line-through decoration-muted-foreground" : undefined)}>
            {rowString(comment.content)}
          </p>
          {!isResolved && (
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => onReply(rowBigint(comment.id))}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
              >
                <Reply className="h-2.5 w-2.5" />
                {t("proposalWorkspace.commentThread.reply")}
              </button>
              {(userId === currentUserId || !currentUserId) && (
                <button
                  onClick={() => onResolve(rowBigint(comment.id))}
                  className="text-[10px] text-muted-foreground hover:text-success flex items-center gap-0.5 transition-colors"
                >
                  <CheckCheck className="h-2.5 w-2.5" />
                  {t("proposalWorkspace.commentThread.resolve")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Replies */}
      {replies.length > 0 && (
        <div className="ml-8 pl-2 border-l border-border space-y-2">
          {replies.map((reply) => (
            <div key={String(reply.id)} className="flex items-start gap-2">
              <div
                className="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: avatarColor(rowString(reply.authorId)) }}
              >
                {rowString(reply.authorName, "?").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{rowString(reply.authorName)}</span>
                  <span className="text-[10px] text-muted-foreground">{formatDate(reply.createDate)}</span>
                </div>
                <p className="text-xs mt-0.5">{rowString(reply.content)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CommentThread({ comments, currentUserId, onAdd, onResolve }: CommentThreadProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [newComment, setNewComment] = useState("")
  const [replyingTo, setReplyingTo] = useState<bigint | null>(null)
  const [replyContent, setReplyContent] = useState("")

  // Only root comments (no parentId)
  const rootComments = comments.filter((c) => !c.parentId)
  const openCount = comments.filter((c) => !rowBool(c.isResolved) && !c.parentId).length

  const handleAddRoot = () => {
    if (!newComment.trim()) return
    onAdd(newComment.trim())
    setNewComment("")
  }

  const handleAddReply = () => {
    if (!replyContent.trim() || !replyingTo) return
    onAdd(replyContent.trim(), replyingTo)
    setReplyContent("")
    setReplyingTo(null)
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        <span>{openCount > 0 ? (openCount === 1 ? t("proposalWorkspace.commentThread.commentsCount", { count: openCount }) : t("proposalWorkspace.commentThread.commentsCountPlural", { count: openCount })) : t("proposalWorkspace.commentThread.comments")}</span>
        {openCount > 0 && (
          <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-medium">
            {openCount}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {/* Comment list */}
          {rootComments.map((comment) => {
            const replies = comments.filter(
              (c) => c.parentId && String(c.parentId) === String(comment.id)
            )
            return (
              <CommentCard
                key={String(comment.id)}
                comment={comment}
                replies={replies}
                currentUserId={currentUserId}
                onReply={(parentId) => {
                  setReplyingTo(parentId)
                  setOpen(true)
                }}
                onResolve={onResolve}
              />
            )
          })}

          {/* Reply input */}
          {replyingTo && (
            <div className="ml-8 space-y-1">
              <p className="text-[10px] text-muted-foreground">{t("proposalWorkspace.commentThread.replyingToComment")}</p>
              <textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder={t("proposalWorkspace.commentThread.writeReply")}
                rows={2}
                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex gap-1.5">
                <Button size="sm" className="h-6 text-xs px-2" onClick={handleAddReply}>
                  {t("proposalWorkspace.commentThread.reply")}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setReplyingTo(null)}>
                  {t("proposalWorkspace.commentThread.cancel")}
                </Button>
              </div>
            </div>
          )}

          {/* New comment input */}
          <div className="space-y-1">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddRoot() }}
              placeholder={t("proposalWorkspace.commentThread.addComment")}
              rows={2}
              className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button
              size="sm"
              className="h-6 text-xs px-2"
              onClick={handleAddRoot}
              disabled={!newComment.trim()}
            >
              {t("proposalWorkspace.commentThread.comment")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

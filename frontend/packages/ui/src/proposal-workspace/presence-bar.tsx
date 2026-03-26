"use client"

import { useTranslation } from "@lumiere/i18n"
import { cn } from "@/lib/utils"
import type { ProposalPresence } from "@lumiere/stdb"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Section = Record<string, any>

function avatarColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 60%, 50%)`
}

interface PresenceBarProps {
  presenceRows: ProposalPresence[]
  sections: Section[]
  currentUserId?: string
}

export function PresenceBar({ presenceRows, sections, currentUserId }: PresenceBarProps) {
  const { t } = useTranslation()
  if (presenceRows.length === 0) return null

  const getSectionTitle = (sectionId: bigint | null | undefined): string | null => {
    if (!sectionId) return null
    const sec = sections.find((s) => String(s.id) === String(sectionId))
    return sec?.title ?? null
  }

  return (
    <div className="flex items-center gap-1" title={t("proposalWorkspace.presenceBar.activeCollaborators")}>
      {presenceRows.map((p) => {
        const userId = String(p.userId)
        const isSelf = userId === currentUserId
        const sectionTitle = getSectionTitle(p.sectionId)
        const initials = String(p.userName ?? "?").slice(0, 2).toUpperCase()
        const tooltip = isSelf
          ? (sectionTitle ? t("proposalWorkspace.presenceBar.youWithSection", { section: sectionTitle }) : t("proposalWorkspace.presenceBar.you"))
          : (sectionTitle ? t("proposalWorkspace.presenceBar.userWithSection", { name: p.userName, section: sectionTitle }) : String(p.userName ?? ""))

        return (
          <div
            key={userId}
            title={tooltip}
            className={cn(
              "w-6 h-6 rounded-full text-[10px] font-bold text-white flex items-center justify-center cursor-default select-none",
              isSelf && "ring-2 ring-primary ring-offset-1"
            )}
            style={{ backgroundColor: avatarColor(userId) }}
          >
            {initials}
          </div>
        )
      })}
    </div>
  )
}

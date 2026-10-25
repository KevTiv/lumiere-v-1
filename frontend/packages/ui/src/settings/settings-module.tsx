"use client"

import type { ComponentType, ReactNode } from "react"
import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"

import { cn } from "@/lib/utils"
import { useRBAC } from "@/lib/rbac-context"
import { isPersonalSettingsSection, isSettingsSectionVisibleForProfile, settingsSections } from "@/lib/rbac-defaults"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  User,
  Bell,
  Palette,
  Users,
  Shield,
  ScrollText,
  Settings2,
  BookMarked,
  Lock,
  Building,
  Sparkles,
  KeyRound,
} from "lucide-react"
import { UserManagement } from "./user-management"
import { RoleManagement } from "./role-management"
import { AuditLog } from "./audit-log"
import { ProfileSettings } from "./profile-settings"
import { UnifiedFormConfigSettings } from "./unified-form-config-settings"
import { UserCustomFields } from "./user-custom-fields"
import { OrganizationSettings } from "./organization-settings"
import { AiSettings } from "./ai-settings"
import { SsoSettings } from "./sso-settings"

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  user: User,
  bell: Bell,
  palette: Palette,
  users: Users,
  shield: Shield,
  scroll: ScrollText,
  settings2: Settings2,
  bookmarked: BookMarked,
  building: Building,
  sparkles: Sparkles,
  keyround: KeyRound,
}

const settingsGroups = [
  {
    id: "account",
    title: "Account",
    sectionIds: ["profile", "notifications", "appearance", "custom-fields"],
  },
  {
    id: "organization",
    title: "Organization",
    sectionIds: ["organization", "users", "roles", "sso"],
  },
  {
    id: "data",
    title: "Data & integrations",
    sectionIds: [],
  },
  {
    id: "platform",
    title: "Platform",
    sectionIds: ["ai", "form-config", "audit"],
  },
] as const

export type SettingsGroupId = (typeof settingsGroups)[number]["id"]

/** A section supplied by the host app (e.g. integrations) that lives in the same nav as the built-in ones. */
export interface SettingsExtraSection {
  id: string
  groupId: SettingsGroupId
  title: string
  description: string
  icon?: ComponentType<{ className?: string }>
  content: ReactNode
}

interface NavSection {
  id: string
  groupId: SettingsGroupId
  title: string
  description: string
  Icon: ComponentType<{ className?: string }>
}

const SECTION_QUERY_PARAM = "section"

interface SettingsModuleProps {
  className?: string
  extraSections?: SettingsExtraSection[]
  uploadInvoiceLogo?: (file: File, companyId: string | null) => Promise<string>
  firstOrgProfile?: boolean
}

export function SettingsModule({
  className,
  extraSections = [],
  uploadInvoiceLogo,
  firstOrgProfile = false,
}: SettingsModuleProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { checkPermission, isAdmin } = useRBAC()

  const builtIn: NavSection[] = settingsSections
    .filter(
      (section) =>
        isSettingsSectionVisibleForProfile(section.id, isAdmin(), firstOrgProfile) &&
        (isPersonalSettingsSection(section.id) ||
          checkPermission(section.requiredPermission, section.requiredAction).allowed),
    )
    .map((section) => {
      const group = settingsGroups.find((g) => (g.sectionIds as readonly string[]).includes(section.id))
      return {
        id: section.id,
        groupId: group?.id ?? "platform",
        title: section.title,
        description: section.description,
        Icon: iconMap[section.icon] || User,
      }
    })
  const extras: NavSection[] = extraSections.map((section) => ({
    id: section.id,
    groupId: section.groupId,
    title: section.title,
    description: section.description,
    Icon: section.icon ?? Settings2,
  }))

  const groups = settingsGroups
    .map((group) => ({
      ...group,
      sections: [
        ...group.sectionIds
          .map((id) => builtIn.find((section) => section.id === id))
          .filter((section): section is NavSection => Boolean(section)),
        ...extras.filter((section) => section.groupId === group.id),
      ],
    }))
    .filter((group) => group.sections.length > 0)

  const allSections = groups.flatMap((group) => group.sections)
  const requested = searchParams?.get(SECTION_QUERY_PARAM)
  const active = allSections.find((section) => section.id === requested) ?? allSections[0] ?? null

  const selectSection = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "")
      next.set(SECTION_QUERY_PARAM, id)
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const renderSectionContent = () => {
    if (!active) return null
    const extra = extraSections.find((section) => section.id === active.id)
    if (extra) return extra.content
    switch (active.id) {
      case "users":
        return <UserManagement />
      case "roles":
        return <RoleManagement />
      case "sso":
        return <SsoSettings />
      case "audit":
        return <AuditLog />
      case "profile":
      case "notifications":
      case "appearance":
        return <ProfileSettings section={active.id} />
      case "form-config":
        return <UnifiedFormConfigSettings />
      case "custom-fields":
        return <UserCustomFields />
      case "organization":
        return <OrganizationSettings uploadInvoiceLogo={uploadInvoiceLogo} />
      case "ai":
        return <AiSettings />
      default:
        return null
    }
  }

  return (
    <div className={cn("grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start", className)}>
      <nav aria-label={t("settings.page.title")} className="lg:sticky lg:top-4">
        {isAdmin() && (
          <Badge variant="outline" className="mb-3 hidden gap-1 border-border text-muted-foreground lg:inline-flex">
            <Shield className="h-3 w-3" />
            {t("settings.adminAccess")}
          </Badge>
        )}
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
          {groups.map((group) => (
            <div key={group.id} className="flex shrink-0 gap-1 lg:flex-col">
              <p className="hidden px-2 pb-1 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground lg:block">
                {group.title}
              </p>
              {group.sections.map((section) => {
                const isActive = section.id === active?.id
                return (
                  <button
                    key={section.id}
                    type="button"
                    data-testid={`settings-section-${section.id}`}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20",
                      isActive
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                    onClick={() => selectSection(section.id)}
                  >
                    <section.Icon className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">{section.title}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 space-y-6">
        {active ? (
          <>
            <header>
              <h2 className="text-xl font-semibold tracking-[-0.02em]">{active.title}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{active.description}</p>
            </header>
            {renderSectionContent()}
          </>
        ) : null}

        {!isAdmin() && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
              <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">{t("settings.restricted")}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

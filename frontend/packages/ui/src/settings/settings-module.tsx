"use client"

import type { ComponentType } from "react"
import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"

import { cn } from "@/lib/utils"
import { useRBAC } from "@/lib/rbac-context"
import { settingsSections } from "@/lib/rbac-defaults"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  User,
  Bell,
  Palette,
  Users,
  Shield,
  ScrollText,
  ChevronRight,
  Settings2,
  BookMarked,
  Lock,
  Building,
  Sparkles,
} from "lucide-react"
import { UserManagement } from "./user-management"
import { RoleManagement } from "./role-management"
import { AuditLog } from "./audit-log"
import { ProfileSettings } from "./profile-settings"
import { UnifiedFormConfigSettings } from "./unified-form-config-settings"
import { UserCustomFields } from "./user-custom-fields"
import { OrganizationSettings } from "./organization-settings"
import { AiSettings } from "./ai-settings"

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
}

const settingsGroups = [
  {
    id: "account",
    title: "Account",
    description: "Personal preferences and workspace experience.",
    sectionIds: ["profile", "notifications", "appearance", "custom-fields"],
  },
  {
    id: "organization",
    title: "Organization",
    description: "Company configuration and user access.",
    sectionIds: ["organization", "users", "roles"],
  },
  {
    id: "platform",
    title: "Platform",
    description: "Automation, AI, forms, and audit controls.",
    sectionIds: ["ai", "form-config", "audit"],
  },
] as const

type SettingsSectionItem = (typeof settingsSections)[number]

interface SettingsModuleProps {
  className?: string
}

export function SettingsModule({ className }: SettingsModuleProps) {
  const { t } = useTranslation()

  const [activeSection, setActiveSection] = useState<string | null>(null)
  const { checkPermission, isAdmin } = useRBAC()
  const accessibleSections = settingsSections.filter((section) =>
    checkPermission(section.requiredPermission, section.requiredAction).allowed
  )

  const renderSectionContent = () => {
    switch (activeSection) {
      case "users":
        return <UserManagement />
      case "roles":
        return <RoleManagement />
      case "audit":
        return <AuditLog />
      case "profile":
      case "notifications":
      case "appearance":
        return <ProfileSettings section={activeSection} />
      case "form-config":
        return <UnifiedFormConfigSettings />
      case "custom-fields":
        return <UserCustomFields />
      case "organization":
        return <OrganizationSettings />
      case "ai":
        return <AiSettings />
      default:
        return null
    }
  }

  if (activeSection) {
    const section = settingsSections.find(s => s.id === activeSection)
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveSection(null)}
            className="gap-2"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
            {t("settings.backToSettings")}
          </Button>
          <div className="min-w-0 pt-1">
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{section?.title}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{section?.description}</p>
          </div>
        </div>
        {renderSectionContent()}
      </div>
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center justify-between">
        {isAdmin() && (
          <Badge variant="outline" className="gap-1 border-border text-muted-foreground">
            <Shield className="h-3 w-3" />
            {t("settings.adminAccess")}
          </Badge>
        )}
      </div>

      <div className="space-y-5">
        {settingsGroups.map((group) => {
          const sections = group.sectionIds
            .map((id) => accessibleSections.find((section) => section.id === id))
            .filter((section): section is SettingsSectionItem => Boolean(section))

          if (sections.length === 0) return null

          return (
            <section key={group.id} className="space-y-2">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold tracking-[-0.01em]">{group.title}</h3>
                <p className="text-sm text-muted-foreground">{group.description}</p>
              </div>
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {sections.map((section) => {
                      const Icon = iconMap[section.icon] || User

                      return (
                        <button
                          key={section.id}
                          type="button"
                          className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                          onClick={() => setActiveSection(section.id)}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">{section.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
                              {section.description}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                            <span className="hidden sm:inline">{t("settings.configure")}</span>
                            <ChevronRight className="h-4 w-4" />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </section>
          )
        })}
      </div>

      {!isAdmin() && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              {t("settings.restricted")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

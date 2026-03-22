"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { cn } from "@/lib/utils"
import { useRBAC } from "@/lib/rbac-context"
import { settingsSections } from "@/lib/rbac-defaults"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  BookMarked
} from "lucide-react"
import { UserManagement } from "./user-management"
import { RoleManagement } from "./role-management"
import { AuditLog } from "./audit-log"
import { ProfileSettings } from "./profile-settings"
import { UnifiedFormConfigSettings } from "./unified-form-config-settings"
import { UserCustomFields } from "./user-custom-fields"

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  user: User,
  bell: Bell,
  palette: Palette,
  users: Users,
  shield: Shield,
  scroll: ScrollText,
  settings2: Settings2,
  bookmarked: BookMarked,
}

interface SettingsModuleProps {
  className?: string
}

export function SettingsModule({ className }: SettingsModuleProps) {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const { checkPermission, isAdmin } = useRBAC()

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
      default:
        return null
    }
  }

  if (activeSection) {
    const section = settingsSections.find(s => s.id === activeSection)
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => setActiveSection(null)}
            className="gap-2"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
            {t("settings.backToSettings")}
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{section?.title}</h2>
            <p className="text-sm text-muted-foreground">{section?.description}</p>
          </div>
        </div>
        {renderSectionContent()}
      </div>
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center justify-between">
        {/*<div>
          <h2 className="text-2xl font-bold">Settings</h2>
          <p className="text-muted-foreground">
            Manage your account and system configuration
          </p>
        </div>*/}
        {isAdmin() && (
          <Badge variant="outline" className="gap-1 border-primary text-primary">
            <Shield className="h-3 w-3" />
            {t("settings.adminAccess")}
          </Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {settingsSections.map((section) => {
          const Icon = iconMap[section.icon] || User
          const result = checkPermission(section.requiredPermission, section.requiredAction)
          const hasAccess = result.allowed

          if (!hasAccess) return null

          return (
            <Card
              key={section.id}
              className="cursor-pointer transition-all hover:border-primary/50"
              onClick={() => setActiveSection(section.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <CardTitle className="text-base mt-3">{section.title}</CardTitle>
                <CardDescription className="text-sm">
                  {section.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button variant="ghost" className="w-full justify-between" size="sm">
                  {t("settings.configure")}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
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

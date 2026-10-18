"use client"

import { useState } from "react"
import { useRBAC } from "@/lib/rbac-context"
import { useErpSession } from "@lumiere/erp-session"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import { useUpdateUserProfile } from "@lumiere/query-hooks/hooks/auth"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  User,
  Mail,
  Building,
  Moon,
  Sun,
  Monitor,
  Globe,
  Palette,
  Sparkles,
  LayoutTemplate,
  Circle,
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"
import { toast } from "sonner"
import { useTheme } from "../components/theme-provider"
import { cn } from "../lib/utils"

interface ProfileSettingsProps {
  section: "profile" | "notifications" | "appearance"
}

export function ProfileSettings({ section }: ProfileSettingsProps) {
  const { t } = useTranslation()
  const { currentUser } = useRBAC()
  const { theme, setTheme, palette, setPalette, shell, setShell } = useTheme()
  const { organizationId } = useErpSession()
  const orgBigInt = hasValidOrganizationId(organizationId) ? BigInt(organizationId) : 0n
  const updateProfile = useUpdateUserProfile(orgBigInt)
  const [name, setName] = useState(currentUser?.name ?? "")
  const [timezone, setTimezone] = useState<string | undefined>(undefined)

  const saveProfile = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    updateProfile.mutate(
      { name: trimmed, ...(timezone ? { timezone } : {}) },
      {
        onSuccess: () => toast.success(t("settings.profile.saveSuccess")),
        onError: () => toast.error(t("settings.profile.saveError")),
      },
    )
  }

  if (section === "profile") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.personalInfo")}</CardTitle>
            <CardDescription>{t("settings.profile.personalInfoDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-medium">
                {currentUser?.name?.split(" ").map(n => n[0]).join("")}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("settings.profile.managedByProvider")}
                </p>
              </div>
            </div>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  {t("settings.profile.fullName")}
                </Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {t("settings.profile.email")}
                </Label>
                <Input id="email" type="email" value={currentUser?.email ?? ""} readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department" className="flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  {t("settings.profile.department")}
                </Label>
                <Input id="department" value={currentUser?.department ?? ""} readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone" className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  {t("settings.profile.timezone")}
                </Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("settings.profile.timezone")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="utc-8">{t("settings.profile.timezones.pacific")}</SelectItem>
                    <SelectItem value="utc-5">{t("settings.profile.timezones.eastern")}</SelectItem>
                    <SelectItem value="utc">{t("settings.profile.timezones.utc")}</SelectItem>
                    <SelectItem value="utc+1">{t("settings.profile.timezones.centralEuropean")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveProfile} disabled={updateProfile.isPending || !name.trim()}>{t("settings.profile.saveChanges")}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.security")}</CardTitle>
            <CardDescription>{t("settings.profile.securityDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("settings.profile.managedByProvider")}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (section === "notifications") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.profile.emailNotifications")}</CardTitle>
          <CardDescription>{t("settings.profile.notificationsUnavailable")}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (section === "appearance") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.theme")}</CardTitle>
            <CardDescription>{t("settings.profile.themeDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {[
                { id: "light" as const, label: t("settings.profile.themes.light"), icon: Sun },
                { id: "dark" as const, label: t("settings.profile.themes.dark"), icon: Moon },
                { id: "system" as const, label: t("settings.profile.themes.system"), icon: Monitor },
              ].map((opt) => {
                const Icon = opt.icon
                const active = theme === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTheme(opt.id)}
                    className={cn(
                      "p-4 rounded-lg border-2 transition-colors text-center",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <Icon className="h-6 w-6 mx-auto mb-2" />
                    <p className="text-sm font-medium">{opt.label}</p>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.palette")}</CardTitle>
            <CardDescription>{t("settings.profile.paletteDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
              {[
                { id: "default" as const, label: t("settings.profile.palettes.default"), icon: Circle },
                { id: "ocean" as const, label: t("settings.profile.palettes.ocean"), icon: Palette },
              ].map((opt) => {
                const Icon = opt.icon
                const active = palette === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPalette(opt.id)}
                    className={cn(
                      "p-4 rounded-lg border-2 transition-colors text-center",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <Icon className="h-6 w-6 mx-auto mb-2" />
                    <p className="text-sm font-medium">{opt.label}</p>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.shell")}</CardTitle>
            <CardDescription>{t("settings.profile.shellDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {[
                { id: "default" as const, label: t("settings.profile.shells.default"), icon: LayoutTemplate },
                { id: "css-art" as const, label: t("settings.profile.shells.cssArt"), icon: Sparkles },
              ].map((opt) => {
                const Icon = opt.icon
                const active = shell === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setShell(opt.id)}
                    className={cn(
                      "p-4 rounded-lg border-2 transition-colors text-center",
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <Icon className="h-6 w-6 mx-auto mb-2" />
                    <p className="text-sm font-medium">{opt.label}</p>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return null
}

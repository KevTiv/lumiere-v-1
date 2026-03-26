"use client"

import { useRBAC } from "@/lib/rbac-context"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
  Bell, 
  Moon, 
  Sun,
  Monitor,
  Globe
} from "lucide-react"
import { useTranslation } from "@lumiere/i18n"

interface ProfileSettingsProps {
  section: "profile" | "notifications" | "appearance"
}

export function ProfileSettings({ section }: ProfileSettingsProps) {
  const { t } = useTranslation()
  const { currentUser } = useRBAC()

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
                {currentUser?.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div>
                <Button variant="outline" size="sm">{t("settings.profile.changeAvatar")}</Button>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("settings.profile.avatarHint")}
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
                <Input id="name" defaultValue={currentUser?.name} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {t("settings.profile.email")}
                </Label>
                <Input id="email" type="email" defaultValue={currentUser?.email} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department" className="flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  {t("settings.profile.department")}
                </Label>
                <Input id="department" defaultValue={currentUser?.department} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone" className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  {t("settings.profile.timezone")}
                </Label>
                <Select defaultValue="utc-5">
                  <SelectTrigger>
                    <SelectValue />
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
              <Button>{t("settings.profile.saveChanges")}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.security")}</CardTitle>
            <CardDescription>{t("settings.profile.securityDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="current-password">{t("settings.profile.currentPassword")}</Label>
                <Input id="current-password" type="password" />
              </div>
              <div></div>
              <div className="space-y-2">
                <Label htmlFor="new-password">{t("settings.profile.newPassword")}</Label>
                <Input id="new-password" type="password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">{t("settings.profile.confirmPassword")}</Label>
                <Input id="confirm-password" type="password" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline">{t("settings.profile.updatePassword")}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (section === "notifications") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-5 w-5" />
              {t("settings.profile.emailNotifications")}
            </CardTitle>
            <CardDescription>{t("settings.profile.emailNotificationsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { id: "orders", label: t("settings.profile.emailItems.orders.label"), description: t("settings.profile.emailItems.orders.description") },
              { id: "inventory", label: t("settings.profile.emailItems.inventory.label"), description: t("settings.profile.emailItems.inventory.description") },
              { id: "reports", label: t("settings.profile.emailItems.reports.label"), description: t("settings.profile.emailItems.reports.description") },
              { id: "security", label: t("settings.profile.emailItems.security.label"), description: t("settings.profile.emailItems.security.description") },
            ].map(item => (
              <div key={item.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium text-sm">{item.label}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
                <Switch defaultChecked={item.id === "security"} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.inAppNotifications")}</CardTitle>
            <CardDescription>{t("settings.profile.inAppNotificationsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { id: "push", label: t("settings.profile.inAppItems.push.label"), description: t("settings.profile.inAppItems.push.description") },
              { id: "sound", label: t("settings.profile.inAppItems.sound.label"), description: t("settings.profile.inAppItems.sound.description") },
              { id: "badge", label: t("settings.profile.inAppItems.badge.label"), description: t("settings.profile.inAppItems.badge.description") },
            ].map(item => (
              <div key={item.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium text-sm">{item.label}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
                <Switch defaultChecked={item.id === "badge"} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
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
                { id: "light", label: t("settings.profile.themes.light"), icon: Sun },
                { id: "dark", label: t("settings.profile.themes.dark"), icon: Moon },
                { id: "system", label: t("settings.profile.themes.system"), icon: Monitor },
              ].map(theme => {
                const Icon = theme.icon
                return (
                  <button
                    key={theme.id}
                    className={`p-4 rounded-lg border-2 transition-colors ${
                      theme.id === "dark" 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <Icon className="h-6 w-6 mx-auto mb-2" />
                    <p className="text-sm font-medium">{theme.label}</p>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.dashboardLayout")}</CardTitle>
            <CardDescription>{t("settings.profile.dashboardLayoutDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">{t("settings.profile.layout.compactMode.label")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.profile.layout.compactMode.description")}</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">{t("settings.profile.layout.sidebarCollapsed.label")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.profile.layout.sidebarCollapsed.description")}</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">{t("settings.profile.layout.showQuickActions.label")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.profile.layout.showQuickActions.description")}</p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.accessibility")}</CardTitle>
            <CardDescription>{t("settings.profile.accessibilityDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">{t("settings.profile.a11y.reduceMotion.label")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.profile.a11y.reduceMotion.description")}</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">{t("settings.profile.a11y.highContrast.label")}</p>
                <p className="text-sm text-muted-foreground">{t("settings.profile.a11y.highContrast.description")}</p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return null
}

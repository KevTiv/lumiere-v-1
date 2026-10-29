"use client"

import { useState } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useCurrentUserProfile, useUpdateUserProfile } from "@lumiere/query-hooks/hooks/auth"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"


import {
  Bell,
  Moon,
  Sun,
  Monitor,
  Palette,
  Sparkles,
  LayoutTemplate,
  Circle,
} from "lucide-react"
import { useTranslation, languageOptions, languagePreference, profileLanguage, type DisplayLanguage, type LoanwordLanguage } from "@lumiere/i18n"
import { useTheme } from "../components/theme-provider"
import { cn } from "../lib/utils"

interface ProfileSettingsProps {
  section: "profile" | "notifications" | "appearance"
}

function ProfileLanguageFields({ value }: { value?: string }) {
  const { t } = useTranslation()
  const preference = languagePreference(value)
  const [language, setLanguage] = useState<DisplayLanguage>(preference.language)
  const [loanwords, setLoanwords] = useState<LoanwordLanguage>(preference.loanwords)
  return (
    <>
      <input type="hidden" name="language" value={profileLanguage(language, loanwords)} />
      <div className="space-y-2">
        <Label htmlFor="profile-language">{t("settings.profile.language")}</Label>
        <Select value={language} onValueChange={value => setLanguage(value as DisplayLanguage)}>
          <SelectTrigger id="profile-language" aria-describedby="profile-language-hint"><SelectValue /></SelectTrigger>
          <SelectContent>{languageOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <p id="profile-language-hint" className="text-sm text-muted-foreground">{t("settings.profile.languageHint")}</p>
      </div>
      {language === "rw" && <div className="space-y-2">
        <Label htmlFor="profile-loanwords">{t("settings.profile.loanwords")}</Label>
        <Select value={loanwords} onValueChange={value => setLoanwords(value as LoanwordLanguage)}>
          <SelectTrigger id="profile-loanwords" aria-describedby="profile-loanwords-hint"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="fr">Français</SelectItem></SelectContent>
        </Select>
        <p id="profile-loanwords-hint" className="text-sm text-muted-foreground">{t("settings.profile.loanwordsHint")}</p>
      </div>}
      {language === "sw" && <p className="text-sm text-muted-foreground">{t("settings.profile.swahiliLoanwordsHint")}</p>}
    </>
  )
}

export function ProfileSettings({ section }: ProfileSettingsProps) {
  const { t } = useTranslation()
  const { theme, setTheme, palette, setPalette, shell, setShell } = useTheme()
  const { organizationId } = useErpSession()
  const { data: profile, isLoading } = useCurrentUserProfile(section === 'profile')
  const saveProfile = useUpdateUserProfile(BigInt(organizationId ?? 0))
  const [profileError, setProfileError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (section === "profile") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.personalInfo")}</CardTitle>
            <CardDescription>{t("settings.profile.personalInfoDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? <p role="status">{t("settings.profile.loading")}</p> : profile ? (
              <form key={`${profile.name}:${profile.timezone}:${profile.language}`} className="space-y-4" onSubmit={async event => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                setProfileError(null)
                setSaved(false)
                try {
                  await saveProfile.mutateAsync({
                    name: String(form.get('name') ?? '').trim(),
                    firstName: String(form.get('firstName') ?? '').trim(),
                    lastName: String(form.get('lastName') ?? '').trim(),
                    timezone: String(form.get('timezone') ?? 'UTC'),
                    language: String(form.get('language') ?? 'en'),
                  })
                  setSaved(true)
                } catch (error) { setProfileError(error instanceof Error ? error.message : t("settings.profile.saveError")) }
              }}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="profile-name">{t('settings.profile.fullName')}</Label><Input id="profile-name" name="name" defaultValue={profile.name} required /></div>
                  <div className="space-y-2"><Label htmlFor="profile-email">{t('settings.profile.email')}</Label><Input id="profile-email" type="email" value={profile.email} readOnly /></div>
                  <div className="space-y-2"><Label htmlFor="profile-first-name">{t("settings.profile.firstName")}</Label><Input id="profile-first-name" name="firstName" defaultValue={profile.firstName ?? ''} /></div>
                  <div className="space-y-2"><Label htmlFor="profile-last-name">{t("settings.profile.lastName")}</Label><Input id="profile-last-name" name="lastName" defaultValue={profile.lastName ?? ''} /></div>
                  <div className="space-y-2"><Label htmlFor="profile-timezone">{t('settings.profile.timezone')}</Label><Input id="profile-timezone" name="timezone" defaultValue={profile.timezone ?? 'UTC'} required /></div>
                  <ProfileLanguageFields value={profile.language} />
                </div>
                <p className="text-sm text-muted-foreground">{t("settings.profile.emailVerificationHint")}</p>
                {profileError && <p role="alert" className="text-sm text-destructive">{profileError}</p>}
                {saved && <p role="status" className="text-sm">{t("settings.profile.saveSuccess")}</p>}
                <div className="flex justify-end"><Button type="submit" disabled={saveProfile.isPending}>{t('settings.profile.saveChanges')}</Button></div>
              </form>
            ) : <p role="alert">{t("settings.profile.loadError")}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("settings.profile.security")}</CardTitle>
            <CardDescription>{t("settings.profile.securityDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("settings.profile.securityProviderHint")}</p>
            <a href="/forgot-password" className={buttonVariants({ variant: "outline" })}>{t("settings.profile.manageSecurity")}</a>
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

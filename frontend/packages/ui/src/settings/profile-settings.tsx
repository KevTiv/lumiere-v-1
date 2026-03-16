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

interface ProfileSettingsProps {
  section: "profile" | "notifications" | "appearance"
}

export function ProfileSettings({ section }: ProfileSettingsProps) {
  const { currentUser } = useRBAC()

  if (section === "profile") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personal Information</CardTitle>
            <CardDescription>Update your personal details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-medium">
                {currentUser?.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div>
                <Button variant="outline" size="sm">Change Avatar</Button>
                <p className="text-xs text-muted-foreground mt-1">
                  JPG, PNG or GIF. Max 2MB.
                </p>
              </div>
            </div>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Full Name
                </Label>
                <Input id="name" defaultValue={currentUser?.name} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email
                </Label>
                <Input id="email" type="email" defaultValue={currentUser?.email} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department" className="flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  Department
                </Label>
                <Input id="department" defaultValue={currentUser?.department} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone" className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Timezone
                </Label>
                <Select defaultValue="utc-5">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="utc-8">Pacific Time (UTC-8)</SelectItem>
                    <SelectItem value="utc-5">Eastern Time (UTC-5)</SelectItem>
                    <SelectItem value="utc">UTC</SelectItem>
                    <SelectItem value="utc+1">Central European (UTC+1)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button>Save Changes</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Security</CardTitle>
            <CardDescription>Manage your password and security settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input id="current-password" type="password" />
              </div>
              <div></div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input id="new-password" type="password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input id="confirm-password" type="password" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline">Update Password</Button>
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
              Email Notifications
            </CardTitle>
            <CardDescription>Choose what updates you receive via email</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { id: "orders", label: "New Orders", description: "Get notified when new orders are placed" },
              { id: "inventory", label: "Low Stock Alerts", description: "Alert when products are running low" },
              { id: "reports", label: "Weekly Reports", description: "Receive weekly performance summaries" },
              { id: "security", label: "Security Alerts", description: "Important security notifications" },
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
            <CardTitle className="text-base">In-App Notifications</CardTitle>
            <CardDescription>Configure dashboard notification preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { id: "push", label: "Push Notifications", description: "Browser push notifications" },
              { id: "sound", label: "Sound", description: "Play sound for new notifications" },
              { id: "badge", label: "Badge Count", description: "Show unread count on icon" },
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
            <CardTitle className="text-base">Theme</CardTitle>
            <CardDescription>Select your preferred color theme</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {[
                { id: "light", label: "Light", icon: Sun },
                { id: "dark", label: "Dark", icon: Moon },
                { id: "system", label: "System", icon: Monitor },
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
            <CardTitle className="text-base">Dashboard Layout</CardTitle>
            <CardDescription>Customize your dashboard experience</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">Compact Mode</p>
                <p className="text-sm text-muted-foreground">Reduce spacing between elements</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">Sidebar Collapsed</p>
                <p className="text-sm text-muted-foreground">Start with sidebar collapsed</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">Show Quick Actions</p>
                <p className="text-sm text-muted-foreground">Display quick action buttons on dashboard</p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accessibility</CardTitle>
            <CardDescription>Adjust accessibility options</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">Reduce Motion</p>
                <p className="text-sm text-muted-foreground">Minimize animations</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-sm">High Contrast</p>
                <p className="text-sm text-muted-foreground">Increase color contrast</p>
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

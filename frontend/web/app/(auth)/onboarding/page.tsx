"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useStdbConnection, getStdbConnection } from "@lumiere/stdb"

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Dubai", "Australia/Sydney",
]

export default function OnboardingPage() {
  const router = useRouter()
  const { connected } = useStdbConnection()
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [timezone, setTimezone] = useState("UTC")
  const [currency, setCurrency] = useState("USD")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!connected) {
      setError("Not connected to server. Please wait a moment and try again.")
      return
    }
    setError(null)
    setLoading(true)
    try {
      const conn = getStdbConnection()
      if (!conn) throw new Error("No connection")
      conn.reducers.createOrganization({
        params: {
          name,
          code,
          timezone,
          dateFormat: "YYYY-MM-DD",
          language: "en",
          isActive: true,
          description: undefined,
          logoUrl: undefined,
          website: undefined,
          email: undefined,
          phone: undefined,
          currencyId: undefined,
          metadata: undefined,
        },
      })
      router.push("/overview")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6 space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Set up your organization</h2>
        <p className="text-sm text-muted-foreground">
          You are the first user — create your organization to get started.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="name" className="text-sm font-medium">Organization name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Acme Inc."
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="code" className="text-sm font-medium">Short code</label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
            required
            pattern="[A-Z0-9]+"
            maxLength={8}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="ACME"
          />
          <p className="text-xs text-muted-foreground">Uppercase letters and numbers, max 8 characters</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="timezone" className="text-sm font-medium">Timezone</label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="currency" className="text-sm font-medium">Currency</label>
            <select
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British Pound</option>
              <option value="CAD">CAD — Canadian Dollar</option>
              <option value="AUD">AUD — Australian Dollar</option>
              <option value="JPY">JPY — Japanese Yen</option>
            </select>
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {!connected && (
          <p className="text-sm text-muted-foreground">Connecting to server…</p>
        )}

        <button
          type="submit"
          disabled={loading || !connected}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary text-primary-foreground shadow h-9 px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Creating…" : "Create organization"}
        </button>
      </form>
    </div>
  )
}

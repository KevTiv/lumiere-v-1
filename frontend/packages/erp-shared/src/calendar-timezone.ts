/** The account setting owns calendar display; only a missing/unusable setting falls back. */
export function validCalendarTimezone(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value.trim())) return null
  try { return new Intl.DateTimeFormat("en", { timeZone: value.trim() }).resolvedOptions().timeZone }
  catch { return null }
}

export function resolveCalendarTimezone(account: unknown, browser: unknown) {
  const saved = validCalendarTimezone(account)
  if (saved) return { timeZone: saved, source: "account" as const, invalidAccount: false }
  const local = validCalendarTimezone(browser)
  return { timeZone: local ?? "UTC", source: local ? "browser" as const : "utc" as const, invalidAccount: typeof account === "string" && account.trim() !== "" }
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string) {
  let value = formatters.get(timeZone)
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    formatters.set(timeZone, value)
  }
  return value
}

export function zonedCalendarParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]))
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) }
}

export function zonedCalendarDay(date: Date, timeZone: string): string {
  const p = zonedCalendarParts(date, timeZone)
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

export function zonedCalendarInput(date: Date, timeZone: string): string {
  const p = zonedCalendarParts(date, timeZone)
  return `${zonedCalendarDay(date, timeZone)}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
}

function utcWallTime(p: ReturnType<typeof zonedCalendarParts>): number {
  const date = new Date(0)
  date.setUTCFullYear(p.year, p.month - 1, p.day)
  date.setUTCHours(p.hour, p.minute, p.second, 0)
  return date.getTime()
}

/** Explicit-zone wall time. Gaps reject; repeated times choose the earlier occurrence. */
export function parseZonedCalendarInput(value: string, timeZone: string, original?: Date): Date | null {
  if (!validCalendarTimezone(timeZone)) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return null
  const p = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0) }
  const wall = utcWallTime(p)
  const check = new Date(wall)
  if (p.year < 1 || check.getUTCFullYear() !== p.year || check.getUTCMonth() + 1 !== p.month || check.getUTCDate() !== p.day || p.hour > 23 || p.minute > 59 || p.second > 59) return null
  // Never move an unchanged event from the later repeated hour to the earlier one.
  if (original && Number.isFinite(original.getTime()) && zonedCalendarInput(original, timeZone) === value.slice(0, 16) && (!match[6] || zonedCalendarParts(original, timeZone).second === p.second)) return new Date(original)
  const offsets = new Set<number>()
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = wall + hours * 3_600_000
    offsets.add(utcWallTime(zonedCalendarParts(new Date(sample), timeZone)) - sample)
  }
  const matches = [...offsets].map((offset) => new Date(wall - offset)).filter((date) => {
    const actual = zonedCalendarParts(date, timeZone)
    return Object.keys(p).every((key) => actual[key as keyof typeof p] === p[key as keyof typeof p])
  }).sort((a, b) => a.getTime() - b.getTime())
  return matches[0] ?? null
}

/** First valid wall time on a date, including zones whose DST change skips midnight. */
export function zonedCalendarDayStart(day: string, timeZone: string): Date | null {
  for (let minute = 0; minute < 24 * 60; minute += 30) {
    const result = parseZonedCalendarInput(`${day}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, timeZone)
    if (result) return result
  }
  return null
}

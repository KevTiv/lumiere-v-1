"use client"

import * as React from "react"
import { addDays, endOfMonth, format, isValid, startOfDay } from "date-fns"
import { ptBR } from "date-fns/locale/pt-BR"
import { CalendarIcon } from "lucide-react"
import { useTranslation } from "@lumiere/i18n"

import { cn } from "@lumiere/ui/lib/utils"
import { Button } from "@lumiere/ui/components/button"
import { Calendar } from "@lumiere/ui/components/calendar"
import { Input } from "@lumiere/ui/components/input"
import { Popover, PopoverContent, PopoverTrigger } from "@lumiere/ui/components/popover"
import { Drawer, DrawerContent, DrawerTitle } from "@lumiere/ui/components/drawer"

/*
 * Value contract: `YYYY-MM-DD` (DatePicker) and `YYYY-MM-DDTHH:mm`
 * (DateTimePicker), exactly like the native inputs they replace. An empty
 * string means "no date".
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/

/** Local calendar date for a `YYYY-MM-DD` string, or undefined when invalid. */
export function fromIsoDate(value: string | undefined | null): Date | undefined {
  const match = ISO_DATE.exec(value ?? "")
  if (!match) return undefined
  return buildDate(Number(match[1]), Number(match[2]), Number(match[3]))
}

export function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

function buildDate(year: number, month: number, day: number): Date | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const date = new Date(year, month - 1, day)
  if (!isValid(date) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined
  }
  return date
}

type PartOrder = Array<"day" | "month" | "year">

function numericPartOrder(locale: string): PartOrder {
  try {
    const parts = new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(2001, 10, 22))
      .map((part) => part.type)
      .filter((type): type is PartOrder[number] => type === "day" || type === "month" || type === "year")
    if (parts.length === 3) return parts
  } catch {
    // Unknown locale: fall through to month/day/year.
  }
  return ["month", "day", "year"]
}

/** Placeholder such as `MM/DD/YYYY` or `DD/MM/YYYY` for the active locale. */
export function datePlaceholder(locale: string): string {
  const labels = { day: "DD", month: "MM", year: "YYYY" }
  return numericPartOrder(locale).map((part) => labels[part]).join("/")
}

/**
 * Parse what a person typed into a `YYYY-MM-DD` string. Returns `""` for an
 * empty entry and `null` when the text is not (yet) a valid date. Accepts ISO
 * dates, numeric dates in the locale's order (`/`, `.`, `-` or space
 * separated) and, with `allowShortYear`, two-digit years.
 */
export function parseTypedDate(
  text: string,
  locale: string,
  { allowShortYear = true }: { allowShortYear?: boolean } = {},
): string | null {
  const trimmed = text.trim()
  if (!trimmed) return ""

  const iso = ISO_DATE.exec(trimmed) ?? ISO_DATE_TIME.exec(trimmed)?.[1]?.match(ISO_DATE)
  if (iso) {
    const date = buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return date ? toIsoDate(date) : null
  }

  const numeric = /^(\d{1,4})[./\-\s]+(\d{1,2})[./\-\s]+(\d{1,4})$/.exec(trimmed)
  if (numeric) {
    const [, a, b, c] = numeric
    let order = numericPartOrder(locale)
    if (a.length === 4) order = ["year", "month", "day"]
    const values: Record<string, string> = {}
    order.forEach((part, index) => {
      values[part] = [a, b, c][index]
    })
    const yearText = values.year
    if (yearText.length !== 4 && !(allowShortYear && yearText.length === 2)) return null
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)
    const date = buildDate(year, Number(values.month), Number(values.day))
    return date ? toIsoDate(date) : null
  }

  // Written-out dates like the displayed "Oct 20, 2026".
  if (/[a-z]/i.test(trimmed) && /\d{4}/.test(trimmed)) {
    const parsed = new Date(trimmed)
    if (isValid(parsed)) return toIsoDate(parsed)
  }
  return null
}

export function formatDisplayDate(value: string, locale: string): string {
  const date = fromIsoDate(value)
  if (!date) return value
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date)
  } catch {
    return value
  }
}

function isOutOfRange(value: string, min?: string, max?: string): boolean {
  if (!value) return false
  return Boolean((min && value < min) || (max && value > max))
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(pointer: coarse)")
    const update = () => setCoarse(query.matches)
    update()
    query.addEventListener?.("change", update)
    return () => query.removeEventListener?.("change", update)
  }, [])
  return coarse
}

type InputProps = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "min" | "max" | "defaultValue">

export interface DatePickerProps extends InputProps {
  /** `YYYY-MM-DD`, or `""` for no date. */
  value: string
  onChange: (value: string) => void
  /** Earliest selectable date, `YYYY-MM-DD`. */
  min?: string
  /** Latest selectable date, `YYYY-MM-DD`. */
  max?: string
  /** Hide the Today / Tomorrow / +7 / +30 / End of month shortcuts. */
  hideShortcuts?: boolean
  /** Class for the wrapper around the input and calendar button. */
  containerClassName?: string
  /**
   * Called with `HH:mm` when a full `YYYY-MM-DDTHH:mm` value is typed or
   * pasted into the date field (used by DateTimePicker).
   */
  onTimeText?: (date: string, time: string) => void
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  hideShortcuts,
  containerClassName,
  className,
  disabled,
  readOnly,
  onTimeText,
  onBlur,
  onFocus,
  onKeyDown,
  placeholder,
  "aria-invalid": ariaInvalid,
  ...inputProps
}: DatePickerProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n?.language || "en"
  const coarse = useCoarsePointer()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const focusedRef = React.useRef(false)
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(() => formatDisplayDate(value ?? "", locale))
  const selected = fromIsoDate(value)
  const [month, setMonth] = React.useState<Date>(() => selected ?? new Date())

  React.useEffect(() => {
    if (!focusedRef.current) setDraft(formatDisplayDate(value ?? "", locale))
  }, [value, locale])

  const outOfRange = isOutOfRange(value, min, max)
  React.useEffect(() => {
    inputRef.current?.setCustomValidity(
      outOfRange ? t("ui.datePicker.outOfRange", { defaultValue: "Date is outside the allowed range" }) : "",
    )
  }, [outOfRange, t])

  const commit = (next: string) => {
    if (next !== value) onChange(next)
  }

  const choose = (next: string) => {
    commit(next)
    setDraft(formatDisplayDate(next, locale))
    const date = fromIsoDate(next)
    if (date) setMonth(date)
    setOpen(false)
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value
    setDraft(text)
    const dateTime = ISO_DATE_TIME.exec(text.trim())
    if (dateTime && onTimeText) {
      const date = parseTypedDate(dateTime[1], locale)
      if (date) onTimeText(date, dateTime[2])
    }
    // While typing, only commit unambiguous complete dates (four-digit year)
    // so intermediate keystrokes don't emit stray values.
    const parsed = parseTypedDate(text, locale, { allowShortYear: false })
    if (parsed !== null) {
      commit(parsed)
      const date = fromIsoDate(parsed)
      if (date) setMonth(date)
    }
  }

  const settleDraft = () => {
    const parsed = parseTypedDate(draft, locale)
    if (parsed === null) {
      // Unparseable text: fall back to the last committed date.
      setDraft(formatDisplayDate(value ?? "", locale))
      return
    }
    commit(parsed)
    setDraft(formatDisplayDate(parsed, locale))
  }

  const shortcuts = React.useMemo(() => {
    const today = startOfDay(new Date())
    return [
      { key: "today", label: t("ui.datePicker.today", { defaultValue: "Today" }), date: today },
      { key: "tomorrow", label: t("ui.datePicker.tomorrow", { defaultValue: "Tomorrow" }), date: addDays(today, 1) },
      { key: "plus7", label: t("ui.datePicker.plus7Days", { defaultValue: "+7 days" }), date: addDays(today, 7) },
      { key: "plus30", label: t("ui.datePicker.plus30Days", { defaultValue: "+30 days" }), date: addDays(today, 30) },
      { key: "endOfMonth", label: t("ui.datePicker.endOfMonth", { defaultValue: "End of month" }), date: startOfDay(endOfMonth(today)) },
    ]
    // Recompute when the panel opens so "today" is never stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, open])

  const minDate = fromIsoDate(min)
  const maxDate = fromIsoDate(max)
  const disabledDays = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ]
  const testId = (inputProps as { "data-testid"?: string })["data-testid"]
  const partTestId = (suffix: string) => (testId ? `${testId}-${suffix}` : undefined)

  const panel = (
    <div className={cn("flex flex-col gap-2", coarse && "items-center pb-4")}>
      <Calendar
        mode="single"
        selected={selected}
        month={month}
        onMonthChange={setMonth}
        onSelect={(date) => choose(date ? toIsoDate(date) : "")}
        disabled={disabledDays}
        startMonth={minDate}
        endMonth={maxDate}
        locale={locale.startsWith("pt") ? ptBR : undefined}
        autoFocus
        className={cn(coarse && "[--cell-size:--spacing(11)]")}
      />
      {hideShortcuts ? null : (
        <div className={cn("flex flex-wrap gap-1 border-t pt-2", coarse ? "px-4" : "px-1")}>
          {shortcuts.map((shortcut) => {
            const iso = toIsoDate(shortcut.date)
            return (
              <Button
                key={shortcut.key}
                type="button"
                variant="ghost"
                size={coarse ? "lg" : "sm"}
                className={cn(coarse && "min-h-11 px-3")}
                data-testid={partTestId(`shortcut-${shortcut.key}`)}
                disabled={isOutOfRange(iso, min, max)}
                onClick={() => choose(iso)}
              >
                {shortcut.label}
              </Button>
            )
          })}
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size={coarse ? "lg" : "sm"}
              className={cn("text-muted-foreground", coarse && "min-h-11 px-3")}
              data-testid={partTestId("clear")}
              onClick={() => choose("")}
            >
              {t("ui.datePicker.clear", { defaultValue: "Clear" })}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )

  const openLabel = t("ui.datePicker.openCalendar", { defaultValue: "Open calendar" })
  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={openLabel}
      data-testid={partTestId("calendar")}
      disabled={disabled || readOnly}
      className={cn("absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground", coarse && "size-9")}
      onClick={coarse ? () => setOpen(true) : undefined}
    >
      <CalendarIcon />
    </Button>
  )

  return (
    <div className={cn("relative w-full", containerClassName)} data-slot="date-picker">
      <Input
        {...inputProps}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        data-slot="date-picker-input"
        value={draft}
        placeholder={placeholder ?? datePlaceholder(locale)}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={ariaInvalid || outOfRange || undefined}
        className={cn("pr-10", className)}
        onChange={handleChange}
        onFocus={(event) => {
          focusedRef.current = true
          event.currentTarget.select()
          onFocus?.(event)
        }}
        onBlur={(event) => {
          focusedRef.current = false
          settleDraft()
          onBlur?.(event)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") settleDraft()
          if (event.key === "ArrowDown" && event.altKey) {
            event.preventDefault()
            setOpen(true)
          }
          onKeyDown?.(event)
        }}
      />
      {coarse ? (
        <>
          {triggerButton}
          <Drawer open={open} onOpenChange={setOpen}>
            <DrawerContent>
              <DrawerTitle className="sr-only">{openLabel}</DrawerTitle>
              {panel}
            </DrawerContent>
          </Drawer>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={triggerButton} />
          <PopoverContent className="w-auto p-1" align="end">
            {panel}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

export interface DateTimePickerProps extends Omit<DatePickerProps, "value" | "onChange" | "min" | "max" | "onTimeText"> {
  /** `YYYY-MM-DDTHH:mm`, or `""` for no value. */
  value: string
  onChange: (value: string) => void
  /** Earliest allowed value, `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (date part is used). */
  min?: string
  max?: string
}

function splitDateTime(value: string): { date: string; time: string } {
  const match = ISO_DATE_TIME.exec(value ?? "")
  if (match) return { date: match[1], time: match[2] }
  return { date: fromIsoDate(value) ? value : "", time: "" }
}

export function DateTimePicker({ value, onChange, min, max, disabled, readOnly, required, containerClassName, ...props }: DateTimePickerProps) {
  const { t } = useTranslation()
  const parts = splitDateTime(value)
  // Keep a time typed before a date is chosen, since the value stays empty
  // until there is a date.
  const [pendingTime, setPendingTime] = React.useState(parts.time)
  const timeRef = React.useRef(parts.time)
  React.useEffect(() => {
    if (parts.time) {
      timeRef.current = parts.time
      setPendingTime(parts.time)
    }
  }, [parts.time])
  const time = parts.time || pendingTime

  const setTime = (next: string) => {
    timeRef.current = next
    setPendingTime(next)
  }
  const emit = (date: string, nextTime: string) => {
    const next = date ? `${date}T${nextTime || "00:00"}` : ""
    if (next !== value) onChange(next)
  }
  const testId = (props as { "data-testid"?: string })["data-testid"]

  return (
    <div className={cn("flex w-full gap-2", containerClassName)} data-slot="date-time-picker">
      <DatePicker
        {...props}
        value={parts.date}
        min={min?.slice(0, 10)}
        max={max?.slice(0, 10)}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        containerClassName="min-w-0 flex-1"
        onTimeText={(date, typed) => {
          setTime(typed)
          emit(date, typed)
        }}
        onChange={(date) => emit(date, timeRef.current)}
      />
      <Input
        type="time"
        aria-label={t("ui.datePicker.time", { defaultValue: "Time" })}
        data-testid={testId ? `${testId}-time` : undefined}
        value={time}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-invalid={props["aria-invalid"]}
        className={cn("w-32 shrink-0", props.className)}
        onChange={(event) => {
          setTime(event.target.value)
          if (parts.date) emit(parts.date, event.target.value)
        }}
      />
    </div>
  )
}

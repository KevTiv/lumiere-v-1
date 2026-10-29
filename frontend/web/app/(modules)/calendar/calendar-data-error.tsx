"use client"

import { useTranslation } from "@lumiere/i18n"

export function CalendarDataError({ status, message }: { status: "denied" | "unavailable"; message?: string }) {
  const { t } = useTranslation()
  return <main className="p-6" role="alert">{status === "denied" ? t("calendar.dataAccessDenied") : t("calendar.dataUnavailable")}{message ? `: ${message}` : ""}</main>
}

"use client"

import { useTranslation } from "@lumiere/i18n"

export function ProposalDataError({ status, message }: { status: "denied" | "unavailable"; message?: string }) {
  const { t } = useTranslation()
  return <main className="p-6" role="alert">{status === "denied" ? t("proposals.dataAccessDenied") : t("proposals.dataUnavailable")}{message ? `: ${message}` : ""}</main>
}

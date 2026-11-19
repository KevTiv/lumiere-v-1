"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { RefreshCw } from "lucide-react"
import { Button } from "@lumiere/ui"
import { Alert, AlertDescription } from "@lumiere/ui/components/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@lumiere/ui/components/card"
import { Skeleton } from "@lumiere/ui/components/skeleton"

import { mapRagOutcomes, percent, type RagOutcomesView } from "./rag-outcomes"

type OutcomesState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "ready"; view: RagOutcomesView }

/** Seven-day withhold rate by reason and model. Counts and closed vocabulary only. */
export function RagOutcomesPanel({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<OutcomesState>({ status: "loading" })

  const load = useCallback(async () => {
    const parsed = Number(companyId)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return
    setState({ status: "loading" })
    try {
      const response = await fetch("/api/ai/evidence/rag-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: parsed }),
      })
      if (response.status === 401 || response.status === 403) {
        setState({ status: "denied" })
        return
      }
      const view = response.ok ? mapRagOutcomes(await response.json().catch(() => null)) : null
      setState(view ? { status: "ready", view } : { status: "error", message: t("aiHarness.ragOutcomes.errors.loadFailed") })
    } catch {
      setState({ status: "error", message: t("aiHarness.ragOutcomes.errors.unavailable") })
    }
  }, [companyId, t])

  useEffect(() => {
    void load()
  }, [load])

  const modelName = (model: string | null) => model ?? t("aiHarness.ragOutcomes.unknownModel")

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("aiHarness.ragOutcomes.title")}</CardTitle>
        <CardDescription>{t("aiHarness.ragOutcomes.description", { days: 7 })}</CardDescription>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={state.status === "loading"}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("aiHarness.ragOutcomes.refresh")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.status === "loading" ? <Skeleton className="h-16 w-full" /> : null}
        {state.status === "denied" ? (
          <Alert><AlertDescription>{t("aiHarness.ragOutcomes.errors.denied")}</AlertDescription></Alert>
        ) : null}
        {state.status === "error" ? (
          <Alert variant="destructive"><AlertDescription>{state.message}</AlertDescription></Alert>
        ) : null}
        {state.status === "ready" ? (
          <>
            <p className="text-sm font-medium">
              {t("aiHarness.ragOutcomes.summary", { withheld: state.view.withheld, turns: state.view.turns, rate: percent(state.view.withholdRate) })}
            </p>
            {state.view.truncated ? <p className="text-xs text-muted-foreground">{t("aiHarness.ragOutcomes.truncated")}</p> : null}
            {state.view.turns === 0 ? (
              <p className="text-sm text-muted-foreground">{t("aiHarness.ragOutcomes.empty")}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col">{t("aiHarness.ragOutcomes.model")}</th>
                    <th scope="col">{t("aiHarness.ragOutcomes.reason")}</th>
                    <th scope="col">{t("aiHarness.ragOutcomes.withheld")}</th>
                    <th scope="col">{t("aiHarness.ragOutcomes.rate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.view.byReasonAndModel.map((cell) => (
                    <tr key={`${cell.provider}/${cell.model}/${cell.reason}`}>
                      <td>{modelName(cell.model)}</td>
                      <td>{t(`aiHarness.ragOutcomes.reasons.${cell.reason}`)}</td>
                      <td>{cell.withheld}</td>
                      <td>{percent(cell.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

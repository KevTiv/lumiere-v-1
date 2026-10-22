"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "../components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table"
import type { ModuleDataState } from "../lib/module-data-state"
import {
  savedAssetSchedule,
  type SavedDepreciationLine,
  type ScheduleAsset,
} from "./asset-depreciation-schedule-model"

export interface AssetDepreciationScheduleProps {
  readonly asset: ScheduleAsset
  readonly lines: readonly SavedDepreciationLine[]
  readonly companyId: bigint
  readonly dataState: ModuleDataState
  readonly currencyLabel?: string
  readonly onGenerate?: () => Promise<unknown>
  readonly onRefresh?: () => unknown
  readonly generationPending?: boolean
}

export function AssetDepreciationSchedule({
  asset,
  lines,
  companyId,
  dataState,
  currencyLabel,
  onGenerate,
  onRefresh,
  generationPending = false,
}: AssetDepreciationScheduleProps) {
  const { t } = useTranslation()
  const [generating, setGenerating] = useState(false)
  const [generationConfirmed, setGenerationConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const schedule =
    dataState.status === "ready"
      ? savedAssetSchedule(asset, lines, companyId)
      : { status: "unavailable" as const }
  const state =
    typeof asset.state === "object" && asset.state != null && "tag" in asset.state
      ? String(asset.state.tag)
      : String(asset.state ?? "")
  const number = (value: number | null) =>
    value == null
      ? "—"
      : new Intl.NumberFormat(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(value)
  const generate = async () => {
    if (!onGenerate || generating || generationPending || generationConfirmed) return
    setGenerating(true)
    setError(null)
    let confirmed = false
    try {
      await onGenerate()
      confirmed = true
      setGenerationConfirmed(true)
      await onRefresh?.()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : confirmed
            ? t("accounting.assetSchedule.refreshFailed", {
                defaultValue: "Saved schedule lines could not be refreshed. Try again.",
              })
            : t("accounting.assetSchedule.generateFailed", {
                defaultValue:
                  "The saved schedule could not be confirmed. Refresh before you try again.",
              }),
      )
    } finally {
      setGenerating(false)
    }
  }
  const refresh = async () => {
    if (!onRefresh || generating || generationPending) return
    setGenerating(true)
    setError(null)
    try {
      await onRefresh()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("accounting.assetSchedule.refreshFailed", {
              defaultValue: "Saved schedule lines could not be refreshed. Try again.",
            }),
      )
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card data-testid="asset-depreciation-schedule">
      <CardHeader>
        <CardTitle>
          {t("accounting.assetSchedule.title", {
            defaultValue: "Saved depreciation schedule",
          })}{" "}
          · {String(asset.name ?? asset.id ?? "")}
        </CardTitle>
        <CardDescription>
          {t("accounting.assetSchedule.savedOnly", {
            defaultValue:
              "Dates, amounts, and balances below come from the saved schedule. Generating a schedule does not post journal entries.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {dataState.status === "loading" ? (
          <p role="status">
            {t("accounting.assetSchedule.loading", {
              defaultValue: "Loading saved schedule…",
            })}
          </p>
        ) : schedule.status === "unavailable" ? (
          <div role="alert" className="space-y-2">
            <p>
              {t("accounting.assetSchedule.unavailable", {
                defaultValue:
                  "The complete company-scoped schedule cannot be verified. Refresh the data before generating or reviewing a schedule.",
              })}
            </p>
            {onRefresh ? (
              <Button
                variant="outline"
                disabled={generating || generationPending}
                onClick={() => {
                  void refresh()
                }}
              >
                {t("accounting.assetSchedule.refresh", { defaultValue: "Refresh schedule" })}
              </Button>
            ) : "onRetry" in dataState && dataState.onRetry ? (
              <Button variant="outline" onClick={dataState.onRetry}>
                {t("accounting.assetSchedule.refresh", {
                  defaultValue: "Refresh schedule",
                })}
              </Button>
            ) : null}
          </div>
        ) : schedule.status === "not-generated" ? (
          <div className="space-y-3">
            <p>
              {generationConfirmed
                ? t("accounting.assetSchedule.awaitingRefresh", {
                    defaultValue:
                      "Schedule generation is confirmed. Refresh the saved lines to display the schedule.",
                  })
                : t("accounting.assetSchedule.notGenerated", {
                    defaultValue:
                      "No saved depreciation lines exist for this asset. A schedule is available after the asset is confirmed and generated.",
                  })}
            </p>
            {generationConfirmed && onRefresh ? (
              <Button
                variant="outline"
                disabled={generating || generationPending}
                onClick={() => {
                  void refresh()
                }}
              >
                {t("accounting.assetSchedule.refresh", { defaultValue: "Refresh schedule" })}
              </Button>
            ) : state === "Running" && onGenerate && !generationConfirmed ? (
              <Button
                disabled={generating || generationPending}
                onClick={() => {
                  void generate()
                }}
              >
                {t("accounting.assetSchedule.generate", {
                  defaultValue: "Generate saved schedule",
                })}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {currencyLabel
                ? t("accounting.assetSchedule.currency", {
                    defaultValue: "Amounts in {{currency}}",
                    currency: currencyLabel,
                  })
                : t("accounting.assetSchedule.assetCurrency", {
                    defaultValue:
                      "Amounts are in the asset's saved currency. The currency label is unavailable.",
                  })}
            </p>
            {schedule.incomplete ? (
              <p role="alert">
                {t("accounting.assetSchedule.incomplete", {
                  defaultValue:
                    "Some saved values are unavailable and appear as —. They have not been estimated.",
                })}
              </p>
            ) : null}
            <Table
              aria-label={t("accounting.assetSchedule.title", {
                defaultValue: "Saved depreciation schedule",
              })}
            >
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("accounting.assetSchedule.sequence", {
                      defaultValue: "Installment",
                    })}
                  </TableHead>
                  <TableHead>
                    {t("accounting.assetSchedule.date", {
                      defaultValue: "Date (UTC)",
                    })}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("accounting.assetSchedule.amount", {
                      defaultValue: "Depreciation amount",
                    })}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("accounting.assetSchedule.depreciated", {
                      defaultValue: "Depreciated to date",
                    })}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("accounting.assetSchedule.remaining", {
                      defaultValue: "Remaining depreciable value",
                    })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedule.lines.map((line) => (
                  <TableRow key={line.id} data-line-id={line.id}>
                    <TableCell>{line.sequence}</TableCell>
                    <TableCell className="whitespace-nowrap">{line.date ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{number(line.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number(line.depreciated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number(line.remaining)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        {error ? (
          <div className="space-y-2">
            <p role="alert" className="text-destructive">
              {error}
            </p>
            {onRefresh &&
            (schedule.status === "saved" ||
              (schedule.status === "not-generated" && !generationConfirmed)) ? (
              <Button
                variant="outline"
                disabled={generating || generationPending}
                onClick={() => {
                  void refresh()
                }}
              >
                {t("accounting.assetSchedule.refresh", { defaultValue: "Refresh schedule" })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

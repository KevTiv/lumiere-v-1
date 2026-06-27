"use client"

import { useTranslation } from "@lumiere/i18n"
import type { ImportAnalyzeResponse } from "@lumiere/query-hooks/hooks/ai-import-mapping"

import { Badge } from "../components/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table"

const SKIP_VALUE = "__skip__"

function targetOptions(analysis: ImportAnalyzeResponse): string[] {
  const options = new Set<string>()
  for (const mapping of analysis.mappings) options.add(mapping.target_field)
  for (const field of analysis.unmapped_target_fields) options.add(field)
  options.add("metadata")
  for (const suggestion of analysis.metadata_suggestions) {
    options.add(`metadata.extra.${suggestion.metadata_key}`)
  }
  return [...options].sort()
}

function confidenceBadge(confidence: number | undefined) {
  if (confidence == null) return null
  const pct = Math.round(confidence * 100)
  const variant = pct >= 85 ? "default" : pct >= 65 ? "secondary" : "outline"
  return <Badge variant={variant}>{pct}%</Badge>
}

export type ImportMappingTableProps = {
  headers: string[]
  analysis: ImportAnalyzeResponse
  mapping: Record<string, string>
  onMappingChange: (mapping: Record<string, string>) => void
}

export function ImportMappingTable({
  headers,
  analysis,
  mapping,
  onMappingChange,
}: ImportMappingTableProps) {
  const { t } = useTranslation()
  const targetFieldOptions = targetOptions(analysis)

  return (
    <div className="space-y-3">
      {analysis.warnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {analysis.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("common.importAssistant.sourceColumn")}</TableHead>
            <TableHead>{t("common.importAssistant.targetField")}</TableHead>
            <TableHead>{t("common.importAssistant.confidence")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {headers.map((header) => {
            const suggested = analysis.mappings.find((item) => item.source_column === header)
            return (
              <TableRow key={header}>
                <TableCell className="font-medium">{header}</TableCell>
                <TableCell>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={mapping[header] ?? SKIP_VALUE}
                    onChange={(e) =>
                      onMappingChange({ ...mapping, [header]: e.target.value })
                    }
                  >
                    <option value={SKIP_VALUE}>{t("common.importAssistant.skipColumn")}</option>
                    {targetFieldOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>{confidenceBadge(suggested?.confidence)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {analysis.unmapped_target_fields.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("common.importAssistant.unmappedTargets", {
            fields: analysis.unmapped_target_fields.join(", "),
          })}
        </p>
      ) : null}
    </div>
  )
}

export function mappingRecordFromAnalysis(
  analysis: ImportAnalyzeResponse,
): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const item of analysis.mappings) {
    mapping[item.source_column] = item.target_field
  }
  for (const suggestion of analysis.metadata_suggestions) {
    if (mapping[suggestion.source_column]) continue
    mapping[suggestion.source_column] = `metadata.extra.${suggestion.metadata_key}`
  }
  return mapping
}

export function lineAnalysisFromBundle(
  analysis: ImportAnalyzeResponse,
): ImportAnalyzeResponse | null {
  if (!analysis.bundle) return null
  return {
    target_entity: analysis.bundle.line_entity,
    mappings: analysis.bundle.line_mappings,
    unmapped_source_columns: [],
    unmapped_target_fields: analysis.bundle.line_unmapped_target_fields,
    metadata_suggestions: [],
    structure: analysis.structure,
    safety: analysis.safety,
    warnings: [],
    bundle: null,
  }
}

export function mappingRecordFromLineBundle(
  analysis: ImportAnalyzeResponse,
): Record<string, string> {
  const lineAnalysis = lineAnalysisFromBundle(analysis)
  return lineAnalysis ? mappingRecordFromAnalysis(lineAnalysis) : {}
}

export function headersForMapping(
  headers: string[],
  mapping: Record<string, string>,
): string[] {
  return headers.filter((header) => mapping[header] != null && mapping[header] !== SKIP_VALUE)
}

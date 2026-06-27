"use client"

import { useTranslation } from "@lumiere/i18n"
import type { ImportPreviewResponse } from "@lumiere/query-hooks/hooks/ai-import-mapping"
import { CheckCircle2 } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/table"

export type ImportPreviewGridProps = {
  preview: ImportPreviewResponse
}

export function ImportPreviewGrid({ preview }: ImportPreviewGridProps) {
  const { t } = useTranslation()
  const previewErrors = preview.validation_errors.filter((item) => item.severity === "error")
  const previewColumns = Object.keys(preview.rows[0] ?? {}).slice(0, 6)

  return (
    <div className="space-y-4">
      {previewErrors.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-destructive">
            {t("common.importAssistant.validationErrors", { count: previewErrors.length })}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.importAssistant.row")}</TableHead>
                <TableHead>{t("common.importAssistant.field")}</TableHead>
                <TableHead>{t("common.importAssistant.message")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewErrors.slice(0, 12).map((item, idx) => (
                <TableRow key={`${item.row_index}-${item.field}-${idx}`}>
                  <TableCell>{item.row_index + 1}</TableCell>
                  <TableCell>{item.field}</TableCell>
                  <TableCell>{item.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-emerald-600">
          <CheckCircle2 className="h-4 w-4" />
          {t("common.importAssistant.previewClean", { count: preview.rows.length })}
        </p>
      )}

      {preview.rows.length > 0 && previewColumns.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {previewColumns.map((key) => (
                  <TableHead key={key}>{key}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rows.slice(0, 8).map((row, idx) => (
                <TableRow key={idx}>
                  {previewColumns.map((key) => (
                    <TableCell key={key} className="max-w-[180px] truncate">
                      {String(row[key] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}

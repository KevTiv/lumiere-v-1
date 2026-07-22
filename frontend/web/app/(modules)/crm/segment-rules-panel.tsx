"use client"

import { useMemo, useState } from "react"
import { FilterIcon, PlayIcon } from "lucide-react"

import { useTranslation } from "@lumiere/i18n"
import {
  useContactSegmentRules,
  useContactSegments,
  useEvaluateDynamicSegment,
  useSetContactSegmentRules,
} from "@lumiere/query-hooks/hooks/crm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { nullableBigIntU64 as asId, unwrapSome as optionValue } from "@lumiere/erp-shared/form-coercion"

type Row = Record<string, unknown>

function enumTag(value: unknown): string {
  if (value != null && typeof value === "object" && "tag" in value) {
    return String((value as { tag: unknown }).tag)
  }
  return String(value ?? "")
}

export function SegmentRulesPanel({ organizationId }: { organizationId: number }) {
  const { t } = useTranslation()
  const organization = BigInt(organizationId)
  const { data: segments = [] } = useContactSegments(organization)
  const { data: rules = [] } = useContactSegmentRules(organization)
  const setRules = useSetContactSegmentRules(organization)
  const evaluate = useEvaluateDynamicSegment(organization)
  const [segmentId, setSegmentId] = useState<string>("")

  const dynamicSegments = useMemo(() => {
    return (segments as Row[]).filter(
      (row) => row.isDynamic === true || row.is_dynamic === true,
    )
  }, [segments])

  const selectedId = segmentId ? BigInt(segmentId) : null

  const selectedRules = useMemo(() => {
    if (!selectedId) return []
    return (rules as Row[])
      .filter((row) => asId(row.segmentId ?? row.segment_id) === selectedId)
      .sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
  }, [rules, selectedId])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("crm.segments.rulesTitle", "Dynamic segment rules")}</CardTitle>
        <CardDescription>
          {t(
            "crm.segments.rulesDescription",
            "Bounded AST (country / flags). Evaluate to refresh membership.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("crm.segments.select", "Dynamic segment")}</Label>
          <Select value={segmentId} onValueChange={setSegmentId}>
            <SelectTrigger>
              <SelectValue placeholder={t("crm.segments.selectPlaceholder", "Choose segment")} />
            </SelectTrigger>
            <SelectContent>
              {dynamicSegments.map((seg) => (
                <SelectItem key={String(seg.id)} value={String(seg.id)}>
                  {String(seg.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedId ? (
          <>
            <ul className="space-y-2 text-sm">
              {selectedRules.length === 0 ? (
                <li className="text-muted-foreground flex items-center gap-2">
                  <FilterIcon className="size-4" />
                  {t("crm.segments.noRules", "No rules yet.")}
                </li>
              ) : (
                selectedRules.map((rule) => (
                  <li
                    key={String(rule.id)}
                    className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-2"
                  >
                    <Badge variant="outline">{enumTag(rule.field)}</Badge>
                    <Badge variant="secondary">{enumTag(rule.op)}</Badge>
                    <span>{String(optionValue(rule.valueText ?? rule.value_text) ?? "")}</span>
                  </li>
                ))
              )}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={setRules.isPending}
                onClick={() =>
                  setRules.mutate({
                    segmentId: selectedId,
                    params: {
                      replaceAll: true,
                      rules: [
                        {
                          field: { tag: "CountryCode" },
                          op: { tag: "Eq" },
                          valueText: "AU",
                          valueId: undefined,
                        },
                        {
                          field: { tag: "IsCustomer" },
                          op: { tag: "IsTrue" },
                          valueText: undefined,
                          valueId: undefined,
                        },
                      ],
                      metadata: undefined,
                    },
                  })
                }
              >
                {t("crm.segments.applySample", "Apply AU customer rules")}
              </Button>
              <Button
                size="sm"
                disabled={evaluate.isPending}
                onClick={() => evaluate.mutate(selectedId)}
              >
                <PlayIcon className="size-4" />
                {t("crm.segments.evaluate", "Evaluate")}
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

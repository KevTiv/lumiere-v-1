"use client"

import { useTranslation } from "@lumiere/i18n"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertTriangle,
  Ban,
  BookOpen,
  CheckCircle2,
  EyeOff,
  FileSearch,
  SearchCheck,
} from "lucide-react"

import type {
  AiInspectorViewKind,
  ClaimView,
  InspectionComponentDetail,
  InspectionContribution,
  InspectionDecisionDetail,
  InspectionDecisionSummary,
  InspectionPayload,
  InspectionSourcePassage,
  InspectionSourceVersion,
} from "@lumiere/query-hooks/hooks/ai-runs"

interface AiRunInspectorProps {
  viewKind: AiInspectorViewKind
  payload: InspectionPayload | null
  onInspectClaim?: (claimId: number) => void
  loading?: boolean
  error?: string | null
}

function formatMicros(micros: number | null | undefined): string {
  if (micros == null || !Number.isFinite(micros)) return "—"
  return new Date(micros / 1000).toLocaleString()
}

function shortenHex(hex: string | null | undefined): string {
  if (hex == null || hex === "") return "—"
  return hex.length > 16 ? `${hex.slice(0, 16)}…` : hex
}

/** Parse `authors_json` into a readable "; "-joined author list. */
function parseAuthors(authorsJson: string | null | undefined): string | null {
  if (authorsJson == null || authorsJson === "") return null
  try {
    const parsed = JSON.parse(authorsJson) as unknown
    if (Array.isArray(parsed)) {
      const names = parsed.map((entry) => {
        if (typeof entry === "string") return entry
        if (entry != null && typeof entry === "object") {
          const record = entry as Record<string, unknown>
          const name = record["name"] ?? record["full_name"] ?? record["display_name"]
          if (typeof name === "string" && name !== "") return name
        }
        return JSON.stringify(entry)
      })
      return names.length > 0 ? names.join("; ") : null
    }
    if (typeof parsed === "string") return parsed
    return JSON.stringify(parsed)
  } catch {
    return authorsJson
  }
}

/** Parse a JSON list field into displayable strings (raw text on parse failure). */
function parseJsonList(raw: string | null | undefined): string[] | null {
  if (raw == null || raw === "") return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return null
      return parsed.map((entry) =>
        typeof entry === "string" ? entry : JSON.stringify(entry),
      )
    }
    if (typeof parsed === "string" && parsed !== "") return [parsed]
    return null
  } catch {
    return [raw]
  }
}

function isClaimView(raw: unknown): raw is ClaimView {
  if (raw == null || typeof raw !== "object") return false
  const record = raw as Record<string, unknown>
  return typeof record["id"] === "number" && typeof record["statement"] === "string"
}

function gateOutcomeVariant(
  outcome: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  switch (outcome) {
    case "passed":
    case "pass":
    case "ok":
      return "default"
    case "failed":
    case "fail":
      return "destructive"
    case "domain_review_required":
    case "domain_review":
      return "secondary"
    default:
      return "outline"
  }
}

function validationOutcomeVariant(
  outcome: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  switch (outcome) {
    case "passed":
    case "pass":
    case "ok":
    case "supported":
      return "default"
    case "failed":
    case "fail":
    case "unsupported":
      return "destructive"
    default:
      return "outline"
  }
}

function sourceAvailabilityVariant(
  availability: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  switch (availability) {
    case "available":
      return "default"
    case "denied":
      return "destructive"
    case "unavailable":
    case "recalled":
      return "secondary"
    default:
      return "outline"
  }
}

function LabeledRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="break-words text-sm">{value}</span>
    </div>
  )
}

function SourceVersionBlock({
  source,
}: {
  source: InspectionSourceVersion | null
}) {
  const { t } = useTranslation()
  if (source == null) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("aiHarness.inspector.noSource")}
      </p>
    )
  }

  const authors = parseAuthors(source.authors_json)
  const title = source.title ?? t("aiHarness.inspector.untitledSource")

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant={sourceAvailabilityVariant(source.availability ?? null)}>
          {source.availability ?? "—"}
        </Badge>
        {source.kind != null && source.kind !== "" && (
          <Badge variant="outline">{source.kind}</Badge>
        )}
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {authors != null && (
          <LabeledRow label={t("aiHarness.inspector.sourceAuthors")} value={authors} />
        )}
        {source.publisher != null && source.publisher !== "" && (
          <LabeledRow
            label={t("aiHarness.inspector.sourcePublisher")}
            value={source.publisher}
          />
        )}
        {source.publication_date != null && source.publication_date !== "" && (
          <LabeledRow
            label={t("aiHarness.inspector.sourcePublished")}
            value={source.publication_date}
          />
        )}
        {source.edition != null && source.edition !== "" && (
          <LabeledRow
            label={t("aiHarness.inspector.sourceEdition")}
            value={source.edition}
          />
        )}
        {source.version_label != null && source.version_label !== "" && (
          <LabeledRow
            label={t("aiHarness.inspector.sourceVersion")}
            value={source.version_label}
          />
        )}
        {source.uri != null && source.uri !== "" && (
          <LabeledRow label={t("aiHarness.inspector.sourceUri")} value={source.uri} />
        )}
        {source.doi != null && source.doi !== "" && (
          <LabeledRow label={t("aiHarness.inspector.sourceDoi")} value={source.doi} />
        )}
      </div>
    </div>
  )
}

/**
 * Passage excerpt. Content is rendered ONLY when availability is exactly
 * "available" — denied/unavailable/recalled (or unknown) states render an
 * explicit notice and never the excerpt (AIH-16).
 */
function PassageBlock({
  passage,
}: {
  passage: InspectionSourcePassage | null
}) {
  const { t } = useTranslation()
  if (passage == null) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("aiHarness.inspector.noPassage")}
      </p>
    )
  }

  if (passage.availability === "available") {
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">{passage.availability}</Badge>
          {passage.passage_kind != null && passage.passage_kind !== "" && (
            <Badge variant="outline">{passage.passage_kind}</Badge>
          )}
          {passage.is_original === true && (
            <Badge variant="secondary">
              {t("aiHarness.inspector.originalPassage")}
            </Badge>
          )}
        </div>
        {passage.content != null && passage.content !== "" ? (
          <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm text-muted-foreground">
            {passage.content}
          </blockquote>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("aiHarness.inspector.noPassageContent")}
          </p>
        )}
      </div>
    )
  }

  if (passage.availability === "denied") {
    return (
      <div
        data-testid="inspector-passage-denied"
        className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
      >
        <EyeOff className="size-3.5 shrink-0" />
        {t("aiHarness.inspector.passageDenied")}
      </div>
    )
  }

  if (passage.availability === "recalled") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-secondary p-3 text-sm text-muted-foreground">
        <Ban className="size-3.5 shrink-0" />
        {t("aiHarness.inspector.passageRecalled")}
      </div>
    )
  }

  // "unavailable" and any unknown/null availability: never render content.
  return (
    <div className="flex items-center gap-2 rounded-lg border border-secondary p-3 text-sm text-muted-foreground">
      <AlertTriangle className="size-3.5 shrink-0" />
      {t("aiHarness.inspector.passageUnavailable")}
    </div>
  )
}

function ContributionsBlock({
  contributions,
}: {
  contributions: InspectionContribution[]
}) {
  const { t } = useTranslation()
  if (contributions.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">
        {t("aiHarness.inspector.contributionsTitle")}
      </p>
      <ul className="flex flex-col gap-1">
        {contributions.map((contribution) => (
          <li
            key={contribution.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          >
            <Badge variant="outline">{contribution.contributor_kind ?? "—"}</Badge>
            <span className="font-mono">
              {shortenHex(contribution.contributor_identity)}
            </span>
            {contribution.session_ref != null &&
              contribution.session_ref !== "" && (
                <span className="font-mono">{contribution.session_ref}</span>
              )}
            {contribution.turn_ref != null && contribution.turn_ref !== "" && (
              <span className="font-mono">{contribution.turn_ref}</span>
            )}
            {contribution.inspection_state != null &&
              contribution.inspection_state !== "" && (
                <Badge variant="secondary">{contribution.inspection_state}</Badge>
              )}
            <span>{formatMicros(contribution.introduced_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DecisionsBlock({
  decisions,
}: {
  decisions: InspectionDecisionSummary[]
}) {
  const { t } = useTranslation()
  if (decisions.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">
        {t("aiHarness.inspector.decisionsTitle")}
      </p>
      <ul className="flex flex-col gap-1">
        {decisions.map((decision) => (
          <li
            key={decision.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
          >
            <Badge variant="outline">#{decision.id}</Badge>
            {decision.status != null && decision.status !== "" && (
              <Badge variant="secondary">{decision.status}</Badge>
            )}
            {decision.rationale_summary != null &&
              decision.rationale_summary !== "" && (
                <span className="break-words">{decision.rationale_summary}</span>
              )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ClaimDetail({
  claim,
  onInspectClaim,
  clickable = true,
}: {
  claim: ClaimView
  onInspectClaim?: (claimId: number) => void
  clickable?: boolean
}) {
  const { t } = useTranslation()
  const assumptions = parseJsonList(claim.assumptions_json)
  const canClick = clickable && onInspectClaim != null

  return (
    <div
      data-testid="inspector-claim"
      data-claim-id={claim.id}
      className="flex flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-start gap-2">
        {canClick ? (
          <button
            type="button"
            className="flex flex-1 flex-col items-start gap-1 text-left"
            onClick={() => onInspectClaim?.(claim.id)}
          >
            <span className="break-words text-sm font-medium underline-offset-2 hover:underline">
              {claim.statement}
            </span>
          </button>
        ) : (
          <span className="flex-1 break-words text-sm font-medium">
            {claim.statement}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-1">
          {claim.kind != null && claim.kind !== "" && (
            <Badge variant="outline">{claim.kind}</Badge>
          )}
          {claim.status != null && claim.status !== "" && (
            <Badge variant="secondary">{claim.status}</Badge>
          )}
          {claim.verification_outcome != null &&
            claim.verification_outcome !== "" && (
              <Badge variant={validationOutcomeVariant(claim.verification_outcome)}>
                {claim.verification_outcome}
              </Badge>
            )}
          {canClick && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <SearchCheck className="size-3.5" />
              {t("aiHarness.inspector.inspectClaimHint")}
            </span>
          )}
        </span>
      </div>

      {assumptions != null && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("aiHarness.inspector.assumptionsLabel")}
          </p>
          <ul className="list-disc pl-4 text-xs text-muted-foreground">
            {assumptions.map((assumption, index) => (
              <li key={index}>{assumption}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("aiHarness.inspector.sourceTitle")}
        </p>
        <SourceVersionBlock source={claim.source_version} />
        <PassageBlock passage={claim.source_passage} />
      </div>

      <ContributionsBlock contributions={claim.contributions ?? []} />
      <DecisionsBlock decisions={claim.decisions ?? []} />
    </div>
  )
}

function DecisionDetail({
  decision,
  onInspectClaim,
}: {
  decision: InspectionDecisionDetail
  onInspectClaim?: (claimId: number) => void
}) {
  const { t } = useTranslation()
  const alternatives = parseJsonList(decision.alternatives_json)
  const adaptations = parseJsonList(decision.adaptations_json)

  return (
    <div data-testid="inspector-decision" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">#{decision.id}</Badge>
        {decision.status != null && decision.status !== "" && (
          <Badge variant="secondary">{decision.status}</Badge>
        )}
        {decision.applicability != null && decision.applicability !== "" && (
          <Badge variant="outline">{decision.applicability}</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <LabeledRow
          label={t("aiHarness.inspector.contributorLabel")}
          value={shortenHex(decision.contributor_identity)}
        />
        <LabeledRow
          label={t("aiHarness.inspector.reviewerLabel")}
          value={shortenHex(decision.reviewer_identity)}
        />
      </div>

      {decision.rationale != null && decision.rationale !== "" && (
        <LabeledRow
          label={t("aiHarness.inspector.rationaleLabel")}
          value={decision.rationale}
        />
      )}

      {alternatives != null && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("aiHarness.inspector.alternativesLabel")}
          </p>
          <ul className="list-disc pl-4 text-xs text-muted-foreground">
            {alternatives.map((alternative, index) => (
              <li key={index}>{alternative}</li>
            ))}
          </ul>
        </div>
      )}

      {adaptations != null && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t("aiHarness.inspector.adaptationsLabel")}
          </p>
          <ul className="list-disc pl-4 text-xs text-muted-foreground">
            {adaptations.map((adaptation, index) => (
              <li key={index}>{adaptation}</li>
            ))}
          </ul>
        </div>
      )}

      {decision.claim != null && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("aiHarness.inspector.claimsTitle")}
          </p>
          <ClaimDetail claim={decision.claim} onInspectClaim={onInspectClaim} />
        </div>
      )}

      {(decision.supporting_claims?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("aiHarness.inspector.supportingClaimsLabel")}
          </p>
          {decision.supporting_claims.map((claim) => (
            <ClaimDetail
              key={claim.id}
              claim={claim}
              onInspectClaim={onInspectClaim}
              clickable={false}
            />
          ))}
        </div>
      )}

      {(decision.supporting_sources?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("aiHarness.inspector.supportingSourcesLabel")}
          </p>
          {decision.supporting_sources.map((source) => (
            <SourceVersionBlock key={source.id} source={source} />
          ))}
        </div>
      )}
    </div>
  )
}

function ComponentDetail({
  component,
  onInspectClaim,
}: {
  component: InspectionComponentDetail
  onInspectClaim?: (claimId: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div data-testid="inspector-component" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono">
          {component.component_key ?? "—"}
        </Badge>
        {component.component_kind != null && component.component_kind !== "" && (
          <Badge variant="outline">{component.component_kind}</Badge>
        )}
        {component.version != null && (
          <Badge variant="secondary">
            {t("aiHarness.inspector.versionLabel", { count: component.version })}
          </Badge>
        )}
        {component.status != null && component.status !== "" && (
          <Badge variant="secondary">{component.status}</Badge>
        )}
      </div>

      {component.content_hash != null && component.content_hash !== "" && (
        <LabeledRow
          label={t("aiHarness.inspector.contentHashLabel")}
          value={component.content_hash}
        />
      )}

      {component.claim != null && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("aiHarness.inspector.claimsTitle")}
          </p>
          <ClaimDetail claim={component.claim} onInspectClaim={onInspectClaim} />
        </div>
      )}

      {component.decision != null && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("aiHarness.inspector.decisionsTitle")}
          </p>
          <DecisionDetail
            decision={component.decision}
            onInspectClaim={onInspectClaim}
          />
        </div>
      )}
    </div>
  )
}

function AnswerDetail({
  payload,
  onInspectClaim,
}: {
  payload: InspectionPayload
  onInspectClaim?: (claimId: number) => void
}) {
  const { t } = useTranslation()
  const gate = payload.gate_result ?? null
  const failedChecks = parseJsonList(gate?.failed_checks_json)
  const domainReviewRequired = gate?.domain_review_required === true
  const failedGate = gate?.gate_outcome != null && gateOutcomeVariant(gate.gate_outcome) === "destructive"

  return (
    <div className="flex flex-col gap-4" data-testid="inspector-answer">
      <div className="flex flex-wrap items-center gap-2">
        {payload.run_id != null && (
          <Badge variant="outline">
            {t("aiHarness.inspector.runLabel", { id: payload.run_id })}
          </Badge>
        )}
        {payload.run_status != null && payload.run_status !== "" && (
          <Badge variant="secondary">{payload.run_status}</Badge>
        )}
      </div>

      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg border p-3",
          failedGate && "border-destructive/40 bg-destructive/5",
        )}
        data-testid="inspector-gate"
      >
        <div className="flex flex-wrap items-center gap-2">
          {gate?.gate_outcome != null ? (
            gateOutcomeVariant(gate.gate_outcome) === "default" ? (
              <CheckCircle2 className="size-4 text-muted-foreground" />
            ) : (
              <AlertTriangle className="size-4 text-muted-foreground" />
            )
          ) : (
            <FileSearch className="size-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {t("aiHarness.inspector.gateOutcome")}
          </span>
          {gate?.gate_outcome != null ? (
            <Badge variant={gateOutcomeVariant(gate.gate_outcome)}>
              {gate.gate_outcome}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t("aiHarness.inspector.gateNoResult")}
            </span>
          )}
          {domainReviewRequired && (
            <Badge variant="secondary">
              {t("aiHarness.inspector.gateDomainReview")}
            </Badge>
          )}
        </div>
        {failedChecks != null && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-destructive">
              {t("aiHarness.inspector.failedChecks")}
            </p>
            <ul className="list-disc pl-4 text-xs text-destructive">
              {failedChecks.map((check, index) => (
                <li key={index}>{check}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          {t("aiHarness.inspector.validationsTitle")}
        </p>
        {(payload.validations?.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("aiHarness.inspector.noValidations")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="inspector-validations">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">
                    {t("aiHarness.inspector.checkKindColumn")}
                  </th>
                  <th className="py-2 pr-4">
                    {t("aiHarness.inspector.outcomeColumn")}
                  </th>
                  <th className="py-2">{t("aiHarness.inspector.detailColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {payload.validations?.map((validation) => (
                  <tr key={validation.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {validation.check_kind ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={validationOutcomeVariant(validation.outcome)}>
                        {validation.outcome ?? "—"}
                      </Badge>
                    </td>
                    <td className="py-2 break-words text-muted-foreground">
                      {validation.detail ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("aiHarness.inspector.claimsTitle")}</p>
        {(payload.claims?.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("aiHarness.inspector.noClaims")}
          </p>
        ) : (
          payload.claims?.map((claim) => (
            <ClaimDetail
              key={claim.id}
              claim={claim}
              onInspectClaim={onInspectClaim}
            />
          ))
        )}
      </div>
    </div>
  )
}

/**
 * Source/decision inspector (AIH-16). Presentational, read-only: renders the
 * inspection payload returned by `POST /api/ai/inspector` for the requested
 * view kind. Claim rows call `onInspectClaim(claimId)` so the parent can
 * re-query with `viewKind: "claim"`.
 */
export function AiRunInspector({
  viewKind,
  payload,
  onInspectClaim,
  loading = false,
  error = null,
}: AiRunInspectorProps) {
  const { t } = useTranslation()

  const titleKey =
    viewKind === "answer"
      ? "aiHarness.inspector.answerTitle"
      : viewKind === "claim"
        ? "aiHarness.inspector.claimTitle"
        : viewKind === "decision"
          ? "aiHarness.inspector.decisionTitle"
          : "aiHarness.inspector.componentTitle"

  const claim =
    payload?.claim ?? (payload != null && isClaimView(payload) ? payload : null)
  const decision = payload?.decision ?? null
  const component = payload?.component ?? null

  return (
    <Card data-testid="ai-run-inspector">
      <CardHeader>
        <CardTitle className="text-base">{t(titleKey)}</CardTitle>
        {viewKind === "answer" && payload?.run_status != null && (
          <CardDescription>{payload.run_status}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error != null && error !== "" && (
          <div
            data-testid="inspector-error"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {loading && payload == null ? (
          <div className="flex flex-col gap-2" data-testid="inspector-skeleton">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : payload == null ? (
          <p className="text-sm text-muted-foreground">
            {t("aiHarness.inspector.emptyPayload")}
          </p>
        ) : viewKind === "answer" ? (
          <AnswerDetail payload={payload} onInspectClaim={onInspectClaim} />
        ) : viewKind === "claim" ? (
          claim != null ? (
            <ClaimDetail claim={claim} onInspectClaim={onInspectClaim} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("aiHarness.inspector.emptyPayload")}
            </p>
          )
        ) : viewKind === "decision" ? (
          decision != null ? (
            <DecisionDetail decision={decision} onInspectClaim={onInspectClaim} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("aiHarness.inspector.emptyPayload")}
            </p>
          )
        ) : component != null ? (
          <ComponentDetail component={component} onInspectClaim={onInspectClaim} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("aiHarness.inspector.emptyPayload")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

"use client";

import { useId, useState } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useTranslation } from "@lumiere/i18n";

import { Alert, AlertDescription, AlertTitle } from "../components/alert";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/card";
import { cn } from "../lib/utils";

import {
  evaluateAccountingSetupReadiness,
  type AccountingReadinessAction,
  type AccountingReadinessItem,
  type AccountingSetupReadinessInput,
} from "./accounting-setup-readiness";

export interface AccountingSetupReadinessPanelProps {
  setup: AccountingSetupReadinessInput;
  action?: AccountingReadinessAction;
  onResolve?: (item: AccountingReadinessItem) => void;
  className?: string;
  /** Keep global setup status brief outside setup and blocked workflow actions. */
  compact?: boolean;
}

const ACTION_COPY: Record<
  AccountingReadinessAction,
  { subject: string; readyTitle: string; blockedTitle: string }
> = {
  invoice: {
    subject: "create customer invoices",
    readyTitle: "Invoice creation is ready",
    blockedTitle: "Invoice creation needs setup",
  },
  bill: {
    subject: "create vendor bills",
    readyTitle: "Bill creation is ready",
    blockedTitle: "Bill creation needs setup",
  },
  import: {
    subject: "import historical accounting data",
    readyTitle: "Accounting import is ready",
    blockedTitle: "Accounting import needs setup",
  },
};

export function AccountingSetupReadinessPanel({
  setup,
  action,
  onResolve,
  className,
  compact = false,
}: AccountingSetupReadinessPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const readiness = evaluateAccountingSetupReadiness(setup, action);
  const actionCopy = action ? ACTION_COPY[action] : undefined;
  const title = readiness.isReady
    ? (actionCopy?.readyTitle ?? "Accounting setup is ready")
    : (actionCopy?.blockedTitle ?? "Accounting setup needs attention");
  const description = readiness.isReady
    ? readiness.advisoryItems.length > 0
      ? "Required setup is complete. Review the advisory item before statutory reporting."
      : "All required accounting setup is complete."
    : `Complete the required items below before you can ${actionCopy?.subject ?? "use accounting workflows"}.`;

  return (
    <Card className={className} data-testid="accounting-setup-readiness">
      <CardHeader>
        <div className="flex items-start gap-3">
          {readiness.isReady ? (
            <CheckCircle2
              className="mt-0.5 size-5 text-success"
              aria-hidden="true"
            />
          ) : (
            <AlertCircle
              className="mt-0.5 size-5 text-destructive"
              aria-hidden="true"
            />
          )}
          <div className="space-y-1">
            <CardTitle>
              {t(
                `accounting.readiness.${action ?? "all"}.${readiness.isReady ? "ready" : "blocked"}.title`,
                {
                  defaultValue: title,
                },
              )}
            </CardTitle>
            <CardDescription>
              {t(
                `accounting.readiness.${action ?? "all"}.${readiness.isReady ? "ready" : "blocked"}.description`,
                {
                  defaultValue: description,
                  context: readiness.isReady
                    ? readiness.advisoryItems.length > 0 ? "advisory" : "complete"
                    : undefined,
                },
              )}
            </CardDescription>
          </div>
        </div>
        {compact && readiness.items.length > 0 ? <Button type="button" variant="outline" size="sm"
          data-testid="accounting-setup-toggle" aria-expanded={expanded} aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}>
          {expanded ? t("accounting.readiness.hideDetails", { defaultValue: "Hide setup details" })
            : t("accounting.readiness.reviewDetails", { defaultValue: "Review setup ({{count}} required)", count: readiness.blockingItems.length })}
        </Button> : null}
      </CardHeader>
      {readiness.items.length > 0 && (!compact || expanded) ? (
        <CardContent id={detailsId} className="flex flex-col gap-3">
          {readiness.items.map((item) => {
            const isBlocking = item.severity === "blocking";
            return (
              <Alert
                key={item.id}
                variant={isBlocking ? "destructive" : "default"}
                className={cn(!isBlocking && "border-warning/40")}
                data-testid={`accounting-readiness-${item.id}`}
              >
                {isBlocking ? (
                  <AlertCircle aria-hidden="true" />
                ) : (
                  <Info aria-hidden="true" />
                )}
                <AlertTitle className="flex flex-wrap items-center gap-2">
                  {t(`accounting.readiness.items.${item.id}.label`, {
                    defaultValue: item.label,
                  })}
                  <Badge variant={isBlocking ? "destructive" : "warning"}>
                    {t(`accounting.readiness.severity.${item.severity}`, {
                      defaultValue: isBlocking ? "Required" : "Review",
                    })}
                  </Badge>
                </AlertTitle>
                <AlertDescription className="mt-1 space-y-2">
                  <p>
                    {t(`accounting.readiness.items.${item.id}.reason`, {
                      defaultValue: item.reason,
                    })}
                  </p>
                  {onResolve ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onResolve(item)}
                    >
                      {t(`accounting.readiness.items.${item.id}.action`, {
                        defaultValue: item.actionLabel,
                      })}
                    </Button>
                  ) : (
                    <span className="font-medium text-foreground">
                      {t(`accounting.readiness.items.${item.id}.action`, {
                        defaultValue: item.actionLabel,
                      })}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            );
          })}
        </CardContent>
      ) : null}
    </Card>
  );
}

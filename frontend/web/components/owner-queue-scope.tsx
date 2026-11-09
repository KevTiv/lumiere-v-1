"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslation } from "@lumiere/i18n";
import { Badge } from "@lumiere/ui/components/badge";
import { buttonVariants } from "@lumiere/ui/components/button";
import { clearOwnerQueueHref, type OwnerQueue } from "@/lib/owner-queues";

const titles: Record<OwnerQueue, string> = {
  overdueInvoices: "Overdue customer balances",
  draftBills: "Draft vendor bills",
  lowStockProducts: "Low-stock alerts",
};

export function OwnerQueueScope({ queue }: { queue: OwnerQueue }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const search = useSearchParams();

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2"
      data-testid="owner-queue-scope"
    >
      <Badge variant="secondary">
        {t(`financeReview.queues.${queue}.title`, {
          defaultValue: titles[queue],
        })}
      </Badge>
      <span className="text-sm text-muted-foreground">
        {queue === "lowStockProducts"
          ? t("financeReview.stockQueueScope", {
              defaultValue:
                "Active company stock rows at or below their minimum, or marked outdated",
            })
          : t("financeReview.activeCompanyQueue", {
              defaultValue: "Active company work queue",
            })}
      </span>
      <Link
        className={buttonVariants({ size: "sm", variant: "ghost" })}
        href={clearOwnerQueueHref(pathname, search.toString())}
        scroll={false}
      >
        {t("financeReview.clearQueue", { defaultValue: "Clear queue filter" })}
      </Link>
    </div>
  );
}

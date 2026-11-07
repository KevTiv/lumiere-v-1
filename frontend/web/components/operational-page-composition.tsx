"use client";

import { usePathname } from "next/navigation";
import { useTranslation } from "@lumiere/i18n";
import type { PersonalPageModule } from "@lumiere/presentation-core/personal-page-layout";
import { ModulePageComposition } from "@lumiere/ui/pages/page-composition-host";

/** These workspaces do not use ModuleView; their operational content stays below the widget area. */
export const OPERATIONAL_COMPOSITION_MODULES = {
  tasks: "Tasks",
  approvals: "Approvals",
  distributor: "Distributor",
  map: "Map",
} as const satisfies Partial<Record<PersonalPageModule, string>>;

export function OperationalPageComposition() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const moduleId = pathname?.match(/^\/([a-z]+)\/?$/)?.[1];
  if (!moduleId || !(moduleId in OPERATIONAL_COMPOSITION_MODULES)) return null;
  const title =
    OPERATIONAL_COMPOSITION_MODULES[
      moduleId as keyof typeof OPERATIONAL_COMPOSITION_MODULES
    ];
  return (
    <ModulePageComposition
      moduleId={moduleId}
      pageId="dashboard"
      title={t(`${moduleId}.page.title`, { defaultValue: title })}
    />
  );
}

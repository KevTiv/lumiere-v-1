"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useErpSession } from "@lumiere/erp-session";
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company";
import { stdbQueryKey } from "@lumiere/query-hooks/hooks/stdb";
import { fetchQueryList } from "@lumiere/query-hooks/http";
import {
  getAssistantCapability,
  type AssistantPageCatalog,
} from "@lumiere/query-hooks/assistant-actions";
import {
  isPersonalPageModule,
  type PersonalPageLayoutResponse,
} from "@lumiere/presentation-core/personal-page-layout";
import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import {
  parseHistoryPeriod,
  resolveHistoryPeriod,
} from "@lumiere/erp-shared/history-period";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "@lumiere/i18n";
import { toast } from "sonner";
import { useRBAC } from "@lumiere/ui/lib/rbac-context";
import { Button } from "@lumiere/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@lumiere/ui/components/sheet";
import { PageComposition } from "@lumiere/ui/pages/page-composition";
import {
  PageCompositionHostProvider,
  type PageCompositionMountProps,
} from "@lumiere/ui/pages/page-composition-host";
import {
  createBuiltinWidgetCatalog,
  createDefaultPageLayout,
  pageWidgetKey,
  type PageCompositionValue,
  type PageWidgetCatalogItem,
  type PageWidgetPlacement,
} from "@lumiere/ui/lib/page-composition";
import { resolveStoredDashboard } from "@lumiere/ui/lib/stored-dashboard-resolver";
import type { CustomWidget } from "@lumiere/ui/lib/dashboard-types";
import {
  QueryBuilder,
  type QueryBuilderStatus,
} from "@/app/(modules)/reports/query-builder";
import {
  queryBuilderDraftFromWidget,
  type QueryBuilderDraft,
} from "@/app/(modules)/reports/query-builder-definition";
import { useStoredDashboardDataSources } from "@/hooks/use-stored-dashboard-data-sources";
import { assistantHistoryScope } from "./assistant-history";
import {
  fetchModulePageLayout,
  modulePageQueryKey,
  saveModulePageLayout,
  ModulePageLayoutError,
  type ModulePageScope,
} from "./module-page-layout";

export interface AssistantPageRequest {
  requestId: string;
  scopeKey: string;
  moduleId: string;
  pageId?: string;
  kind: "edit_page" | "add_widget";
  widgetKey?: string;
  prompt?: string;
}

interface RegisteredPage extends AssistantPageCatalog {
  owner: string;
  scopeKey: string;
}

interface CompositionEnvironment {
  scopeKey: string | null;
  pending: (AssistantPageRequest & { expiresAt: number }) | null;
  page: AssistantPageCatalog | null;
  requestPage: (
    request: AssistantPageRequest,
  ) => "pending" | "busy" | "scope_changed";
  settle: (requestId: string) => void;
  register: (page: RegisteredPage) => () => void;
  isCurrent: (scope: string) => boolean;
}

const CompositionContext = createContext<CompositionEnvironment | null>(null);

export function useModulePageComposition() {
  return useContext(CompositionContext);
}

export function ModulePageCompositionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { identity, organizationId } = useErpSession();
  const companyId = useOperatingCompanyId(organizationId);
  const scopeKey = assistantHistoryScope(identity, organizationId, companyId);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const [pending, setPending] =
    useState<CompositionEnvironment["pending"]>(null);
  const pendingRef = useRef<CompositionEnvironment["pending"]>(null);
  const [page, setPage] = useState<RegisteredPage | null>(null);
  const isCurrent = useCallback(
    (scope: string) => currentScope.current === scope,
    [],
  );
  const register = useCallback((next: RegisteredPage) => {
    if (next.scopeKey !== currentScope.current) return () => {};
    setPage((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
    return () => {
      setPage((previous) => (previous?.owner === next.owner ? null : previous));
    };
  }, []);
  const settle = useCallback((requestId: string) => {
    if (pendingRef.current?.requestId !== requestId) return;
    pendingRef.current = null;
    setPending(null);
  }, []);
  const requestPage = useCallback((request: AssistantPageRequest) => {
    if (
      !currentScope.current ||
      request.scopeKey !== currentScope.current ||
      !isPersonalPageModule(request.moduleId)
    )
      return "scope_changed" as const;
    if (
      pendingRef.current?.scopeKey === currentScope.current &&
      pendingRef.current.expiresAt > Date.now()
    )
      return "busy" as const;
    const next = { ...request, expiresAt: Date.now() + 15_000 };
    pendingRef.current = next;
    setPending(next);
    return "pending" as const;
  }, []);
  useEffect(() => {
    if (pendingRef.current?.scopeKey !== scopeKey) pendingRef.current = null;
    setPending((previous) =>
      previous?.scopeKey === scopeKey ? previous : null,
    );
    setPage((previous) => (previous?.scopeKey === scopeKey ? previous : null));
  }, [scopeKey]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(
      () => {
        if (
          pendingRef.current?.requestId !== pending.requestId ||
          pending.scopeKey !== currentScope.current
        )
          return;
        settle(pending.requestId);
        toast.warning(t("aiChat.native.pageUnavailable"));
      },
      Math.max(0, pending.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [pending, settle, t]);
  const value = useMemo<CompositionEnvironment>(
    () => ({
      scopeKey,
      pending: pending?.scopeKey === scopeKey ? pending : null,
      page: page?.scopeKey === scopeKey ? page : null,
      requestPage,
      settle,
      register,
      isCurrent,
    }),
    [isCurrent, page, pending, register, requestPage, scopeKey, settle],
  );
  return (
    <CompositionContext.Provider value={value}>
      <PageCompositionHostProvider component={ModulePageHost}>
        {children}
      </PageCompositionHostProvider>
    </CompositionContext.Provider>
  );
}

function ModulePageHost(props: PageCompositionMountProps) {
  const { identity, organizationId } = useErpSession();
  const companyId = useOperatingCompanyId(organizationId);
  const environment = useModulePageComposition();
  if (
    !identity ||
    !organizationId ||
    !companyId ||
    !environment?.scopeKey ||
    !isPersonalPageModule(props.moduleId)
  )
    return <>{props.children}</>;
  const scope: ModulePageScope = {
    identity,
    organizationId: String(organizationId),
    companyId: String(companyId),
    moduleId: props.moduleId,
    pageId: props.pageId,
  };
  return (
    <ScopedModulePageHost
      key={modulePageQueryKey(scope).join(":")}
      {...props}
      scope={scope}
      environment={environment}
      scopeKey={environment.scopeKey}
    />
  );
}

function ExistingModuleContent({ data }: { data: unknown }) {
  return <>{data as ReactNode}</>;
}

interface WidgetScopeRow {
  id: unknown;
  organizationId?: unknown;
  organization_id?: unknown;
  companyId?: unknown;
  company_id?: unknown;
  isActive?: unknown;
  is_active?: unknown;
}

function scopedWidgetRows<Row extends WidgetScopeRow>(
  rows: Row[],
  scope: ModulePageScope,
): Row[] {
  return rows.filter((row) => {
    const organization = parseStrictU64(
      row.organizationId ?? row.organization_id,
    );
    const id = parseStrictU64(row.id);
    const hasCompany = Object.hasOwn(row, "companyId");
    const rawCompany = hasCompany ? row.companyId : row.company_id;
    const conflictingCompany =
      hasCompany &&
      Object.hasOwn(row, "company_id") &&
      (rawCompany === null || row.company_id === null
        ? rawCompany !== row.company_id
        : parseStrictU64(rawCompany) !== parseStrictU64(row.company_id));
    return (
      id != null &&
      id > 0n &&
      String(row.id) === id.toString() &&
      organization?.toString() === scope.organizationId &&
      !conflictingCompany &&
      (hasCompany || Object.hasOwn(row, "company_id")) &&
      (rawCompany === null ||
        parseStrictU64(rawCompany)?.toString() === scope.companyId) &&
      (row.isActive ?? row.is_active) === true
    );
  });
}

type WidgetEditor = {
  id: string;
  initialDraft?: QueryBuilderDraft;
  resolve: (item: PageWidgetCatalogItem | null) => void;
};

function ScopedModulePageHost({
  moduleId,
  pageId,
  title,
  sections,
  placement = "dashboard",
  historyBounds,
  savedWidgetScopeNote,
  actionTarget,
  children,
  isLoading,
  scope,
  scopeKey,
  environment,
}: PageCompositionMountProps & {
  scope: ModulePageScope;
  scopeKey: string;
  environment: CompositionEnvironment;
}) {
  const { t } = useTranslation();
  const { checkPermission, permissionsReady } = useRBAC();
  const capability = getAssistantCapability(`${moduleId}.page.edit`);
  const permitted =
    permissionsReady !== false &&
    Boolean(
      capability &&
      checkPermission(capability.permission.resource, "read").allowed,
    );
  const canReadWidgets =
    permitted && checkPermission("dashboard_widget", "read").allowed;
  const canCreateWidgets =
    canReadWidgets && checkPermission("dashboard_widget", "create").allowed;
  const queryClient = useQueryClient();
  const queryKey = modulePageQueryKey(scope);
  const layout = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchModulePageLayout(scope, signal),
    enabled: permitted,
    staleTime: 30_000,
    retry: false,
  });
  const widgetsQuery = useQuery({
    queryKey: [
      ...stdbQueryKey("dashboard-widgets", BigInt(scope.organizationId)),
      "page-catalog",
      scope.identity,
      scope.companyId,
    ],
    queryFn: async () =>
      scopedWidgetRows(
        await fetchQueryList(
          `/api/query/dashboard-widgets?companyId=${scope.companyId}`,
          "Saved widgets could not be loaded.",
        ),
        scope,
      ),
    enabled: canReadWidgets,
    staleTime: 30_000,
    retry: false,
  });
  const [draft, setDraft] = useState<PageCompositionValue>(null);
  const [editor, setEditor] = useState<WidgetEditor | null>(null);
  const editorRef = useRef<WidgetEditor | null>(null);
  editorRef.current = editor;
  const [editorStatus, setEditorStatus] = useState<QueryBuilderStatus | null>(
    null,
  );
  useEffect(
    () => () => {
      editorRef.current?.resolve(null);
    },
    [],
  );
  const savedRows = useMemo(
    () =>
      !canReadWidgets || widgetsQuery.error ? [] : (widgetsQuery.data ?? []),
    [canReadWidgets, widgetsQuery.data, widgetsQuery.error],
  );
  const savedById = useMemo(
    () => new Map(savedRows.map((row) => [String(row.id), row])),
    [savedRows],
  );
  const displayedSavedIds = useMemo(
    () => [
      ...new Set(
        [...(layout.data?.layout?.widgets ?? []), ...(draft ?? [])]
          .filter((widget) => widget.source === "saved")
          .map((widget) => widget.widgetId),
      ),
    ],
    [draft, layout.data],
  );
  const models = useMemo(
    () => [
      ...new Set(
        displayedSavedIds.flatMap((id) => {
          const model = savedById.get(id)?.model;
          return typeof model === "string" ? [model] : [];
        }),
      ),
    ],
    [displayedSavedIds, savedById],
  );
  const { dataSources, sourceStates } = useStoredDashboardDataSources(
    BigInt(scope.organizationId),
    models,
    {
      companyId: scope.companyId,
      identity: scope.identity,
      enabled: canReadWidgets && !layout.error,
    },
  );
  const searchParams = useSearchParams();
  const rawPeriod = searchParams?.get("period");
  const periodTimeZone = searchParams?.get("periodTimeZone") ?? "UTC";
  const bounds = useMemo(() => {
    if (historyBounds !== undefined) return historyBounds;
    const period = parseHistoryPeriod(rawPeriod);
    if (rawPeriod && !period) return null;
    try {
      return resolveHistoryPeriod(period ?? "all", {
        timeZone: periodTimeZone,
      });
    } catch {
      return null;
    }
  }, [historyBounds, rawPeriod, periodTimeZone]);
  const resolution = useMemo(
    () =>
      resolveStoredDashboard(
        savedRows,
        displayedSavedIds.map(BigInt),
        dataSources,
        {
          sourceStates,
          startMs: bounds?.startMs ?? undefined,
          endMs: bounds?.endMs ?? undefined,
        },
      ),
    [savedRows, displayedSavedIds, dataSources, sourceStates, bounds],
  );
  const renderedById = useMemo(
    () => new Map(resolution.widgets.map((widget) => [widget.id, widget])),
    [resolution.widgets],
  );
  const builtinCatalog = useMemo(() => {
    const sectionCatalog = sections ? createBuiltinWidgetCatalog(sections) : [];
    if (placement !== "content" && sections) return sectionCatalog;
    if (placement === "insights" || !children) return [];
    const widget: CustomWidget = {
      id: "module-content",
      type: "custom",
      title: "",
      width: "full",
      useCard: false,
      component: ExistingModuleContent,
      data: children,
    };
    return [
      {
        source: "builtin" as const,
        widgetId: widget.id,
        title,
        defaultWidth: 12 as const,
        required: placement === "content",
        widget,
      },
      ...sectionCatalog,
    ];
  }, [sections, children, title, placement]);
  const defaultValue = useMemo(
    () =>
      placement === "insights"
        ? []
        : sections && placement !== "content"
          ? createDefaultPageLayout(sections)
          : builtinCatalog
              .filter((item) => placement !== "content" || item.required)
              .map((item) => ({
                id: `builtin:${item.widgetId}`,
                source: item.source,
                widgetId: item.widgetId,
                width: item.defaultWidth ?? 12,
              })),
    [sections, builtinCatalog, placement],
  );
  const savedCatalog = useMemo<PageWidgetCatalogItem[]>(
    () =>
      savedRows.map((row) => {
        const id = String(row.id);
        const issue = resolution.issues.find((entry) => entry.widgetId === id);
        return {
          source: "saved",
          widgetId: id,
          title: String(row.name ?? id),
          category: t("pageComposition.savedWidgets", {
            defaultValue: "Saved widgets",
          }),
          description: String(row.model ?? ""),
          configurable:
            canCreateWidgets && queryBuilderDraftFromWidget(row) !== null,
          widget: bounds ? renderedById.get(id) : undefined,
          unavailableReason: !bounds
            ? t("pageComposition.invalidPeriod", {
                defaultValue:
                  "Choose a valid page date range to display this widget.",
              })
            : issue?.message,
        };
      }),
    [savedRows, resolution.issues, canCreateWidgets, bounds, renderedById, t],
  );
  const catalog = useMemo(
    () => [...builtinCatalog, ...savedCatalog],
    [builtinCatalog, savedCatalog],
  );
  const owner = useId();
  const catalogSignature = JSON.stringify(
    catalog.map((item) => ({ key: pageWidgetKey(item), label: item.title })),
  );
  const { register, settle, isCurrent } = environment;
  useEffect(() => {
    if (!permitted || layout.error) return;
    const widgets = JSON.parse(
      catalogSignature,
    ) as AssistantPageCatalog["widgets"];
    return register({ owner, scopeKey, moduleId, pageId, widgets });
  }, [
    catalogSignature,
    layout.error,
    moduleId,
    owner,
    pageId,
    permitted,
    register,
    scopeKey,
  ]);

  const closeEditor = () => {
    editorRef.current?.resolve(null);
    editorRef.current = null;
    setEditor(null);
    setEditorStatus(null);
  };
  useEffect(() => {
    if (canCreateWidgets) return;
    editorRef.current?.resolve(null);
    editorRef.current = null;
    setEditor(null);
    setEditorStatus(null);
  }, [canCreateWidgets]);
  const openEditor = (initialDraft?: QueryBuilderDraft) =>
    new Promise<PageWidgetCatalogItem | null>((resolve) => {
      if (!canCreateWidgets || !isCurrent(scopeKey) || editorRef.current) {
        resolve(null);
        return;
      }
      const next = { id: crypto.randomUUID(), initialDraft, resolve };
      editorRef.current = next;
      setEditor(next);
      setEditorStatus(null);
    });
  const onCreated = async (widgetId: string) => {
    const open = editorRef.current;
    if (!open || !isCurrent(scopeKey) || !canCreateWidgets) return;
    const result = await widgetsQuery.refetch();
    if (
      !isCurrent(scopeKey) ||
      editorRef.current?.id !== open.id ||
      !canCreateWidgets
    )
      return;
    if (result.error) throw result.error;
    const row = result.data?.find(
      (candidate) => String(candidate.id) === widgetId,
    );
    if (!row)
      throw new Error(
        t("pageComposition.widgetReadbackFailed", {
          defaultValue:
            "The widget was saved, but it could not be read back. Retry to finish adding it.",
        }),
      );
    open.resolve({
      source: "saved",
      widgetId,
      title: String(row.name ?? widgetId),
      description: String(row.model ?? ""),
      configurable: true,
    });
    editorRef.current = null;
    setEditor(null);
  };
  const onSave = async (
    placements: PageCompositionValue,
    expectedRevision: string | null,
  ) => {
    if (!isCurrent(scopeKey) || !permitted)
      throw new Error(
        t("pageComposition.scopeChanged", {
          defaultValue:
            "The active company or user changed. Reopen the page before saving.",
        }),
      );
    try {
      const next: PersonalPageLayoutResponse = await saveModulePageLayout(
        scope,
        {
          expectedRevision,
          layout:
            placements === null
              ? null
              : {
                  schemaVersion: 1,
                  moduleId: scope.moduleId,
                  pageId,
                  widgets: [...placements],
                },
        },
      );
      if (!isCurrent(scopeKey)) return;
      queryClient.setQueryData(queryKey, next);
      await queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    } catch (error) {
      if (error instanceof ModulePageLayoutError && error.status === 409) {
        void layout.refetch();
        throw new Error(
          t("pageComposition.saveConflict", {
            defaultValue:
              "This page was changed in another session. Your draft is still open; cancel and reopen the editor to use the latest saved layout.",
          }),
        );
      }
      throw error;
    }
  };
  const pending = environment.pending;
  const request =
    pending &&
    pending.moduleId === moduleId &&
    (!pending.pageId || pending.pageId === pageId) &&
    pending.expiresAt > Date.now()
      ? {
          id: pending.requestId,
          kind: pending.kind,
          widgetKey: pending.widgetKey,
          prompt: pending.prompt,
        }
      : null;
  if (!permitted) return <>{children}</>;
  const insights = placement === "insights";
  return (
    <>
      {insights ? children : null}
      <div
        className={insights ? "contents" : "min-w-0 space-y-4"}
        data-testid={`module-page-composition-${moduleId}-${pageId}`}
      >
        {layout.error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
          >
            <p>
              {t("pageComposition.serviceUnavailable", {
                defaultValue:
                  "Page customization is temporarily unavailable. Your module remains available.",
              })}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void layout.refetch()}
            >
              {t("common.retry")}
            </Button>
          </div>
        )}
        <PageComposition
          value={layout.error ? null : (layout.data?.layout?.widgets ?? null)}
          defaultValue={defaultValue}
          catalog={catalog}
          revision={layout.data?.revision ?? null}
          canEdit={permitted && !layout.error && layout.isSuccess}
          isLoading={isLoading || layout.isPending}
          onSave={onSave}
          onDraftChange={setDraft}
          onCreateWidget={canCreateWidgets ? () => openEditor() : undefined}
          onConfigureWidget={
            canCreateWidgets
              ? (placement: PageWidgetPlacement) => {
                  const row = savedById.get(placement.widgetId);
                  const initial = row ? queryBuilderDraftFromWidget(row) : null;
                  return initial ? openEditor(initial) : Promise.resolve(null);
                }
              : undefined
          }
          request={request}
          onRequestHandled={settle}
          actionTarget={actionTarget}
          insights={insights}
          scopeNote={
            savedWidgetScopeNote ??
            (placement !== "dashboard"
              ? t("pageComposition.insightScope", {
                  defaultValue:
                    "Widgets use the operating company and their own filters. A date range applies to each widget’s configured date field.",
                })
              : undefined)
          }
        >
          {insights ? undefined : children}
        </PageComposition>
        <Sheet
          open={editor !== null}
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
        >
          <SheetContent size="review">
            <SheetHeader>
              <SheetTitle>
                {t("pageComposition.buildWidget", {
                  defaultValue: "Build a widget",
                })}
              </SheetTitle>
              <SheetDescription>
                {t("pageComposition.buildWidgetDescription", {
                  defaultValue:
                    "Choose a metric, its filters and a display. Preview the result before adding it to this page.",
                })}
              </SheetDescription>
            </SheetHeader>
            {editor && (
              <div className="px-4 pb-6">
                <QueryBuilder
                  key={editor.id}
                  organizationId={BigInt(scope.organizationId)}
                  companyId={BigInt(scope.companyId)}
                  dashboards={[]}
                  initialDraft={editor.initialDraft}
                  pageTitle={title}
                  status={editorStatus}
                  onStatusChange={setEditorStatus}
                  onCreated={onCreated}
                />
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

"use client";

import {
  createContext,
  useContext,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { HistoryBounds } from "@lumiere/erp-shared/history-period";
import type { DashboardSection } from "../lib/dashboard-types";

/** The application supplies persistence and data; module pages keep their renderers. */
export interface PageCompositionMountProps {
  active?: boolean;
  moduleId: string;
  pageId: string;
  title: string;
  sections?: readonly DashboardSection[];
  /** Content joins native work to the layout; insights adds an optional separate area. */
  placement?: "dashboard" | "insights" | "content";
  /** The owning page supplies its resolved period; null means the selection is invalid. */
  historyBounds?: HistoryBounds | null;
  /** Explains page controls (such as currency) that do not scope saved widgets. */
  savedWidgetScopeNote?: string;
  /** Header target for the edit launcher; null means the target has not mounted. */
  actionTarget?: HTMLElement | null;
  isLoading?: boolean;
  children?: ReactNode;
}

const PageCompositionActionTargetContext = createContext<
  HTMLElement | null | undefined
>(undefined);
export const PageCompositionActionTargetProvider =
  PageCompositionActionTargetContext.Provider;

export function usePageCompositionActionSlot() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return { target, slot: <div ref={setTarget} className="contents" /> };
}

const PageCompositionHostContext =
  createContext<ComponentType<PageCompositionMountProps> | null>(null);

export function PageCompositionHostProvider({
  component,
  children,
}: {
  component: ComponentType<PageCompositionMountProps>;
  children: ReactNode;
}) {
  return (
    <PageCompositionHostContext.Provider value={component}>
      {children}
    </PageCompositionHostContext.Provider>
  );
}

/** Standalone module fixtures and consumers retain their original content. */
export function ModulePageComposition(props: PageCompositionMountProps) {
  const Host = useContext(PageCompositionHostContext);
  const inheritedTarget = useContext(PageCompositionActionTargetContext);
  return Host && props.active !== false ? (
    <Host
      {...props}
      actionTarget={
        props.actionTarget === undefined ? inheritedTarget : props.actionTarget
      }
    />
  ) : (
    <>{props.children}</>
  );
}

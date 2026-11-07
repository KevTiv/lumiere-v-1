"use client";

import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import type { DashboardSection } from "../lib/dashboard-types";

/** The application supplies persistence and data; module pages keep their renderers. */
export interface PageCompositionMountProps {
  moduleId: string;
  pageId: string;
  title: string;
  sections?: readonly DashboardSection[];
  isLoading?: boolean;
  children?: ReactNode;
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
  return Host ? <Host {...props} /> : <>{props.children}</>;
}

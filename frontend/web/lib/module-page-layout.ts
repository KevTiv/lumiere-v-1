import {
  decodePersonalPageLayoutResponse,
  validatePersonalPageLayoutRequest,
  type PersonalPageLayoutResponse,
  type PersonalPageModule,
  type SavePersonalPageLayoutRequest,
} from "@lumiere/presentation-core/personal-page-layout";
import { apiFetch } from "@lumiere/query-hooks/http";

export interface ModulePageScope {
  identity: string;
  organizationId: string;
  companyId: string;
  moduleId: PersonalPageModule;
  pageId: string;
}

export const modulePageQueryKey = (scope: ModulePageScope) =>
  [
    "personal-page-layout",
    scope.identity,
    scope.organizationId,
    scope.companyId,
    scope.moduleId,
    scope.pageId,
  ] as const;

export class ModulePageLayoutError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ModulePageLayoutError";
  }
}

export function modulePageLayoutUrl(
  scope: Pick<ModulePageScope, "companyId" | "moduleId" | "pageId">,
): string {
  return `/api/presentation/pages/${encodeURIComponent(scope.moduleId)}/${encodeURIComponent(scope.pageId)}?companyId=${encodeURIComponent(scope.companyId)}`;
}

async function readResponse(
  response: Response,
  scope: ModulePageScope,
): Promise<PersonalPageLayoutResponse> {
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      value &&
      typeof value === "object" &&
      "error" in value &&
      typeof value.error === "string"
        ? value.error
        : "The page layout could not be loaded or saved. Please try again.";
    throw new ModulePageLayoutError(message, response.status);
  }
  return decodePersonalPageLayoutResponse(value, scope);
}

export async function fetchModulePageLayout(
  scope: ModulePageScope,
  signal?: AbortSignal,
) {
  return readResponse(
    await apiFetch(modulePageLayoutUrl(scope), { signal }),
    scope,
  );
}

export async function saveModulePageLayout(
  scope: ModulePageScope,
  body: SavePersonalPageLayoutRequest,
) {
  validatePersonalPageLayoutRequest(body);
  return readResponse(
    await apiFetch(modulePageLayoutUrl(scope), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    scope,
  );
}

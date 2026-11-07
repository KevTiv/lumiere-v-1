import Ajv from "ajv";
import schema from "../schema/personal-page-layout.schema.json";
import type {
  PersonalPageLayout,
  PersonalPageLayoutResponse,
  PersonalPageModule,
  SavePersonalPageLayoutRequest,
} from "./generated/personal-page-layout";

export type {
  PersonalPageLayout,
  PersonalPageLayoutResponse,
  PersonalPageModule,
  PersonalPageWidgetPlacement,
  SavePersonalPageLayoutRequest,
} from "./generated/personal-page-layout";

const schemaId = "urn:lumiere:personal-page-layout:v1";
const ajv = new Ajv({ strict: false, allErrors: false });
ajv.addSchema(schema, schemaId);
const saved = ajv.compile<PersonalPageLayoutResponse>({
  $ref: `${schemaId}#/definitions/PersonalPageLayoutResponse`,
});
const request = ajv.compile<SavePersonalPageLayoutRequest>({
  $ref: `${schemaId}#/definitions/SavePersonalPageLayoutRequest`,
});

/** The native contract owns the module inventory used by the editor and harness. */
export const PERSONAL_PAGE_MODULES: readonly PersonalPageModule[] = schema
  .definitions.PersonalPageModule.enum as readonly PersonalPageModule[];

export const PERSONAL_PAGE_MAX_WIDGETS =
  schema.definitions.PersonalPageLayout.properties.widgets.maxItems;

export function isPersonalPageModule(
  value: string,
): value is PersonalPageModule {
  return (PERSONAL_PAGE_MODULES as readonly string[]).includes(value);
}

const decimal = (value: string) =>
  /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;

function validPlacements(layout: PersonalPageLayout | null): boolean {
  if (!layout) return true;
  const instances = new Set<string>();
  const builtins = new Set<string>();
  for (const widget of layout.widgets) {
    if (instances.has(widget.id)) return false;
    instances.add(widget.id);
    if (widget.source === "saved") {
      if (!decimal(widget.widgetId)) return false;
    } else {
      if (builtins.has(widget.widgetId)) return false;
      builtins.add(widget.widgetId);
    }
  }
  return true;
}

export function decodePersonalPageLayoutResponse(
  value: unknown,
  expected?: Pick<
    PersonalPageLayoutResponse,
    "companyId" | "moduleId" | "pageId"
  >,
): PersonalPageLayoutResponse {
  if (
    !saved(value) ||
    !decimal(value.companyId) ||
    (value.revision !== null && !decimal(value.revision)) ||
    (expected &&
      (value.companyId !== expected.companyId ||
        value.moduleId !== expected.moduleId ||
        value.pageId !== expected.pageId)) ||
    (value.layout &&
      (value.revision === null ||
        value.layout.moduleId !== value.moduleId ||
        value.layout.pageId !== value.pageId)) ||
    !validPlacements(value.layout)
  ) {
    throw new Error("Invalid saved page layout response");
  }
  return value;
}

export function validatePersonalPageLayoutRequest(
  value: unknown,
): asserts value is SavePersonalPageLayoutRequest {
  if (
    !request(value) ||
    (value.expectedRevision !== null && !decimal(value.expectedRevision)) ||
    !validPlacements(value.layout)
  ) {
    throw new Error("Invalid page layout changes");
  }
}

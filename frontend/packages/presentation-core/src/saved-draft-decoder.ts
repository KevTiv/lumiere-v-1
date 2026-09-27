import Ajv from 'ajv';
import schema from '../schema/saved-draft-contract.schema.json';
import type { SavedDraft, SavedDraftList } from './generated/saved-draft-contract';

const ajv = new Ajv({ allErrors: false, strict: false });
for (const [name, maximum] of [['uint16', 65535], ['uint32', 4294967295]] as const) {
  ajv.addFormat(name, { type: 'number', validate: value => Number.isInteger(value) && value >= 0 && value <= maximum });
}
const id = 'urn:lumiere:presentation:saved:v1';
ajv.addSchema(schema, id);
const saved = ajv.compile<SavedDraft>({ $ref: `${id}#/definitions/SavedDraft` });
const list = ajv.compile<SavedDraftList>({ $ref: `${id}#/definitions/SavedDraftList` });
const revision = (value: string) => /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;

/** Decode a complete snapshot without losing revision precision or fields. */
export function decodeSavedDraft(value: unknown): SavedDraft {
  if (!saved(value) || !revision(value.revision) || value.definition.baseRevision !== value.revision
    || value.moduleKey !== value.definition.moduleId || !/^[a-f0-9]{64}$/.test(value.definitionHash)) {
    throw new Error('Invalid saved module response');
  }
  return value;
}

/** Decode the bounded list of personal module heads. */
export function decodeSavedDraftList(value: unknown): SavedDraftList {
  if (!list(value) || value.drafts.length > 100 || value.drafts.some(draft => !revision(draft.revision))
    || new Set(value.drafts.map(draft => draft.moduleKey)).size !== value.drafts.length) {
    throw new Error('Invalid saved module list');
  }
  return value;
}

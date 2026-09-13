import Ajv from 'ajv';
import schema from '../schema/preview-contract.schema.json';
import type { PreviewOptions, PreviewResponse } from './generated/preview-contract';

const ajv = new Ajv({ allErrors: false, strict: false });
for (const [name, maximum] of [['uint16', 65535], ['uint32', 4294967295]] as const) {
  ajv.addFormat(name, { type: 'number', validate: value => Number.isInteger(value) && value >= 0 && value <= maximum });
}
const id = 'urn:lumiere:presentation:preview:v1';
ajv.addSchema(schema, id);
const response = ajv.compile<PreviewResponse>({ $ref: `${id}#/definitions/PreviewResponse` });
const options = ajv.compile<PreviewOptions>({ $ref: `${id}#/definitions/PreviewOptions` });

/** Validate the server response using the schema generated from Rust. */
export function decodePreviewResponse(value: unknown): PreviewResponse {
  if (!response(value)) throw new Error('Invalid module preview response');
  return value;
}

/** Decode actor-filtered composer options without accepting arbitrary fields. */
export function decodePreviewOptions(value: unknown): PreviewOptions {
  if (!options(value)) throw new Error('Invalid module preview options');
  return value;
}

type Row = Record<string, unknown>;

/** The wire body the hook sends: the two options are SATS `some` / `none` (see `toSignatureRequestParams`). */
export type SignatureRequestParams = {
  provider: string;
  externalEnvelopeId: string;
  signersJson: { some: string } | { none: [] };
  metadata: { none: [] };
};

export type SignatureRequestResult =
  | { ok: true; params: SignatureRequestParams }
  | { ok: false; reason: 'provider' | 'envelope' | 'signers' };

/**
 * `create_document_signature_request` (document:write) rejects a deleted document ("Cannot request
 * signature on a deleted document"), so the action is only offered while the document is live.
 */
export function canRequestSignature(document: Row): boolean {
  return (document.isDeleted ?? document.is_deleted) !== true;
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Signer e-mail addresses from free text (one per line, or separated by commas or semicolons); null if any is malformed. */
export function parseSignerEmails(raw: unknown): string[] | null {
  const parts = String(raw ?? '')
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const unique: string[] = [];
  for (const part of parts) {
    if (!EMAIL.test(part)) return null;
    if (!unique.some((seen) => seen.toLowerCase() === part.toLowerCase())) unique.push(part);
  }
  return unique;
}

/**
 * Params for `create_document_signature_request`: the reducer trims and requires a provider and an
 * external envelope id. Signers are optional and stored as `signers_json`, a JSON array of
 * `{ "email": ... }` objects (the shape the signatures tab counts). The params struct is missing from
 * the encoder's option-field table, so `signers_json` and `metadata` are spelled as SATS `some` / `none`.
 */
export function toSignatureRequestParams(values: Row | null | undefined): SignatureRequestResult {
  const provider = String(values?.provider ?? '').trim();
  if (provider === '') return { ok: false, reason: 'provider' };
  const externalEnvelopeId = String(values?.externalEnvelopeId ?? '').trim();
  if (externalEnvelopeId === '') return { ok: false, reason: 'envelope' };
  const emails = parseSignerEmails(values?.signers);
  if (emails == null) return { ok: false, reason: 'signers' };
  return {
    ok: true,
    params: {
      provider,
      externalEnvelopeId,
      signersJson: emails.length === 0 ? { none: [] } : { some: JSON.stringify(emails.map((email) => ({ email }))) },
      metadata: { none: [] },
    },
  };
}

import { objectValue, stringValue } from "./codecs.ts";
import { checkedScope, scopeKey, type ProjectionScope } from "./contracts.ts";
import {
  projectionResource,
  projectionSchemaHash,
} from "./generated/product-category.ts";

export const MAX_OFFLINE_GRANT_SECONDS = 86_400;
export interface OfflineGrantTrust {
  deploymentId: string;
  maximumLifetimeSeconds: number;
  keys: { keyId: string; publicKey: string }[];
}
export interface SignedOfflineGrant {
  version: 1;
  algorithm: "ES256";
  keyId: string;
  payload: string;
  signature: string;
}
export interface OfflineGrantClaims {
  version: 1;
  resource: string;
  deploymentId: string;
  audience: string;
  schemaHash: string;
  scope: Readonly<ProjectionScope>;
  issuedAt: number;
  expiresAt: number;
}
export class OfflineGrantError extends Error {
  constructor() {
    super("Offline access is invalid or expired; reconnect to verify access");
    this.name = "OfflineGrantError";
  }
}
function seconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new OfflineGrantError();
  return value;
}
function label(value: unknown): string {
  const result = stringValue(value);
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(result)) throw new OfflineGrantError();
  return result;
}
export function decodeGrantBytes(
  value: string,
  maximum: number,
): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > maximum * 2)
    throw new OfflineGrantError();
  const bytes = Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (char) => char.charCodeAt(0),
  );
  if (bytes.length > maximum || encodeGrantBytes(bytes) !== value)
    throw new OfflineGrantError();
  return bytes;
}
export function encodeGrantBytes(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function checkedGrantTrust(value: unknown): OfflineGrantTrust {
  const trust = objectValue(value, [
    "deploymentId",
    "maximumLifetimeSeconds",
    "keys",
  ]);
  const maximum = seconds(trust.maximumLifetimeSeconds);
  if (
    maximum < 1 ||
    maximum > MAX_OFFLINE_GRANT_SECONDS ||
    !Array.isArray(trust.keys) ||
    trust.keys.length < 1 ||
    trust.keys.length > 8
  )
    throw new OfflineGrantError();
  const keys = trust.keys.map((value) => {
    const key = objectValue(value, ["keyId", "publicKey"]);
    const bytes = decodeGrantBytes(stringValue(key.publicKey), 65);
    if (bytes.length !== 65 || bytes[0] !== 4) throw new OfflineGrantError();
    return { keyId: label(key.keyId), publicKey: stringValue(key.publicKey) };
  });
  if (new Set(keys.map((key) => key.keyId)).size !== keys.length)
    throw new OfflineGrantError();
  return {
    deploymentId: label(trust.deploymentId),
    maximumLifetimeSeconds: maximum,
    keys,
  };
}
export function checkedSignedGrant(value: unknown): SignedOfflineGrant {
  const grant = objectValue(value, [
    "version",
    "algorithm",
    "keyId",
    "payload",
    "signature",
  ]);
  if (grant.version !== 1 || grant.algorithm !== "ES256")
    throw new OfflineGrantError();
  const payload = stringValue(grant.payload);
  const signature = stringValue(grant.signature);
  if (
    decodeGrantBytes(payload, 3000).length === 0 ||
    decodeGrantBytes(signature, 64).length !== 64
  )
    throw new OfflineGrantError();
  return {
    version: 1,
    algorithm: "ES256",
    keyId: label(grant.keyId),
    payload,
    signature,
  };
}

/** Only build-pinned public keys grant trust. Neither the lease nor cached storage supplies a key. */
export async function verifyOfflineGrant(
  value: unknown,
  configuredTrust: OfflineGrantTrust,
  expected: {
    audience: string;
    now: number;
    scope?: ProjectionScope;
    companyId?: string;
  },
): Promise<Readonly<OfflineGrantClaims>> {
  try {
    const trust = checkedGrantTrust(configuredTrust);
    const grant = checkedSignedGrant(value);
    const key = trust.keys.find((key) => key.keyId === grant.keyId);
    if (!key) throw new OfflineGrantError();
    const imported = await crypto.subtle.importKey(
      "raw",
      decodeGrantBytes(key.publicKey, 65),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const message = new TextEncoder().encode(
      `lumiere-offline-category-grant-v1.${grant.keyId}.${grant.payload}`,
    );
    if (
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        imported,
        decodeGrantBytes(grant.signature, 64),
        message,
      ))
    )
      throw new OfflineGrantError();
    const claims = objectValue(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          decodeGrantBytes(grant.payload, 3000),
        ),
      ),
      [
        "version",
        "resource",
        "deploymentId",
        "audience",
        "schemaHash",
        "scope",
        "issuedAt",
        "expiresAt",
      ],
    );
    const scope = checkedScope(claims.scope);
    const issuedAt = seconds(claims.issuedAt),
      expiresAt = seconds(claims.expiresAt),
      now = seconds(expected.now);
    if (
      claims.version !== 1 ||
      claims.resource !== projectionResource ||
      claims.deploymentId !== trust.deploymentId ||
      claims.audience !== expected.audience ||
      claims.schemaHash !== projectionSchemaHash ||
      issuedAt > now ||
      expiresAt <= now ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > trust.maximumLifetimeSeconds ||
      (expected.scope && scopeKey(scope) !== scopeKey(expected.scope)) ||
      (expected.companyId !== undefined &&
        scope.companyId !== expected.companyId)
    )
      throw new OfflineGrantError();
    return Object.freeze({
      version: 1,
      resource: projectionResource,
      deploymentId: trust.deploymentId,
      audience: expected.audience,
      schemaHash: projectionSchemaHash,
      scope,
      issuedAt,
      expiresAt,
    });
  } catch {
    throw new OfflineGrantError();
  }
}

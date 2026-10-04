import {
  checkedSignedGrant,
  verifyOfflineGrant,
  OfflineGrantError,
  type OfflineGrantTrust,
  type SignedOfflineGrant,
  type OfflineGrantClaims,
} from "../../packages/offline/src/offline-grant.ts";
import type { ProjectionScope } from "../../packages/offline/src/contracts.ts";
import { objectValue } from "../../packages/offline/src/codecs.ts";
import {
  OFFLINE_REVOCATION_KEY,
  OFFLINE_GRANT_KEY,
} from "../lib/offline-lifecycle.ts";

interface StoredGrant {
  grant: SignedOfflineGrant;
  lastSeenAt: number;
  marker: string | null;
}
/** Local metadata is not a trust anchor or an online credential. There is one current lease. */
export class OfflineGrantCache {
  readonly #admissions = new WeakMap<object, string>();
  constructor(
    readonly trust: OfflineGrantTrust | null,
    readonly audience: string,
    readonly storage: Storage,
    readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}
  clear(): void {
    this.storage.removeItem(OFFLINE_GRANT_KEY);
  }
  private marker(): string | null {
    return this.storage.getItem(OFFLINE_REVOCATION_KEY);
  }
  private read(): StoredGrant {
    const record = objectValue(
      JSON.parse(this.storage.getItem(OFFLINE_GRANT_KEY) ?? "null"),
      ["grant", "lastSeenAt", "marker"],
    );
    if (
      typeof record.lastSeenAt !== "number" ||
      !Number.isSafeInteger(record.lastSeenAt) ||
      record.lastSeenAt < 0 ||
      (record.marker !== null && typeof record.marker !== "string") ||
      record.marker !== this.marker() ||
      this.now() < record.lastSeenAt
    )
      throw new OfflineGrantError();
    return {
      grant: checkedSignedGrant(record.grant),
      lastSeenAt: record.lastSeenAt,
      marker: record.marker,
    };
  }
  async save(
    value: unknown,
    scope: ProjectionScope,
  ): Promise<Readonly<OfflineGrantClaims>> {
    if (!this.trust) throw new OfflineGrantError();
    const marker = this.marker();
    const claims = await verifyOfflineGrant(value, this.trust, {
      audience: this.audience,
      now: this.now(),
      scope,
    });
    if (marker !== this.marker()) throw new OfflineGrantError();
    this.#admissions.set(claims, JSON.stringify(checkedSignedGrant(value)));
    this.storage.setItem(
      OFFLINE_GRANT_KEY,
      JSON.stringify({
        grant: checkedSignedGrant(value),
        lastSeenAt: this.now(),
        marker,
      } satisfies StoredGrant),
    );
    return claims;
  }
  async load(companyId?: string): Promise<Readonly<OfflineGrantClaims>> {
    if (!this.trust) throw new OfflineGrantError();
    const record = this.read();
    const claims = await verifyOfflineGrant(record.grant, this.trust, {
      audience: this.audience,
      now: this.now(),
      companyId,
    });
    this.#admissions.set(claims, JSON.stringify(record.grant));
    this.requireCurrent(claims);
    return claims;
  }
  /** Called before displaying/keeping rows; detects observed rollback and lease replacement. */
  requireCurrent(claims: OfflineGrantClaims): void {
    const record = this.read();
    if (
      this.#admissions.get(claims) !== JSON.stringify(record.grant) ||
      this.now() < claims.issuedAt ||
      this.now() >= claims.expiresAt
    )
      throw new OfflineGrantError();
    this.storage.setItem(
      OFFLINE_GRANT_KEY,
      JSON.stringify({ ...record, lastSeenAt: this.now() }),
    );
  }
}

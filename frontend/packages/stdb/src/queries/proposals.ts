import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Lazy imports (generated after spacetime publish + generate) ───────────────
// These imports will resolve once bindings are regenerated from the proposals module.
// Using `any` cast as a bridge until regeneration; swap to proper Infer<> after.

// ── Row types ─────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Proposal = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProposalSection = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProposalVersion = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProposalSourceDoc = Record<string, any>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function proposalsSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM proposal WHERE organization_id = ${id}`,
    `SELECT * FROM proposal_section WHERE organization_id = ${id}`,
    `SELECT * FROM proposal_version WHERE organization_id = ${id}`,
    `SELECT * FROM proposal_source_doc WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryProposals(): Proposal[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = conn.db as any;
  if (!db.proposal) return [];
  return [...db.proposal.iter()].sort(
    (a: Proposal, b: Proposal) =>
      Number(b.writeDate ?? b.createDate ?? 0) - Number(a.writeDate ?? a.createDate ?? 0),
  );
}

export function queryProposalSections(): ProposalSection[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = conn.db as any;
  if (!db.proposal_section) return [];
  return [...db.proposal_section.iter()].sort(
    (a: ProposalSection, b: ProposalSection) => (a.sequence ?? 0) - (b.sequence ?? 0),
  );
}

export function queryProposalVersions(): ProposalVersion[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = conn.db as any;
  if (!db.proposal_version) return [];
  return [...db.proposal_version.iter()].sort(
    (a: ProposalVersion, b: ProposalVersion) =>
      Number(b.versionNumber ?? 0) - Number(a.versionNumber ?? 0),
  );
}

export function queryProposalSourceDocs(): ProposalSourceDoc[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = conn.db as any;
  if (!db.proposal_source_doc) return [];
  return [...db.proposal_source_doc.iter()].sort(
    (a: ProposalSourceDoc, b: ProposalSourceDoc) =>
      Number(b.addedAt ?? 0) - Number(a.addedAt ?? 0),
  );
}

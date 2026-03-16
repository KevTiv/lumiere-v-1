import LeadRow from "../generated/lead_table";
import OpportunityRow from "../generated/opportunity_table";
import ContactRow from "../generated/contact_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type Lead = Infer<typeof LeadRow>;
export type Opportunity = Infer<typeof OpportunityRow>;
export type Contact = Infer<typeof ContactRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function crmSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM lead WHERE organization_id = ${id}`,
    `SELECT * FROM opportunity WHERE organization_id = ${id}`,
    `SELECT * FROM contact WHERE organization_id = ${id}`,
    `SELECT * FROM contact_tag WHERE organization_id = ${id}`,
    `SELECT * FROM lead_source WHERE organization_id = ${id}`,
    `SELECT * FROM opportunity_stage WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryLeads(): Lead[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.lead.iter()].sort(
    (a, b) => Number(b.createDate ?? 0) - Number(a.createDate ?? 0),
  );
}

export function queryOpportunities(): Opportunity[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.opportunity.iter()].sort(
    (a, b) => Number(b.expectedRevenue ?? 0) - Number(a.expectedRevenue ?? 0),
  );
}

export function queryContacts(): Contact[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.contact.iter()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

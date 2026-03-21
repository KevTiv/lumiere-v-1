import HelpdeskTicketRow from "../generated/helpdesk_ticket_table";
import HelpdeskTeamRow from "../generated/helpdesk_team_table";
import HelpdeskStageRow from "../generated/helpdesk_stage_table";
import HelpdeskSlaRow from "../generated/helpdesk_sla_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type HelpdeskTicket = Infer<typeof HelpdeskTicketRow>;
export type HelpdeskTeam = Infer<typeof HelpdeskTeamRow>;
export type HelpdeskStage = Infer<typeof HelpdeskStageRow>;
export type HelpdeskSla = Infer<typeof HelpdeskSlaRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function helpdeskSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM helpdesk_ticket WHERE organization_id = ${id}`,
    `SELECT * FROM helpdesk_team WHERE organization_id = ${id}`,
    `SELECT * FROM helpdesk_stage WHERE organization_id = ${id}`,
    `SELECT * FROM helpdesk_sla WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryHelpdeskTickets(): HelpdeskTicket[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.helpdesk_ticket.iter()].sort(
    (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
  );
}

export function queryHelpdeskTeams(): HelpdeskTeam[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.helpdesk_team.iter()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

export function queryHelpdeskStages(): HelpdeskStage[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.helpdesk_stage.iter()];
}

export function queryHelpdeskSLAs(): HelpdeskSla[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.helpdesk_sla.iter()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

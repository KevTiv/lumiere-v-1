import type { ProjectionScope } from "./contracts.ts";
import { ProjectionResetError } from "./http-transport.ts";

export type BrowserCommand =
  | {
      type: "init";
      scope: ProjectionScope;
      wasmUrl: string;
      filename?: string;
      port: MessagePort;
    }
  | { type: "get"; key: string }
  | { type: "list"; limit?: number }
  | { type: "checkpoint" | "sync" | "clear" | "close" }
  | { type: "cancel"; target: number };
export type BrowserRequest = BrowserCommand & { id: number };
export interface WireError {
  message: string;
  status?: number;
}
export type BrowserReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: WireError };
export type TransportRequest =
  | { id: number; type: "snapshot" | "pull"; cursor?: string }
  | { id: number; type: "cancel" };

export function wireError(error: unknown): WireError {
  return {
    message:
      error instanceof Error ? error.message : "Browser projection failed",
    ...(error instanceof ProjectionResetError ? { status: error.status } : {}),
  };
}
export function fromWireError(error: WireError): Error {
  return error.status === undefined
    ? new Error(error.message)
    : new ProjectionResetError(error.status);
}

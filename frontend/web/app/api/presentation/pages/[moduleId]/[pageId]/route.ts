import type { NextRequest } from "next/server";
import { forwardToApiServerRequired } from "@/lib/api-server-forward";

export function GET(request: NextRequest) {
  return forwardToApiServerRequired(request);
}

export function PUT(request: NextRequest) {
  return forwardToApiServerRequired(request);
}

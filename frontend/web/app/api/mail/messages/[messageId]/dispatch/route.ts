import type { NextRequest } from 'next/server';
import { forwardToApiServerRequired } from '@/lib/api-server-forward';

/** Exact reviewed message only; authenticated forwarding retains the existing origin checks. */
export async function POST(request: NextRequest) {
  return forwardToApiServerRequired(request);
}

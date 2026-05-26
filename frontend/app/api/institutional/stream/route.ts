/**
 * Proxy the backend SSE stream for institutional alerts to the browser.
 *
 * Key constraint: do NOT pass req.signal to the upstream fetch.
 * Next.js fires req.signal when the *request* phase ends, which kills the
 * upstream connection before any data flows.  Instead we bridge the streams
 * manually and let natural back-pressure handle client disconnects.
 */
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = process.env.BACKEND_URL    ?? "http://localhost:8000";
const API_KEY  = process.env.BACKEND_API_KEY ?? "";

const SSE_HEADERS = {
  "Content-Type":      "text/event-stream",
  "Cache-Control":     "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  Connection:          "keep-alive",
};

export async function GET(_req: NextRequest) {
  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/api/v1/institutional/stream`, {
      headers: {
        Accept:       "text/event-stream",
        "X-API-Key":  API_KEY,
        Connection:   "keep-alive",
      },
      // ⚠️  No signal — req.signal fires at request-end and kills SSE early.
      // ⚠️  No duplex — SSE is read-only; duplex is only for request body streaming.
      cache: "no-store",
    });
  } catch (e: unknown) {
    console.warn("[/api/institutional/stream] backend unreachable:", e);
    // Return empty SSE — EventSource will auto-reconnect
    return new Response(": backend-unavailable\n\n", { status: 200, headers: SSE_HEADERS });
  }

  if (!upstream.ok || !upstream.body) {
    console.warn("[/api/institutional/stream] upstream status:", upstream.status);
    return new Response(`: upstream-error-${upstream.status}\n\n`, { status: 200, headers: SSE_HEADERS });
  }

  // Pipe the backend body directly to the browser
  return new Response(upstream.body, { status: 200, headers: SSE_HEADERS });
}

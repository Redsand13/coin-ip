/**
 * SSE proxy — pipes FastAPI's Redis pub/sub stream to the browser.
 * The browser connects here (same origin), Next.js forwards to the backend.
 */
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL    = process.env.BACKEND_URL    ?? "http://localhost:8000";
const BACKEND_API_KEY = process.env.BACKEND_API_KEY ?? "";

export async function GET(req: NextRequest) {
  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND_URL}/api/v1/signals/stream`, {
      headers: {
        Accept:      "text/event-stream",
        "X-API-Key": BACKEND_API_KEY,
      },
      signal: req.signal,   // abort when the browser disconnects
      // @ts-expect-error — Node.js fetch needs duplex for streaming
      duplex: "half",
    });
  } catch {
    return new Response("stream unavailable", { status: 503 });
  }

  if (!backendRes.ok || !backendRes.body) {
    return new Response("stream unavailable", { status: 503 });
  }

  return new Response(backendRes.body, {
    status: 200,
    headers: {
      "Content-Type":    "text/event-stream",
      "Cache-Control":   "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection:        "keep-alive",
    },
  });
}

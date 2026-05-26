/**
 * Proxy: /api/institutional/flow → backend /api/v1/institutional/flow
 * Runs server-side so BACKEND_URL and BACKEND_API_KEY stay secret.
 */
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.BACKEND_URL    ?? "http://localhost:8000";
const API_KEY  = process.env.BACKEND_API_KEY ?? "";
const TIMEOUT_MS = 7_000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const upstream = `${BACKEND}/api/v1/institutional/flow${qs ? `?${qs}` : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(upstream, {
      headers: { "X-API-Key": API_KEY },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ symbols: [], count: 0, tracked: 0 }));
      return Response.json(body, { status: res.status });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return Response.json({ symbols: [], count: 0, tracked: 0 }, { status: 504 });
    }
    console.error("[/api/institutional/flow] upstream error:", e);
    return Response.json({ symbols: [], count: 0, tracked: 0 }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}

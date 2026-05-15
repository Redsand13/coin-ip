/**
 * Push subscription management — proxies to the FastAPI backend which
 * stores subscriptions in PostgreSQL (not a local JSON file).
 */
import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const API_KEY = process.env.BACKEND_API_KEY ?? "";

const backendHeaders = {
  "Content-Type": "application/json",
  "X-API-Key": API_KEY,
};

async function proxy(req: NextRequest, method: string): Promise<NextResponse> {
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND}/api/v1/push`, {
      method,
      headers: backendHeaders,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export const POST   = (req: NextRequest) => proxy(req, "POST");
export const PATCH  = (req: NextRequest) => proxy(req, "PATCH");
export const DELETE = (req: NextRequest) => proxy(req, "DELETE");

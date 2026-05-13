/**
 * Push subscription management.
 * Subscriptions are stored in a JSON file (no SQLite) since the backend
 * sends the actual push notifications via VAPID.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
  pages: string[];
}

const SUBS_FILE = path.join(process.cwd(), "data", "push_subscriptions.json");

function readSubs(): PushSub[] {
  try {
    fs.mkdirSync(path.dirname(SUBS_FILE), { recursive: true });
    if (!fs.existsSync(SUBS_FILE)) return [];
    return JSON.parse(fs.readFileSync(SUBS_FILE, "utf-8"));
  } catch { return []; }
}

function writeSubs(subs: PushSub[]): void {
  fs.mkdirSync(path.dirname(SUBS_FILE), { recursive: true });
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

// POST /api/push — save or update a push subscription
export async function POST(req: NextRequest) {
  try {
    const { endpoint, keys, pages } = await req.json() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      pages: string[];
    };

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    const subs = readSubs();
    const idx = subs.findIndex((s) => s.endpoint === endpoint);
    const sub: PushSub = { endpoint, p256dh: keys.p256dh, auth: keys.auth, pages: pages ?? [] };
    if (idx >= 0) subs[idx] = sub;
    else subs.push(sub);
    writeSubs(subs);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Push API] POST error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH /api/push — update pages for existing subscription
export async function PATCH(req: NextRequest) {
  try {
    const { endpoint, pages } = await req.json() as { endpoint: string; pages: string[] };
    if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

    const subs = readSubs();
    const idx = subs.findIndex((s) => s.endpoint === endpoint);
    if (idx >= 0) { subs[idx].pages = pages ?? []; writeSubs(subs); }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Push API] PATCH error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE /api/push — remove a push subscription
export async function DELETE(req: NextRequest) {
  try {
    const { endpoint } = await req.json() as { endpoint: string };
    if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

    writeSubs(readSubs().filter((s) => s.endpoint !== endpoint));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Push API] DELETE error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

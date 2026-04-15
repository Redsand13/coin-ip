import { NextRequest, NextResponse } from "next/server";
import {
  upsertPushSubscription,
  updatePushSubscriptionPages,
  deletePushSubscription,
} from "@/lib/db";

// POST /api/push — save or update a push subscription
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { endpoint, keys, pages } = body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      pages: string[];
    };

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    upsertPushSubscription(endpoint, keys.p256dh, keys.auth, pages ?? []);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Push API] POST error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH /api/push — update pages for existing subscription
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { endpoint, pages } = body as { endpoint: string; pages: string[] };

    if (!endpoint) {
      return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
    }

    updatePushSubscriptionPages(endpoint, pages ?? []);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Push API] PATCH error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// DELETE /api/push — remove a push subscription
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { endpoint } = body as { endpoint: string };

    if (!endpoint) {
      return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
    }

    deletePushSubscription(endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Push API] DELETE error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

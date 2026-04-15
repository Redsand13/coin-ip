import { exportCsv } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const source = searchParams.get("source") ?? undefined;
  const timeframe = searchParams.get("timeframe") ?? undefined;
  const signalType = searchParams.get("signalType") ?? undefined;
  const minScore = searchParams.get("minScore") ? Number(searchParams.get("minScore")) : undefined;
  const fromTs = searchParams.get("fromTs") ? Number(searchParams.get("fromTs")) : undefined;
  const toTs = searchParams.get("toTs") ? Number(searchParams.get("toTs")) : undefined;
  const search = searchParams.get("search") ?? undefined;

  const csv = exportCsv({ source, timeframe, signalType, minScore, fromTs, toTs, search });

  const safeDateStr = (ts: number | undefined) => {
    if (!ts || isNaN(ts)) return undefined;
    try {
      return new Date(ts).toISOString().slice(0, 10);
    } catch {
      return undefined;
    }
  };

  const filename = [
    "signals",
    source,
    timeframe,
    safeDateStr(fromTs) ? `from_${safeDateStr(fromTs)}` : undefined,
    safeDateStr(toTs) ? `to_${safeDateStr(toTs)}` : undefined,
    search ? `search_${search.replace(/[^a-z0-9]/gi, "_")}` : undefined,
    signalType,
    minScore != null ? `score${minScore}+` : undefined,
    !fromTs && !toTs ? safeDateStr(Date.now()) : undefined,
  ]
    .filter(Boolean)
    .join("_") + ".csv";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

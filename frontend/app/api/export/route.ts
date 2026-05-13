import { NextRequest, NextResponse } from "next/server";
import { fetchSignalsCsv, type SignalQueryParams } from "@/lib/api-client";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const source     = searchParams.get("source")    ?? undefined;
  const timeframe  = searchParams.get("timeframe") ?? undefined;
  const minScore   = searchParams.get("minScore")  ? Number(searchParams.get("minScore")) : undefined;
  const fromTs     = searchParams.get("fromTs")    ? Number(searchParams.get("fromTs"))   : undefined;
  const toTs       = searchParams.get("toTs")      ? Number(searchParams.get("toTs"))     : undefined;

  const params: SignalQueryParams = {};
  if (source    && source    !== "all") params.source    = source    as SignalQueryParams["source"];
  if (timeframe && timeframe !== "all") params.timeframe = timeframe;
  if (minScore  !== undefined)          params.min_ml_score = minScore / 100;

  const csv = await fetchSignalsCsv(params);

  const safeDate = (ts: number | undefined) => {
    if (!ts || isNaN(ts)) return undefined;
    try { return new Date(ts).toISOString().slice(0, 10); } catch { return undefined; }
  };

  const filename = [
    "signals",
    source,
    timeframe,
    fromTs ? `from_${safeDate(fromTs)}` : undefined,
    toTs   ? `to_${safeDate(toTs)}`     : undefined,
    minScore != null ? `score${minScore}+` : undefined,
    safeDate(Date.now()),
  ].filter(Boolean).join("_") + ".csv";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

"use server";

import { calculateCoingeckoSignals } from "@/lib/services/coingecko";
import { getICTSignals } from "@/lib/services/ict";
import { upsertSignals, exportCsv, querySignals, queryDistinctSymbols, type DbSignal } from "@/lib/db";
import { sendPushToPage } from "@/lib/services/push";

const ALL_TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"];

/**
 * Scans ALL timeframes in parallel and returns every signal combined.
 * Each timeframe's results are also persisted to SQLite.
 */
export async function getBinanceFuturesSignalsAction(timeframe: string = "1h") {
  try {
    const { getBinanceFuturesSignals } = await import("@/lib/services/binance");

    const tfsToScan = timeframe === "all" ? ALL_TIMEFRAMES : [timeframe];
    const allResults: Awaited<ReturnType<typeof getBinanceFuturesSignals>>[] = [];

    // Scan timeframes sequentially — parallel would trigger Binance 418 IP ban
    for (const tf of tfsToScan) {
      try {
        const sigs = await getBinanceFuturesSignals(tf);
        allResults.push(sigs);
      } catch (err) {
        console.warn(`⚠️ [BF] Scan failed for ${tf}:`, err);
        allResults.push([]);
      }
    }

    // Flatten, deduplicate by entryId, persist to DB
    const seen = new Set<string>();
    const allSignals: Awaited<ReturnType<typeof getBinanceFuturesSignals>> = [];

    for (const signals of allResults) {
      for (const sig of signals) {
        const id = `${sig.coinId}::${sig.signalType}::${sig.timeframe}::${sig.crossoverTimestamp}`;
        if (seen.has(id)) continue;
        seen.add(id);
        allSignals.push(sig);
      }
    }

    if (allSignals.length > 0) {
      try {
        const inserted = upsertSignals(allSignals, "binance");
        if (inserted > 0) {
          console.log(`💾 [DB] Saved ${inserted} new Binance signals (${timeframe})`);
          // Send background push to subscribers
          const top = allSignals.slice(0, 3);
          const isBull = top[0]?.signalType === "BUY";
          const emoji = isBull ? "🟢" : "🔴";
          const body = top.map(s => `${s.symbol} ${s.signalType} · ${s.timeframe.toUpperCase()} · Score ${s.score}`).join("\n");
          sendPushToPage("Binance Futures", {
            title: `${emoji} ${inserted} New Binance Signal${inserted > 1 ? "s" : ""}`,
            body,
            icon: top[0]?.image || "/favicon.ico",
            url: "/binance",
          }).catch(() => {});
        }
      } catch (dbErr) {
        console.warn("⚠️ [DB] Binance upsert failed:", dbErr);
      }
    }

    return allSignals;
  } catch (error) {
    console.error("Error fetching Binance signals:", error);
    return [];
  }
}

/**
 * Get CoinGecko signals + persist new ones to SQLite.
 * Passing timeframe="all" scans every timeframe sequentially.
 */
export async function getCoingeckoSignalsAction(timeframe: string = "1h") {
  try {
    const tfsToScan = timeframe === "all" ? ALL_TIMEFRAMES : [timeframe];
    const allResults: Awaited<ReturnType<typeof calculateCoingeckoSignals>>[] = [];

    for (const tf of tfsToScan) {
      try {
        const sigs = await calculateCoingeckoSignals(tf);
        allResults.push(sigs);
      } catch (err) {
        console.warn(`⚠️ [CG] Scan failed for ${tf}:`, err);
        allResults.push([]);
      }
    }

    // Flatten and deduplicate
    const seen = new Set<string>();
    const allSignals: Awaited<ReturnType<typeof calculateCoingeckoSignals>> = [];
    for (const signals of allResults) {
      for (const sig of signals) {
        const id = `${sig.coinId}::${sig.signalType}::${sig.timeframe}::${sig.crossoverTimestamp}`;
        if (seen.has(id)) continue;
        seen.add(id);
        allSignals.push(sig);
      }
    }

    if (allSignals.length > 0) {
      try {
        const inserted = upsertSignals(allSignals, "coingecko");
        if (inserted > 0) console.log(`💾 [DB] Saved ${inserted} new CoinGecko signals (${timeframe})`);
      } catch (dbErr) {
        console.warn("⚠️ [DB] CoinGecko upsert failed:", dbErr);
      }
    }

    return allSignals;
  } catch (error) {
    console.error("Error fetching CoinGecko signals:", error);
    return [];
  }
}

/**
 * Get ICT / SMC signals — scans ALL timeframes sequentially, returns combined
 */
export async function getICTSignalsAction(timeframe: string = "1h") {
  try {
    const tfsToScan = timeframe === "all" ? ALL_TIMEFRAMES : [timeframe];
    const allResults: Awaited<ReturnType<typeof getICTSignals>>[] = [];

    for (const tf of tfsToScan) {
      try {
        const sigs = await getICTSignals(tf);
        allResults.push(sigs);
      } catch (err) {
        console.warn(`⚠️ [ICT] Scan failed for ${tf}:`, err);
        allResults.push([]);
      }
    }

    // Flatten and deduplicate by coinId::signalType::timeframe::sweepTimestamp
    const seen = new Set<string>();
    const allSignals: Awaited<ReturnType<typeof getICTSignals>> = [];
    for (const signals of allResults) {
      for (const sig of signals) {
        const id = `${sig.coinId}::${sig.signalType}::${sig.timeframe}::${sig.sweepTimestamp}`;
        if (seen.has(id)) continue;
        seen.add(id);
        allSignals.push(sig);
      }
    }

    // Persist ICT signals to DB
    if (allSignals.length > 0) {
      try {
        const mapped = allSignals.map(s => ({
          coinId: s.coinId,
          symbol: s.symbol,
          name: s.name,
          image: s.image,
          signalType: s.signalType,
          signalName: s.setupType,
          timeframe: s.timeframe,
          score: s.score,
          price: s.currentPrice,
          crossoverTimestamp: s.sweepTimestamp,
          candlesAgo: s.candlesSinceSweep,
          stopLoss: s.stopLoss,
          takeProfit: s.takeProfit,
          volatility: 0,
          formula: s.formula,
          ema7: 0,
          ema25: 0,
          ema99: 0,
          crossoverStrength: s.riskReward,
          change1h: 0,
          change24h: s.change24h,
          volume24h: s.volume24h,
          marketCap: 0,
        }));
        const inserted = upsertSignals(mapped, "ict");
        if (inserted > 0) {
          console.log(`💾 [DB] Saved ${inserted} new ICT signals (${timeframe})`);
          // Send background push to ICT subscribers
          const top = allSignals.slice(0, 3);
          const isBull = top[0]?.signalType === "LONG";
          const emoji = isBull ? "🟢" : "🔴";
          const body = top.map(s => `${s.symbol} ${s.signalType} · ${s.timeframe.toUpperCase()} · ${s.setupType}`).join("\n");
          sendPushToPage("ICT / SMC", {
            title: `${emoji} ${inserted} New ICT Signal${inserted > 1 ? "s" : ""}`,
            body,
            icon: top[0]?.image || "/favicon.ico",
            url: "/ict",
          }).catch(() => {});
        }
      } catch (dbErr) {
        console.warn("⚠️ [DB] ICT upsert failed:", dbErr);
      }
    }

    return allSignals.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("Error fetching ICT signals:", error);
    return [];
  }
}

/**
 * Fetch signals directly from the database with optional filters.
 * Powers the "Signal History" page.
 */
export async function getDbSignalsAction(opts: {
  source?: string;
  timeframe?: string;
  minScore?: number;
  fromTs?: number;
  toTs?: number;
  search?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ signals: DbSignal[]; total: number }> {
  try {
    const source = opts.source === "all" ? undefined : opts.source;
    const timeframe = opts.timeframe === "all" ? undefined : opts.timeframe;
    const pageSize = opts.pageSize ?? 50;
    const page = opts.page ?? 1;
    const offset = (page - 1) * pageSize;

    // Get total count for pagination
    const allForCount = querySignals({ source, timeframe, minScore: opts.minScore, fromTs: opts.fromTs, toTs: opts.toTs, search: opts.search, limit: -1 });
    const total = allForCount.length;

    // Get just this page
    const signals = querySignals({
      source,
      timeframe,
      minScore: opts.minScore,
      fromTs: opts.fromTs,
      toTs: opts.toTs,
      search: opts.search,
      limit: pageSize,
      offset,
    });

    return { signals, total };
  } catch (error) {
    console.error("Error querying DB signals:", error);
    return { signals: [], total: 0 };
  }
}

/**
 * Return distinct symbols stored in the DB for a given source (or all sources).
 */
export async function getDbSymbolsAction(source?: string): Promise<string[]> {
  try {
    return queryDistinctSymbols(source && source !== "all" ? source : undefined);
  } catch {
    return [];
  }
}

/**
 * Scans ALL sources × ALL timeframes sequentially and persists every signal.
 * Called from the History page "Sync" button to ensure the DB is fully populated.
 * Returns total counts stored.
 */
export async function syncAllTimeframesAction(): Promise<{ binance: number; coingecko: number; ict: number }> {
  let binanceCount = 0, coingeckoCount = 0, ictCount = 0;

  // Binance — all timeframes
  try {
    const { getBinanceFuturesSignals } = await import("@/lib/services/binance");
    for (const tf of ALL_TIMEFRAMES) {
      try {
        const sigs = await getBinanceFuturesSignals(tf);
        if (sigs.length > 0) binanceCount += upsertSignals(sigs, "binance");
      } catch { /* skip failed TF */ }
      await new Promise(r => setTimeout(r, 500)); // respect rate limits
    }
  } catch { /* ignore */ }

  // CoinGecko — all timeframes
  try {
    for (const tf of ALL_TIMEFRAMES) {
      try {
        const sigs = await calculateCoingeckoSignals(tf);
        if (sigs.length > 0) coingeckoCount += upsertSignals(sigs, "coingecko");
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }

  // ICT — all timeframes
  try {
    for (const tf of ALL_TIMEFRAMES) {
      try {
        const sigs = await getICTSignals(tf);
        if (sigs.length > 0) {
          const mapped = sigs.map(s => ({
            coinId: s.coinId, symbol: s.symbol, name: s.name, image: s.image,
            signalType: s.signalType, signalName: s.setupType, timeframe: s.timeframe,
            score: s.score, price: s.currentPrice, crossoverTimestamp: s.sweepTimestamp,
            candlesAgo: s.candlesSinceSweep, stopLoss: s.stopLoss, takeProfit: s.takeProfit,
            volatility: 0, formula: s.formula, ema7: 0, ema25: 0, ema99: 0,
            crossoverStrength: s.riskReward, change1h: 0, change24h: s.change24h,
            volume24h: s.volume24h, marketCap: 0,
          }));
          ictCount += upsertSignals(mapped, "ict");
        }
      } catch { /* skip */ }
      await new Promise(r => setTimeout(r, 500));
    }
  } catch { /* ignore */ }

  return { binance: binanceCount, coingecko: coingeckoCount, ict: ictCount };
}

/**
 * Export signals as CSV string — called from the export API route
 */
export async function exportSignalsCsvAction(
  source?: string,
  timeframe?: string,
  minScore?: number,
  fromTs?: number,
  toTs?: number
): Promise<string> {
  try {
    return exportCsv({ source, timeframe, minScore, fromTs, toTs });
  } catch (error) {
    console.error("Error exporting CSV:", error);
    return "";
  }
}

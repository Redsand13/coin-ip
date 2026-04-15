/**
 * Node.js-only background signal scanner.
 * Imported exclusively from instrumentation.ts under NEXT_RUNTIME === "nodejs",
 * so the Edge bundler never traces these Node.js-only imports.
 *
 * Stores all sources × all timeframes to SQLite every 1 minute,
 * and sends Web Push notifications for every brand-new signal —
 * even when no browser tab is open.
 */

export {}; // marks this as a module so TypeScript accepts the dynamic import()

const ALL_TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"];
const SCAN_INTERVAL_MS = 60_000; // every 1 minute
const INITIAL_DELAY_MS  = 20_000;    // wait 20s after server start before first scan

// Track signal IDs we've already sent push notifications for — prevents duplicate alerts
// across scanner cycles. Capped at 2000 entries to avoid unbounded growth.
const sentPushIds = new Set<string>();
const MAX_SENT_IDS = 2000;

function addSentId(id: string) {
  sentPushIds.add(id);
  if (sentPushIds.size > MAX_SENT_IDS) {
    // Remove oldest entries (Set preserves insertion order)
    const iter = sentPushIds.values();
    for (let i = 0; i < 200; i++) {
      const { value, done } = iter.next();
      if (done) break;
      sentPushIds.delete(value);
    }
  }
}

console.log("📡 [BG] Signal scanner registered — will start in 20s");

setTimeout(() => {
  runScan(); // first scan
  setInterval(runScan, SCAN_INTERVAL_MS);
}, INITIAL_DELAY_MS);

let scanning = false; // lock — prevents overlapping scans

async function runScan() {
  if (scanning) {
    console.log("⏭️ [BG] Previous scan still running — skipping this cycle");
    return;
  }
  scanning = true;
  const start = Date.now();
  console.log("🔄 [BG] Background scan started — all sources × all timeframes");

  try {
    const [
      { getBinanceFuturesSignals },
      { calculateCoingeckoSignals },
      { getICTSignals },
      { upsertSignals, buildSignalId },
      { sendPushToPage },
    ] = await Promise.all([
      import("./lib/services/binance"),
      import("./lib/services/coingecko"),
      import("./lib/services/ict"),
      import("./lib/db"),
      import("./lib/services/push"),
    ]);

    let totalNew = 0;

    // ── Binance — sequential to avoid 418 IP ban ────────────────────────────
    for (const tf of ALL_TIMEFRAMES) {
      try {
        const sigs = await getBinanceFuturesSignals(tf);
        if (sigs.length > 0) {
          const n = upsertSignals(sigs, "binance");
          if (n > 0) {
            console.log(`  ✅ [BG] Binance ${tf}: +${n} new`);
            totalNew += n;

            // Send push for signals not yet notified
            const fresh = sigs.filter(s => {
              const id = buildSignalId(s.coinId, s.signalType, s.timeframe, s.crossoverTimestamp);
              if (sentPushIds.has(id)) return false;
              addSentId(id);
              return true;
            });

            for (const s of fresh.slice(0, 5)) { // cap at 5 pushes per source per cycle
              const isBull = s.signalType === "BUY";
              await sendPushToPage("Binance Futures", {
                title: `${isBull ? "🟢" : "🔴"} ${s.symbol} ${s.signalType}  |  Score ${s.score}`,
                body: [
                  `📊 ${s.name}`,
                  `⏱  ${tf.toUpperCase()} · Binance Futures`,
                  s.signalName ? `🔷 ${s.signalName}` : "",
                  `⚡ Score: ${s.score}/100`,
                ].filter(Boolean).join("\n"),
                icon: s.image || "/favicon.ico",
                url: "/binance",
              }).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.warn(`  ⚠️ [BG] Binance ${tf} failed:`, (e as Error).message);
      }
      // 1200ms gap between timeframes — respect Binance rate limits
      await delay(1200);
    }

    // ── CoinGecko — sequential (API has its own rate limits) ────────────────
    for (const tf of ALL_TIMEFRAMES) {
      try {
        const sigs = await calculateCoingeckoSignals(tf);
        if (sigs.length > 0) {
          const n = upsertSignals(sigs, "coingecko");
          if (n > 0) console.log(`  ✅ [BG] CoinGecko ${tf}: +${n} new`);
          totalNew += n;
        }
      } catch (e) {
        console.warn(`  ⚠️ [BG] CoinGecko ${tf} failed:`, (e as Error).message);
      }
    }

    // ── ICT — sequential (hits Binance Futures too) ──────────────────────────
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
          const n = upsertSignals(mapped, "ict");
          if (n > 0) {
            console.log(`  ✅ [BG] ICT ${tf}: +${n} new`);
            totalNew += n;

            // Send push for signals not yet notified
            const fresh = sigs.filter(s => {
              const id = buildSignalId(s.coinId, s.signalType, s.timeframe, s.sweepTimestamp);
              if (sentPushIds.has(id)) return false;
              addSentId(id);
              return true;
            });

            for (const s of fresh.slice(0, 5)) { // cap at 5 pushes per source per cycle
              const isBull = s.signalType === "LONG";
              await sendPushToPage("ICT / SMC", {
                title: `${isBull ? "🟢" : "🔴"} ${s.symbol} ${s.signalType}  |  Score ${s.score}`,
                body: [
                  `📊 ${s.name}`,
                  `⏱  ${tf.toUpperCase()} · ICT/SMC`,
                  `🔷 ${s.setupType}  |  R:R 1:${s.riskReward}`,
                  `⚡ Score: ${s.score}/100`,
                ].join("\n"),
                icon: s.image || "/favicon.ico",
                url: "/ict",
              }).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.warn(`  ⚠️ [BG] ICT ${tf} failed:`, (e as Error).message);
      }
      await delay(1200);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ [BG] Scan complete in ${elapsed}s — ${totalNew} new signals stored`);
  } catch (err) {
    console.error("❌ [BG] Scan error:", err);
  } finally {
    scanning = false;
  }
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

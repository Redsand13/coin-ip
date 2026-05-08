/**
 * Node.js-only background signal scanner.
 * Imported exclusively from instrumentation.ts under NEXT_RUNTIME === "nodejs".
 *
 * Runs every 30 seconds.
 * - Binance: all 6 timeframes scanned sequentially (WS-backed klines = fast, ~1-3s total)
 * - CoinGecko + ICT: run concurrently with the Binance loop (independent APIs)
 * Sends Web Push notifications for every brand-new signal.
 */

export {};

const ALL_TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"];
const SCAN_INTERVAL_MS = 30_000;  // every 30 seconds
const INITIAL_DELAY_MS = 10_000;  // wait 10s after server start

const sentPushIds = new Set<string>();
const MAX_SENT_IDS = 2000;

function addSentId(id: string) {
  sentPushIds.add(id);
  if (sentPushIds.size > MAX_SENT_IDS) {
    // Trim oldest entries back to 80% capacity so we don't thrash on every add
    const target = Math.floor(MAX_SENT_IDS * 0.8);
    const toDelete = sentPushIds.size - target;
    const iter = sentPushIds.values();
    for (let i = 0; i < toDelete; i++) {
      const { value, done } = iter.next();
      if (done) break;
      sentPushIds.delete(value);
    }
  }
}

console.log("📡 [BG] Signal scanner registered — will start in 10s");

setTimeout(() => {
  runScan();
  setInterval(runScan, SCAN_INTERVAL_MS);
}, INITIAL_DELAY_MS);

let scanning = false;

async function runScan() {
  if (scanning) {
    console.log("⏭️ [BG] Previous scan still running — skipping");
    return;
  }
  scanning = true;
  const start = Date.now();
  console.log("🔄 [BG] Background scan started");

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

    // ── Run sources respecting Binance rate limits ──────────────────────────
    // CoinGecko uses a completely separate API → runs in parallel with Binance.
    // ICT has its own fapiFetch hitting the same Binance Futures quota →
    // runs AFTER Binance finishes to avoid 429 clashes.

    // Binance + CoinGecko in parallel
    await Promise.allSettled([

      // ── Binance — sequential TFs (WS-backed = fast after first seed) ────────
      (async () => {
        for (const tf of ALL_TIMEFRAMES) {
          try {
            const sigs = await getBinanceFuturesSignals(tf);
            if (sigs.length > 0) {
              const n = upsertSignals(sigs, "binance");
              if (n > 0) {
                console.log(`  ✅ [BG] Binance ${tf}: +${n} new`);
                totalNew += n;

                const fresh = sigs.filter(s => {
                  const id = buildSignalId(s.coinId, s.signalType, s.timeframe, s.crossoverTimestamp);
                  if (sentPushIds.has(id)) return false;
                  addSentId(id);
                  return true;
                });

                for (const s of fresh.slice(0, 5)) {
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
          // 300ms gap — enough when WS-backed; REST batches have their own 800ms delay
          await delay(300);
        }
      })(),

      // ── CoinGecko — completely independent API, safe to run in parallel ──────
      (async () => {
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
      })(),

    ]);

    // ── ICT — sequential TFs AFTER Binance (shares Binance Futures rate limit) ─
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

            const fresh = sigs.filter(s => {
              const id = buildSignalId(s.coinId, s.signalType, s.timeframe, s.sweepTimestamp);
              if (sentPushIds.has(id)) return false;
              addSentId(id);
              return true;
            });

            for (const s of fresh.slice(0, 5)) {
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
      await delay(300);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ [BG] Scan complete in ${elapsed}s — ${totalNew} new signals`);
  } catch (err) {
    console.error("❌ [BG] Scan error:", err);
  } finally {
    scanning = false;
  }
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

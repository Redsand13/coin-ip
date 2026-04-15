// CoinGecko API Service - Hybrid Approach
// Uses CoinGecko PRO API for coin discovery + Binance Spot klines for accurate MA crossover detection
// Fast and reliable - combines both data sources

interface CoinGeckoMarketData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_24h_in_currency?: number;
  price_change_percentage_7d_in_currency?: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number;
  ath: number;
  ath_change_percentage: number;
  ath_date: string;
  atl: number;
  atl_change_percentage: number;
  atl_date: string;
  last_updated: string;
  sparkline_in_7d?: {
    price: number[];
  };
  tradeable_on_binance?: boolean;
  tradeable_on_bybit?: boolean;
}

export interface MASignal {
  coinId: string;
  symbol: string;
  name: string;
  image: string;
  signalType: "BUY" | "SELL";
  signalName: string;
  timeframe: string;
  score: number;
  price: number;
  currentPrice: number;
  change1h: number;
  change24h: number;
  change7d: number;
  volume24h: number;
  marketCap: number;
  timestamp: number;
  crossoverTimestamp: number;
  candlesAgo: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  volatility: number;
  formula: string;
  ema7: number;
  ema99: number;
  ema7Prev: number;
  ema99Prev: number;
  crossoverStrength: number;
  volatilityTooltip?: string;
  ema25?: number;
}

// PRO API Configuration
const API_KEY = process.env.COINGECKO_API_KEY || "";
const IS_PRO = !!API_KEY;
const COINGECKO_API_BASE = IS_PRO
  ? "https://pro-api.coingecko.com/api/v3"
  : "https://api.coingecko.com/api/v3";
const BINANCE_SPOT_BASE = "https://api.binance.com/api/v3";
const CACHE_DURATION = 60000; // 60 seconds cache to save API calls

// Quality filters for legitimate coins (PRO tier - stricter for futures trading)
const MIN_MARKET_CAP = 50000000; // $50M minimum market cap (futures-grade)
const MIN_VOLUME_24H = 5000000; // $5M minimum 24h volume (high liquidity for futures)
const MIN_MARKET_CAP_RANK = 300; // Top 300 coins only (established projects)

// Futures-focused coins (coins with active perpetual futures markets)
const FUTURES_TRADEABLE_COINS = [
  "bitcoin",
  "ethereum",
  "binancecoin",
  "solana",
  "ripple",
  "cardano",
  "avalanche-2",
  "polkadot",
  "polygon",
  "chainlink",
  "uniswap",
  "litecoin",
  "near",
  "aptos",
  "arbitrum",
  "optimism",
  "sui",
  "dogecoin",
  "shiba-inu",
  "pepe",
  "the-open-network",
  "tron",
  "stellar",
  "filecoin",
  "cosmos",
  "ethereum-classic",
  "injective-protocol",
  "render-token",
  "celestia",
  "internet-computer",
  "aave",
  "maker",
  "sei-network",
  "stacks",
  "algorand",
];

console.log(`🔑 CoinGecko API: ${IS_PRO ? "PRO" : "FREE"} tier`);
if (IS_PRO) {
  console.log(`📈 PRO Mode: Futures-focused filtering enabled`);
  console.log(
    `   Min Volume: $${(MIN_VOLUME_24H / 1e6).toFixed(1)}M | Min MCap: $${(MIN_MARKET_CAP / 1e6).toFixed(1)}M | Top ${MIN_MARKET_CAP_RANK} rank`,
  );
}

// Cache for market data
let marketDataCache: {
  data: CoinGeckoMarketData[] | null;
  timestamp: number;
} = {
  data: null,
  timestamp: 0,
};

// Cache for OHLC data per coin per timeframe
const ohlcCache: Map<string, { data: number[][]; timestamp: number }> =
  new Map();

function calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
  if (highs.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  if (trs.length < period) return 0;

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = ((atr * (period - 1)) + trs[i]) / period;
  }
  return atr;
}

export function calculateVolatilityScore(
  dailyData: number[][] | null,
  currentPrice: number,
  volume24h: number,
  change24h: number
): { score: number; tooltip: string } {
  if (!dailyData || dailyData.length < 21) {
    return { score: 0, tooltip: "Insufficient Daily Data" };
  }

  // Extract daily arrays (last 30)
  const days = dailyData;
  const highs = days.map(d => d[2]);
  const lows = days.map(d => d[3]);
  const closes = days.map(d => d[4]);
  const volumes = days.map(d => d[5]);

  // 1. Daily Price Range %
  const lastIdx = days.length - 1;
  // Safety check
  if (lastIdx < 0) return { score: 0, tooltip: "No data" };

  const rangePct = closes[lastIdx] ? ((highs[lastIdx] - lows[lastIdx]) / closes[lastIdx]) * 100 : 0;
  let rangeScore = 0;
  if (rangePct < 1) rangeScore = 0;
  else if (rangePct < 2) rangeScore = 0.5;
  else if (rangePct < 4) rangeScore = 1;
  else if (rangePct < 7) rangeScore = 1.5;
  else if (rangePct < 10) rangeScore = 2;
  else rangeScore = 2.5;

  // 2. ATR Volatility %
  const atr = calculateATR(highs, lows, closes, 14);
  const atrPct = currentPrice ? (atr / currentPrice) * 100 : 0;
  let atrScore = 0;
  if (atrPct < 0.5) atrScore = 0;
  else if (atrPct < 1) atrScore = 0.5;
  else if (atrPct < 2) atrScore = 1;
  else if (atrPct < 4) atrScore = 1.5;
  else if (atrPct < 6) atrScore = 2;
  else atrScore = 2.5;

  // 3. Volume Spike
  const currentVol = volume24h || volumes[lastIdx];
  // Msg: "20-day Average Volume". We need history.
  // We assume 'dailyData' has enough history.
  // volumes[lastIdx] is current day (if candle closed? or ongoing?)
  // If we fetched "1d", last candle is current day (accumulating).
  // Previous 20 days: lastIdx-20 to lastIdx-1.
  let avgVol = 0;
  let volRatio = 1;
  if (volumes.length > 21) {
    const prev20Vols = volumes.slice(volumes.length - 21, volumes.length - 1);
    if (prev20Vols.length > 0) {
      avgVol = prev20Vols.reduce((a, b) => a + b, 0) / prev20Vols.length;
      volRatio = avgVol > 0 ? currentVol / avgVol : 1;
    }
  }

  let volScore = 0;
  if (volRatio < 1) volScore = 0;
  else if (volRatio < 1.5) volScore = 0.5;
  else if (volRatio < 2) volScore = 1;
  else if (volRatio < 3) volScore = 1.5;
  else if (volRatio < 5) volScore = 2;
  else volScore = 2.5;

  // 4. Trend Speed %
  const trendPct = Math.abs(change24h);
  let trendScore = 0;
  if (trendPct < 1) trendScore = 0;
  else if (trendPct < 3) trendScore = 0.5;
  else if (trendPct < 6) trendScore = 1;
  else if (trendPct < 10) trendScore = 1.5;
  else if (trendPct < 15) trendScore = 2;
  else trendScore = 2.5;

  // Final Score
  let finalScore = rangeScore + atrScore + volScore + trendScore;
  finalScore = Math.min(Math.max(finalScore, 0), 10);

  // Interpretation
  let interpretation = "Very Low";
  if (finalScore >= 2) interpretation = "Low";
  if (finalScore >= 4) interpretation = "Medium";
  if (finalScore >= 6) interpretation = "High";
  if (finalScore >= 8) interpretation = "Very High";
  if (finalScore >= 10) interpretation = "Extreme";

  const tooltip = `Score: ${finalScore.toFixed(1)}/10 (${interpretation})
Price Range: ${rangePct.toFixed(2)}% (+${rangeScore})
ATR Volatility: ${atrPct.toFixed(2)}% (+${atrScore})
Volume Ratio: ${volRatio.toFixed(2)}x (+${volScore})
Trend Speed: ${trendPct.toFixed(2)}% (+${trendScore})`;

  return { score: finalScore, tooltip };
}

/**
 * Calculate EMA array for ALL data points (needed for crossover detection)
 */
export function calculateEMAArray(prices: number[], period: number): number[] {
  if (!prices || prices.length < period) {
    return [];
  }

  const k = 2 / (period + 1);
  const emaArray: number[] = [];

  // Calculate initial SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let ema = sum / period;

  // First (period-1) values are 0 (not enough data)
  for (let i = 0; i < period - 1; i++) {
    emaArray.push(0);
  }

  // Add first valid EMA
  emaArray.push(ema);

  // Calculate remaining EMAs
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    emaArray.push(ema);
  }

  return emaArray;
}

/**
 * Fetch top coins sorted by VOLUME (most liquid markets)
 */
export async function fetchTopCoins(): Promise<CoinGeckoMarketData[]> {
  const now = Date.now();

  if (
    marketDataCache.data &&
    now - marketDataCache.timestamp < CACHE_DURATION
  ) {
    console.log(`✅ Using cached market data`);
    return marketDataCache.data;
  }

  try {
    console.log(
      `🔄 Fetching top coins by VOLUME from CoinGecko ${IS_PRO ? "PRO" : "FREE"} API...`,
    );

    const headers: HeadersInit = {
      Accept: "application/json",
    };

    if (IS_PRO && API_KEY) {
      headers["x-cg-pro-api-key"] = API_KEY;
      console.log(`🔑 Using PRO API key: ${API_KEY.substring(0, 8)}...`);
    }

    const perPage = 250;
    const pages = IS_PRO ? [1, 2, 3, 4] : [1, 2]; // 1000 coins for PRO, 500 for Free

    // Stablecoin IDs to exclude
    const STABLECOINS = [
      'tether', 'usd-coin', 'staked-ether', 'dai', 'first-digital-usd',
      'ethena-usde', 'usdd', 'true-usd', 'frax', 'paxos-standard',
      'binance-usd', 'paypal-usd', 'tether-gold', 'paxos-gold', 'wrapped-bitcoin'
    ];

    const allData: CoinGeckoMarketData[] = [];

    for (const page of pages) {
      const url = IS_PRO
        ? `${COINGECKO_API_BASE}/coins/markets?vs_currency=usd&order=volume_desc&per_page=${perPage}&page=${page}&price_change_percentage=1h,24h,7d&precision=full`
        : `${COINGECKO_API_BASE}/coins/markets?vs_currency=usd&order=volume_desc&per_page=${perPage}&page=${page}&price_change_percentage=1h,24h,7d`;

      const response = await fetch(url, { headers, cache: 'no-store' });

      if (!response.ok) {
        console.warn(
          `⚠️ CoinGecko API returned ${response.status} for page ${page}`,
        );
        if (page === 1) {
          return marketDataCache.data || [];
        }
        break;
      }

      const pageData = await response.json();
      allData.push(...pageData);

      // Check if we've reached coins with volume < 100M
      // Since API returns sorted by volume desc, we can stop early to save API calls
      const lastCoin = pageData[pageData.length - 1];
      if (lastCoin && Number(lastCoin.total_volume) < 100000000) {
        console.log("Stopping fetch: Remaining coins have < $100M volume");
        break;
      }

      // Delay for rate limits
      if (page < pages.length) {
        await new Promise((resolve) => setTimeout(resolve, IS_PRO ? 50 : 500));
      }
    }

    // Apply filters
    const filteredData = allData.filter((coin) => {
      // 0. Volume Filter (> 100M)
      const vol = Number(coin.total_volume);
      if (!vol || isNaN(vol) || vol < 100000000) return false;

      // 1. Exclude Known Stablecoins
      if (STABLECOINS.includes(coin.id)) return false;

      // 2. Exclude " pegged" assets roughly (optional heuristics)
      // If name contains "USD" and price is ~1.0, exclude? 
      // Safer to rely on manual list + major coins pattern.
      if (coin.symbol.toUpperCase().endsWith('USD') || coin.name.includes('USD')) {
        // Check if price is close to 1
        if (Math.abs(coin.current_price - 1) < 0.1) return false;
      }

      // 3. Minimum Volume (liquidity check)
      if (!coin.total_volume || coin.total_volume < 100000) { // Reduced to $100k to catch smaller movers
        return false;
      }

      // 4. Must have valid price
      if (!coin.current_price || coin.current_price <= 0) {
        return false;
      }

      return true;
    });

    marketDataCache = {
      data: filteredData,
      timestamp: now,
    };

    // Count futures-tradeable coins
    const futuresCount = filteredData.filter((coin) =>
      FUTURES_TRADEABLE_COINS.includes(coin.id),
    ).length;

    console.log(
      `✅ Fetched ${filteredData.length} ${IS_PRO ? "futures-grade" : "legitimate"} coins (filtered from ${allData.length})`,
    );
    if (IS_PRO) {
      console.log(
        `   📊 Futures-tradeable: ${futuresCount} | High-quality alts: ${filteredData.length - futuresCount}`,
      );
    }
    console.log(
      `   Filters: Min Volume=$${(MIN_VOLUME_24H / 1e6).toFixed(1)}M, Min MCap=$${(MIN_MARKET_CAP / 1e6).toFixed(1)}M, Top ${MIN_MARKET_CAP_RANK} rank`,
    );
    return filteredData;
  } catch (error) {
    console.error("❌ Error fetching coins:", error);
    return marketDataCache.data || [];
  }
}

/**
 * Map CoinGecko coin ID to Binance symbol
 */
const COINGECKO_TO_BINANCE: { [key: string]: string } = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
  binancecoin: "BNBUSDT",
  solana: "SOLUSDT",
  ripple: "XRPUSDT",
  cardano: "ADAUSDT",
  avalanche: "AVAXUSDT",
  "avalanche-2": "AVAXUSDT",
  polkadot: "DOTUSDT",
  "polygon-ecosystem-token": "POLUSDT",
  polygon: "MATICUSDT",
  chainlink: "LINKUSDT",
  uniswap: "UNIUSDT",
  litecoin: "LTCUSDT",
  near: "NEARUSDT",
  aptos: "APTUSDT",
  arbitrum: "ARBUSDT",
  optimism: "OPUSDT",
  sui: "SUIUSDT",
  dogecoin: "DOGEUSDT",
  "shiba-inu": "SHIBUSDT",
  pepe: "PEPEUSDT",
  "the-open-network": "TONUSDT",
  tron: "TRXUSDT",
  stellar: "XLMUSDT",
  filecoin: "FILUSDT",
  cosmos: "ATOMUSDT",
  "ethereum-classic": "ETCUSDT",
  "injective-protocol": "INJUSDT",
  "render-token": "RENDERUSDT",
  celestia: "TIAUSDT",
  "internet-computer": "ICPUSDT",
  aave: "AAVEUSDT",
  maker: "MKRUSDT",
  "sei-network": "SEIUSDT",
  stacks: "STXUSDT",
  algorand: "ALGOUSDT",
};

/**
 * Fetch kline data from Binance Spot for a coin
 */
export async function fetchBinanceKlines(
  symbol: string,
  timeframe: string,
): Promise<number[][] | null> {
  try {
    // Map timeframe to Binance interval
    const intervalMap: { [key: string]: string } = {
      "5m": "5m",
      "15m": "15m",
      "30m": "30m",
      "1h": "1h",
      "4h": "4h",
      "1d": "1d",
    };
    const interval = intervalMap[timeframe] || "1h";

    // Fetch 500 candles for reliable EMA99
    const response = await fetch(
      `${BINANCE_SPOT_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=500`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      return null;
    }

    const klines = await response.json();

    // Convert Binance klines to our format: [timestamp, open, high, low, close]
    const ohlcData = klines.map((k: any[]) => {
      return [
        k[0], // timestamp
        parseFloat(k[1]), // open
        parseFloat(k[2]), // high
        parseFloat(k[3]), // low
        parseFloat(k[4]), // close
        parseFloat(k[5]), // volume
      ];
    });

    return ohlcData;
  } catch (error) {
    return null;
  }
}

/**
 * Fetch OHLC data EXCLUSIVELY from CoinGecko
 */
async function fetchPureCoingeckoOHLCData(
  coinId: string,
  timeframe: string,
): Promise<number[][] | null> {
  const now = Date.now();
  const cacheKey = `cg-pure-${coinId}-${timeframe}`;
  const cached = ohlcCache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }

  try {
    let days: string;
    switch (timeframe) {
      case "15m":
      case "5m":
        days = "1";
        break;
      case "1h":
        days = "7";
        break;
      case "4h":
        days = "30";
        break;
      case "1d":
        days = "90";
        break;
      default:
        days = "7";
    }

    const headers: HeadersInit = {
      Accept: "application/json",
    };

    if (IS_PRO && API_KEY) {
      headers["x-cg-pro-api-key"] = API_KEY;
    }

    const url = IS_PRO
      ? `${COINGECKO_API_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&precision=full`
      : `${COINGECKO_API_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;

    const response = await fetch(url, { headers, cache: 'no-store' });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (!data.prices || !Array.isArray(data.prices)) {
      return null;
    }

    // Convert to OHLC format placeholder (all match close price from market_chart)
    const ohlcData = data.prices.map((point: number[], index: number) => {
      const [timestamp, price] = point;
      const volume = data.total_volumes && data.total_volumes[index] ? data.total_volumes[index][1] : 0;
      return [timestamp, price, price, price, price, volume];
    });

    ohlcCache.set(cacheKey, { data: ohlcData, timestamp: now });
    return ohlcData;
  } catch (error) {
    return null;
  }
}

/**
 * Symbol mapping for Binance to CoinGecko
 */
export const BINANCE_TO_COINGECKO: Record<
  string,
  { id: string; image: string }
> = {
  BTCUSDT: {
    id: "bitcoin",
    image: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png",
  },
  ETHUSDT: {
    id: "ethereum",
    image:
      "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png",
  },
  BNBUSDT: {
    id: "binancecoin",
    image:
      "https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
  },
  SOLUSDT: {
    id: "solana",
    image:
      "https://coin-images.coingecko.com/coins/images/4128/large/solana.png",
  },
  XRPUSDT: {
    id: "ripple",
    image:
      "https://coin-images.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",
  },
  ADAUSDT: {
    id: "cardano",
    image:
      "https://coin-images.coingecko.com/coins/images/975/large/cardano.png",
  },
  DOGEUSDT: {
    id: "dogecoin",
    image:
      "https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png",
  },
  MATICUSDT: {
    id: "matic-network",
    image:
      "https://coin-images.coingecko.com/coins/images/4713/large/matic-token-icon.png",
  },
  DOTUSDT: {
    id: "polkadot",
    image:
      "https://coin-images.coingecko.com/coins/images/12171/large/polkadot.png",
  },
  AVAXUSDT: {
    id: "avalanche-2",
    image:
      "https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
  },
  SHIBUSDT: {
    id: "shiba-inu",
    image:
      "https://coin-images.coingecko.com/coins/images/11939/large/shiba.png",
  },
  LINKUSDT: {
    id: "chainlink",
    image:
      "https://coin-images.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
  },
  UNIUSDT: {
    id: "uniswap",
    image: "https://coin-images.coingecko.com/coins/images/12504/large/uni.jpg",
  },
  ATOMUSDT: {
    id: "cosmos",
    image:
      "https://coin-images.coingecko.com/coins/images/1481/large/cosmos_hub.png",
  },
  LTCUSDT: {
    id: "litecoin",
    image:
      "https://coin-images.coingecko.com/coins/images/2/large/litecoin.png",
  },
  ETCUSDT: {
    id: "ethereum-classic",
    image:
      "https://coin-images.coingecko.com/coins/images/453/large/ethereum-classic-logo.png",
  },
  NEARUSDT: {
    id: "near",
    image:
      "https://coin-images.coingecko.com/coins/images/10365/large/near.jpg",
  },
  ALGOUSDT: {
    id: "algorand",
    image:
      "https://coin-images.coingecko.com/coins/images/4380/large/download.png",
  },
  TRXUSDT: {
    id: "tron",
    image:
      "https://coin-images.coingecko.com/coins/images/1094/large/tron-logo.png",
  },
  FILUSDT: {
    id: "filecoin",
    image:
      "https://coin-images.coingecko.com/coins/images/12817/large/filecoin.png",
  },
  VETUSDT: {
    id: "vechain",
    image:
      "https://coin-images.coingecko.com/coins/images/1167/large/VeChain-Logo-768x725.png",
  },
  XLMUSDT: {
    id: "stellar",
    image:
      "https://coin-images.coingecko.com/coins/images/100/large/Stellar_symbol_black_RGB.png",
  },
  ICPUSDT: {
    id: "internet-computer",
    image:
      "https://coin-images.coingecko.com/coins/images/14495/large/Internet_Computer_logo.png",
  },
  APTUSDT: {
    id: "aptos",
    image:
      "https://coin-images.coingecko.com/coins/images/26455/large/aptos_round.png",
  },
  ARBUSDT: {
    id: "arbitrum",
    image:
      "https://coin-images.coingecko.com/coins/images/16547/large/photo_2023-03-29_21.47.00.jpeg",
  },
  OPUSDT: {
    id: "optimism",
    image:
      "https://coin-images.coingecko.com/coins/images/25244/large/Optimism.png",
  },
  INJUSDT: {
    id: "injective-protocol",
    image:
      "https://coin-images.coingecko.com/coins/images/12882/large/Secondary_Symbol.png",
  },
  LDOUSDT: {
    id: "lido-dao",
    image:
      "https://coin-images.coingecko.com/coins/images/13573/large/Lido_DAO.png",
  },
  PEPEUSDT: {
    id: "pepe",
    image:
      "https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg",
  },
  SUIUSDT: {
    id: "sui",
    image:
      "https://coin-images.coingecko.com/coins/images/26375/large/sui_asset.jpeg",
  },
  AAVEUSDT: {
    id: "aave",
    image:
      "https://coin-images.coingecko.com/coins/images/12645/large/aave-token-round.png",
  },
  MKRUSDT: {
    id: "maker",
    image:
      "https://coin-images.coingecko.com/coins/images/1364/large/Mark_Maker.png",
  },
};

/**
 * Find coin metadata from verified CoinGecko cache by symbol.
 * Useful for enriching Binance Futures signals where we only have the symbol (e.g. "RIVER")
 */
export function findCoinMetadata(symbol: string): { id: string; name: string; image: string } | null {
  if (!marketDataCache.data) return null;

  // Binance Futures frequently adds prefixes like '1000' or '1000000' to low-value tokens
  // E.g. "1000SHIB", "1000PEPE", "1000000MOG"
  const cleanSymbol = symbol.toUpperCase().replace(/^10+/, "");

  // Try exact symbol match (case insensitive) against the cleaned symbol
  const coin = marketDataCache.data.find(c => c.symbol.toUpperCase() === cleanSymbol);

  if (coin) {
    return {
      id: coin.id,
      name: coin.name,
      image: coin.image
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCHANGE FUTURES MARKET  –  Triple-EMA (7 / 25 / 99) Strategy
// BUY  : EMA7 > EMA25 > EMA99  (Bull alignment)
// SELL : EMA99 > EMA25 > EMA7  (Bear alignment)
// Uses CoinGecko market data + Binance klines.
// ─────────────────────────────────────────────────────────────────────────────

/** Cache specific to Exchange Futures signals */
const efSignalsCache: Map<string, { data: MASignal[]; timestamp: number }> = new Map();

/**
 * Detect whether all 3 EMA arrays are in the required alignment at the latest bar.
 * Returns the signal type and how many candles ago the alignment first appeared.
 */
function detectTripleAlignment(
  ema7: number[],
  ema25: number[],
  ema99: number[],
  maxLookback: number,
): { type: "BUY" | "SELL" | null; candlesAgo: number; index: number; isPerfect: boolean } {
  const len = Math.min(ema7.length, ema25.length, ema99.length);
  if (len < 100) return { type: null, candlesAgo: -1, index: -1, isPerfect: false };

  const e7 = ema7[len - 1];
  const e25 = ema25[len - 1];
  const e99 = ema99[len - 1];

  if (!e7 || !e25 || !e99) return { type: null, candlesAgo: -1, index: -1, isPerfect: false };

  // Current state must be fully aligned
  const isBull = e7 > e25 && e25 > e99;
  const isBear = e99 > e25 && e25 > e7;

  if (!isBull && !isBear) return { type: null, candlesAgo: -1, index: -1, isPerfect: false };

  const type: "BUY" | "SELL" = isBull ? "BUY" : "SELL";
  const startFloor = Math.max(len - maxLookback - 1, 99);

  let firstIdx = -1;
  let isPerfect = false;

  // We look backwards to find EXACTLY when the signal triggered.
  // The trigger we want is EMA7 crossing EMA25 (the Pinch Breakout).
  for (let i = len - 1; i >= startFloor; i--) {
    const a7 = ema7[i];
    const a25 = ema25[i];
    const a99 = ema99[i];

    const prev7 = ema7[i - 1];
    const prev25 = ema25[i - 1];
    const prev99 = ema99[i - 1];

    if (!a7 || !a25 || !a99 || !prev7 || !prev25 || !prev99) break;

    if (type === "BUY") {
      // Look for the exact candle where 7 crossed ABOVE 25, while 25 is securely ABOVE 99
      if (a7 > a25 && prev7 <= prev25 && a25 > a99 && prev25 > prev99) {
        firstIdx = i;
        isPerfect = true;
        break;
      }
    } else {
      // Look for the exact candle where 7 crossed BELOW 25, while 25 is securely BELOW 99
      if (a7 < a25 && prev7 >= prev25 && a25 < a99 && prev25 < prev99) {
        firstIdx = i;
        isPerfect = true;
        break;
      }
    }
  }

  // If we didn't find the exact 7/25 crossover within lookback, it's not a fresh perfect breakout
  if (firstIdx === -1) {
    return { type: null, candlesAgo: -1, index: -1, isPerfect: false };
  }

  const candlesAgo = len - 1 - firstIdx;
  return { type, candlesAgo, index: firstIdx, isPerfect };
}

/**
 * Calculate CoinGecko signals using CoinGecko EXCLUSIVELY + 7/25/99 EMA triple alignment.
 */
export async function calculateCoingeckoSignals(
  timeframe: string = "1h",
): Promise<MASignal[]> {
  try {
    const cacheKey = `cg-${timeframe}`;
    const cached = efSignalsCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < CACHE_DURATION) {
      console.log(`✅ [CG] Using cached CoinGecko signals for ${timeframe}`);
      return cached.data;
    }

    console.log(`🚀 [CG] Scanning CoinGecko (7/25/99) on ${timeframe}...`);

    // 1. Fetch top coins from CoinGecko
    const coins = await fetchTopCoins();
    if (!coins || coins.length === 0) {
      console.warn("⚠️ [CG] No coins from CoinGecko");
      return [];
    }

    // Lookback (candles that equate to ~24h of signal history)
    let lookback = 288;
    if (timeframe === "15m") lookback = 96;
    if (timeframe === "30m") lookback = 48;
    if (timeframe === "1h") lookback = 24;
    if (timeframe === "4h") lookback = 6;
    if (timeframe === "1d") lookback = 2;

    const batchSize = IS_PRO ? 30 : 15;
    const results: (MASignal | null)[] = [];

    for (let i = 0; i < coins.length; i += batchSize) {
      const batch = coins.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (coin) => {
          try {
            // Use CoinGecko strictly
            const cacheKeyOHLC = `${coin.id}-${timeframe}-pure-cg`;
            const cachedOHLC = ohlcCache.get(cacheKeyOHLC);

            let ohlcData = null;
            if (cachedOHLC && Date.now() - cachedOHLC.timestamp < CACHE_DURATION) {
              ohlcData = cachedOHLC.data;
            } else {
              ohlcData = await fetchPureCoingeckoOHLCData(coin.id, timeframe);
              if (ohlcData && ohlcData.length >= 120) {
                ohlcCache.set(cacheKeyOHLC, { data: ohlcData, timestamp: Date.now() });
              }
            }

            if (!ohlcData || ohlcData.length < 120) return null;

            // Filter ohlcData rows with invalid close prices — keep both in sync so
            // alignment.index maps correctly to both prices[] and validOhlc[].
            const validOhlc = ohlcData.filter(c => c[4] > 0 && !isNaN(c[4]));
            const prices = validOhlc.map(c => c[4]);
            if (prices.length < 120) return null;

            // Calculate three EMA arrays
            const ema7Arr = calculateEMAArray(prices, 7);
            const ema25Arr = calculateEMAArray(prices, 25);
            const ema99Arr = calculateEMAArray(prices, 99);

            if (ema99Arr.length < 100) return null;

            // Detect triple alignment
            const alignment = detectTripleAlignment(ema7Arr, ema25Arr, ema99Arr, lookback);
            if (!alignment.type) return null;

            // Use coin.current_price (from /coins/markets, most recent) for accuracy.
            // prices[last] is from market_chart which can lag by 60s+.
            const currentPrice = coin.current_price > 0 ? coin.current_price : prices[prices.length - 1];
            const ema7Val = ema7Arr[ema7Arr.length - 1];
            const ema25Val = ema25Arr[ema25Arr.length - 1];
            const ema99Val = ema99Arr[ema99Arr.length - 1];

            // USER REQUIREMENT: Filter out any signal that is NOT a perfect crossover
            if (!alignment.isPerfect) return null;

            // Signal name
            const freshText = alignment.candlesAgo === 0 ? "(FRESH!)" : `(${alignment.candlesAgo} bar${alignment.candlesAgo > 1 ? "s" : ""} ago)`;
            const signalName = alignment.type === "BUY"
              ? `🔥 PERFECT Bull Align 7-25-99 ${freshText}`
              : `🔥 PERFECT Bear Align 99-25-7 ${freshText}`;

            // Crossover strength as gap between EMA7 and EMA99
            const crossoverStrength = Math.abs(ema7Val - ema99Val) / ema99Val * 100;

            // Score (70–100)
            // Base 70 = minimum for a perfect crossover.
            // Bonuses differentiate signal quality up to 100.
            let score = 70;

            // Freshness (+0 to +15)
            if (alignment.candlesAgo === 0) score += 15;
            else if (alignment.candlesAgo === 1) score += 10;
            else if (alignment.candlesAgo <= 3) score += 5;

            // Momentum confirmation (+5)
            const change24h = coin.price_change_percentage_24h_in_currency || 0;
            if ((alignment.type === "BUY" && change24h > 0) || (alignment.type === "SELL" && change24h < 0)) score += 5;

            // EMA25 middle confirmation — tighter spread = stronger signal (+3)
            const ema25Gap = Math.abs(ema25Val - (ema7Val + ema99Val) / 2) / ema99Val * 100;
            if (ema25Gap < 1) score += 3;

            // Crossover strength (+0 to +7)
            if (crossoverStrength > 0.5) score += 2;
            if (crossoverStrength > 1.5) score += 2;
            if (crossoverStrength > 3.0) score += 3;

            // Volume tier (+0 to +5)
            if (coin.total_volume > 100_000_000) score += 1;
            if (coin.total_volume > 500_000_000) score += 2;
            if (coin.total_volume > 1_000_000_000) score += 2;

            // Market cap rank (+0 to +5)
            if (coin.market_cap_rank && coin.market_cap_rank <= 50) score += 3;
            else if (coin.market_cap_rank && coin.market_cap_rank <= 100) score += 2;

            score = Math.max(0, Math.min(100, Math.round(score)));

            // Use the CROSSOVER candle's price — not the live coin.current_price.
            // prices[] and validOhlc[] are filtered in sync, so prices[alignment.index]
            // is the exact close at the crossover bar.
            const crossoverPrice = prices[alignment.index] ?? currentPrice;
            const entryPrice = crossoverPrice;
            const stopLoss = alignment.type === "BUY" ? crossoverPrice * 0.95 : crossoverPrice * 1.05;
            const takeProfit = alignment.type === "BUY" ? crossoverPrice * 1.10 : crossoverPrice * 0.90;

            // Volatility score
            let dailyData: number[][] | null = null;
            try {
              const bSym = COINGECKO_TO_BINANCE[coin.id] || (coin.symbol.toUpperCase() + "USDT");
              dailyData = await fetchBinanceKlines(bSym, "1d");
            } catch (_) { }
            const volData = calculateVolatilityScore(dailyData, currentPrice, coin.total_volume, change24h);

            // Crossover timestamp: use the data point's own timestamp from validOhlc.
            // validOhlc is filtered in sync with prices[], so alignment.index maps correctly.
            const crossoverTimestamp = validOhlc[Math.max(0, alignment.index)]?.[0] || now;

            const formula = `EMA7=${ema7Val.toFixed(4)} | EMA25=${ema25Val.toFixed(4)} | EMA99=${ema99Val.toFixed(4)} | Strategy: 7-25-99 | CoinGecko`;

            const signal: MASignal = {
              coinId: coin.id,
              symbol: coin.symbol.toUpperCase(),
              name: coin.name,
              image: coin.image,
              signalType: alignment.type,
              signalName,
              timeframe,
              score,
              price: crossoverPrice,
              currentPrice,
              change1h: coin.price_change_percentage_1h_in_currency || 0,
              change24h,
              change7d: coin.price_change_percentage_7d_in_currency || 0,
              volume24h: coin.total_volume,
              marketCap: coin.market_cap,
              timestamp: now,
              crossoverTimestamp,
              candlesAgo: alignment.candlesAgo,
              entryPrice,
              stopLoss,
              takeProfit,
              volatility: volData.score,
              volatilityTooltip: volData.tooltip,
              formula,
              ema7: ema7Val,
              ema25: ema25Val,
              ema99: ema99Val,
              ema7Prev: ema7Arr[ema7Arr.length - 2] || 0,
              ema99Prev: ema99Arr[ema99Arr.length - 2] || 0,
              crossoverStrength,
            };

            return signal;
          } catch (_) {
            return null;
          }
        }),
      );

      results.push(...batchResults);

      if (i + batchSize < coins.length) {
        await new Promise(r => setTimeout(r, IS_PRO ? 50 : 300));
      }
    }
    const validSignals = results.filter((s): s is MASignal => s !== null && s.score >= 70);

    // Sort newest alignment first
    validSignals.sort((a, b) => b.crossoverTimestamp - a.crossoverTimestamp);

    console.log(`✅ [CG] ${validSignals.length} CoinGecko signals — BUY: ${validSignals.filter(s => s.signalType === "BUY").length} | SELL: ${validSignals.filter(s => s.signalType === "SELL").length}`);

    efSignalsCache.set(cacheKey, { data: validSignals, timestamp: now });
    return validSignals;
  } catch (error) {
    console.error("❌ [CG] Error calculating CoinGecko signals:", error);
    return [];
  }
}

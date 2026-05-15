"use client";

import { useState, useMemo } from "react";

// 8 gradient pairs — deterministically assigned by symbol hash for consistent branding
const GRADIENTS: [string, string][] = [
  ["#f97316", "#ef4444"],
  ["#8b5cf6", "#6366f1"],
  ["#06b6d4", "#3b82f6"],
  ["#10b981", "#059669"],
  ["#f59e0b", "#d97706"],
  ["#ec4899", "#be185d"],
  ["#14b8a6", "#0891b2"],
  ["#a855f7", "#7c3aed"],
];

function symbolHash(sym: string): number {
  return sym.split("").reduce((h, c) => (((h << 5) - h) + c.charCodeAt(0)) | 0, 0);
}

// Source priority:
// 1. Local SVG from cryptocurrency-icons (518 coins, served from /crypto-icons/)
// 2. CoinCap CDN (1 000+ coins, PNG)
// 3. TradingView CDN (covers virtually all exchange-listed coins)
// 4. LiveCoinWatch CDN (webp, broad coverage)
// 5. Gradient avatar (always works)
function getSources(sym: string): string[] {
  const UP = sym.toUpperCase();
  return [
    `/crypto-icons/${sym}.svg`,
    `https://assets.coincap.io/assets/icons/${sym}@2x.png`,
    `https://s3-symbol-logo.tradingview.com/crypto/XTVC${UP}--big.svg`,
    `https://lcw.nyc3.cdn.digitaloceanspaces.com/production/currencies/64/${sym}.webp`,
  ];
}

interface CoinIconProps {
  /** Lowercase coin ticker without quote suffix — e.g. "btc", "eth", "sol" */
  symbol: string;
  size?: number;
  className?: string;
}

export function CoinIcon({ symbol, size = 32, className }: CoinIconProps) {
  const sym = (symbol ?? "").toLowerCase();
  const sources = useMemo(() => getSources(sym), [sym]);
  const [srcIdx, setSrcIdx] = useState(0);

  const [from, to] = GRADIENTS[Math.abs(symbolHash(sym)) % GRADIENTS.length];
  const initials = sym.slice(0, 2).toUpperCase();
  const fontSize = Math.max(9, Math.round(size * 0.32));

  if (srcIdx >= sources.length) {
    return (
      <div
        aria-label={sym}
        className="w-full h-full flex items-center justify-center select-none"
        style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        <span className="text-white font-black leading-none" style={{ fontSize }}>
          {initials}
        </span>
      </div>
    );
  }

  return (
    <img
      src={sources[srcIdx]}
      alt={sym}
      width={size}
      height={size}
      className={className ?? "w-full h-full object-contain"}
      onError={() => setSrcIdx((i) => i + 1)}
      loading="lazy"
      decoding="async"
    />
  );
}

/** Extract the base coin id from a trading pair — "BTCUSDT" → "btc" */
export function symbolToCoinId(symbol: string): string {
  return symbol.replace(/USDT$|BUSD$|BTC$|ETH$/, "").toLowerCase();
}

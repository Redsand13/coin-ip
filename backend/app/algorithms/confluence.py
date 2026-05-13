"""
Multi-timeframe confluence engine.

A signal gets a confluence score based on how many timeframes
show alignment in the same direction. Higher timeframes are weighted more.
"""
from dataclasses import dataclass

import pandas as pd

from app.algorithms.ema import EMAStrategy, EMASignal
from app.algorithms.ict import ICTEngine, ICTSetup


_TF_WEIGHT: dict[str, float] = {
    "5m":  0.5,
    "15m": 0.7,
    "30m": 0.85,
    "1h":  1.0,
    "4h":  1.4,
    "1d":  2.0,
}


@dataclass
class ConfluenceResult:
    symbol: str
    direction: str            # LONG | SHORT
    score: float              # 0..1 weighted average
    aligned_timeframes: list[str]
    ema_signals: list[EMASignal]
    ict_setups: list[ICTSetup]
    best_entry_tf: str        # timeframe with highest individual weight


class ConfluenceEngine:
    """
    Combines EMA + ICT signals across timeframes and produces a
    confluence score. Fires only when score >= threshold.
    """

    def __init__(
        self,
        min_score: float = 0.6,
        min_aligned_tfs: int = 2,
    ) -> None:
        self.min_score = min_score
        self.min_aligned_tfs = min_aligned_tfs
        self._ema = EMAStrategy()
        self._ict = ICTEngine()

    def scan(
        self,
        symbol: str,
        candles_by_tf: dict[str, pd.DataFrame],
    ) -> ConfluenceResult | None:
        long_score  = 0.0
        short_score = 0.0
        long_tfs:  list[str] = []
        short_tfs: list[str] = []
        long_ema:  list[EMASignal] = []
        short_ema: list[EMASignal] = []
        long_ict:  list[ICTSetup] = []
        short_ict: list[ICTSetup] = []

        for tf, df in candles_by_tf.items():
            weight = _TF_WEIGHT.get(tf, 1.0)

            # EMA contribution
            ema_sig = self._ema.scan(symbol, tf, df)
            if ema_sig:
                if ema_sig.direction == "LONG":
                    long_score += weight * ema_sig.strength
                    long_tfs.append(tf)
                    long_ema.append(ema_sig)
                else:
                    short_score += weight * ema_sig.strength
                    short_tfs.append(tf)
                    short_ema.append(ema_sig)

            # ICT contribution
            ict_setups = self._ict.scan(symbol, tf, df)
            for setup in ict_setups:
                q_weight = weight * setup.quality
                if setup.direction == "LONG":
                    long_score += q_weight * 0.5
                    if tf not in long_tfs:
                        long_tfs.append(tf)
                    long_ict.append(setup)
                else:
                    short_score += q_weight * 0.5
                    if tf not in short_tfs:
                        short_tfs.append(tf)
                    short_ict.append(setup)

        # Normalise score (max possible ≈ sum of all TF weights × 2)
        max_possible = sum(_TF_WEIGHT.get(tf, 1.0) for tf in candles_by_tf) * 2
        norm_long  = long_score / max_possible if max_possible else 0
        norm_short = short_score / max_possible if max_possible else 0

        if norm_long >= norm_short and norm_long >= self.min_score and len(long_tfs) >= self.min_aligned_tfs:
            best_tf = max(long_tfs, key=lambda t: _TF_WEIGHT.get(t, 1.0))
            return ConfluenceResult(
                symbol=symbol,
                direction="LONG",
                score=round(norm_long, 4),
                aligned_timeframes=sorted(long_tfs, key=lambda t: list(_TF_WEIGHT).index(t) if t in _TF_WEIGHT else 99),
                ema_signals=long_ema,
                ict_setups=long_ict,
                best_entry_tf=best_tf,
            )

        if norm_short > norm_long and norm_short >= self.min_score and len(short_tfs) >= self.min_aligned_tfs:
            best_tf = max(short_tfs, key=lambda t: _TF_WEIGHT.get(t, 1.0))
            return ConfluenceResult(
                symbol=symbol,
                direction="SHORT",
                score=round(norm_short, 4),
                aligned_timeframes=sorted(short_tfs, key=lambda t: list(_TF_WEIGHT).index(t) if t in _TF_WEIGHT else 99),
                ema_signals=short_ema,
                ict_setups=short_ict,
                best_entry_tf=best_tf,
            )

        return None

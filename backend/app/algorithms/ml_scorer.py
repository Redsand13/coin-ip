"""
ML Signal Scorer — XGBoost + LightGBM ensemble.

Trains on historical signal outcomes (outcome_pnl, outcome_hit_tp)
and predicts a win-probability score for new signals.
"""
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import VotingClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler
from xgboost import XGBClassifier

from app.core.logging import get_logger

logger = get_logger(__name__)

_FEATURE_COLS = [
    "price_change_1h", "price_change_4h", "price_change_24h",
    "volume_ratio",     # volume vs 20-bar average
    "ema_spread_fast_mid",  # (ema_fast - ema_mid) / price
    "ema_spread_mid_slow",
    "ema_spread_fast_slow",
    "confluence_score",
    "ict_quality",
    "timeframe_weight",
    "hour_of_day",
    "day_of_week",
    "is_long",
]


def _build_pipeline() -> Pipeline:
    xgb = XGBClassifier(
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        use_label_encoder=False,
        eval_metric="logloss",
        random_state=42,
        n_jobs=-1,
    )
    lgbm = LGBMClassifier(
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1,
        verbose=-1,
    )
    ensemble = VotingClassifier(
        estimators=[("xgb", xgb), ("lgbm", lgbm)],
        voting="soft",
    )
    calibrated = CalibratedClassifierCV(ensemble, cv=3, method="isotonic")
    return Pipeline([("scaler", RobustScaler()), ("clf", calibrated)])


class MLScorer:
    """
    Thread-safe ML scorer with lazy loading and background retraining.
    """

    def __init__(self, model_path: str = "models/signal_scorer.joblib") -> None:
        self._model_path = Path(model_path)
        self._pipeline: Pipeline | None = None
        self._lock = threading.Lock()
        self._last_trained: datetime | None = None
        self._trained_on_n: int = 0

        self._model_path.parent.mkdir(parents=True, exist_ok=True)
        self._try_load()

    # ── public ────────────────────────────────────────────────────────────────

    def predict(self, features: dict[str, Any]) -> tuple[float, float]:
        """Returns (score, confidence) where score = P(win)."""
        with self._lock:
            if self._pipeline is None:
                return 0.5, 0.0

        X = self._features_to_array(features)
        proba = self._pipeline.predict_proba(X)[0]
        score = float(proba[1])
        confidence = float(abs(score - 0.5) * 2)  # 0 when uncertain, 1 when very sure
        return round(score, 4), round(confidence, 4)

    def train(self, df: pd.DataFrame, min_samples: int = 200) -> dict[str, Any]:
        """
        df columns: all feature cols + 'label' (1=win, 0=loss)
        Returns training metrics.
        """
        df = df.dropna(subset=_FEATURE_COLS + ["label"])
        if len(df) < min_samples:
            logger.warning("Not enough samples to train", n=len(df), required=min_samples)
            return {"status": "skipped", "n": len(df)}

        X = df[_FEATURE_COLS].values.astype(np.float32)
        y = df["label"].values.astype(int)

        pipeline = _build_pipeline()
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        cv_scores = cross_val_score(pipeline, X, y, cv=cv, scoring="roc_auc", n_jobs=-1)

        pipeline.fit(X, y)

        with self._lock:
            self._pipeline = pipeline
            self._last_trained = datetime.utcnow()
            self._trained_on_n = len(df)

        joblib.dump(pipeline, self._model_path)
        logger.info("ML model trained", auc=cv_scores.mean(), n=len(df))

        return {
            "status": "trained",
            "n": len(df),
            "cv_auc_mean": float(cv_scores.mean()),
            "cv_auc_std": float(cv_scores.std()),
            "trained_at": self._last_trained.isoformat(),
        }

    @staticmethod
    def build_features(
        signal: dict[str, Any],
        candle_1h: pd.DataFrame | None = None,
        candle_4h: pd.DataFrame | None = None,
        candle_1d: pd.DataFrame | None = None,
    ) -> dict[str, Any]:
        """Extract feature dict from a signal dict and optional higher-TF candles."""
        tf_weights = {"5m": 0.5, "15m": 0.7, "30m": 0.85, "1h": 1.0, "4h": 1.4, "1d": 2.0}

        price = signal.get("price", 1)
        ema_fast = signal.get("ema_fast") or price
        ema_mid  = signal.get("ema_mid")  or price
        ema_slow = signal.get("ema_slow") or price

        def pct_change(df: pd.DataFrame | None, bars: int) -> float:
            if df is None or len(df) < bars + 1:
                return 0.0
            return float((df["close"].iloc[-1] - df["close"].iloc[-bars - 1]) / df["close"].iloc[-bars - 1])

        def vol_ratio(df: pd.DataFrame | None) -> float:
            if df is None or len(df) < 21:
                return 1.0
            avg_vol = df["volume"].iloc[-21:-1].mean()
            return float(df["volume"].iloc[-1] / avg_vol) if avg_vol > 0 else 1.0

        signal_dt = signal.get("signal_time")
        hour = signal_dt.hour if isinstance(signal_dt, datetime) else 0
        dow  = signal_dt.weekday() if isinstance(signal_dt, datetime) else 0

        return {
            "price_change_1h":      pct_change(candle_1h, 1),
            "price_change_4h":      pct_change(candle_4h, 1),
            "price_change_24h":     pct_change(candle_1d, 1),
            "volume_ratio":         vol_ratio(candle_1h),
            "ema_spread_fast_mid":  (ema_fast - ema_mid) / price,
            "ema_spread_mid_slow":  (ema_mid  - ema_slow) / price,
            "ema_spread_fast_slow": (ema_fast - ema_slow) / price,
            "confluence_score":     signal.get("confluence_score") or 0.0,
            "ict_quality":          signal.get("ict_quality") or 0.0,
            "timeframe_weight":     tf_weights.get(signal.get("timeframe", "1h"), 1.0),
            "hour_of_day":          hour,
            "day_of_week":          dow,
            "is_long":              1 if signal.get("direction") == "LONG" else 0,
        }

    # ── private ───────────────────────────────────────────────────────────────

    def _try_load(self) -> None:
        if self._model_path.exists():
            try:
                self._pipeline = joblib.load(self._model_path)
                logger.info("ML model loaded from disk", path=str(self._model_path))
            except Exception as exc:
                logger.warning("Could not load ML model", error=str(exc))

    def _features_to_array(self, features: dict[str, Any]) -> np.ndarray:
        return np.array([[features.get(c, 0.0) for c in _FEATURE_COLS]], dtype=np.float32)

    @property
    def is_trained(self) -> bool:
        return self._pipeline is not None

    @property
    def trained_at(self) -> datetime | None:
        return self._last_trained

    @property
    def n_samples(self) -> int:
        return self._trained_on_n

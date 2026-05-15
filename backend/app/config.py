from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, RedisDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ─────────────────────────────────────────────────────────────────
    APP_NAME: str = "Coinpree Signal Engine"
    APP_VERSION: str = "1.0.0"
    ENV: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    SECRET_KEY: str = Field(..., min_length=32)
    API_KEY: str = Field(..., min_length=16)
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]

    # ── Database ─────────────────────────────────────────────────────────────
    DATABASE_URL: PostgresDsn = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/coinpree"
    )
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 40
    DB_POOL_TIMEOUT: int = 30

    # ── Redis ────────────────────────────────────────────────────────────────
    REDIS_URL: RedisDsn = Field(default="redis://localhost:6379/0")
    CACHE_TTL: int = 60  # seconds

    # ── Binance ──────────────────────────────────────────────────────────────
    BINANCE_BASE_URL: str = "https://fapi.binance.com"
    BINANCE_WS_URL: str = "wss://fstream.binance.com"
    BINANCE_API_KEY: str = ""
    BINANCE_SECRET: str = ""
    BINANCE_REQUEST_LIMIT: int = 3          # concurrent requests
    BINANCE_RATE_LIMIT_DELAY: float = 0.5  # seconds between symbol requests

    # ── CoinGecko ────────────────────────────────────────────────────────────
    COINGECKO_BASE_URL: str = "https://api.coingecko.com/api/v3"
    COINGECKO_API_KEY: str = ""

    # ── Scanner ──────────────────────────────────────────────────────────────
    SCANNER_INTERVAL_SECONDS: int = 60     # 1 minute — fast refresh, top symbols only
    TIMEFRAMES: list[str] = ["5m", "15m", "30m", "1h", "4h", "1d"]
    EMA_FAST: int = 7
    EMA_MID: int = 25
    EMA_SLOW: int = 99
    MAX_SYMBOLS_PER_SCAN: int = 75         # top 75 by volume — half the requests, 2× faster

    # ── ML ───────────────────────────────────────────────────────────────────
    ML_MODEL_PATH: str = "models/signal_scorer.joblib"
    ML_RETRAIN_HOURS: int = 24
    ML_MIN_SAMPLES: int = 200

    # ── Push Notifications ────────────────────────────────────────────────────
    VAPID_PRIVATE_KEY: str = ""
    VAPID_PUBLIC_KEY: str = ""
    VAPID_CLAIM_EMAIL: str = "admin@coinpree.com"

    # ── Logging ───────────────────────────────────────────────────────────────
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: Literal["json", "console"] = "json"

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_origins(cls, v: str | list) -> list[str]:
        if isinstance(v, list):
            return v
        v = v.strip()
        if v.startswith("["):
            import json
            return json.loads(v)
        return [o.strip() for o in v.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

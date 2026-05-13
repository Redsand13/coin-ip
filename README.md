# Coinpree Signal Engine

Full-stack cryptocurrency trading signal scanner.

```
76-ip-python/
├── backend/    Python FastAPI — signal engine, PostgreSQL, ML scoring
└── frontend/   Next.js 16 — real-time signal terminal UI
```

---

## Stack

| Layer | Technology |
|---|---|
| API server | Python 3.10+ · FastAPI · Uvicorn |
| Database | PostgreSQL 15+ (async via asyncpg + SQLAlchemy) |
| Cache / PubSub | Redis 7+ |
| ML | XGBoost + LightGBM ensemble (calibrated) |
| Frontend | Next.js 16 · React 19 · TailwindCSS v4 |
| Real-time | WebSocket (FastAPI → Redis pub/sub → browser) |

---

## Prerequisites

- Python 3.10+
- Node.js 20+
- PostgreSQL 15+ running on `localhost:5432`
- Redis 7+ running on `localhost:6379`

---

## Backend Setup

```powershell
cd backend

# 1. Create virtual environment
python -m venv .venv
.venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
copy .env.example .env
# Edit .env — update DATABASE_URL, API_KEY, SECRET_KEY

# 4. Create PostgreSQL database + run migrations (first time only)
python setup_db.py

# 5. Start the API server
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs  
Health check: http://localhost:8000/api/v1/health

---

## Frontend Setup

```powershell
cd frontend

# 1. Install dependencies
npm install

# 2. Configure environment
copy .env.example .env.local
# Edit .env.local — BACKEND_API_KEY must match API_KEY in backend/.env

# 3. Start the dev server
npm run dev
```

Open http://localhost:3000

---

## Key API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/signals` | Paginated signals with filters |
| `GET` | `/api/v1/signals/top` | Top ML-scored signals (24 h) |
| `PATCH` | `/api/v1/signals/{id}/outcome` | Record outcome for ML training |
| `POST` | `/api/v1/scanner/trigger/binance` | Trigger manual Binance scan |
| `POST` | `/api/v1/backtest` | Submit async backtest run |
| `GET` | `/api/v1/backtest/{id}/trades` | Per-trade results |
| `WS` | `/api/v1/ws/signals` | Live WebSocket signal stream |
| `GET` | `/api/v1/health` | DB + Redis health check |
| `GET` | `/metrics` | Prometheus metrics |

---

## Signal Algorithms

| Algorithm | Description |
|---|---|
| **Triple EMA (7/25/99)** | Fresh bullish/bearish alignment crossover |
| **ICT / SMC** | Sweeps, Order Blocks, FVGs, BOS, CHoCH, Breaker Blocks |
| **Multi-TF Confluence** | Weighted score across 6 timeframes (5m–1d) |
| **ML Scorer** | XGBoost + LightGBM ensemble trained on historical outcomes |
| **Backtester** | Walk-forward engine — Sharpe, max drawdown, profit factor |

---

## Environment Variables

### `backend/.env`

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/coinpree` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection |
| `API_KEY` | *(required)* | Key for protected endpoints |
| `SECRET_KEY` | *(required, 32+ chars)* | App secret |
| `BINANCE_API_KEY` | *(optional)* | Binance Futures key |
| `COINGECKO_API_KEY` | *(optional)* | CoinGecko Pro key |
| `SCANNER_INTERVAL_SECONDS` | `30` | Scan interval |

### `frontend/.env.local`

| Variable | Description |
|---|---|
| `BACKEND_URL` | FastAPI URL (default `http://localhost:8000`) |
| `BACKEND_API_KEY` | Must match `API_KEY` in `backend/.env` |
| `SIGNAL_HISTORY_KEY` | Password for the /history page |

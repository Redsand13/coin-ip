"""
One-shot PostgreSQL database setup script.
Run once before starting the backend:
    python setup_db.py

Reads credentials from .env, creates the 'coinpree' database if needed,
then runs all Alembic migrations.
"""
import asyncio
import subprocess
import sys
from urllib.parse import urlparse

import asyncpg


def _parse_db_url() -> dict:
    """Extract host/port/user/password from DATABASE_URL in .env."""
    from app.config import settings
    raw = str(settings.DATABASE_URL)
    # strip the asyncpg driver prefix for urlparse
    url = raw.replace("postgresql+asyncpg://", "postgresql://")
    p = urlparse(url)
    return {
        "host":     p.hostname or "localhost",
        "port":     p.port or 5432,
        "user":     p.username or "postgres",
        "password": p.password or "",
        "dbname":   (p.path or "/coinpree").lstrip("/") or "coinpree",
    }


async def create_database() -> None:
    info = _parse_db_url()
    print(f"   Connecting as {info['user']}@{info['host']}:{info['port']}")

    try:
        # Connect to the default 'postgres' system DB to issue CREATE DATABASE
        conn = await asyncpg.connect(
            host=info["host"],
            port=info["port"],
            user=info["user"],
            password=info["password"],
            database="postgres",
        )
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", info["dbname"]
        )
        if not exists:
            await conn.execute(f'CREATE DATABASE "{info["dbname"]}"')
            print(f"[OK] Database '{info['dbname']}' created.")
        else:
            print(f"[INFO]  Database '{info['dbname']}' already exists.")
        await conn.close()
    except Exception as e:
        print(f"[ERROR] Could not connect to PostgreSQL: {e}")
        print("   Ensure PostgreSQL is running and credentials in backend/.env are correct.")
        sys.exit(1)


def run_migrations() -> None:
    print("...  Running Alembic migrations …")
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("[ERROR] Migration failed:")
        print(result.stderr)
        sys.exit(1)
    print("[OK] Migrations applied.")
    if result.stdout.strip():
        print(result.stdout.strip())


if __name__ == "__main__":
    print("==> Coinpree DB Setup")
    print("=" * 45)
    asyncio.run(create_database())
    run_migrations()
    print("=" * 45)
    print("[OK] Done! Start the backend with:")
    print("   uvicorn app.main:app --reload --port 8000")

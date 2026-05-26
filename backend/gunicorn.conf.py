import os
import multiprocessing

bind = "0.0.0.0:8000"
worker_class = "uvicorn.workers.UvicornWorker"

# Pipeline worker runs 1 process; API-only replicas run cpu_count*2+1
pipeline_enabled = os.getenv("PIPELINE_ENABLED", "true").lower() == "true"
workers = 1 if pipeline_enabled else (multiprocessing.cpu_count() * 2 + 1)

timeout = 120
keepalive = 5
max_requests = 1000
max_requests_jitter = 100

# Can preload when no WebSocket singleton (API-only replicas)
preload_app = not pipeline_enabled

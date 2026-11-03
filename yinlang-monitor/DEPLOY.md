# 音浪监控 (Render)

This is the FastAPI frontend and SQLite event recorder. The upstream Douyin collector is NOT included in this Render service. It requires an independently deployed DyHub source, configured via `DYHUB_URL`, and valid authorized login in that upstream to receive gift events.

- Render runtime: Python, build: `pip install -r yinlang-monitor/requirements.txt`
- Start: `cd yinlang-monitor && uvicorn app:app --host 0.0.0.0 --port $PORT`
- Set `ADMIN_USER`, `ADMIN_PASSWORD`, `INGEST_KEY`, `REPORT_TZ`.
- Free Render is not safe for production data: local SQLite resets on restart/idle. Use persistent storage or a database before production.
- Basic auth is required for all routes except `/healthz`.

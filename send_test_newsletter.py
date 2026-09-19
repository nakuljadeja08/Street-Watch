#!/usr/bin/env python3
"""Send a one-off Street Watch newsletter from the last committed job pull.

Reuses street_watch_jobs.json (already carries is_new / first_seen from the most
recent real run) and pipeline.py's send_newsletter(), so the test email is byte
-for-byte what the daily cron would send. Forces a send even on a zero-new day.

Locally:   set SMTP_* + NEWSLETTER_TO in your environment, then `python send_test_newsletter.py`
In CI:      the "Street Watch — test newsletter" workflow runs this with the repo secrets.
"""
import json, os, importlib.util
from datetime import datetime, timezone

# force-send even if nothing is new, so a test always lands
os.environ.setdefault("NEWSLETTER_SEND_EMPTY", "1")

spec = importlib.util.spec_from_file_location("pipeline", "pipeline.py")
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)

with open("street_watch_jobs.json", encoding="utf-8") as f:
    jobs = json.load(f)

today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
new = sum(1 for j in jobs if j.get("is_new"))
print(f"Loaded {len(jobs)} roles ({new} flagged new) — sending test newsletter…")
pipeline.send_newsletter(jobs, today)

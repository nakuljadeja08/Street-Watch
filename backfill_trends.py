#!/usr/bin/env python3
"""
Rebuild the hiring-trends history from git (one-off; safe to re-run).

Every daily pull committed street_watch_jobs.json, so the board as it stood at
the end of each day is in the git history. This replays those snapshots
through pipeline.update_trends() to rebuild .street_watch_trends.json and, if
SUPABASE_URL + SUPABASE_SERVICE_KEY are set, pushes every day to the
`hiring_trends` table.

Old snapshots only hold the filtered board, not the raw feeds, so two
approximations stand in for "still listed at the firm":
  • both days are re-filtered with TODAY's firm list and title rules, so a
    later filter change (dropping "Senior", part-time, a whole firm) doesn't
    read as a wave of takedowns;
  • a dated role that passed MAX_AGE_DAYS counts as aged out, not taken down.
History starts at SINCE; that first snapshot is the baseline only (no day row).

    python backfill_trends.py            # rebuild + push
    python backfill_trends.py --dry-run  # print the per-day totals only
"""
import json, subprocess, sys
from datetime import date, datetime, timezone

import pipeline as P

# Before this the pipeline was still being built out (firms wired in, fetchers
# fixed day to day), so the churn is ours, not the firms'. First day = baseline.
SINCE = "2026-09-18"


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True,
                          encoding="utf-8", check=True).stdout


def daily_snapshots():
    """(utc_day, jobs) for the last commit of each day that touched the export."""
    last = {}
    for line in git("log", "--reverse", "--format=%H %cI", "--", "street_watch_jobs.json").splitlines():
        sha, when = line.split()
        day = datetime.fromisoformat(when).astimezone(timezone.utc).date().isoformat()
        last[day] = sha
    for day, sha in sorted(last.items()):
        yield day, json.loads(git("show", f"{sha}:street_watch_jobs.json"))


def main():
    dry = "--dry-run" in sys.argv
    registered = P.registered_firms()
    snaps = [(day, [j for j in jobs
                    if j["firm"] in registered and j.get("metro")
                    and P.title_ok(j["firm"], j["title"])])
             for day, jobs in daily_snapshots() if day >= SINCE]
    trends, all_rows, posted = {}, [], {}
    for i, (day, board) in enumerate(snaps):
        on_board = {j["firm"] for j in board}
        later = {j["firm"] for _, b in snaps[i + 1:] for j in b}
        prev = trends.get("snapshot", {}).get("ids", {})
        posted.update({j["id"]: j["posted_date"] for j in board if j.get("posted_date")})
        # still listed at the firm (so not a takedown): roles on today's board,
        # dated roles we aged out, and roles of a firm that fell to zero for
        # good (our filters dropped them — a feed outage comes back later, and
        # those firms are carried forward by update_trends instead)
        gone = {f for f, _ in prev.values() if f not in on_board and f not in later}
        aged = {k for k in prev if k in posted and
                (date.fromisoformat(day) - date.fromisoformat(posted[k])).days > P.MAX_AGE_DAYS}
        listed = ({j["id"] for j in board} | aged |
                  {k for k, (f, _) in prev.items() if f in gone})
        rows = P.update_trends(trends, board, listed, on_board | gone, day, registered)
        if "baseline" in trends:
            all_rows += rows
            n = sum(r["new_count"] for r in rows); r_ = sum(r["removed_count"] for r in rows)
            a = sum(r["active_count"] for r in rows)
            print(f"{day}  +{n:<4} -{r_:<4} active {a}")
        else:
            del trends["days"][day]
            print(f"{day}  baseline ({len(board)} roles)")
    if dry:
        return
    json.dump(trends, open(P.TRENDS_FILE, "w"), separators=(",", ":"))
    print(f"wrote {P.TRENDS_FILE}")
    P.push_trends(all_rows)

if __name__ == "__main__":
    main()

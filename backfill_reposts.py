#!/usr/bin/env python3
"""
Seed the repost ledger from git history (one-off; safe to re-run).

The daily pull committed each watch's board (street_watch_jobs.json,
tech_watch_jobs.json) every day, so the boards as they stood at the end of
each day are in git. This replays them through pipeline.assign_first_seen(),
which records every role that leaves the board and spots the ones that come
back under a new id. It then writes the result (the __gone__ ledger and the
__reposts__ map) into each watch's state file, so "Reposted" badges cover
roles reposted before the feature shipped, not only from the next pull on.
The next pull puts the counts on the rows and pushes them to Supabase.

    python backfill_reposts.py            # update both state files
    python backfill_reposts.py --dry-run  # print what it found only
"""
import json, subprocess, sys
from datetime import datetime, timezone

import pipeline as P

WATCHES = (("street_watch_jobs.json", ".street_watch_state.json"),
           ("tech_watch_jobs.json", ".tech_watch_state.json"))


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True,
                          encoding="utf-8", check=True).stdout


def daily_snapshots(path):
    """(utc_day, jobs) for the last commit of each day that touched `path`."""
    last = {}
    for line in git("log", "--reverse", "--format=%H %cI", "--", path).splitlines():
        sha, when = line.split()
        last[datetime.fromisoformat(when).astimezone(timezone.utc).date().isoformat()] = sha
    for day, sha in sorted(last.items()):
        yield day, json.loads(git("show", f"{sha}:{path}"))


def replay(path):
    sim, prev = {}, []
    for day, board in daily_snapshots(path):
        board = [dict(j) for j in board if j.get("id") and j.get("title") and j.get("location") is not None]
        P.assign_first_seen(board, sim, prev, day)
        prev = board
    return sim, {j["id"] for j in prev}


def main():
    dry = "--dry-run" in sys.argv
    for jobs_path, state_path in WATCHES:
        sim, live = replay(jobs_path)
        reposts = {i: r for i, r in (sim.get(P.REPOSTS_KEY) or {}).items() if i in live}
        board = {j["id"]: j for j in json.load(open(jobs_path, encoding="utf-8"))}
        print(f"{jobs_path}: {len(sim.get(P.GONE_KEY) or {})} roles in the ledger, "
              f"{len(reposts)} live roles reposted")
        for i, r in sorted(reposts.items(), key=lambda x: -x[1]["n"])[:15]:
            j = board.get(i, {})
            print(f"  x{r['n']} first seen {r['orig']}  {j.get('firm', '?')} | {j.get('title', i)[:60]}")
        if dry:
            continue
        state = json.load(open(state_path))
        state[P.GONE_KEY] = sim.get(P.GONE_KEY) or {}
        state[P.REPOSTS_KEY] = {**reposts, **(state.get(P.REPOSTS_KEY) or {})}
        json.dump(state, open(state_path, "w"))
        print(f"  wrote {state_path}")


if __name__ == "__main__":
    main()

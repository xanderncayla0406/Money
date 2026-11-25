#!/bin/bash
# Exits (waking Claude) when new alerts arrive or the watcher stops. Batches alerts for 60s,
# or up to 15 minutes when they are all headlines: those only get direction calls, never money,
# and the same story arrives from many outlets over several minutes. A post or price alert
# arriving during that wait ends it straight away.
cd "$(dirname "$0")/paper"
touch alerts.jsonl
start=$(wc -l < alerts.jsonl)
only_news() { ! tail -n +"$((start + 1))" alerts.jsonl | grep -qv '"kind": "news:'; }
# usage saver (Nov 25): headlines scored below 4 never wake Claude; they wait for the scheduled checks
urgent() { tail -n +"$((start + 1))" alerts.jsonl | grep -v '"kind": "news:' | grep -q . || tail -n +"$((start + 1))" alerts.jsonl | grep -q '"score": [4-9]'; }
while true; do
  now=$(wc -l < alerts.jsonl)
  if [ "$now" -gt "$start" ] && urgent; then
    sleep 60
    waited=60
    while only_news && [ "$waited" -lt 900 ]; do sleep 15; waited=$((waited + 15)); done
    echo "NEW ALERTS:"; tail -n +"$((start + 1))" alerts.jsonl
    exit 0
  fi
  if [ ! -f watcher.heartbeat ] || [ $(( $(date +%s) - $(stat -c %Y watcher.heartbeat) )) -gt 300 ]; then
    echo "WATCHER DOWN: no heartbeat for 5+ minutes"; tail -5 watcher.log; exit 1
  fi
  sleep 15
done

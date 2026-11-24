#!/bin/bash
# Exits (waking Claude) when new alerts arrive or the watcher stops. Batches alerts for 60s,
# or 15 minutes when they are all headlines: those only get direction calls, never money,
# and the same story arrives from many outlets over several minutes.
cd "$(dirname "$0")/paper"
touch alerts.jsonl
start=$(wc -l < alerts.jsonl)
while true; do
  now=$(wc -l < alerts.jsonl)
  if [ "$now" -gt "$start" ]; then
    sleep 60
    if ! tail -n +"$((start + 1))" alerts.jsonl | grep -qv '"kind": "news:'; then sleep 840; fi
    echo "NEW ALERTS:"; tail -n +"$((start + 1))" alerts.jsonl
    exit 0
  fi
  if [ ! -f watcher.heartbeat ] || [ $(( $(date +%s) - $(stat -c %Y watcher.heartbeat) )) -gt 300 ]; then
    echo "WATCHER DOWN: no heartbeat for 5+ minutes"; tail -5 watcher.log; exit 1
  fi
  sleep 15
done

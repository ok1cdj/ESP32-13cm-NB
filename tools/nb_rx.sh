#!/bin/sh
# Starts the web receiver: tools/web_bridge.py (page + boards over WebSocket) and the browser on it; Ctrl-C ends the bridge.
# Needs no network: everything is served from this computer.
#   tools/nb_rx.sh [PORT]        (default 8080; a bridge already running on PORT is reused)
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${1:-8080}
URL="http://localhost:$PORT/"
open_browser() {
    for b in google-chrome-stable google-chrome chromium firefox xdg-open; do
        command -v "$b" >/dev/null && { "$b" "$URL" >/dev/null 2>&1 & return; }
    done
    echo "open $URL in a browser"
}
if curl -s -o /dev/null "$URL/bridge.json"; then
    echo "bridge already running on $PORT"
    open_browser
    exit 0
fi
python3 "$ROOT/tools/web_bridge.py" --port "$PORT" &
BRIDGE=$!
trap 'kill $BRIDGE 2>/dev/null' INT TERM EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "$URL/bridge.json" && break; sleep 0.5; done
open_browser
wait $BRIDGE

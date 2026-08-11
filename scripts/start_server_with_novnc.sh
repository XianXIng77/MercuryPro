#!/bin/sh

set -eu

debug_desktop="$(printf '%s' "${BROWSER_DEBUG_DESKTOP_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')"
case "$debug_desktop" in
    1|true|yes|on)
        ;;
    *)
        echo "[MercuryPro] Browser debug desktop is disabled"
        exec python scripts/start_server.py
        ;;
esac

display="${DISPLAY:-:99}"
vnc_port="${VNC_PORT:-5900}"
novnc_port="${NOVNC_PORT:-6080}"
screen="${VNC_SCREEN:-1440x900x24}"

export DISPLAY="$display"

echo "[MercuryPro] Starting virtual browser display $display ($screen)"
Xvfb "$display" -screen 0 "$screen" -nolisten tcp -ac &
xvfb_pid=$!

sleep 1
if ! kill -0 "$xvfb_pid" 2>/dev/null; then
    echo "[MercuryPro] Xvfb failed to start" >&2
    exit 1
fi

echo "[MercuryPro] Starting local VNC bridge on port $vnc_port"
x11vnc \
    -display "$display" \
    -rfbport "$vnc_port" \
    -localhost \
    -forever \
    -shared \
    -nopw \
    -quiet &
vnc_pid=$!

sleep 1
if ! kill -0 "$vnc_pid" 2>/dev/null; then
    echo "[MercuryPro] x11vnc failed to start" >&2
    exit 1
fi

echo "[MercuryPro] Starting noVNC web client on port $novnc_port"
websockify \
    --web=/usr/share/novnc \
    "$novnc_port" \
    "127.0.0.1:$vnc_port" &
novnc_pid=$!

sleep 1
if ! kill -0 "$novnc_pid" 2>/dev/null; then
    echo "[MercuryPro] noVNC web bridge failed to start" >&2
    exit 1
fi

echo "[MercuryPro] Starting application server"
exec python scripts/start_server.py

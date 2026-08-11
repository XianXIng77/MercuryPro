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

echo "[MercuryPro] Starting application server"
python scripts/start_server.py &
app_pid=$!

cleanup() {
    trap - HUP INT TERM EXIT
    kill "$app_pid" "$vnc_pid" "$xvfb_pid" 2>/dev/null || true
    wait "$app_pid" "$vnc_pid" "$xvfb_pid" 2>/dev/null || true
}

trap 'cleanup; exit 0' HUP INT TERM
trap cleanup EXIT

while :; do
    for process in \
        "$app_pid:application server" \
        "$vnc_pid:x11vnc" \
        "$xvfb_pid:Xvfb"
    do
        pid="${process%%:*}"
        label="${process#*:}"
        if ! kill -0 "$pid" 2>/dev/null; then
            status=0
            wait "$pid" || status=$?
            echo "[MercuryPro] $label exited unexpectedly (status=$status); stopping container for automatic recovery" >&2
            exit "$status"
        fi
    done
    sleep 2
done

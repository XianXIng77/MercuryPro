#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="${APP_NAME:-mercurypro}"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
REMOTE="${REMOTE:-origin}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
BACKUP_ROOT="${BACKUP_ROOT:-$SCRIPT_DIR/.update-backups}"

log() {
    printf '[MercuryPro Update] %s\n' "$*"
}

fail() {
    printf '[MercuryPro Update] ERROR: %s\n' "$*" >&2
    exit 1
}

run_as_root() {
    if [[ "$(id -u)" -eq 0 ]]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        fail "Root permission is required to update persistent directory ownership, but sudo is unavailable."
    fi
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command is not installed: $1"
}

require_command git
require_command docker
require_command readlink

[[ -d .git ]] || fail "Run this script from a Git checkout of MercuryPro."
[[ -f docker-compose.yml ]] || fail "docker-compose.yml was not found in the project root."
[[ -f Dockerfile ]] || fail "Dockerfile was not found in the project root."

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
    command -v sudo >/dev/null 2>&1 || fail "The current user cannot access Docker and sudo is unavailable."
    DOCKER=(sudo docker)
fi

"${DOCKER[@]}" info >/dev/null 2>&1 || fail "Docker is not running or cannot be accessed."
"${DOCKER[@]}" compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not installed."

if ! git diff --quiet || ! git diff --cached --quiet; then
    fail "Tracked files contain local changes. Commit or stash them before updating."
fi

BRANCH="${BRANCH:-$(git symbolic-ref --quiet --short HEAD || true)}"
[[ -n "$BRANCH" ]] || fail "The repository is in detached HEAD state. Set BRANCH explicitly before updating."

OLD_REVISION="$(git rev-parse HEAD)"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

PERSISTENT_PATHS=(
    "$SCRIPT_DIR/data"
    "$SCRIPT_DIR/grok-engine/runtime/data"
    "$SCRIPT_DIR/grok-engine/config"
)

log "Preparing persistent data directories."
for path in "${PERSISTENT_PATHS[@]}"; do
    run_as_root mkdir -p "$path"
done

container_exists() {
    "${DOCKER[@]}" inspect "$APP_NAME" >/dev/null 2>&1
}

mounted_source_for() {
    local destination="$1"
    "${DOCKER[@]}" inspect \
        --format "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{.Source}}{{end}}{{end}}" \
        "$APP_NAME" 2>/dev/null || true
}

migrate_container_directory() {
    local container_path="$1"
    local host_path="$2"
    local current_source expected_source

    current_source="$(mounted_source_for "$container_path")"
    expected_source="$(readlink -f "$host_path")"

    if [[ -n "$current_source" ]] && [[ "$(readlink -f "$current_source")" == "$expected_source" ]]; then
        log "Persistent mount already active: $container_path"
        return
    fi

    log "Migrating existing container data from $container_path"
    if ! "${DOCKER[@]}" cp "$APP_NAME:$container_path/." "$host_path/" >/dev/null 2>&1; then
        log "No existing data was found at $container_path; continuing."
    fi
}

# Older deployments only mounted /app/data. Copy container-only registration
# data and configuration to the host before the container is replaced.
if container_exists; then
    migrate_container_directory "/app/data" "$SCRIPT_DIR/data"
    migrate_container_directory "/app/grok-engine/runtime/data" "$SCRIPT_DIR/grok-engine/runtime/data"
    migrate_container_directory "/app/grok-engine/config" "$SCRIPT_DIR/grok-engine/config"
fi

log "Creating a private data backup at $BACKUP_DIR"
run_as_root mkdir -p "$BACKUP_DIR/grok-engine/runtime" "$BACKUP_DIR/grok-engine"
run_as_root cp -a "$SCRIPT_DIR/data" "$BACKUP_DIR/data"
run_as_root cp -a "$SCRIPT_DIR/grok-engine/runtime/data" "$BACKUP_DIR/grok-engine/runtime/data"
run_as_root cp -a "$SCRIPT_DIR/grok-engine/config" "$BACKUP_DIR/grok-engine/config"
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    run_as_root cp -a "$SCRIPT_DIR/.env" "$BACKUP_DIR/.env"
fi
run_as_root chmod -R go-rwx "$BACKUP_DIR"

log "Pulling the latest code from $REMOTE/$BRANCH"
git fetch "$REMOTE" "$BRANCH"
git merge --ff-only "$REMOTE/$BRANCH"
NEW_REVISION="$(git rev-parse HEAD)"

log "Fixing persistent directory permissions for container UID $APP_UID."
for path in "${PERSISTENT_PATHS[@]}"; do
    run_as_root chown -R "$APP_UID:$APP_GID" "$path"
    run_as_root chmod -R u+rwX "$path"
done

log "Building and restarting MercuryPro without deleting volumes or persistent data."
if ! "${DOCKER[@]}" compose up --build -d; then
    "${DOCKER[@]}" compose logs --tail=120 "$APP_NAME" || true
    fail "The new version failed to build or start. Backup: $BACKUP_DIR"
fi

log "Waiting up to $HEALTH_TIMEOUT seconds for the service health check."
deadline=$((SECONDS + HEALTH_TIMEOUT))
status="starting"

while (( SECONDS < deadline )); do
    status="$(
        "${DOCKER[@]}" inspect \
            --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
            "$APP_NAME" 2>/dev/null || true
    )"

    case "$status" in
        healthy|running)
            log "Update completed: ${OLD_REVISION:0:8} -> ${NEW_REVISION:0:8}"
            log "Data backup: $BACKUP_DIR"
            "${DOCKER[@]}" compose ps
            exit 0
            ;;
        unhealthy|exited|dead)
            "${DOCKER[@]}" compose logs --tail=120 "$APP_NAME" || true
            fail "The updated container entered an abnormal state: $status. Backup: $BACKUP_DIR"
            ;;
    esac

    sleep 2
done

"${DOCKER[@]}" compose logs --tail=120 "$APP_NAME" || true
fail "Health check timed out with status: ${status:-unknown}. Backup: $BACKUP_DIR"

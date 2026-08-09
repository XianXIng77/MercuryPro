#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="mercurypro"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
DATA_DIR="$SCRIPT_DIR/data"

log() {
    printf '[MercuryPro] %s\n' "$*"
}

fail() {
    printf '[MercuryPro] ERROR: %s\n' "$*" >&2
    exit 1
}

run_as_root() {
    if [[ "$(id -u)" -eq 0 ]]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        fail "需要 root 权限执行 '$*'，但系统中未找到 sudo。"
    fi
}

command -v docker >/dev/null 2>&1 || fail "未安装 Docker。"
[[ -f docker-compose.yml ]] || fail "项目根目录中不存在 docker-compose.yml。"
[[ -f Dockerfile ]] || fail "项目根目录中不存在 Dockerfile。"

# Prefer the current user's Docker access. Fall back to sudo when the user is
# not a member of the docker group.
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
    command -v sudo >/dev/null 2>&1 || fail "当前用户无权访问 Docker，且系统中未找到 sudo。"
    DOCKER=(sudo docker)
fi

"${DOCKER[@]}" info >/dev/null 2>&1 || fail "Docker 服务未运行，或当前用户无权访问 Docker。"
"${DOCKER[@]}" compose version >/dev/null 2>&1 || fail "未安装 Docker Compose v2 插件。"

if [[ ! -f .env ]]; then
    [[ -f .env.example ]] || fail "缺少 .env 和 .env.example。"
    cp .env.example .env
    chmod 600 .env
    log "已根据 .env.example 创建 .env，请按需配置 APP_URL 和 GEMINI_API_KEY。"
fi

log "准备持久化数据目录并修复容器写入权限……"
run_as_root mkdir -p "$DATA_DIR"
run_as_root chown -R "$APP_UID:$APP_GID" "$DATA_DIR"
run_as_root chmod -R u+rwX "$DATA_DIR"

log "构建并启动 Docker 服务……"
if ! "${DOCKER[@]}" compose up --build -d; then
    "${DOCKER[@]}" compose logs --tail=100 "$APP_NAME" || true
    fail "Docker 服务启动失败。"
fi

log "等待服务通过健康检查（最长 ${HEALTH_TIMEOUT} 秒）……"
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
            log "部署完成，服务地址：http://127.0.0.1:9100"
            "${DOCKER[@]}" compose ps
            exit 0
            ;;
        unhealthy|exited|dead)
            "${DOCKER[@]}" compose logs --tail=100 "$APP_NAME" || true
            fail "容器状态异常：$status"
            ;;
    esac

    sleep 2
done

"${DOCKER[@]}" compose logs --tail=100 "$APP_NAME" || true
fail "健康检查超时，容器当前状态：${status:-unknown}"

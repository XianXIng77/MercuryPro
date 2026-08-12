FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM python:3.12-slim-bookworm AS runtime

ENV PORT=9100 \
    BROWSER_DEBUG_DESKTOP_ENABLED=false \
    DISPLAY=:99 \
    VNC_PORT=5900 \
    NOVNC_WEB_ROOT=/usr/share/novnc \
    VNC_SCREEN=1440x900x24 \
    PYTHONUTF8=1 \
    PYTHONIOENCODING=utf-8 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libgtk-3-0 libdbus-glib-1-2 libxt6 libx11-xcb1 libasound2 libnss3 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 fonts-liberation fonts-noto-cjk \
    xvfb x11vnc novnc \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY --from=build /app/grok-engine ./grok-engine
COPY --from=build /app/scripts ./scripts

RUN python -m pip install --no-cache-dir \
       -r /app/grok-engine/backend/requirements.txt \
       -r /app/grok-engine/vendor/turnstile-solver/requirements.txt

RUN useradd --create-home --uid 1000 mercury \
    && mkdir -p /app/data /app/grok-engine/runtime /app/grok-engine/config \
    && chown -R mercury:mercury /app/data /app/grok-engine/runtime /app/grok-engine/config /app/grok-engine/vendor/turnstile-solver

USER mercury

RUN python -m camoufox fetch \
    && python -c "from camoufox.pkgman import camoufox_path; p = camoufox_path(download_if_missing=False); executable = p / 'camoufox-bin'; assert executable.is_file(), f'Camoufox executable missing: {executable}'; print(f'Camoufox verified: {executable}')"

EXPOSE 9100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9100/api/health', timeout=4)"

CMD ["sh", "scripts/start_server_with_novnc.sh"]

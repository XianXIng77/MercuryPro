# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MercuryPro is a smart email management system with two main parts:

1. **Frontend** (`src/`): React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + `motion` (animation) + `lucide-react` (icons). The UI language is Simplified Chinese.
2. **Backend** (`grok-engine/backend/`): A FastAPI ("grok-engine") application that serves the registration engine, Microsoft mail account management, and AI mail assistant APIs. It runs in its own Python venv at `grok-engine/runtime/.venv` (Windows: `Scripts/python.exe`).

The project originated as an AI Studio app (see `metadata.json`); `vite.config.ts` supports `DISABLE_HMR=true` to prevent flickering during agent edits — do not remove that logic.

## Commands

```bash
# First-time setup: creates grok-engine venv, installs backend + turnstile-solver deps,
# downloads the Camoufox browser (PowerShell, Windows)
npm run setup:grok

# Development: starts FastAPI backend (127.0.0.1:39181) + Vite dev server (port 3000) together
npm run dev

# Frontend only (expects backend already running on GROK_ENGINE_PORT, default 39181)
npm run dev:web

# Backend only (serves built frontend from dist/ on PORT, default 3000)
npm run backend        # same as: npm start

npm run build          # vite build -> dist/
npm run lint           # tsc --noEmit (typecheck only; no ESLint)
```

### Backend tests (unittest, in `grok-engine/backend/tests/`)

```bash
# All tests (from repo root, Windows path style)
grok-engine/runtime/.venv/Scripts/python.exe -m unittest discover -s grok-engine/backend/tests -t grok-engine/backend

# Single module / single test (from grok-engine/backend so `tests` package resolves)
cd grok-engine/backend
../runtime/.venv/Scripts/python.exe -m unittest tests.test_proxy_pool
../runtime/.venv/Scripts/python.exe -m unittest tests.test_proxy_pool.ProxyPoolTests.test_residential_host_port_username_password_format
```

Tests insert `grok-engine/backend` into `sys.path` themselves and import backend modules directly — they run without starting the server.

## Architecture

### Request flow / ports

- Vite dev server (port 3000) proxies `/api` and `/browser-debug` to the backend at `http://127.0.0.1:${GROK_ENGINE_PORT||39181}` (see `vite.config.ts`).
- Backend embeds helper services it starts on demand (`mercury_runtime.ensure_for_path` in the HTTP middleware): Turnstile solver (port 39182, `GROK_SOLVER_PORT`) and the hotmail mail helper (port 39183, `GROK_MAIL_HELPER_PORT`). They are shut down on app shutdown.
- In production, the backend serves the built SPA from `dist/` via a catch-all route; `grok-engine/web/static/` is a separate legacy static dir.

### Backend (`grok-engine/backend/`)

- `app.py` — FastAPI app (`MercuryPro` 2.0.0) and a **facade** over extracted modules. It keeps `DEFAULT_CONFIG`/`Settings` (pydantic) and the full `/api/*` route table, but delegates to `app_core.py`, `app_exports.py`, `app_network.py`, `app_routes.py` via `AppContext(globals())` (`app_context.py`), which passes live module globals into those extracted modules at call time. When adding backend logic, prefer the extracted modules and wire it through the facade.
- **Legacy path rewrite**: middleware rewrites `/api/grok/*` → `/api/*` (the frontend's `grokRegistrationApi` still calls the `/api/grok/...` contract).
- Routers:
  - `mercury_mail.py` — `/api/microsoft/*`: Microsoft mail account CRUD/import/probe, OAuth2 refresh-token flow, reads mail via Outlook API. State is a JSON file at `<repo>/data/microsoft-mail-accounts.json` (resolved via `PROJECT_ROOT` + `DATA_DIR` env; accounts have a registration-use limit of 3).
  - `mercury_ai.py` — `/api/ai/auto-tag` and `/api/ai/assistant`: Gemini API (`GEMINI_API_KEY`, model `GEMINI_MODEL`) with a keyword-based `_fallback_tags` when no key is configured.
  - `browser_debug.py` — `/browser-debug/*` for live browser session viewing.
- **Registration engine** (the "grok-engine" core):
  - `grok_build_adapter.py` — adapter: xAI browser registration (Camoufox/patchright, Authorization Code + PKCE) → account pool; also the ChatGPT target (`chatgpt_*` modules).
  - `grok_registration/` — orchestration package: `batch`, `flow`, `mailbox`, `monitor`, `pipeline` (probe/import queues), `probe_control`, `import_control`, `protocol_worker`, `worker`, `worker_lifecycle`, `recovery`, `solver`, `state`.
  - `chatgpt_registration/` — ChatGPT registration orchestration (`flow`, `worker`, `operations`, `probe`, `history`, `diagnostics`). `diagnostics.py` writes timestamped incident folders (one per event: Plus-trial check, checkout-kind check, registration error) to `<repo>/log/<YYYYMMDD-HHMMSS.mmm>_<stage>_<outcome>_<email>/`, each containing `screenshot.png` (when the browser page is still alive) and `log.txt` (local timestamp, reason, step timeline, page-text snapshot). Override location with `MERCURY_REGISTRATION_LOG_DIR`.
  - `account_pipeline.py` + `account_pipeline_parts/` (`cpa`, `grok_probe`, `sub2api`) — post-registration account probing and import into CPA / sub2api pools.
  - `mail_protocols/` — provider-specific temporary-mailbox clients (`cfmail`, `gptmail`, `imap_mail`, `moemail`, `stalwart`, `yyds`).
  - Support modules: `proxy_pool.py` (proxy canonicalization/rotation), `account_rotation.py`, `model_health.py`, `performance_tuning.py`, `xai_pkce.py`.
- **Config & data**: runtime config at `grok-engine/config/config.json`; `.env` at repo root (loaded via python-dotenv); account output at `grok-engine/runtime/data/` (`accounts/*.json`, `auth.json`). Key settings: `registration_target` (`grok`|`chatgpt`), `registration_mode` (`browser`|`protocol`), `mail_provider` (`hotmail_local` default, plus `yyds`/`custom`/`cloudflare_grokfree`/`stalwart`/`smsbower`/`naturalflower`), `captcha_provider` (`local` solver | `yescaptcha`).
- `vendor/turnstile-solver/` — local Cloudflare Turnstile solver (installed by setup script, gets `proxies.txt` synced from config).
- `scripts/start_server_with_novnc.sh` — Linux path that wraps Xvfb + x11vnc for browser debug desktop (opt-in via `BROWSER_DEBUG_DESKTOP_ENABLED`).

### Frontend (`src/`)

- `main.tsx` → `App.tsx` holds the top-level state: `activeTab` (NavTab), `activeAccount` (MailAccount | null), and the style preset id (persisted in localStorage key `mercurypro-style-preset`).
- **Theming**: `data/stylePresets.ts` defines `STYLE_PRESETS`. The active preset sets a `data-theme` attribute on the root div and each component receives `currentPreset` and reads `preset.themeClasses` (bundled Tailwind class names) — there is no CSS-variable theming; per-theme CSS (e.g. scrollbars) keys off `[data-theme="..."]` in `index.css`. New themes must be added to `STYLE_PRESETS`.
- **View routing** (no router library): tab `email` shows `MailAccountList`, and when an account is opened switches to `MailboxInboxView`; tab `register` shows `GrokRegistrationPanel`; `calendar`/`contacts`/`analytics`/`tickets`/`settings` render placeholder "extension module" UIs in `ExtensionModules.tsx`.
- **API clients** (`src/api/`):
  - `microsoftMail.ts` — `/api/microsoft/*` (account list CRUD, token refresh, message fetch); maps DTOs to frontend types.
  - `grokRegistration.ts` — `grokRegistrationApi` object covering the whole `/api/grok/*` control surface (config, register, monitor sessions/batches, pause/resume, imports).
- Shared types live in `src/types.ts` (`Email`, `MailAccount`, `Folder`, `Tag`, `AutoTagRule`, `StylePreset`, `NavTab`).
- Path alias `@/*` maps to the repo root (tsconfig + vite).

## Conventions

- UI text and backend error messages are Simplified Chinese — keep new user-facing strings consistent.
- Frontend typecheck is the only lint gate (`npm run lint`); run it after frontend changes.
- Backend Python targets the venv Python 3.10+; `requirements.txt` is at `grok-engine/backend/requirements.txt`.

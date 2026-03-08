# Maya Mixa V2.5 - Client Delivery (Electron + Cloud)

Maya Mixa is now structured for **real client delivery**:

- **Cloud runtime**: FastAPI backend + web UI deployable as one service
- **Desktop runtime**: Electron app that points to the cloud API
- **No terminal required for your client**: they install the packaged desktop app and use it directly

## 1) Cloud deployment (production API)

This repo is cloud-ready with:

- `Dockerfile`
- `render.yaml`
- `Procfile`

### Render (recommended)

1. Push repo to GitHub
2. Create a new service on Render from this repo
3. Render auto-detects `render.yaml` (Docker runtime + persistent disk `/app/data`)
4. Once deployed, you get a URL like:
   - `https://maya-mixa-cloud.onrender.com`

Health check:

```bash
curl https://YOUR-API-DOMAIN/api/health
```

Post-deploy smoke check:

```bash
npm run cloud:smoke -- --base https://YOUR-API-DOMAIN --admin admin
```

## 2) Configure desktop app to use your cloud API

Edit:

- `config/runtime.json`

Set:

```json
{
  "apiBase": "https://YOUR-API-DOMAIN",
  "appUrl": "https://YOUR-API-DOMAIN"
}
```

The Electron preload injects this into the renderer (`window.mayaConfig.apiBase`).

`appUrl` lets your client receive UI updates from the cloud without reinstalling desktop binaries.

Quick config command:

```bash
npm run cloud:configure-runtime -- --api https://YOUR-API-DOMAIN --app https://YOUR-API-DOMAIN
```

If you open `index.html` directly in a browser (`file://...`), you must set the backend URL from the login screen:

1. Fill **URL API backend**
2. Click **Enregistrer API**
3. Click **Tester API**
4. Then login/register

## 3) Build downloadable desktop installers

Install Node deps once:

```bash
npm install
```

Build installers:

```bash
npm run electron:dist
```

Outputs are generated in:

- `release/`

Targets configured:

- macOS: `dmg`, `zip`
- Windows: `nsis` (`.exe` installer)
- Linux: `AppImage`

### Build without local terminal (GitHub Actions)

Workflow included:

- `.github/workflows/electron-build.yml`

From GitHub:

1. Open **Actions** tab
2. Run **Build Electron Installers**
3. Download artifacts:
   - `maya-mixa-mac`
   - `maya-mixa-win`
   - `maya-mixa-linux`

## 4) Local dev modes

### Local backend + local desktop

```bash
./run_backend.sh
npm run electron:dev:local
```

### Desktop against cloud API

```bash
npm run electron:dev:cloud
```

(uses `config/runtime.json` or `MAYA_API_BASE` env var)

## 5) Runtime config

### Electron injection

- `electron/preload.cjs` exposes:
  - `window.mayaConfig.apiBase`
  - `window.mayaConfig.isElectron`

### Frontend API resolution

`app.js` automatically resolves API URLs:

- Cloud/Electron: `${apiBase}/api/...`
- Web served by backend: `/api/...`

## 6) Production security checklist

Before launch, configure environment variables (see `.env.example`):

- `MAYA_ENV=production`
- `MAYA_AUTH_SECRET` (strong secret)
- `MAYA_AUTH_PASSWORDLESS=true` for ID-only DJ login (no password entry)
- `MAYA_CORS_ORIGINS` (strict whitelist)
- `MAYA_ALLOW_NULL_ORIGIN=false` (unless Electron `file://` is required)
- `MAYA_ENABLE_LIBRARY_SCAN=false` (recommended on cloud)
- `MAYA_LIBRARY_SCAN_ROOT` (if scan is enabled)
- SMTP variables for password reset (`MAYA_SMTP_*`)
- Disable dev bootstrap admin in production:
  - `MAYA_BOOTSTRAP_ADMIN=false`

## 7) Admin bootstrap (dev/staging)

The app now auto-provisions an admin at startup when bootstrap is enabled.

Default dev credentials:

- login id: `admin`
- password: not required in passwordless mode

Config keys:

- `MAYA_BOOTSTRAP_ADMIN`
- `MAYA_BOOTSTRAP_ADMIN_LOGIN`
- `MAYA_BOOTSTRAP_ADMIN_PASSWORD`
- `MAYA_BOOTSTRAP_ADMIN_DISPLAY`
- `MAYA_BOOTSTRAP_ADMIN_DJ_NAME`

In passwordless mode, the login ID is still required (`admin`, `dj_xxx`, etc.), while password endpoints are disabled.

## 8) Default DJ library

Every new user now gets a seeded default crate (8 tracks) with:

- BPM
- key / Camelot
- note / energy
- Track DNA features

This prevents empty analysis screens for first-time users.

## 9) UI assets (launch/navbar/icon)

Integrated client visuals:

- Launch page illustration: `assets/images/launch-hero-7.png`
- Navbar logo: `assets/images/navbar-logo-8.png`
- App icons: `assets/icons/maya-icon.icns`, `assets/icons/maya-icon.ico`, `assets/icons/maya-icon-*.png`

Backend now serves static assets through `GET /assets/{path}` when running in cloud mode.

## 10) Auth mode API

- `GET /api/auth/config` returns runtime auth mode:
  - `passwordless`
  - `identifierLabel`
  - `passwordRecoveryEnabled`

## 11) OAuth Google / Apple

Backend endpoints are live:

- `GET /api/auth/oauth/providers`
- `GET /api/auth/oauth/google/start`
- `GET|POST /api/auth/oauth/google/callback`
- `GET /api/auth/oauth/apple/start`
- `GET|POST /api/auth/oauth/apple/callback`

Required env vars for real provider login:

- Google: `MAYA_GOOGLE_CLIENT_ID`, `MAYA_GOOGLE_CLIENT_SECRET`, optional `MAYA_GOOGLE_REDIRECT_URI`
- Apple: `MAYA_APPLE_CLIENT_ID`, `MAYA_APPLE_CLIENT_SECRET`, optional `MAYA_APPLE_REDIRECT_URI`

Without these credentials, frontend buttons remain visible but disabled and provider start endpoints return `503`.

## 12) AI / Search / Serato runtime checks

- `GET /api/ai/status` for local/remote AI health
- `GET /api/search/unified?q=...` now aggregates iTunes + Deezer + MusicBrainz
- `GET /api/serato/capabilities` exposes runtime bridge modes and requirements
- `POST /api/library/apple/sync` refreshes external catalog suggestions from iTunes for your DJ library seeds
- `GET /api/account/dashboard` returns profile summary, favorites, session runtime, and AI tips
- `GET /api/cloud/status` verifies DB persistence/runtime info

Real native Serato deck telemetry still requires a local adapter/feed (websocket/history/feed file) running on the DJ machine.

## 13) Optional AI enhancement

For remote OpenAI co-coach (optional):

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default in `.env.example`)

Without OpenAI key, local AI engine remains active.

## Core files

- Backend: `backend/app.py`
- Frontend: `index.html`, `app.js`
- Electron: `electron/main.cjs`, `electron/preload.cjs`
- Config: `config/runtime.json`
- Cloud: `Dockerfile`, `render.yaml`, `Procfile`

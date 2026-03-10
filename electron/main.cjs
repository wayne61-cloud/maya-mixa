const { app, BrowserWindow, shell, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

function readRuntimeConfig() {
  const configPath = path.resolve(__dirname, '..', 'config', 'runtime.json');
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeBase(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

function authStatePath() {
  return path.join(app.getPath('userData'), 'auth-state.json');
}

function sanitizeAuthField(value, limit = 4096) {
  return String(value || '').trim().slice(0, limit);
}

function loadAuthState() {
  const fallback = { token: '', loginId: '' };
  try {
    const target = authStatePath();
    if (!fs.existsSync(target)) return fallback;
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      token: sanitizeAuthField(parsed.token || ''),
      loginId: sanitizeAuthField(parsed.loginId || '').toLowerCase(),
    };
  } catch (_) {
    return fallback;
  }
}

function saveAuthState(patch = {}) {
  const current = loadAuthState();
  const next = {
    token: Object.prototype.hasOwnProperty.call(patch, 'token')
      ? sanitizeAuthField(patch.token || '')
      : current.token,
    loginId: Object.prototype.hasOwnProperty.call(patch, 'loginId')
      ? sanitizeAuthField(patch.loginId || '').toLowerCase()
      : current.loginId,
  };
  try {
    const target = authStatePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(next, null, 2), 'utf8');
  } catch (_) {
    // Best effort.
  }
  return next;
}

function clearAuthState() {
  try {
    const target = authStatePath();
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch (_) {
    // Best effort.
  }
  return { token: '', loginId: '' };
}

function expandHome(inputPath) {
  const value = String(inputPath || '').trim();
  if (!value) return '';
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.aiff',
  '.aif',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
]);

function normalizeDeckLabel(raw, fallback = 'A') {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (Number(raw) === 1) return 'A';
    if (Number(raw) === 2) return 'B';
    return fallback;
  }
  const text = String(raw).trim().toUpperCase();
  if (!text) return fallback;
  if (['A', 'DECKA', 'DECK_A', 'LEFT', '1', 'DECK1'].includes(text)) return 'A';
  if (['B', 'DECKB', 'DECK_B', 'RIGHT', '2', 'DECK2'].includes(text)) return 'B';
  if (text.endsWith('A')) return 'A';
  if (text.endsWith('B')) return 'B';
  return fallback;
}

function walkFiles(root, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function collectAudioManifest(rootPath, limit = 1200) {
  const tracks = [];
  const maxItems = Math.max(1, Math.min(Number(limit) || 1200, 6000));
  const stack = [rootPath];
  while (stack.length && tracks.length < maxItems) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext)) continue;
      const baseName = path.basename(entry.name, ext).trim();
      let artist = 'Unknown Artist';
      let title = baseName || 'Unknown Track';
      if (baseName.includes(' - ')) {
        const parts = baseName.split(' - ');
        if (parts.length >= 2) {
          artist = parts[0].trim() || artist;
          title = parts.slice(1).join(' - ').trim() || title;
        }
      }
      tracks.push({
        file_path: full,
        title,
        artist,
      });
      if (tracks.length >= maxItems) break;
    }
  }
  return tracks;
}

function resolveLibraryScanRoots(preferredRoot = '') {
  const runtimeConfig = readRuntimeConfig();
  const fromConfig = []
    .concat(runtimeConfig.libraryScanRoots || [])
    .concat(runtimeConfig.libraryPath || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const candidates = [];
  if (preferredRoot) candidates.push(preferredRoot);
  candidates.push(...fromConfig);
  candidates.push(
    '~/Music',
    '~/Music/Music',
    '~/Music/iTunes',
    '~/Documents/Music'
  );
  const resolved = Array.from(new Set(candidates.map((item) => path.resolve(expandHome(item)))));
  return resolved.filter((item) => {
    try {
      return fs.existsSync(item) && fs.statSync(item).isDirectory();
    } catch (_) {
      return false;
    }
  });
}

function parseHistoryLine(line) {
  const clean = String(line || '').trim();
  if (!clean) return null;
  try {
    const maybe = JSON.parse(clean);
    if (maybe && typeof maybe === 'object') {
      if (maybe.deckA || maybe.deckB) return maybe;
      const explicitDeck = normalizeDeckLabel(maybe.deck || maybe.deck_id || maybe.deckIndex || maybe.channel, '');
      if (!explicitDeck) return null;
      const track = maybe.track && typeof maybe.track === 'object' ? maybe.track : maybe;
      return {
        deck: explicitDeck,
        track,
      };
    }
  } catch (_) {
    // Ignore and continue fallback parser.
  }

  let deckHint = '';
  const deckToken = clean.match(/\bdeck\s*([ab12])\b/i) || clean.match(/^\s*[\[(]?([ab12])[\])\s:\-]+/i);
  if (deckToken) {
    deckHint = normalizeDeckLabel(deckToken[1], '');
  }
  if (!deckHint) return null;
  const withoutDeck = clean
    .replace(/\bdeck\s*[ab12]\b[:\-\s]*/i, '')
    .replace(/^\s*[\[(]?[ab12][\])\s:\-]+/i, '')
    .trim();
  const source = withoutDeck || clean;
  if (source.includes(' - ')) {
    const [artist, ...rest] = source.split(' - ');
    const title = rest.join(' - ').trim();
    return {
      deck: deckHint || undefined,
      track: {
        artist: artist.trim() || 'Unknown Artist',
        title: title || source.slice(0, 180),
      },
    };
  }

  return {
    deck: deckHint,
    track: {
      artist: '',
      title: source.slice(0, 180),
    },
  };
}

function resolveSeratoHistoryPath(preferred = '') {
  const runtimeConfig = readRuntimeConfig();
  const fromConfig = String(runtimeConfig.seratoHistoryPath || '').trim();
  const fromEnv = String(process.env.MAYA_SERATO_HISTORY_PATH || '').trim();
  const candidates = [];
  if (preferred) candidates.push(preferred);
  if (fromConfig) candidates.push(fromConfig);
  if (fromEnv) candidates.push(fromEnv);
  candidates.push(
    '~/Music/_Serato_/History/Sessions',
    '~/Music/_Serato_/History',
    '~/Documents/_Serato_/History/Sessions',
    '~/Documents/_Serato_/History'
  );
  const uniqueCandidates = Array.from(new Set(candidates.map((item) => path.resolve(expandHome(item)))));
  for (const candidate of uniqueCandidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {
      // Ignore candidate errors.
    }
  }
  return uniqueCandidates[0] || path.resolve(os.homedir(), 'Music', '_Serato_', 'History', 'Sessions');
}

const seratoRelay = {
  active: false,
  connected: false,
  mode: 'history_auto',
  apiBase: '',
  token: '',
  historyPath: '',
  intervalMs: 1500,
  timer: null,
  tickBusy: false,
  fileOffsets: new Map(),
  lastPushAt: null,
  lastError: '',
};

function relayStatus() {
  return {
    active: Boolean(seratoRelay.active),
    connected: Boolean(seratoRelay.connected),
    mode: seratoRelay.mode,
    historyPath: seratoRelay.historyPath,
    lastPushAt: seratoRelay.lastPushAt,
    lastError: seratoRelay.lastError,
    intervalMs: seratoRelay.intervalMs,
  };
}

async function relayApi(method, route, payload) {
  const base = normalizeBase(seratoRelay.apiBase);
  if (!base) throw new Error('API base manquante');
  if (!seratoRelay.token) throw new Error('Token manquant');
  const headers = {
    Authorization: `Bearer ${seratoRelay.token}`,
  };
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${method} ${route} failed: ${response.status} ${body.slice(0, 240)}`);
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return {};
  }
}

function latestHistoryFile(historyRoot) {
  const files = walkFiles(historyRoot, []);
  if (!files.length) return '';
  files.sort((a, b) => {
    const aMtime = fs.statSync(a).mtimeMs;
    const bMtime = fs.statSync(b).mtimeMs;
    return bMtime - aMtime;
  });
  return files[0] || '';
}

function withDeckFallback(payload, rawLine = '') {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.deckA || payload.deckB) return payload;
  const explicit = normalizeDeckLabel(payload.deck, '');
  if (explicit) {
    return { ...payload, deck: explicit };
  }
  const token = String(rawLine || '').match(/\bdeck\s*([ab12])\b/i) || String(rawLine || '').match(/^\s*[\[(]?([ab12])[\])\s:\-]+/i);
  const lineGuess = token ? normalizeDeckLabel(token[1], '') : '';
  if (!lineGuess) return null;
  return { ...payload, deck: lineGuess };
}

async function relayTick() {
  if (!seratoRelay.active || seratoRelay.tickBusy) return;
  seratoRelay.tickBusy = true;
  try {
    if (!seratoRelay.connected) {
      await relayApi('POST', '/api/serato/connect', { mode: 'push', ws_url: '', history_path: '', feed_path: '' });
      seratoRelay.connected = true;
      seratoRelay.lastError = '';
    }

    const historyRoot = seratoRelay.historyPath;
    if (!historyRoot || !fs.existsSync(historyRoot)) {
      seratoRelay.lastError = `History path introuvable: ${historyRoot || '(vide)'}`;
      return;
    }

    const latest = latestHistoryFile(historyRoot);
    if (!latest) {
      seratoRelay.lastError = 'Aucun fichier de session Serato détecté.';
      return;
    }

    let content = '';
    try {
      content = fs.readFileSync(latest, 'utf8');
    } catch (error) {
      seratoRelay.lastError = String(error.message || error);
      return;
    }

    const allLines = content
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
    let lines = [];
    if (!seratoRelay.fileOffsets.has(latest)) {
      seratoRelay.fileOffsets.set(latest, content.length);
      lines = [];
    } else {
      const prevOffset = Number(seratoRelay.fileOffsets.get(latest) || 0);
      const safeOffset = Math.min(prevOffset, content.length);
      const delta = content.slice(safeOffset);
      seratoRelay.fileOffsets.set(latest, content.length);
      lines = delta
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);
    }

    if (!lines.length) {
      seratoRelay.lastError = '';
      return;
    }

    for (const line of lines) {
      const payload = parseHistoryLine(line);
      if (!payload) continue;
      const normalized = withDeckFallback(payload, line);
      if (!normalized) continue;
      await relayApi('POST', '/api/serato/push', {
        source: 'electron_serato_history_auto',
        payload: normalized,
      });
      seratoRelay.lastPushAt = new Date().toISOString();
    }
    seratoRelay.lastError = '';
  } catch (error) {
    seratoRelay.connected = false;
    seratoRelay.lastError = String(error.message || error);
  } finally {
    seratoRelay.tickBusy = false;
  }
}

async function startSeratoRelay(options = {}) {
  const apiBase = normalizeBase(options.apiBase);
  const token = String(options.token || '').trim();
  const force = Boolean(options.force);
  const historyPath = resolveSeratoHistoryPath(options.historyPath || '');

  if (!apiBase) throw new Error('API base manquante');
  if (!token) throw new Error('Token manquant');

  if (
    seratoRelay.active &&
    !force &&
    seratoRelay.apiBase === apiBase &&
    seratoRelay.token === token &&
    seratoRelay.historyPath === historyPath
  ) {
    return relayStatus();
  }

  await stopSeratoRelay({ disconnect: false });
  seratoRelay.apiBase = apiBase;
  seratoRelay.token = token;
  seratoRelay.historyPath = historyPath;
  seratoRelay.active = true;
  seratoRelay.connected = false;
  seratoRelay.lastError = '';
  seratoRelay.lastPushAt = null;
  seratoRelay.fileOffsets = new Map();

  seratoRelay.timer = setInterval(() => {
    void relayTick();
  }, seratoRelay.intervalMs);
  await relayTick();
  return relayStatus();
}

async function stopSeratoRelay(options = {}) {
  const disconnect = options.disconnect !== false;
  if (seratoRelay.timer) {
    clearInterval(seratoRelay.timer);
    seratoRelay.timer = null;
  }
  seratoRelay.active = false;
  seratoRelay.tickBusy = false;
  seratoRelay.fileOffsets = new Map();

  if (disconnect && seratoRelay.apiBase && seratoRelay.token) {
    try {
      await relayApi('POST', '/api/serato/disconnect', {});
    } catch (_) {
      // Best effort.
    }
  }

  seratoRelay.connected = false;
  seratoRelay.lastPushAt = null;
  return relayStatus();
}

async function scanLocalLibrary(options = {}) {
  const preferredRoot = String(options.rootPath || '').trim();
  const roots = resolveLibraryScanRoots(preferredRoot);
  if (!roots.length) {
    return {
      ok: false,
      roots,
      scanned: 0,
      truncated: false,
      tracks: [],
      error: 'Aucun dossier musique local trouvé',
    };
  }
  const limit = Math.max(1, Math.min(Number(options.limit) || 2000, 6000));
  const tracks = [];
  let truncated = false;
  for (const root of roots) {
    if (tracks.length >= limit) break;
    const remaining = limit - tracks.length;
    const subset = collectAudioManifest(root, remaining);
    tracks.push(...subset);
    if (tracks.length >= limit) {
      truncated = true;
      break;
    }
  }
  const unique = [];
  const seen = new Set();
  for (const row of tracks) {
    const key = String(row.file_path || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return {
    ok: true,
    roots,
    scanned: unique.length,
    truncated,
    tracks: unique,
  };
}

function versionParts(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i += 1) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

async function checkDesktopUpdates() {
  const runtimeConfig = readRuntimeConfig();
  const repo = String(process.env.MAYA_UPDATES_REPO || runtimeConfig.updatesRepo || 'wayne61-cloud/maya-mixa').trim();
  const currentVersion = app.getVersion();
  if (!repo.includes('/')) {
    return {
      ok: false,
      repo,
      currentVersion,
      updateAvailable: false,
      error: 'updatesRepo invalide',
    };
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'maya-mixa-desktop',
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub ${response.status} ${body.slice(0, 120)}`);
    }
    const release = await response.json();
    const latestVersion = String(release.tag_name || release.name || '').trim().replace(/^v/i, '');
    if (!latestVersion) throw new Error('Aucune version latest trouvée');
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    return {
      ok: true,
      repo,
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: String(release.html_url || ''),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      repo,
      currentVersion,
      updateAvailable: false,
      error: String(error.message || error),
      checkedAt: new Date().toISOString(),
    };
  }
}

ipcMain.handle('maya-serato-start', async (_event, payload) => startSeratoRelay(payload || {}));
ipcMain.handle('maya-serato-stop', async () => stopSeratoRelay({ disconnect: true }));
ipcMain.handle('maya-serato-status', async () => relayStatus());
ipcMain.handle('maya-library-scan', async (_event, payload) => scanLocalLibrary(payload || {}));
ipcMain.handle('maya-updates-check', async () => checkDesktopUpdates());
ipcMain.handle('maya-auth-load', async () => loadAuthState());
ipcMain.handle('maya-auth-save', async (_event, payload) => saveAuthState(payload || {}));
ipcMain.handle('maya-auth-clear', async () => clearAuthState());

function createMainWindow() {
  const appIcon = path.join(__dirname, '..', 'assets', 'icons', 'maya-icon-512.png');
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#120d03',
    title: 'Maya Mixa',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const runtimeConfig = readRuntimeConfig();
  const explicitUrl = String(process.env.MAYA_APP_URL || runtimeConfig.appUrl || '').trim();
  const localIndexPath = path.join(__dirname, '..', 'index.html');
  if (explicitUrl) {
    let fallbackUsed = false;
    const fallbackToLocal = () => {
      if (fallbackUsed || win.isDestroyed()) return;
      fallbackUsed = true;
      win.loadFile(localIndexPath);
    };
    win.webContents.once('did-fail-load', () => {
      fallbackToLocal();
    });
    win.loadURL(explicitUrl).catch(() => {
      fallbackToLocal();
    });
  } else {
    win.loadFile(localIndexPath);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => {
  void stopSeratoRelay({ disconnect: true });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

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

function expandHome(inputPath) {
  const value = String(inputPath || '').trim();
  if (!value) return '';
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
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

function parseHistoryLine(line) {
  const clean = String(line || '').trim();
  if (!clean) return null;
  try {
    const maybe = JSON.parse(clean);
    if (maybe && typeof maybe === 'object') return maybe;
  } catch (_) {
    // Ignore and continue fallback parser.
  }

  if (clean.includes(' - ')) {
    const [artist, ...rest] = clean.split(' - ');
    const title = rest.join(' - ').trim();
    return {
      deck: 'A',
      track: {
        artist: artist.trim() || 'Unknown Artist',
        title: title || clean.slice(0, 180),
      },
    };
  }

  return {
    deck: 'A',
    track: {
      artist: 'Unknown Artist',
      title: clean.slice(0, 180),
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

    if (!seratoRelay.fileOffsets.has(latest)) {
      seratoRelay.fileOffsets.set(latest, content.length);
      seratoRelay.lastError = '';
      return;
    }

    const prevOffset = Number(seratoRelay.fileOffsets.get(latest) || 0);
    const safeOffset = Math.min(prevOffset, content.length);
    const delta = content.slice(safeOffset);
    seratoRelay.fileOffsets.set(latest, content.length);

    const lines = delta
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      seratoRelay.lastError = '';
      return;
    }

    for (const line of lines) {
      const payload = parseHistoryLine(line);
      if (!payload) continue;
      await relayApi('POST', '/api/serato/push', {
        source: 'electron_serato_history_auto',
        payload,
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

ipcMain.handle('maya-serato-start', async (_event, payload) => startSeratoRelay(payload || {}));
ipcMain.handle('maya-serato-stop', async () => stopSeratoRelay({ disconnect: true }));
ipcMain.handle('maya-serato-status', async () => relayStatus());

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
  if (explicitUrl) {
    win.loadURL(explicitUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'index.html'));
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

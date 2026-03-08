const { app, BrowserWindow, shell } = require('electron');
const fs = require('fs');
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

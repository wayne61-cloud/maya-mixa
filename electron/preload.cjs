const { contextBridge, ipcRenderer } = require('electron');
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

const fileConfig = readRuntimeConfig();
const apiBase = String(process.env.MAYA_API_BASE || fileConfig.apiBase || '').trim().replace(/\/+$/, '');

contextBridge.exposeInMainWorld('mayaConfig', {
  apiBase,
  isElectron: true,
  releaseChannel: process.env.MAYA_RELEASE_CHANNEL || 'stable',
});

contextBridge.exposeInMainWorld('mayaDesktop', {
  serato: {
    start: (payload = {}) => ipcRenderer.invoke('maya-serato-start', payload),
    stop: () => ipcRenderer.invoke('maya-serato-stop'),
    status: () => ipcRenderer.invoke('maya-serato-status'),
  },
});

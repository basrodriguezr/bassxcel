'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bassxcelDesktop', {
  onOpenFile: cb => ipcRenderer.on('open-file', (e, file) => cb(file)),
  version: () => ipcRenderer.invoke('app-version'),
});

'use strict';
// Bassxcel — proceso principal de la app de escritorio
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let pendingFile = process.argv.find(a => /\.bassx$/i.test(a)) || null;

function sendFile(file) {
  if (!win || !file) return;
  try {
    win.webContents.send('open-file', { name: path.basename(file), text: fs.readFileSync(file, 'utf8') });
  } catch (e) { console.error(e); }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 720, minHeight: 480,
    title: 'Bassxcel',
    icon: path.join(__dirname, '..', 'web', 'icons', 'icon-512.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, '..', 'web', 'index.html'));
  win.webContents.on('did-finish-load', () => { if (pendingFile) { sendFile(pendingFile); pendingFile = null; } });
  // La app pide confirmar al cerrar o recargar solo si el autoguardado falló y hay cambios sin guardar (L-041).
  // Electron no muestra el aviso del navegador: sin esto la ventana no se cerraría. preventDefault() = salir igual.
  win.webContents.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Salir sin guardar', 'Cancelar'], defaultId: 1, cancelId: 1, title: 'Bassxcel',
      message: '¿Salir sin guardar los cambios?',
      detail: 'No se pudo autoguardar el libro y tiene cambios que no están guardados en un archivo. Si sales ahora, se perderán. Elige Cancelar y usa Guardar (Ctrl+G).',
    });
    if (choice === 0) e.preventDefault();
  });
  // Enlaces externos al navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // Ctrl+Shift+I abre herramientas de desarrollo (F12 queda para "Guardar como", como en Excel); Ctrl+Shift+R recarga.
  // Sin menú (setMenu(null)) no hay aceleradores: Ctrl+N, Ctrl+G, Ctrl+U… llegan a la app (atajos de Excel en español)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
    if (input.control && input.shift && input.key.toLowerCase() === 'r') win.webContents.reloadIgnoringCache();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const file = argv.find(a => /\.bassx$/i.test(a));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); sendFile(file); }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}

ipcMain.handle('app-version', () => app.getVersion());

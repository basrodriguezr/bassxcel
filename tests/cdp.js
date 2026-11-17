'use strict';
// Cliente mínimo de Chrome DevTools Protocol para los arneses de UI (sin dependencias: Node 22+ trae WebSocket).
// Lanza Chrome headless con un perfil temporal, sirve web/ con tests/qa-serve.js y da entrada REAL de ratón y teclado
// (Input.dispatch*), que es lo que exige L-031 para los gestos compuestos. Lo usan los *.harness.js de tests/.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms = 10000, step = 100) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* reintentar */ }
    if (Date.now() - t0 > ms) throw new Error('tiempo de espera agotado');
    await sleep(step);
  }
}

// Carpeta web/ que se sirve: `--web=<carpeta>` (o `--web <carpeta>`) en la línea de comandos del arnés, o BX_WEB.
// tests/ui-mutate.js la usa para probar una copia mutada sin tocar web/app.js (L-049)
function webRoot() {
  const i = process.argv.findIndex(a => a === '--web' || a.startsWith('--web='));
  const arg = i < 0 ? null : process.argv[i].startsWith('--web=') ? process.argv[i].slice(6) : process.argv[i + 1];
  return path.resolve(arg || process.env.BX_WEB || path.join(__dirname, '..', 'web'));
}

async function launch({ port = 8771, cdpPort = 9339, lang = 'es-CL', web = webRoot() } = {}) {
  const root = path.resolve(__dirname, '..');
  if (!fs.existsSync(path.join(web, 'app.js'))) throw new Error('la carpeta web no tiene app.js: ' + web);
  // un Chrome huérfano de una corrida anterior en el mismo puerto haría que el arnés se conecte a él (cuelgues)
  const busy = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(() => true, () => false);
  if (busy) throw new Error(`el puerto CDP ${cdpPort} ya está en uso (¿Chrome de una corrida anterior?): ciérralo o usa otro puerto`);
  const server = spawn(process.execPath, [path.join(__dirname, 'qa-serve.js'), '--web=' + web], { cwd: root, env: { ...process.env, PORT: String(port), BX_WEB: web }, stdio: 'ignore' });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-cdp-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', `--lang=${lang}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  const list = await waitFor(async () => { const r = await fetch(`http://127.0.0.1:${cdpPort}/json/list`); const j = await r.json(); return j.find(t => t.type === 'page') && j; });
  const target = list.find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method) for (const l of listeners.slice()) l(m);
  };
  // cada comando tiene un tiempo máximo: un diálogo nativo sin responder o Chrome colgado no deben trabar el arnés
  const send = (method, params = {}, ms = 20000) => new Promise((res, rej) => {
    const i = ++id;
    const t = setTimeout(() => { pending.delete(i); rej(new Error('sin respuesta a ' + method)); }, ms);
    pending.set(i, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const on = fn => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); };
  const once = (method, ms = 10000) => new Promise((res, rej) => {
    const t = setTimeout(() => { off(); rej(new Error('sin evento ' + method)); }, ms);
    const off = on(m => { if (m.method === method) { clearTimeout(t); off(); res(m.params); } });
  });
  await send('Page.enable'); await send('Runtime.enable');
  const errors = [];
  on(m => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text); });
  // Diálogos nativos (alert, confirm, beforeunload): se registran en `dialogs` y se responden con api.dialogAccept
  // (un diálogo sin responder cuelga la navegación, como en REA: ver tests/ui-scenarios.md)
  const dialogs = [], consoleLog = [];
  on(m => { if (m.method === 'Runtime.consoleAPICalled') consoleLog.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200)); if (consoleLog.length > 50) consoleLog.shift(); });
  on(m => { if (/^Page\.(frameStartedNavigating|navigatedWithinDocument|frameRequestedNavigation|lifecycleEvent|frameNavigated|javascriptDialog)/.test(m.method)) { consoleLog.push('[' + m.method + '] ' + JSON.stringify(m.params).slice(0, 160)); if (consoleLog.length > 50) consoleLog.shift(); } });
  on(m => {
    if (m.method !== 'Page.javascriptDialogOpening') return;
    dialogs.push({ type: m.params.type, message: m.params.message });
    send('Page.handleJavaScriptDialog', { accept: api.dialogAccept }).catch(() => {});
  });
  const url = `http://127.0.0.1:${port}/index.html`;

  // Evalúa una expresión en la página (con await) y devuelve el valor
  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    return r.result.value;
  }
  // Navega (Page.navigate o Page.reload) y espera a que el documento NUEVO termine de cargar. No se depende de
  // Page.loadEventFired: al salir hacia about:blank a veces no llega y el arnés se colgaba. Se marca el documento
  // actual y se espera a uno sin la marca con readyState 'complete'
  async function navigate(method, params) {
    const attempt = async () => {
      await send('Runtime.evaluate', { expression: 'window.__bxOld = 1' }, 5000).catch(() => {});
      await send(method, params);
      await waitFor(async () => {
        const r = await send('Runtime.evaluate', { expression: '!window.__bxOld && document.readyState === "complete" && location.href', returnByValue: true }, 3000);
        return r.result && r.result.value && (!params || !params.url || r.result.value === params.url);
      }, 15000, 100);
    };
    try { await attempt(); }
    catch (e) {
      // L-058: a veces Chrome deja la navegación colgada (frameStartedNavigating sin respuesta, tras about:blank y
      // Storage.clearDataForOrigin). Se reintenta una sola vez y queda registrado en stderr: la intermitencia no se oculta
      if (method !== 'Page.navigate') throw e;
      process.stderr.write(`REINTENTO Page.navigate ${params && params.url} (${e.message})\n`);
      await send('Page.stopLoading', {}, 5000).catch(() => {});
      await attempt();
    }
  }
  // Libro nuevo: se sale de la página (su beforeunload autoguarda) y recién entonces se borra el almacenamiento del
  // origen; borrar antes de recargar no sirve, el autoguardado del beforeunload lo vuelve a escribir
  async function open(clearStorage = true) {
    await waitFor(async () => (await fetch(url)).ok);
    if (clearStorage) {
      await navigate('Page.navigate', { url: 'about:blank' });
      await send('Storage.clearDataForOrigin', { origin: new URL(url).origin, storageTypes: 'local_storage' });
    }
    await navigate('Page.navigate', { url });
    await waitFor(() => ev("!!document.querySelector(\"#grid tbody tr[data-r='0'] td\")"));
  }
  // Ratón real en coordenadas de la ventana
  async function click(x, y, { button = 'left', clickCount = 1, modifiers = 0 } = {}) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
    for (let n = 1; n <= clickCount; n++) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: n, modifiers });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: n, modifiers });
    }
  }
  // Clic en el centro de un elemento (selector CSS)
  async function clickSel(sel, opts) {
    const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!r) throw new Error('no existe ' + sel);
    await click(r.x, r.y, opts);
  }
  // Clic real en el elemento de `sel` cuyo texto es `text` (opciones de menú: el <hr> también cuenta en nth-child)
  async function clickText(sel, text, opts) {
    const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!r) throw new Error('no existe ' + sel + ' con el texto ' + text);
    await click(r.x, r.y, opts);
  }
  const cellSel = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return `#grid tbody tr[data-r='${+m[2] - 1}'] td:nth-of-type(${c})`; };
  // Teclas reales. mods: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift
  const VK = { Enter: 13, Tab: 9, Escape: 27, Delete: 46, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, F2: 113, F3: 114, F4: 115, F10: 121 };
  async function key(k, mods = 0) {
    const code = VK[k] ? k : /^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^\d$/.test(k) ? 'Digit' + k : undefined;
    // solo letras y dígitos llevan código virtual: '$' (36) o '%' (37) se leerían como Inicio o ←
    const vk = VK[k] || (/^[a-z0-9]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : 0);
    // Enter de un teclado real también produce el carácter "\r": sin él no hay envío implícito de formularios (<dialog>)
    const printable = (k.length === 1 || k === 'Enter') && !(mods & 2) && !(mods & 4);
    const text = k === 'Enter' ? '\r' : k;
    await send('Input.dispatchKeyEvent', { type: printable ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, text: printable ? text : undefined });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
  }
  async function type(text) { for (const ch of text) await key(ch); }
  // Clic en la celda y escribir como una persona (texto + Enter)
  async function enter(a, text) { await clickSel(cellSel(a)); await type(text); await key('Enter'); }
  async function close() {
    try { await send('Browser.close', {}, 3000); } catch { /* ya cerrado o colgado: se mata abajo */ }
    try { ws.close(); } catch { /* nada */ }
    // en Windows kill() solo cierra el proceso principal: taskkill /T cierra también los procesos hijos de Chrome
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill();
    server.kill();
    // el perfil se borra cuando Chrome terminó (hasta 5 s) y con reintentos: sus procesos hijos tardan en soltar los
    // archivos y un rmSync sin reintentos fallaba en silencio (quedaban cientos de bx-cdp-* en Temp; P2 del backlog)
    if (chrome.exitCode === null && chrome.signalCode === null) await Promise.race([new Promise(r => chrome.once('exit', r)), sleep(5000)]);
    for (let i = 0; i < 3 && fs.existsSync(profile); i++) {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { await sleep(1000); }
    }
    if (fs.existsSync(profile)) process.stderr.write('AVISO: no se pudo borrar el perfil de Chrome ' + profile + '\n');
  }
  const api = { send, on, once, navigate, ev, open, click, clickSel, clickText, cellSel, key, type, enter, close, errors, dialogs, consoleLog, dialogAccept: true, url, sleep, web };
  return api;
}

// Registro de resultados de un arnés
function reporter() {
  let ok = 0, bad = 0;
  const check = (name, cond, got) => { if (cond) ok++; else bad++; console.log((cond ? 'OK    ' : 'FALLA ') + name + (cond ? '' : '  → ' + JSON.stringify(got))); };
  const done = () => { console.log(`\n${ok} OK, ${bad} fallas`); return bad; };
  return { check, done };
}

module.exports = { launch, reporter, sleep, waitFor, webRoot };

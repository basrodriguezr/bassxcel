'use strict';
// Ensayo de la receta REA UI-47 con CDP: ejecuta los mismos fragmentos del puente (observador y libros preparados) y los
// mismos gestos, y muestra las líneas "UI47 …" de la consola para copiarlas como texto esperado de la receta.
const path = require('path');
const { launch, sleep, waitFor } = require(path.resolve(process.argv[2], 'tests', 'cdp.js'));
const S = require('./ui47-snippets.js');

(async () => {
  const b = await launch({ port: 8776, cdpPort: 9344, web: path.resolve(process.argv[2], 'web') });
  const { ev, key, clickSel, clickText, cellSel } = b;
  const fill = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const pressOn = async (sel, k, mods = 0) => { if (sel !== ':focus') await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await key(k, mods); };
  const selOpt = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const preset = async js => { await ev('window.__mark = 1'); await ev(js); await waitFor(() => ev("!window.__mark && document.readyState === 'complete' && !!document.querySelector(\"#grid tbody tr[data-r='0'] td\")"), 15000); };
  const lines = () => b.consoleLog.filter(l => l.startsWith('UI47') || l.startsWith('QA'));
  const show = (name) => { console.log('--- ' + name); for (const l of lines()) console.log(l); b.consoleLog.length = 0; };
  try {
    // 1: aceptación A
    await b.open(); b.consoleLog.length = 0;
    await ev(S.observer);
    await fill('#nameBox', 'B2:B10'); await pressOn('#nameBox', 'Enter');
    await clickSel("button[data-cmd='dv']"); await clickSel('#menu div:nth-child(1)');
    await selOpt('#dvType', 'list'); await fill('#dvSrc', 'Sí;No'); await clickSel('#dvDlg .dlg-ok');
    await clickSel(cellSel('B2')); await sleep(200);
    await pressOn('#gridWrap', 'ArrowDown', 1); await sleep(200);
    await pressOn('#gridWrap', 'ArrowDown'); await sleep(200);
    await pressOn('#gridWrap', 'Enter'); await sleep(300);
    await pressOn('#gridWrap', 'z', 2); await sleep(300);
    show('1');
    // 2: aceptación B
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetList); await ev(S.observer);
    await clickSel(cellSel('B3')); await pressOn('#gridWrap', 'Q'); await fill('#cellEditor', 'Quizás'); await pressOn('#cellEditor', 'Enter'); await sleep(300);
    await clickSel('#dvErrDlg .dlg-ok'); await sleep(200);
    await fill('#cellEditor', 'Sí'); await pressOn('#cellEditor', 'Enter'); await sleep(300);
    show('2');
    // 3: Cancelar, Esc y ratón
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetList); await ev(S.observer);
    await clickSel(cellSel('B4')); await pressOn('#gridWrap', 'Q'); await fill('#cellEditor', 'Quizás'); await pressOn('#cellEditor', 'Enter'); await sleep(300);
    await clickSel('#dvErrDlg .dlg-cancel'); await sleep(200);
    await pressOn('#gridWrap', 'ArrowDown', 1); await sleep(200);
    await pressOn('#gridWrap', 'Escape'); await sleep(200);
    await clickSel('#dvBtn'); await sleep(200);
    await clickSel('#dvList div:nth-child(2)'); await sleep(300);
    show('3');
    // 4: mensaje de entrada y Advertencia
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetMsg); await ev(S.observer);
    await clickSel(cellSel('B3')); await sleep(200);
    await clickSel(cellSel('C3')); await sleep(200);
    await clickSel(cellSel('B3')); await pressOn('#gridWrap', 'z'); await fill('#cellEditor', 'zz'); await pressOn('#cellEditor', 'Enter'); await sleep(300);
    await clickSel('#dvErrDlg .dlg-more'); await sleep(200);
    await pressOn('#cellEditor', 'Enter'); await sleep(300);
    await clickSel('#dvErrDlg .dlg-ok'); await sleep(300);
    show('4');
    // 5: insertar fila, Personalizada, Ctrl+Z
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetMatrix); await ev(S.observer);
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='ins-row']");
    console.log('QA ' + JSON.stringify(await ev(S.readDv)));
    await clickSel(cellSel('A3')); await pressOn('#gridWrap', '-'); await fill('#cellEditor', '-5'); await pressOn('#cellEditor', 'Enter'); await sleep(300);
    await clickSel('#dvErrDlg .dlg-cancel'); await sleep(200);
    await pressOn('#gridWrap', 'z', 2);
    console.log('QA ' + JSON.stringify(await ev(S.readDv)));
    show('5');
    console.log('errores: ' + JSON.stringify(b.errors));
  } catch (e) { console.log('ERROR ' + (e.stack || e)); console.log(b.consoleLog.slice(-20).join('\n')); }
  finally { await b.close(); }
})();

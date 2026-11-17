'use strict';
// Ensayo de la receta REA UI-48 con CDP: los mismos fragmentos del puente (ui48-snippets.js) y los mismos gestos, en el
// orden de la receta; muestra las líneas "UI48 …" y "QA …" de la consola para copiarlas como texto esperado (L-062).
// Uso: node ui48-sim.js <raíz del proyecto>   (puertos 8777 / 9345: no choca con los arneses)
const path = require('path');
const { launch, sleep, waitFor } = require(path.resolve(process.argv[2], 'tests', 'cdp.js'));
const S = require('./ui48-snippets.js');

(async () => {
  const b = await launch({ port: 8777, cdpPort: 9345, web: path.resolve(process.argv[2], 'web') });
  const { ev, key, clickSel, cellSel } = b;
  // fill de Playwright: foco, valor y evento input
  const fill = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const pressOn = async (sel, k, mods = 0) => { if (sel !== ':focus') await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await key(k, mods); };
  const selOpt = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  // puente: fill #qaEval + Enter (el resultado sale como "QA {...}"; aquí se imprime igual)
  const bridge = async js => { let out; try { out = { ok: await ev(js) }; } catch (e) { out = { err: String(e) }; } console.log('QA ' + JSON.stringify(out)); await ev(`(() => { const w = document.getElementById('gridWrap'); if (document.activeElement && document.activeElement.id === 'qaEval') w.focus({ preventScroll: true }); })()`); };
  const preset = async js => { await ev('window.__mark = 1'); await ev(js); await waitFor(() => ev("!window.__mark && document.readyState === 'complete' && !!document.querySelector(\"#grid tbody tr[data-r='0'] td\")"), 15000); };
  const lines = () => b.consoleLog.filter(l => l.startsWith('UI48'));
  const show = name => { console.log('--- ' + name); for (const l of lines()) console.log(l); b.consoleLog.length = 0; };
  const cfMenu = async (i, j) => { await clickSel("button[data-cmd='cf']"); await clickSel(`#menu div:nth-child(${i})`); if (j) await clickSel(`#menu2 div:nth-child(${j})`); };
  try {
    // 1: aceptación (parte 1)
    await b.open(); b.consoleLog.length = 0;
    await ev(S.observer);
    await clickSel(cellSel('C1')); await bridge(S.montos);
    await fill('#nameBox', 'C2:C9'); await pressOn('#nameBox', 'Enter');
    await cfMenu(1, 1); await sleep(300);
    await fill('#cfV1', '100'); await sleep(200);
    await selOpt('#cfPreset', '3'); await sleep(200);
    await clickSel('#cfQuickDlg .dlg-ok'); await sleep(300);
    await pressOn('#gridWrap', 'z', 2); await sleep(300);
    show('1');
    // 2: aceptación (parte 2)
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetOne); await ev(S.observer);
    await clickSel(cellSel('C3')); await pressOn('#gridWrap', '5'); await fill('#cellEditor', '50'); await pressOn('#cellEditor', 'Enter'); await sleep(300);
    await pressOn('#gridWrap', 'z', 2); await sleep(300);
    await pressOn('#gridWrap', 'y', 2); await sleep(300);
    await bridge(S.readCf);
    show('2');
    // 3: Esc revierte la vista previa
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetE1); await ev(S.observer);
    await fill('#nameBox', 'C2:C9'); await pressOn('#nameBox', 'Enter');
    await cfMenu(1, 1); await sleep(300);
    await fill('#cfV1', '0'); await sleep(200);
    await pressOn(':focus', 'Escape'); await sleep(300);
    show('3');
    // 4: referencia con clic en una celda (puente) y regla arriba
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetE1); await ev(S.observer);
    await fill('#nameBox', 'C2:C9'); await pressOn('#nameBox', 'Enter');
    await cfMenu(1, 1); await sleep(300);
    await bridge(S.pickE1); await sleep(200);
    await clickSel('#cfQuickDlg .dlg-ok'); await sleep(300);
    await bridge(S.readCf);
    show('4');
    // 5: Administrador
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetTwo); await ev(S.observer);
    await clickSel(cellSel('C3'));
    await cfMenu(9); await sleep(300);
    await clickSel('#cfTable tbody tr:nth-child(2) td.cf-rule'); await clickSel('#cfUp'); await sleep(200);
    await clickSel('#cfApply'); await sleep(300);
    await clickSel('#cfTable tbody tr:nth-child(1) .cf-stop'); await clickSel('#cfMgrDlg .dlg-ok'); await sleep(300);
    await pressOn('#gridWrap', 'z', 2); await sleep(300);
    show('5');
    // 6: insertar fila, Borrar formato y Ctrl+Z
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetOne); await ev(S.observer);
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='ins-row']"); await sleep(300);
    await clickSel(cellSel('C4')); await clickSel("button[data-cmd='clearfmt']");
    await bridge(S.readCf);
    await pressOn('#gridWrap', 'z', 2); await pressOn('#gridWrap', 'z', 2);
    await bridge(S.readCf);
    show('6');
    // 7: .xlsx avisa
    await b.open(); b.consoleLog.length = 0;
    await preset(S.presetOne); await ev(S.observer);
    await bridge(S.noDownload);
    await clickSel("button[data-cmd='xlsx']"); await sleep(300);
    await clickSel('#msgCancel'); await sleep(300);
    await bridge('window.__book === null');
    show('7');
    console.log('errores: ' + JSON.stringify(b.errors));
  } catch (e) { console.log('ERROR ' + (e.stack || e)); console.log(b.consoleLog.slice(-20).join('\n')); }
  finally { await b.close(); }
})();

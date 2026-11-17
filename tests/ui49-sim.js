'use strict';
// Ensayo con CDP de la receta REA UI-49 (formato condicional, parte 2): los mismos fragmentos del puente y los mismos
// gestos, en el orden de la receta; imprime las líneas "UI49 …" y "QA …" de la consola para copiarlas como texto
// esperado (L-062). Antes de ensayar comprueba que cada fragmento sea solo ASCII y esté copiado tal cual en
// tests/ui-scenarios.md. Uso: node tests/ui49-sim.js   (puertos 8778 / 9346: no choca con los arneses)
// Gestos de Playwright imitados: fill = foco + valor + input; select_option = valor + input + change; press = foco +
// tecla real; click = clic real en el centro del elemento.
const fs = require('fs'), path = require('path');
const { launch, sleep, waitFor } = require('./cdp');

// Fragmentos del puente (los mismos que la receta; se escriben en #qaEval)
const PRE = (cells, cf) => `localStorage.setItem('bassxcel.v1', JSON.stringify({ app: 'Bassxcel', version: 1, syntax: 'es-CL', name: 'Libro1', active: 0, names: [], sheets: [{ name: 'Hoja1', rows: 1000, cols: 52, colW: {}, cells: ${cells}, cf: ${cf} }] })); Storage.prototype.setItem = function () {}; location.reload(); 1`;
const CELLS5 = "{ A1: { v: '0' }, A2: { v: '25' }, A3: { v: '50' }, A4: { v: '75' }, A5: { v: '100' }, E1: { v: '80' } }";
const S = {
  observer: "window.confirm = () => true; window.__lg = t => console.log('UI49 ' + String(t).replace(/[^\\x20-\\x7e]/g, '?')); window.__cells = 'A1 A2 A3 A4 A5'; window.__cc = a => { const t = Q.td(a); if (!t) return '?'; const k = { 'rgb(248, 105, 107)': 'R', 'rgb(255, 235, 132)': 'Y', 'rgb(99, 190, 123)': 'G', 'rgba(0, 0, 0, 0)': '' }[getComputedStyle(t).backgroundColor]; let s = k === undefined ? 'x' : k; const br = t.querySelector('.cfbar'); if (br) s += 'b' + Math.round(br.getBoundingClientRect().width / (t.clientWidth - 4) * 100) + (getComputedStyle(br).backgroundColor === 'rgb(255, 0, 0)' ? '!' : ''); const ic = t.querySelector('.cfic svg'); if (ic) s += 'i' + ic.dataset.ic; return Q.t(a) + (s ? ':' + s : ''); }; window.__sig = ''; window.__st = () => { const o = id => { const e = document.getElementById(id); return e && e.open ? e : null; }, rd = o('cfRuleDlg'), mg = o('cfMgrDlg'), ms = o('msgDlg'), fd = o('cfFmtDlg'); const p = ['NB=' + Q.nb(), 'C=' + __cells.split(' ').map(__cc).join(',')]; if (rd) p.push('RULE ' + document.getElementById('cfTypes').value + ' ' + document.getElementById('cfVStyle').value + ' ' + [...document.querySelectorAll('#cfIRows tr')].map(tr => tr.querySelector('svg').dataset.ic).join(',')); if (mg) p.push('MGR ' + [...mg.querySelectorAll('#cfTable tbody tr')].map(tr => tr.querySelector('.cf-rule').textContent + ' @ ' + tr.querySelector('.cf-at').value + (tr.querySelector('.cf-stop').disabled ? ' [-]' : '')).join(' | ')); if (fd) p.push('FMT ' + document.getElementById('cfFmtSample').textContent); if (ms) p.push('MSG ' + document.getElementById('msgText').textContent.split('\\n')[0]); if (getComputedStyle(document.getElementById('menu')).display !== 'none') p.push('MENU'); return p.join(' . '); }; window.__fire = () => setTimeout(() => { const s = __st(); if (s !== __sig) { __sig = s; __lg(s); } }, 120); new MutationObserver(__fire).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'style', 'class'] }); for (const t of ['click', 'keyup', 'input', 'change']) document.addEventListener(t, __fire, true); 1",
  data5: "(() => { const dt = new DataTransfer(); dt.setData('text/plain', '0\\r\\n25\\r\\n50\\r\\n75\\r\\n100'); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return Q.t('A5'); })()",
  hover1: "(() => { const d = document.querySelector('#menu2 div:nth-child(1)'); d.dispatchEvent(new MouseEvent('mouseenter')); return d.textContent; })()",
  presetVals: PRE(CELLS5, '[]'),
  presetNeg: PRE("{ A1: { v: '-50' }, A2: { v: '0' }, A3: { v: '50' }, A4: { v: '100' } }", '[]'),
  presetBar: PRE(CELLS5.replace("E1: { v: '80' }", "E1: { v: '100' }"), "[{ ranges: [{ r1: 0, c1: 0, r2: 4, c2: 0 }], type: 'bar', lo: { k: 'num', v: '0' }, hi: { k: 'formula', v: '=$E$1' }, color: '#638ec6', grad: false }]"),
  presetGt: PRE("{ A1: { v: '0,5' }, A2: { v: '1234,5' }, A3: { v: '50' } }", "[{ ranges: [{ r1: 0, c1: 0, r2: 2, c2: 0 }], type: 'cellIs', op: 'greaterThan', f1: '10', style: { bg: '#ffc7ce' } }]"),
  presetNum: PRE("{ A1: { v: '0,5' }, A2: { v: '1234,5' }, A3: { v: '50' } }", '[]'),
  readCf: "new Promise(r => setTimeout(r, 500)).then(() => { const L = (r, c) => String.fromCharCode(65 + c) + (r + 1); const pt = p => p.k + (p.v ? ' ' + p.v : ''); return JSON.stringify((Q.sheet().cf || []).map(d => d.ranges.map(g => L(g.r1, g.c1) + ':' + L(g.r2, g.c2)).join(' ') + '|' + d.type + '|' + (d.type === 'bar' ? pt(d.lo) + ',' + pt(d.hi) : d.type === 'scale' ? d.pts.map(pt).join(',') : d.type === 'icons' ? d.set : (d.op || '') + '|' + (d.f1 || '')))); })",
  pickA6: "(() => { const r = Q.td('A6').getBoundingClientRect(), o = { bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; document.querySelector('.dlg-shield').dispatchEvent(new MouseEvent('mousedown', o)); window.dispatchEvent(new MouseEvent('mouseup', o)); return document.querySelector('#cfTable tbody tr:nth-child(1) .cf-at').value; })()",
};

(async () => {
  // L-062: cada fragmento, solo ASCII y presente tal cual en la receta
  const md = fs.readFileSync(path.join(__dirname, 'ui-scenarios.md'), 'utf8');
  let bad = 0;
  for (const [k, v] of Object.entries(S)) {
    if (/[^\x20-\x7e]/.test(v)) { console.log('FRAGMENTO NO ASCII: ' + k); bad++; }
    if (!md.includes('`' + v + '`')) { console.log('FRAGMENTO NO COPIADO EN LA RECETA: ' + k); bad++; }
  }
  console.log(bad ? bad + ' problemas en los fragmentos' : 'fragmentos: ' + Object.keys(S).length + ' ASCII y copiados en la receta');

  const b = await launch({ port: 8778, cdpPort: 9346 });
  const { ev, key, clickSel, cellSel } = b;
  const fill = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const pressOn = async (sel, k, mods = 0) => { if (sel !== ':focus') await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await key(k, mods); };
  const selOpt = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const check = sel => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e.checked) e.click(); })()`);
  // consola completa (cdp.js recorta consoleLog a 200 caracteres; REA no)
  const log = [];
  b.on(m => { if (m.method === 'Runtime.consoleAPICalled') log.push(m.params.args.map(a => a.value ?? a.description).join(' ')); });
  // puente real: fill #qaEval + press Enter (qa-serve.js lo inyecta); espera su línea "QA {...}"
  const bridge = async js => {
    const n = log.filter(l => l.startsWith('QA ')).length;
    await fill('#qaEval', js); await pressOn('#qaEval', 'Enter');
    await waitFor(() => log.filter(l => l.startsWith('QA ')).length > n, 10000);
  };
  // libro preparado: el fragmento recarga la página (como en REA, con el puente)
  const preset = async js => { await ev('window.__mark = 1'); await fill('#qaEval', js); await pressOn('#qaEval', 'Enter'); await waitFor(() => ev("!window.__mark && document.readyState === 'complete' && !!document.querySelector(\"#grid tbody tr[data-r='0'] td\")"), 15000); };
  const show = name => { console.log('--- ' + name); for (const l of log.filter(x => x.startsWith('UI49') || x.startsWith('QA '))) console.log(l.replace(/[^\x20-\x7e]/g, '?')); log.length = 0; };
  const cf = async (i, j) => { await clickSel("button[data-cmd='cf']"); await clickSel(`#menu div:nth-child(${i})`); if (j) await clickSel(`#menu2 div:nth-child(${j})`); };
  try {
    // 1: escala desde la galería, vista previa (mouseenter por el puente) y Ctrl+Z
    await b.open(); log.length = 0;
    await ev(S.observer);
    await clickSel(cellSel('A1')); await bridge(S.data5);
    await fill('#nameBox', 'A1:A5'); await pressOn('#nameBox', 'Enter');
    await cf(4); await bridge(S.hover1); await sleep(200);
    await clickSel('#menu2 div:nth-child(1)'); await sleep(300);
    await pressOn('#gridWrap', 'z', 2); await sleep(300);
    show('1');
    // 2: barras sólidas con negativos desde la galería, Administrador y Ctrl+Z
    await b.open(); log.length = 0;
    await preset(S.presetNeg); await ev(S.observer);
    await fill('#nameBox', 'A1:A4'); await pressOn('#nameBox', 'Enter');
    await cf(3, 9); await sleep(300);
    await cf(9); await sleep(300);
    await clickSel('#cfMgrDlg .dlg-cancel');
    await pressOn('#gridWrap', 'z', 2); await sleep(300);
    show('2');
    // 3: conjunto de íconos desde Nueva regla: 5 valoraciones invertidas, solo el ícono
    await b.open(); log.length = 0;
    await preset(S.presetVals); await ev(S.observer);
    await fill('#nameBox', 'A1:A5'); await pressOn('#nameBox', 'Enter');
    await cf(7);
    await selOpt('#cfTypes', 'scale'); await selOpt('#cfVStyle', 'icons'); await selOpt('#cfISet', '5ratings');
    await clickSel('#cfIRev'); await check('#cfIOnly'); await sleep(200);
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(300);
    show('3');
    // 4: escala de 3 colores con Fórmula: la referencia relativa se rechaza; =$E$1 (80) se acepta
    await b.open(); log.length = 0;
    await preset(S.presetVals); await ev(S.observer);
    await fill('#nameBox', 'A1:A5'); await pressOn('#nameBox', 'Enter');
    await cf(7);
    await selOpt('#cfTypes', 'scale'); await selOpt('#cfVStyle', 'scale3'); await selOpt('#cfSK2', 'formula');
    await fill('#cfSV2', '=A1'); await clickSel('#cfRuleDlg .dlg-ok'); await sleep(300);
    await clickSel('#msgOk');
    await fill('#cfSV2', '=$E$1'); await clickSel('#cfRuleDlg .dlg-ok'); await sleep(300);
    show('4');
    // 5: insertar una fila: la barra y su fórmula =$E$1 siguen; Ctrl+Z
    await b.open(); log.length = 0;
    await preset(S.presetBar); await ev(S.observer);
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='ins-row']"); await sleep(300);
    await bridge(S.readCf);
    await pressOn('#gridWrap', 'z', 2); await sleep(300);
    await bridge(S.readCf);
    show('5');
    // 6: Administrador no modal: "Se aplica a" con un clic en A6 (puente sobre la capa del cuadro)
    await b.open(); log.length = 0;
    await preset(S.presetGt); await ev(S.observer);
    await clickSel(cellSel('A1')); await cf(9); await sleep(300);
    await clickSel('#cfTable tbody tr:nth-child(1) .cf-at');
    await bridge(S.pickA6);
    await clickSel('#cfMgrDlg .dlg-ok'); await sleep(300);
    await bridge(S.readCf);
    show('6');
    // 7: pestaña Número: Mayor que 10 con Moneda sin decimales
    await b.open(); log.length = 0;
    await preset(S.presetNum); await ev(S.observer);
    await fill('#nameBox', 'A1:A3'); await pressOn('#nameBox', 'Enter');
    await cf(1, 1);
    await fill('#cfV1', '10'); await selOpt('#cfPreset', 'custom');
    await clickSel('#cfFmtDlg .dv-tab:nth-child(1)'); await selOpt('#cfNumFmt', 'currency'); await fill('#cfNumDec', '0'); await sleep(200);
    await clickSel('#cfFmtDlg .dlg-ok'); await clickSel('#cfQuickDlg .dlg-ok'); await sleep(300);
    show('7');
    console.log('errores de página: ' + JSON.stringify(b.errors));
  } catch (e) {
    console.log('ERROR DEL ENSAYO: ' + (e && e.stack || e));
  } finally {
    await b.close();
  }
})();

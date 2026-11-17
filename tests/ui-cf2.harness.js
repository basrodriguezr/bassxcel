'use strict';
// Arnés de Chrome headless de la ronda 5e de grid-ui-dev: Formato condicional, parte 2 (escalas de color, barras de datos
// y conjuntos de íconos): el evaluador puro (window.__bxCf.style) con umbrales Valor más bajo/alto, Automático, Número,
// Porcentaje, Fórmula y Percentil; el dibujo medido (color calculado del td con getComputedStyle y geometría de la barra
// con getBoundingClientRect, L-004/L-022/L-023); las galerías del menú con vista previa al pasar el ratón; "Nueva regla de
// formato" con el tipo "Aplicar formato a todas las celdas según sus valores"; el Administrador; y la matriz
// operaciones × sheet.cf (insertar/eliminar, ordenar, Supr, Borrar formato, copiar/pegar, rellenar, cortar, deshacer,
// hojas, .bassx, .xlsx, paneles, combinaciones, filas ocultas, fila lejana e imprimir).
// Uso: node tests/ui-cf2.harness.js [--web=<carpeta>]   (sale con código 1 si alguna aserción falla)
// Entrada real por CDP (clics, movimiento del ratón, teclas: L-031). Cada grupo abre un libro nuevo (L-039) y fija la
// selección antes de cada gesto (L-054). Complementa la receta REA UI-49.
const { launch, reporter, sleep } = require('./cdp');

(async () => {
  const b = await launch({ port: 8777, cdpPort: 9345 });
  console.log('web: ' + b.web);
  const { check, done } = reporter();
  const { ev, key, type, click, clickSel, clickText, cellSel, open, send } = b;
  const goto = async ref => { await ev(`(() => { const n = document.getElementById('nameBox'); n.value = ${JSON.stringify(ref)}; n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`); await sleep(50); };
  const paste = text => ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  const clipEv = kind => ev(`(() => { const dt = new DataTransfer(); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent(${JSON.stringify(kind)}, { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData('text/plain'); })()`);
  const captureConfirm = () => ev(`window.confirm = () => true; window.alert = m => console.log('ALERT ' + m); 1`);
  const isOpen = id => ev(`!!(document.getElementById(${JSON.stringify(id)}) && document.getElementById(${JSON.stringify(id)}).open)`);
  const msgText = () => ev(`document.getElementById('msgDlg').open ? document.getElementById('msgText').textContent : null`);
  const setv = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return e.value; })()`);
  const write = async (text, end = 'Enter') => { await type(text); await key(end); await sleep(30); };
  const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const L = `const L = (r, c) => { let s = '', n = c + 1; while (n) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s + (r + 1); };`;
  // reglas del modelo autoguardado como texto: "A1:A5|scale|min,percentile 50,max" (rangos separados por espacio)
  const cfs = async (delay = 550) => {
    await sleep(delay);
    return ev(`(() => { ${L} const pt = p => p.k + (p.v ? ' ' + p.v : ''); return (Q.sheet().cf || []).map(d => d.ranges.map(g => g.r1 === g.r2 && g.c1 === g.c2 ? L(g.r1, g.c1) : L(g.r1, g.c1) + ':' + L(g.r2, g.c2)).join(' ') + '|' + d.type + '|'
      + (d.type === 'scale' ? d.pts.map(pt).join(',') : d.type === 'bar' ? pt(d.lo) + ',' + pt(d.hi) : d.type === 'icons' ? d.set + ' ' + d.th.map(t => t.op + ' ' + pt(t)).join(',') : (d.op || '') + ' ' + (d.f1 || ''))); })()`);
  };
  const cfsJ = async delay => JSON.stringify(await cfs(delay));
  const col = (c, r1, r2) => Array.from({ length: r2 - r1 + 1 }, (_, i) => c + (r1 + i));
  const setRules = rules => ev(`__bxCf.set(${JSON.stringify(rules)})`);
  // estilo condicional calculado (evaluador puro): bg de la escala, { s, e, ax, neg, color } de la barra (4 decimales) o
  // el índice del ícono; '-' si ninguna regla aplica
  const sty = cells => ev(`${JSON.stringify(cells)}.map(a => { const s = __bxCf.style(a); if (!s) return '-'; const f = x => x == null ? 'n' : +x.toFixed(4);
    return [s.bg, s.b ? 'b' : '', s.bar ? f(s.bar.s) + '..' + f(s.bar.e) + (s.bar.ax != null ? '@' + f(s.bar.ax) : '') + (s.bar.neg ? '!' + s.bar.color : '') + (s.bar.only ? ' solo' : '') : '',
      s.icon ? s.icon.set + ':' + s.icon.i + (s.icon.only ? ' solo' : '') : ''].filter(Boolean).join(' '); }).join(' | ')`);
  const S = async (rules, cells) => { await setRules(rules); return sty(cells); };
  const bg = a => ev(`(() => { const t = Q.td(${JSON.stringify(a)}); return t ? getComputedStyle(t).backgroundColor : '(no DOM)'; })()`);
  // geometría medida de la barra respecto del td: diferencias en px con lo esperado para (s, e) (0 = exacto)
  const barGeo = (a, s, e) => ev(`(() => { const t = Q.td(${JSON.stringify(a)}); if (!t) return '(no DOM)'; const br = t.querySelector('.cfbar'); if (!br) return 'sin barra';
    const r = t.getBoundingClientRect(), g = br.getBoundingClientRect(), W = t.clientWidth - 4;
    return [g.left - (r.left + 2 + W * ${s}), g.width - W * (${e} - ${s}), g.top - (r.top + 2), g.bottom - (r.top + t.clientHeight - 2)].map(x => Math.round(x * 10) / 10).join(','); })()`);
  const near0 = t => typeof t === 'string' && t.split(',').every(x => Math.abs(+x) <= 0.6);
  const cfMenu = async (sub, item) => {
    await clickSel("button[data-cmd='cf']");
    await clickText('#menu div', sub); await sleep(40);
    if (item) { await clickText('#menu2 div', item); await sleep(60); }
  };
  const menuTexts = sel => ev(`[...document.querySelectorAll(${JSON.stringify(sel)} + ' div')].map(x => (x.classList.contains('head') ? '#' : '') + x.textContent + (x.classList.contains('dis') ? '(x)' : '')).join('|')`);
  const itemCenter = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const mgrRows = () => ev(`[...document.querySelectorAll('#cfTable tbody tr')].map(tr => (tr.classList.contains('on') ? '*' : '') + tr.querySelector('.cf-rule').textContent + ' @ ' + tr.querySelector('.cf-at').value + (tr.querySelector('.cf-stop').disabled ? ' [-]' : tr.querySelector('.cf-stop').checked ? ' [stop]' : '')).join(' | ')`);
  const ruleOk = () => clickSel('#cfRuleDlg .dlg-ok');
  const BLACK = '#000000', WHITE = '#ffffff', RED = '#ff0000', NONE = 'rgba(0, 0, 0, 0)';
  const CF_SCALE_NAMES = 'Verde - Amarillo - Rojo|Rojo - Amarillo - Verde|Verde - Blanco - Rojo|Rojo - Blanco - Verde|Azul - Blanco - Rojo|Rojo - Blanco - Azul|Verde - Blanco|Blanco - Verde|Rojo - Blanco|Blanco - Rojo|Verde - Amarillo|Amarillo - Verde';
  const sc2 = (at, lo, hi, extra = {}) => ({ at, type: 'scale', pts: [{ color: BLACK, ...lo }, { color: WHITE, ...hi }], ...extra });
  const sc3 = (at, lo, mid, hi) => ({ at, type: 'scale', pts: [{ color: BLACK, ...lo }, { color: RED, ...mid }, { color: WHITE, ...hi }] });
  const A5 = col('A', 1, 5), A8 = col('A', 1, 8);

  try {
    // ---------- E0: evaluador puro (cfStyle: escalas, barras e íconos) ----------
    await open();
    await clickSel(cellSel('A1')); await paste('0\r\n25\r\n50\r\n75\r\n100\r\ntexto\r\n\r\n#N/D');
    await clickSel(cellSel('B1')); await paste('1\r\n2\r\n3\r\n4\r\n100');
    await clickSel(cellSel('C1')); await paste('1\r\n2\r\n3\r\n4');
    await clickSel(cellSel('E1')); await write('200');
    const MIN = { k: 'min' }, MAX = { k: 'max' };
    check('E0 escala de 2 colores (negro a blanco, Valor más bajo/más alto): interpolación RGB; texto, vacía y error sin color',
      (await S([sc2('A1:A8', MIN, MAX)], A8)) === '#000000 | #404040 | #808080 | #bfbfbf | #ffffff | - | - | -', await sty(A8));
    check('E0 escala de 3 colores con punto medio en el percentil 50 (la mediana, 50): 50 es el color del medio',
      (await S([sc3('A1:A5', MIN, { k: 'percentile', v: '50' }, MAX)], A5)) === '#000000 | #800000 | #ff0000 | #ff8080 | #ffffff', await sty(A5));
    const B5 = col('B', 1, 5);
    check('E0 percentil 50 de 1;2;3;4;100 es 3 (no el porcentaje: 50,5) → 3 lleva el color del medio',
      (await S([sc3('B1:B5', MIN, { k: 'percentile', v: '50' }, MAX)], B5)).split(' | ')[2] === '#ff0000', await sty(B5));
    check('E0 porcentaje 50 de 1;2;3;4;100 es 50,5: 3 queda cerca del mínimo (#0a0000)',
      (await S([sc3('B1:B5', MIN, { k: 'percent', v: '50' }, MAX)], B5)).split(' | ')[2] === '#0a0000', await sty(B5));
    check('E0 percentil interpolado (PERCENTIL.INC): percentil 50 de 1;2;3;4 = 2,5 → 2 está a 2/3 del camino (#aa0000)',
      (await S([sc3('C1:C4', MIN, { k: 'percentile', v: '50' }, MAX)], col('C', 1, 4))).split(' | ')[1] === '#aa0000', await sty(col('C', 1, 4)));
    check('E0 Porcentaje 10 y 90 (umbrales 10 y 90): 0 toma el color del mínimo y 100 el del máximo; 25 → #303030',
      (await S([sc2('A1:A5', { k: 'percent', v: '10' }, { k: 'percent', v: '90' })], A5)) === '#000000 | #303030 | #808080 | #cfcfcf | #ffffff', await sty(A5));
    check('E0 Número 20 y 80 (es-CL): 25 → #151515',
      (await S([sc2('A1:A5', { k: 'num', v: '20' }, { k: 'num', v: '80' })], A5)).split(' | ')[1] === '#151515', await sty(A5));
    check('E0 Número con coma decimal (0 y 12,5): 25 ya es el máximo',
      (await S([sc2('A1:A5', { k: 'num', v: '0' }, { k: 'num', v: '12,5' })], A5)).split(' | ')[1] === '#ffffff', await sty(A5));
    check('E0 Fórmula =$E$1 como máximo (E1 = 200): 50 → #404040',
      (await S([sc2('A1:A5', { k: 'num', v: '0' }, { k: 'formula', v: '=$E$1' })], A5)).split(' | ')[2] === '#404040', await sty(A5));
    await clickSel(cellSel('E1')); await write('100');
    check('E0 cambiar E1 a 100 recalcula los umbrales (la caché se invalida por recálculo): 50 → #808080', (await sty(['A3'])) === '#808080', await sty(['A3']));
    check('E0 un umbral con error (=1/0) no da formato a ninguna celda',
      (await S([sc2('A1:A5', MIN, { k: 'formula', v: '=1/0' })], A5)) === '- | - | - | - | -', await sty(A5));
    const pink = { bg: '#ffc7ce' };
    check('E0 prioridad: una regla de arriba con relleno gana a la escala; abajo, la escala gana el relleno y la negrita se suma',
      (await S([{ at: 'A1:A5', type: 'cellIs', op: 'greaterThan', f1: '50', style: pink }, sc2('A1:A5', MIN, MAX)], ['A2', 'A4'])) === '#404040 | #ffc7ce'
      && (await S([sc2('A1:A5', MIN, MAX), { at: 'A1:A5', type: 'cellIs', op: 'greaterThan', f1: '50', style: { bg: '#ffc7ce', b: true } }], ['A2', 'A4'])) === '#404040 | #bfbfbf b', await sty(['A2', 'A4']));
    check('E0 "Detener si es verdad" de una regla de arriba corta la escala en las celdas donde se cumple',
      (await S([{ at: 'A1:A5', type: 'cellIs', op: 'greaterThan', f1: '50', style: { b: true }, stop: true }, sc2('A1:A5', MIN, MAX)], ['A2', 'A4'])) === '#404040 | b', await sty(['A2', 'A4']));
    check('E0 una escala nunca corta las de abajo ("Detener si es verdad" no se aplica a estos tipos)',
      (await S([sc2('A1:A5', MIN, MAX, { stop: true }), { at: 'A1:A5', type: 'cellIs', op: 'greaterThan', f1: '50', style: { b: true } }], ['A4'])) === '#bfbfbf b'
      && (await sleep(500).then(() => ev('Q.sheet().cf[0].stop'))) === false, await sty(['A4']));
    await clickSel(cellSel('D1')); await paste('5\r\n5\r\n5');
    check('E0 todos iguales (mínimo = máximo): el color del máximo', (await S([sc2('D1:D3', MIN, MAX)], col('D', 1, 3))) === '#ffffff | #ffffff | #ffffff', await sty(col('D', 1, 3)));
    // barras
    const bar = (at, lo, hi, extra = {}) => ({ at, type: 'bar', lo, hi, color: '#638ec6', ...extra });
    const AUTO = { k: 'auto' };
    check('E0 barra automática de 0..100: largo proporcional al valor (0 → sin barra, 50 → mitad, 100 → entera)',
      (await S([bar('A1:A8', AUTO, AUTO)], A8)) === '0..0 | 0..0.25 | 0..0.5 | 0..0.75 | 0..1 | - | - | -', await sty(A8));
    await clickSel(cellSel('F1')); await paste('10\r\n20\r\n30\r\n40\r\n50');
    const F5 = col('F', 1, 5);
    check('E0 Automático en positivos empieza en 0 (20 de 50 → 0,4); Valor más bajo empieza en el mínimo (20 → 0,25)',
      (await S([bar('F1:F5', AUTO, AUTO)], ['F2'])) === '0..0.4' && (await S([bar('F1:F5', MIN, MAX)], ['F2'])) === '0..0.25', await sty(['F2']));
    await clickSel(cellSel('G1')); await paste('-50\r\n0\r\n50\r\n100');
    const G4 = col('G', 1, 4);
    check('E0 negativos con eje automático en el punto del 0 (1/3): 50 crece a la derecha según el máximo; -50, a la izquierda en rojo',
      (await S([bar('G1:G4', AUTO, AUTO)], G4)) === '0..0.3333@0.3333!#ff0000 | 0.3333..0.3333@0.3333 | 0.3333..0.6667@0.3333 | 0.3333..1@0.3333', await sty(G4));
    await clickSel(cellSel('H1')); await paste('-10\r\n-5\r\n-20');
    check('E0 todos negativos: el eje queda a la derecha (-10 de -20 → la mitad derecha)',
      (await S([bar('H1:H3', AUTO, AUTO)], ['H1'])) === '0.5..1@1!#ff0000', await sty(['H1']));
    check('E0 eje en el punto medio de la celda: 50 de 100 → 0,5..0,75; -50 → 0,25..0,5',
      (await S([bar('G1:G4', AUTO, AUTO, { axis: 'mid' })], ['G3', 'G1'])) === '0.5..0.75@0.5 | 0.25..0.5@0.5!#ff0000', await sty(['G3', 'G1']));
    check('E0 sin eje: todas desde la izquierda (50 → 2/3) y la negativa en rojo sin largo',
      (await S([bar('G1:G4', AUTO, AUTO, { axis: 'none' })], ['G3', 'G1'])) === '0..0.6667 | 0..0!#ff0000', await sty(['G3', 'G1']));
    check('E0 Número 0 y 50: 100 queda en el largo máximo; Percentil 50 como máximo: 50 ya es entera',
      (await S([bar('A1:A5', { k: 'num', v: '0' }, { k: 'num', v: '50' })], ['A2', 'A5'])) === '0..0.5 | 0..1' && (await S([bar('A1:A5', AUTO, { k: 'percentile', v: '50' })], ['A3'])) === '0..1', await sty(['A2', 'A5']));
    check('E0 Porcentaje sobre 10..50 es el mínimo más el porcentaje de la diferencia: 0 % y 50 % → 10 y 30 (20 → la mitad)',
      (await S([bar('F1:F5', { k: 'percent', v: '0' }, { k: 'percent', v: '50' })], ['F2'])) === '0..0.5', await sty(['F2']));
    check('E0 Automático como máximo de todos negativos es 0 (sin eje: -10 de -20..0 → la mitad)',
      (await S([bar('H1:H3', AUTO, AUTO, { axis: 'none' })], ['H1'])) === '0..0.5!#ff0000', await sty(['H1']));
    check('E0 "Mostrar solo la barra" queda en el estilo',(await S([bar('A1:A5', AUTO, AUTO, { only: true })], ['A3'])) === '0..0.5 solo', await sty(['A3']));
    // íconos
    await clickSel(cellSel('I1')); await paste('0\r\n33\r\n34\r\n67\r\n100');
    const I5 = col('I', 1, 5);
    check('E0 3 flechas con los umbrales de Excel (>= 67 % y >= 33 %): 0 y 33 → ícono 3 y 2; 67 y 100 → ícono 1',
      (await S([{ at: 'I1:I5', type: 'icons', set: '3arrows' }], I5)) === '3arrows:2 | 3arrows:1 | 3arrows:1 | 3arrows:0 | 3arrows:0', await sty(I5));
    check('E0 los umbrales por omisión son 67 y 33 por ciento (>=)', (await sleep(500).then(() => ev(`JSON.stringify(Q.sheet().cf[0].th)`))) === '[{"op":"gte","k":"percent","v":"67"},{"op":"gte","k":"percent","v":"33"}]', await ev(`JSON.stringify(Q.sheet().cf[0].th)`));
    check('E0 operador > en 67: 67 pasa al ícono del medio',
      (await S([{ at: 'I1:I5', type: 'icons', set: '3arrows', th: [{ op: 'gt', k: 'percent', v: '67' }, { op: 'gte', k: 'percent', v: '33' }] }], ['I4'])) === '3arrows:1', await sty(['I4']));
    check('E0 Invertir criterio de ordenación: 100 lleva el último ícono y 0 el primero',
      (await S([{ at: 'I1:I5', type: 'icons', set: '3arrows', rev: true }], ['I5', 'I1'])) === '3arrows:2 | 3arrows:0', await sty(['I5', 'I1']));
    await clickSel(cellSel('J1')); await paste('0\r\n20\r\n40\r\n60\r\n80\r\n100');
    const J6 = col('J', 1, 6);
    check('E0 5 valoraciones con umbrales 80/60/40/20 %: 0, 20, 40, 60, 80, 100 → íconos 5, 4, 3, 2, 1, 1',
      (await S([{ at: 'J1:J6', type: 'icons', set: '5ratings' }], J6)) === '5ratings:4 | 5ratings:3 | 5ratings:2 | 5ratings:1 | 5ratings:0 | 5ratings:0', await sty(J6));
    check('E0 umbrales Número (50 y 10): 50 → 1.º, 25 → 2.º, 0 → 3.º',
      (await S([{ at: 'A1:A5', type: 'icons', set: '3traffic', th: [{ k: 'num', v: '50' }, { k: 'num', v: '10' }] }], ['A3', 'A2', 'A1'])) === '3traffic:0 | 3traffic:1 | 3traffic:2', await sty(['A3', 'A2', 'A1']));
    check('E0 umbrales Percentil 50 y 25 de 1;2;3;4;100 (3 y 2): 3 → 1.º, 2 → 2.º, 1 → 3.º',
      (await S([{ at: 'B1:B5', type: 'icons', set: '3traffic', th: [{ k: 'percentile', v: '50' }, { k: 'percentile', v: '25' }] }], ['B3', 'B2', 'B1'])) === '3traffic:0 | 3traffic:1 | 3traffic:2', await sty(['B3', 'B2', 'B1']));
    check('E0 umbral Fórmula =$E$1 (100): solo 100 lleva el 1.º',
      (await S([{ at: 'A1:A5', type: 'icons', set: '3traffic', th: [{ k: 'formula', v: '=$E$1' }, { k: 'num', v: '1' }] }], ['A5', 'A4'])) === '3traffic:0 | 3traffic:1', await sty(['A5', 'A4']));
    await clickSel(cellSel('K1')); await write('=0,1+0,2');
    check('E0 comparación de Excel con 15 cifras: 0,1+0,2 no es > 0,3',
      (await S([{ at: 'K1', type: 'icons', set: '3traffic', th: [{ op: 'gt', k: 'num', v: '0,3' }, { k: 'num', v: '0' }] }], ['K1'])) === '3traffic:1', await sty(['K1']));
    check('E0 "Mostrar ícono únicamente" queda en el estilo; texto y error sin ícono',
      (await S([{ at: 'A1:A8', type: 'icons', set: '3flags', only: true }], ['A5', 'A6', 'A8'])) === '3flags:0 solo | - | -', await sty(['A5', 'A6', 'A8']));

    // ---------- E1: dibujo medido (color del td, geometría de la barra, íconos, combinaciones, paneles, impresión) ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('A1')); await paste('0\r\n25\r\n50\r\n75\r\n100');
    await clickSel(cellSel('G1')); await paste('-50\r\n0\r\n50\r\n100');
    await setRules([sc2('A1:A5', MIN, MAX)]);
    check('E1 escala: color calculado del td (50 → rgb(128, 128, 128); 0 → negro)', (await bg('A3')) === 'rgb(128, 128, 128)' && (await bg('A1')) === 'rgb(0, 0, 0)', [await bg('A3'), await bg('A1')]);
    await setRules([bar('A1:A5', AUTO, AUTO, { grad: true, border: true })]);
    check('E1 barra de 50: medida con getBoundingClientRect, empieza a 2 px del borde, mide la mitad del ancho útil y deja 2 px arriba y abajo', near0(await barGeo('A3', 0, 0.5)), await barGeo('A3', 0, 0.5));
    check('E1 barra de 100: el ancho útil entero; 0 no tiene barra', near0(await barGeo('A5', 0, 1)) && (await barGeo('A1', 0, 0)) === 'sin barra', [await barGeo('A5', 0, 1), await barGeo('A1', 0, 0)]);
    check('E1 el valor se ve encima de la barra (span posicionado después de la capa) y sigue a la derecha',
      (await ev(`(() => { const t = Q.td('A3'), v = t.lastElementChild; const r = t.getBoundingClientRect(), x = v.getBoundingClientRect(); return t.textContent + '|' + v.className + '|' + getComputedStyle(v).position + '|' + (Math.abs(x.right - (r.left + t.clientWidth - 4)) < 1); })()`)) === '50|cfv|relative|true', null);
    check('E1 relleno degradado con borde del mismo color', (await ev(`(() => { const s = getComputedStyle(Q.td('A3').querySelector('.cfbar')); return s.backgroundImage.startsWith('linear-gradient') + '|' + s.borderTopColor; })()`)) === 'true|rgb(99, 142, 198)', null);
    await setRules([bar('A1:A5', AUTO, AUTO, { grad: false, color: '#63c384' })]);
    check('E1 relleno sólido sin borde', (await ev(`(() => { const s = getComputedStyle(Q.td('A3').querySelector('.cfbar')); return s.backgroundColor + '|' + s.backgroundImage + '|' + s.borderTopWidth; })()`)) === 'rgb(99, 195, 132)|none|0px', null);
    await setRules([bar('G1:G4', AUTO, AUTO, { grad: false })]);
    check('E1 negativos: el eje (línea discontinua) a 1/3 del ancho útil y la barra roja de -50 a su izquierda',
      near0(await barGeo('G1', 0, 1 / 3)) && near0(await barGeo('G3', 1 / 3, 2 / 3))
      && (await ev(`(() => { const t = Q.td('G1'), r = t.getBoundingClientRect(), x = t.querySelector('.cfaxis').getBoundingClientRect(), s = getComputedStyle(t.querySelector('.cfaxis')); return Math.round((x.left - (r.left + 2 + (t.clientWidth - 4) / 3)) * 10) / 10 + '|' + s.borderLeftStyle + '|' + getComputedStyle(t.querySelector('.cfbar')).backgroundColor; })()`)) === '0|dashed|rgb(255, 0, 0)',
      [await barGeo('G1', 0, 1 / 3), await barGeo('G3', 1 / 3, 2 / 3)]);
    await setRules([bar('A1:A5', AUTO, AUTO, { only: true })]);
    check('E1 "Mostrar solo la barra": la celda no muestra el valor, pero lo conserva', (await ev(`Q.t('A3')`)) === '' && near0(await barGeo('A3', 0, 0.5)) && (await ev(`document.getElementById('formulaInput').value`)) !== null, await ev(`Q.t('A3')`));
    await setRules([{ at: 'A1:A5', type: 'icons', set: '3arrows' }]);
    const ic = a => ev(`(() => { const t = Q.td(${JSON.stringify(a)}), s = t.querySelector('.cfic svg'); if (!s) return 'sin ícono'; const r = t.getBoundingClientRect(), x = s.getBoundingClientRect(); return s.dataset.ic + '|' + Math.round(x.left - r.left) + '|' + t.textContent; })()`);
    check('E1 íconos: flecha verde arriba (100), amarilla de lado (50), roja abajo (0), en el borde izquierdo y con el valor', (await ic('A5')) === 'upG|2|100' && (await ic('A3')) === 'rightY|2|50' && (await ic('A1')) === 'downR|2|0', [await ic('A5'), await ic('A3'), await ic('A1')]);
    check('E1 la flecha verde se dibuja con SVG en línea (relleno verde)', (await ev(`getComputedStyle(Q.td('A5').querySelector('.cfic polygon')).fill`)) === 'rgb(0, 166, 81)', null);
    await setRules([{ at: 'A1:A5', type: 'icons', set: '3arrows', only: true }]);
    check('E1 "Mostrar ícono únicamente": solo el ícono', (await ic('A5')) === 'upG|2|', await ic('A5'));
    // combinación, paneles inmovilizados, fila lejana, impresión
    await setRules([bar('A1:A300', AUTO, AUTO, { grad: false })]);
    await goto('A3:B3'); await clickSel("button[data-cmd='merge']"); await sleep(60);
    check('E1 combinación A3:B3: la barra de 50 ocupa la mitad del ancho útil de la combinación entera',
      (await ev(`(() => { const d = [...document.querySelectorAll('#mergeLayer > div')].find(x => x.textContent === '50'); if (!d) return 'sin capa'; const br = d.querySelector('.cfbar'); if (!br) return 'sin barra'; const r = d.getBoundingClientRect(), g = br.getBoundingClientRect(); return Math.round(g.left - r.left - 2) + '|' + Math.round(g.width - (d.clientWidth - 4) * 0.5); })()`)) === '0|0', null);
    await key('z', 2);
    await clickSel(cellSel('A3')); await clickSel("button[data-cmd='freeze']"); await clickText('#menu div', 'Inmovilizar paneles (sobre y a la izquierda de la celda activa)'); await sleep(60);
    check('E1 paneles inmovilizados (filas 1 y 2): la barra de A2 va dentro del td fijo (sticky)', (await ev(`getComputedStyle(Q.td('A2')).position`)) === 'sticky' && near0(await barGeo('A2', 0, 0.25)), await barGeo('A2', 0, 0.25));
    await ev(`document.getElementById('gridWrap').scrollTop = 400`); await sleep(120);
    check('E1 al desplazar, la barra sigue a la celda fija', near0(await barGeo('A2', 0, 0.25)), await barGeo('A2', 0, 0.25));
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='freeze']"); await clickText('#menu div', 'Movilizar paneles'); await sleep(60);
    await goto('A300'); await write('50'); await goto('A300'); await sleep(100);
    check('E1 fila 300 (fuera del primer dibujo de la grilla virtualizada): la barra de 50 se dibuja', near0(await barGeo('A300', 0, 0.5)), await barGeo('A300', 0, 0.5));
    await ev(`window.__printDoc = null; Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', { set(v) { window.__printDoc = v; }, configurable: true }); 1`);
    await goto('A1:A5'); await clickSel("button[data-cmd='print']"); await sleep(60);
    check('E1 imprimir lleva las barras (capa, estilo y valor encima)', (await ev(`(() => { const d = window.__printDoc || ''; return d.includes('class="cfbar"') && d.includes('.cfbar{position:absolute') && d.includes('<span class="cfv">50</span>'); })()`)), null);

    // ---------- E2: galerías del menú, vista previa al pasar el ratón, Ctrl+Z ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('A1')); await paste('0\r\n25\r\n50\r\n75\r\n100');
    await goto('A1:A5');
    await cfMenu('Escalas de color');
    check('E2 menú: Barras de datos, Escalas de color y Conjuntos de íconos habilitados', (await menuTexts('#menu')) === 'Reglas para resaltar celdas|Reglas superiores e inferiores|Barras de datos|Escalas de color|Conjuntos de íconos|Nueva regla…|Borrar reglas|Administrar reglas…', await menuTexts('#menu'));
    check('E2 galería de escalas de color: las 12 de Excel y Más reglas…', (await menuTexts('#menu2')) === CF_SCALE_NAMES + '|Más reglas…', await menuTexts('#menu2'));
    const p1 = await itemCenter('#menu2 div', 'Verde - Amarillo - Rojo');
    await move(p1.x, p1.y); await sleep(80);
    check('E2 pasar el ratón por Verde - Amarillo - Rojo muestra la vista previa (100 verde, 50 amarillo, 0 rojo) sin crear la regla',
      (await bg('A5')) === 'rgb(99, 190, 123)' && (await bg('A3')) === 'rgb(255, 235, 132)' && (await bg('A1')) === 'rgb(248, 105, 107)' && (await cfsJ()) === '[]', [await bg('A5'), await bg('A3'), await cfs()]);
    const p2 = await itemCenter('#menu2 div', 'Más reglas…');
    await move(p2.x, p2.y); await sleep(80);
    check('E2 al salir de la opción la vista previa se va', (await bg('A5')) === NONE, await bg('A5'));
    await move(p1.x, p1.y); await sleep(60); await key('Escape'); await sleep(60);
    check('E2 Esc cierra el menú y quita la vista previa', (await ev(`document.getElementById('menu').style.display`)) === 'none' && (await bg('A5')) === NONE, await bg('A5'));
    // vista previa encendida sin que el ratón real esté sobre la opción (el camino del puente de REA, UI-49): al cerrar el
    // menú Chrome no dispara mouseleave en ella, así que la vista previa la apaga el cierre del menú (L-064)
    await cfMenu('Escalas de color');
    await ev(`document.querySelector('#menu2 div:nth-child(1)').dispatchEvent(new MouseEvent('mouseenter'))`); await sleep(60);
    const pv = await bg('A5');
    await key('Escape'); await sleep(60);
    check('E2 vista previa sin el ratón sobre la opción: Esc también la quita', pv === 'rgb(99, 190, 123)' && (await bg('A5')) === NONE, [pv, await bg('A5')]);
    await cfMenu('Escalas de color', 'Verde - Amarillo - Rojo');
    check('E2 clic en la galería: la regla se crea para la selección (3 colores, punto medio percentil 50) y pinta',
      (await cfsJ()) === '["A1:A5|scale|min,percentile 50,max"]' && (await bg('A5')) === 'rgb(99, 190, 123)', [await cfs(), await bg('A5')]);
    check('E2 la selección y la celda activa siguen igual (A1:A5, activa A1)', (await ev('Q.nb()')) === 'A1:A5' && (await ev(`Q.at('A1').dTop === 0 && Q.at('A1').dLeft === 0`)), await ev('Q.nb()'));
    await key('z', 2);
    check('E2 Ctrl+Z la quita en un paso', (await cfsJ()) === '[]' && (await bg('A5')) === NONE, await cfs());
    await key('y', 2);
    check('E2 Ctrl+Y la rehace', (await cfsJ()) === '["A1:A5|scale|min,percentile 50,max"]', await cfs());
    await key('z', 2);
    await cfMenu('Barras de datos');
    check('E2 galería de barras: Relleno degradado y Relleno sólido con los 6 colores de Excel', (await menuTexts('#menu2')) === '#Relleno degradado|Degradado azul|Degradado verde|Degradado rojo|Degradado naranja|Degradado celeste|Degradado morado|#Relleno sólido|Sólido azul|Sólido verde|Sólido rojo|Sólido naranja|Sólido celeste|Sólido morado|Más reglas…', await menuTexts('#menu2'));
    await clickText('#menu2 div', 'Sólido verde'); await sleep(60);
    check('E2 Sólido verde: barra sólida verde sin borde, mínimo y máximo automáticos', (await cfsJ()) === '["A1:A5|bar|auto,auto"]' && (await ev(`(() => { const s = getComputedStyle(Q.td('A3').querySelector('.cfbar')); return s.backgroundColor + '|' + s.borderTopWidth; })()`)) === 'rgb(99, 195, 132)|0px' && near0(await barGeo('A3', 0, 0.5)), await cfs());
    await key('z', 2);
    await setRules([{ at: 'A1:A5', type: 'cellIs', op: 'greaterThan', f1: '50', style: { b: true } }]);
    await goto('A1:A5'); await cfMenu('Escalas de color', 'Rojo - Blanco');
    check('E2 la regla de la galería entra arriba de las que ya había (mayor prioridad)', (await cfsJ()) === '["A1:A5|scale|min,max","A1:A5|cellIs|greaterThan 50"]', await cfs());
    await key('z', 2);
    await goto('A1:A5'); await cfMenu('Conjuntos de íconos');
    check('E2 galería de íconos: Direccional, Formas, Indicadores y Valoraciones', (await menuTexts('#menu2')) === '#Direccional|3 flechas (de color)|3 flechas (gris)|4 flechas (de color)|5 flechas (de color)|#Formas|3 semáforos (sin marco)|3 señales|#Indicadores|3 símbolos (en un círculo)|3 banderas|#Valoraciones|3 estrellas|4 valoraciones|5 valoraciones|Más reglas…', await menuTexts('#menu2'));
    await clickText('#menu2 div', '3 semáforos (sin marco)'); await sleep(60);
    check('E2 3 semáforos: círculos verde, amarillo y rojo', (await ic('A5')).startsWith('cirG|') && (await ic('A3')).startsWith('cirY|') && (await ic('A1')).startsWith('cirR|'), [await ic('A5'), await ic('A1')]);
    await key('z', 2);
    await goto('A1:A5'); await cfMenu('Barras de datos', 'Más reglas…');
    check('E2 Más reglas… de Barras de datos abre Nueva regla con el estilo Barra de datos', (await isOpen('cfRuleDlg')) && (await ev(`document.getElementById('cfTypes').value + '|' + document.getElementById('cfVStyle').value`)) === 'scale|bar', await ev(`document.getElementById('cfVStyle') && document.getElementById('cfVStyle').value`));
    await key('Escape'); await sleep(40);

    // ---------- E3: Nueva regla de formato ▸ Aplicar formato a todas las celdas según sus valores ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('A1')); await paste('0\r\n25\r\n50\r\n75\r\n100');
    await clickSel(cellSel('A12')); await write('80');
    await goto('A1:A5'); await cfMenu('Nueva regla…');
    check('E3 el primer tipo ya está habilitado', (await ev(`document.querySelector('#cfTypes option[value="scale"]').disabled`)) === false, null);
    await setv('#cfTypes', 'scale');
    check('E3 Aplicar formato a todas las celdas según sus valores: Escala de 2 colores por omisión (Valor más bajo naranja, Valor más alto amarillo), sin "Formato…"',
      (await ev(`['cfVStyle', 'cfSK0', 'cfSC0', 'cfSK2', 'cfSC2'].map(i => document.getElementById(i).value).join('|') + '|' + document.getElementById('cfSV0').disabled + '|' + document.querySelector('#cfRuleDlg .cf-prev').hidden + '|' + document.querySelector('#cfVScale .cf-mid').hidden`)) === 'scale2|min|#ff7128|max|#ffef9c|true|true|true', null);
    check('E3 tipos de Mínima, Punto medio y Máxima', (await ev(`['cfSK0', 'cfSK1', 'cfSK2', 'cfBK0'].map(i => [...document.getElementById(i).options].map(o => o.textContent).join(',')).join(' / ')`)) === 'Valor más bajo,Número,Porcentaje,Fórmula,Percentil / Número,Porcentaje,Fórmula,Percentil / Valor más alto,Número,Porcentaje,Fórmula,Percentil / Automático,Valor más bajo,Número,Porcentaje,Fórmula,Percentil', null);
    await setv('#cfVStyle', 'scale3');
    check('E3 Escala de 3 colores: rojo, amarillo y verde de Excel; punto medio percentil 50; vista previa con los 3 colores',
      (await ev(`['cfSC0', 'cfSK1', 'cfSV1', 'cfSC1', 'cfSC2'].map(i => document.getElementById(i).value).join('|') + '|' + getComputedStyle(document.querySelector('#cfVPrev .cfbar')).backgroundImage`)) === '#f8696b|percentile|50|#ffeb84|#63be7b|linear-gradient(90deg, rgb(248, 105, 107), rgb(255, 235, 132), rgb(99, 190, 123))', null);
    await setv('#cfSK1', 'num');
    check('E3 elegir Número vacía el valor del punto medio', (await ev(`document.getElementById('cfSV1').value`)) === '', null);
    await ruleOk(); await sleep(40);
    check('E3 sin valor: "Debe escribir un valor en "Punto medio"." y el cuadro sigue abierto', (await msgText()) === 'Debe escribir un valor en "Punto medio".' && (await isOpen('cfRuleDlg')), await msgText());
    await clickSel('#msgOk'); await sleep(30);
    check('E3 tras el mensaje, el foco vuelve al campo', (await ev('document.activeElement.id')) === 'cfSV1', await ev('document.activeElement.id'));
    await type('62,5');
    await setv('#cfSK0', 'percent');
    check('E3 elegir Porcentaje en Mínima propone 0', (await ev(`document.getElementById('cfSV0').value + '|' + document.getElementById('cfSV0').disabled`)) === '0|false', null);
    await clickSel('#cfSV0'); await ev(`document.getElementById('cfSV0').select()`); await type('150'); await ruleOk(); await sleep(40);
    check('E3 Porcentaje fuera de 0..100: mensaje', (await msgText()) === '"Mínima": el porcentaje debe ser un número entre 0 y 100.', await msgText());
    await clickSel('#msgOk'); await sleep(30);
    await ev(`document.getElementById('cfSV0').select()`); await type('0');
    await setv('#cfSK2', 'formula'); await clickSel('#cfSV2'); await type('=A1');
    await ruleOk(); await sleep(40);
    check('E3 fórmula con referencia relativa: el mensaje de Excel', (await msgText()) === 'No se pueden usar referencias relativas en los criterios de formato condicional de escalas de color, barras de datos y conjuntos de íconos.', await msgText());
    await clickSel('#msgOk'); await sleep(30);
    const e1 = await ev(`(() => { const r = Q.td('A12').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await ev(`document.getElementById('cfSV2').select()`); await click(e1.x, e1.y); await sleep(40);
    check('E3 clic en A12 (fuera del cuadro) con el cuadro abierto desde la cinta escribe =$A$12 en el valor', (await ev(`document.getElementById('cfSV2').value`)) === '=$A$12', await ev(`document.getElementById('cfSV2').value`));
    await ruleOk(); await sleep(60);
    check('E3 Aceptar crea la escala: Porcentaje 0, Número 62,5 y Fórmula =$A$12 (80)', (await cfsJ()) === '["A1:A5|scale|percent 0,num 62,5,formula =$A$12"]', await cfs());
    // 75 está a 12,5/17,5 del camino del amarillo (#ffeb84) al verde (#63be7b): #90cb7e
    check('E3 62,5 (coma decimal) es el punto medio y 80 o más el máximo', (await sty(['A4', 'A5'])) === '#90cb7e | #63be7b', await sty(['A4', 'A5']));
    await key('z', 2);
    await goto('A1:A5'); await cfMenu('Nueva regla…'); await setv('#cfTypes', 'scale'); await setv('#cfVStyle', 'scale2');
    await setv('#cfSK0', 'num'); await clickSel('#cfSV0'); await type('80'); await setv('#cfSK2', 'num'); await clickSel('#cfSV2'); await type('20');
    await ruleOk(); await sleep(40);
    check('E3 Número 80 y 20: "El valor de "Mínima" debe ser menor que el de "Máxima"."', (await msgText()) === 'El valor de "Mínima" debe ser menor que el de "Máxima".', await msgText());
    await clickSel('#msgOk'); await sleep(30);
    // barra de datos
    await setv('#cfVStyle', 'bar');
    check('E3 Barra de datos por omisión: Automático, relleno degradado azul con borde, negativo rojo, eje automático',
      (await ev(`['cfBK0', 'cfBK1', 'cfBFill', 'cfBColor', 'cfBBorder', 'cfBNeg', 'cfBAxis'].map(i => document.getElementById(i).value).join('|') + '|' + document.getElementById('cfBV0').disabled`)) === 'auto|auto|grad|#638ec6|solid|#ff0000|auto|true', null);
    await clickSel('#cfBOnly'); await setv('#cfBFill', 'solid');
    check('E3 la vista previa de la barra es sólida', (await ev(`getComputedStyle(document.querySelector('#cfVPrev .cfbar')).backgroundColor`)) === 'rgb(99, 142, 198)', null);
    await ruleOk(); await sleep(60);
    check('E3 la barra se crea con "Mostrar solo la barra": A3 sin valor y con la mitad de la barra', (await cfsJ()) === '["A1:A5|bar|auto,auto"]' && (await ev(`Q.t('A3')`)) === '' && near0(await barGeo('A3', 0, 0.5)), [await cfs(), await ev(`Q.t('A3')`)]);
    await key('z', 2);
    // conjunto de íconos
    await goto('A1:A5'); await cfMenu('Nueva regla…'); await setv('#cfTypes', 'scale'); await setv('#cfVStyle', 'icons');
    const irows = () => ev(`[...document.querySelectorAll('#cfIRows tr')].map(tr => tr.querySelector('svg').dataset.ic + ' ' + tr.querySelector('.cf-iwhen').textContent + (tr.querySelector('select') ? ' ' + tr.querySelector('select').value + ' ' + tr.querySelector('input').value + ' ' + tr.querySelectorAll('select')[1].value : '')).join(' | ')`);
    check('E3 Conjunto de íconos por omisión: 3 semáforos (sin marco), >= 67 y >= 33 por ciento', (await ev(`document.getElementById('cfISet').value`)) === '3traffic'
      && (await irows()) === 'cirG cuando el valor es gte 67 percent | cirY cuando < 67 y gte 33 percent | cirR cuando < 33', await irows());
    await setv('#cfISet', '5ratings');
    check('E3 5 valoraciones: umbrales 80, 60, 40 y 20', (await irows()) === 'bars4 cuando el valor es gte 80 percent | bars3 cuando < 80 y gte 60 percent | bars2 cuando < 60 y gte 40 percent | bars1 cuando < 40 y gte 20 percent | bars0 cuando < 20', await irows());
    await setv('#cfIO0', 'gt'); await clickSel('#cfIV0'); await ev(`document.getElementById('cfIV0').select()`); await type('90');
    check('E3 cambiar el operador y el valor actualiza "cuando <= 90 y"', (await irows()).includes('bars3 cuando <= 90 y'), await irows());
    await clickSel('#cfIRev');
    check('E3 Invertir criterio de ordenación: los íconos se dan vuelta y los umbrales se quedan', (await irows()).startsWith('bars0 cuando el valor es gt 90 percent | bars1'), await irows());
    await clickSel('#cfIOnly');
    await ruleOk(); await sleep(60);
    check('E3 la regla de íconos se crea: 5 valoraciones, > 90 %, invertida y sin valor', (await cfsJ()) === '["A1:A5|icons|5ratings gt percent 90,gte percent 60,gte percent 40,gte percent 20"]'
      && (await ic('A5')) === 'bars0|2|' && (await ic('A1')) === 'bars4|2|', [await cfs(), await ic('A5'), await ic('A1')]);

    // ---------- E4: Administrador ----------
    await setRules([{ at: 'A1:A5', type: 'icons', set: '3arrows' }, bar('A1:A5', AUTO, AUTO), sc2('A1:A5', MIN, MAX), { at: 'A1:A5', type: 'cellIs', op: 'greaterThan', f1: '50', style: { b: true } }]);
    await clickSel(cellSel('A2')); await cfMenu('Administrar reglas…');
    check('E4 descripciones de Excel y "Detener si es verdad" deshabilitado en escalas, barras e íconos', (await mgrRows()) === '*Conjunto de íconos @ =$A$1:$A$5 [-] | Barra de datos @ =$A$1:$A$5 [-] | Escala de colores @ =$A$1:$A$5 [-] | Valor de la celda > 50 @ =$A$1:$A$5', await mgrRows());
    // (la lectura no lanza si falta una muestra: así la falla queda en esta aserción y el arnés sigue, L-028)
    check('E4 la columna Formato muestra los íconos, la barra y la escala', (await ev(`(() => { const s = [...document.querySelectorAll('#cfTable tbody .cf-vsm')], b = s[2] && s[2].querySelector('.cfbar'); return s.length + '|' + (s[0] ? [...s[0].querySelectorAll('svg')].map(x => x.dataset.ic).join(',') : '') + '|' + !!(s[1] && s[1].querySelector('.cfbar')) + '|' + (b ? getComputedStyle(b).backgroundImage : 'sin muestra'); })()`)) === '3|upG,rightY,downR|true|linear-gradient(90deg, rgb(0, 0, 0), rgb(255, 255, 255))', null);
    const r1 = await ev(`(() => { const r = document.querySelector('#cfTable tbody tr:nth-child(1) td.cf-rule').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
    await click(r1.x, r1.y); await click(r1.x, r1.y, { clickCount: 2 }); await sleep(60);
    check('E4 doble clic: Editar regla de formato con el conjunto de íconos', (await isOpen('cfRuleDlg')) && (await ev(`document.querySelector('#cfRuleDlg h3').textContent + '|' + document.getElementById('cfTypes').value + '|' + document.getElementById('cfVStyle').value + '|' + document.getElementById('cfISet').value`)) === 'Editar regla de formato|scale|icons|3arrows', null);
    await setv('#cfISet', '3flags'); await clickSel('#cfRuleDlg .dlg-ok'); await sleep(40);
    check('E4 la regla editada se ve en la lista con su muestra nueva', (await ev(`[...document.querySelectorAll('#cfTable tbody tr:nth-child(1) svg')].map(x => x.dataset.ic).join(',')`)) === 'flagG,flagY,flagR', null);
    await clickSel('#cfMgrDlg .dlg-ok'); await sleep(60);
    check('E4 Aceptar: banderas en la hoja (100 bandera verde)', (await ic('A5')).startsWith('flagG|'), await ic('A5'));
    await key('z', 2);
    check('E4 Ctrl+Z vuelve a las flechas', (await ic('A5')).startsWith('upG|'), await ic('A5'));

    // ---------- E5: matriz operaciones × sheet.cf con escalas, barras e íconos ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('A1')); await paste('Monto\r\n0\r\n25\r\n50\r\n75\r\n100');
    await clickSel(cellSel('A1')); await key('2', 2);   // encabezado en negrita: ordenar lo detecta
    await clickSel(cellSel('E1')); await write('100');
    await setRules([bar('A2:A6', { k: 'num', v: '0' }, { k: 'formula', v: '=$E$1' }, { grad: false })]);
    check('E5 barra con máximo =$E$1: 50 → la mitad', near0(await barGeo('A4', 0, 0.5)), await barGeo('A4', 0, 0.5));
    await clickSel(cellSel('A1')); await key(' ', 8); await clickSel("button[data-cmd='ins-row']");
    check('E5 insertar una fila arriba: la regla pasa a A3:A7 y su fórmula a =$E$2', (await cfsJ()) === '["A3:A7|bar|num 0,formula =$E$2"]' && near0(await barGeo('A5', 0, 0.5)), [await cfs(), await barGeo('A5', 0, 0.5)]);
    await key('z', 2);
    check('E5 Ctrl+Z la devuelve', (await cfsJ()) === '["A2:A6|bar|num 0,formula =$E$1"]', await cfs());
    await clickSel(cellSel('A3')); await key(' ', 8); await clickSel("button[data-cmd='del-row']");
    check('E5 eliminar la fila 3: A2:A5', (await cfsJ()) === '["A2:A5|bar|num 0,formula =$E$1"]' && near0(await barGeo('A3', 0, 0.5)), [await cfs(), await barGeo('A3', 0, 0.5)]);
    await key('z', 2);
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort-desc']");
    check('E5 ordenar Z→A: la regla se queda con sus celdas y las barras siguen a los valores (A2 = 100 entera)', (await cfsJ()) === '["A2:A6|bar|num 0,formula =$E$1"]' && near0(await barGeo('A2', 0, 1)) && near0(await barGeo('A4', 0, 0.5)), [await cfs(), await barGeo('A2', 0, 1)]);
    await key('z', 2);
    await clickSel(cellSel('A4')); await key('Delete');
    check('E5 Supr borra el valor: sin barra y la regla sigue', (await barGeo('A4', 0, 0)) === 'sin barra' && (await cfsJ()) === '["A2:A6|bar|num 0,formula =$E$1"]', await cfs());
    await key('z', 2);
    await clickSel(cellSel('A4')); await clickSel("button[data-cmd='clearfmt']");
    check('E5 Borrar formato quita la barra de A4 (la regla se parte)', (await cfsJ()) === '["A2:A3 A5:A6|bar|num 0,formula =$E$1"]' && (await barGeo('A4', 0, 0)) === 'sin barra', await cfs());
    await key('z', 2);
    await goto('A2:A6'); const copied = await clipEv('copy');
    await clickSel(cellSel('C2')); await paste(copied);
    check('E5 copiar y pegar: la misma regla se extiende a C2:C6 (una sola regla) y dibuja', (await cfsJ()) === '["A2:A6 C2:C6|bar|num 0,formula =$E$1"]' && near0(await barGeo('C4', 0, 0.5)), [await cfs(), await barGeo('C4', 0, 0.5)]);
    await key('z', 2);
    await goto('A6:A8'); await key('j', 2);
    check('E5 Ctrl+J rellena la regla (A2:A8) y la copia de 100 dibuja su barra', (await cfsJ()) === '["A2:A8|bar|num 0,formula =$E$1"]' && near0(await barGeo('A8', 0, 1)), [await cfs(), await barGeo('A8', 0, 1)]);
    await key('z', 2);
    await goto('A2:A6'); const cut = await clipEv('cut');
    await clickSel(cellSel('G2')); await paste(cut);
    check('E5 cortar y pegar mueve la regla (G2:G6) sin cambiar su fórmula', (await cfsJ()) === '["G2:G6|bar|num 0,formula =$E$1"]' && near0(await barGeo('G4', 0, 0.5)) && (await barGeo('A4', 0, 0)) === 'sin barra', await cfs());
    await key('z', 2);
    check('E5 Ctrl+Z la devuelve', (await cfsJ()) === '["A2:A6|bar|num 0,formula =$E$1"]', await cfs());
    await clickSel(cellSel('A4')); await clickSel(cellSel('A4'), { button: 'right' }); await ev("Q.menu('Ocultar filas')");
    check('E5 con la fila 4 oculta, las demás barras siguen (A5 = 75)', near0(await barGeo('A5', 0, 0.75)), await barGeo('A5', 0, 0.75));
    await key('z', 2);
    // otra hoja: umbral con una referencia a ella, renombrar, duplicar, .bassx y .xlsx
    await clickSel('.tab.add'); await clickSel(cellSel('A1')); await write('50');
    await clickText('.tab', 'Hoja1');
    await setRules([{ at: 'A2:A6', type: 'icons', set: '3arrows', th: [{ k: 'formula', v: '=Hoja2!$A$1' }, { k: 'num', v: '10' }] }]);
    check('E5 umbral =Hoja2!$A$1 (50): 50 lleva la flecha verde', (await ic('A4')).startsWith('upG|') && (await ic('A3')).startsWith('rightY|'), await ic('A4'));
    await ev(`window.prompt = () => 'Datos'; 1`);
    await clickText('.tab', 'Hoja2');
    await click(...Object.values(await ev(`(() => { const r = document.querySelector('.tab.on').getBoundingClientRect(); return { x: r.left + 10, y: r.top + 8 }; })()`)), { clickCount: 2 });
    await clickText('.tab', 'Hoja1');
    check('E5 renombrar la hoja actualiza la fórmula del umbral (=Datos!$A$1)', (await cfsJ()) === '["A2:A6|icons|3arrows gte formula =Datos!$A$1,gte num 10"]' && (await ic('A4')).startsWith('upG|'), await cfs());
    await clickSel('.tab.on', { button: 'right' }); await ev("Q.menu('Duplicar hoja')"); await sleep(60);
    check('E5 duplicar la hoja copia la regla (flechas en la copia)', (await ev(`document.querySelector('.tab.on').textContent`)) === 'Hoja1 (2)' && (await ic('A4')).startsWith('upG|'), await ic('A4'));
    await clickText('.tab', 'Hoja1');
    await sleep(600);
    await open(false);
    check('E5 .bassx (autoguardado y recarga): la regla sigue y dibuja', (await cfsJ()) === '["A2:A6|icons|3arrows gte formula =Datos!$A$1,gte num 10"]' && (await ic('A4')).startsWith('upG|'), await cfs());
    await ev(`window.__book = null; XLSX.writeFile = bk => { window.__book = bk; }; 1`);
    await clickSel("button[data-cmd='xlsx']");
    check('E5 exportar .xlsx avisa que se pierde el formato condicional', (await isOpen('msgDlg')) && (await msgText() || '').startsWith('Este libro tiene formato condicional y Bassxcel todavía no lo guarda en .xlsx'), await msgText());
    await clickSel('#msgCancel');

    // ---------- E6: pestaña Número de "Formato de celdas" y "Se aplica a" con clic o arrastre en la grilla ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('A1')); await paste('0,5\r\n1234,5\r\n50');
    await clickSel(cellSel('A3')); await setv('#fmtSel', 'percent'); await sleep(40);
    check('E6 A3 con formato Porcentaje propio: 5.000%', (await ev(`Q.t('A3')`)) === '5.000%', await ev(`Q.t('A3')`));
    await goto('A1:A3'); await cfMenu('Reglas para resaltar celdas', 'Mayor que…');
    await ev(`document.getElementById('cfV1').select()`); await type('10');
    await setv('#cfPreset', 'custom'); await sleep(60);
    await clickText('#cfFmtDlg .dv-tab', 'Número');
    check('E6 pestaña Número: categorías y decimales deshabilitados sin categoría', (await ev(`[...document.querySelectorAll('#cfNumFmt option')].map(o => o.textContent).join('|') + '|' + document.getElementById('cfNumDec').disabled + '|' + !document.getElementById('cfPgN').hidden`)) === '(sin cambiar)|General|Número|Moneda|Porcentaje|Científica|Fecha|Hora|Fecha y hora|true|true', null);
    await setv('#cfNumFmt', 'currency'); await setv('#cfNumDec', '0');
    check('E6 Moneda con 0 decimales: la muestra es $1.235', (await ev(`document.getElementById('cfFmtSample').textContent`)) === '$1.235', await ev(`document.getElementById('cfFmtSample').textContent`));
    await clickSel('#cfFmtDlg .dlg-ok'); await sleep(60);
    check('E6 vista previa con el formato de número de la regla: 1234,5 → $1.235', (await ev(`Q.t('A2')`)) === '$1.235', await ev(`Q.t('A2')`));
    await clickSel('#cfQuickDlg .dlg-ok'); await sleep(60);
    check('E6 la regla reemplaza el formato de número de la celda (A3: $50, no 5000%), deja el de A1 (0,5) y no cambia la celda',
      (await ev(`Q.t('A1') + '|' + Q.t('A2') + '|' + Q.t('A3')`)) === '0,5|$1.235|$50' && (await sleep(550).then(() => ev(`JSON.stringify(Q.sheet().cf[0].style) + '|' + JSON.stringify(Q.sheet().cells.A3.s)`))) === '{"fmt":"currency","dec":0}|{"fmt":"percent"}', await ev(`JSON.stringify(Q.sheet().cf[0].style)`));
    await key('z', 2);
    check('E6 Ctrl+Z: vuelve el 5.000%', (await ev(`Q.t('A3')`)) === '5.000%', await ev(`Q.t('A3')`));
    await key('y', 2);
    await clickSel(cellSel('A1')); await cfMenu('Administrar reglas…');
    await clickSel('#cfTable tbody tr:nth-child(1) .cf-at');
    const at = a => ev(`(() => { const r = Q.td(${JSON.stringify(a)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const a6 = await at('A6'), a9 = await at('A9');
    await click(a6.x, a6.y); await sleep(40);
    check('E6 Administrador: clic en A6 escribe =$A$6 en "Se aplica a" (el cuadro no tapa la hoja)', (await ev(`document.querySelector('#cfTable tbody tr:nth-child(1) .cf-at').value`)) === '=$A$6', await ev(`document.querySelector('#cfTable tbody tr:nth-child(1) .cf-at').value`));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a6.x, y: a6.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a6.x, y: a6.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a9.x, y: (a6.y + a9.y) / 2, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a9.x, y: a9.y, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a9.x, y: a9.y, button: 'left', clickCount: 1 }); await sleep(40);
    check('E6 arrastre de A6 a A9: =$A$6:$A$9 y la selección de la hoja no cambia', (await ev(`document.querySelector('#cfTable tbody tr:nth-child(1) .cf-at').value`)) === '=$A$6:$A$9' && (await ev('Q.nb()')) === 'A1', [await ev(`document.querySelector('#cfTable tbody tr:nth-child(1) .cf-at').value`), await ev('Q.nb()')]);
    await clickSel('#cfMgrDlg .dlg-ok'); await sleep(60);
    check('E6 Aceptar: la regla pasa a A6:A9 (A2 vuelve a 1234,5)', (await cfsJ()) === '["A6:A9|cellIs|greaterThan 10"]' && (await ev(`Q.t('A2')`)) === '1234,5', [await cfs(), await ev(`Q.t('A2')`)]);
    await cfMenu('Administrar reglas…'); await key('Escape'); await sleep(40);
    check('E6 Esc cierra el Administrador no modal y el foco vuelve a la grilla', !(await isOpen('cfMgrDlg')) && (await ev('document.activeElement.id')) === 'gridWrap', await ev('document.activeElement.id'));
    // un formato de número de la regla sin decimales usa los del formato, no los que tenía la celda (L-055)
    await clickSel(cellSel('B1')); await write('1234,5'); await clickSel(cellSel('B1'));
    for (let i = 0; i < 3; i++) await clickSel("button[data-cmd='dec-more']");
    const b1 = await ev(`Q.t('B1')`);
    await setRules([{ at: 'B1', type: 'cellIs', op: 'greaterThan', f1: '0', style: { fmt: 'currency' } }]);
    check('E6 B1 con 4 decimales propios (1.234,5000) y una regla Moneda sin decimales: $1.234,5', b1 === '1.234,5000' && (await ev(`Q.t('B1')`)) === '$1.234,5', [b1, await ev(`Q.t('B1')`)]);

    check('sin errores de página', b.errors.length === 0, b.errors);
  } catch (e) {
    console.log('ERROR DEL ARNÉS: ' + (e && e.stack || e));
    console.log('Diálogos: ' + JSON.stringify(b.dialogs) + '\nÚltimos eventos y consola:\n  ' + b.consoleLog.slice(-25).join('\n  '));
    check('el arnés terminó', false, String(e));
  } finally {
    await b.close();
  }
  process.exit(done() ? 1 : 0);
})();

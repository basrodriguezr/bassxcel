'use strict';
// Arnés de Chrome headless de la ronda 5d de grid-ui-dev: Formato condicional, parte 1 (Inicio ▸ Estilos ▸ Formato
// condicional): el evaluador puro (window.__bxCf.style, con la fecha de hoy fija), los cuadros rápidos con vista previa y
// selección de celdas, "Formato de celdas", "Nueva regla de formato", el Administrador de reglas, Borrar reglas y la matriz
// operaciones × sheet.cf (insertar/eliminar, ordenar, Supr, Borrar formato, Borrar todo, copiar/pegar, Pegado especial,
// rellenar, cortar, deshacer, hojas, .bassx, .xlsx, paneles, filas ocultas, imprimir, celdas fantasma, combinaciones).
// Uso: node tests/ui-cf.harness.js [--web=<carpeta>]   (sale con código 1 si alguna aserción falla)
// Entrada real por CDP (clics, teclas, Esc, doble clic: L-031). Lecturas: el modelo autoguardado (Q.sheet(), 400 ms
// después del cambio), el color calculado del td (getComputedStyle, L-023) y el DOM de los cuadros. Cada grupo abre un
// libro nuevo (L-039) y fija la selección antes de cada gesto (L-054). Complementa la receta REA UI-48.
const { launch, reporter, sleep } = require('./cdp');

(async () => {
  const b = await launch({ port: 8776, cdpPort: 9344 });
  console.log('web: ' + b.web);
  const { check, done } = reporter();
  const { ev, key, type, click, clickSel, clickText, cellSel, open } = b;
  const goto = async ref => { await ev(`(() => { const n = document.getElementById('nameBox'); n.value = ${JSON.stringify(ref)}; n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`); await sleep(50); };
  const paste = text => ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  const clipEv = kind => ev(`(() => { const dt = new DataTransfer(); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent(${JSON.stringify(kind)}, { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData('text/plain'); })()`);
  const captureConfirm = () => ev(`window.confirm = () => true; window.alert = m => console.log('ALERT ' + m); 1`);
  const isOpen = id => ev(`!!(document.getElementById(${JSON.stringify(id)}) && document.getElementById(${JSON.stringify(id)}).open)`);
  const msgText = () => ev(`document.getElementById('msgDlg').open ? document.getElementById('msgText').textContent : null`);
  const val = (a, delay = 550) => sleep(delay).then(() => ev(`(() => { const c = Q.sheet().cells[${JSON.stringify(a)}]; return c ? c.v : ''; })()`));
  const setv = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return e.value; })()`);
  const write = async (text, end = 'Enter') => { await type(text); await key(end); await sleep(30); };
  const L = `const L = (r, c) => { let s = '', n = c + 1; while (n) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s + (r + 1); };`;
  // reglas del modelo autoguardado como texto: "C2:C9|cellIs|greaterThan|100" (rangos separados por espacio)
  const cfs = async (delay = 550) => {
    await sleep(delay);
    return ev(`(() => { ${L} return (Q.sheet().cf || []).map(d => d.ranges.map(g => g.r1 === g.r2 && g.c1 === g.c2 ? L(g.r1, g.c1) : L(g.r1, g.c1) + ':' + L(g.r2, g.c2)).join(' ') + '|' + d.type + '|' + (d.op || d.period || '') + '|' + [d.f1, d.f2].filter(x => x != null && x !== '').join(';')); })()`);
  };
  const cfsJ = async delay => JSON.stringify(await cfs(delay));
  // celdas de una columna: col('A', 1, 3) → A1 A2 A3
  const col = (c, r1, r2) => Array.from({ length: r2 - r1 + 1 }, (_, i) => c + (r1 + i));
  // máscara del evaluador puro: '1' si alguna regla da estilo a la celda
  const mask = cells => ev(`${JSON.stringify(cells)}.map(a => __bxCf.style(a) ? '1' : '0').join('')`);
  const setRules = rules => ev(`__bxCf.set(${JSON.stringify(rules)})`);
  const S = async (rules, cells) => { await setRules(rules); return mask(cells); };
  const st = a => ev(`JSON.stringify(__bxCf.style(${JSON.stringify(a)}))`);
  // color calculado del td (L-023)
  const bg = a => ev(`(() => { const t = Q.td(${JSON.stringify(a)}); return t ? getComputedStyle(t).backgroundColor : '(no DOM)'; })()`);
  const fgc = a => ev(`(() => { const t = Q.td(${JSON.stringify(a)}); return t ? getComputedStyle(t).color : '(no DOM)'; })()`);
  const fw = a => ev(`(() => { const t = Q.td(${JSON.stringify(a)}); return t ? getComputedStyle(t).fontWeight : '(no DOM)'; })()`);
  const PINK = 'rgb(255, 199, 206)', GREEN = 'rgb(198, 239, 206)', NONE = 'rgba(0, 0, 0, 0)', DARKRED = 'rgb(156, 0, 6)', TXT = 'rgb(34, 34, 34)';
  const bgs = async cells => { const o = []; for (const a of cells) o.push((await bg(a)) === PINK ? '1' : '0'); return o.join(''); };
  // Inicio ▸ Formato condicional ▾ ▸ submenú ▸ opción (clics reales; el submenú se abre al pasar el ratón o con clic)
  const cfMenu = async (sub, item) => {
    await clickSel("button[data-cmd='cf']");
    await clickText('#menu div', sub); await sleep(40);
    if (item) { await clickText('#menu2 div', item); await sleep(60); }
  };
  const menuTexts = sel => ev(`[...document.querySelectorAll(${JSON.stringify(sel)} + ' div')].map(x => x.textContent + (x.classList.contains('dis') ? '(x)' : '')).join('|')`);
  const quickOk = () => clickSel('#cfQuickDlg .dlg-ok');
  const quick = async (sub, item, value, preset) => {
    await cfMenu(sub, item);
    if (value != null) { await clickSel('#cfV1'); await ev(`document.getElementById('cfV1').select()`); await type(value); }
    if (preset != null) await setv('#cfPreset', preset);
    await quickOk(); await sleep(60);
  };
  const tdCenter = a => ev(`(() => { const r = Q.td(${JSON.stringify(a)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const mgrRows = () => ev(`[...document.querySelectorAll('#cfTable tbody tr')].map(tr => (tr.classList.contains('on') ? '*' : '') + tr.querySelector('.cf-rule').textContent + ' @ ' + tr.querySelector('.cf-at').value + (tr.querySelector('.cf-stop').checked ? ' [stop]' : '')).join(' | ')`);
  const MONTOS = 'Monto\r\n50\r\n120\r\n80\r\n300\r\n100\r\n101\r\n99,5\r\n250';
  const C29 = col('C', 2, 9);

  try {
    // ---------- C0: evaluador puro (cfStyle) ----------
    await open();
    await clickSel(cellSel('A1')); await paste("5\r\n150\r\nabc\r\n\r\n100\r\n1,5\r\n#N/D\r\nSí");
    await clickSel(cellSel('C1')); await paste('100');
    const A = col('A', 1, 8), red = { bg: '#ffc7ce', fg: '#9c0006' };
    check('C0 Mayor que 100: solo 150 (100 no, texto no, vacía no, error no)', (await S([{ at: 'A1:A8', type: 'cellIs', op: 'greaterThan', f1: '100', style: red }], A)) === '01000000', await mask(A));
    check('C0 Mayor que 1,5 (es-CL): 5, 150 y 100; 1,5 no', (await S([{ at: 'A1:A8', type: 'cellIs', op: 'greaterThan', f1: '1,5', style: red }], A)) === '11001000', await mask(A));
    check('C0 Entre 5 y 100 incluye los extremos; Entre 100 y 5 es igual', (await S([{ at: 'A1:A8', type: 'cellIs', op: 'between', f1: '5', f2: '100', style: red }], A)) === '10001000'
      && (await S([{ at: 'A1:A8', type: 'cellIs', op: 'between', f1: '100', f2: '5', style: red }], A)) === '10001000', await mask(A));
    check('C0 No está entre 5 y 100: 150 y 1,5 (texto, vacía y error no)', (await S([{ at: 'A1:A8', type: 'cellIs', op: 'notBetween', f1: '5', f2: '100', style: red }], A)) === '01000100', await mask(A));
    check('C0 Es igual a "sí" sin distinguir mayúsculas: Sí', (await S([{ at: 'A1:A8', type: 'cellIs', op: 'equal', f1: 'sí', style: red }], A)) === '00000001', await mask(A));
    check('C0 Mayor que =$C$1 (referencia, C1 = 100): solo 150', (await S([{ at: 'A1:A8', type: 'cellIs', op: 'greaterThan', f1: '=$C$1', style: red }], A)) === '01000000', await mask(A));
    check('C0 Menor o igual que 5: 5 y 1,5', (await S([{ at: 'A1:A8', type: 'cellIs', op: 'lessThanOrEqual', f1: '5', style: red }], A)) === '100001' + '00', await mask(A));
    await clickSel(cellSel('B1')); await paste('Manzana\r\npera\r\nMANGO\r\n123\r\n');
    const B = col('B', 1, 5);
    check('C0 Texto que contiene "man" (sin mayúsculas): Manzana y MANGO', (await S([{ at: 'B1:B5', type: 'text', op: 'contains', f1: 'man', style: red }], B)) === '10100', await mask(B));
    check('C0 que no contiene "man": pera, 123 y la vacía (como ESERROR(HALLAR))', (await S([{ at: 'B1:B5', type: 'text', op: 'notContains', f1: 'man', style: red }], B)) === '01011', await mask(B));
    check('C0 que comienza con "PE" y que termina en "go"', (await S([{ at: 'B1:B5', type: 'text', op: 'beginsWith', f1: 'PE', style: red }], B)) === '01000'
      && (await S([{ at: 'B1:B5', type: 'text', op: 'endsWith', f1: 'go', style: red }], B)) === '00100', await mask(B));
    check('C0 contiene "12" también en un número (123)', (await S([{ at: 'B1:B5', type: 'text', op: 'contains', f1: '12', style: red }], B)) === '00010', await mask(B));
    await clickSel(cellSel('D1')); await paste("x\r\n\r\n' \r\n#N/D");
    const D = col('D', 1, 4);
    check('C0 Celdas en blanco: la vacía y la de solo espacios (no el error)', (await S([{ at: 'D1:D4', type: 'blanks', style: red }], D)) === '0110', await mask(D));
    check('C0 Sin espacios en blanco: solo x · Errores: el #N/D · Sin errores: las otras tres', (await S([{ at: 'D1:D4', type: 'noBlanks', style: red }], D)) === '1000'
      && (await S([{ at: 'D1:D4', type: 'errors', style: red }], D)) === '0001' && (await S([{ at: 'D1:D4', type: 'noErrors', style: red }], D)) === '1110', await mask(D));
    // fechas: hoy = jueves 01/01/2026 (serial 46023); la semana empieza el domingo 28/12/2025
    check('C0 la fecha de hoy se fija en 46023', (await ev('__bxCf.setToday(46023)')) === 46023, null);
    await clickSel(cellSel('E1'));
    await paste('31/12/2025\r\n01/01/2026\r\n02/01/2026\r\n26/12/2025\r\n25/12/2025\r\n28/12/2025\r\n27/12/2025\r\n03/01/2026\r\n04/01/2026\r\n21/12/2025\r\n20/12/2025\r\n15/12/2025\r\n31/01/2026\r\n01/02/2026\r\nhoy');
    const E = col('E', 1, 15), per = async p => S([{ at: 'E1:E15', type: 'date', period: p, style: red }], E);
    check('C0 Ayer / Hoy / Mañana', (await per('yesterday')) === '100000000000000' && (await per('today')) === '010000000000000' && (await per('tomorrow')) === '001000000000000', await per('today'));
    check('C0 En los últimos 7 días: del 26/12/2025 al 01/01/2026 (no mañana ni el 25/12)', (await per('last7')) === '110101100000000', await per('last7'));
    check('C0 Esta semana: domingo 28/12/2025 a sábado 03/01/2026', (await per('thisWeek')) === '111001010000000', await per('thisWeek'));
    check('C0 Semana pasada: 21/12 a 27/12/2025 · Semana próxima: desde el domingo 04/01/2026', (await per('lastWeek')) === '000110100100000' && (await per('nextWeek')) === '000000001000000', [await per('lastWeek'), await per('nextWeek')]);
    check('C0 Mes pasado / Este mes / Mes próximo', (await per('lastMonth')) === '100111100111000' && (await per('thisMonth')) === '011000011000100' && (await per('nextMonth')) === '000000000000010',
      [await per('lastMonth'), await per('thisMonth'), await per('nextMonth')]);
    await clickSel(cellSel('F1')); await paste('10\r\n20\r\n30\r\n30\r\n40\r\n50\r\ntexto\r\n');
    const F = col('F', 1, 8), top = async o => S([{ at: 'F1:F8', type: 'top', style: red, ...o }], F);
    check('C0 2 superiores: 50 y 40 · 3 superiores con empate: 50, 40 y los dos 30', (await top({ rank: 2 })) === '00001100' && (await top({ rank: 3 })) === '00111100', await top({ rank: 3 }));
    check('C0 1 inferior: 10 · 10% superior de 6 números: al menos 1 (50) · 50%: 3 con empate', (await top({ rank: 1, bottom: true })) === '10000000' && (await top({ rank: 10, percent: true })) === '00000100'
      && (await top({ rank: 50, percent: true })) === '00111100', [await top({ rank: 10, percent: true }), await top({ rank: 50, percent: true })]);
    const avg = async o => S([{ at: 'F1:F8', type: 'avg', style: red, ...o }], F);
    check('C0 promedio de los números (30): por encima 40 y 50; por debajo 10 y 20; igual o por encima incluye los 30', (await avg({})) === '00001100' && (await avg({ below: true })) === '11000000' && (await avg({ equal: true })) === '00111100',
      [await avg({}), await avg({ below: true }), await avg({ equal: true })]);
    check('C0 1 desv. est. (muestral, 14,14) por encima: 50; por debajo: 10', (await avg({ sd: 1 })) === '00000100' && (await avg({ sd: 1, below: true })) === '10000000', [await avg({ sd: 1 }), await avg({ sd: 1, below: true })]);
    // 1, 2, 3, 8,7, 10: promedio 4,94; desviación muestral 4,11 (límite 9,05: solo 10); la poblacional (3,68) daría también 8,7
    await clickSel(cellSel('K1')); await paste('1\r\n2\r\n3\r\n8,7\r\n10');
    check('C0 la desviación estándar es la muestral (DESVEST): 1 desv. est. por encima de 1;2;3;8,7;10 → solo 10', (await S([{ at: 'K1:K5', type: 'avg', sd: 1, style: red }], col('K', 1, 5))) === '00001', await mask(col('K', 1, 5)));
    await clickSel(cellSel('G1')); await paste('Ana\r\nana\r\nLuis\r\n5\r\n5\r\n');
    const G = col('G', 1, 6);
    check('C0 Duplicar valores sin distinguir mayúsculas (Ana/ana, 5/5); vacía no · Únicos: Luis', (await S([{ at: 'G1:G6', type: 'dup', style: red }], G)) === '110110' && (await S([{ at: 'G1:G6', type: 'dup', unique: true, style: red }], G)) === '001000', await mask(G));
    await clickSel(cellSel('H1')); await paste('1\r\n2\r\n3\r\n4');
    const H = col('H', 1, 4);
    check('C0 fórmula =H1>2 anclada en H1: relativa en cada celda (H3, H4)', (await S([{ at: 'H1:H4', type: 'expr', f1: '=H1>2', style: red }], H)) === '0011', await mask(H));
    check('C0 fórmula con FILA() de la celda: =RESIDUO(FILA();2)=0 → H2, H4', (await S([{ at: 'H1:H4', type: 'expr', f1: '=RESIDUO(FILA();2)=0', style: red }], H)) === '0101', await mask(H));
    check('C0 fórmula que da un número ≠ 0 aplica; texto o error no', (await S([{ at: 'H1:H4', type: 'expr', f1: '=H1-2', style: red }], H)) === '1011' && (await S([{ at: 'H1:H4', type: 'expr', f1: '=1/0', style: red }], H)) === '0000', await mask(H));
    await clickSel(cellSel('I1')); await paste('200');
    await setRules([{ at: 'I1', type: 'cellIs', op: 'greaterThan', f1: '100', style: { bg: '#ffc7ce', fg: '#9c0006' } }, { at: 'I1', type: 'cellIs', op: 'greaterThan', f1: '50', style: { bg: '#c6efce', b: true } }]);
    check('C0 prioridad: la primera regla gana el relleno; la negrita de la segunda se suma', (await st('I1')) === JSON.stringify({ bg: '#ffc7ce', fg: '#9c0006', b: true }), await st('I1'));
    await setRules([{ at: 'I1', type: 'cellIs', op: 'greaterThan', f1: '100', style: { bg: '#ffc7ce' }, stop: true }, { at: 'I1', type: 'cellIs', op: 'greaterThan', f1: '50', style: { b: true } }]);
    check('C0 "Detener si es verdad" en la primera: la segunda no se aplica', (await st('I1')) === JSON.stringify({ bg: '#ffc7ce' }), await st('I1'));
    await setRules([{ at: 'I1', type: 'cellIs', op: 'greaterThan', f1: '500', style: { bg: '#ffc7ce' }, stop: true }, { at: 'I1', type: 'cellIs', op: 'greaterThan', f1: '50', style: { b: true } }]);
    check('C0 si la regla con "Detener" no se cumple, la siguiente sí se aplica', (await st('I1')) === JSON.stringify({ b: true }), await st('I1'));
    await clickSel(cellSel('J1')); await write('=SECUENCIA(3)');
    check('C0 celdas fantasma de un desborde: Mayor que 1 pinta J2 y J3', (await S([{ at: 'J1:J3', type: 'cellIs', op: 'greaterThan', f1: '1', style: { bg: '#ffc7ce' } }], col('J', 1, 3))) === '011' && (await bg('J3')) === PINK && (await bg('J1')) === NONE, await bg('J3'));
    check('C0 duplicados con celdas fantasma: =SECUENCIA(3) junto a 2 en J4', (await (async () => { await clickSel(cellSel('J4')); await write('2'); return S([{ at: 'J1:J4', type: 'dup', style: red }], col('J', 1, 4)); })()) === '0101', await mask(col('J', 1, 4)));
    await ev('__bxCf.setToday(null)');

    // ---------- C1: aceptación del backlog (C2:C9 montos → Mayor que 100 con relleno rojo claro) ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('C1')); await paste(MONTOS);
    await clickSel(cellSel('E1')); await write('200');
    await goto('C2:C9');
    await cfMenu('Reglas para resaltar celdas');
    check('C1 menú Formato condicional: opciones de Excel (barras, escalas e íconos habilitados desde la 5e)', (await menuTexts('#menu')) === 'Reglas para resaltar celdas|Reglas superiores e inferiores|Barras de datos|Escalas de color|Conjuntos de íconos|Nueva regla…|Borrar reglas|Administrar reglas…', await menuTexts('#menu'));
    check('C1 submenú Reglas para resaltar celdas', (await menuTexts('#menu2')) === 'Mayor que…|Menor que…|Entre…|Es igual a…|Texto que contiene…|Una fecha…|Duplicar valores…|Más reglas…', await menuTexts('#menu2'));
    await clickText('#menu2 div', 'Mayor que…'); await sleep(60);
    check('C1 cuadro "Mayor que" con el texto de Excel y el valor de la celda activa (50) seleccionado', (await isOpen('cfQuickDlg')) && (await ev(`document.querySelector('#cfQuickDlg h3').textContent + ' / ' + document.querySelector('#cfQuickDlg .cf-q').textContent`)) === 'Mayor que / Aplicar formato a las celdas que son MAYORES QUE:'
      && (await ev(`(() => { const i = document.getElementById('cfV1'); return i.value + '|' + (document.activeElement === i) + '|' + i.selectionStart + '-' + i.selectionEnd; })()`)) === '50|true|0-2', await ev(`document.getElementById('cfV1').value`));
    check('C1 formatos predefinidos en el orden de Excel', (await ev(`[...document.querySelectorAll('#cfPreset option')].map(o => o.textContent).join('|')`)) === 'Relleno rojo claro con texto rojo oscuro|Relleno amarillo con texto amarillo oscuro|Relleno verde con texto verde oscuro|Relleno rojo claro|Texto rojo|Borde rojo|Formato personalizado…', null);
    check('C1 vista previa en vivo con 50: ya pinta 120 (C3) con texto rojo oscuro', (await bg('C3')) === PINK && (await fgc('C3')) === DARKRED && (await bg('C2')) === NONE, [await bg('C3'), await fgc('C3')]);
    await type('100');
    check('C1 al escribir 100 la vista previa se actualiza: C6 (100) sin pintar, C7 (101) pintada', (await bgs(C29)) === '01010101', await bgs(C29));
    await setv('#cfPreset', '3');
    check('C1 "Relleno rojo claro": relleno sin el color de texto', (await bg('C3')) === PINK && (await fgc('C3')) === TXT, [await bg('C3'), await fgc('C3')]);
    check('C1 mientras el cuadro está abierto la regla no está en el modelo', (await cfsJ()) === '[]', await cfs());
    await quickOk(); await sleep(60);
    check('C1 Aceptar crea la regla: C2:C9, Mayor que 100', (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]', await cfs());
    check('C1 solo las celdas > 100 se pintan (color calculado del td): 120, 300, 101, 250', (await bgs(C29)) === '01010101', await bgs(C29));
    check('C1 el formato de la celda no cambia (C3 sin estilo propio)', (await sleep(10).then(() => ev(`JSON.stringify(Q.sheet().cells.C3)`))) === '{"v":"120"}', await ev(`JSON.stringify(Q.sheet().cells.C3)`));
    check('C1 la selección y la celda activa siguen igual (C2:C9, activa C2)', (await ev('Q.nb()')) === 'C2:C9' && (await ev(`Q.at('C2').dLeft === 0 && Q.at('C2').dTop === 0`)), await ev('Q.nb()'));
    await clickSel(cellSel('C3')); await write('50');
    check('C1 cambiar 120 por 50 → C3 se despinta', (await bg('C3')) === NONE && (await bgs(C29)) === '00010101', await bgs(C29));
    await key('z', 2);
    check('C1 Ctrl+Z vuelve a 120 y se pinta', (await val('C3')) === '120' && (await bg('C3')) === PINK, await bg('C3'));
    await key('z', 2);
    check('C1 otro Ctrl+Z quita la regla (un paso)', (await cfsJ()) === '[]' && (await bgs(C29)) === '00000000', await cfs());
    await key('y', 2);
    check('C1 Ctrl+Y la rehace', (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]' && (await bgs(C29)) === '01010101', await cfs());
    // Cancelar y Esc revierten la vista previa
    await goto('C2:C9');
    await cfMenu('Reglas para resaltar celdas', 'Mayor que…'); await type('0');
    check('C1 vista previa con 0: también 50 (C2) se pinta', (await bg('C2')) === PINK, await bg('C2'));
    await key('Escape');
    check('C1 Esc cierra y revierte la vista previa sin cambiar el modelo', !(await isOpen('cfQuickDlg')) && (await bg('C2')) === NONE && (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]', await bg('C2'));
    await cfMenu('Reglas para resaltar celdas', 'Mayor que…'); await type('0');
    await clickSel('#cfQuickDlg .dlg-cancel');
    check('C1 Cancelar también revierte', !(await isOpen('cfQuickDlg')) && (await bg('C2')) === NONE && (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]', await bg('C2'));
    check('C1 el foco vuelve a la grilla al cerrar', (await ev('document.activeElement.id')) === 'gridWrap', await ev('document.activeElement.id'));
    // clic en una celda escribe su referencia absoluta; la regla queda con =$E$1 (E1 = 200)
    await cfMenu('Reglas para resaltar celdas', 'Mayor que…');
    const e1 = await tdCenter('E1'); await click(e1.x, e1.y);
    check('C1 clic en E1 con el cuadro abierto escribe =$E$1 y no cambia la selección', (await ev(`document.getElementById('cfV1').value`)) === '=$E$1' && (await ev('Q.nb()')) === 'C2:C9', [await ev(`document.getElementById('cfV1').value`), await ev('Q.nb()')]);
    await setv('#cfPreset', '2'); await quickOk(); await sleep(60);
    check('C1 la regla nueva queda arriba (mayor prioridad)', (await cfsJ()) === '["C2:C9|cellIs|greaterThan|=$E$1","C2:C9|cellIs|greaterThan|100"]', await cfs());
    check('C1 300 y 250 (> E1) en verde; 120 y 101 siguen en rojo claro', (await bg('C5')) === GREEN && (await bg('C9')) === GREEN && (await bg('C3')) === PINK && (await bg('C7')) === PINK, [await bg('C5'), await bg('C3')]);
    await clickSel(cellSel('E1')); await write('100');
    check('C1 cambiar E1 a 100 recalcula: 120 y 101 pasan a verde', (await bg('C3')) === GREEN && (await bg('C7')) === GREEN, await bg('C3'));
    // decimal es-CL en el cuadro
    await clickSel(cellSel('G1')); await paste('1,4\r\n1,5\r\n1,6');
    await goto('G1:G3'); await quick('Reglas para resaltar celdas', 'Mayor que…', '1,5', '3');
    check('C1 Mayor que 1,5 (coma decimal): solo 1,6', (await bgs(col('G', 1, 3))) === '001', await bgs(col('G', 1, 3)));

    // ---------- C2: los demás cuadros rápidos y "Formato personalizado…" ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('A1')); await paste('10\r\n20\r\n30\r\n40\r\n50\r\nAna\r\nana\r\nLuis');
    const A8 = col('A', 1, 8), qtext = () => ev(`document.querySelector('#cfQuickDlg h3').textContent + ' / ' + document.querySelector('#cfQuickDlg .cf-q').textContent + ' / ' + document.querySelector('#cfQuickDlg .cf-qrow').textContent`);
    await goto('A1:A5'); await cfMenu('Reglas para resaltar celdas', 'Entre…');
    check('C2 Entre: texto de Excel y el menor y el mayor de la selección (10 y 50)', (await qtext()).startsWith('Entre / Aplicar formato a las celdas que están ENTRE: / y') && (await ev(`document.getElementById('cfV1').value + ';' + document.getElementById('cfV2').value`)) === '10;50', await qtext());
    await clickSel('#cfV1'); await ev(`document.getElementById('cfV1').select()`); await type('20');
    await clickSel('#cfV2'); await ev(`document.getElementById('cfV2').select()`); await type('40');
    await setv('#cfPreset', '3'); await quickOk(); await sleep(60);
    check('C2 Entre 20 y 40: 20, 30 y 40', (await bgs(A8)) === '01110000', await bgs(A8));
    await cfMenu('Borrar reglas', 'Borrar reglas de toda la hoja');
    check('C2 Borrar reglas de toda la hoja', (await cfsJ()) === '[]' && (await bgs(A8)) === '00000000', await cfs());
    await goto('A1:A8'); await cfMenu('Reglas para resaltar celdas', 'Es igual a…');
    check('C2 Es igual a: texto de Excel', (await qtext()).startsWith('Es igual a / Aplicar formato a las celdas que son IGUALES A:'), await qtext());
    await setv('#cfPreset', '3'); await clickSel('#cfV1'); await ev(`document.getElementById('cfV1').select()`); await type('ANA'); await key('Enter'); await sleep(60);
    check('C2 Enter acepta: Es igual a ANA pinta Ana y ana (sin distinguir mayúsculas)', !(await isOpen('cfQuickDlg')) && (await bgs(A8)) === '00000110', await bgs(A8));
    await key('z', 2);
    await goto('A1:A8'); await cfMenu('Reglas para resaltar celdas', 'Texto que contiene…');
    check('C2 Texto que contiene: texto de Excel', (await qtext()).startsWith('Texto que contiene / Aplicar formato a las celdas que contienen el texto:'), await qtext());
    await ev(`document.getElementById('cfV1').select()`); await type('UI'); await setv('#cfPreset', '3'); await quickOk(); await sleep(60);
    check('C2 Texto que contiene UI: Luis', (await bgs(A8)) === '00000001' && (await cfsJ()) === '["A1:A8|text|contains|UI"]', await bgs(A8));
    await key('z', 2);
    await cfMenu('Reglas para resaltar celdas', 'Una fecha…');
    check('C2 Una fecha: los 10 períodos de Excel', (await ev(`[...document.querySelectorAll('#cfPeriod option')].map(o => o.textContent).join('|')`)) === 'Ayer|Hoy|Mañana|En los últimos 7 días|Semana pasada|Esta semana|Semana próxima|Mes pasado|Este mes|Mes próximo', null);
    await key('Escape');
    await goto('A1:A8'); await cfMenu('Reglas para resaltar celdas', 'Duplicar valores…');
    check('C2 Duplicar valores: Duplicado / Único', (await qtext()).startsWith('Duplicar valores / Aplicar formato a las celdas que contienen: / DuplicadoÚnicovalores con'), await qtext());
    await setv('#cfPreset', '3'); await quickOk(); await sleep(60);
    check('C2 Duplicar valores: Ana y ana', (await bgs(A8)) === '00000110', await bgs(A8));
    await key('z', 2);
    await goto('A1:A5'); await cfMenu('Reglas superiores e inferiores');
    check('C2 submenú Reglas superiores e inferiores', (await menuTexts('#menu2')) === '10 superiores…|10% de valores superiores…|10 inferiores…|10% de valores inferiores…|Por encima del promedio…|Por debajo del promedio…|Más reglas…', await menuTexts('#menu2'));
    await clickText('#menu2 div', '10 superiores…'); await sleep(60);
    check('C2 10 superiores: texto de Excel, 10 seleccionado', (await qtext()).startsWith('10 superiores / Aplicar formato a las celdas que se encuentran en el rango SUPERIOR:') && (await ev(`document.activeElement.id`)) === 'cfRank', await qtext());
    await ev(`document.getElementById('cfRank').select()`); await type('2'); await setv('#cfPreset', '3'); await quickOk(); await sleep(60);
    check('C2 2 superiores: 40 y 50', (await bgs(col('A', 1, 5))) === '00011', await bgs(col('A', 1, 5)));
    await key('z', 2);
    await goto('A1:A5'); await cfMenu('Reglas superiores e inferiores', '10% de valores inferiores…');
    check('C2 10% de valores inferiores: texto INFERIOR y el %', (await qtext()).startsWith('10% de valores inferiores / Aplicar formato a las celdas que se encuentran en el rango INFERIOR: / %con'), await qtext());
    await ev(`document.getElementById('cfRank').select()`); await type('0'); await quickOk(); await sleep(60);
    check('C2 0 % no se acepta: mensaje y el cuadro sigue abierto', (await msgText()) === 'Escriba un número entero entre 1 y 100.' && (await isOpen('cfQuickDlg')), await msgText());
    await clickSel('#msgOk'); await sleep(30);
    check('C2 tras el mensaje, el foco vuelve al campo', (await ev('document.activeElement.id')) === 'cfRank', await ev('document.activeElement.id'));
    await type('40'); await setv('#cfPreset', '3'); await quickOk(); await sleep(60);
    check('C2 40% inferior de 5 números: 2 (10 y 20)', (await bgs(col('A', 1, 5))) === '11000', await bgs(col('A', 1, 5)));
    await key('z', 2);
    await goto('A1:A5'); await cfMenu('Reglas superiores e inferiores', 'Por encima del promedio…');
    check('C2 Por encima del promedio: texto de Excel', (await qtext()).startsWith('Por encima del promedio / Aplicar formato a las celdas que están POR ENCIMA DEL PROMEDIO: / para el rango seleccionado con'), await qtext());
    await setv('#cfPreset', '3'); await quickOk(); await sleep(60);
    check('C2 Por encima del promedio (30): 40 y 50', (await bgs(col('A', 1, 5))) === '00011', await bgs(col('A', 1, 5)));
    await key('z', 2);
    await goto('A1:A5'); await cfMenu('Reglas para resaltar celdas', 'Mayor que…');
    await ev(`document.getElementById('cfV1').value = ''`); await quickOk(); await sleep(60);
    check('C2 Mayor que sin valor: mensaje', (await msgText()) === 'Debe escribir un valor o una referencia a una celda.', await msgText());
    await clickSel('#msgOk'); await sleep(30);
    await type('25');
    // Formato personalizado…: cuadro "Formato de celdas" (Fuente, Borde, Relleno)
    await setv('#cfPreset', 'custom'); await sleep(60);
    check('C2 Formato personalizado… abre "Formato de celdas" con Número, Fuente, Borde y Relleno (en Fuente)', (await isOpen('cfFmtDlg')) && (await ev(`[...document.querySelectorAll('#cfFmtDlg .dv-tab')].map(x => (x.classList.contains('on') ? '*' : '') + x.textContent).join('/')`)) === 'Número/*Fuente/Borde/Relleno', null);
    await setv('#cfFontStyle', 'b');
    await clickText('#cfFmtDlg .dv-tab', 'Relleno');
    await setv('#cfBg', '#00b050');
    check('C2 la muestra refleja negrita y relleno', (await ev(`(() => { const s = getComputedStyle(document.getElementById('cfFmtSample')); return s.fontWeight + ' ' + s.backgroundColor; })()`)) === '700 rgb(0, 176, 80)', await ev(`getComputedStyle(document.getElementById('cfFmtSample')).backgroundColor`));
    await clickSel('#cfFmtDlg .dlg-ok'); await sleep(60);
    check('C2 de vuelta en el cuadro rápido: vista previa con el formato personalizado (30, negrita y verde)', (await isOpen('cfQuickDlg')) && (await bg('A3')) === 'rgb(0, 176, 80)' && (await fw('A3')) === '700', [await bg('A3'), await fw('A3')]);
    await setv('#cfPreset', 'custom'); await sleep(60);
    await clickSel('#cfFmtDlg .dlg-cancel'); await sleep(40);
    check('C2 Cancelar en "Formato de celdas" conserva el formato personalizado anterior', (await ev(`document.getElementById('cfPreset').value`)) === 'custom' && (await bg('A3')) === 'rgb(0, 176, 80)', await ev(`document.getElementById('cfPreset').value`));
    await quickOk(); await sleep(60);
    check('C2 la regla guarda el estilo personalizado (negrita + relleno)', (await sleep(550).then(() => ev(`JSON.stringify(Q.sheet().cf[0].style)`))) === '{"bg":"#00b050","b":true}', await ev(`JSON.stringify(Q.sheet().cf[0].style)`));
    await goto('A1:A5'); await cfMenu('Reglas para resaltar celdas', 'Menor que…'); await ev(`document.getElementById('cfV1').select()`); await type('15');
    await setv('#cfPreset', '5'); await quickOk(); await sleep(60);
    check('C2 Borde rojo: contorno del td en rojo oscuro', (await ev(`getComputedStyle(Q.td('A1')).borderBottomColor`)) === DARKRED, await ev(`getComputedStyle(Q.td('A1')).borderBottomColor`));

    // ---------- C3: Nueva regla de formato ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('A1')); await paste('Nombre\tMonto\r\nAna\t5\r\nPedro\t20\r\nLuis\t12\r\nPamela\t3');
    // la activa no es la esquina: Enter dentro de la selección la lleva a A3; la fórmula se escribe para A3 (como Excel)
    await goto('A2:B5'); await key('Enter');
    check('C3 la activa queda en A3 dentro de A2:B5', (await ev(`Q.at('A3').dTop === 0 && Q.at('A3').dLeft === 0`)) && (await ev('Q.nb()')) === 'A2:B5', await ev('Q.nb()'));
    await cfMenu('Nueva regla…');
    check('C3 "Nueva regla de formato" con los 6 tipos (el primero, escalas, barras e íconos, desde la 5e)', (await isOpen('cfRuleDlg')) && (await ev(`document.querySelector('#cfRuleDlg h3').textContent`)) === 'Nueva regla de formato'
      && (await ev(`[...document.querySelectorAll('#cfTypes option')].map(o => (o.disabled ? 'x' : '') + o.textContent.replace('► ', '')).join('|')`)) === 'Aplicar formato a todas las celdas según sus valores|Aplicar formato únicamente a las celdas que contengan|Aplicar formato únicamente a los valores con rango inferior o superior|Aplicar formato únicamente a los valores que estén por encima o por debajo del promedio|Aplicar formato únicamente a los valores únicos o duplicados|Utilice una fórmula que determine las celdas para aplicar formato', null);
    check('C3 "Dar formato únicamente a las celdas con:" las 7 opciones', (await ev(`[...document.querySelectorAll('#cfKind option')].map(o => o.textContent).join('|')`)) === 'Valor de la celda|Texto específico|Fechas|Celdas en blanco|Sin espacios en blanco|Errores|Sin errores', null);
    await setv('#cfTypes', 'expr');
    check('C3 tipo fórmula: solo el campo de la fórmula', (await ev(`!document.getElementById('cfDescExpr').hidden && document.getElementById('cfDescCell').hidden`)), null);
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(40);
    check('C3 sin fórmula: mensaje', (await msgText()) === 'Debe escribir una fórmula (por ejemplo, =A1>0).', await msgText());
    await clickSel('#msgOk'); await sleep(30);
    await clickSel('#cfFml'); await type('=$B3>10');
    check('C3 sin formato, la vista previa dice "Sin formato establecido"', (await ev(`document.getElementById('cfSample').textContent`)) === 'Sin formato establecido', null);
    await clickSel('#cfFmtBtn'); await sleep(40);
    await clickText('#cfFmtDlg .dv-tab', 'Relleno'); await setv('#cfBg', '#ffc7ce');
    await clickSel('#cfFmtDlg .dlg-ok'); await sleep(40);
    check('C3 la vista previa muestra el formato elegido', (await ev(`getComputedStyle(document.getElementById('cfSample')).backgroundColor`)) === PINK, null);
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(60);
    check('C3 fórmula =$B3>10 escrita para la activa (A3), guardada como =$B2>10 para el ancla A2: filas de Pedro y Luis enteras', (await bgs(['A2', 'B2', 'A3', 'B3', 'A4', 'B4', 'A5', 'B5'])) === '00111100' && (await cfsJ()) === '["A2:B5|expr||=$B2>10"]', [await bgs(['A2', 'B2', 'A3', 'B3', 'A4', 'B4', 'A5', 'B5']), await cfs()]);
    await key('z', 2);
    await goto('A2:A5'); await cfMenu('Nueva regla…');
    await setv('#cfTypes', 'cell'); await setv('#cfKind', 'text'); await setv('#cfTextOp', 'beginsWith');
    await clickSel('#cfN1'); await type('pe');
    await clickSel('#cfFmtBtn'); await sleep(40); await clickText('#cfFmtDlg .dv-tab', 'Relleno'); await setv('#cfBg', '#ffc7ce'); await clickSel('#cfFmtDlg .dlg-ok'); await sleep(40);
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(60);
    check('C3 Texto específico que comienza con "pe": Pedro (no Pamela)', (await bgs(col('A', 2, 5))) === '0100', await bgs(col('A', 2, 5)));
    await key('z', 2);
    await goto('B2:B5'); await cfMenu('Nueva regla…'); await setv('#cfTypes', 'expr'); await clickSel('#cfFml'); await type('=SUMA(B2');
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(40);
    check('C3 fórmula mal escrita: el mensaje de checkFormula y el cuadro sigue abierto', !!(await msgText()) && (await isOpen('cfRuleDlg')), await msgText());
    await clickSel('#msgOk'); await sleep(30); await key('Escape'); await sleep(30);
    check('C3 Esc cierra sin crear la regla', !(await isOpen('cfRuleDlg')) && (await cfsJ()) === '[]', await cfs());
    // Celdas en blanco: se pinta una celda vacía, y al deshacer se despinta
    await goto('A6:A7'); await cfMenu('Nueva regla…'); await setv('#cfKind', 'blanks');
    await clickSel('#cfFmtBtn'); await sleep(40); await clickText('#cfFmtDlg .dv-tab', 'Relleno'); await setv('#cfBg', '#ffeb9c'); await clickSel('#cfFmtDlg .dlg-ok'); await sleep(40);
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(60);
    check('C3 Celdas en blanco pinta las celdas vacías A6 y A7', (await bg('A6')) === 'rgb(255, 235, 156)' && (await bg('A7')) === 'rgb(255, 235, 156)', await bg('A7'));
    await key('z', 2);
    check('C3 Ctrl+Z las despinta', (await bg('A7')) === NONE, await bg('A7'));
    await goto('B2:B5'); await cfMenu('Reglas superiores e inferiores', 'Más reglas…');
    check('C3 "Más reglas…" de superiores abre Nueva regla con ese tipo', (await ev(`document.getElementById('cfTypes').value`)) === 'top' && !(await ev(`document.getElementById('cfDescTop').hidden`)), await ev(`document.getElementById('cfTypes').value`));
    await setv('#cfTopDir', 'bottom'); await setv('#cfTopN', '1');
    await clickSel('#cfFmtBtn'); await sleep(40); await setv('#cfFontStyle', 'b'); await clickSel('#cfFmtDlg .dlg-ok'); await sleep(40);
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(60);
    check('C3 1 inferior en negrita: 3 (B5)', (await fw('B5')) === '700' && (await fw('B2')) === '400', [await fw('B5'), await fw('B2')]);
    await goto('B2:B5'); await cfMenu('Nueva regla…');
    await setv('#cfKind', 'value'); await setv('#cfOp', 'greaterThan');
    const b4 = await tdCenter('B4'); await clickSel('#cfN1'); await click(b4.x, b4.y);
    check('C3 Nueva regla desde la cinta: clic en B4 escribe =$B$4', (await ev(`document.getElementById('cfN1').value`)) === '=$B$4', await ev(`document.getElementById('cfN1').value`));
    await key('Escape');

    // ---------- C4: Administrador de reglas de formato condicionales ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('C1')); await paste(MONTOS);
    await goto('C2:C9'); await quick('Reglas para resaltar celdas', 'Mayor que…', '100', '3');
    await goto('C2:C9'); await cfMenu('Nueva regla…'); await setv('#cfOp', 'greaterThan'); await clickSel('#cfN1'); await type('200');
    await clickSel('#cfFmtBtn'); await sleep(40); await setv('#cfFontStyle', 'b'); await clickText('#cfFmtDlg .dv-tab', 'Relleno'); await setv('#cfBg', '#c6efce'); await clickSel('#cfFmtDlg .dlg-ok'); await sleep(40);
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(60);
    check('C4 dos reglas: > 200 (verde, negrita) arriba de > 100 (rojo claro): 300 verde y negrita, 120 rojo', (await bg('C5')) === GREEN && (await fw('C5')) === '700' && (await bg('C3')) === PINK, [await bg('C5'), await bg('C3')]);
    await clickSel(cellSel('C3'));
    await cfMenu('Administrar reglas…');
    check('C4 el Administrador muestra las reglas de la selección actual, en orden de prioridad', (await isOpen('cfMgrDlg')) && (await mgrRows()) === '*Valor de la celda > 200 @ =$C$2:$C$9 | Valor de la celda > 100 @ =$C$2:$C$9', await mgrRows());
    check('C4 columnas y botones de Excel', (await ev(`[...document.querySelectorAll('#cfTable th')].map(x => x.textContent).join('|')`)) === 'Regla (aplicada en el orden mostrado)|Formato|Se aplica a|Detener si es verdad'
      && (await ev(`[...document.querySelectorAll('#cfMgrDlg .cf-bar button, #cfMgrDlg .row button')].map(x => x.textContent).join('|')`)) === 'Nueva regla…|Editar regla…|Eliminar regla|▲|▼|Aceptar|Cancelar|Aplicar'
      && (await ev(`[...document.querySelectorAll('#cfShow option')].map(x => x.textContent).join('|')`)) === 'Selección actual|Esta hoja', null);
    check('C4 la columna Formato muestra el estilo de cada regla', (await ev(`getComputedStyle(document.querySelector('#cfTable tbody tr:nth-child(2) .cf-sample')).backgroundColor`)) === PINK, null);
    await clickSel('#cfTable tbody tr:nth-child(2) td.cf-rule');
    await clickSel('#cfUp');
    check('C4 ▲ sube > 100 a la primera prioridad', (await mgrRows()) === '*Valor de la celda > 100 @ =$C$2:$C$9 | Valor de la celda > 200 @ =$C$2:$C$9', await mgrRows());
    check('C4 sin Aplicar la hoja no cambia (300 sigue verde)', (await bg('C5')) === GREEN, await bg('C5'));
    await clickSel('#cfApply'); await sleep(60);
    check('C4 Aplicar: 300 en rojo claro (gana la de arriba) y sigue en negrita (se combina)', (await bg('C5')) === PINK && (await fw('C5')) === '700' && (await isOpen('cfMgrDlg')), [await bg('C5'), await fw('C5')]);
    await clickSel('#cfTable tbody tr:nth-child(1) .cf-stop');
    await clickSel('#cfApply'); await sleep(60);
    check('C4 "Detener si es verdad" en la primera: 300 sin negrita', (await fw('C5')) === '400' && (await mgrRows()).includes('> 100 @ =$C$2:$C$9 [stop]'), [await fw('C5'), await mgrRows()]);
    await ev(`(() => { const i = document.querySelector('#cfTable tbody tr:nth-child(1) .cf-at'); i.value = '=$C$2:$C$5'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await clickSel('#cfApply'); await sleep(60);
    check('C4 "Se aplica a" editable: =$C$2:$C$5 → 101 (C7) ya no se pinta', (await bg('C7')) === NONE && (await bg('C3')) === PINK && (await cfsJ()).startsWith('["C2:C5|cellIs|greaterThan|100"'), [await bg('C7'), await cfs()]);
    await ev(`(() => { const i = document.querySelector('#cfTable tbody tr:nth-child(1) .cf-at'); i.value = 'xyz'; })()`);
    await clickSel('#cfMgrDlg .dlg-ok'); await sleep(40);
    check('C4 "Se aplica a" no válido: mensaje y el cuadro sigue abierto', (await msgText()) === 'Referencia no válida.' && (await isOpen('cfMgrDlg')), await msgText());
    await clickSel('#msgOk'); await sleep(30);
    await ev(`(() => { const i = document.querySelector('#cfTable tbody tr:nth-child(1) .cf-at'); i.value = '=$C$2:$C$5'; })()`);
    // Editar regla con doble clic real
    const r2 = await ev(`(() => { const r = document.querySelector('#cfTable tbody tr:nth-child(2) td.cf-rule').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
    await click(r2.x, r2.y); await click(r2.x, r2.y, { clickCount: 2 }); await sleep(60);
    check('C4 doble clic: "Editar regla de formato" con los valores de la regla', (await isOpen('cfRuleDlg')) && (await ev(`document.querySelector('#cfRuleDlg h3').textContent + '|' + document.getElementById('cfOp').value + '|' + document.getElementById('cfN1').value`)) === 'Editar regla de formato|greaterThan|200', await ev(`document.querySelector('#cfRuleDlg h3') && document.querySelector('#cfRuleDlg h3').textContent`));
    await clickSel('#cfN1'); await ev(`document.getElementById('cfN1').select()`); await type('280');
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(40);
    check('C4 la regla editada se ve en la lista', (await mgrRows()).includes('Valor de la celda > 280 @ =$C$2:$C$9'), await mgrRows());
    await clickSel('#cfNew'); await sleep(40);
    await setv('#cfKind', 'blanks'); await clickSel('#cfFmtBtn'); await sleep(40); await clickText('#cfFmtDlg .dv-tab', 'Relleno'); await setv('#cfBg', '#ffeb9c'); await clickSel('#cfFmtDlg .dlg-ok'); await sleep(40);
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(40);
    check('C4 Nueva regla desde el Administrador: arriba de todo, para la selección (C3)', (await mgrRows()).startsWith('*Celdas en blanco @ =$C$3 |'), await mgrRows());
    await clickSel('#cfDel');
    check('C4 Eliminar regla la quita de la lista', !(await mgrRows()).includes('Celdas en blanco'), await mgrRows());
    await clickSel('#cfMgrDlg .dlg-ok'); await sleep(60);
    check('C4 Aceptar guarda y cierra: 250 ya no es verde (> 280)', !(await isOpen('cfMgrDlg')) && (await bg('C9')) === NONE && (await cfsJ()) === '["C2:C5|cellIs|greaterThan|100","C2:C9|cellIs|greaterThan|280"]', [await bg('C9'), await cfs()]);
    await key('z', 2);
    check('C4 Ctrl+Z deshace lo aplicado en el último Aceptar (en un paso)', (await cfsJ()) === '["C2:C5|cellIs|greaterThan|100","C2:C9|cellIs|greaterThan|200"]', await cfs());
    await key('y', 2);
    await cfMenu('Administrar reglas…');
    await clickSel('#cfTable tbody tr:nth-child(1) td.cf-rule'); await clickSel('#cfDel');
    await clickSel('#cfMgrDlg .dlg-cancel'); await sleep(60);
    check('C4 Cancelar descarta lo no aplicado', (await cfsJ()) === '["C2:C5|cellIs|greaterThan|100","C2:C9|cellIs|greaterThan|280"]', await cfs());
    await clickSel(cellSel('A1'));
    await cfMenu('Administrar reglas…');
    check('C4 con la selección fuera de las reglas, "Selección actual" está vacía; "Esta hoja" las muestra', (await mgrRows()) === '' && (await (async () => { await setv('#cfShow', 'sheet'); return mgrRows(); })()) === '*Valor de la celda > 100 @ =$C$2:$C$5 [stop] | Valor de la celda > 280 @ =$C$2:$C$9', await mgrRows());
    await clickSel('#cfMgrDlg .dlg-cancel');
    await clickSel('.tab.add'); await clickSel(cellSel('A1')); await write('5');
    await goto('A1'); await quick('Reglas para resaltar celdas', 'Mayor que…', '1', '3');
    await clickText('.tab', 'Hoja1'); await clickSel(cellSel('A1'));
    await cfMenu('Administrar reglas…');
    check('C4 "Mostrar reglas de formato para:" incluye la otra hoja y muestra sus reglas', (await ev(`[...document.querySelectorAll('#cfShow option')].map(x => x.textContent).join('|')`)) === 'Selección actual|Esta hoja|Hoja2'
      && (await (async () => { await setv('#cfShow', 's1'); return mgrRows(); })()) === '*Valor de la celda > 1 @ =$A$1', await mgrRows());
    await clickSel('#cfMgrDlg .dlg-cancel');

    // ---------- C5: matriz operaciones × sheet.cf ----------
    await open(); await captureConfirm();
    await clickSel(cellSel('C1')); await paste(MONTOS);
    await clickSel(cellSel('C1')); await key('2', 2);   // encabezado en negrita: ordenar lo detecta
    await goto('C2:C9'); await quick('Reglas para resaltar celdas', 'Mayor que…', '100', '3');
    await clickSel(cellSel('A1')); await key(' ', 8); await clickSel("button[data-cmd='ins-row']");
    check('C5 insertar una fila arriba: la regla pasa a C3:C10 y sigue pintando 120, 300, 101, 250', (await cfsJ()) === '["C3:C10|cellIs|greaterThan|100"]' && (await bgs(col('C', 3, 10))) === '01010101', [await cfs(), await bgs(col('C', 3, 10))]);
    await key('z', 2);
    check('C5 Ctrl+Z la devuelve a C2:C9', (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]', await cfs());
    await clickSel(cellSel('A3')); await key(' ', 8); await clickSel("button[data-cmd='del-row']");
    check('C5 eliminar la fila 3 (120): la regla queda en C2:C8', (await cfsJ()) === '["C2:C8|cellIs|greaterThan|100"]' && (await bgs(col('C', 2, 8))) === '0010101', [await cfs(), await bgs(col('C', 2, 8))]);
    await key('z', 2);
    await clickSel(cellSel('C2')); await clickSel("button[data-cmd='sort-desc']");
    check('C5 ordenar Z→A: los valores se mueven, la regla se queda con sus celdas y pinta las cuatro primeras', (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]' && (await bgs(C29)) === '11110000', [await cfs(), await bgs(C29)]);
    await key('z', 2);
    await clickSel(cellSel('C3')); await key('Delete');
    check('C5 Supr borra el valor y deja la regla', (await val('C3')) === '' && (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]', await cfs());
    await key('z', 2);
    await clickSel(cellSel('C4')); await clickSel("button[data-cmd='clearfmt']");
    check('C5 Borrar formato quita el formato condicional de C4 (la regla se parte)', (await cfsJ()) === '["C2:C3 C5:C9|cellIs|greaterThan|100"]', await cfs());
    await key('z', 2);
    check('C5 Ctrl+Z lo devuelve en un paso', (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]', await cfs());
    await clickSel(cellSel('C5')); await clickSel(cellSel('C5'), { button: 'right' }); await ev("Q.menu('Borrar todo')");
    check('C5 Borrar todo quita valor y formato condicional de C5', (await val('C5')) === '' && (await cfsJ()) === '["C2:C4 C6:C9|cellIs|greaterThan|100"]', await cfs());
    await key('z', 2);
    await goto('C2:C9'); const copied = await clipEv('copy');
    await clickSel(cellSel('E2')); await paste(copied);   // el mismo texto que se copió: pegado interno (con las reglas)
    check('C5 copiar y pegar: la misma regla se extiende a E2:E9 (una sola regla)', (await cfsJ()) === '["C2:C9 E2:E9|cellIs|greaterThan|100"]' && (await bg('E3')) === PINK, [await cfs(), await bg('E3')]);
    await key('z', 2);
    check('C5 Ctrl+Z del pegado quita valores y regla', (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]' && (await val('E3')) === '', await cfs());
    await goto('C2:C9'); await clipEv('copy');
    await clickSel(cellSel('G2')); await clickSel(cellSel('G2'), { button: 'right' }); await ev("Q.menu('Pegar valores')");
    check('C5 Pegar valores no lleva el formato condicional', (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]' && (await val('G3')) === '120', await cfs());
    await clickSel(cellSel('I2')); await clickSel(cellSel('I2'), { button: 'right' }); await ev("Q.menu('Pegar formato')");
    check('C5 Pegar formato sí lo lleva (I2:I9)', (await cfsJ()) === '["C2:C9 I2:I9|cellIs|greaterThan|100"]', await cfs());
    await key('z', 2); await key('z', 2);
    await goto('C9:C11'); await key('j', 2);
    check('C5 Ctrl+J rellena hacia abajo la regla (C2:C11)', (await cfsJ()) === '["C2:C11|cellIs|greaterThan|100"]' && (await bg('C11')) === PINK, [await cfs(), await bg('C11')]);
    await key('z', 2);
    await goto('C2:C9'); const cutText = await clipEv('cut');
    await clickSel(cellSel('K2')); await paste(cutText);
    check('C5 cortar y pegar mueve la regla (K2:K9) y C queda sin reglas', (await cfsJ()) === '["K2:K9|cellIs|greaterThan|100"]' && (await bg('K3')) === PINK && (await bg('C3')) === NONE, [await cfs(), await bg('K3')]);
    await key('z', 2);
    check('C5 Ctrl+Z la devuelve a C2:C9', (await cfsJ()) === '["C2:C9|cellIs|greaterThan|100"]', await cfs());
    await goto('C4'); await cfMenu('Borrar reglas', 'Borrar reglas de las celdas seleccionadas');
    check('C5 Borrar reglas de las celdas seleccionadas (C4)', (await cfsJ()) === '["C2:C3 C5:C9|cellIs|greaterThan|100"]', await cfs());
    await key('z', 2);
    // combinación, paneles inmovilizados, filas ocultas y una fila lejana (grilla virtualizada)
    await goto('C3:D3'); await clickSel("button[data-cmd='merge']");
    check('C5 una combinación con regla: la capa de la combinación se pinta', (await ev(`(() => { const d = [...document.querySelectorAll('#mergeLayer div')].find(x => x.textContent === '120'); return d ? getComputedStyle(d).backgroundColor : null; })()`)) === PINK, null);
    await key('z', 2);
    await goto('A300'); await write('500'); await goto('A2:A400'); await quick('Reglas para resaltar celdas', 'Mayor que…', '100', '3');
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='freeze']"); await clickText('#menu div', 'Inmovilizar fila superior');
    await goto('A300'); await sleep(80);
    check('C5 con paneles inmovilizados y fila 300 (fuera del primer dibujo): A300 se pinta', (await bg('A300')) === PINK, await bg('A300'));
    await goto('A4'); await key(' ', 8); await clickSel("button[data-cmd='ins-row']"); await key('z', 2);
    await clickSel(cellSel('C4')); await clickSel(cellSel('C4'), { button: 'right' }); await ev("Q.menu('Ocultar filas')");
    check('C5 con la fila 4 oculta, las demás siguen pintadas (C5 = 300)', (await bg('C5')) === PINK && (await bg('C3')) === PINK, await bg('C5'));
    // imprimir: la vista de impresión lleva el formato condicional
    await ev(`window.__printDoc = null; Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', { set(v) { window.__printDoc = v; }, configurable: true }); 1`);
    await goto('C2:C9'); await clickSel("button[data-cmd='print']"); await sleep(60);
    check('C5 imprimir lleva el relleno del formato condicional', (await ev(`(window.__printDoc || '').includes('background:#ffc7ce')`)), null);
    // fórmula con otra hoja + renombrar, duplicar, .bassx y .xlsx
    await clickSel('.tab.add'); await clickSel(cellSel('A1')); await write('1');
    await clickText('.tab', 'Hoja1');
    await goto('E2:E3'); await cfMenu('Nueva regla…'); await setv('#cfTypes', 'expr'); await clickSel('#cfFml'); await type('=Hoja2!$A$1>0');
    await clickSel('#cfFmtBtn'); await sleep(40); await clickText('#cfFmtDlg .dv-tab', 'Relleno'); await setv('#cfBg', '#ffc7ce'); await clickSel('#cfFmtDlg .dlg-ok'); await sleep(40);
    await clickSel('#cfRuleDlg .dlg-ok'); await sleep(60);
    check('C5 fórmula con otra hoja (=Hoja2!$A$1>0) pinta E2', (await bg('E2')) === PINK, await bg('E2'));
    await ev(`window.prompt = () => 'Datos'; 1`);
    await clickText('.tab', 'Hoja2');
    await click(...Object.values(await ev(`(() => { const r = document.querySelector('.tab.on').getBoundingClientRect(); return { x: r.left + 10, y: r.top + 8 }; })()`)), { clickCount: 2 });
    await clickText('.tab', 'Hoja1');
    check('C5 renombrar la hoja actualiza la fórmula de la regla (=Datos!$A$1>0)', (await cfs()).some(x => x.endsWith('|expr||=Datos!$A$1>0')) && (await bg('E2')) === PINK, await cfs());
    await clickSel('.tab.on', { button: 'right' }); await ev("Q.menu('Duplicar hoja')"); await sleep(60);
    check('C5 duplicar la hoja copia las reglas (C3 pintada en la copia)', (await ev(`document.querySelector('.tab.on').textContent`)) === 'Hoja1 (2)' && (await bg('C3')) === PINK, await bg('C3'));
    await clickText('.tab', 'Hoja1');
    await sleep(600);
    await open(false);
    check('C5 .bassx (autoguardado y recarga): las reglas siguen y pintan', (await cfs()).includes('C2:C9|cellIs|greaterThan|100') && (await bg('C3')) === PINK, await cfs());
    await ev(`window.__book = null; XLSX.writeFile = bk => { window.__book = bk; }; 1`);
    await clickSel("button[data-cmd='xlsx']");
    check('C5 exportar .xlsx avisa que se pierde el formato condicional', (await isOpen('msgDlg')) && (await msgText() || '').startsWith('Este libro tiene formato condicional y Bassxcel todavía no lo guarda en .xlsx'), await msgText());
    await clickSel('#msgCancel');
    check('C5 Cancelar en el aviso no exporta', (await ev('window.__book === null')), null);
    await clickSel("button[data-cmd='xlsx']"); await clickSel('#msgOk'); await sleep(100);
    check('C5 Aceptar exporta igual', (await ev('!!window.__book')), null);

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

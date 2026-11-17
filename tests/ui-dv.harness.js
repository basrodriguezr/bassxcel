'use strict';
// Arnés de Chrome headless de la ronda 5c de grid-ui-dev: Validación de datos (Datos ▸ Herramientas de datos), con el
// validador puro (window.__bxDv.check), el cuadro de tres pestañas, la lista desplegable (▾, Alt+↓, ↑/↓, Enter, Esc),
// el mensaje de entrada, los mensajes de error (Detener, Advertencia, Información) y la matriz operaciones × sheet.dv
// (insertar/eliminar, copiar/pegar, rellenar, cortar, Supr, Borrar formato, Borrar todo, ordenar, hojas, .bassx, .xlsx).
// Uso: node tests/ui-dv.harness.js [--web=<carpeta>]   (sale con código 1 si alguna aserción falla)
// Entrada real por CDP (clics, teclas, Alt+↓, doble clic en la pestaña, clic derecho: L-031). Lecturas: el modelo
// autoguardado (Q.sheet(), 400 ms después del cambio), el texto pintado (Q.t) y el DOM de los cuadros. Cada grupo abre un
// libro nuevo (L-039) y fija la selección antes de cada gesto (L-054). Complementa la receta REA UI-47.
const { launch, reporter, sleep } = require('./cdp');

(async () => {
  const b = await launch({ port: 8775, cdpPort: 9343 });
  console.log('web: ' + b.web);
  const { check, done } = reporter();
  const { ev, key, type, click, clickSel, clickText, cellSel, open } = b;
  const nb = () => ev('Q.nb()');
  const t = a => ev(`Q.t(${JSON.stringify(a)})`);
  const goto = async ref => { await ev(`(() => { const n = document.getElementById('nameBox'); n.value = ${JSON.stringify(ref)}; n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`); await sleep(50); };
  const paste = text => ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  const clipEv = kind => ev(`(() => { const dt = new DataTransfer(); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent(${JSON.stringify(kind)}, { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData('text/plain'); })()`);
  const captureConfirm = () => ev(`window.confirm = () => true; window.alert = m => console.log('ALERT ' + m); 1`);
  const isOpen = id => ev(`!!(document.getElementById(${JSON.stringify(id)}) && document.getElementById(${JSON.stringify(id)}).open)`);
  const msgText = () => ev(`document.getElementById('msgText').textContent`);
  const val = (a, delay = 550) => sleep(delay).then(() => ev(`(() => { const c = Q.sheet().cells[${JSON.stringify(a)}]; return c ? c.v : ''; })()`));
  // reglas del modelo autoguardado como texto: "B2:B10|list|Sí;No" (rangos separados por espacio; f1, f2 u origen)
  const dvs = async () => {
    await sleep(550);
    return ev(`(() => { const L = (r, c) => { let s = '', n = c + 1; while (n) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s + (r + 1); };
      return (Q.sheet().dv || []).map(d => d.ranges.map(g => g.r1 === g.r2 && g.c1 === g.c2 ? L(g.r1, g.c1) : L(g.r1, g.c1) + ':' + L(g.r2, g.c2)).join(' ') + '|' + d.type + '|' + (d.type === 'list' ? d.list : [d.f1, d.f2].filter(Boolean).join(';'))); })()`);
  };
  const pure = (rule, raw, at = 'A1') => ev(`__bxDv.check(${JSON.stringify(rule)}, ${JSON.stringify(raw)}, ${JSON.stringify(at)})`);
  const setv = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return e.value; })()`);
  const tick = (sel, on) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e.checked !== ${on}) e.click(); return e.checked; })()`);
  // Datos ▸ "Validación de datos" ▾ ▸ "Validación de datos…" (clics reales)
  const openDlg = async () => { await clickSel("button[data-cmd='dv']"); await clickText('#menu div', 'Validación de datos…'); await sleep(50); };
  const errText = () => ev(`(() => { const d = document.getElementById('dvErrDlg'); return d && d.open ? d.querySelector('h3').textContent + ' / ' + document.getElementById('dvErrText').textContent + ' / ' + [...d.querySelectorAll('.row button')].map(x => x.textContent).join('|') : null; })()`);
  const edState = () => ev(`(() => { const e = document.getElementById('cellEditor'); return { on: getComputedStyle(e).display !== 'none', v: e.value, s: e.selectionStart, e: e.selectionEnd, f: document.activeElement === e }; })()`);
  const listText = () => ev(`(() => { const l = document.getElementById('dvList'); return l ? [...l.children].map(x => (x.classList.contains('on') ? '*' : '') + x.textContent).join('|') : null; })()`);
  const btnAt = async a => {
    const r = await ev(`(() => { const b = document.getElementById('dvBtn'); if (getComputedStyle(b).display === 'none') return null; return { b: Q.R(b), td: Q.R(Q.td(${JSON.stringify(a)})) }; })()`);
    return !!r && Math.abs(r.b.l - (r.td.l + r.td.w)) <= 2 && Math.abs(r.b.t + r.b.h - (r.td.t + r.td.h)) <= 2;
  };
  const btnShown = () => ev(`getComputedStyle(document.getElementById('dvBtn')).display !== 'none'`);
  const tip = () => ev(`(() => { const e = document.getElementById('dvTip'); return getComputedStyle(e).display === 'none' ? null : e.textContent; })()`);
  // escribir como una persona en la celda activa (la tecla final confirma)
  const write = async (text, end = 'Enter') => { await type(text); await key(end); await sleep(30); };
  const LISTSINO = async (ref, more) => {
    await goto(ref); await openDlg();
    await setv('#dvType', 'list');
    await clickSel('#dvSrc'); await type('Sí;No');
    if (more) await more();
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
  };
  const MSG = 'Este valor no coincide con las restricciones de validación de datos definidas para esta celda.';

  try {
    // ---------- V0: validador puro (dvCheck) ----------
    await open();
    const W = { type: 'whole', op: 'between', f1: '1', f2: '10' };
    check('V0 entero entre 1 y 10: 5 pasa, 10 pasa, 11 y 0 no', (await pure(W, '5')) && (await pure(W, '10')) && !(await pure(W, '11')) && !(await pure(W, '0')), null);
    check('V0 entero: 5,5 no es entero (es-CL) y abc no es número', !(await pure(W, '5,5')) && !(await pure(W, 'abc')), null);
    check('V0 vacío con "Omitir blancos" pasa; sin la casilla, no', (await pure(W, '')) && !(await pure({ ...W, allowBlank: false }, '')), null);
    const D = { type: 'decimal', op: 'between', f1: '1', f2: '2' };
    check('V0 decimal entre 1 y 2 con 1,5 pasa; 2,5 no', (await pure(D, '1,5')) && !(await pure(D, '2,5')), null);
    check('V0 decimal mayor que 1,5: 1,6 pasa, 1,5 no', (await pure({ type: 'decimal', op: 'greaterThan', f1: '1,5' }, '1,6')) && !(await pure({ type: 'decimal', op: 'greaterThan', f1: '1,5' }, '1,5')), null);
    const F = { type: 'date', op: 'between', f1: '01/01/2026', f2: '31/12/2026' };
    check('V0 fecha entre 01/01/2026 y 31/12/2026: 15/06/2026 pasa; 01/01/2027 y abc no', (await pure(F, '15/06/2026')) && !(await pure(F, '01/01/2027')) && !(await pure(F, 'abc')), null);
    const H = { type: 'time', op: 'between', f1: '08:00', f2: '18:00' };
    check('V0 hora entre 08:00 y 18:00: 14:30 pasa; 19:00 no', (await pure(H, '14:30')) && !(await pure(H, '19:00')), null);
    const LN = { type: 'length', op: 'lessThanOrEqual', f1: '3' };
    check('V0 longitud del texto ≤ 3: abc pasa; abcd no; 1234 (número) no', (await pure(LN, 'abc')) && !(await pure(LN, 'abcd')) && !(await pure(LN, '1234')), null);
    check('V0 no está entre 1 y 10: 11 pasa, 5 no · igual a 3 · no igual a 3', (await pure({ type: 'whole', op: 'notBetween', f1: '1', f2: '10' }, '11')) && !(await pure({ type: 'whole', op: 'notBetween', f1: '1', f2: '10' }, '5'))
      && (await pure({ type: 'whole', op: 'equal', f1: '3' }, '3')) && !(await pure({ type: 'whole', op: 'notEqual', f1: '3' }, '3')), null);
    const LS = { type: 'list', list: 'Sí;No' };
    check('V0 lista Sí;No: Sí y No pasan; Quizás no', (await pure(LS, 'Sí')) && (await pure(LS, 'No')) && !(await pure(LS, 'Quizás')), null);
    check('V0 lista sin distinguir mayúsculas: "no" y "SÍ" pasan (decisión por confirmar)', (await pure(LS, 'no')) && (await pure(LS, 'SÍ')), null);
    await clickSel(cellSel('E1')); await paste('Rojo\r\nVerde\r\nAzul');
    await clickSel(cellSel('C1')); await write('1'); await write('3');
    const LR = { type: 'list', list: '=$E$1:$E$3' };
    check('V0 lista con origen =$E$1:$E$3: verde pasa; Negro no', (await pure(LR, 'verde')) && !(await pure(LR, 'Negro')), null);
    const WR = { type: 'whole', op: 'between', f1: '=C1', f2: '=C2' };
    check('V0 Mínimo y Máximo con referencias (=C1 = 1, =C2 = 3): 2 pasa; 4 no', (await pure(WR, '2')) && !(await pure(WR, '4')), null);
    await clickSel(cellSel('A1')); await write('5');
    const CU = { type: 'custom', f1: '=A1>0' };
    check('V0 Personalizada =A1>0 en B1 con A1 = 5: pasa', await pure(CU, 'x', 'B1'), null);
    await clickSel(cellSel('A1')); await write('-1');
    check('V0 Personalizada =A1>0 en B1 con A1 = -1: no pasa', !(await pure(CU, 'x', 'B1')), null);
    check('V0 Personalizada relativa: =A1>0 anclada en B1 se mira como =A2>0 en B2 (A2 vacía → 0 > 0 no)', !(await pure({ ...CU, ranges: [{ r1: 0, c1: 1, r2: 1, c2: 1 }] }, 'x', 'B2')), null);
    // otra hoja y un nombre definido
    await goto('E1:E3'); await goto('Colores');
    check('V0 lista con un nombre definido (=Colores): Azul pasa', await pure({ type: 'list', list: '=Colores' }, 'Azul'), null);
    await clickSel('.tab.add');
    await clickSel(cellSel('A1')); await paste('x\r\ny\r\nz');
    await clickText('.tab', 'Hoja1');
    check('V0 lista con origen en otra hoja (=Hoja2!$A$1:$A$3): y pasa; w no', (await pure({ type: 'list', list: '=Hoja2!$A$1:$A$3' }, 'y')) && !(await pure({ type: 'list', list: '=Hoja2!$A$1:$A$3' }, 'w')), null);
    check('V0 Cualquier valor: todo pasa', await pure({ type: 'any' }, 'lo que sea'), null);

    // ---------- V1: aceptación del backlog (B2:B10 lista Sí;No; Alt+↓, ↓, Enter; Quizás → Detener; Reintentar; Cancelar) ----------
    await open(); await captureConfirm();
    await goto('B2:B10'); await openDlg();
    check('V1 el cuadro "Validación de datos" se abre con sus tres pestañas', (await isOpen('dvDlg')) && (await ev(`[...document.querySelectorAll('#dvDlg .dv-tab')].map(x => x.textContent).join('/')`)) === 'Configuración/Mensaje de entrada/Mensaje de error', await ev(`[...document.querySelectorAll('#dvDlg .dv-tab')].map(x => x.textContent).join('/')`));
    check('V1 Permitir lista los 8 tipos y Datos los 8 operadores', (await ev(`[...document.querySelectorAll('#dvType option')].map(x => x.textContent).join('/')`)) === 'Cualquier valor/Número entero/Decimal/Lista/Fecha/Hora/Longitud del texto/Personalizada'
      && (await ev(`[...document.querySelectorAll('#dvOp option')].map(x => x.textContent).join('/')`)) === 'entre/no está entre/igual a/no igual a/mayor que/menor que/mayor o igual que/menor o igual que', null);
    check('V1 el foco empieza en Permitir; botones Borrar todos / Aceptar / Cancelar', (await ev('document.activeElement.id')) === 'dvType' && (await ev(`[...document.querySelectorAll('#dvDlg .row button')].map(x => x.textContent).join('/')`)) === 'Borrar todos/Aceptar/Cancelar', await ev('document.activeElement.id'));
    await setv('#dvType', 'list');
    check('V1 Lista: Origen y "Celda con lista desplegable" (marcada); sin Datos ni Mínimo', (await ev(`!document.getElementById('dvSrcL').hidden && !document.getElementById('dvInCellL').hidden && document.getElementById('dvInCell').checked && document.getElementById('dvOpL').hidden && document.getElementById('dvF1L').hidden`)), null);
    await clickSel('#dvSrc'); await type('Sí;No');
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    check('V1 la regla queda en el modelo: B2:B10, lista Sí;No', JSON.stringify(await dvs()) === '["B2:B10|list|Sí;No"]', await dvs());
    await clickSel(cellSel('B2'));
    check('V1 ▾ a la derecha de B2 al seleccionarla', await btnAt('B2'), null);
    await clickSel(cellSel('C2'));
    check('V1 sin ▾ en C2 (fuera de la regla)', !(await btnShown()), null);
    await clickSel(cellSel('B2'));
    await key('ArrowDown', 1);
    check('V1 Alt+↓ abre la lista con Sí marcado', (await listText()) === '*Sí|No', await listText());
    await key('ArrowDown');
    check('V1 ↓ marca No', (await listText()) === 'Sí|*No', await listText());
    await key('Enter');
    check('V1 Enter elige: B2 = "No", la lista se cierra y la activa sigue en B2', (await val('B2')) === 'No' && (await listText()) === null && (await nb()) === 'B2', { v: await val('B2'), l: await listText(), nb: await nb() });
    await key('z', 2);
    check('V1 Ctrl+Z deshace la elección (un paso)', (await val('B2')) === '', await val('B2'));
    await key('y', 2);
    check('V1 Ctrl+Y la rehace', (await val('B2')) === 'No', await val('B2'));
    await clickSel(cellSel('B2')); await key('ArrowDown', 1);
    check('V1 al reabrir, la lista marca el valor actual (No)', (await listText()) === 'Sí|*No', await listText());
    await key('Escape');
    check('V1 Esc cierra la lista sin cambiar B2', (await listText()) === null && (await val('B2')) === 'No', await listText());
    await clickSel('#dvBtn');
    check('V1 clic en ▾ abre la lista', (await listText()) === 'Sí|*No', await listText());
    await clickText('#dvList div', 'Sí');
    check('V1 clic en Sí lo elige', (await val('B2')) === 'Sí' && (await listText()) === null, await val('B2'));
    await clickSel(cellSel('B3')); await write('Quizás');
    check('V1 Quizás en B3: mensaje Detener con el título y el texto de Excel', (await errText()) === `Bassxcel / ${MSG} / Reintentar|Cancelar`, await errText());
    check('V1 mientras tanto la celda sigue en edición', (await edState()).on, await edState());
    await clickSel('#dvErrDlg .dlg-ok');
    const re = await edState();
    check('V1 Reintentar vuelve a editar con "Quizás" seleccionado', re.on && re.f && re.v === 'Quizás' && re.s === 0 && re.e === 6, re);
    await type('Sí'); await key('Enter');
    check('V1 lo escrito reemplaza la selección: B3 = Sí y la activa baja a B4', (await val('B3')) === 'Sí' && (await nb()) === 'B4', { v: await val('B3'), nb: await nb() });
    await write('Quizás');
    await clickSel('#dvErrDlg .dlg-cancel');
    check('V1 Cancelar descarta: B4 vacía, sin editor y la activa sigue en B4', (await val('B4')) === '' && !(await edState()).on && (await nb()) === 'B4', { v: await val('B4'), nb: await nb() });
    await clickSel(cellSel('B5')); await write('no');
    check('V1 "no" (minúsculas) se acepta y se guarda como se escribió', (await val('B5')) === 'no' && !(await isOpen('dvErrDlg')), await val('B5'));
    await clickSel(cellSel('B6')); await type('Quizás'); await key('Escape');
    await clickSel(cellSel('B6')); await type('Quizás');
    await clickSel(cellSel('D6'));
    check('V1 clic en otra celda con un valor no válido: mensaje y la selección no se mueve', (await isOpen('dvErrDlg')) && (await edState()).on, await errText());
    await key('Escape');
    check('V1 Esc en el mensaje = Cancelar (B6 vacía, activa B6)', !(await isOpen('dvErrDlg')) && (await val('B6')) === '' && (await nb()) === 'B6', { nb: await nb() });
    await clickSel(cellSel('B7')); await paste('Quizás');
    check('V1 pegar no valida (como Excel): B7 = Quizás', (await val('B7')) === 'Quizás' && !(await isOpen('dvErrDlg')), await val('B7'));
    await clickSel(cellSel('B11')); await write('Quizás');
    check('V1 fuera del rango (B11) no hay validación', (await val('B11')) === 'Quizás' && !(await isOpen('dvErrDlg')), await val('B11'));
    await goto('B8:B9'); await type('Quizás'); await key('Enter', 2);
    check('V1 Ctrl+Enter también valida (mensaje Detener)', (await errText()) === `Bassxcel / ${MSG} / Reintentar|Cancelar`, await errText());
    await clickSel('#dvErrDlg .dlg-cancel');
    check('V1 Ctrl+Enter cancelado no escribe nada', (await val('B8')) === '' && (await val('B9', 0)) === '', null);
    await goto('B8:B9'); await type('No'); await key('Enter', 2);
    check('V1 Ctrl+Enter válido escribe en toda la selección', (await val('B8')) === 'No' && (await val('B9', 0)) === 'No', null);

    // ---------- V2: el cuadro: reabrir, etiquetas, revisión al aceptar, Borrar todos, deshacer ----------
    await clickSel(cellSel('B2')); await openDlg();
    check('V2 al reabrir muestra la regla de la celda (Lista, Sí;No, casillas marcadas)', (await ev(`[document.getElementById('dvType').value, document.getElementById('dvSrc').value, document.getElementById('dvBlank').checked, document.getElementById('dvInCell').checked, document.getElementById('dvAll').disabled].join('/')`)) === 'list/Sí;No/true/true/false', await ev(`[document.getElementById('dvType').value, document.getElementById('dvSrc').value].join('/')`));
    await key('Escape');
    check('V2 Esc cierra sin cambios y el foco vuelve a la grilla', !(await isOpen('dvDlg')) && JSON.stringify(await dvs()) === '["B2:B10|list|Sí;No"]' && (await ev('document.activeElement.id')) === 'gridWrap', await dvs());
    await goto('C2:C5'); await openDlg();
    await setv('#dvType', 'date');
    check('V2 Fecha: etiquetas "Fecha de inicio:" y "Fecha de finalización:"', (await ev(`document.getElementById('dvF1T').textContent + document.getElementById('dvF2T').textContent`)) === 'Fecha de inicio:Fecha de finalización:', null);
    await setv('#dvType', 'whole'); await setv('#dvOp', 'greaterThan');
    check('V2 Número entero mayor que: un solo campo "Mínimo:"', (await ev(`document.getElementById('dvF1T').textContent + '|' + document.getElementById('dvF2L').hidden`)) === 'Mínimo:|true', null);
    await setv('#dvOp', 'between');
    await setv('#dvF1', '10'); await setv('#dvF2', '1');
    await clickSel('#dvDlg .dlg-ok');
    check('V2 Mínimo > Máximo: mensaje y el cuadro sigue abierto', (await isOpen('msgDlg')) && (await msgText()) === 'El valor Máximo debe ser mayor o igual que el valor Mínimo.' && (await isOpen('dvDlg')), await msgText());
    await clickSel('#msgOk'); await sleep(50);
    check('V2 tras el mensaje, el foco vuelve a Máximo', (await ev('document.activeElement.id')) === 'dvF2', await ev('document.activeElement.id'));
    await setv('#dvF1', ''); await clickSel('#dvDlg .dlg-ok');
    check('V2 Mínimo vacío: mensaje', (await isOpen('msgDlg')) && (await msgText()) === 'Debe escribir un valor en "Mínimo".', await msgText());
    await clickSel('#msgOk');
    await setv('#dvF1', '1'); await setv('#dvF2', '10');
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    check('V2 entero entre 1 y 10 en C2:C5', (await dvs()).includes('C2:C5|whole|1;10'), await dvs());
    await key('z', 2);
    check('V2 Ctrl+Z deshace la regla nueva', !(await dvs()).some(x => x.startsWith('C2')), await dvs());
    await key('y', 2);
    check('V2 Ctrl+Y la rehace', (await dvs()).includes('C2:C5|whole|1;10'), await dvs());
    await clickSel(cellSel('C2')); await write('5');
    check('V2 entero: 5 se acepta en C2', (await val('C2')) === '5' && !(await isOpen('dvErrDlg')), await val('C2'));
    await clickSel(cellSel('C3')); await write('5,5');
    check('V2 entero: 5,5 → mensaje Detener', (await errText()) === `Bassxcel / ${MSG} / Reintentar|Cancelar`, await errText());
    await clickSel('#dvErrDlg .dlg-cancel');
    await clickSel(cellSel('C3')); await openDlg();
    await clickSel('#dvClear');
    check('V2 "Borrar todos" vuelve a Cualquier valor (y deshabilita Omitir blancos)', (await ev(`document.getElementById('dvType').value + '|' + document.getElementById('dvBlank').disabled + '|' + document.getElementById('dvF1L').hidden`)) === 'any|true|true', null);
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    check('V2 Aceptar tras Borrar todos quita la validación solo de C3', (await dvs()).filter(x => x.includes('whole')).join() === 'C2 C4:C5|whole|1;10', await dvs());
    await key('z', 2);
    // extender a celdas sin validación (B10:B11) y "Aplicar estos cambios a otras celdas con la misma configuración"
    await goto('B10:B11'); await openDlg();
    check('V2 selección con celdas sin validación: Excel pregunta si se extiende', (await isOpen('dvAskDlg')) && (await ev(`document.querySelector('#dvAskDlg p').textContent`)) === 'La selección contiene algunas celdas sin configuración de validación de datos. ¿Desea extender la validación a estas celdas?', await ev(`document.querySelector('#dvAskDlg p') && document.querySelector('#dvAskDlg p').textContent`));
    await clickSel('#dvAskDlg .dlg-ok'); await sleep(50);
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    check('V2 Sí y Aceptar: la regla se extiende a B2:B11 (una sola regla)', (await dvs()).filter(x => x.includes('list')).join() === 'B2:B11|list|Sí;No', await dvs());
    await clickSel(cellSel('B2')); await openDlg();
    await setv('#dvSrc', 'Sí;No;Tal vez'); await tick('#dvAll', true);
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    check('V2 "Aplicar estos cambios a otras celdas…" cambia toda la regla', (await dvs()).filter(x => x.includes('list')).join() === 'B2:B11|list|Sí;No;Tal vez', await dvs());
    await key('z', 2);
    await clickSel(cellSel('B2')); await openDlg();
    await setv('#dvSrc', 'Sí;No;Tal vez');
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    check('V2 sin la casilla, solo cambia la selección (B2)', (await dvs()).filter(x => x.includes('list')).join() === 'B3:B11|list|Sí;No,B2|list|Sí;No;Tal vez', await dvs());
    await key('z', 2);
    await goto('B2:C2'); await openDlg();
    check('V2 selección sobre dos reglas distintas: pregunta si se borra la configuración', (await ev(`document.querySelector('#dvAskDlg p').textContent`)) === 'La selección contiene más de un tipo de validación. ¿Desea borrar la configuración actual y continuar?', null);
    await clickSel('#dvAskDlg .dlg-cancel');
    check('V2 No: no abre el cuadro', !(await isOpen('dvDlg')), null);

    // ---------- V3: mensaje de entrada y estilos de error ----------
    await open(); await captureConfirm();
    await LISTSINO('B2:B5', async () => {
      await clickText('#dvDlg .dv-tab', 'Mensaje de entrada');
      await setv('#dvInTitle', 'Respuesta'); await setv('#dvInMsg', 'Elija Sí o No');
    });
    await clickSel(cellSel('B3'));
    check('V3 mensaje de entrada junto a la celda activa (título y mensaje)', (await tip()) === 'RespuestaElija Sí o No', await tip());
    const tipPos = await ev(`(() => { const a = Q.R(document.getElementById('dvTip')), b = Q.R(Q.td('B3')); return a.t > b.t + b.h - 2 && a.l > b.l && a.l < b.l + b.w; })()`);
    check('V3 el globo queda debajo de B3', tipPos, null);
    await clickSel(cellSel('C3'));
    check('V3 fuera de la regla no hay globo', (await tip()) === null, await tip());
    await goto('D2'); await openDlg();
    await setv('#dvType', 'list'); await setv('#dvSrc', 'a;b');
    await clickText('#dvDlg .dv-tab', 'Mensaje de error');
    await setv('#dvErrStyle', 'warning'); await setv('#dvErrTitle', 'Ojo'); await setv('#dvErrMsg', 'Valor raro');
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    await clickSel(cellSel('D2')); await write('zz');
    check('V3 Advertencia: título y mensaje propios, "¿Desea continuar?" Sí / No / Cancelar', (await errText()) === 'Ojo / Valor raro\n¿Desea continuar? / Sí|No|Cancelar', await errText());
    check('V3 Advertencia: el foco empieza en No', (await ev('document.activeElement.textContent')) === 'No', await ev('document.activeElement.textContent'));
    await clickSel('#dvErrDlg .dlg-more');
    const no = await edState();
    check('V3 No vuelve a editar con el texto seleccionado', no.on && no.v === 'zz' && no.s === 0 && no.e === 2, no);
    await key('Enter');
    await clickSel('#dvErrDlg .dlg-ok');
    check('V3 Sí acepta el valor y sigue el Enter (D2 = zz, activa D3)', (await val('D2')) === 'zz' && (await nb()) === 'D3', { v: await val('D2'), nb: await nb() });
    await goto('E2'); await openDlg();
    await setv('#dvType', 'list'); await setv('#dvSrc', 'a;b');
    await clickText('#dvDlg .dv-tab', 'Mensaje de error'); await setv('#dvErrStyle', 'information');
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    await clickSel(cellSel('E2')); await write('zz', 'Tab');
    check('V3 Información: Aceptar / Cancelar con el mensaje de Excel', (await errText()) === `Bassxcel / ${MSG} / Aceptar|Cancelar`, await errText());
    await clickSel('#dvErrDlg .dlg-cancel');
    check('V3 Información ▸ Cancelar descarta (E2 vacía, activa E2)', (await val('E2')) === '' && (await nb()) === 'E2', { nb: await nb() });
    await write('zz', 'Tab');
    await clickSel('#dvErrDlg .dlg-ok');
    check('V3 Información ▸ Aceptar acepta y sigue el Tab (activa F2)', (await val('E2')) === 'zz' && (await nb()) === 'F2', { v: await val('E2'), nb: await nb() });
    await goto('F2'); await openDlg();
    await setv('#dvType', 'whole'); await setv('#dvF1', '1'); await setv('#dvF2', '10');
    await clickText('#dvDlg .dv-tab', 'Mensaje de error'); await tick('#dvErrShow', false);
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    await clickSel(cellSel('F2')); await write('99');
    check('V3 sin "Mostrar mensaje de error", el valor no válido se acepta sin aviso', (await val('F2')) === '99' && !(await isOpen('dvErrDlg')), await val('F2'));
    // lista de 12 elementos desde un rango: 8 a la vista con desplazamiento
    await clickSel(cellSel('K1')); await paste('e1\r\ne2\r\ne3\r\ne4\r\ne5\r\ne6\r\ne7\r\ne8\r\ne9\r\ne10\r\ne11\r\ne12');
    await goto('J2'); await openDlg();
    await setv('#dvType', 'list'); await setv('#dvSrc', '=$K$1:$K$12');
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    await clickSel(cellSel('J2')); await key('ArrowDown', 1);
    const box = await ev(`(() => { const l = document.getElementById('dvList'), it = l.firstElementChild.getBoundingClientRect().height; return { n: l.children.length, vis: Math.round(l.clientHeight / it), over: l.scrollHeight > l.clientHeight }; })()`);
    check('V3 lista de 12: 8 elementos a la vista y desplazamiento', box.n === 12 && box.vis === 8 && box.over, box);
    await key('End');
    check('V3 Fin marca el último y desplaza la lista', (await listText()).endsWith('*e12') && (await ev(`document.getElementById('dvList').scrollTop`)) > 0, await listText());
    await key('Enter');
    check('V3 elegir e12 (texto mostrado del origen)', (await val('J2')) === 'e12', await val('J2'));

    // ---------- V4: Personalizada relativa, fechas y estructura (insertar y eliminar) ----------
    await open(); await captureConfirm();
    await goto('A1:A3'); await openDlg();
    await setv('#dvType', 'custom');
    check('V4 Personalizada: campo Fórmula', !(await ev(`document.getElementById('dvFmlL').hidden`)), null);
    await setv('#dvFml', '=A1>0');
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    await clickSel(cellSel('A2')); await write('-1');
    check('V4 Personalizada =A1>0 sobre A1:A3: -1 en A2 → mensaje', (await isOpen('dvErrDlg')), await errText());
    await clickSel('#dvErrDlg .dlg-cancel');
    await clickSel(cellSel('A2')); await write('3');
    check('V4 3 en A2 se acepta (la regla mira la celda que se escribe)', (await val('A2')) === '3' && !(await isOpen('dvErrDlg')), await val('A2'));
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='ins-row']");
    check('V4 insertar una fila arriba desplaza la regla y su fórmula (A2:A4, =A2>0)', JSON.stringify(await dvs()) === '["A2:A4|custom|=A2>0"]', await dvs());
    await clickSel(cellSel('A3')); await write('-5');
    check('V4 después de insertar sigue validando la celda correcta (-5 en A3 → mensaje)', await isOpen('dvErrDlg'), null);
    await clickSel('#dvErrDlg .dlg-cancel');
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='del-row']");
    check('V4 eliminar la primera fila de la regla: A2:A3, =A2>0 (la nueva ancla)', JSON.stringify(await dvs()) === '["A2:A3|custom|=A2>0"]', await dvs());
    await clickSel(cellSel('A2')); await write('-2');
    check('V4 tras eliminar, -2 en A2 → mensaje', await isOpen('dvErrDlg'), null);
    await clickSel('#dvErrDlg .dlg-cancel');
    await key('z', 2); await key('z', 2);
    check('V4 Ctrl+Z dos veces: A1:A3, =A1>0', JSON.stringify(await dvs()) === '["A1:A3|custom|=A1>0"]', await dvs());
    await LISTSINO('C2:C4');
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='del-col']");
    check('V4 eliminar la columna A: la lista pasa a B2:B4 y la Personalizada desaparece', JSON.stringify(await dvs()) === '["B2:B4|list|Sí;No"]', await dvs());
    await key('z', 2);
    await goto('D2:D3'); await openDlg();
    await setv('#dvType', 'date'); await setv('#dvF1', '01/01/2026'); await setv('#dvF2', '31/12/2026');
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    await clickSel(cellSel('D2')); await write('15/06/2026');
    check('V4 Fecha entre 01/01/2026 y 31/12/2026: 15/06/2026 se acepta', (await t('D2')) === '15-06-2026' && !(await isOpen('dvErrDlg')), await t('D2'));
    await write('01/01/2027');
    check('V4 01/01/2027 → mensaje', await isOpen('dvErrDlg'), null);
    await clickSel('#dvErrDlg .dlg-cancel');

    // ---------- V5: copiar/pegar, rellenar, cortar, Supr, Borrar formato, Borrar todo, ordenar ----------
    await open(); await captureConfirm();
    await LISTSINO('B2:B4');
    await clickSel(cellSel('B2')); await write('No');
    await clickSel(cellSel('B2')); await clipEv('copy');
    await clickSel(cellSel('D2')); await paste('No');
    check('V5 pegar copia la regla (y el valor) en D2', (await val('D2')) === 'No' && JSON.stringify(await dvs()) === '["B2:B4 D2|list|Sí;No"]', await dvs());
    await clickSel(cellSel('D2'));
    check('V5 ▾ en D2 después de pegar', await btnAt('D2'), null);
    await key('z', 2);
    check('V5 un Ctrl+Z quita el valor y la regla pegados', (await val('D2')) === '' && JSON.stringify(await dvs()) === '["B2:B4|list|Sí;No"]', await dvs());
    await key('y', 2);
    await goto('D2:D4'); await key('j', 2);
    check('V5 Ctrl+J (rellenar hacia abajo) copia la regla: D2:D4', JSON.stringify(await dvs()) === '["B2:B4 D2:D4|list|Sí;No"]', await dvs());
    await key('z', 2);
    check('V5 Ctrl+Z deshace el relleno (valores y regla)', JSON.stringify(await dvs()) === '["B2:B4 D2|list|Sí;No"]' && (await val('D3', 0)) === '', await dvs());
    await clickSel(cellSel('E5')); await write('x');
    await clickSel(cellSel('E5')); await clipEv('copy');
    await clickSel(cellSel('D2')); await paste('x');
    check('V5 pegar una celda sin regla encima quita la regla del destino', JSON.stringify(await dvs()) === '["B2:B4|list|Sí;No"]', await dvs());
    await clickSel(cellSel('B3')); await clipEv('cut');
    await clickSel(cellSel('F3')); await paste('');
    check('V5 cortar y pegar mueve la regla (B3 → F3)', JSON.stringify(await dvs()) === '["B2 B4 F3|list|Sí;No"]', await dvs());
    await key('z', 2);
    check('V5 Ctrl+Z la devuelve', JSON.stringify(await dvs()) === '["B2:B4|list|Sí;No"]', await dvs());
    await clickSel(cellSel('B2')); await key('Delete');
    check('V5 Supr borra el valor y deja la regla', (await val('B2')) === '' && JSON.stringify(await dvs()) === '["B2:B4|list|Sí;No"]', await dvs());
    await clickSel(cellSel('B2')); await clickSel(cellSel('B2'), { button: 'right' }); await ev("Q.menu('Borrar formato')");
    check('V5 Borrar formato no quita la regla', JSON.stringify(await dvs()) === '["B2:B4|list|Sí;No"]', await dvs());
    await clickSel(cellSel('B3')); await clickSel(cellSel('B3'), { button: 'right' }); await ev("Q.menu('Borrar todo')");
    check('V5 Borrar todo quita la regla de B3', JSON.stringify(await dvs()) === '["B2 B4|list|Sí;No"]', await dvs());
    await key('z', 2);
    check('V5 Ctrl+Z restaura la regla de B3', JSON.stringify(await dvs()) === '["B2:B4|list|Sí;No"]', await dvs());
    await clickSel(cellSel('A1')); await paste('Nombre\tResp\r\nLuis\tSí\r\nAna\tNo\r\nPedro\tSí');
    await clickSel(cellSel('A1')); await key('2', 2);   // encabezado en negrita (Ctrl+2): ordenar lo detecta
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort-asc']");
    check('V5 ordenar mueve los valores; la regla se queda con sus celdas (B2:B4)', (await sleep(550).then(() => ev(`['A2','A3','A4'].map(k => Q.sheet().cells[k].v).join()`))) === 'Ana,Luis,Pedro' && JSON.stringify(await dvs()) === '["B2:B4|list|Sí;No"]', await dvs());

    // ---------- V6: hojas, nombres, .bassx y .xlsx ----------
    await open(); await captureConfirm();
    await clickSel('.tab.add');
    await clickSel(cellSel('A1')); await paste('Alto\r\nMedio\r\nBajo');
    await clickText('.tab', 'Hoja1');
    await goto('B2'); await openDlg();
    await setv('#dvType', 'list'); await setv('#dvSrc', '=Hoja2!$A$1:$A$3');
    await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    await clickSel(cellSel('B2')); await key('ArrowDown', 1);
    check('V6 origen en otra hoja: la lista muestra Alto, Medio, Bajo', (await listText()) === '*Alto|Medio|Bajo', await listText());
    await key('Escape');
    await ev(`window.prompt = () => 'Niveles'; 1`);
    // la pestaña se reconstruye al activarla: primero se activa y después el doble clic real cae sobre la activa (L-031)
    await clickText('.tab', 'Hoja2');
    await click(...Object.values(await ev(`(() => { const r = document.querySelector('.tab.on').getBoundingClientRect(); return { x: r.left + 10, y: r.top + 8 }; })()`)), { clickCount: 2 });
    await clickText('.tab', 'Hoja1');
    check('V6 renombrar la hoja de origen actualiza la regla (=Niveles!$A$1:$A$3)', JSON.stringify(await dvs()) === '["B2|list|=Niveles!$A$1:$A$3"]', await dvs());
    await clickSel(cellSel('B2')); await write('Medio');
    check('V6 Medio se acepta con el origen renombrado', (await val('B2')) === 'Medio' && !(await isOpen('dvErrDlg')), await val('B2'));
    await clickText('.tab', 'Niveles'); await clickSel(cellSel('B2'));
    check('V6 la regla es de su hoja: en Niveles!B2 no hay ▾', !(await btnShown()), null);
    await clickText('.tab', 'Hoja1');
    await clickSel('.tab.on', { button: 'right' }); await ev("Q.menu('Duplicar hoja')");
    await clickSel(cellSel('B2'));
    check('V6 duplicar la hoja copia la regla (▾ en B2 de la copia)', (await ev(`document.querySelector('.tab.on').textContent`)) === 'Hoja1 (2)' && (await btnAt('B2')), await ev(`document.querySelector('.tab.on').textContent`));
    await clickText('.tab', 'Hoja1');
    await goto('C1:C3'); await goto('Lista'); await clickSel(cellSel('C1')); await paste('uno\r\ndos\r\ntres');
    await goto('D2'); await openDlg(); await setv('#dvType', 'list'); await setv('#dvSrc', '=Lista'); await clickSel('#dvDlg .dlg-ok'); await sleep(50);
    await clickSel(cellSel('D2')); await write('dos');
    check('V6 Origen con un nombre definido (=Lista): dos se acepta', (await val('D2')) === 'dos' && !(await isOpen('dvErrDlg')), await val('D2'));
    await sleep(600);
    await open(false);
    await clickSel(cellSel('B2'));
    check('V6 .bassx (autoguardado y recarga): la regla sigue (▾ en B2)', (await btnAt('B2')) && (await dvs()).includes('B2|list|=Niveles!$A$1:$A$3'), await dvs());
    await ev(`window.__book = null; XLSX.writeFile = bk => { window.__book = bk; }; 1`);   // sin descargas reales
    await clickSel("button[data-cmd='xlsx']");
    check('V6 exportar .xlsx avisa que se pierde la validación', (await isOpen('msgDlg')) && (await msgText()).startsWith('Este libro tiene validación de datos y Bassxcel todavía no la guarda en .xlsx'), await msgText());
    await clickSel('#msgCancel');
    check('V6 Cancelar en el aviso no exporta', (await ev('window.__book === null')), null);
    await clickSel("button[data-cmd='xlsx']"); await clickSel('#msgOk'); await sleep(100);
    check('V6 Aceptar exporta igual (los datos, sin las reglas)', (await ev('!!window.__book && window.__book.SheetNames.length === 3')), await ev('window.__book && window.__book.SheetNames'));

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

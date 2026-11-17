'use strict';
// Arnés de Chrome headless de la ronda 2b de grid-ui-dev (fallas P1 de qa ronda 2 y matrices dinámicas en la UI).
// Uso: node tests/ui-round2b.harness.js [--web=<carpeta>]   (sale con código 1 si alguna aserción falla; --web o BX_WEB
// sirven otra copia de web/, como la mutada de tests/ui-mutate.js). El grupo D es de la ronda 2d (ordenar con filtro).
// Entrada real por CDP (clics, teclas, Ctrl+Alt+V, clic en el indicador de error: L-031); lecturas con el puente de
// qa-serve.js (Q.*). Cada grupo abre un libro nuevo (L-039). Complementa los escenarios REA UI-28..UI-33.
const { launch, reporter, sleep } = require('./cdp');

(async () => {
  const b = await launch({ port: 8771, cdpPort: 9339 });
  console.log('web: ' + b.web);
  const { check, done } = reporter();
  const { ev, key, type, enter, clickSel, cellSel, open } = b;
  const t = a => ev(`Q.t(${JSON.stringify(a)})`);
  const nb = () => ev('Q.nb()');
  const fb = () => ev('Q.fb()');
  const goto = async ref => { await ev(`(() => { const n = document.getElementById('nameBox'); n.value = ${JSON.stringify(ref)}; n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`); await sleep(50); };
  const paste = text => ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  const copyText = () => ev(`(() => { const dt = new DataTransfer(); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData('text/plain'); })()`);
  const status = () => ev(`document.getElementById('status').textContent`);
  const R = sel => ev(`Q.R(document.querySelector(${JSON.stringify(sel)}))`);
  const openFile = async (name, content) => {
    await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${content}], ${JSON.stringify(name)})); const fi = document.getElementById('fileInput'); fi.files = dt.files; fi.dispatchEvent(new Event('change')); })()`);
    await sleep(700);
  };
  const captureConfirm = ans => ev(`window.__conf = []; window.confirm = m => { window.__conf.push(m); return ${ans}; }; window.alert = m => console.log('ALERT ' + m); 1`);
  // HTML de la vista de impresión (se captura el iframe antes de que se imprima)
  const printHtml = () => ev(`new Promise(res => { const mo = new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.tagName === 'IFRAME') { mo.disconnect(); const h = n.srcdoc; n.remove(); res(h); } }); mo.observe(document.body, { childList: true }); document.querySelector("button[data-cmd='print']").click(); setTimeout(() => res(null), 1500); })`);

  try {
    // ---------- A1: una sola lógica de entrada (L-040) ----------
    await open();
    await enter('A1', '$1.500'); await enter('A2', '50%'); await enter('A3', '1.234,5'); await enter('A4', '01/01/2026'); await enter('A5', '=SUMA(A1:A3)');
    check('A1 escribir: $1.500 50% 1.234,5 01-01-2026 y SUMA $2.735 (hereda la moneda de A1, ronda 2d)', JSON.stringify(await ev("Q.ts('A1 A2 A3 A4 A5')")) === JSON.stringify({ A1: '$1.500', A2: '50%', A3: '1.234,5', A4: '01-01-2026', A5: '$2.735' }), await ev("Q.ts('A1 A2 A3 A4 A5')"));
    await clickSel(cellSel('C1'));
    await paste('$1.500\r\n50%\r\n1.234,5\r\n01/01/2026\r\n');
    await enter('C5', '=SUMA(C1:C3)');
    check('A1 pegar texto de otra aplicación = escribir', JSON.stringify(await ev("Q.ts('C1 C2 C3 C4 C5')")) === JSON.stringify({ C1: '$1.500', C2: '50%', C3: '1.234,5', C4: '01-01-2026', C5: '$2.735' }), await ev("Q.ts('C1 C2 C3 C4 C5')"));
    check('A1 pegar: C1 queda número a la derecha (td.num)', await ev(`Q.td('C1').classList.contains('num')`), await ev(`Q.td('C1').className`));
    await clickSel(cellSel('E1')); await clickSel(cellSel('E3'), { modifiers: 8 });
    await type('$2.000'); await key('Enter', 2);
    check('A1 Ctrl+Enter con $2.000 → moneda en E1:E3', JSON.stringify(await ev("Q.ts('E1 E2 E3')")) === JSON.stringify({ E1: '$2.000', E2: '$2.000', E3: '$2.000' }), await ev("Q.ts('E1 E2 E3')"));
    // celda con formato Número: se conserva el formato y se guarda el número
    await clickSel(cellSel('G1'));
    await ev(`(() => { const s = document.getElementById('fmtSel'); s.value = 'number'; s.dispatchEvent(new Event('change')); })()`);
    await enter('G1', '$1.500');
    check('A1 $1.500 en una celda con formato Número → 1.500,00', await t('G1') === '1.500,00', await t('G1'));
    await captureConfirm('true');
    await openFile('datos.csv', JSON.stringify('Monto;Pct\n$1.500;50%\n1.234,5;01/01/2026\n'));
    check('A1 abrir CSV = escribir', JSON.stringify(await ev("Q.ts('A2 B2 A3 B3')")) === JSON.stringify({ A2: '$1.500', B2: '50%', A3: '1.234,5', B3: '01-01-2026' }), await ev("Q.ts('A2 B2 A3 B3')"));
    check('A2 abrir sobre un libro con cambios pregunta (1 confirm)', (await ev('window.__conf.length')) === 1, await ev('window.__conf'));

    // ---------- A2: Abrir pregunta si hay cambios sin guardar (L-041) y P2 5 ----------
    await open();
    await enter('A1', 'importante');
    await captureConfirm('false');
    const BASSX = JSON.stringify(JSON.stringify({ app: 'Bassxcel', syntax: 'es-CL', sheets: [{ name: 'Hoja1', cells: { A1: { v: 'otro' } } }] }));
    await openFile('otro.bassx', BASSX);
    check('A2 Cancelar conserva el libro (A1 = importante)', await t('A1') === 'importante', await t('A1'));
    check('A2 la pregunta nombra el archivo', /otro\.bassx/.test((await ev('window.__conf'))[0] || ''), await ev('window.__conf'));
    await captureConfirm('true');
    await openFile('otro.bassx', BASSX);
    check('A2 Aceptar abre el archivo (A1 = otro)', await t('A1') === 'otro', await t('A1'));
    await openFile('otro.bassx', BASSX);
    check('A2 sin cambios no pregunta', (await ev('window.__conf.length')) === 1, await ev('window.__conf'));
    await clickSel("button[data-cmd='new']");
    check('A2 Nuevo sin cambios no pregunta', (await ev('window.__conf.length')) === 1, await ev('window.__conf'));
    // edición abierta al llegar un archivo: se confirma en el libro actual (que entonces pregunta), nunca en el nuevo
    await clickSel(cellSel('B1')); await type('abc');
    await openFile('otro.bassx', BASSX);
    check('A2 P2 5: la edición en curso no pasa al libro nuevo', (await t('B1')) === '' && (await ev('Q.ed().display')) === 'none', { B1: await t('B1'), ed: await ev('Q.ed()') });
    check('A2 P2 5: la edición confirmada cuenta como cambio (pregunta)', (await ev('window.__conf.length')) === 2, await ev('window.__conf'));

    // ---------- A3: beforeunload ----------
    b.dialogs.length = 0;
    await open();
    check('A3 navegar desde el libro anterior (sin cambios) no pidió confirmación', b.dialogs.length === 0, b.dialogs);
    await enter('C3', 'y');
    b.dialogs.length = 0;
    await b.navigate('Page.reload'); await sleep(300);
    check('A3 con autoguardado normal, recargar no pregunta y conserva C3', b.dialogs.length === 0 && (await t('C3')) === 'y', { dialogs: b.dialogs, C3: await t('C3') });
    await ev(`Storage.prototype.setItem = function () { throw new DOMException('cuota', 'QuotaExceededError'); }; 1`);
    await enter('D3', 'z'); await sleep(600);
    check('A3 la barra avisa que no se pudo autoguardar', /No se pudo autoguardar/.test(await ev(`document.getElementById('saveState').textContent`)), await ev(`document.getElementById('saveState').textContent`));
    b.dialogs.length = 0; b.dialogAccept = false;
    b.send('Page.reload').catch(() => {}); await sleep(1200);
    check('A3 con autoguardado fallido, recargar pide confirmación (beforeunload)', b.dialogs.length === 1 && b.dialogs[0].type === 'beforeunload', b.dialogs);
    check('A3 Cancelar deja el libro (D3 = z)', (await t('D3')) === 'z', await t('D3'));
    b.dialogAccept = true;

    // ---------- A4: barra de estado, copiar e imprimir con filtro y ocultas (L-042, L-013) ----------
    await open();
    await clickSel(cellSel('A1'));
    await paste('Producto\tRegión\tMonto\r\npan\tnorte\t100\r\nleche\tsur\t50\r\nqueso\tnorte\t200\r\nté\tsur\t30');
    await clickSel(cellSel('A1'));
    await clickSel("button[data-cmd='filter']");
    await ev(`(() => { const btn = document.querySelector('.fbtn[data-c="1"]'); btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); const l = [...document.querySelectorAll('.fltpop label')].find(x => x.textContent.trim() === 'sur'); l.querySelector('input').click(); document.querySelector('.fltpop [data-a="ok"]').click(); })()`);
    await goto('A2:C5');
    const st = await status();
    check('A4 barra de estado con filtro: Suma 300 · Recuento 6 · Promedio 150', /Promedio: 150/.test(st) && /Recuento: 6/.test(st) && /Suma: 300/.test(st), st);
    const txt = await copyText();
    check('A4 copiar con filtro: solo las filas visibles', txt === 'pan\tnorte\t100\r\nqueso\tnorte\t200', txt);
    // pegar (el texto es el mismo que se copió: pega lo copiado en Bassxcel). Como Excel, pega 2 filas contiguas
    // (E3 está oculta por el filtro: recibe la segunda fila)
    await clickSel(cellSel('E2'));
    await paste(txt); await sleep(500);
    const e3 = await ev('Q.sheet().cells.E3 ? Q.sheet().cells.E3.v : null');
    check('A4 pegar lo copiado con filtro: 2 filas seguidas (pan, queso)', JSON.stringify(await ev("Q.ts('E2 G2')")) === JSON.stringify({ E2: 'pan', G2: '100' }) && e3 === 'queso', { ts: await ev("Q.ts('E2 G2')"), e3 });
    await goto('A1:C5');
    const ph = await printHtml();
    check('A4 imprimir con filtro: sin las filas filtradas', ph && ph.includes('>queso<') && !ph.includes('>leche<') && !ph.includes('>té<'), ph && ph.slice(0, 300));
    await clickSel("button[data-cmd='filter']");   // quitar el filtro
    await goto('A3');
    await clickSel(cellSel('A3'), { button: 'right' });
    await ev("Q.menu('Ocultar filas')");
    await goto('A2:C5');
    const st2 = await status();
    check('A4 barra de estado sin la fila oculta a mano: Suma 330 · Recuento 9', /Recuento: 9/.test(st2) && /Suma: 330/.test(st2), st2);

    // ---------- A5: Pegado especial ----------
    await open();
    await clickSel(cellSel('B5'));
    await key('v', 3); await sleep(100);
    const m0 = await ev(`[...document.querySelectorAll('#menu div')].map(d => d.textContent + (d.classList.contains('dis') ? ':dis' : ''))`);
    check('A5 Ctrl+Alt+V sin nada copiado: menú con 5 opciones deshabilitadas', (await ev(`getComputedStyle(document.getElementById('menu')).display`)) === 'block' && m0.length === 5 && m0.every(x => x.endsWith(':dis')) && m0[1] === 'Fórmulas:dis', m0);
    check('A5 Ctrl+Alt+V no escribe en la celda', (await ev('Q.ed().display')) === 'none', await ev('Q.ed()'));
    await key('Escape');
    await enter('A1', '10'); await enter('A2', '=A1*2');
    await clickSel(cellSel('C2')); await key('2', 2);   // negrita en el destino
    await clickSel(cellSel('A2')); await key('c', 2);
    await clickSel(cellSel('C2')); await key('v', 3); await sleep(100);
    await b.clickText('#menu div', 'Fórmulas');
    await clickSel(cellSel('C2'));
    check('A5 Pegado especial ▸ Fórmulas: fórmula ajustada y formato del destino', (await fb()) === '=C1*2' && (await ev(`document.getElementById('btnB').classList.contains('on')`)), { fb: await fb() });

    // ---------- B: matrices dinámicas ----------
    await open();
    await enter('A1', '=SECUENCIA(3;2)');
    check('B1 celdas fantasma pintadas (A3 = 5, B3 = 6)', (await t('A3')) === '5' && (await t('B3')) === '6', await ev("Q.ts('A1 B1 A2 B2 A3 B3')"));
    await sleep(500);
    check('B1 las fantasmas no se guardan en sheet.cells', JSON.stringify(Object.keys(await ev('Q.sheet().cells'))) === '["A1"]', Object.keys(await ev('Q.sheet().cells')));
    await enter('D2', 'texto largo que se desborda bastante');
    await enter('E1', '=SECUENCIA(3)');
    const ovw = await ev(`(() => { const s = Q.td('D2').querySelector('.ov'); return s ? s.getBoundingClientRect().width : 0; })()`);
    const dW = (await R(cellSel('D2'))).w;
    check('B1 una fantasma (E2) corta el desborde de texto de D2', ovw <= dW, { ovw, dW });
    await clickSel(cellSel('B2'));
    const sb = await R('#spillBox'), a1 = await R(cellSel('A1')), b3 = await R(cellSel('B3'));
    check('B2 borde del desborde alrededor de A1:B3 con la activa en B2', Math.abs(sb.l - a1.l) <= 1 && Math.abs(sb.t - a1.t) <= 1 && Math.abs(sb.l + sb.w - (b3.l + b3.w)) <= 2 && Math.abs(sb.t + sb.h - (b3.t + b3.h)) <= 2, { sb, a1, b3 });
    check('B3 barra de fórmulas: fórmula del ancla en gris', (await fb()) === '=SECUENCIA(3;2)' && (await ev(`document.getElementById('fbMirror').classList.contains('ghost')`)), await fb());
    await clickSel(cellSel('C5'));
    check('B2 fuera del desborde no hay borde', (await ev(`getComputedStyle(document.getElementById('spillBox')).display`)) === 'none', null);
    await clickSel(cellSel('A1')); await key('ArrowDown', 2);
    check('B5 Ctrl+↓ desde A1 llega a A3 (las fantasmas son datos)', (await nb()) === 'A3', await nb());
    await key('End', 2);
    check('B5 Ctrl+Fin cuenta los desbordes (E3)', (await nb()) === 'E3', await nb());
    await goto('A1:B3');
    check('B status: la barra de estado suma las fantasmas (21)', /Suma: 21/.test(await status()), await status());
    // escribir en una fantasma bloquea el ancla; Ctrl+Z lo revierte
    await enter('B2', '9');
    const a1t = await ev(`Q.t('A1')`);
    check('B3 escribir en una fantasma: el ancla da #¡DESBORDAMIENTO!', a1t.charCodeAt(1) === 161 && /DESBORDAMIENTO/.test(a1t), a1t);
    await clickSel(cellSel('A1'));
    check('B2 ancla bloqueada: borde discontinuo e indicador', (await ev(`document.getElementById('spillBox').className`)) === 'err' && (await ev(`getComputedStyle(document.getElementById('spillTag')).display`)) === 'block', null);
    await clickSel('#spillTag');
    const items = await ev(`[...document.querySelectorAll('#menu div')].map(d => d.textContent)`);
    check('B2 menú del indicador: motivo y "Seleccionar celdas que obstruyen"', items.includes('El rango de desbordamiento no está en blanco.') && items.includes('Seleccionar celdas que obstruyen'), items);
    await b.clickText('#menu div', 'Seleccionar celdas que obstruyen');
    check('B2 "Seleccionar celdas que obstruyen" selecciona B2', (await nb()) === 'B2', await nb());
    await key('z', 2);
    check('B3 Ctrl+Z libera el desborde (A1 = 1, B2 = 4)', (await t('A1')) === '1' && (await t('B2')) === '4', await ev("Q.ts('A1 B2')"));
    await clickSel(cellSel('B3')); await key('Delete');
    check('B3 Supr en una fantasma no hace nada', (await t('B3')) === '6', await t('B3'));
    await clickSel(cellSel('A1')); await key('Delete');
    check('B3 Supr en el ancla libera todo el desborde', (await t('B3')) === '' && (await t('A1')) === '', await ev("Q.ts('A1 B3')"));
    await key('z', 2);
    check('B3 Ctrl+Z restaura el desborde', (await t('B3')) === '6', await t('B3'));
    // rellenar desde una fantasma copia su valor (Ctrl+D: B3 → C3)
    await goto('B3:C3'); await key('d', 2); await sleep(500);
    check('B matriz Ctrl+D desde una fantasma copia el valor (C3 = 6, sin fórmula)', (await t('C3')) === '6' && (await ev('Q.sheet().cells.C3.v')) === '6', { C3: await t('C3'), v: await ev('Q.sheet().cells.C3') });
    await key('z', 2);
    // resaltado de A1# y ayuda de argumentos
    await clickSel(cellSel('G1')); await type('=SUMA(A1#');
    const rb = await R('#refHL .refbox');
    check('B4 =SUMA(A1# resalta A1:B3', rb && Math.abs(rb.l - a1.l) <= 1 && Math.abs(rb.t + rb.h - (b3.t + b3.h)) <= 3 && Math.abs(rb.l + rb.w - (b3.l + b3.w)) <= 3, { rb, a1, b3 });
    await key('Escape');
    await clickSel(cellSel('G2')); await type('=ORDENARPOR(');
    const sig = await ev(`document.getElementById('sigTip').textContent`);
    check('B4 SIG de ORDENARPOR', sig.startsWith('ORDENARPOR(matriz; por_matriz1;'), sig);
    await key('Escape');
    // copiar y pegar: una fantasma se pega como valor; el desborde completo, como fórmula
    await clickSel(cellSel('B3')); await key('c', 2);
    await clickSel(cellSel('H1')); await key('v', 2); await sleep(100);
    await clickSel(cellSel('H1'));
    check('B matriz copiar una fantasma pega su valor (H1 = 6, sin fórmula)', (await t('H1')) === '6' && (await fb()) === '6', { H1: await t('H1'), fb: await fb() });
    await goto('A1:B3'); await key('c', 2);
    await clickSel(cellSel('J1')); await key('v', 2); await sleep(100);
    check('B matriz copiar el desborde entero pega la fórmula (K3 = 6 fantasma)', (await t('K3')) === '6' && (await ev('Q.sheet().cells.K3 || null')) === null, { K3: await t('K3') });
    await key('Escape');
    // ordenar dentro de un desborde se rechaza
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort-asc']");
    check('B matriz ordenar dentro de un desborde se rechaza', /matriz desbordada/.test(await ev('Q.toast()')) && (await t('A2')) === '3', { toast: await ev('Q.toast()'), A2: await t('A2') });
    await goto('A1:B3');
    const ph2 = await printHtml();
    check('B matriz imprimir incluye los valores desbordados', ph2 && ph2.includes('>6<') && ph2.includes('>5<'), ph2 && ph2.slice(0, 200));
    // exportar .xlsx
    await ev(`XLSX.writeFile = bk => { window.__book = bk; }; 1`);
    await clickSel("button[data-cmd='xlsx']");
    const xa1 = await ev(`(() => { const c = __book.Sheets.Hoja1.A1; return { f: c.f, F: c.F, D: c.D, v: c.v }; })()`);
    const xb3 = await ev(`(() => { const c = __book.Sheets.Hoja1.B3; return { t: c.t, v: c.v, f: c.f || null }; })()`);
    check('B6 exportar: ancla con f, F = A1:B3 y D', xa1.f === '_xlfn.SEQUENCE(3,2)' && xa1.F === 'A1:B3' && xa1.D === true && xa1.v === 1, xa1);
    check('B6 exportar: fantasma solo con t/v', xb3.t === 'n' && xb3.v === 6 && xb3.f === null, xb3);
    // ida y vuelta e importación sin D
    await captureConfirm('true');
    await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File([XLSX.write(__book, { type: 'array', bookType: 'xlsx' })], 'ida.xlsx')); const fi = document.getElementById('fileInput'); fi.files = dt.files; fi.dispatchEvent(new Event('change')); })()`);
    await sleep(800);
    await clickSel(cellSel('A1'));
    check('B7 ida y vuelta: A1 conserva =SECUENCIA(3;2) y B3 = 6', (await fb()) === '=SECUENCIA(3;2)' && (await t('B3')) === '6', { fb: await fb(), B3: await t('B3') });
    await sleep(500);
    check('B7 ida y vuelta: las fantasmas no se importan como celdas', !('B3' in (await ev('Q.sheet().cells'))), Object.keys(await ev('Q.sheet().cells')));
    await ev(`(() => { const ws = { A1: { t: 'n', v: 1 }, A2: { t: 'n', v: 2 }, A3: { t: 'n', v: 3 }, B2: { t: 'n', v: 4, f: 'A1:A3*2' }, C1: { t: 'n', v: 3, f: 'SUM(_xlfn.ANCHORARRAY(D1))' }, D1: { t: 'n', v: 1, f: '_xlfn.SEQUENCE(2)', F: 'D1:D2', D: true }, D2: { t: 'n', v: 99 }, '!ref': 'A1:D3' }; const bk = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(bk, ws, 'Datos'); const dt = new DataTransfer(); dt.items.add(new File([XLSX.write(bk, { type: 'array', bookType: 'xlsx' })], 'sinD.xlsx')); const fi = document.getElementById('fileInput'); fi.files = dt.files; fi.dispatchEvent(new Event('change')); })()`);
    await sleep(800);
    await clickSel(cellSel('B2'));
    check('B7 fórmula sin D: intersección implícita (=@A1:A3*2 → 4 en la fila 2)', (await fb()) === '=@A1:A3*2' && (await t('B2')) === '4', { fb: await fb(), B2: await t('B2') });
    await clickSel(cellSel('C1'));
    check('B7 _xlfn.ANCHORARRAY(D1) → =SUMA(D1#) = 3 (y D2 se recalcula: 2, no 99)', (await fb()) === '=SUMA(D1#)' && (await t('C1')) === '3' && (await t('D2')) === '2', { fb: await fb(), C1: await t('C1'), D2: await t('D2') });

    // ---------- C: desborde × filtro, insertar filas, combinaciones y formato (UI-29 paso 4, UI-30 paso 7, UI-32) ----------
    await open();
    await enter('A1', 'Valor'); await enter('A2', '=SECUENCIA(4)');
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='filter']");
    await ev(`document.querySelector('.fbtn[data-c="0"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
    const vals = await ev(`[...document.querySelectorAll('.fltpop label[data-t]')].map(l => l.textContent.trim())`);
    check('C filtro: la lista muestra los valores desbordados', JSON.stringify(vals) === '["1","2","3","4"]', vals);
    await ev(`(() => { const l = [...document.querySelectorAll('.fltpop label[data-t]')].find(x => x.textContent.trim() === '2'); l.querySelector('input').click(); document.querySelector('.fltpop [data-a="ok"]').click(); })()`);
    await goto('A2:A5');
    check('C filtro sobre un desborde: oculta la fila 3 y la barra suma 8', (await t('A3')) === '(no DOM)' && /Suma: 8/.test(await status()) && /Recuento: 3/.test(await status()), { A3: await t('A3'), st: await status() });
    await clickSel("button[data-cmd='filter']");
    await goto('A1:A2'); await clickSel("button[data-cmd='ins-row']");
    check('C insertar 2 filas arriba: el ancla pasa a A4 y el desborde a A4:A7', (await t('A7')) === '4' && (await t('A3')) === 'Valor', await ev("Q.ts('A3 A4 A7')"));
    await key('z', 2);
    check('C Ctrl+Z vuelve el desborde a A2:A5', (await t('A5')) === '4' && (await t('A1')) === 'Valor', await ev("Q.ts('A1 A2 A5')"));
    await enter('C10', '=SECUENCIA(2)');
    await clickSel(cellSel('C10'));
    await ev(`(() => { const s = document.getElementById('fmtSel'); s.value = 'currency'; s.dispatchEvent(new Event('change')); })()`);
    check('C formato del ancla no pasa a la fantasma (C10 $1, C11 2)', (await t('C10')) === '$1' && (await t('C11')) === '2', await ev("Q.ts('C10 C11')"));
    await goto('C10:C11');
    await ev(`(() => { const s = document.getElementById('fmtSel'); s.value = 'currency'; s.dispatchEvent(new Event('change')); })()`);
    check('C formato del rango desbordado: C11 $2', (await t('C11')) === '$2', await t('C11'));
    await goto('F1:G1'); await clickSel("button[data-cmd='merge']");
    await enter('E1', '=SECUENCIA(1;3)');
    await clickSel(cellSel('E1')); await clickSel('#spillTag');
    const mItems = await ev(`[...document.querySelectorAll('#menu div')].map(d => d.textContent)`);
    check('C combinadas en el área: motivo "contiene celdas combinadas"', mItems.includes('El rango de desbordamiento contiene celdas combinadas.'), mItems);
    await key('Escape');

    // regresión de UI-25 (receta de la ronda 2a) con la lectura nueva (xlfn: true, implicitIntersect)
    await open(); await captureConfirm('true');
    const ui25 = await ev(`(async () => { const ws = XLSX.utils.aoa_to_sheet([[1.234, 2.125, 'texto'], [true, null, '#N/A']]); ws.B2 = {t:'n', f:'SUM(A1,2.5)', v:3.734}; ws.C3 = {t:'e', v:42, w:'#N/A'}; ws.A3 = {t:'n', f:'_xlfn.IFNA(C3,"x")', v:0}; ws.D1 = {t:'s', v:'oculta'}; ws['!ref'] = 'A1:D3'; ws['!rows'] = [, {hpt:30}, , {hidden:true}]; ws['!cols'] = [, , , {wch:10, hidden:true}]; const b = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(b, ws, 'Datos'); const dt = new DataTransfer(); dt.items.add(new File([XLSX.write(b, {type:'array', bookType:'xlsx'})], 'p.xlsx')); const fi = document.getElementById('fileInput'); fi.files = dt.files; fi.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 500)); return Q.ts('A1 B1 A2 B2 C2 C3 A3') })()`);
    check('regresión UI-25 (importar .xlsx)', JSON.stringify(ui25) === JSON.stringify({ A1: '1,234', B1: '2,125', A2: 'VERDADERO', B2: '3,734', C2: '#N/A', C3: '#N/D', A3: 'x' }), ui25);
    await clickSel(cellSel('A3'));
    check('regresión UI-25: A3 = =SI.ND(C3;"x")', (await fb()) === '=SI.ND(C3;"x")', await fb());

    // paneles inmovilizados: el borde del desborde sigue al desplazamiento (capa absoluta, L-013)
    await open();
    await enter('A1', '=SECUENCIA(60)');
    await clickSel(cellSel('A1'));
    await ev(`document.querySelector("button[data-cmd='freeze']").click()`);
    await ev("Q.menu('Inmovilizar fila superior')");
    await ev(`document.getElementById('gridWrap').scrollTop = 400; 1`); await sleep(150);
    await clickSel(cellSel('A30'));
    const sb2 = await R('#spillBox'), a1b = await R(cellSel('A1'));
    check('B2 con fila 1 inmovilizada y desplazada, el borde empieza en A1', sb2 && a1b && Math.abs(sb2.t - a1b.t) <= 1, { sb2, a1b });

    // ---------- D: ordenar con filtro activo (P1 de qa ronda 3, UI-42 paso 4) y P2 de la ronda 3 ----------
    // Excel: "las filas ocultas no se mueven al ordenar las filas" → las visibles se ordenan entre sí y las filtradas
    // quedan en su lugar; filter.hidden no cambia y Ctrl+Z/Ctrl+Y restauran orden y filtro juntos (L-033)
    await open();
    await clickSel(cellSel('A1'));
    await paste('Producto\tRegión\tMonto\r\npan\tnorte\t100\r\nleche\tsur\t50\r\nqueso\tnorte\t200\r\nté\tsur\t30\r\narroz\tnorte\t70\r\n');
    await enter('E1', '=SUBTOTALES(9;C2:C6)');
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='filter']");
    await ev(`document.querySelector('.fbtn[data-c="1"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
    await ev(`(() => { const l = [...document.querySelectorAll('.fltpop label[data-t]')].find(x => x.textContent.trim() === 'sur'); l.querySelector('input').click(); document.querySelector('.fltpop [data-a="ok"]').click(); })()`);
    check('D filtro sin sur: E1 = 370', (await t('E1')) === '370', await t('E1'));
    const vis = () => ev("Q.ts('A2 A3 A4 A5 A6')");
    const model = async () => { await sleep(550); return ev(`(() => { const s = Q.sheet(); return ['A2','A3','A4','A5','A6'].map(k => s.cells[k] ? s.cells[k].v : '').join(',') + ' | ' + JSON.stringify(s.filter && s.filter.hidden) })()`); };
    const SORTED = JSON.stringify({ A2: 'arroz', A3: '(no DOM)', A4: 'pan', A5: '(no DOM)', A6: 'queso' });
    const ORIG = JSON.stringify({ A2: 'pan', A3: '(no DOM)', A4: 'queso', A5: '(no DOM)', A6: 'arroz' });
    await clickSel(cellSel('C4')); await clickSel("button[data-cmd='sort-asc']");
    check('D cinta A→Z (clic en C4): visibles arroz, pan, queso; E1 = 370', JSON.stringify(await vis()) === SORTED && (await t('E1')) === '370', { vis: await vis(), E1: await t('E1') });
    check('D cinta A→Z: leche y té siguen en sus filas, ocultas', (await model()) === 'arroz,leche,pan,té,queso | [2,4]', await model());
    await key('z', 2);
    check('D Ctrl+Z tras la cinta: orden original, mismas ocultas, E1 = 370', JSON.stringify(await vis()) === ORIG && (await t('E1')) === '370' && (await model()) === 'pan,leche,queso,té,arroz | [2,4]', { vis: await vis(), E1: await t('E1'), m: await model() });
    await key('y', 2);
    check('D Ctrl+Y rehace el orden con el filtro', JSON.stringify(await vis()) === SORTED && (await t('E1')) === '370', { vis: await vis(), E1: await t('E1') });
    await key('z', 2);
    await ev(`document.querySelector('.fbtn[data-c="2"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
    await ev(`document.querySelector('.fltpop [data-a="asc"]').click()`);
    check('D ▾ de Monto ▸ A a Z: visibles arroz, pan, queso; E1 = 370', JSON.stringify(await vis()) === SORTED && (await t('E1')) === '370', { vis: await vis(), E1: await t('E1') });
    check('D ▾: la barra dice "3 de 5 registros encontrados"', /3 de 5 registros encontrados/.test(await status()), await status());
    await key('z', 2);
    check('D Ctrl+Z tras el ▾: orden original con pan visible y leche/té ocultas', JSON.stringify(await vis()) === ORIG && (await t('E1')) === '370' && (await model()) === 'pan,leche,queso,té,arroz | [2,4]', { vis: await vis(), m: await model() });
    await key('y', 2);
    check('D Ctrl+Y tras el ▾', JSON.stringify(await vis()) === SORTED && (await t('E1')) === '370', { vis: await vis(), E1: await t('E1') });
    await clickSel("button[data-cmd='filter']");
    check('D al quitar el filtro: arroz, leche, pan, té, queso (las filtradas no se movieron)', JSON.stringify(await vis()) === JSON.stringify({ A2: 'arroz', A3: 'leche', A4: 'pan', A5: 'té', A6: 'queso' }), await vis());
    // fila oculta a mano (sin filtro): tampoco se mueve (backlog P1 "Ordenar mueve filas ocultas a mano")
    await clickSel(cellSel('A4')); await clickSel(cellSel('A4'), { button: 'right' }); await ev("Q.menu('Ocultar filas')");
    await clickSel(cellSel('C2')); await clickSel("button[data-cmd='sort-desc']");
    check('D fila 4 oculta a mano: Z→A deja pan en la fila 4 y ordena el resto', (await model()).startsWith('queso,arroz,pan,leche,té'), await model());

    // barra de estado con el formato de la celda activa y General de 11 caracteres; =SUMA hereda la moneda;
    // notación científica al escribir (pedido del coordinador)
    await open();
    await enter('A1', '1'); await enter('A2', '2'); await enter('A3', '5');
    await goto('A1:A3');
    check('D barra de estado: Promedio 2,666666667 (no 15 cifras) y Suma 8', /Promedio: 2,666666667(?!\d)/.test(await status()) && /Suma: 8/.test(await status()), await status());
    await enter('B1', '$1.500'); await enter('B2', '$2.000');
    await goto('B1:B2');
    check('D barra de estado con moneda: Suma $3.500 · Promedio $1.750', /Suma: \$3\.500/.test(await status()) && /Promedio: \$1\.750/.test(await status()), await status());
    await enter('B3', '=SUMA(B1:B2)'); await enter('B4', '=CONTAR(B1:B2)'); await enter('B5', '=MAX(B1:B2)');
    check('D =SUMA y =MAX de moneda se ven en moneda; =CONTAR no', (await t('B3')) === '$3.500' && (await t('B5')) === '$2.000' && (await t('B4')) === '2', await ev("Q.ts('B3 B4 B5')"));
    await enter('C1', '1e3'); await enter('C2', '1,5E-7'); await enter('C3', '=C1*2');
    check('D notación científica: 1e3 → 1,00E+03 y 1,5E-7 → 1,50E-07 (formato Científica)', (await t('C1')) === '1,00E+03' && (await t('C2')) === '1,50E-07' && (await t('C3')) === '2000', await ev("Q.ts('C1 C2 C3')"));
    await clickSel(cellSel('C1'));
    check('D 1e3: el selector de formato dice Científica', (await ev(`document.getElementById('fmtSel').value`)) === 'scientific', await ev(`document.getElementById('fmtSel').value`));

    // capas recortadas en el borde de la fila inmovilizada (P2 de UI-29/UI-41)
    await open();
    await enter('A1', 'N');
    await enter('B2', '=SECUENCIA(60)');
    await clickSel(cellSel('A1'));
    await ev(`document.querySelector("button[data-cmd='freeze']").click()`);
    await ev("Q.menu('Inmovilizar fila superior')");
    await ev(`document.getElementById('gridWrap').scrollTop = 400; 1`); await sleep(150);
    await clickSel(cellSel('B30'));
    const visTop = sel => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}), m = /inset\\(([\\d.]+)px/.exec(getComputedStyle(e).clipPath), r = e.getBoundingClientRect(); return { top: Math.round(r.top), visTop: Math.round(r.top + (m ? +m[1] : 0)), b1: Math.round(Q.td('B1').getBoundingClientRect().bottom) }; })()`);
    const sp = await visTop('#spillBox');
    check('D el borde del desborde B2:B61 no se pinta sobre la fila 1 inmovilizada', sp.top < sp.b1 && Math.abs(sp.visTop - sp.b1) <= 2, sp);
    await goto('B2:B30');   // el cuadro de nombres desplaza hasta B2: se vuelve a bajar para que B2 quede bajo la fila 1
    await ev(`document.getElementById('gridWrap').scrollTop = 400; 1`); await sleep(150);
    const sbx = await visTop('#selBox');
    check('D la selección B2:B30 no se pinta sobre la fila 1 inmovilizada', sbx.top < sbx.b1 && Math.abs(sbx.visTop - sbx.b1) <= 2, sbx);

    // archivo viejo (sin syntax): la migración deja los nombres de función en español (UI-21 paso 6)
    await open(); await captureConfirm('true');
    await openFile('viejo.bassx', JSON.stringify(JSON.stringify({ sheets: [{ name: 'Hoja1', cells: { A1: { v: '=SUM(1.5,2)' }, A2: { v: 1.234 } } }] })));
    await clickSel(cellSel('A1'));
    check('D archivo viejo: A1 = 3,5 y la barra muestra =SUMA(1,5;2)', (await t('A1')) === '3,5' && (await fb()) === '=SUMA(1,5;2)', { A1: await t('A1'), fb: await fb() });

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

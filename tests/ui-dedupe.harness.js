'use strict';
// Arnés de Chrome headless de la ronda 5b de grid-ui-dev: Quitar duplicados (Datos ▸ Herramientas de datos), con la
// "Advertencia antes de quitar duplicados" (rangeWarning), el cuadro con sus casillas y los comandos rechazados.
// Uso: node tests/ui-dedupe.harness.js [--web=<carpeta>]   (sale con código 1 si alguna aserción falla; --web o BX_WEB
// sirven otra copia de web/, como la mutada de tests/ui-mutate.js)
// Entrada real por CDP (clics, Tab/Enter, Esc, Ctrl+Z, Ctrl+clic, clic derecho: L-031). Lecturas: el modelo autoguardado
// (Q.sheet(), 400 ms después del cambio), el texto pintado (Q.t) y el DOM del cuadro. Cada grupo abre un libro nuevo
// (L-039) y fija la selección antes de cada gesto (L-054). Complementa la receta REA UI-45.
const { launch, reporter, sleep } = require('./cdp');

(async () => {
  const b = await launch({ port: 8774, cdpPort: 9342 });
  console.log('web: ' + b.web);
  const { check, done } = reporter();
  const { ev, key, type, clickSel, cellSel, open } = b;
  const nb = () => ev('Q.nb()');
  const t = a => ev(`Q.t(${JSON.stringify(a)})`);
  const goto = async ref => { await ev(`(() => { const n = document.getElementById('nameBox'); n.value = ${JSON.stringify(ref)}; n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`); await sleep(50); };
  const paste = text => ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  const captureConfirm = ans => ev(`window.__conf = []; window.confirm = m => { window.__conf.push(m); return ${ans}; }; window.alert = m => console.log('ALERT ' + m); 1`);
  // contenido del modelo (lo autoguardado): columnas separadas por " | ", filas por ","
  const col = async (letters, r1, r2) => {
    await sleep(550);
    return ev(`(() => { const s = Q.sheet(), out = []; for (const L of ${JSON.stringify(letters)}.split('')) { const a = []; for (let r = ${r1}; r <= ${r2}; r++) { const c = s.cells[L + r]; a.push(c ? c.v : ''); } out.push(a.join(',')); } return out.join(' | '); })()`);
  };
  const isOpen = id => ev(`!!(document.getElementById(${JSON.stringify(id)}) && document.getElementById(${JSON.stringify(id)}).open)`);
  const active = () => ev(`(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : null; })()`);
  const msgText = () => ev(`document.getElementById('msgText').textContent`);
  const labels = () => ev(`[...document.querySelectorAll('#ddList label')].map(l => l.textContent.trim())`);
  const checks = () => ev(`[...document.querySelectorAll('#ddList input')].map(x => x.checked ? 1 : 0).join('')`);
  const okDisabled = () => ev(`document.querySelector('#dedupeDlg .dlg-ok').disabled`);
  const box = n => `#ddList label:nth-child(${n}) input`;
  const DD = "button[data-cmd='dedupe']";
  // la celda activa está sobre el td (getBoundingClientRect, L-023)
  const activeAt = async a => { const x = await ev(`Q.at(${JSON.stringify(a)})`); return x.dTop === 0 && x.dLeft === 0; };
  // escribir una fila como una persona: valor Tab valor Tab valor Enter (Enter vuelve a la columna inicial, L-011)
  const row = async vals => { for (let i = 0; i < vals.length; i++) { await type(vals[i]); await key(i < vals.length - 1 ? 'Tab' : 'Enter'); } };

  try {
    // ---------- Q1: caso de aceptación del backlog (A1:B7 + C1:C7, solo "Nombre") ----------
    await open();
    await clickSel(cellSel('A1'));
    const TABLE = [['Nombre', 'Monto', '1'], ['Ana', '10', '2'], ['Luis', '20', '3'], ['ana', '30', '4'], ['Pedro', '40', '5'], ['Luis', '50', '6'], ['Sofía', '60', '7']];
    for (const r of TABLE) await row(r);
    const ORIG = 'Nombre,Ana,Luis,ana,Pedro,Luis,Sofía | Monto,10,20,30,40,50,60 | 1,2,3,4,5,6,7';
    check('Q1 tabla ingresada con Tab/Enter', (await col('ABC', 1, 7)) === ORIG, await col('ABC', 1, 7));
    await goto('A1:B7');
    await clickSel(DD);
    check('Q1 rango junto a más datos: "Advertencia antes de quitar duplicados"', (await isOpen('warnDlg')) && (await ev(`document.querySelector('#warnDlg h3').textContent`)) === 'Advertencia antes de quitar duplicados', await isOpen('warnDlg'));
    check('Q1 texto de la advertencia ("no se quitarán")', (await ev(`document.getElementById('rwText').textContent`)) === 'Bassxcel encontró datos junto a la selección. Como no ha seleccionado estos datos, no se quitarán.', await ev(`document.getElementById('rwText').textContent`));
    check('Q1 advertencia: Ampliar por omisión; botones Quitar duplicados / Cancelar', (await ev(`document.getElementById('rwExpand').checked`)) && (await ev(`[...document.querySelectorAll('#warnDlg .row button')].map(x => x.textContent).join('/')`)) === 'Quitar duplicados/Cancelar', null);
    await clickSel('#rwCurrent'); await clickSel('#warnDlg .dlg-ok');
    check('Q1 Continuar abre el cuadro "Quitar duplicados"', (await isOpen('dedupeDlg')) && (await ev(`document.querySelector('#dedupeDlg h3').textContent`)) === 'Quitar duplicados', await isOpen('dedupeDlg'));
    check('Q1 texto del cuadro', (await ev(`document.querySelector('#dedupeDlg .dlgbody p').textContent`)) === 'Para eliminar valores duplicados, seleccione una o varias columnas que contengan duplicados.', await ev(`document.querySelector('#dedupeDlg .dlgbody p').textContent`));
    check('Q1 "Mis datos tienen encabezados" marcada (encabezado detectado)', await ev(`document.getElementById('ddHeader').checked`), null);
    check('Q1 columnas Nombre y Monto, todas marcadas', JSON.stringify(await labels()) === '["Nombre","Monto"]' && (await checks()) === '11', { l: await labels(), c: await checks() });
    check('Q1 botones Seleccionar todo / Anular selección / Aceptar / Cancelar', (await ev(`[...document.querySelectorAll('#dedupeDlg button')].map(x => x.textContent).join('/')`)) === 'Seleccionar todo/Anular selección/Aceptar/Cancelar', await ev(`[...document.querySelectorAll('#dedupeDlg button')].map(x => x.textContent).join('/')`));
    await clickSel('#ddNone');
    check('Q1 Anular selección desmarca todo y deshabilita Aceptar', (await checks()) === '00' && (await okDisabled()), { c: await checks(), d: await okDisabled() });
    await ev(`document.querySelector(${JSON.stringify(box(1))}).focus()`);
    await key('Enter');
    check('Q1 Enter sin columnas marcadas no acepta (el cuadro sigue abierto)', (await isOpen('dedupeDlg')) && (await col('ABC', 1, 7)) === ORIG, await isOpen('dedupeDlg'));
    await clickSel('#ddAll');
    check('Q1 Seleccionar todo marca todo y habilita Aceptar', (await checks()) === '11' && !(await okDisabled()), { c: await checks(), d: await okDisabled() });
    await clickSel('#ddNone'); await clickSel(box(1));
    check('Q1 marcar solo Nombre habilita Aceptar', (await checks()) === '10' && !(await okDisabled()), { c: await checks(), d: await okDisabled() });
    await clickSel('#dedupeDlg .dlg-ok');
    check('Q1 mensaje final exacto (2 quitados, 4 únicos)', (await isOpen('msgDlg')) && (await msgText()) === 'Se encontraron y quitaron 2 valores duplicados; quedan 4 valores únicos.', await msgText());
    await clickSel('#msgOk');
    const DEDUP = 'Nombre,Ana,Luis,Pedro,Sofía,, | Monto,10,20,40,60,, | 1,2,3,4,5,6,7';
    check('Q1 A2:B5 = Ana/10, Luis/20, Pedro/40, Sofía/60; A6:B7 vacías; C1:C7 sin cambios', (await col('ABC', 1, 7)) === DEDUP, await col('ABC', 1, 7));
    check('Q1 las filas libres quedan sin celda (ni formato)', await ev(`(() => { const s = Q.sheet().cells; return !s.A6 && !s.B6 && !s.A7 && !s.B7; })()`), null);
    check('Q1 queda seleccionado el rango con datos (A1:B5)', (await nb()) === 'A1:B5', await nb());
    check('Q1 el foco vuelve a la grilla', (await active()) === 'gridWrap', await active());
    await key('z', 2);
    check('Q1 un solo Ctrl+Z restaura todo', (await col('ABC', 1, 7)) === ORIG, await col('ABC', 1, 7));
    await key('y', 2);
    check('Q1 Ctrl+Y rehace', (await col('ABC', 1, 7)) === DEDUP, await col('ABC', 1, 7));
    await key('z', 2);

    // ---------- Q2: Ampliar la selección y sin duplicados ----------
    await goto('A1:B7');
    await clickSel(DD);
    await key('Enter');   // Ampliar (el foco empieza en la opción marcada)
    check('Q2 Ampliar: el cuadro lista las tres columnas de la región', (await isOpen('dedupeDlg')) && JSON.stringify(await labels()) === '["Nombre","Monto","1"]', await labels());
    await clickSel('#dedupeDlg .dlg-ok');
    check('Q2 con C (única) marcada: "No se encontraron valores duplicados."', (await isOpen('msgDlg')) && (await msgText()) === 'No se encontraron valores duplicados.', await msgText());
    await clickSel('#msgOk');
    check('Q2 sin duplicados no cambia nada', (await col('ABC', 1, 7)) === ORIG, await col('ABC', 1, 7));
    check('Q2 sin duplicados queda seleccionada la región (A1:C7)', (await nb()) === 'A1:C7', await nb());
    await goto('A1:B7');
    await clickSel(DD);
    await clickSel('#warnDlg .dlg-ok');
    await clickSel('#ddNone'); await clickSel(box(1)); await clickSel('#dedupeDlg .dlg-ok');
    check('Q2 Ampliar y solo Nombre: C sube con su fila (1,2,3,5,7)', (await msgText()) === 'Se encontraron y quitaron 2 valores duplicados; quedan 4 valores únicos.' && (await col('ABC', 1, 7)) === 'Nombre,Ana,Luis,Pedro,Sofía,, | Monto,10,20,40,60,, | 1,2,3,5,7,,', { m: await msgText(), v: await col('ABC', 1, 7) });
    await clickSel('#msgOk');
    check('Q2 selección final A1:C5', (await nb()) === 'A1:C5', await nb());
    await key('z', 2);
    check('Q2 Ctrl+Z', (await col('ABC', 1, 7)) === ORIG, await col('ABC', 1, 7));

    // ---------- Q3: una celda usa la región; Esc, Cancelar y comandos rechazados no cambian la selección ----------
    await clickSel(cellSel('B3'));
    await clickSel(DD);
    check('Q3 una celda: la región actual, sin advertencia', (await isOpen('dedupeDlg')) && !(await isOpen('warnDlg')) && (await labels()).length === 3, await labels());
    await key('Escape');
    check('Q3 Esc cierra sin cambios y la selección sigue en B3', !(await isOpen('dedupeDlg')) && (await col('ABC', 1, 7)) === ORIG && (await nb()) === 'B3' && (await activeAt('B3')), { nb: await nb() });
    await clickSel(cellSel('B3'));
    await clickSel(DD);
    await clickSel('#dedupeDlg .dlg-cancel');
    check('Q3 Cancelar: sin cambios y la selección sigue en B3', !(await isOpen('dedupeDlg')) && (await col('ABC', 1, 7)) === ORIG && (await nb()) === 'B3', await nb());
    await goto('A1:B7');
    await clickSel(DD);
    await key('Escape');
    check('Q3 Esc en la advertencia: no abre el cuadro y la selección sigue en A1:B7', !(await isOpen('warnDlg')) && !(await isOpen('dedupeDlg')) && (await nb()) === 'A1:B7', await nb());
    // selección múltiple (Ctrl+clic)
    await clickSel(cellSel('A2')); await clickSel(cellSel('C5'), { modifiers: 2 });
    const multi = await ev('Q.extra().length');
    await clickSel(DD);
    check('Q3 selección múltiple: mensaje y no abre el cuadro', (await isOpen('msgDlg')) && (await msgText()) === 'Este comando no se puede usar en selecciones múltiples.' && !(await isOpen('dedupeDlg')), await msgText());
    await clickSel('#msgOk');
    check('Q3 selección múltiple: la selección no cambia', multi > 0 && (await ev('Q.extra().length')) === multi, { antes: multi, despues: await ev('Q.extra().length') });

    // ---------- Q4: sin encabezados (nombres "Columna A…" y la primera fila entra en la comparación) ----------
    await clickSel(cellSel('A2'));
    await clickSel(DD);
    await clickSel('#ddHeader');
    check('Q4 sin encabezados: Columna A, Columna B, Columna C', JSON.stringify(await labels()) === '["Columna A","Columna B","Columna C"]', await labels());
    await clickSel('#ddHeader');
    check('Q4 al volver a marcarla, los nombres del encabezado (y las marcas se conservan)', JSON.stringify(await labels()) === '["Nombre","Monto","1"]' && (await checks()) === '111', { l: await labels(), c: await checks() });
    await clickSel('#ddHeader');
    await clickSel('#ddNone'); await clickSel(box(1)); await clickSel('#dedupeDlg .dlg-ok');
    check('Q4 sin encabezados: la fila 1 cuenta como dato (2 quitados, quedan 5)', (await msgText()) === 'Se encontraron y quitaron 2 valores duplicados; quedan 5 valores únicos.', await msgText());
    await clickSel('#msgOk');
    check('Q4 A1 sigue siendo Nombre', (await col('A', 1, 7)) === 'Nombre,Ana,Luis,Pedro,Sofía,,', await col('A', 1, 7));
    await key('z', 2);
    // datos sin encabezado probable: la casilla empieza desmarcada
    await open();
    await clickSel(cellSel('A1'));
    await paste('uno\r\ndos\r\nuno');
    await clickSel(cellSel('A1')); await clickSel(DD);
    check('Q4 solo texto: encabezados desmarcados y "Columna A"', !(await ev(`document.getElementById('ddHeader').checked`)) && JSON.stringify(await labels()) === '["Columna A"]', await labels());
    await clickSel('#dedupeDlg .dlg-ok');
    check('Q4 sin encabezados quita el "uno" repetido (1 y 2)', (await msgText()) === 'Se encontraron y quitaron 1 valores duplicados; quedan 2 valores únicos.' && (await col('A', 1, 3)) === 'uno,dos,', { m: await msgText(), v: await col('A', 1, 3) });
    await clickSel('#msgOk');

    // ---------- Q5: compara el valor mostrado ----------
    await open();
    await clickSel(cellSel('A1'));
    for (const v of ['Dato', '01/01/2026', '46023', '1.000', '1000', '1000']) { await type(v); await key('Enter'); }
    check('Q5 lo mostrado: 01-01-2026, 46023, 1.000, 1000, 1000', JSON.stringify(await ev("Q.ts('A2 A3 A4 A5 A6')")) === JSON.stringify({ A2: '01-01-2026', A3: '46023', A4: '1.000', A5: '1000', A6: '1000' }), await ev("Q.ts('A2 A3 A4 A5 A6')"));
    await clickSel(cellSel('A3')); await clickSel(DD);
    check('Q5 encabezado detectado (texto sobre un número)', await ev(`document.getElementById('ddHeader').checked`), null);
    await clickSel('#dedupeDlg .dlg-ok');
    check('Q5 fecha vs 46023 y 1.000 vs 1000 son distintos: solo el último 1000 se quita', (await msgText()) === 'Se encontraron y quitaron 1 valores duplicados; quedan 4 valores únicos.', await msgText());
    await clickSel('#msgOk');
    check('Q5 queda 01-01-2026, 46023, 1.000, 1000 (con sus formatos)', JSON.stringify(await ev("Q.ts('A2 A3 A4 A5 A6')")) === JSON.stringify({ A2: '01-01-2026', A3: '46023', A4: '1.000', A5: '1000', A6: '' }), await ev("Q.ts('A2 A3 A4 A5 A6')"));
    check('Q5 la selección queda en A1:A5 y la activa sigue en A3', (await nb()) === 'A1:A5' && (await activeAt('A3')), await nb());

    // ---------- Q6: mayúsculas y acentos ----------
    await open();
    await clickSel(cellSel('A1'));
    await paste('Texto\r\nÁRBOL\r\nárbol\r\nSofía\r\nSofia\r\nsofía');
    await clickSel(cellSel('A1')); await clickSel(DD);
    await ev(`(() => { const h = document.getElementById('ddHeader'); if (!h.checked) h.click(); })()`);
    await clickSel('#dedupeDlg .dlg-ok');
    check('Q6 sin distinguir mayúsculas (ÁRBOL = árbol, Sofía = sofía; Sofia es otra)', (await msgText()) === 'Se encontraron y quitaron 2 valores duplicados; quedan 3 valores únicos.' && (await col('A', 1, 6)) === 'Texto,ÁRBOL,Sofía,Sofia,,', { m: await msgText(), v: await col('A', 1, 6) });
    await clickSel('#msgOk');

    // ---------- Q7: varias columnas, el formato viaja con la fila y lo de fuera del rango no se mueve ----------
    await open();
    await clickSel(cellSel('A1'));
    await paste('Nombre\tCiudad\r\nana\tLima\r\nAna\tQuito\r\nANA\tlima\r\nLuis\tLima\r\nfuera\tabajo');
    await goto('A5:B5'); await key('2', 2);   // Luis/Lima en negrita (Ctrl+2)
    const Q7 = 'Nombre,ana,Ana,ANA,Luis,fuera | Ciudad,Lima,Quito,lima,Lima,abajo';
    await goto('A1:B5');   // la fila 6 queda fuera del rango elegido
    await clickSel(DD);
    check('Q7 sin datos a los lados: sin advertencia', (await isOpen('dedupeDlg')) && !(await isOpen('warnDlg')), null);
    check('Q7 solo texto: encabezados desmarcados al abrir', !(await ev(`document.getElementById('ddHeader').checked`)), null);
    await clickSel('#ddHeader');
    await clickSel('#dedupeDlg .dlg-ok');
    check('Q7 por Nombre y Ciudad: ANA/lima es duplicado de ana/Lima (1 quitado, quedan 3)', (await msgText()) === 'Se encontraron y quitaron 1 valores duplicados; quedan 3 valores únicos.', await msgText());
    await clickSel('#msgOk');
    check('Q7 Luis/Lima sube a la fila 4; la fila 5 queda vacía; la fila 6 (fuera del rango) no se mueve', (await col('AB', 1, 6)) === 'Nombre,ana,Ana,Luis,,fuera | Ciudad,Lima,Quito,Lima,,abajo', await col('AB', 1, 6));
    check('Q7 el formato viaja con la fila (A4 en negrita, A5 sin celda)', await ev(`(() => { const s = Q.sheet().cells; return !!(s.A4 && s.A4.s && s.A4.s.b && s.B4.s.b) && !s.A5 && !s.B5; })()`), await ev('JSON.stringify(Q.sheet().cells.A4)'));
    await key('z', 2);
    check('Q7 Ctrl+Z restaura valores y formato', (await col('AB', 1, 6)) === Q7 && (await ev(`!!Q.sheet().cells.A5.s.b && !(Q.sheet().cells.A4.s && Q.sheet().cells.A4.s.b)`)), await col('AB', 1, 6));
    await goto('A1:B5');
    await clickSel(DD);
    await clickSel('#ddHeader');
    await clickSel(box(1));   // solo Ciudad
    await clickSel('#dedupeDlg .dlg-ok');
    check('Q7 solo por Ciudad: Lima, Quito (2 quitados, quedan 2)', (await msgText()) === 'Se encontraron y quitaron 2 valores duplicados; quedan 2 valores únicos.' && (await col('AB', 1, 6)) === 'Nombre,ana,Ana,,,fuera | Ciudad,Lima,Quito,,,abajo', { m: await msgText(), v: await col('AB', 1, 6) });
    await clickSel('#msgOk');

    // ---------- Q8: fórmulas de las filas que suben (como ordenar) ----------
    await open();
    await clickSel(cellSel('A1'));
    await paste('Nombre\tMonto\tDoble\r\nAna\t10\t=B2*2\r\nLuis\t20\t=B3*2\r\nana\t30\t=B4*2\r\nPedro\t40\t=B5*2');
    await clickSel(cellSel('E1')); await type('=SUMA(B2:B5)'); await key('Enter');
    await clickSel(cellSel('A2')); await clickSel(DD);
    await clickSel('#ddNone'); await clickSel(box(1)); await clickSel('#dedupeDlg .dlg-ok');
    await clickSel('#msgOk');
    check('Q8 la fórmula que sube se ajusta a su fila (C4 = =B4*2 → 80)', (await col('C', 2, 5)) === '=B2*2,=B3*2,=B4*2,' && (await t('C4')) === '80', { v: await col('C', 2, 5), C4: await t('C4') });
    check('Q8 una fórmula de fuera que apunta al rango no se reescribe (E1 = =SUMA(B2:B5) → 70)', (await col('E', 1, 1)) === '=SUMA(B2:B5)' && (await t('E1')) === '70', { v: await col('E', 1, 1), E1: await t('E1') });
    await key('z', 2);
    check('Q8 Ctrl+Z', (await col('C', 2, 5)) === '=B2*2,=B3*2,=B4*2,=B5*2' && (await t('E1')) === '100', await col('C', 2, 5));

    // ---------- Q9: combinaciones en el rango → mensaje y no hace nada ----------
    await open(); await captureConfirm('true');
    await clickSel(cellSel('A1'));
    await paste('N\tX\r\na\t1\r\na\t2\r\nc\t3');
    await goto('A3:B3'); await clickSel("button[data-cmd='merge']");
    const M0 = await col('AB', 1, 4);
    await clickSel(cellSel('A1')); await clickSel(DD);
    check('Q9 combinación en el rango: mensaje y no abre el cuadro', (await isOpen('msgDlg')) && (await msgText()) === 'No se puede hacer eso en una celda combinada.' && !(await isOpen('dedupeDlg')), await msgText());
    await clickSel('#msgOk');
    check('Q9 sin cambios y la selección sigue en A1', (await col('AB', 1, 4)) === M0 && (await nb()) === 'A1' && JSON.parse(await ev('JSON.stringify(Q.sheet().merges)')).length === 1, { v: await col('AB', 1, 4), nb: await nb() });

    // ---------- Q10: filas ocultas o filtradas → aviso y no actúa (provisional) ----------
    await open(); await captureConfirm('true');
    await clickSel(cellSel('A1'));
    await paste('N\tX\r\na\t1\r\na\t2\r\nb\t3');
    const H0 = await col('AB', 1, 4);
    await clickSel(cellSel('A3')); await clickSel(cellSel('A3'), { button: 'right' }); await ev("Q.menu('Ocultar filas')");
    await clickSel(cellSel('A2')); await clickSel(DD);
    check('Q10 fila oculta en el rango: aviso y no abre el cuadro', (await isOpen('msgDlg')) && /^Quitar duplicados todavía no admite filas ocultas o filtradas/.test(await msgText()) && !(await isOpen('dedupeDlg')), await msgText());
    await clickSel('#msgOk');
    check('Q10 sin cambios y la selección sigue en A2', (await col('AB', 1, 4)) === H0 && (await nb()) === 'A2', { v: await col('AB', 1, 4), nb: await nb() });
    await goto('A2:A4'); await clickSel(cellSel('A2'), { button: 'right' }); await ev("Q.menu('Mostrar filas')");
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='filter']");
    await ev(`document.querySelector('.fbtn[data-c="1"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
    await ev(`(() => { const l = [...document.querySelectorAll('.fltpop label[data-t]')].find(x => x.textContent.trim() === '3'); l.querySelector('input').click(); document.querySelector('.fltpop [data-a="ok"]').click(); })()`);
    await clickSel(cellSel('A2')); await clickSel(DD);
    check('Q10 fila filtrada en el rango: el mismo aviso', (await isOpen('msgDlg')) && /^Quitar duplicados todavía no admite filas ocultas o filtradas/.test(await msgText()), await msgText());
    await clickSel('#msgOk');
    check('Q10 con filtro: sin cambios', (await col('AB', 1, 4)) === H0, await col('AB', 1, 4));
    await clickSel("button[data-cmd='filter']");
    await clickSel(cellSel('A2')); await clickSel(DD);
    await clickSel('#ddNone'); await clickSel(box(1)); await clickSel('#dedupeDlg .dlg-ok');
    check('Q10 sin filas ocultas sí actúa (a repetida: 1 quitado, quedan 2)', (await msgText()) === 'Se encontraron y quitaron 1 valores duplicados; quedan 2 valores únicos.' && (await col('AB', 1, 4)) === 'N,a,b, | X,1,3,', { m: await msgText(), v: await col('AB', 1, 4) });
    await clickSel('#msgOk');

    // ---------- Q11: actúa en la hoja activa ----------
    await clickSel('.tab.add');
    await clickSel(cellSel('A1'));
    await paste('K\r\nx\r\nx');
    await clickSel(cellSel('A1')); await clickSel(DD); await clickSel('#dedupeDlg .dlg-ok'); await clickSel('#msgOk');
    check('Q11 en Hoja2 quita su duplicado', (await col('A', 1, 3)) === 'K,x,', await col('A', 1, 3));
    check('Q11 Hoja1 no cambia', (await ev(`(() => { const s = Q.store(); const h = s.sheets[0].cells; return ['A1','A2','A3','A4'].map(k => h[k] ? h[k].v : '').join(','); })()`)) === 'N,a,b,', null);

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

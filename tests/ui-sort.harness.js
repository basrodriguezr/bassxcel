'use strict';
// Arnés de Chrome headless de la ronda 5a de grid-ui-dev: ordenar por varios niveles (cuadro "Ordenar", cuadro de
// diálogo reutilizable dlgBox, "Advertencia antes de ordenar", combinaciones y opciones).
// Uso: node tests/ui-sort.harness.js [--web=<carpeta>]   (sale con código 1 si alguna aserción falla; --web o BX_WEB
// sirven otra copia de web/, como la mutada de tests/ui-mutate.js)
// Entrada real por CDP (clics, Tab/Enter, Esc, Ctrl+Z, clic derecho: L-031); las opciones de los <select> del cuadro se
// eligen como lo hace REA `select_option` (valor + evento change). Lecturas: el modelo autoguardado (Q.sheet(), 400 ms
// después del cambio) y el DOM del cuadro. Cada grupo abre un libro nuevo (L-039). Complementa la receta REA UI-44.
const { launch, reporter, sleep } = require('./cdp');

(async () => {
  const b = await launch({ port: 8773, cdpPort: 9341 });
  console.log('web: ' + b.web);
  const { check, done } = reporter();
  const { ev, key, type, clickSel, clickText, cellSel, open } = b;
  const nb = () => ev('Q.nb()');
  const goto = async ref => { await ev(`(() => { const n = document.getElementById('nameBox'); n.value = ${JSON.stringify(ref)}; n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`); await sleep(50); };
  const paste = text => ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  const captureConfirm = ans => ev(`window.__conf = []; window.confirm = m => { window.__conf.push(m); return ${ans}; }; window.alert = m => console.log('ALERT ' + m); 1`);
  // contenido del modelo (lo autoguardado): las filas ocultas también se leen (L-034)
  const col = async (letters, r1, r2) => {
    await sleep(550);
    return ev(`(() => { const s = Q.sheet(), out = []; for (const L of ${JSON.stringify(letters)}.split('')) { const a = []; for (let r = ${r1}; r <= ${r2}; r++) { const c = s.cells[L + r]; a.push(c ? c.v : ''); } out.push(a.join(',')); } return out.join(' | '); })()`);
  };
  const isOpen = id => ev(`!!(document.getElementById(${JSON.stringify(id)}) && document.getElementById(${JSON.stringify(id)}).open)`);
  const active = () => ev(`(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : null; })()`);
  const inDlg = id => ev(`!!(document.activeElement && document.activeElement.closest('#' + ${JSON.stringify(id)}))`);
  const levels = () => ev(`[...document.querySelectorAll('#sortDlg .srt-lvl')].map(r => [r.querySelector('.srt-lbl').textContent, r.querySelector('.srt-col').selectedOptions[0] ? r.querySelector('.srt-col').selectedOptions[0].textContent : '', r.querySelector('.srt-ord').selectedOptions[0].textContent].join('/'))`);
  const options = sel => ev(`[...document.querySelector(${JSON.stringify(sel)}).options].map(o => o.textContent)`);
  // como REA select_option: elige el valor y dispara change
  const choose = (sel, value) => ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.focus(); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  const msgText = () => ev(`document.getElementById('msgText').textContent`);
  const disabled = sel => ev(`document.querySelector(${JSON.stringify(sel)}).disabled`);
  const lvl = n => `#sortDlg .srt-lvl:nth-child(${n})`;
  // la celda activa está sobre el td (getBoundingClientRect, L-023)
  const activeAt = async a => { const x = await ev(`Q.at(${JSON.stringify(a)})`); return x.dTop === 0 && x.dLeft === 0; };
  // escribir una fila como una persona: valor Tab valor Tab valor Enter (Enter vuelve a la columna inicial, L-011)
  const row = async vals => { for (let i = 0; i < vals.length; i++) { await type(vals[i]); await key(i < vals.length - 1 ? 'Tab' : 'Enter'); } };

  try {
    // ---------- S1: Región A a Z y luego Monto de mayor a menor (aceptación del backlog) ----------
    await open();
    await clickSel(cellSel('A1'));
    const TABLE = [['Región', 'Producto', 'Monto'], ['Sur', 'Pan', '100'], ['Norte', 'Leche', '50'], ['Centro', 'Queso', '200'], ['Sur', 'Té', '30'],
      ['Norte', 'Arroz', '70'], ['Centro', 'Café', '120'], ['Sur', 'Azúcar', '200'], ['Norte', 'Sal', '90']];
    for (const r of TABLE) await row(r);
    await goto('A1:C1'); await key('2', 2);   // encabezado en negrita (Ctrl+2; Ctrl+N está reservado en el navegador)
    const ORIG = 'Sur,Norte,Centro,Sur,Norte,Centro,Sur,Norte | Pan,Leche,Queso,Té,Arroz,Café,Azúcar,Sal | 100,50,200,30,70,120,200,90';
    check('S1 tabla ingresada con Tab/Enter', (await col('ABC', 2, 9)) === ORIG, await col('ABC', 2, 9));
    await clickSel(cellSel('A3'));
    await clickSel("button[data-cmd='sort']");
    check('S1 la cinta abre el cuadro Ordenar', await isOpen('sortDlg'), null);
    check('S1 "Mis datos tienen encabezados" preseleccionada', await ev(`document.getElementById('srtHeader').checked`), null);
    check('S1 un nivel: Ordenar por Región, A a Z', JSON.stringify(await levels()) === '["Ordenar por/Región/A a Z"]', await levels());
    check('S1 columnas con el texto del encabezado', JSON.stringify(await options(lvl(1) + ' .srt-col')) === '["Región","Producto","Monto"]', await options(lvl(1) + ' .srt-col'));
    check('S1 Ordenar según: solo "Valores de celda"', JSON.stringify(await options(lvl(1) + ' .srt-on')) === '["Valores de celda"]', await options(lvl(1) + ' .srt-on'));
    check('S1 con un nivel, Eliminar nivel, ▲ y ▼ deshabilitados', (await disabled('#srtDel')) && (await disabled('#srtUp')) && (await disabled('#srtDown')), null);
    check('S1 el foco empieza en la columna del primer nivel', (await active()) === 'srt-col', await active());
    await clickSel('#srtAdd');
    check('S1 Agregar nivel: "Luego por" sin columna', JSON.stringify(await levels()) === '["Ordenar por/Región/A a Z","Luego por//A a Z"]', await levels());
    await key('Enter');
    check('S1 Aceptar con un nivel sin columna: mensaje y el cuadro sigue abierto', (await isOpen('msgDlg')) && (await isOpen('sortDlg')) && /^Todos los criterios de ordenación deben tener una columna especificada/.test(await msgText()), await msgText());
    await clickSel('#msgOk');
    check('S1 tras el mensaje el foco vuelve al cuadro Ordenar', await inDlg('sortDlg'), await active());
    await choose(lvl(2) + ' .srt-col', '2');
    check('S1 Monto es numérica: De menor a mayor / De mayor a menor', JSON.stringify(await options(lvl(2) + ' .srt-ord')) === '["De menor a mayor","De mayor a menor"]', await options(lvl(2) + ' .srt-ord'));
    check('S1 la opción vacía desaparece al elegir columna', JSON.stringify(await options(lvl(2) + ' .srt-col')) === '["Región","Producto","Monto"]', await options(lvl(2) + ' .srt-col'));
    await choose(lvl(2) + ' .srt-ord', 'desc');
    await key('Enter');   // Enter con el foco en una lista = Aceptar
    check('S1 Enter acepta y cierra el cuadro', !(await isOpen('sortDlg')), null);
    const SORTED = 'Centro,Centro,Norte,Norte,Norte,Sur,Sur,Sur | Queso,Café,Sal,Arroz,Leche,Azúcar,Pan,Té | 200,120,90,70,50,200,100,30';
    check('S1 Región A a Z y luego Monto de mayor a menor → orden exacto', (await col('ABC', 2, 9)) === SORTED, await col('ABC', 2, 9));
    check('S1 el encabezado no se movió (A1 = Región en negrita)', (await ev(`JSON.stringify(Q.sheet().cells.A1)`)) === JSON.stringify({ v: 'Región', s: { b: true } }), await ev(`JSON.stringify(Q.sheet().cells.A1)`));
    check('S1 queda seleccionada la región sin el encabezado', (await nb()) === 'A2:C9', await nb());
    check('S1 el foco vuelve a la grilla', (await active()) === 'gridWrap', await active());
    // P2 de qa ronda 5a: la activa se queda donde estaba (A3) y reabrir sobre A2:C9 conserva los encabezados
    check('S1 la celda activa se queda donde estaba (A3) dentro de la región', await activeAt('A3'), await ev("Q.at('A3')"));
    await clickSel("button[data-cmd='sort']");
    check('S1 reabrir sobre la selección que dejó el orden: encabezados marcados y nombres de columna', (await ev(`document.getElementById('srtHeader').checked`)) && JSON.stringify(await options(lvl(1) + ' .srt-col')) === '["Región","Producto","Monto"]', await options(lvl(1) + ' .srt-col'));
    await key('Escape');
    check('S1 Esc al reabrir: sin cambios y la selección sigue en A2:C9', (await nb()) === 'A2:C9' && (await col('ABC', 2, 9)) === SORTED, await nb());
    await key('z', 2);
    check('S1 Ctrl+Z restaura en un paso', (await col('ABC', 2, 9)) === ORIG, await col('ABC', 2, 9));
    await key('y', 2);
    check('S1 Ctrl+Y rehace', (await col('ABC', 2, 9)) === SORTED, await col('ABC', 2, 9));
    await key('z', 2);
    // el cuadro recuerda los niveles de la hoja; Esc cancela sin cambios
    await clickSel(cellSel('B5'));
    await clickSel("button[data-cmd='sort']");
    check('S1 el cuadro recuerda los niveles de la hoja', JSON.stringify(await levels()) === '["Ordenar por/Región/A a Z","Luego por/Monto/De mayor a menor"]', await levels());
    await key('Escape');
    check('S1 Esc cierra sin ordenar', !(await isOpen('sortDlg')) && (await col('ABC', 2, 9)) === ORIG, await col('ABC', 2, 9));
    // otra hoja: sus propios niveles
    await clickSel('.tab.add');
    await clickSel(cellSel('A1'));
    await row(['N', 'M']); await row(['b', '2']); await row(['a', '1']);
    await clickSel(cellSel('B2'));
    await clickSel("button[data-cmd='sort']");
    check('S1 en otra hoja el cuadro empieza con un nivel (columna activa)', JSON.stringify(await levels()) === '["Ordenar por/M/De menor a mayor"]', await levels());
    await key('Escape');
    await clickText('.tab', 'Hoja1');
    await clickSel(cellSel('A2'));
    await clickSel("button[data-cmd='sort']");
    check('S1 de vuelta en Hoja1 siguen sus dos niveles', (await levels()).length === 2, await levels());
    await key('Escape');
    // fila oculta a mano: no se mueve (documentación de Excel)
    await clickSel(cellSel('A5')); await clickSel(cellSel('A5'), { button: 'right' }); await ev("Q.menu('Ocultar filas')");
    await clickSel(cellSel('A2'));
    await clickSel("button[data-cmd='sort']");
    await key('Enter');
    check('S1 fila 5 oculta (Té) no se mueve; las demás se ordenan entre sí', (await col('AB', 2, 9)) === 'Centro,Centro,Norte,Sur,Norte,Norte,Sur,Sur | Queso,Café,Sal,Té,Arroz,Leche,Azúcar,Pan', await col('AB', 2, 9));
    await key('z', 2);
    check('S1 Ctrl+Z con la fila oculta', (await col('ABC', 2, 9)) === ORIG, await col('ABC', 2, 9));
    // menú contextual ▸ Orden personalizado…
    await clickSel(cellSel('B3')); await clickSel(cellSel('B3'), { button: 'right' });
    await ev("Q.menu('Orden personalizado…')");
    check('S1 menú contextual ▸ Orden personalizado… abre el cuadro', await isOpen('sortDlg'), null);
    await key('Escape');

    // ---------- S2: vacías al final y distinguir mayúsculas ----------
    await open();
    await clickSel(cellSel('A1'));
    await paste('Clave\tMonto\r\nb\t5\r\nA\t3\r\na\t\r\nB\t7');
    await clickSel(cellSel('B2')); await clickSel("button[data-cmd='sort-desc']");
    check('S2 Z→A por Monto: la vacía queda al final (7, 5, 3, vacía)', (await col('AB', 2, 5)) === 'B,b,A,a | 7,5,3,', await col('AB', 2, 5));
    await key('z', 2);
    await clickSel(cellSel('B2')); await clickSel("button[data-cmd='sort-asc']");
    check('S2 A→Z por Monto: la vacía también al final (3, 5, 7, vacía)', (await col('AB', 2, 5)) === 'A,b,B,a | 3,5,7,', await col('AB', 2, 5));
    await key('z', 2);
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort']");
    check('S2 Clave es de texto: A a Z', JSON.stringify(await levels()) === '["Ordenar por/Clave/A a Z"]', await levels());
    await key('Enter');
    check('S2 sin distinguir mayúsculas: orden estable (A, a, b, B)', (await col('A', 2, 5)) === 'A,a,b,B', await col('A', 2, 5));
    await key('z', 2);
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort']");
    await clickSel('#srtOpts');
    check('S2 Opciones… abre un cuadro encima del de Ordenar', (await isOpen('sortOptDlg')) && (await isOpen('sortDlg')), null);
    check('S2 Opciones: orientación de arriba hacia abajo por omisión', await ev(`document.getElementById('soTB').checked && !document.getElementById('soCase').checked`), null);
    await key('Escape');
    check('S2 Esc en Opciones cierra solo Opciones', !(await isOpen('sortOptDlg')) && (await isOpen('sortDlg')), null);
    await clickSel('#srtOpts');
    await clickSel('#soCase');
    await clickSel('#sortOptDlg .dlg-ok');
    await clickSel('#sortDlg .dlg-ok');
    check('S2 distinguir mayúsculas: la minúscula antes (a, A, b, B)', (await col('A', 2, 5)) === 'a,A,b,B', await col('A', 2, 5));
    await key('z', 2);
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort']");
    await choose(lvl(1) + ' .srt-ord', 'desc');
    await key('Enter');
    check('S2 distinguir mayúsculas en descendente: B, b, A, a', (await col('A', 2, 5)) === 'B,b,A,a', await col('A', 2, 5));

    // ---------- S3: de izquierda a derecha ----------
    await open();
    await clickSel(cellSel('A1'));
    await paste('3\t1\t2\r\nx\ty\tz');
    await goto('A1:C2');
    await clickSel("button[data-cmd='sort']");
    check('S3 sin texto arriba: encabezados desmarcados', !(await ev(`document.getElementById('srtHeader').checked`)), null);
    await clickSel('#srtOpts'); await clickSel('#soLR'); await key('Enter');
    check('S3 izquierda a derecha: claves "Fila 1", "Fila 2" y encabezados deshabilitados', JSON.stringify(await options(lvl(1) + ' .srt-col')) === '["Fila 1","Fila 2"]' && (await disabled('#srtHeader')) && (await ev(`document.getElementById('srtColHead').textContent`)) === 'Fila', await options(lvl(1) + ' .srt-col'));
    check('S3 Fila 1 es numérica', JSON.stringify(await options(lvl(1) + ' .srt-ord')) === '["De menor a mayor","De mayor a menor"]', await options(lvl(1) + ' .srt-ord'));
    // al cerrarse Opciones el foco vuelve a su botón, y Enter sobre un botón lo pulsa (como en Windows): se acepta con clic
    check('S3 al cerrar Opciones el foco vuelve al botón Opciones…', (await active()) === 'srtOpts', await active());
    await clickSel('#sortDlg .dlg-ok');
    check('S3 ordena las columnas por la fila 1 (1, 2, 3 / y, z, x)', (await col('ABC', 1, 2)) === '1,y | 2,z | 3,x', await col('ABC', 1, 2));
    await key('z', 2);
    check('S3 Ctrl+Z', (await col('ABC', 1, 2)) === '3,x | 1,y | 2,z', await col('ABC', 1, 2));
    // una columna oculta no se mueve al ordenar columnas
    await clickSel(cellSel('B1')); await clickSel(cellSel('B1'), { button: 'right' }); await ev("Q.menu('Ocultar columnas')");
    await goto('A1:C2');
    await clickSel("button[data-cmd='sort']");
    check('S3 el cuadro recuerda la orientación', (await ev(`document.getElementById('srtColHead').textContent`)) === 'Fila', null);
    await key('Enter');
    check('S3 la columna B oculta no se mueve (2,z | 1,y | 3,x)', (await col('ABC', 1, 2)) === '2,z | 1,y | 3,x', await col('ABC', 1, 2));

    // ---------- S4: Advertencia antes de ordenar ----------
    await open();
    await clickSel(cellSel('A1'));
    await paste('Región\tMonto\tExtra\r\nb\t2\tq\r\na\t1\tp\r\nc\t3\tr');
    const W0 = 'b,a,c | 2,1,3 | q,p,r';
    await goto('B2:B4'); await clickSel("button[data-cmd='sort-asc']");
    check('S4 rango junto a más datos: "Advertencia antes de ordenar"', (await isOpen('warnDlg')) && (await ev(`document.querySelector('#warnDlg h3').textContent`)) === 'Advertencia antes de ordenar', null);
    check('S4 texto de la advertencia', (await ev(`document.getElementById('rwText').textContent`)) === 'Bassxcel encontró datos junto a la selección. Como no ha seleccionado estos datos, no se ordenarán.', await ev(`document.getElementById('rwText').textContent`));
    check('S4 "Ampliar la selección" por omisión; botones Ordenar / Cancelar', (await ev(`document.getElementById('rwExpand').checked`)) && (await ev(`[...document.querySelectorAll('#warnDlg .row button')].map(x => x.textContent).join('/')`)) === 'Ordenar/Cancelar', null);
    await clickSel('#warnDlg .dlg-ok');
    check('S4 Ampliar: se ordenan las filas completas (a,b,c | 1,2,3 | p,q,r)', (await col('ABC', 2, 4)) === 'a,b,c | 1,2,3 | p,q,r', await col('ABC', 2, 4));
    check('S4 Ampliar selecciona la región sin el encabezado', (await nb()) === 'A2:C4', await nb());
    await key('z', 2);
    await goto('B2:B4'); await clickSel("button[data-cmd='sort-asc']");
    await clickSel('#rwCurrent'); await clickSel('#warnDlg .dlg-ok');
    check('S4 Continuar con la selección actual: solo B (b,a,c | 1,2,3 | q,p,r)', (await col('ABC', 2, 4)) === 'b,a,c | 1,2,3 | q,p,r', await col('ABC', 2, 4));
    check('S4 Continuar conserva la selección', (await nb()) === 'B2:B4', await nb());
    await key('z', 2);
    await goto('B2:B4'); await clickSel("button[data-cmd='sort-asc']");
    await key('Escape');
    check('S4 Esc en la advertencia: no ordena', !(await isOpen('warnDlg')) && (await col('ABC', 2, 4)) === W0, await col('ABC', 2, 4));
    check('S4 Esc en la advertencia: la selección no cambia (B2:B4)', (await nb()) === 'B2:B4', await nb());
    await goto('B2:B4'); await clickSel("button[data-cmd='sort']");
    check('S4 el cuadro Ordenar también advierte primero', (await isOpen('warnDlg')) && !(await isOpen('sortDlg')), null);
    await key('Enter');
    check('S4 Enter amplía y abre Ordenar con encabezados (Región, Monto, Extra)', (await isOpen('sortDlg')) && JSON.stringify(await options(lvl(1) + ' .srt-col')) === '["Región","Monto","Extra"]', await isOpen('sortDlg'));
    // foco atrapado: Mayús+Tab desde el primer control va al último y Tab lo devuelve
    await ev(`document.getElementById('srtAdd').focus()`);
    await key('Tab', 8);
    check('S4 foco atrapado: Mayús+Tab desde el primero va a Cancelar', (await active()) === 'dlg-cancel', await active());
    await key('Tab');
    check('S4 foco atrapado: Tab desde Cancelar vuelve al primero', (await active()) === 'srtAdd', await active());
    let inside = true;
    for (let i = 0; i < 14; i++) { await key('Tab'); inside = inside && await inDlg('sortDlg'); }
    check('S4 foco atrapado: 14 Tab siguen dentro del cuadro', inside, await active());
    await key('Escape');

    // ---------- S5: combinaciones ----------
    await open(); await captureConfirm('true');
    await clickSel(cellSel('A1'));
    await paste('Nombre\tX\tY\r\nb\t1\t\r\na\t2\t\r\nc\t3\t\r\nd\t4\t');
    await goto('B3:C3'); await clickSel("button[data-cmd='merge']");
    const M0 = 'b,a,c,d | 1,2,3,4';
    const MSG = 'Para ello, todas las celdas combinadas deben tener el mismo tamaño.';
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort-desc']");
    check('S5 combinación B3:C3 en la tabla: mensaje de Excel', (await isOpen('msgDlg')) && (await msgText()) === MSG, await msgText());
    await clickSel('#msgOk');
    const mergesOf = () => ev('JSON.stringify((Q.sheet().merges || []).map(m => [m.r1, m.c1, m.r2, m.c2]))');
    check('S5 y no ordena nada', (await col('AB', 2, 5)) === M0 && (await mergesOf()) === '[[2,1,2,2]]', { v: await col('AB', 2, 5), m: await mergesOf() });
    check('S5 el orden rechazado no cambia la selección (sigue en A2)', (await nb()) === 'A2' && (await activeAt('A2')), await nb());
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort']"); await key('Enter');
    check('S5 también desde el cuadro Ordenar', (await isOpen('msgDlg')) && (await msgText()) === MSG, await msgText());
    await clickSel('#msgOk');
    check('S5 rechazado desde el cuadro: la selección sigue en A2', (await nb()) === 'A2', await nb());
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='filter']");
    await ev(`document.querySelector('.fbtn[data-c="0"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
    await ev(`document.querySelector('.fltpop [data-a="asc"]').click()`);
    check('S5 también desde el ▾ del filtro', (await isOpen('msgDlg')) && (await msgText()) === MSG, await msgText());
    await clickSel('#msgOk');
    check('S5 sin cambios tras los tres intentos', (await col('AB', 2, 5)) === M0, await col('AB', 2, 5));
    // ▾ ▸ Orden personalizado…: encabezado fijo y la columna del ▾ en el primer nivel
    await ev(`document.querySelector('.fbtn[data-c="1"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
    await ev(`document.querySelector('.fltpop [data-a="custom"]').click()`);
    check('S5 ▾ ▸ Orden personalizado…: cuadro con X en el primer nivel y encabezado fijo', (await isOpen('sortDlg')) && JSON.stringify(await levels()) === '["Ordenar por/X/De menor a mayor"]' && (await disabled('#srtHeader')) && (await ev(`document.getElementById('srtHeader').checked`)), await levels());
    await key('Escape');
    // todas las filas con la misma combinación: se puede ordenar y las combinaciones no cambian
    await open(); await captureConfirm('true');
    await clickSel(cellSel('A1'));
    await paste('b\t1\r\na\t2\r\nc\t3');
    for (const r of [1, 2, 3]) { await goto(`B${r}:C${r}`); await clickSel("button[data-cmd='merge']"); }
    await clickSel(cellSel('A1')); await clickSel("button[data-cmd='sort-asc']");
    check('S5 combinaciones del mismo tamaño en cada fila: ordena sin mensaje', !(await isOpen('msgDlg')) && (await col('AB', 1, 3)) === 'a,b,c | 2,1,3' && JSON.parse(await ev('JSON.stringify(Q.sheet().merges)')).length === 3, { msg: await isOpen('msgDlg'), v: await col('AB', 1, 3) });

    // ---------- S6: botones del cuadro, fechas y 64 niveles ----------
    await open();
    await clickSel(cellSel('A1'));
    await row(['Fecha', 'Texto', 'Monto']); await row(['05/01/2026', 'uno', '10']); await row(['10/01/2026', 'dos', '20']); await row(['15/01/2026', 'tres', '30']);
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort']");
    check('S6 columna con formato de fecha: De más antiguos a más recientes', JSON.stringify(await options(lvl(1) + ' .srt-ord')) === '["De más antiguos a más recientes","De más recientes a más antiguos"]', await options(lvl(1) + ' .srt-ord'));
    await clickSel('#srtCopy');
    check('S6 Copiar nivel duplica el elegido debajo', JSON.stringify(await levels()) === '["Ordenar por/Fecha/De más antiguos a más recientes","Luego por/Fecha/De más antiguos a más recientes"]', await levels());
    await clickSel('#sortDlg .dlg-ok');
    check('S6 la misma columna dos veces: mensaje de criterio duplicado', (await isOpen('msgDlg')) && /^Fecha se está ordenando por Valores de celda más de una vez/.test(await msgText()), await msgText());
    await clickSel('#msgOk');
    await choose(lvl(2) + ' .srt-col', '2');
    await clickSel(lvl(2) + ' .srt-lbl');
    await clickSel('#srtUp');
    check('S6 ▲ sube el nivel elegido (Monto primero)', JSON.stringify(await levels()) === '["Ordenar por/Monto/De menor a mayor","Luego por/Fecha/De más antiguos a más recientes"]', await levels());
    check('S6 ▲ deshabilitado en el primero; ▼ habilitado', (await disabled('#srtUp')) && !(await disabled('#srtDown')), null);
    await clickSel('#srtDown');
    check('S6 ▼ lo vuelve a bajar', JSON.stringify(await levels()) === '["Ordenar por/Fecha/De más antiguos a más recientes","Luego por/Monto/De menor a mayor"]', await levels());
    await clickSel('#srtDel');
    check('S6 Eliminar nivel quita el elegido y queda uno', JSON.stringify(await levels()) === '["Ordenar por/Fecha/De más antiguos a más recientes"]' && (await disabled('#srtDel')), await levels());
    for (let i = 1; i < 64; i++) await ev(`document.getElementById('srtAdd').click()`);
    check('S6 hasta 64 niveles: Agregar y Copiar se deshabilitan', (await levels()).length === 64 && (await disabled('#srtAdd')) && (await disabled('#srtCopy')), (await levels()).length);
    check('S6 el foco sigue dentro del cuadro al deshabilitarse Agregar', await inDlg('sortDlg'), await active());
    await key('Escape');
    check('S6 Esc cierra el cuadro con 64 niveles', !(await isOpen('sortDlg')), null);
    await clickSel(cellSel('A2')); await clickSel("button[data-cmd='sort']");
    await choose(lvl(1) + ' .srt-ord', 'desc'); await key('Enter');
    check('S6 fechas de más recientes a más antiguas', (await col('B', 2, 4)) === 'tres,dos,uno', await col('B', 2, 4));

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

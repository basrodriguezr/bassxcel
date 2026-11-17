'use strict';
// Arnés de Chrome headless de la ronda 2c de grid-ui-dev: rangos con nombre en la UI y Bx.checkFormula al confirmar.
// Uso: node tests/ui-names.harness.js [--web=<carpeta>]   (sale con código 1 si alguna aserción falla; --web o BX_WEB
// sirven otra copia de web/, como la mutada de tests/ui-mutate.js)
// Entrada real por CDP (clics y teclas: cuadro de nombres, Ctrl+F3, F3, Ctrl+Mayús+F3, Tab del autocompletado; L-031);
// las opciones de menú se eligen por su texto (L-044); lecturas con el puente de qa-serve.js (Q.*). Cada grupo abre
// un libro nuevo (L-039). Complementa los escenarios REA UI-34..UI-39 de tests/ui-scenarios.md.
const { launch, reporter, sleep } = require('./cdp');

(async () => {
  const b = await launch({ port: 8772, cdpPort: 9340 });
  console.log('web: ' + b.web);
  const { check, done } = reporter();
  const { ev, key, type, enter, click, clickSel, clickText, cellSel, open } = b;
  const t = a => ev(`Q.t(${JSON.stringify(a)})`);
  const nb = () => ev('Q.nb()');
  const fb = () => ev('Q.fb()');
  const names = async () => { await sleep(500); const s = await ev('Q.store()'); return (s && s.names) || []; };
  const refOf = async (n, scope = null) => { const d = (await names()).find(x => x.name === n && (x.scope || null) === scope); return d ? d.ref : null; };
  // cuadro de nombres con el teclado real: clic (el texto queda seleccionado), escribir y Enter
  const box = async text => { await clickSel('#nameBox'); await type(text); await key('Enter'); await sleep(80); };
  const msgOpen = () => ev(`document.getElementById('msgDlg').open`);
  const msgText = () => ev(`document.getElementById('msgText').textContent`);
  const dlgOpen = id => ev(`document.getElementById(${JSON.stringify(id)}).open`);
  const tabOn = () => ev(`document.querySelector('.tab.on').textContent`);
  const nmRows = () => ev(`[...document.querySelectorAll('#nmTable tbody tr')].map(tr => [...tr.children].map(td => td.textContent))`);
  const selectAllIn = async sel => { await clickSel(sel); await key('a', 2); };
  const captureConfirm = ans => ev(`window.__conf = []; window.confirm = m => { window.__conf.push(m); return ${ans}; }; window.alert = m => console.log('ALERT ' + m); 1`);
  const data = async () => { await enter('A1', 'Monto'); await enter('A2', '10'); await enter('A3', '20'); await enter('A4', '30'); await enter('A5', '40'); };

  try {
    // ---------- N1: cuadro de nombres (UI-34) ----------
    await open();
    await data();
    await box('A2:A5');
    check('N1 el cuadro de nombres va a A2:A5', (await nb()) === 'A2:A5', await nb());
    await box('Ventas');
    check('N1 escribir Ventas + Enter define el nombre y el cuadro lo muestra', (await nb()) === 'Ventas', await nb());
    check('N1 Ventas = Hoja1!$A$2:$A$5 (de libro, en el autoguardado)', (await refOf('Ventas')) === '=Hoja1!$A$2:$A$5', await names());
    await type('x');
    check('N1 la celda activa queda en A2 (escribir después de definir)', (await ev('Q.ed().display')) === 'block' && (await ev(`Q.at('A2').dTop`)) === 0, await ev(`Q.at('A2')`));
    await key('Escape');
    await enter('C1', '=SUMA(Ventas)');
    check('N1 =SUMA(Ventas) = 100', (await t('C1')) === '100', await t('C1'));
    await clickSel(cellSel('C3'));
    check('N1 con C3 el cuadro muestra C3', (await nb()) === 'C3', await nb());
    await box('ventas');
    check('N1 un nombre existente (sin distinguir mayúsculas) selecciona su rango', (await nb()) === 'Ventas', await nb());
    await box('mi nombre');
    check('N1 nombre con espacio → mensaje del motor y no se define', (await msgOpen()) && /espacios/.test(await msgText()), await msgText());
    await clickSel('#msgOk');
    check('N1 tras Aceptar, el foco vuelve al cuadro de nombres con lo escrito', (await ev('document.activeElement.id')) === 'nameBox' && (await nb()) === 'mi nombre', { f: await ev('document.activeElement.id'), nb: await nb() });
    await key('Escape');
    await box('B5');
    check('N1 B5 va a la celda', (await nb()) === 'B5', await nb());
    await box('A1');
    check('N1 A1 (parece referencia) no se define: va a A1', (await nb()) === 'A1' && (await names()).length === 1, await names());
    await clickSel('.tab.add');
    await enter('B2', 'en hoja 2');
    await clickText('.tab', 'Hoja1');
    await box('Hoja2!B2:C3');
    check('N1 Hoja2!B2:C3 cambia de hoja y selecciona el rango', (await tabOn()) === 'Hoja2' && (await nb()) === 'B2:C3', { tab: await tabOn(), nb: await nb() });
    await box('Ventas');
    check('N1 desde Hoja2, Ventas vuelve a Hoja1 con su rango', (await tabOn()) === 'Hoja1' && (await nb()) === 'Ventas', { tab: await tabOn(), nb: await nb() });
    await box('Hoja9!A1');
    check('N1 hoja inexistente → "Referencia no válida."', (await msgOpen()) && (await msgText()) === 'Referencia no válida.', await msgText());
    await clickSel('#msgOk');
    await clickSel('#nameBoxBtn');
    const menuItems = await ev(`[...document.querySelectorAll('#menu div')].map(d => d.textContent)`);
    check('N1 ▾ lista los nombres', JSON.stringify(menuItems) === '["Ventas"]', menuItems);
    await clickSel(cellSel('E8'));
    await clickSel('#nameBoxBtn'); await clickText('#menu div', 'Ventas');
    check('N1 elegir Ventas en la lista selecciona su rango', (await nb()) === 'Ventas', await nb());
    // desborde: un nombre de varias celdas desborda
    await enter('D1', '=Ventas*2');
    check('N1 =Ventas*2 desborda D1:D4 = 20 40 60 80', JSON.stringify(await ev("Q.ts('D1 D2 D3 D4')")) === JSON.stringify({ D1: '20', D2: '40', D3: '60', D4: '80' }), await ev("Q.ts('D1 D2 D3 D4')"));
    // insertar/eliminar filas: el rango con nombre sigue a sus celdas; deshacer
    await clickSel(`#grid tbody tr[data-r='2'] th.rh`);
    await clickSel("button[data-cmd='ins-row']");
    check('N1 insertar una fila en 3: Ventas = $A$2:$A$6 y C1 sigue en 100', (await refOf('Ventas')) === '=Hoja1!$A$2:$A$6' && (await t('C1')) === '100', { ref: await refOf('Ventas'), C1: await t('C1') });
    await key('z', 2);
    check('N1 Ctrl+Z devuelve Ventas a $A$2:$A$5', (await refOf('Ventas')) === '=Hoja1!$A$2:$A$5', await refOf('Ventas'));
    await clickSel(`#grid tbody tr[data-r='1'] th.rh`);
    await clickSel("button[data-cmd='del-row']");
    check('N1 eliminar la fila 2: Ventas = $A$2:$A$4 y C1 = 90', (await refOf('Ventas')) === '=Hoja1!$A$2:$A$4' && (await t('C1')) === '90', { ref: await refOf('Ventas'), C1: await t('C1') });
    await key('z', 2);
    // deshacer la definición: la fórmula pasa a #¿NOMBRE?
    await open();
    await data();
    await box('A2:A5'); await box('Ventas');
    await enter('C1', '=SUMA(Ventas)');
    await key('z', 2); await key('z', 2);
    check('N1 Ctrl+Z (2 veces) deshace C1 y luego la definición', (await names()).length === 0 && (await t('C1')) === '', { names: await names(), C1: await t('C1') });
    await key('y', 2);
    check('N1 Ctrl+Y vuelve a definir Ventas', (await refOf('Ventas')) === '=Hoja1!$A$2:$A$5', await names());
    await enter('C2', '=SUMA(Otro)');
    check('N1 nombre inexistente → #¿NOMBRE?', (await t('C2')).charCodeAt(1) === 191, await t('C2'));

    // ---------- N2: checkFormula al confirmar (UI-38) ----------
    await open();
    await clickSel(cellSel('E1')); await type('=RAIZ(2;25)'); await key('Enter');
    check('N2 =RAIZ(2;25) → "Ha escrito demasiados argumentos para esta función."', (await msgOpen()) && (await msgText()) === 'Ha escrito demasiados argumentos para esta función.', await msgText());
    await key('Enter');   // Aceptar con el teclado (el foco está en Aceptar)
    await sleep(80);
    check('N2 tras Aceptar la celda sigue en edición con lo escrito', (await ev('Q.ed().display')) === 'block' && (await ev('Q.ed().value')) === '=RAIZ(2;25)' && (await ev('Q.ed().focused')), await ev('Q.ed()'));
    check('N2 el cursor queda al final', (await ev(`(() => { const e = document.getElementById('cellEditor'); return e.selectionStart === e.value.length && e.selectionEnd === e.value.length; })()`)), await ev(`document.getElementById('cellEditor').selectionStart`));
    await key('Backspace'); await key('Backspace'); await key('Backspace'); await key('Backspace'); await type(')'); await key('Enter');
    check('N2 corregida (=RAIZ(2)) se confirma', (await t('E1')) !== '' && !(await msgOpen()), { E1: await t('E1'), msg: await msgOpen() });
    await clickSel(cellSel('E3')); await type('=SUMA('); await key('Tab');
    check('N2 =SUMA( con Tab → "muy pocos argumentos" y no avanza', (await msgOpen()) && /muy pocos/.test(await msgText()), await msgText());
    await clickSel('#msgOk'); await key('Escape');
    check('N2 Esc cancela: E3 vacía', (await t('E3')) === '' && (await ev('Q.ed().display')) === 'none', await t('E3'));
    await clickSel(cellSel('F1')); await clickSel(cellSel('F3'), { modifiers: 8 });
    await type('=SI(1;2;3;4)'); await key('Enter', 2);
    check('N2 Ctrl+Enter también valida', (await msgOpen()) && (await t('F1')) === '', await msgText());
    await clickSel('#msgOk'); await key('Escape');
    await clickSel(cellSel('G1')); await type('=RAIZ(2;25)'); await key('Enter');
    await clickSel('#msgOk');
    await clickSel(cellSel('H5'));
    check('N2 clic en otra celda con la fórmula mal escrita: mensaje y sigue en G1', (await msgOpen()) && (await ev('Q.ed().display')) === 'block', await ev('Q.ed()'));
    await clickSel('#msgOk'); await key('Escape');
    await ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', '=RAIZ(2;25)'); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    check('N2 pegar una fórmula no se valida (las existentes no se tocan)', !(await msgOpen()), await msgText());

    // ---------- N3: Administrador de nombres (UI-35) ----------
    await open();
    await data();
    await box('A2:A5'); await box('Ventas');
    await enter('C1', '=SUMA(Ventas)');
    await key('F3', 2);
    check('N3 Ctrl+F3 abre el Administrador de nombres', await dlgOpen('namesDlg'), null);
    let rows = await nmRows();
    check('N3 fila Ventas: Valor {"10";"20";"30";"40"}, Se refiere a, Ámbito Libro', JSON.stringify(rows[0]) === JSON.stringify(['Ventas', '{"10";"20";"30";"40"}', '=Hoja1!$A$2:$A$5', 'Libro', '']), rows);
    await clickSel('#nmNew');
    check('N3 Nuevo… abre "Nombre nuevo" con la selección (C2) como referencia', (await dlgOpen('nameEdDlg')) && (await ev(`document.getElementById('neRef').value`)) === '=Hoja1!$C$2', await ev(`document.getElementById('neRef').value`));
    await type('IVA');
    await selectAllIn('#neRef'); await type('=0,19');
    await clickSel('#neComment'); await type('tasa');
    await clickSel('#neOk');
    rows = await nmRows();
    check('N3 IVA = 0,19 con comentario (lista ordenada: IVA, Ventas)', JSON.stringify(rows.map(r => r[0])) === '["IVA","Ventas"]' && rows[0][1] === '0,19' && rows[0][4] === 'tasa', rows);
    await clickSel('#nmNew'); await type('mal nombre'); await clickSel('#neOk');
    check('N3 nombre no válido: mensaje y el cuadro sigue abierto', (await msgOpen()) && (await dlgOpen('nameEdDlg')), await msgText());
    await clickSel('#msgOk'); await clickSel('#neCancel');
    // editar (renombrar) desde la lista con doble clic real
    const vr = await ev(`(() => { const tr = [...document.querySelectorAll('#nmTable tbody tr')].find(x => x.children[0].textContent === 'Ventas'); const r = tr.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
    await click(vr.x, vr.y, { clickCount: 2 });
    check('N3 doble clic abre "Editar nombre" con el ámbito bloqueado', (await dlgOpen('nameEdDlg')) && (await ev(`document.getElementById('neTitle').textContent`)) === 'Editar nombre' && (await ev(`document.getElementById('neScope').disabled`)), null);
    await selectAllIn('#neName'); await type('Ingresos'); await key('Enter');
    rows = await nmRows();
    check('N3 renombrar Ventas → Ingresos', rows.some(r => r[0] === 'Ingresos') && !rows.some(r => r[0] === 'Ventas'), rows);
    // elegir IVA y eliminarlo
    await clickText('#nmTable tbody td', 'IVA');
    await clickSel('#nmDel');
    check('N3 Eliminar pregunta', (await msgOpen()) && /eliminar el nombre IVA/.test(await msgText()), await msgText());
    await clickSel('#msgOk'); await sleep(100);   // el cierre del mensaje resuelve la promesa en otra tarea
    rows = await nmRows();
    check('N3 IVA eliminado', !rows.some(r => r[0] === 'IVA'), rows);
    // "Se refiere a" del pie
    await selectAllIn('#nmRef'); await type('=Hoja1!$A$2:$A$3'); await key('Enter');
    rows = await nmRows();
    check('N3 editar "Se refiere a" en el pie (Enter) cambia el rango', rows[0][2] === '=Hoja1!$A$2:$A$3', rows);
    await clickSel('#nmClose');
    await clickSel(cellSel('C1'));
    check('N3 la fórmula pasó a =SUMA(Ingresos) y vale 30', (await fb()) === '=SUMA(Ingresos)' && (await t('C1')) === '30', { fb: await fb(), C1: await t('C1') });
    await key('z', 2);
    check('N3 Ctrl+Z deshace el cambio de referencia (C1 = 100)', (await t('C1')) === '100', await t('C1'));
    await key('z', 2);
    check('N3 Ctrl+Z deshace la eliminación de IVA', (await refOf('IVA')) === '=0,19', await names());
    await key('z', 2);
    check('N3 Ctrl+Z deshace el renombre (fórmula y nombre)', (await refOf('Ventas')) === '=Hoja1!$A$2:$A$5' && (await fb()) === '=SUMA(Ventas)', { names: await names(), fb: await fb() });
    // nombre de hoja: Definir nombre desde el menú contextual
    await clickSel(cellSel('B2'), { button: 'right' });
    await clickText('#menu div', 'Definir nombre…');
    await type('Local');
    await ev(`(() => { const s = document.getElementById('neScope'); s.value = 'Hoja1'; s.dispatchEvent(new Event('change')); })()`);
    await key('Enter');
    check('N3 Definir nombre… (menú contextual) con ámbito Hoja1', (await refOf('Local', 'Hoja1')) === '=Hoja1!$B$2', await names());

    // ---------- N4: autocompletado, recuadro de color y F3 (UI-36) ----------
    await clickSel(cellSel('F1')); await type('=SUMA(Ven');
    const ac = await ev(`[...document.querySelectorAll('#acList div')].map(d => d.textContent + (d.classList.contains('nm') ? '*' : ''))`);
    check('N4 el autocompletado lista Ventas como nombre', ac.some(x => x.startsWith('Ventas') && x.endsWith('*')), ac);
    await key('Tab');
    check('N4 Tab completa el nombre sin "("', (await ev('Q.ed().value')) === '=SUMA(Ventas', await ev('Q.ed().value'));
    const hl = await ev(`(() => { const r = document.querySelector('#refHL .refbox[data-name="Ventas"]'); return r ? Q.R(r) : null; })()`);
    const a2 = await ev(`Q.R(Q.td('A2'))`), a5 = await ev(`Q.R(Q.td('A5'))`);
    check('N4 recuadro de color sobre A2:A5 (±2 px, L-023)', hl && Math.abs(hl.t - a2.t) <= 2 && Math.abs(hl.t + hl.h - (a5.t + a5.h)) <= 3, { hl, a2, a5 });
    check('N4 el nombre se pinta en color en el editor', await ev(`!!document.querySelector('#edMirror i')`), null);
    await type(';');
    await key('F3');
    check('N4 F3 en la fórmula abre "Pegar nombre"', await dlgOpen('pasteNameDlg'), null);
    const pn = await ev(`[...document.getElementById('pnList').options].map(o => o.value)`);
    check('N4 Pegar nombre lista los nombres de libro y de la hoja', JSON.stringify(pn) === '["IVA","Local","Ventas"]', pn);
    await key('Enter');
    check('N4 Enter pega el nombre en el cursor', (await ev('Q.ed().value')) === '=SUMA(Ventas;IVA' && (await ev('Q.ed().focused')), await ev('Q.ed()'));
    await key('Escape');
    await clickSel(cellSel('G1')); await key('F3'); await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
    check('N4 F3 sin editar empieza "=Ventas" en la celda', (await ev('Q.ed().value')) === '=Ventas', await ev('Q.ed()'));
    await key('Enter');
    check('N4 =Ventas desborda G1:G4', (await t('G4')) === '40', await t('G4'));

    // ---------- N5: Crear desde la selección (UI-37) ----------
    await open();
    await enter('H1', 'Norte'); await enter('I1', 'Sur Este');
    await enter('H2', '1'); await enter('I2', '2'); await enter('H3', '3'); await enter('I3', '4');
    await box('H1:I3');
    await key('F3', 2 | 8);
    check('N5 Ctrl+Mayús+F3 abre el cuadro con "Fila superior" marcada', (await dlgOpen('createNamesDlg')) && (await ev(`document.getElementById('cnTop').checked`)) && !(await ev(`document.getElementById('cnLeft').checked`)), null);
    await key('Enter');
    check('N5 crea Norte = $H$2:$H$3 y Sur_Este = $I$2:$I$3', (await refOf('Norte')) === '=Hoja1!$H$2:$H$3' && (await refOf('Sur_Este')) === '=Hoja1!$I$2:$I$3', await names());
    await enter('J1', '=SUMA(Sur_Este)');
    check('N5 =SUMA(Sur_Este) = 6', (await t('J1')) === '6', await t('J1'));
    await key('z', 2); await key('z', 2);
    check('N5 un solo Ctrl+Z deshace todos los nombres creados', (await names()).length === 0, await names());

    // ---------- N6: hojas y cortar/pegar (UI-37) ----------
    await open();
    await data();
    await box('A2:A5'); await box('Ventas');
    await enter('C1', '=SUMA(Ventas)');
    await ev(`window.prompt = () => 'Datos'; 1`);
    await click(...Object.values(await ev(`(() => { const r = document.querySelector('.tab.on').getBoundingClientRect(); return { x: r.left + 10, y: r.top + 8 }; })()`)), { clickCount: 2 });
    await sleep(100);
    check('N6 renombrar la hoja: Ventas = Datos!$A$2:$A$5 y C1 = 100', (await refOf('Ventas')) === '=Datos!$A$2:$A$5' && (await t('C1')) === '100', { ref: await refOf('Ventas'), C1: await t('C1') });
    // cortar A2:A5 y pegar en K2: el rango con nombre se mueve
    // Ctrl+X / Ctrl+V reales no ejecutan el portapapeles en Chrome headless: mismo camino con ClipboardEvent
    await box('A2:A5');
    const cutText = await ev(`(() => { const dt = new DataTransfer(); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('cut', { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData('text/plain'); })()`);
    await clickSel(cellSel('K2'));
    await ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(cutText)}); document.getElementById('gridWrap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    check('N6 cortar y pegar mueve el rango con nombre (Datos!$K$2:$K$5) y C1 = 100', (await refOf('Ventas')) === '=Datos!$K$2:$K$5' && (await t('C1')) === '100', { ref: await refOf('Ventas'), C1: await t('C1') });
    await key('z', 2);
    check('N6 Ctrl+Z del cortar/pegar devuelve Ventas a $A$2:$A$5', (await refOf('Ventas')) === '=Datos!$A$2:$A$5', await refOf('Ventas'));
    // duplicar y eliminar hoja con un nombre de ámbito de hoja
    await box('A2:A5');
    await box('Datos!Loc'); // nombre de hoja escrito en el cuadro de nombres: "Hoja!Nombre"
    check('N6 "Datos!Loc" en el cuadro de nombres define un nombre de ámbito Datos', (await refOf('Loc', 'Datos')) === '=Datos!$A$2:$A$5', await names());
    await clickSel('.tab.on', { button: 'right' }); await clickText('#menu div', 'Duplicar hoja');
    check('N6 duplicar la hoja copia el nombre de hoja', (await refOf('Loc', 'Datos (2)')) === "='Datos (2)'!$A$2:$A$5", await names());
    await clickSel('.tab.add');
    await enter('A1', '=SUMA(Datos!A2:A5)+SUMA(Ventas)');
    check('N6 en Hoja1: =SUMA(Datos!A2:A5)+SUMA(Ventas) = 200', (await t('A1')) === '200', await t('A1'));
    await captureConfirm('true');
    await clickText('.tab', 'Datos'); await clickSel('.tab.on', { button: 'right' }); await clickText('#menu div', 'Eliminar hoja');
    await clickText('.tab', 'Hoja1'); await clickSel(cellSel('A1'));
    check('N6 eliminar la hoja: la fórmula queda con #¡REF! permanente', /^=SUMA\(#REF!\)\+SUMA\(Ventas\)$/.test(await fb()) && (await t('A1')).charCodeAt(1) === 161, { fb: await fb(), A1: await t('A1') });
    check('N6 eliminar la hoja: Ventas = #REF! y Loc de Datos desaparece', (await refOf('Ventas')) === '=#REF!' && !(await names()).some(d => d.scope === 'Datos'), await names());
    await key('z', 2);
    check('N6 Ctrl+Z restaura la hoja, sus nombres y la fórmula', (await refOf('Loc', 'Datos')) === '=Datos!$A$2:$A$5' && (await refOf('Ventas')) === '=Datos!$A$2:$A$5', await names());

    // ---------- N7: .bassx (recargar desde el autoguardado) y .xlsx (UI-39) ----------
    await open();
    await data();
    await box('A2:A5'); await box('Ventas');
    await enter('C1', '=SUMA(Ventas)');
    await sleep(500);
    await b.navigate('Page.reload'); await sleep(300);
    check('N7 recargar conserva el nombre (serialize/normalize) y C1 = 100', (await t('C1')) === '100' && (await refOf('Ventas')) === '=Hoja1!$A$2:$A$5', { C1: await t('C1'), names: await names() });
    const bassx = await ev(`(() => { const o = Q.store(); return JSON.stringify(o.names); })()`);
    check('N7 el .bassx lleva names', bassx === JSON.stringify([{ name: 'Ventas', scope: null, ref: '=Hoja1!$A$2:$A$5', comment: '' }]), bassx);
    await ev(`window.__book = null; XLSX.writeFile = bk => { window.__book = bk; }; 1`);
    await clickSel("button[data-cmd='xlsx']");
    const xn = await ev(`JSON.stringify(window.__book && window.__book.Workbook && window.__book.Workbook.Names)`);
    check('N7 exportar .xlsx: Workbook.Names = [{Name: Ventas, Ref: Hoja1!$A$2:$A$5}]', xn === JSON.stringify([{ Name: 'Ventas', Ref: 'Hoja1!$A$2:$A$5' }]), xn);
    await captureConfirm('true');
    await ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File([XLSX.write(window.__book, { type: 'array', bookType: 'xlsx' })], 'ida.xlsx')); const fi = document.getElementById('fileInput'); fi.files = dt.files; fi.dispatchEvent(new Event('change')); })()`);
    await sleep(800);
    check('N7 ida y vuelta .xlsx: el nombre vuelve y C1 = 100', (await t('C1')) === '100' && (await refOf('Ventas')) === '=Hoja1!$A$2:$A$5' && !(await msgOpen()), { C1: await t('C1'), names: await names(), msg: await msgOpen() });
    // nombres omitidos al importar: aviso
    await ev(`(() => { const ws = XLSX.utils.aoa_to_sheet([[1, 2], [3, 4]]); const bk = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(bk, ws, 'Datos'); bk.Workbook = bk.Workbook || {}; bk.Workbook.Names = [{ Name: 'Tasa', Ref: '0.19' }, { Name: 'Oculto', Ref: '1', Hidden: true }, { Name: '_xlnm.Print_Area', Ref: 'Datos!$A$1:$B$2', Sheet: 0 }, { Name: 'Doble', Ref: 'SUM(Datos!$A$1:$A$2)*2' }]; const dt = new DataTransfer(); dt.items.add(new File([XLSX.write(bk, { type: 'array', bookType: 'xlsx' })], 'n.xlsx')); const fi = document.getElementById('fileInput'); fi.files = dt.files; fi.dispatchEvent(new Event('change')); })()`);
    await sleep(800);
    check('N7 importar .xlsx avisa los nombres omitidos', (await msgOpen()) && /Oculto/.test(await msgText()) && /Print_Area/.test(await msgText()), await msgText());
    await clickSel('#msgOk');
    check('N7 importar .xlsx: Tasa = 0,19 y Doble = SUMA(...)*2 en es-CL', (await refOf('Tasa')) === '=0,19' && (await refOf('Doble')) === '=SUMA(Datos!$A$1:$A$2)*2', await names());
    await enter('D1', '=Doble+Tasa');
    check('N7 =Doble+Tasa = 8,19', (await t('D1')) === '8,19', await t('D1'));

    // ---------- N8: fechas es-CL nuevas del motor (1/1/26, 1-ene, 12/99), FECHANUMERO y series de relleno ----------
    await open();
    const Y = new Date().getFullYear();
    await enter('A1', '1/1/26'); await enter('A2', '1-ene'); await enter('A3', '12/99'); await enter('A4', '=FECHANUMERO("1/1/26")');
    const dts = await ev("Q.ts('A1 A2 A3 A4')");
    check('N8 1/1/26, 1-ene y 12/99 se muestran como fecha dd-mm-aaaa; FECHANUMERO da el serial', JSON.stringify(dts) === JSON.stringify({ A1: '01-01-2026', A2: `01-01-${Y}`, A3: '01-12-1999', A4: '46023' }), dts);
    await clickSel(cellSel('A6')); await type('=FECHANUMERO(');
    check('N8 ayuda de argumentos de FECHANUMERO', /FECHANUMERO\(texto_de_fecha\)/.test(await ev(`document.getElementById('sigTip').textContent`)), await ev(`document.getElementById('sigTip').textContent`));
    await key('Escape');
    // arrastre real del controlador de relleno desde el rango src hasta la celda dest
    const dragFill = async (src, dest) => {
      await box(src);
      const h = await ev(`(() => { const r = document.getElementById('fillHandle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      const d = await ev(`(() => { const r = Q.td(${JSON.stringify(dest)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y });
      await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.x, y: h.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 4; i++) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x + (d.x - h.x) * i / 4, y: h.y + (d.y - h.y) * i / 4, button: 'left', buttons: 1 });
      await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: d.x, y: d.y, button: 'left', clickCount: 1 });
      await sleep(80);
    };
    await enter('C1', '1/12'); await enter('C2', '2/12');
    await dragFill('C1:C2', 'C4');
    check('N8 serie 1/12, 2/12 → 03-12 y 04-12 (por días)', (await t('C3')) === `03-12-${Y}` && (await t('C4')) === `04-12-${Y}`, await ev("Q.ts('C1 C2 C3 C4')"));
    await enter('D1', '31/01/2026'); await enter('D2', '28/02/2026');
    await dragFill('D1:D2', 'D3');
    check('N8 31/01 y 28/02 no son el mismo día: serie por días (+28)', (await t('D3')) === '28-03-2026', await t('D3'));
    await enter('E1', '15/01/2026'); await enter('E2', '15/02/2026');
    await dragFill('E1:E2', 'E4');
    check('N8 15/01, 15/02 → 15-03 y 15-04 (por meses, como Excel)', (await t('E3')) === '15-03-2026' && (await t('E4')) === '15-04-2026', await ev("Q.ts('E3 E4')"));
    await enter('F1', 'ene-45'); await enter('F2', 'feb-45');
    await dragFill('F1:F2', 'F3');
    check('N8 ene-45, feb-45 → 01-03-1945', (await t('F3')) === '01-03-1945', await ev("Q.ts('F1 F2 F3')"));
    await enter('G1', '1,125'); await enter('G2', '2,25');
    await dragFill('G1:G2', 'G3');
    check('N8 regresión: la serie numérica 1,125 · 2,25 → 3,375 (L-014)', (await t('G3')) === '3,375', await t('G3'));
    await enter('H1', 'Producto 1');
    await dragFill('H1', 'H3');
    check('N8 regresión: "Producto 1" → Producto 3', (await t('H3')) === 'Producto 3', await t('H3'));

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

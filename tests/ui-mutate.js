'use strict';
// Mutaciones de la UI (L-028): rompe a propósito una regla de app.js, corre el arnés de Chrome headless y confirma que
// alguna aserción falla. Nunca escribe en web/ (L-049): copia web/ a una carpeta temporal (os.tmpdir()), muta la copia
// y le pasa al arnés esa raíz con --web=<carpeta> (y BX_WEB). Si el proceso muere a la fuerza, web/app.js queda intacto;
// solo queda una carpeta bx-mut-* en el temporal.
// Uso: node tests/ui-mutate.js [arnés] [índices separados por coma]   (por omisión tests/ui-round2b.harness.js).
// Tarda ~1 min por mutación. tests/check-integrity.js usa MUTS para verificar que web/app.js no tiene mutaciones.
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const WEB = path.join(__dirname, '..', 'web');
const MUTS = [
  ['una celda fantasma no corta el desborde de texto', '&& !ghostSet.has(r * GK + cc) ', '', /fantasma \(E2\) corta/],
  ['la barra de estado cuenta filas ocultas y filtradas', 'if (isHidden(r) || isHiddenCol(c)) return;', '', /barra de estado (con filtro|sin la fila oculta)/],
  ['importar .xlsx sin xlfn: true', "cellStyles: true, xlfn: true }", 'cellStyles: true }', /ANCHORARRAY/],
  ['Abrir no pregunta con cambios sin guardar', 'if (!dirty || !hasContent()) return true;', 'return true;', /A2 /],
  ['pegar texto sin la lógica de entrada', "const cell = entryCell(clone(getCell(r, c)) || {}, tile ? rows[0][0] : (rows[i][j] ?? ''), effStyle(r, c));", "const cell = clone(getCell(r, c)) || {}; cell.v = tile ? rows[0][0] : (rows[i][j] ?? '');", /pegar texto de otra aplicación/],
  ['las fantasmas no son datos para Ctrl+flechas', 'const has = hasData;   // las celdas fantasma', 'const has = (r, c) => { const x = sheet.cells[addr(r, c)]; return !!(x && x.v !== \'\'); };   // las celdas fantasma', /Ctrl\+↓/],
  // rangos con nombre y checkFormula (ronda 2c): node tests/ui-mutate.js tests/ui-names.harness.js
  ['deshacer no guarda wb.names', 'const snapState = () => JSON.stringify({ sheets: wb.sheets, active: wb.active, names: wb.names || [] });', 'const snapState = () => JSON.stringify({ sheets: wb.sheets, active: wb.active });', /deshace C1 y luego la definición|deshace la eliminación/, 'ui-names'],
  ['insertar filas no ajusta los nombres', 'Bx.namesStructural(wb, target, axis, at, delta);   // los rangos', '//', /insertar una fila en 3/, 'ui-names'],
  ['confirmar no valida con checkFormula', 'if (!force && rejectFormula(val)) return false;', '', /RAIZ\(2;25\)/, 'ui-names'],
  ['renombrar no actualiza las fórmulas', 'if (res.renamed) renameNameEverywhere(res.renamed[0], res.renamed[1], res.def.scope);', '', /=SUMA\(Ingresos\)/, 'ui-names'],
  ['el Enter de Pegar nombre llega al documento', "e.preventDefault(); e.stopPropagation(); const v = $('#pnList').value;", "e.preventDefault(); const v = $('#pnList').value;", /Enter pega el nombre/, 'ui-names'],
  // (reconstruir la tabla en el click no rompe el doble clic real: el 2.º clic cae entero sobre el nodo nuevo; L-031
  // es reconstruir entre mousedown y mouseup. Medido con esta misma herramienta el 2026-11-02: no era una falla)
  ['los nombres no tienen recuadro de color', 'if (edit && wb.names && wb.names.length) {', 'if (false) {', /recuadro de color/, 'ui-names'],
  ['las fechas del mismo día no forman serie por meses', 'if (n > 1 && stM && ds.every(', 'if (false && ds.every(', /por meses/, 'ui-names'],
  ['el cuadro de nombres no muestra el nombre de la selección', 'nameBox.value = (!extra.length && selNameOf(g)) ||', 'nameBox.value = (false) ||', /define el nombre y el cuadro lo muestra/, 'ui-names'],
  ['cortar y pegar no mueve los nombres', "for (const d of wb.names || []) d.ref = moveRefs(d.ref, d.scope, Bx.quoteSheet(dst.name) + '!');", '', /cortar y pegar mueve/, 'ui-names'],
  // ronda 2d (grupo D de ui-round2b): ordenar con filtro activo y P2 de qa ronda 3
  // (desde la ronda 5a la regla vive en sortRange, el motor de orden de varios niveles)
  ['ordenar mueve las filas ocultas (filtro y a mano)', 'if (lr ? isHiddenCol(i) : hid.has(i)) continue;\n      const cells = [];', 'const cells = [];', /D (cinta A→Z|Ctrl\+Z tras|▾ de Monto|fila 4 oculta)/],
  ['las capas no se recortan en los paneles inmovilizados', 'el.style.clipPath = fzClip(g, R);', '', /D (el borde del desborde|la selección B2:B30)/],
  ['la barra de estado con 15 cifras y sin el formato de la celda', "const sf = v => af !== 'general' && af !== 'text' ? display(v, ac) : generalFit(v);", 'const sf = v => general(v);', /D barra de estado/],
  ['=SUMA no hereda el formato de sus referencias', '(!fn || FMT_INHERIT.has(', '(!fn || false && FMT_INHERIT.has(', /D =SUMA y =MAX|A1 escribir/],
  // ronda 5a: ordenar por varios niveles, dlgBox y advertencia antes de ordenar: node tests/ui-mutate.js tests/ui-sort.harness.js
  ['ordenar solo usa el primer nivel', 'for (let j = 0; j < levels.length; j++) { const c = sortCompare(', 'for (let j = 0; j < 1; j++) { const c = sortCompare(', /S1 Región A a Z y luego Monto/, 'ui-sort'],
  ['las vacías no van al final', 'if (a === null || b === null) return (a === null) - (b === null);\n    let c = compareVals(a, b);', 'let c = compareVals(a, b);', /vacía/, 'ui-sort'],
  ['"Distinguir mayúsculas" no hace nada', "if (!c && caseSens && typeof a === 'string'", "if (false && !c && caseSens && typeof a === 'string'", /distinguir mayúsculas/, 'ui-sort'],
  ['con mayúsculas, la mayúscula va antes', 'return a[i] === a[i].toLowerCase() ? -1 : 1;', 'return a[i] === a[i].toLowerCase() ? 1 : -1;', /distinguir mayúsculas/, 'ui-sort'],
  ['izquierda a derecha ordena filas', 'const ok = sortRange(d, st.levels, { caseSens: st.caseSens, lr: st.lr });', 'const ok = sortRange(d, st.levels, { caseSens: st.caseSens, lr: false });', /S3 (ordena las columnas|la columna B oculta)/, 'ui-sort'],
  ['de izquierda a derecha mueve las columnas ocultas', 'if (lr ? isHiddenCol(i) : hid.has(i)) continue;\n      const cells = [];', 'if (lr ? false : hid.has(i)) continue;\n      const cells = [];', /S3 la columna B oculta/, 'ui-sort'],
  ['el cuadro Ordenar mueve las filas ocultas', 'if (lr ? isHiddenCol(i) : hid.has(i)) continue;\n      const cells = [];', 'if (lr ? isHiddenCol(i) : false) continue;\n      const cells = [];', /S1 fila 5 oculta/, 'ui-sort'],
  ['sin advertencia antes de ordenar', 'if (reg.c1 < g.c1 || reg.c2 > g.c2) {', 'if (false) {', /S4/, 'ui-sort'],
  ['la advertencia no propone Ampliar por omisión', 'id="rwExpand" checked>', 'id="rwExpand">', /S4 ("Ampliar la selección" por omisión|Enter amplía)/, 'ui-sort'],
  ['ordenar no revisa las combinaciones', 'if (!mergesSortable(g, lr)) {', 'if (false) {', /S5 (combinación B3:C3|y no ordena|también desde)/, 'ui-sort'],
  ['la región actual no ve las celdas cubiertas de una combinación', '(hasData(r, c) || (ms.length > 0 && mergeHas(r, c)))', 'hasData(r, c)', /S5 combinaciones del mismo tamaño/, 'ui-sort'],
  ['Enter no acepta el cuadro', "else if (e.key === 'Enter' && !e.altKey", "else if (false && e.key === 'Enter' && !e.altKey", /Enter/, 'ui-sort'],
  ['el foco no vuelve a la grilla al cerrar el cuadro', 'res(v); backToGrid(); };', 'res(v); };', /foco vuelve a la grilla/, 'ui-sort'],
  ['el foco no queda atrapado en el cuadro', 'if (e.shiftKey ? i <= 0 : i < 0 || i === f.length - 1) { e.preventDefault();', 'if (false) {', /foco atrapado/, 'ui-sort'],
  ['el cuadro no recuerda los niveles de la hoja', 'sortMemo.set(sheet.name, {', "sortMemo.set('', {", /recuerda/, 'ui-sort'],
  ['ordenar se deshace celda por celda', 'applyChanges(items);   // un solo paso de deshacer', 'items.forEach(it => applyChanges([it]));', /Ctrl\+Z restaura en un paso/, 'ui-sort'],
  ['el Criterio no reconoce las fechas', "return n > s ? (d * 2 >= n ? 'date' : 'num') : 'text';", "return n > s ? 'num' : 'text';", /fecha/, 'ui-sort'],
  ['sin límite de 64 niveles', 'st.levels.length >= SORT_MAX;', 'st.levels.length >= SORT_MAX + 1;', /64 niveles/, 'ui-sort'],
  // ronda 5b: P2 de qa ronda 5a (selección después de ordenar)
  ['la activa salta a la primera fila de datos al ordenar', 'const keep = inArea(d, A.r, A.c) && !isHidden(A.r);', 'const keep = false;', /S1 la celda activa se queda/, 'ui-sort'],
  ['un orden rechazado amplía la selección', 'if (ok) selectSorted(t, d);   // la selección cambia solo si ordenó', 'selectSorted(t, d);', /S5 el orden rechazado no cambia la selección/, 'ui-sort'],
  ['reabrir Ordenar sobre lo ordenado pierde el encabezado', 'if (memo && !t.lock && memo.header && !memo.lr && sameRect(memo.d, t.g))', 'if (false)', /S1 reabrir sobre la selección/, 'ui-sort'],
  // ronda 5b: Quitar duplicados: node tests/ui-mutate.js tests/ui-dedupe.harness.js
  ['quitar duplicados compara el valor y no lo mostrado', 'const k = JSON.stringify(cols.map(c => cellText(r, c).toLocaleLowerCase(LOCALE)));', "const k = JSON.stringify(cols.map(c => String(eng.value(wb.active, r, c) ?? '').toLocaleLowerCase(LOCALE)));", /Q5/, 'ui-dedupe'],
  ['quitar duplicados distingue mayúsculas', 'cellText(r, c).toLocaleLowerCase(LOCALE)));   // valor mostrado', 'cellText(r, c)));   // valor mostrado', /Q1 mensaje final|Q6/, 'ui-dedupe'],
  ['quitar duplicados conserva la última aparición', 'if (!seen.has(k)) { seen.add(k); keep.push(r); }', 'if (!seen.has(k)) { seen.add(k); keep.push(r); } else keep[keep.findIndex(x => JSON.stringify(cols.map(c => cellText(x, c).toLocaleLowerCase(LOCALE))) === k)] = r;', /Q1 A2:B5|Q7 Luis/, 'ui-dedupe'],
  ['quitar duplicados mueve una columna fuera del rango', 'for (let c = g.c1; c <= g.c2; c++) {\n        const cell = clone(getCell(r, c));   // con su formato', 'for (let c = g.c1; c <= g.c2 + 1; c++) {\n        const cell = clone(getCell(r, c));   // con su formato', /Q1 A2:B5/, 'ui-dedupe'],
  ['quitar duplicados no vacía las filas libres', 'for (let r = r1 + keep.length; r <= g.r2; r++) for', 'for (let r = g.r2 + 1; r <= g.r2; r++) for', /Q1 (A2:B5|las filas libres)/, 'ui-dedupe'],
  ['el encabezado cuenta como dato', 'const r1 = g.r1 + (header ? 1 : 0), seen = new Set(), keep = [];', 'const r1 = g.r1, seen = new Set(), keep = [];', /Q1 mensaje final/, 'ui-dedupe'],
  ['quitar duplicados sin advertencia', "if (reg.c1 < g.c1 || reg.c2 > g.c2) {\n      return rangeWarning({ title: 'Advertencia antes de quitar duplicados'", "if (false) {\n      return rangeWarning({ title: 'Advertencia antes de quitar duplicados'", /Q1 rango junto a más datos/, 'ui-dedupe'],
  ['una celda no usa la región actual', 'if (g.r1 === g.r2 || g.r2 - g.r1 + 1 === sheet.rows) { const reg = currentRegion(A.r, A.c); return { g: reg, header: guessHeader(reg, A.c) }; }', '', /Q3 una celda/, 'ui-dedupe'],
  // ronda 5c: Quitar duplicados usa dlgBox({ okEnabled }) en vez de deshabilitar Aceptar a mano
  ['Aceptar habilitado sin columnas', 'okEnabled: () => boxes().some(b => b.checked) });', 'okEnabled: () => true });', /Q1 (Anular selección|Enter sin columnas)/, 'ui-dedupe'],
  ['Enter acepta con Aceptar deshabilitado', 'const accept = () => { if (okB.disabled) return;', 'const accept = () => {', /Q1 Enter sin columnas/, 'ui-dedupe'],
  ['okEnabled no se reevalúa tras un clic o cambio', "for (const t of ['click', 'change', 'input', 'keyup']) d.addEventListener(t, syncOk);", '', /Q1 (Anular selección|Seleccionar todo|marcar solo)/, 'ui-dedupe'],
  ['Seleccionar todo no marca', "q('#ddAll').onclick = () => { boxes().forEach(b => { b.checked = true; }); };", "q('#ddAll').onclick = () => {};", /Q1 Seleccionar todo/, 'ui-dedupe'],
  ['sin encabezados las columnas siguen con su nombre', "b.nextSibling.textContent = (hdr.checked && cellText(g.r1, c)) || 'Columna ' + colName(c);", "b.nextSibling.textContent = cellText(g.r1, c) || 'Columna ' + colName(c);", /Q4 sin encabezados: Columna A/, 'ui-dedupe'],
  ['quitar duplicados no revisa las combinaciones', "if ((sheet.merges || []).some(hit)) return 'No se puede hacer eso en una celda combinada.';", '', /Q9/, 'ui-dedupe'],
  ['quitar duplicados no revisa las filas ocultas', 'if ([...hiddenRows()].some(r => r >= g.r1 && r <= g.r2)) return', 'if (false) return', /Q10 (fila oculta|fila filtrada|sin cambios|con filtro)/, 'ui-dedupe'],
  ['quitar duplicados se deshace celda por celda', 'applyChanges(items);   // un solo paso de deshacer (Ctrl+Z restaura todo)', 'items.forEach(it => applyChanges([it]));', /Q1 un solo Ctrl\+Z/, 'ui-dedupe'],
  ['las fórmulas que suben no se ajustan', 'if (cell && isFormula(cell.v) && n !== r) cell.v = shiftFormula(cell.v, n - r, 0);', '', /Q8 la fórmula que sube/, 'ui-dedupe'],
  ['la selección no queda en el rango con datos', 'setSel({ r: left.r1, c: left.c1 }, { r: left.r2, c: left.c2 }, false, false, inArea(left, A.r, A.c) ? A : null);', '', /Q1 queda seleccionado|Q2 selección final|Q5 la selección/, 'ui-dedupe'],
  ['la activa no se conserva al quitar duplicados', 'inArea(left, A.r, A.c) ? A : null);', 'null);', /Q5 la selección queda en A1:A5 y la activa/, 'ui-dedupe'],
  // ronda 5c: Validación de datos: node tests/ui-mutate.js tests/ui-dv.harness.js
  ['entero no revisa que sea entero', "if (d.type === 'whole' && !Number.isInteger(v)) return false;", '', /V0 entero: 5,5|V2 entero: 5,5/, 'ui-dv'],
  ['la lista distingue mayúsculas', 'const dvLow = t => String(t).toLocaleLowerCase(LOCALE);', 'const dvLow = t => String(t);', /V0 lista sin distinguir|V1 "no"/, 'ui-dv'],
  ['"Omitir blancos" no hace nada', "if (v === null || v === undefined || v === '') return d.allowBlank !== false;", "if (v === null || v === undefined || v === '') return true;", /V0 vacío/, 'ui-dv'],
  ['Mínimo y Máximo no se comparan', "if (typeof a !== 'number' || (b !== null && typeof b !== 'number')) return false;\n    switch (d.op) {", "return true;\n    switch (d.op) {", /V0 (entero entre|decimal|fecha|hora|longitud|no está entre|Mínimo y Máximo)/, 'ui-dv'],
  ['el validador no mira lo que se escribe', 'setKey(S, k, normCell(entryCell(clone(old) || {}, val, styleIn(S, r, c))));', '', /V4 3 en A2|V1 Quizás en B3/, 'ui-dv'],
  ['confirmar no valida los datos', 'if (!force && dvReject(val, () => commitEdit(dr, dc, true, next))) return false;', '', /V1 Quizás en B3|V2 entero: 5,5/, 'ui-dv'],
  ['Ctrl+Enter no valida', 'if (!checked && dvReject(val, () => fillSelectionWith(val, true))) return;', '', /V1 Ctrl\+Enter (también|cancelado)/, 'ui-dv'],
  ['el mensaje por omisión no es el de Excel', "const DV_MSG = 'Este valor no coincide con las restricciones", "const DV_MSG = 'Valor no válido. Este valor no coincide con las restricciones", /V1 Quizás en B3|V3 Información: Aceptar/, 'ui-dv'],
  ['Reintentar no selecciona el texto', 'inp.select();   // Reintentar', '', /V1 Reintentar vuelve|V3 No vuelve/, 'ui-dv'],
  ['Cancelar en el mensaje no descarta', "if (ans === 'cancel') return cancelEdit();", "if (ans === 'cancel') return;", /V1 (Cancelar descarta|Esc en el mensaje)|V3 Información ▸ Cancelar/, 'ui-dv'],
  ['Advertencia: No acepta el valor', "then(v => v === true ? 'accept' : v === 'no' ? 'retry' : 'cancel');", "then(v => v === true || v === 'no' ? 'accept' : 'cancel');", /V3 No vuelve/, 'ui-dv'],
  ['sin "Mostrar mensaje de error" igual avisa', 'if (ok || !d.error || d.error.show === false) return false;', 'if (ok) return false;', /V3 sin "Mostrar mensaje de error"/, 'ui-dv'],
  ['Alt+↓ no abre la lista', "if (k === 'ArrowDown' && e.altKey) { e.preventDefault(); openDvList(); return; }", '', /V1 Alt\+↓/, 'ui-dv'],
  ['la lista abre sin el primer elemento marcado', 'if (idx < 0) idx = 0;', 'if (idx < 0) idx = -1;', /V1 (Alt\+↓|↓ marca|Enter elige)/, 'ui-dv'],
  ['la lista muestra más de 8 elementos', 'const DV_ROWS = 8;', 'const DV_ROWS = 80;', /V3 lista de 12/, 'ui-dv'],
  ['elegir de la lista no pasa por la entrada (sin deshacer)', 'setRaw(p.r, p.c, it.t);', 'sheet.cells[addr(p.r, p.c)] = { v: it.t }; changed();', /V1 Ctrl\+(Z deshace la elección|Y la rehace)/, 'ui-dv'],
  ['el mensaje de entrada no se muestra', "dvTip.style.display = 'block';", "dvTip.style.display = 'none';", /V3 (mensaje de entrada|el globo)/, 'ui-dv'],
  ['Mínimo > Máximo se acepta', "if (typeof x === 'number' && typeof y === 'number' && x > y) return { id: '#dvF2'", "if (false) return { id: '#dvF2'", /V2 Mínimo > Máximo/, 'ui-dv'],
  ['extender una regla la deja partida en dos', 'list = dvAddAll(list, [rule]);', 'list = list.concat([rule]);', /V2 Sí y Aceptar/, 'ui-dv'],
  ['insertar filas no desplaza la validación', "['dv', d => d.ranges.length > 0, (d, axis, at, n) => dvShift(d, axis, at, n)],", '', /V4 (insertar|eliminar)/, 'ui-dv'],
  ['las fórmulas de la validación no se ajustan al insertar', 'dvFormulasAll((f, s) => structural(f, s.name, target, axis, at, delta));', '', /V4 (insertar una fila|después de insertar|eliminar la primera)/, 'ui-dv'],
  ['la nueva ancla no reescribe la fórmula', 'old[axis] -= n;', 'old[axis] -= 0;', /V4 (eliminar la primera fila|insertar una fila arriba)/, 'ui-dv'],
  ['pegar no copia la validación', 'dv = dvAddAll(dv, rules.map(d => dvMove(d, g.r1 + i - cp.r1, g.c1 + j - cp.c1, true)));', '', /V5 (pegar copia|▾ en D2)/, 'ui-dv'],
  ['rellenar no copia la validación', 'dv = dvAddAll(dv, rules.map(d => dvClip(dvMove(d, dr, dc, true), tgt)).filter(Boolean));', '', /V5 Ctrl\+J/, 'ui-dv'],
  ['deshacer no restaura la validación del mismo paso', 'if (rec.dv) setDv(sheet, clone(rec.dv[which]));', '', /V5 (un Ctrl\+Z|Ctrl\+Z deshace el relleno|Ctrl\+Z restaura)/, 'ui-dv'],
  ['cortar no mueve la validación', 'const moved = dvPieces(src, box).map(d => dvMove(d, dr, dc, false));', 'const moved = [];', /V5 cortar/, 'ui-dv'],
  // (ronda 5d: Borrar todo quita también el formato condicional en el mismo paso)
  ['Borrar todo no quita la validación', 'applyChanges(items, { dv: dvRemove(sheet.dv || [], vis), cf: dvRemove(sheet.cf || [], vis) });', 'applyChanges(items, { cf: dvRemove(sheet.cf || [], vis) });', /V5 Borrar todo/, 'ui-dv'],
  ['renombrar la hoja no actualiza el origen', 'dvFormulasAll(f => renameSheetInFormula(f, s.name, name));', '', /V6 renombrar/, 'ui-dv'],
  ['.bassx pierde la validación', 'if (Array.isArray(s.dv)) {', 'if (false) {', /V6 \.bassx/, 'ui-dv'],
  // (ronda 5d: un solo aviso para validación y formato condicional, xlsxLossText)
  ['exportar .xlsx no avisa', 'if (loss && !await askBox(loss)) return;', '', /V6 exportar/, 'ui-dv'],
  ['la notación científica no recibe el formato Científica', "if (/^[+-]?(\\d+(,\\d+)?|,\\d+)[eE][+-]?\\d+$/.test(t) && typeof literal(t) === 'number') return { v: t, fmt: 'scientific', dec: null };", '', /D notación científica/],
  // ronda 5d: Formato condicional (índices 90 en adelante): node tests/ui-mutate.js tests/ui-cf.harness.js 90,91,…
  ['"Mayor que 5" aplica a texto', 'if (!same(a) || (two && !same(b))) return false;', '', /C0 Mayor que 100/, 'ui-cf'],
  // (la guarda "vacías y errores no aplican" era redundante con la comprobación de tipo: mutación no detectada sin
  // ninguna falla, 2026-11-04; se quitó el código, L-028)
  ['Entre no ordena mínimo y máximo', 'const lo = compareVals(a, b, true) <= 0 ? a : b, hi = lo === a ? b : a,', 'const lo = a, hi = b,', /C0 Entre 5 y 100/, 'ui-cf'],
  ['Es igual a distingue mayúsculas', 'const cmp = x => compareVals(v, x, true);', 'const cmp = x => v === x ? 0 : compareVals(v, x, true) || 1;', /C0 Es igual a|C2 Enter acepta/, 'ui-cf'],
  ['las reglas de texto distinguen mayúsculas', 'const t = err ? null : cfText(v).toLocaleLowerCase(LOCALE), s = String(q).toLocaleLowerCase(LOCALE);', 'const t = err ? null : cfText(v), s = String(q);', /C0 (Texto que contiene|que comienza)|C2 Texto que contiene/, 'ui-cf'],
  ['"no contiene" no incluye vacías ni errores', 'return err || !t.includes(s);', "return !err && t !== '' && !t.includes(s);", /C0 que no contiene/, 'ui-cf'],
  ['Celdas en blanco no recorta los espacios', "const cfBlank = v => v === null || (typeof v === 'string' && v.trim() === '');", 'const cfBlank = v => v === null;', /C0 Celdas en blanco/, 'ui-cf'],
  ['la semana empieza el lunes', 'const s0 = T - mod(T - 1, 7) +', 'const s0 = T - mod(T - 2, 7) +', /C0 (Esta semana|Semana pasada)/, 'ui-cf'],
  ['"últimos 7 días" toma 8', 'if (p === \'last7\') return x >= T - 6 && x <= T;', 'if (p === \'last7\') return x >= T - 7 && x <= T;', /C0 En los últimos 7/, 'ui-cf'],
  ['"Mes pasado" mira el mes próximo', "cfYm(x) - cfYm(T) === (p === 'lastMonth' ? -1", "cfYm(x) - cfYm(T) === (p === 'lastMonth' ? 1", /C0 Mes pasado/, 'ui-cf'],
  ['10 superiores sin empates', '(d.bottom ? v <= a.thr : v >= a.thr)', '(d.bottom ? v <= a.thr : v > a.thr)', /C0 2 superiores|C2 2 superiores/, 'ui-cf'],
  ['10 % sin el mínimo de 1', 'Math.max(1, Math.floor(nums.length * d.rank / 100))', 'Math.floor(nums.length * d.rank / 100)', /C0 1 inferior/, 'ui-cf'],
  ['el promedio cuenta el texto como 0', "if (typeof v === 'number') nums.push(v);\n      const k = cfKey(v);", "nums.push(typeof v === 'number' ? v : 0);\n      const k = cfKey(v);", /C0 promedio/, 'ui-cf'],
  ['desviación estándar poblacional', 'reduce((s, x) => s + (x - a.mean) ** 2, 0) / (nums.length - 1))', 'reduce((s, x) => s + (x - a.mean) ** 2, 0) / nums.length)', /C0 la desviación estándar es la muestral/, 'ui-cf'],
  ['Duplicar valores distingue mayúsculas', "return v === '' ? null : 's' + v.toLocaleLowerCase(LOCALE);", "return v === '' ? null : 's' + v;", /C0 Duplicar|C2 Duplicar valores: Ana/, 'ui-cf'],
  ['la fórmula de la regla no es relativa', 'eng.evalFormulaBool(si, r, c, d.f1, { from: dvAnchor(d) })', 'eng.evalFormulaBool(si, r, c, d.f1, {})', /C0 fórmula =H1>2|C3 fórmula/, 'ui-cf'],
  ['la fórmula de Nueva regla se guarda tal como se escribe (sin la activa)', 'const fromActive = f => isFormula(f) ? shiftFormula(f, a.r - A.r, a.c - A.c) : f;\n    const opt', 'const fromActive = f => f;\n    const opt', /C3 fórmula =\$B3>10/, 'ui-cf'],
  ['la regla de menor prioridad gana', 'if (!(p in out)) out[p] = x;', 'out[p] = x;', /C0 prioridad|C4 Aplicar/, 'ui-cf'],
  ['"Detener si es verdad" no hace nada', 'if (d.stop) break;', '', /C0 "Detener|C4 "Detener/, 'ui-cf'],
  ['las celdas fantasma no cuentan para los duplicados', 'for (const sp of si === wb.active ? spillList() : eng.spills(si)) for (const g of d.ranges) {', 'for (const sp of []) for (const g of d.ranges) {', /C0 duplicados con celdas fantasma/, 'ui-cf'],
  ['las celdas vacías con regla no se pintan', '|| (cfR.length && cfR.some(g => inArea(g, r, c)))) paintCell(r, c);', ') paintCell(r, c);', /C3 Celdas en blanco pinta/, 'ui-cf'],
  ['sin vista previa en vivo', 'cfPreview = { si: wb.active, list: b && b.rule ? [b.rule, ...(sheet.cf || [])] : sheet.cf || CF_NONE }; cfRefresh(); };', 'cfRefresh(); };', /C1 (vista previa|al escribir 100|"Relleno rojo claro")|C2 de vuelta/, 'ui-cf'],
  ['cerrar el cuadro no revierte la vista previa', 'onClose: () => { closed = true; cfPreview = null; cfRefresh(); } });', 'onClose: () => { closed = true; } });', /C1 (Esc cierra|Cancelar también)/, 'ui-cf'],
  ['la vista previa vuelve después de Esc', 'if (closed) return; const b = build(false);', 'const b = build(false);', /C1 Esc cierra/, 'ui-cf'],
  // (ronda 5e: el clic va por cellAt y admite arrastre con pickDrag; misma regla)
  ['un clic en una celda no escribe su referencia', 'if (!p || !onPick || e.button !== 0) return;', 'return;', /C1 clic en E1|C3 Nueva regla desde la cinta/, 'ui-cf'],
  ['la regla nueva queda abajo', 'if (yes && rule) applyChanges([], { cf: [rule, ...(sheet.cf || [])] });', 'if (yes && rule) applyChanges([], { cf: [...(sheet.cf || []), rule] });', /C1 la regla nueva queda arriba/, 'ui-cf'],
  ['Borrar formato no quita el formato condicional', 'styleSel(s => { for (const k in s) delete s[k]; }, { cf: dvRemove(sheet.cf || [], vis) });', 'styleSel(s => { for (const k in s) delete s[k]; });', /C5 Borrar formato/, 'ui-cf'],
  ['Borrar todo no quita el formato condicional', 'applyChanges(items, { dv: dvRemove(sheet.dv || [], vis), cf: dvRemove(sheet.cf || [], vis) });', 'applyChanges(items, { dv: dvRemove(sheet.dv || [], vis) });', /C5 Borrar todo/, 'ui-cf'],
  ['deshacer no restaura el formato condicional', 'if (rec.cf) setCf(sheet, clone(rec.cf[which]));', '', /C1 otro Ctrl\+Z|C5 Ctrl\+Z/, 'ui-cf'],
  ['insertar filas no desplaza el formato condicional', "['cf', d => d.ranges.length > 0, (d, axis, at, n) => dvShift(d, axis, at, n)],", '', /C5 (insertar una fila|eliminar la fila)/, 'ui-cf'],
  ['pegar no copia el formato condicional', 'const cf = cp.cf ? cfPaste(sheet.cf || [], cp.cf, to, moves) : undefined;', 'const cf = undefined;', /C5 copiar y pegar/, 'ui-cf'],
  ['pegar la misma regla crea otra', 'for (const d of adds) if (!join(out, d) && !join(fresh, d)) fresh.push(d);', 'for (const d of adds) fresh.push(d);', /C5 (copiar y pegar|Ctrl\+J|Pegar formato)/, 'ui-cf'],
  ['Pegar formato no lleva el formato condicional', "const cf = mode === 'formats' && cp.cf ?", 'const cf = false && cp.cf ?', /C5 Pegar formato/, 'ui-cf'],
  ['rellenar no copia el formato condicional', 'cf = cfAddAll(cf, cfRules.map(', 'cf = cfAddAll(cf, [].map(', /C5 Ctrl\+J/, 'ui-cf'],
  ['cortar no mueve el formato condicional', 'const movedCf = cfPieces(src, box).map(d => dvMove(d, dr, dc, false));', 'const movedCf = [];', /C5 cortar/, 'ui-cf'],
  ['renombrar la hoja no actualiza las fórmulas de las reglas', 'for (const d of [...(s.dv || []), ...(s.cf || [])]) dvMapFormulas', 'for (const d of [...(s.dv || [])]) dvMapFormulas', /C5 renombrar/, 'ui-cf'],
  ['.bassx pierde el formato condicional', 'if (Array.isArray(s.cf)) {', 'if (false) {', /C5 \.bassx/, 'ui-cf'],
  ['exportar .xlsx no avisa del formato condicional', 'return dv ? DV_XLSX_LOSS : cf ? CF_XLSX_LOSS : null;', 'return dv ? DV_XLSX_LOSS : null;', /C5 exportar/, 'ui-cf'],
  ['el borde del formato condicional no se dibuja', 'if (s.bd) css += `border-right-color:', 'if (false) css += `border-right-color:', /C2 Borde rojo/, 'ui-cf'],
  ['▲ no cambia la prioridad', 'list.splice(dir < 0 ? j : j + 1, 0, d);', 'list.splice(pick, 0, d);', /C4 (▲|Aplicar)/, 'ui-cf'],
  ['"Se aplica a" no se lee', 'if (!deepEq(g, work[si][i].ranges)) work[si][i] = { ...work[si][i], ranges: g };', '', /C4 "Se aplica a" editable/, 'ui-cf'],
  ['Aplicar no guarda', 'if (diff.some(Boolean)) snapshotOp(', 'if (false) snapshotOp(', /C4 (Aplicar|"Detener|Aceptar guarda)/, 'ui-cf'],
  ['"Selección actual" muestra todas las reglas', "filter(({ d }) => view !== 'sel' || d.ranges.some(", 'filter(({ d }) => true || d.ranges.some(', /C4 con la selección fuera/, 'ui-cf'],
  ['imprimir sin el formato condicional', 'const cell = sheet.cells[addr(r, c)], s = withCf(effStyle(r, c), r, c);\n        const v = eng.value(wb.active, r, c);', 'const cell = sheet.cells[addr(r, c)], s = effStyle(r, c);\n        const v = eng.value(wb.active, r, c);', /C5 imprimir/, 'ui-cf'],
  ['las combinaciones no muestran el formato condicional', 's = withCf(effStyle(m.r1, m.c1), m.r1, m.c1);', 's = effStyle(m.r1, m.c1);', /C5 una combinación/, 'ui-cf'],
  // ronda 5e: escalas de color, barras de datos y conjuntos de íconos: node tests/ui-mutate.js tests/ui-cf2.harness.js
  ['la escala no interpola los colores', 'Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * f)', 'Math.round(ch(a, i))', /E0 escala de 2 colores|E1 escala/, 'ui-cf2'],
  ['arriba del máximo no toma el color del máximo', 'if (v >= hi) return cs[cs.length - 1];', '', /E0 Porcentaje 10 y 90/, 'ui-cf2'],
  ['debajo del mínimo no toma el color del mínimo', 'if (v <= lo) return cs[0];', '', /E0 (Porcentaje 10 y 90|escala de 2)/, 'ui-cf2'],
  ['la segunda mitad de la escala de 3 colores parte del mínimo', 'cfMix(cs[1], cs[2], (v - m) / (hi - m))', 'cfMix(cs[0], cs[2], (v - m) / (hi - m))', /E0 escala de 3 colores|E3 62,5/, 'ui-cf2'],
  ['el percentil no interpola (rango más cercano)', 'sorted[i] + (h - i) * (sorted[i + 1] - sorted[i])', 'sorted[i]', /E0 percentil interpolado/, 'ui-cf2'],
  ['Porcentaje es el número tal cual', 'if (p.k === \'percent\') return a.lo + (a.hi - a.lo) * x / 100;', 'if (p.k === \'percent\') return x;', /E0 Porcentaje sobre 10\.\.50/, 'ui-cf2'],
  ['Automático como mínimo es el mínimo', "if (p.k === 'auto') return end === 'lo' ? Math.min(0, a.lo) : Math.max(0, a.hi);", "if (p.k === 'auto') return end === 'lo' ? a.lo : Math.max(0, a.hi);", /E0 Automático en positivos|E1 barra/, 'ui-cf2'],
  ['Automático como máximo es el máximo', "if (p.k === 'auto') return end === 'lo' ? Math.min(0, a.lo) : Math.max(0, a.hi);", "if (p.k === 'auto') return end === 'lo' ? Math.min(0, a.lo) : a.hi;", /E0 Automático como máximo/, 'ui-cf2'],
  ['un umbral con error igual da formato', 'a.bad = a.t.some(x => x === null);', 'a.bad = false;', /E0 un umbral con error/, 'ui-cf2'],
  ['texto, vacías y errores reciben formato visual', "function cfVisual(d, S, si, v) {\n    if (typeof v !== 'number') return null;", 'function cfVisual(d, S, si, v) {', /E0 (escala de 2|barra automática|"Mostrar ícono)/, 'ui-cf2'],
  ['los umbrales no se recalculan', 'spillMemo = null; nameMemo = null; cfMemo = null; }', 'spillMemo = null; nameMemo = null; }', /E0 cambiar E1 a 100/, 'ui-cf2'],
  ['el eje automático no está en el punto del 0', 'ax = hi <= 0 ? 1 : -lo / (hi - lo);', 'ax = hi <= 0 ? 1 : 0.5;', /E0 negativos|E1 negativos/, 'ui-cf2'],
  ['las negativas no se miden con el mínimo', 'e = ax; s = ax - ax * cl(v / lo);', 'e = ax; s = ax - ax * cl(-v / hi);', /E0 negativos|E1 negativos/, 'ui-cf2'],
  ['las positivas no se miden con el máximo', 'e = ax + (1 - ax) * (hi > 0 ? cl(v / hi) : 0);', 'e = ax + (1 - ax) * cl((v - lo) / (hi - lo));', /E0 negativos|E1 negativos/, 'ui-cf2'],
  ['las negativas no son rojas', 'color: neg ? d.neg : d.color,', 'color: d.color,', /E0 (negativos|todos negativos|eje en el punto medio|sin eje|Automático como máximo)|E1 negativos/, 'ui-cf2'],
  ['el eje en el punto medio no existe', "if (d.axis === 'mid') {", 'if (false) {', /E0 eje en el punto medio/, 'ui-cf2'],
  ['"Ninguno" igual dibuja el eje en el 0', "} else if (d.axis === 'auto' && lo < 0) {", '} else if (lo < 0) {', /E0 (sin eje|Automático como máximo)/, 'ui-cf2'],
  ['el operador > se comporta como >=', "d.th[i].op === 'gt' ? compareVals(v, a.t[i], true) > 0", "d.th[i].op === 'gt' ? compareVals(v, a.t[i], true) >= 0", /E0 (operador >|comparación de Excel)/, 'ui-cf2'],
  ['los íconos comparan sin las 15 cifras de Excel', "d.th[i].op === 'gt' ? compareVals(v, a.t[i], true) > 0", "d.th[i].op === 'gt' ? v > a.t[i]", /E0 comparación de Excel/, 'ui-cf2'],
  ['Invertir criterio de ordenación no invierte', 'i: d.rev ? d.th.length - i : i,', 'i: i,', /E0 Invertir|E3 la regla de íconos/, 'ui-cf2'],
  ['los umbrales por omisión de 3 íconos no son 67/33', "const CF_ICON_DEF = { 3: ['67', '33'],", "const CF_ICON_DEF = { 3: ['67', '34'],", /E0 (3 flechas|los umbrales por omisión)|E3 Conjunto de íconos por omisión/, 'ui-cf2'],
  ['los umbrales por omisión de 5 íconos no son 80/60/40/20', "5: ['80', '60', '40', '20'] };", "5: ['80', '60', '40', '25'] };", /E0 5 valoraciones|E3 5 valoraciones/, 'ui-cf2'],
  ['las escalas guardan "Detener si es verdad"', 'o.stop = !CF_VIS.has(d.type) && d.stop === true;', 'o.stop = d.stop === true;', /E0 una escala nunca corta/, 'ui-cf2'],
  ['la fórmula de un umbral acepta referencias relativas', 'if (shiftFormula(v, 1, 1) !== v) return no(CF_REL_MSG);', '', /E3 fórmula con referencia relativa/, 'ui-cf2'],
  ['Porcentaje acepta más de 100', "if ((k === 'percent' || k === 'percentile') && (x < 0 || x > 100))", "if ((k === 'percent' || k === 'percentile') && (x < 0))", /E3 Porcentaje fuera/, 'ui-cf2'],
  ['Mínima mayor que Máxima se acepta', '&& literal(a.v) >= literal(b.v) ? {', '&& false ? {', /E3 Número 80 y 20/, 'ui-cf2'],
  ['la barra no deja margen en la celda', 'const CF_PAD = 2;', 'const CF_PAD = 0;', /E1 barra|E2 Sólido|E5 barra/, 'ui-cf2'],
  ['el valor queda debajo de la barra', 'td.innerHTML = deco + (text ? `<span class="cfv">${td.innerHTML}</span>` : \'\');', 'td.innerHTML = deco + td.innerHTML;', /E1 el valor se ve encima/, 'ui-cf2'],
  ['"Mostrar solo la barra" muestra el valor', "let text = deco && cfHideValue(s) ? '' : display(v, { v: cell ? cell.v : '', s });", "let text = display(v, { v: cell ? cell.v : '', s });", /E1 "Mostrar solo|E3 la barra se crea|E1 "Mostrar ícono/, 'ui-cf2'],
  ['la barra no se ubica respecto de su celda', "if (!css.includes('position:sticky')) css += 'position:relative;';", '', /E1 barra|E2 Sólido|E5 barra/, 'ui-cf2'],
  ['la barra quita el sticky de los paneles inmovilizados', "if (!css.includes('position:sticky')) css += 'position:relative;';", "css += 'position:relative;';", /E1 (paneles|al desplazar)/, 'ui-cf2'],
  ['las combinaciones no muestran la barra', "const deco = s.bar || s.icon ? cfDeco(s) : '', txt = esc(display(v, { v: cell ? cell.v : '', s }));\n      if (s.icon)", "const deco = '', txt = esc(display(v, { v: cell ? cell.v : '', s }));\n      if (s.icon)", /E1 combinación/, 'ui-cf2'],
  ['imprimir sin barras', "const deco = s.bar || s.icon ? cfDeco(s) : '', txt = esc(display(v, { v: cell ? cell.v : '', s }));\n        if (deco)", "const deco = '', txt = esc(display(v, { v: cell ? cell.v : '', s }));\n        if (deco)", /E1 imprimir/, 'ui-cf2'],
  ['sin vista previa al pasar el ratón', 'cfPreview = { si: wb.active, list: [cfGalleryRule(p), ...(sheet.cf || [])] };', '', /E2 pasar el ratón/, 'ui-cf2'],
  ['la vista previa de la galería no se va al salir', 'function cfHoverOff() { if (!cfHover) return; cfHover = false; cfPreview = null; cfRefresh(); }', 'function cfHoverOff() { if (!cfHover) return; cfHover = false; cfRefresh(); }', /E2 (al salir|Esc cierra)/, 'ui-cf2'],
  ['cerrar el menú no apaga la vista previa', "menu.querySelectorAll('div.open').forEach(x => x.classList.remove('open')); cfHoverOff(); }", "menu.querySelectorAll('div.open').forEach(x => x.classList.remove('open')); }", /E2 vista previa sin el ratón/, 'ui-cf2'],
  ['la regla de la galería queda abajo', 'if (rule) applyChanges([], { cf: [rule, ...(sheet.cf || [])] });   // arriba', 'if (rule) applyChanges([], { cf: [...(sheet.cf || []), rule] });   // arriba', /E2 la regla de la galería entra arriba/, 'ui-cf2'],
  ['la galería de 3 colores no usa el percentil 50', "{ k: 'percentile', v: '50', color: cs[1] }", "{ k: 'percent', v: '50', color: cs[1] }", /E2 clic en la galería/, 'ui-cf2'],
  ['las barras sólidas de la galería llevan borde', 'grad, border: grad });', 'grad, border: true });', /E2 Sólido verde/, 'ui-cf2'],
  ['insertar filas no ajusta la fórmula del mínimo o el máximo', "for (const k of ['lo', 'hi']) if (d[k] && isFormula(d[k].v)) d[k] = { ...d[k], v: fn(d[k].v) };", '', /E5 insertar una fila/, 'ui-cf2'],
  ['renombrar la hoja no ajusta los umbrales de los íconos', "for (const k of ['pts', 'th']) if (Array.isArray(d[k])) d[k] = d[k].map(p => isFormula(p.v) ? { ...p, v: fn(p.v) } : p);", '', /E5 renombrar/, 'ui-cf2'],
  ['"Detener si es verdad" se puede marcar en una escala', "tr.querySelector('.cf-stop').disabled = true;", '', /E4 descripciones/, 'ui-cf2'],
  ['la columna Formato no muestra la escala, la barra o los íconos', 'sm.innerHTML = cfVisSample(d);', '', /E4 la columna Formato/, 'ui-cf2'],
  ['la pestaña Número no guarda el formato', 'if (nf) { o.fmt = nf; if (CF_DEC_FMTS.includes(nf) && /^\\d+$/.test(nd)) o.dec = +nd; }', '', /E6 (la regla reemplaza|vista previa con el formato)/, 'ui-cf2'],
  // (la versión "undefined en vez de null" era equivalente mientras la regla vive en memoria: se reemplazó, L-028)
  ['la regla sin decimales deja los de la celda', 'o.dec = CF_DEC_FMTS.includes(s.fmt) && Number.isInteger(s.dec) && s.dec >= 0 && s.dec <= 30 ? s.dec : null; }', 'if (CF_DEC_FMTS.includes(s.fmt) && Number.isInteger(s.dec) && s.dec >= 0 && s.dec <= 30) o.dec = s.dec; }', /E6 B1 con 4 decimales/, 'ui-cf2'],
  ['"Se aplica a" no toma el rango de la hoja', 'inp.value = cfRangesText([g], sheet);', '', /E6 (Administrador: clic|arrastre)/, 'ui-cf2'],
  ['arrastrar no amplía "Se aplica a"', 'if (x && (x.r !== last.r || x.c !== last.c)) { last = x; onPick(p.r, p.c, rect(x)); }', 'if (x && (x.r !== last.r || x.c !== last.c)) { last = x; }', /E6 arrastre/, 'ui-cf2'],
  ['el Administrador es modal (no deja elegir celdas)', "focus: '#cfShow', modeless: true, onPick, pickDrag: true,", "focus: '#cfShow', onPick, pickDrag: true,", /E6 (Administrador: clic|arrastre)/, 'ui-cf2'],
];

const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function main() {
  const HARNESS = path.resolve(process.argv[2] || path.join(__dirname, 'ui-round2b.harness.js'));
  // node tests/ui-mutate.js [arnés] [índices separados por coma] → solo esas mutaciones
  const only = process.argv[3] ? new Set(process.argv[3].split(',').map(Number)) : null;
  const before = hash(path.join(WEB, 'app.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bx-mut-')), copy = path.join(tmp, 'web'), APP = path.join(copy, 'app.js');
  fs.cpSync(WEB, copy, { recursive: true });
  const orig = fs.readFileSync(APP, 'utf8');
  console.log('copia mutada: ' + copy);
  let detected = 0, total = 0;
  try {
    for (const [i, [name, from, to, expect, harness = 'ui-round2b']] of MUTS.entries()) {
      if (only && !only.has(i)) continue;
      // cada mutación la detecta su arnés (nombre exacto: ui-cf2 no hereda las de ui-cf)
      if (path.basename(HARNESS) !== harness + '.harness.js') continue;
      total++;
      if (!orig.includes(from)) { console.log('NO APLICA  ' + name + ' (el texto ya no existe)'); continue; }
      const mutated = orig.replace(from, () => to);   // reemplazo con función: el texto es un dato (L-025)
      try { new vm.Script(mutated); } catch (e) { console.log('NO COMPILA ' + name); continue; }   // L-037
      fs.writeFileSync(APP, mutated);   // solo la copia temporal
      const r = spawnSync(process.execPath, [HARNESS, '--web=' + copy], { encoding: 'utf8', timeout: 300000, env: { ...process.env, BX_WEB: copy } });
      // el arnés tiene que haber servido la copia (si no, la mutación no se probó)
      const served = /^web: (.+)$/m.exec(r.stdout || '');
      if (!served || path.resolve(served[1].trim()) !== path.resolve(copy)) { console.log('SIN RESULTADO ' + name + '  → el arnés no sirvió la copia (' + (served ? served[1] : 'sin línea web:') + ')'); continue; }
      // sin la línea de resumen el arnés no llegó a correr (Chrome o puerto ocupado): no cuenta como detectada
      if (!/\d+ OK, \d+ fallas/.test(r.stdout || '')) { console.log('SIN RESULTADO ' + name + '  → ' + String(r.stderr || r.stdout || r.error).slice(-300)); continue; }
      const fails = (r.stdout || '').split('\n').filter(l => l.startsWith('FALLA'));
      const ok = fails.some(l => expect.test(l));
      if (ok) detected++;
      console.log((ok ? 'DETECTADA  ' : 'NO DETECTADA ') + name + (ok ? '' : '  → fallas: ' + JSON.stringify(fails)));
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Chrome puede tardar en soltar archivos */ }
  }
  // web/app.js nunca se toca: si cambió, fue otro proceso (o un error grave de este script)
  if (hash(path.join(WEB, 'app.js')) !== before) { console.log('\nATENCIÓN: web/app.js cambió durante la corrida'); process.exit(2); }
  console.log(`\n${detected}/${total} mutaciones detectadas (web/app.js intacto)`);
  process.exit(detected === total ? 0 : 1);
}

module.exports = { MUTS };
if (require.main === module) main();

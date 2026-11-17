'use strict';
// Bassxcel — interfaz de la hoja de cálculo
(() => {
  const { colName, addr, parseAddr, FErr, Engine, literal, isFormula, isDateLiteral, serialDate,
    shiftFormula, structural, renameSheetInFormula, toExcelFormula, compareVals } = Bx;
  const $ = s => document.querySelector(s);
  // Configuración regional fija de Excel en español (Chile), independiente del idioma del navegador (L-006)
  const LOCALE = 'es-CL';
  const STORE = 'bassxcel.v1';
  const DEF_W = 90, OVERSCAN = 30;
  let HEAD_W = 46;   // ancho de los encabezados de fila: crece con los dígitos del último número de fila
  let ROW_H = 23, HEAD_H = 23;   // se miden al construir la grilla

  const wrap = $('#gridWrap'), table = $('#grid'), ed = $('#cellEditor'), fb = $('#formulaInput'), nameBox = $('#nameBox');
  const selBox = $('#selBox'), actBox = $('#actBox'), fillBox = $('#fillBox'), clipBox = $('#clipBox');

  let wb, eng, sheet;
  let A = { r: 0, c: 0 }, F = { r: 0, c: 0 };   // celda activa y extremo de la selección
  // Ancla de la selección cuando no coincide con la celda activa (Shift+Espacio, Ctrl+Espacio,
  // clic en encabezados, Tab/Enter dentro de un rango); null = el ancla es la celda activa
  let P = null;
  let edit = null;                               // { mode: 'cell'|'bar', typed, refIns }
  let undoStack = [], redoStack = [];
  let clip = null, drag = null, fileHandle = null, saveTimer = null;
  // Grilla virtualizada: solo existen en el DOM las filas visibles (vr.r0 .. vr.r1-1);
  // la posición de cualquier celda se calcula con colX y ROW_H, sin leer el DOM.
  let tds = [], colHeads = [], rowHeads = [], colEls = [], colX = [], vr = { r0: 0, r1: 0 }, tbody = null;
  // celdas fantasma de las filas dibujadas (clave r * GK + c), se arma en paintAll
  const GK = 16384;
  let ghostSet = new Set();

  // ---------- Modelo ----------
  const newSheet = name => ({ name, rows: 1000, cols: 52, cells: {}, colW: {} });
  // names: nombres definidos del libro (modelo del motor: { name, scope: null | hoja, ref: '=Hoja1!$A$2:$A$20', comment })
  const newWorkbook = () => ({ name: 'Libro1', active: 0, sheets: [newSheet('Hoja1')], names: [] });
  const clone = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  const getCell = (r, c) => sheet.cells[addr(r, c)];
  const rawOf = cell => cell && cell.v != null ? String(cell.v) : '';
  const anchor = () => P || A;
  const range = () => { const a = P || A; return { r1: Math.min(a.r, F.r), r2: Math.max(a.r, F.r), c1: Math.min(a.c, F.c), c2: Math.max(a.c, F.c) }; };
  let extra = [];   // rangos adicionales de la selección múltiple (Ctrl+clic)
  const allRanges = () => [...extra, range()];
  const single = g => g.r1 === g.r2 && g.c1 === g.c2;

  // ---------- Matrices dinámicas: desbordes de la hoja activa ----------
  // eng.spills() en caché hasta el próximo recálculo; recalcAll() es el único lugar que recalcula (prime después de
  // cada recalc, como pide el motor). Las celdas fantasma (valores desbordados sin contenido propio) no están en
  // sheet.cells: se pintan, se navegan y se exportan a partir de esta lista.
  let spillMemo = null, nameMemo = null;
  // Formato condicional: estilos calculados por celda y agregados por regla (promedio, superiores, duplicados), válidos
  // hasta el próximo recálculo; cfPreview = reglas de la vista previa de un cuadro abierto ({ si, list }) o null
  let cfMemo = null, cfPreview = null;
  function recalcAll() { eng.recalc(); eng.prime(wb.active); spillMemo = null; nameMemo = null; cfMemo = null; }
  function spillList() {
    if (!spillMemo || spillMemo.si !== wb.active) spillMemo = { si: wb.active, list: eng.spills(wb.active) };
    return spillMemo.list;
  }
  const inArea = (g, r, c) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;
  // Desborde que cubre (r, c) como celda fantasma (no el ancla), o null
  function ghostOf(r, c) {
    for (const s of spillList()) if (inArea(s, r, c) && (r !== s.anchor.r || c !== s.anchor.c)) return s;
    return null;
  }
  // ¿Celda con dato? Contenido propio o valor desbordado (Ctrl+flechas, región actual, Ctrl+Fin, relleno, autosuma)
  const hasData = (r, c) => { const x = sheet.cells[addr(r, c)]; return !!(x && x.v !== '') || !!ghostOf(r, c); };
  // Celdas fantasma de un área (máx. 200.000), para recorrerlas igual que sheet.cells
  function ghostsIn(g) {
    const out = [];
    for (const s of spillList()) {
      const r1 = Math.max(s.r1, g.r1), r2 = Math.min(s.r2, g.r2), c1 = Math.max(s.c1, g.c1), c2 = Math.min(s.c2, g.c2);
      for (let r = r1; r <= r2 && out.length < 200000; r++) for (let c = c1; c <= c2; c++) if (r !== s.anchor.r || c !== s.anchor.c) out.push({ r, c, s });
    }
    return out;
  }
  // Última fila y columna con datos, contando los desbordes (Ctrl+Fin, imprimir, CSV)
  function usedExtent(withFormats) {
    let maxR = -1, maxC = -1;
    for (const [k, cell] of Object.entries(sheet.cells)) { if (cell.v === '' && !(withFormats && cell.s)) continue; const p = parseAddr(k); maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c); }
    for (const s of spillList()) { maxR = Math.max(maxR, s.r2); maxC = Math.max(maxC, s.c2); }
    return { r: maxR, c: maxC };
  }

  function normCell(cell) {
    if (!cell) return undefined;
    const s = {};
    // dec = 0 (cero decimales) es un valor válido aunque sea "falso"
    for (const [k, v] of Object.entries(cell.s || {})) if ((v || (k === 'dec' && v === 0)) && !(k === 'fmt' && v === 'general')) s[k] = v;
    // un número o lógico (archivo escrito a mano, otra herramienta) pasa por toRaw: String(1.234) se leería como 1234 (L-014)
    const o = { v: cell.v == null ? '' : typeof cell.v === 'string' ? cell.v : Bx.toRaw(cell.v) };
    if (Object.keys(s).length) o.s = s;
    return o.v === '' && !o.s ? undefined : o;
  }
  function setKey(s, k, cell) { if (cell) s.cells[k] = cell; else delete s.cells[k]; }

  function normalize(o) {
    const w = { name: String(o.name || 'Libro1'), active: 0, sheets: [] };
    for (const s of o.sheets || []) {
      const ns = newSheet(String(s.name || 'Hoja' + (w.sheets.length + 1)));
      ns.rows = Math.max(20, +s.rows || 1000); ns.cols = Math.max(5, +s.cols || 52);
      ns.colW = s.colW || {};
      if (s.colS) ns.colS = s.colS;
      if (s.filter && s.filter.crit) {
        ns.filter = s.filter;
        // filas que oculta el filtro (las lee SUBTOTALES); si falta, se calcula al construir la grilla
        if (!Array.isArray(ns.filter.hidden)) delete ns.filter.hidden;
      }
      if (Array.isArray(s.merges) && s.merges.length) ns.merges = s.merges;
      // validación de datos: las reglas mal formadas (archivo escrito a mano, otra versión) se descartan
      if (Array.isArray(s.dv)) { const dv = s.dv.map(normDv).filter(Boolean); if (dv.length) ns.dv = dv; }
      // formato condicional: igual que la validación (reglas mal formadas o de tipos desconocidos se descartan)
      if (Array.isArray(s.cf)) { const cf = s.cf.map(normCf).filter(Boolean); if (cf.length) ns.cf = cf; }
      if (Array.isArray(s.hiddenR) && s.hiddenR.length) ns.hiddenR = s.hiddenR;
      if (Array.isArray(s.hiddenC) && s.hiddenC.length) ns.hiddenC = s.hiddenC;
      if (s.freeze && (s.freeze.r || s.freeze.c)) ns.freeze = { r: +s.freeze.r || 0, c: +s.freeze.c || 0 };
      if (s.rowS) ns.rowS = s.rowS;
      // altos de fila manuales en píxeles (0..546 = 409 pt, el máximo de Excel)
      if (s.rowH && typeof s.rowH === 'object') {
        const rh = {};
        for (const [r, h] of Object.entries(s.rowH)) if (+r >= 0 && isFinite(+h) && +h >= 1) rh[+r] = Math.min(546, +h);
        if (Object.keys(rh).length) ns.rowH = rh;
      }
      // Archivos y autoguardados anteriores a la sintaxis es-CL estricta: cada fórmula se migra una vez con la
      // regla vieja, que conserva el valor calculado (L-026); los guardados nuevos llevan syntax: 'es-CL'
      const legacy = o.syntax !== 'es-CL';
      for (const [k, c] of Object.entries(s.cells || {})) {
        const p = parseAddr(k), n = normCell(c);
        if (!p || !n) continue;
        if (legacy && isFormula(n.v)) { try { n.v = '=' + Bx.migrateLegacyFormula(n.v.slice(1)); } catch { /* se deja como estaba */ } }
        ns.cells[addr(p.r, p.c)] = n;
      }
      if (s.sel) ns.sel = s.sel;
      w.sheets.push(ns);
    }
    if (!w.sheets.length) w.sheets.push(newSheet('Hoja1'));
    w.active = Math.min(Math.max(0, +o.active || 0), w.sheets.length - 1);
    // nombres definidos: el motor descarta los inválidos, duplicados o con hoja de ámbito inexistente
    w.names = Bx.normalizeNames(o.names, w);
    return w;
  }
  const serialize = () => ({ app: 'Bassxcel', version: 1, syntax: 'es-CL', name: wb.name, active: wb.active, sheets: wb.sheets, names: wb.names || [] });

  // ---------- Formato de visualización ----------
  // Código de error interno (inglés, el de .xlsx) → texto que muestra Excel en español
  const ERR_TXT = code => (Bx.ERR_ES && Bx.ERR_ES[code]) || code;
  const nf = (v, o) => v.toLocaleString(LOCALE, o);
  function general(v) {
    const a = Math.abs(v);
    if (Number.isInteger(v) && a < 1e15) return nf(v, { useGrouping: false });
    if (a !== 0 && (a < 1e-9 || a >= 1e15)) return v.toExponential(4);
    return nf(v, { useGrouping: false, maximumFractionDigits: 10, maximumSignificantDigits: 15 });
  }
  // Notación científica es-CL con exponente de 2 cifras: 1,23457E+11 (d decimales; trim quita los ceros finales)
  const sciText = (v, d, trim) => {
    let [m, e] = v.toExponential(d).split('e');
    if (trim && m.includes('.')) m = m.replace(/\.?0+$/, '');
    return m.replace('.', ',') + 'E' + (e[0] === '-' ? '-' : '+') + e.replace(/^[+-]/, '').padStart(2, '0');
  };
  // General en el ancho de una celda estándar (11 caracteres): lo usa la barra de estado. 8/3 → 2,666666667;
  // desde 12 dígitos enteros, notación científica ("Formatos de número disponibles en Excel": General usa notación
  // científica para los números de 12 o más dígitos): 123456789012 → 1,23457E+11
  function generalFit(v, width = 11) {
    if (!isFinite(v)) return general(v);
    const a = Math.abs(v);
    if (a >= 1e11 || (a !== 0 && a < 1e-9)) return sciText(v, 5, true);
    if (Number.isInteger(v)) return nf(v, { useGrouping: false });
    const intDigits = a < 1 ? 1 : Math.floor(Math.log10(a)) + 1, room = width - (v < 0 ? 1 : 0) - intDigits - 1;
    if (room < 1) return nf(v, { useGrouping: false, maximumFractionDigits: 0 });
    const t = nf(v, { useGrouping: false, maximumFractionDigits: room });
    return /^-?0$/.test(t) ? sciText(v, 5, true) : t;
  }
  const p2 = n => String(n).padStart(2, '0');
  // Fecha corta de Excel es-CL: dd-mm-aaaa
  function fmtDate(v) { const d = serialDate(Math.floor(v)); return `${p2(d.getUTCDate())}-${p2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`; }
  const FMT_INHERIT = new Set(['SUM', 'AVERAGE', 'MAX', 'MIN', 'MEDIAN', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'ABS', 'SUBTOTAL', 'AGGREGATE']);
  // Formato efectivo: explícito, o deducido como en Excel (fechas escritas, funciones de fecha,
  // o una fórmula que hereda el formato fecha/moneda/porcentaje de la primera celda que referencia)
  function autoFmt(cell, depth = 0) {
    const f = cell.s && cell.s.fmt;
    if (f && f !== 'general') return f;
    const raw = rawOf(cell);
    if (isDateLiteral(raw) || /^=\s*(TODAY|HOY|DATE|FECHA|EOMONTH|FIN\.MES|EDATE|FECHA\.MES)\s*\(/i.test(raw)) return 'date';
    if (/^=\s*(NOW|AHORA)\s*\(/i.test(raw) || Bx.isDateTimeLiteral(raw)) return 'datetime';
    // NSHORA/TIME devuelven una hora: Excel la muestra con formato hh:mm
    if (Bx.isTimeLiteral(raw) || /^=\s*(TIME|NSHORA)\s*\(/i.test(raw)) return 'time';
    // Una fórmula que empieza con una función solo hereda si es de las que devuelven un valor de la misma clase que sus
    // argumentos (=SUMA de montos en moneda se ve en moneda, como Excel); CONTAR, SI, BUSCARV… no heredan
    const fn = /^=\s*([A-Za-z_.À-ſ]+)\s*\(/.exec(raw);
    if (isFormula(raw) && depth < 4 && (!fn || FMT_INHERIT.has(Bx.CANON[fn[1].toUpperCase()] || ''))) {
      const ref = Bx.findRefs(raw)[0];
      if (ref && !ref.sheet) {
        const src = sheet.cells[addr(ref.a.r, ref.a.c)];
        if (src && src !== cell) {
          const sf = autoFmt(src, depth + 1);
          if (['date', 'datetime', 'time', 'currency', 'percent'].includes(sf)) return sf;
        }
      }
    }
    return 'general';
  }
  function display(v, cell) {
    if (v === null) return '';
    if (v instanceof FErr) return ERR_TXT(v.code);   // errores con su nombre en español (#¡DIV/0!, #¿NOMBRE?); .xlsx sigue en inglés
    if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
    if (typeof v !== 'number') return String(v);
    // s.dec: decimales fijados con los botones ←,0 / ,00→ (si no hay, cada formato usa su valor por defecto)
    const dec = cell && cell.s && cell.s.dec != null ? cell.s.dec : null;
    const fixed = (x, d) => nf(x, { minimumFractionDigits: d, maximumFractionDigits: d });
    switch (cell ? autoFmt(cell) : 'general') {
      case 'number': return fixed(v, dec ?? 2);
      case 'integer': return nf(Math.round(v), { maximumFractionDigits: 0 });
      case 'currency': return (v < 0 ? '-$' : '$') + (dec != null ? fixed(Math.abs(v), dec) : nf(Math.abs(v), { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
      case 'percent': return (dec != null ? fixed(v * 100, dec) : nf(v * 100, { maximumFractionDigits: 2 })) + '%';
      case 'scientific': return sciText(v, dec ?? 2, false);   // 0,00E+00: 1,00E+03; 12345678901 → 1,23E+10
      case 'date': return fmtDate(v);
      case 'datetime': { const d = serialDate(v); return fmtDate(v) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); }
      case 'time': {
        // hh:mm (o hh:mm:ss si hay segundos); solo la parte fraccionaria, como el formato de hora de Excel
        const secs = Math.round((v - Math.floor(v)) * 86400), h = Math.floor(secs / 3600) % 24, m = Math.floor(secs / 60) % 60, s = secs % 60;
        return `${p2(h)}:${p2(m)}` + (s ? ':' + p2(s) : '');
      }
      default: return general(v);
    }
  }

  // ---------- Construcción y pintado de la grilla ----------
  const isHiddenCol = c => !!(sheet.hiddenC && sheet.hiddenC.includes(c));
  // Columnas ocultas: ancho 0 y contenido invisible mediante una regla CSS generada (sin tocar cada celda)
  const hiddenColStyle = document.createElement('style');
  document.head.appendChild(hiddenColStyle);
  function computeColX() {
    colX = [];
    let x = HEAD_W;
    for (let c = 0; c < sheet.cols; c++) { colX[c] = x; x += isHiddenCol(c) ? 0 : sheet.colW[c] || DEF_W; }
    hiddenColStyle.textContent = (sheet.hiddenC || []).map(c => `#grid tr > :nth-child(${c + 2}) { padding: 0 !important; border: 0 !important; visibility: hidden; }`).join('\n');
    colX[sheet.cols] = x;
    table.style.width = x + 'px';
  }

  // ---------- Alto de fila variable ----------
  // Las filas miden ROW_H salvo las "especiales": alto manual (sheet.rowH, px), alto automático por
  // ajuste de texto o tamaño de fuente (autoH, se calcula y no se guarda) y ocultas (alto 0).
  // Solo esas entran a un índice ordenado con la suma acumulada de sus diferencias con ROW_H, así
  // rowY() y rowAtY() son búsquedas binarias aunque la hoja tenga 1.048.576 filas (L-004).
  let autoH = new Map(), autoSig = '', hidSet = new Set();
  let hIdx = { rows: new Int32Array(0), cum: new Float64Array(1), h: new Map() };
  function buildRowIndex() {
    const m = new Map(autoH);
    for (const [r, h] of Object.entries(sheet.rowH || {})) m.set(+r, +h);   // el alto manual manda sobre el automático
    for (const r of hidSet) m.set(r, 0);
    const rows = Int32Array.from([...m.keys()].filter(r => r < sheet.rows)).sort();
    const cum = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) cum[i + 1] = cum[i] + m.get(rows[i]) - ROW_H;
    hIdx = { rows, cum, h: m };
  }
  const rowH = r => { const h = hIdx.h.get(r); return h === undefined ? ROW_H : h; };
  // Borde superior de la fila r en coordenadas de #gridInner (incluye el encabezado de columnas)
  function rowY(r) {
    const a = hIdx.rows;
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < r) lo = m + 1; else hi = m; }
    return HEAD_H + r * ROW_H + hIdx.cum[lo];
  }
  // Fila que contiene la coordenada y (las ocultas miden 0 y nunca se devuelven si hay una visible en esa y)
  function rowAtY(y) {
    let lo = 0, hi = sheet.rows - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rowY(m) <= y) lo = m; else hi = m - 1; }
    return lo;
  }
  function colAtX(x) {
    let lo = 0, hi = sheet.cols - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (colX[m] <= x) lo = m; else hi = m - 1; }
    return lo;
  }
  // Primera fila / columna visible en pantalla (Excel deja ahí la celda activa al hacer clic en un encabezado)
  function topVisRow() {
    let r = FZ().r ? 0 : rowAtY(wrap.scrollTop + HEAD_H + 2);
    while (isHidden(r) && r < sheet.rows - 1) r++;
    return r;
  }
  function leftVisCol() {
    let c = FZ().c ? 0 : colAtX(wrap.scrollLeft + HEAD_W + 2);
    while (isHiddenCol(c) && c < sheet.cols - 1) c++;
    return c;
  }

  // Fuente: el tamaño se expresa en puntos como en Excel; 11 pt (el predeterminado) = 13 px de la grilla
  const DEF_PT = 11, DEF_FONT = '"Segoe UI", system-ui, sans-serif';
  const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  const ptPx = pt => pt * 13 / DEF_PT;
  const lineH = px => Math.ceil(px * 1.36);   // interlineado del texto ajustado: 13 px → 18 px
  const fontFamily = s => s.ff ? `"${s.ff}", ${DEF_FONT}` : DEF_FONT;
  const cssFont = s => `${s.i ? 'italic ' : ''}${s.b ? '700 ' : ''}${+ptPx(s.fs || DEF_PT).toFixed(2)}px ${fontFamily(s)}`;
  // Líneas que ocupa un texto ajustado a un ancho (mismo criterio que white-space: pre-wrap + overflow-wrap: anywhere)
  function wrapCount(text, s, w) {
    const font = cssFont(s);
    let n = 0;
    w = Math.max(8, w - 1);
    for (const para of String(text).split('\n')) {
      n++;
      let x = 0;
      for (const tok of para.split(/(\s+)/)) {
        if (!tok) continue;
        const tw = measure(tok, font);
        if (/^\s/.test(tok)) { x += tw; continue; }   // los espacios quedan colgando al final de la línea
        if (x > 0 && x + tw > w) { n++; x = 0; }
        if (tw <= w) { x += tw; continue; }
        for (const ch of tok) { const cw = measure(ch, font); if (x > 0 && x + cw > w) { n++; x = 0; } x += cw; }   // palabra más larga que la celda
      }
      if (n > 200) break;
    }
    return n;
  }
  // Alto automático por fila (como Excel cuando la fila no tiene alto manual): crece con el texto ajustado
  // (o con saltos de línea Alt+Enter, que activan el ajuste) y con el tamaño de fuente
  function computeAutoH() {
    const out = new Map(), pad = ROW_H - lineH(13);
    const need = (r, h) => { if (h > ROW_H + 0.5 && h > (out.get(r) || 0)) out.set(r, Math.min(546, Math.ceil(h))); };
    for (const [r, rs] of Object.entries(sheet.rowS || {})) if (rs.fs) need(+r, lineH(ptPx(rs.fs)) + pad);   // formato de fila completa
    const viaColRow = Object.values(sheet.colS || {}).some(x => x.fs || x.wrap) || Object.values(sheet.rowS || {}).some(x => x.wrap);
    for (const [k, cell] of Object.entries(sheet.cells)) {
      if (!viaColRow && !(cell.s && (cell.s.fs || cell.s.wrap))) continue;
      const p = parseAddr(k), s = effStyle(p.r, p.c);
      if (!s.fs && !s.wrap) continue;
      if (isHiddenCol(p.c)) continue;
      const mg = sheet.merges && mergeAt(p.r, p.c);
      if (mg && mg.r1 !== mg.r2) continue;   // como Excel: el autoajuste ignora las combinaciones de varias filas
      let lines = 1;
      if (s.wrap && cell.v !== '') {
        const v = eng.value(wb.active, p.r, p.c);
        const w = mg ? colX[mg.c2 + 1] - colX[mg.c1] : colX[p.c + 1] - colX[p.c];
        if (typeof v === 'string') lines = wrapCount(display(v, { v: cell.v, s }), s, w - 9);
      }
      need(p.r, lines * lineH(ptPx(s.fs || DEF_PT)) + pad);
    }
    return out;
  }
  // Recalcula los altos automáticos; devuelve true si cambiaron (hay que redibujar las filas)
  function syncHeights() {
    const next = computeAutoH(), sig = [...next].join(';');
    if (sig === autoSig) return false;
    autoH = next; autoSig = sig;
    buildRowIndex();
    return true;
  }

  function buildGrid() {
    sheet = wb.sheets[wb.active];
    // 1.048.576 tiene 7 dígitos: el encabezado se ensancha para no cortarlos (como Excel)
    HEAD_W = Math.max(46, Math.ceil(String(Math.min(sheet.rows, 1048576)).length * 7.2 + 14));
    let h = `<colgroup><col style="width:${HEAD_W}px">`;
    for (let c = 0; c < sheet.cols; c++) h += `<col style="width:${isHiddenCol(c) ? 0 : sheet.colW[c] || DEF_W}px">`;
    h += '</colgroup><thead><tr><th class="corner" title="Seleccionar todo"></th>';
    for (let c = 0; c < sheet.cols; c++) h += `<th data-c="${c}">${colName(c)}<div class="rz" data-c="${c}"></div></th>`;
    h += `</tr></thead><tbody><tr data-r="0"><th class="rh">1</th>${'<td></td>'.repeat(sheet.cols)}</tr></tbody>`;
    table.innerHTML = h;
    computeColX();
    // Encabezados de columnas inmovilizadas: fijos también a la izquierda
    for (let c = 0; c < FZ().c; c++) { const th = table.tHead.rows[0].cells[c + 1]; th.style.left = colX[c] + 'px'; th.style.zIndex = 6; }
    tbody = table.tBodies[0];
    // Alturas fraccionarias (escalado de Windows 125 %/150 %): offsetHeight redondea y desalinea filas lejanas
    HEAD_H = table.tHead.rows[0].getBoundingClientRect().height || HEAD_H;
    ROW_H = tbody.rows[0].getBoundingClientRect().height || ROW_H;
    colHeads = [...table.tHead.rows[0].cells].slice(1);
    colEls = [...table.querySelectorAll('col')].slice(1);
    rebuildVisible();
    autoH = computeAutoH(); autoSig = [...autoH].join(';');
    buildRowIndex();
    vr = { r0: 0, r1: 0, p0: -1, p1: -1, list: [] };
    renderRows(true);
    drawFilterButtons();
  }

  // Paneles inmovilizados: las primeras f.r filas y f.c columnas quedan fijas (position: sticky)
  const FZ = () => sheet.freeze || { r: 0, c: 0 };
  function fzCss(r, c) {
    const f = FZ(), top = r < f.r, left = c < f.c;
    let css = '';
    if (top || left) {
      css += `position:sticky;background:#fff;z-index:${top && left ? 2 : 1};`;
      if (top) css += `top:${rowY(r).toFixed(3)}px;`;
      if (left) css += `left:${colX[c]}px;`;
    }
    if (f.r && r === f.r - 1) css += 'border-bottom-color:#8a8a8a;';
    if (f.c && c === f.c - 1) css += 'border-right-color:#8a8a8a;';
    return css;
  }
  // Fila con alto distinto del predeterminado: --rh es el alto (border-box) y --lh el alto útil del contenido
  function rowAttr(r) {
    const h = rowH(r);
    return Math.abs(h - ROW_H) < 0.01 ? '' : ` class="ch" style="--rh:${h.toFixed(2)}px;--lh:${Math.max(1, h - 1).toFixed(2)}px"`;
  }
  function rowHtml(r, plainCells) {
    const f = FZ();
    const th = (r < f.r ? `<th class="rh" style="top:${rowY(r).toFixed(3)}px;z-index:5">` : '<th class="rh">') + (r + 1) + `<div class="rzr" data-r="${r}"></div></th>`;
    if (!f.r && !f.c) return `<tr data-r="${r}"${rowAttr(r)}>${th}${plainCells}</tr>`;
    let cells = '';
    for (let c = 0; c < sheet.cols; c++) { const css = fzCss(r, c); cells += css ? `<td style="${css}"></td>` : '<td></td>'; }
    return `<tr data-r="${r}"${rowAttr(r)}>${th}${cells}</tr>`;
  }

  // ---------- Filas ocultas por el autofiltro ----------
  // visRows: filas visibles en orden (solo si hay filas ocultas). La grilla trabaja con "posiciones" visibles.
  let visRows = null;
  // Filas que oculta el filtro según sus criterios (se evalúa al aplicar el filtro, no en cada edición: como
  // Excel, editar una fila filtrada no la vuelve a ocultar hasta "Volver a aplicar")
  function computeFilterHidden() {
    const flt = sheet.filter, out = [];
    const crit = Object.entries((flt && flt.crit) || {});
    if (!crit.length) return out;
    for (let r = flt.r + 1; r <= flt.r2; r++) {
      for (const [c, allowed] of crit) {
        if (!allowed.includes(cellText(r, +c))) { out.push(r); break; }
      }
    }
    return out;
  }
  function hiddenRows() {
    const flt = sheet.filter, hid = new Set(sheet.hiddenR || []);   // ocultas a mano + ocultas por el filtro
    if (!flt) return hid;
    // sheet.filter.hidden es el modelo que lee SUBTOTALES/AGREGAR (P0 3)
    if (!Array.isArray(flt.hidden)) flt.hidden = computeFilterHidden();
    for (const r of flt.hidden) hid.add(r);
    return hid;
  }
  // Filas ocultas por el filtro activo (null si no hay): las acciones sobre un rango filtrado las saltan (P0 2).
  // Las ocultas a mano, sin filtro, se siguen incluyendo como en Excel.
  const filterHidden = () => sheet.filter && sheet.filter.hidden && sheet.filter.hidden.length ? new Set(sheet.filter.hidden) : null;
  function rebuildVisible() {
    const hid = hidSet = hiddenRows();
    if (!hid.size) { visRows = null; return; }
    const arr = new Int32Array(sheet.rows);
    let k = 0;
    for (let r = 0; r < sheet.rows; r++) if (!hid.has(r)) arr[k++] = r;
    visRows = arr.subarray(0, k);
  }
  const posOf = r => { if (!visRows) return r; let lo = 0, hi = visRows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (visRows[m] < r) lo = m + 1; else hi = m; } return lo; };
  const rowAt = p => visRows ? (p < visRows.length ? visRows[p] : sheet.rows) : p;
  const visCount = () => visRows ? visRows.length : sheet.rows;
  const isHidden = r => !!visRows && visRows[posOf(r)] !== r;
  // Texto mostrado (también de las celdas fantasma: la lista del filtro y sus criterios ven los valores desbordados)
  function cellText(r, c) {
    const cell = sheet.cells[addr(r, c)];
    return cell || ghostOf(r, c) ? display(eng.value(wb.active, r, c), { v: cell ? cell.v : '', s: effStyle(r, c) }) : '';
  }

  // Dibuja solo las filas cercanas a la vista (más las inmovilizadas); el resto se sustituye por dos espaciadores
  function renderRows(force) {
    if (!tbody) return;
    const f = FZ(), total = visCount(), pf = posOf(f.r);
    // Posiciones visibles a partir de las coordenadas y (las filas pueden tener altos distintos)
    const vis0 = Math.max(pf, posOf(rowAtY(wrap.scrollTop + rowY(f.r))));
    const vis1 = Math.min(total, posOf(rowAtY(wrap.scrollTop + wrap.clientHeight)) + 1);
    if (!force && vis0 >= vr.p0 && vis1 <= vr.p1) return;
    const p0 = Math.max(pf, Math.min(vis0, total - 1) - OVERSCAN), p1 = Math.max(p0, Math.min(total, vis1 + OVERSCAN));
    const spacer = px => px > 0.001 ? `<tr class="sp"><td colspan="${sheet.cols + 1}" style="height:${px.toFixed(3)}px"></td></tr>` : '';
    const cells = '<td></td>'.repeat(sheet.cols);
    let h = '';
    const list = [];
    for (let r = 0; r < f.r; r++) if (!isHidden(r)) h += rowHtml(r, cells);
    h += spacer(rowY(rowAt(p0)) - rowY(f.r));
    for (let p = p0; p < p1; p++) { const r = rowAt(p); list.push(r); h += rowHtml(r, cells); }
    tbody.innerHTML = h + spacer(rowY(sheet.rows) - rowY(rowAt(p1)));
    tds = []; rowHeads = [];
    for (const tr of tbody.rows) {
      if (tr.dataset.r == null) continue;
      rowHeads[+tr.dataset.r] = tr.cells[0];
      tds[+tr.dataset.r] = [...tr.cells].slice(1);
    }
    vr = { r0: list.length ? list[0] : 0, r1: list.length ? list[list.length - 1] + 1 : 0, p0, p1, list };
    paintAll();
    applyHL();
  }
  wrap.addEventListener('scroll', () => {
    renderRows(false);
    closeDvList();   // la lista desplegable de validación no sigue al desplazamiento (Excel la cierra)
    // Con paneles inmovilizados, las cajas de selección sobre celdas fijas deben seguir al desplazamiento
    const f = FZ();
    // (y las que empiezan en la zona desplazable se recortan en el borde de los paneles: fzClip)
    if (f.r || f.c) {
      place(selBox, range()); place(actBox, sheet.merges && mergeAt(A.r, A.c) || { r1: A.r, c1: A.c, r2: A.r, c2: A.c });
      drawClip(); drawRefHL(); drawSpill(); drawExtra(); drawMerges(); drawDv();
    }
  }, { passive: true });

  // Ancho de texto medido con canvas (sin tocar el DOM), con caché; considera negrita, cursiva, fuente y tamaño
  const measureCtx = document.createElement('canvas').getContext('2d'), widthCache = new Map();
  function measure(t, font) {
    const k = font + '|' + t;
    let w = widthCache.get(k);
    if (w === undefined) {
      measureCtx.font = font;
      w = measureCtx.measureText(t).width;
      if (widthCache.size > 5000) widthCache.clear();
      widthCache.set(k, w);
    }
    return w;
  }
  const textWidth = (t, s) => measure(t, cssFont(s || {}));
  // Estilos de fuente y alineación vertical comunes a celdas, combinaciones e impresión
  function fontCss(s) {
    let css = '';
    if (s.b) css += 'font-weight:700;';
    if (s.i) css += 'font-style:italic;';
    // st: tachado (solo lo pone el formato condicional)
    if (s.u || s.st) css += `text-decoration:${[s.u && 'underline', s.st && 'line-through'].filter(Boolean).join(' ')};`;
    if (s.ff) css += `font-family:${fontFamily(s).replace(/"/g, "'")};`;
    if (s.fs) css += `font-size:${+ptPx(s.fs).toFixed(2)}px;`;
    return css;
  }
  const VA = { top: 'top', middle: 'middle', bottom: 'bottom' };
  function paintCell(r, c) {
    const td = tds[r] && tds[r][c];
    if (!td) return;
    // celda fantasma: valor desbordado de una matriz dinámica, con el formato propio de la celda (columna, fila o
    // celda), no el del ancla: en Excel el formato del rango desbordado es el de cada celda (L-010)
    // el formato condicional se dibuja encima del formato de la celda, sin cambiarlo (effStyle no lo incluye)
    const cell = sheet.cells[addr(r, c)], s = withCf(effStyle(r, c), r, c), ghost = ghostSet.has(r * GK + c);
    if (!cell && !ghost && !Object.keys(s).length) { if (td._p) { td.textContent = ''; td.className = ''; td.style.cssText = fzCss(r, c); td._p = false; } return; }
    td._p = true;
    const v = cell || ghost ? eng.value(wb.active, r, c) : null;
    // barra de datos o ícono del formato condicional: capas detrás del valor (el ícono ocupa el borde izquierdo)
    const deco = s.bar || s.icon ? cfDeco(s) : '';
    let text = deco && cfHideValue(s) ? '' : display(v, { v: cell ? cell.v : '', s });
    const colW = colX[c + 1] - colX[c] - 8 - (s.icon ? cfIconPx(s) + 2 : 0);
    td.className = v instanceof FErr ? 'err' : typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : '';
    if (typeof v === 'number' && textWidth(text, s) > colW) {
      // Número que no cabe: en General se reducen decimales; si aun así no cabe, #### (como Excel)
      const fmt = autoFmt({ v: cell ? cell.v : '', s });
      let fit = null;
      if (fmt === 'general') {
        // General: primero menos decimales, luego notación científica (1,23457E+11); nunca #### (como Excel)
        for (let d = 9; d >= 0 && fit === null; d--) { const t = nf(v, { useGrouping: false, maximumFractionDigits: d }); if (textWidth(t, s) <= colW) fit = t; }
        for (let d = 5; d >= 0 && fit === null; d--) {
          const t = v.toExponential(d).toUpperCase().replace('.', ',').replace(/E([+-])(\d)$/, 'E$10$2');
          if (textWidth(t, s) <= colW || d === 0) fit = t;
        }
      }
      text = fit ?? '#'.repeat(Math.max(1, Math.floor(colW / textWidth('#', s))));
    }
    const lh = s.fs ? lineH(ptPx(s.fs)) : 0;
    if (s.wrap && typeof v === 'string' && text) {
      // Ajustar texto: varias líneas dentro del ancho de la celda (la fila crece sola si no tiene alto manual)
      td.innerHTML = `<div class="wr" style="line-height:${lh || lineH(13)}px">${esc(text)}</div>`;
    } else if (typeof v === 'string' && text && (!s.al || s.al === 'left') && textWidth(text, s) > colW) {
      // Texto que no cabe: se desborda sobre las celdas vacías de la derecha (como Excel); sin ajuste, una sola línea.
      // Una celda fantasma no está vacía: corta el desborde
      let w = colW, cc = c + 1;
      while (cc < sheet.cols && !rawOf(sheet.cells[addr(r, cc)]) && !ghostSet.has(r * GK + cc) && w < textWidth(text, s)) w += colX[cc + 1] - colX[cc++];
      td.innerHTML = `<span class="ov" style="width:${w}px">${esc(text)}</span>`;
      td.classList.add('ovc');
    } else td.textContent = text;
    let css = fzCss(r, c) + fontCss(s);
    if (deco) {
      td.innerHTML = deco + (text ? `<span class="cfv">${td.innerHTML}</span>` : '');
      // las capas se ubican respecto del td (los inmovilizados ya tienen position: sticky)
      if (!css.includes('position:sticky')) css += 'position:relative;';
      if (s.icon) css += `padding-left:${cfIconPx(s) + 6}px;`;
    }
    // con fuente grande el interlineado crece, sin superar el alto de la fila (alto manual menor)
    if (lh) css += `line-height:min(${lh}px, var(--lh, 21px));`;
    if (s.va && VA[s.va]) css += `vertical-align:${VA[s.va]};`;
    if (s.al) css += `text-align:${s.al};`;
    if (s.bg) css += `background:${s.bg};`;
    if (s.fg) css += `color:${s.fg};`;
    // Bordes: derecho/inferior usan el borde real de la celda; superior/izquierdo, sombras internas
    if (s.br) css += 'border-right-color:#222;';
    if (s.bb) css += 'border-bottom-color:#222;';
    if (s.bt || s.bl) css += `box-shadow:${[s.bt && 'inset 0 1px 0 #222', s.bl && 'inset 1px 0 0 #222'].filter(Boolean).join(',')};`;
    // borde del formato condicional (contorno de la celda, "Borde rojo"): encima de los bordes propios
    if (s.bd) css += `border-right-color:${s.bd};border-bottom-color:${s.bd};box-shadow:inset 0 1px 0 ${s.bd},inset 1px 0 0 ${s.bd};`;
    td.style.cssText = css;
  }
  // Solo se pintan las filas presentes en el DOM; las fórmulas fuera de vista no se evalúan
  function paintAll() {
    const rows = [];
    for (let r = 0; r < Math.min(FZ().r, vr.r0); r++) rows.push(r);
    for (const r of vr.list || []) rows.push(r);
    // celdas fantasma de las filas dibujadas (los desbordes se calculan con prime después de cada recálculo)
    const gh = new Set(), sl = spillList();
    if (sl.length) for (const r of rows) for (const s of sl) {
      if (r < s.r1 || r > s.r2) continue;
      for (let c = s.c1; c <= Math.min(s.c2, sheet.cols - 1); c++) if (r !== s.anchor.r || c !== s.anchor.c) gh.add(r * GK + c);
    }
    ghostSet = gh;
    // rangos con formato condicional: también se pintan sus celdas vacías (reglas de celdas en blanco, fórmulas…)
    const cfR = cfList(sheet, wb.active).flatMap(d => d.ranges);
    for (const r of rows) for (let c = 0; c < sheet.cols; c++) {
      if (!tds[r]) break;   // fila inmovilizada oculta: no está en el DOM
      if (tds[r][c]._p || sheet.cells[addr(r, c)] || gh.has(r * GK + c) || (sheet.colS && sheet.colS[c]) || (sheet.rowS && sheet.rowS[r])
        || (cfR.length && cfR.some(g => inArea(g, r, c)))) paintCell(r, c);
    }
  }

  // Geometría calculada (filas fuera del DOM); si la fila está dibujada se usa su posición real para no acumular desfase
  // (filas fuera del DOM: rowY con el índice de altos; las ocultas miden 0)
  const rowTop = r => tds[r] ? tds[r][0].parentNode.offsetTop : rowY(r);
  const rect = g => {
    const f = FZ(), st = wrap.scrollTop, sl = wrap.scrollLeft;
    // Las celdas inmovilizadas se ven desplazadas junto con el scroll (sticky)
    const top = g.r1 < f.r ? rowY(g.r1) + st : rowTop(g.r1);
    const bottom = g.r2 < f.r ? rowY(g.r2 + 1) + st
      : tds[g.r2] ? rowTop(g.r2) + tds[g.r2][0].parentNode.offsetHeight : rowY(g.r2 + 1);
    const left = colX[g.c1] + (g.c1 < f.c ? sl : 0), right = colX[g.c2 + 1] + (g.c2 < f.c ? sl : 0);
    return { left, top, width: right - left, height: bottom - top };
  };
  // Con paneles inmovilizados, una capa (selección, desborde, combinación, recuadro) cuyo rango empieza en la zona que
  // se desplaza se recorta en el borde de los paneles: Excel no la dibuja encima de la fila o columna inmovilizada.
  // Devuelve el valor de clip-path ('' si no hace falta); se recalcula en cada desplazamiento
  function fzClip(g, R) {
    const f = FZ();
    if (!f.r && !f.c) return '';
    const t = f.r && g.r1 >= f.r ? Math.max(0, wrap.scrollTop + rowY(f.r) - R.top) : 0;
    const l = f.c && g.c1 >= f.c ? Math.max(0, wrap.scrollLeft + colX[f.c] - R.left) : 0;
    return t || l ? `inset(${t}px 0 0 ${l}px)` : '';
  }
  function place(el, g) {
    const R = rect(g);
    el.style.left = R.left + 'px';
    el.style.top = R.top + 'px';
    el.style.width = R.width + 1 + 'px';
    el.style.height = R.height + 1 + 'px';
    el.style.clipPath = fzClip(g, R);
  }
  function applyHL() {
    const g = range();
    table.querySelectorAll('th.hl').forEach(x => x.classList.remove('hl'));
    for (let c = g.c1; c <= g.c2; c++) colHeads[c].classList.add('hl');
    for (let r = Math.max(g.r1, vr.r0); r <= Math.min(g.r2, vr.r1 - 1); r++) if (rowHeads[r]) rowHeads[r].classList.add('hl');
    for (let r = 0; r < FZ().r; r++) if (r >= g.r1 && r <= g.r2 && rowHeads[r]) rowHeads[r].classList.add('hl');
  }
  function drawSel() {
    const g = range();
    place(selBox, g);
    selBox.style.background = single(g) ? 'transparent' : '';
    // si la celda activa es una combinación, el borde activo la rodea entera (como Excel)
    const am = sheet.merges && mergeAt(A.r, A.c);
    place(actBox, am || { r1: A.r, c1: A.c, r2: A.r, c2: A.c });
    if (am && am.r1 === range().r1 && am.r2 === range().r2 && am.c1 === range().c1 && am.c2 === range().c2) selBox.style.background = 'transparent';
    applyHL();
    drawClip();
    // el cuadro de nombres muestra el nombre si la selección coincide exactamente con un rango con nombre (como Excel)
    if (!edit) { nameBox.value = (!extra.length && selNameOf(g)) || (single(g) ? addr(A.r, A.c) : `${addr(g.r1, g.c1)}:${addr(g.r2, g.c2)}`); refreshBar(); }
    status();
    drawRefHL();
    drawFilterButtons();
    drawExtra();
    drawMerges();
    drawSpill();
    drawDv();
  }
  // ---------- Celdas combinadas ----------
  // Cada combinación se dibuja como una capa sobre la grilla con el valor de la celda superior izquierda
  const mergeLayer = document.createElement('div');
  mergeLayer.id = 'mergeLayer';
  $('#gridInner').appendChild(mergeLayer);
  const mergeAt = (r, c) => (sheet.merges || []).find(m => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
  function drawMerges() {
    let h = '';
    for (const m of sheet.merges || []) {
      if (isHidden(m.r1)) continue;
      const R = rect(m), cell = sheet.cells[addr(m.r1, m.c1)], s = withCf(effStyle(m.r1, m.c1), m.r1, m.c1);
      const v = cell ? eng.value(wb.active, m.r1, m.c1) : null;
      // alineación: horizontal según s.al (centrado por defecto); vertical inferior por defecto, como Excel
      const al = s.al || 'center', JUST = { left: 'flex-start', center: 'center', right: 'flex-end' }, ALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
      let css = `left:${R.left}px;top:${R.top}px;width:${R.width}px;height:${R.height}px;text-align:${al};justify-content:${JUST[al] || 'center'};align-items:${ALIGN[s.va] || 'flex-end'};`;
      const cp = fzClip(m, R);
      if (cp) css += `clip-path:${cp};`;
      css += fontCss(s);
      if (s.fs) css += `line-height:${lineH(ptPx(s.fs))}px;`;
      if (s.wrap) css += 'white-space:pre-wrap;overflow-wrap:anywhere;';
      if (s.bg) css += `background:${s.bg};`;
      if (s.fg) css += `color:${s.fg};`;
      if (v instanceof FErr && !s.fg) css += 'color:#c00000;';
      if (s.bd) css += `box-shadow:inset 0 0 0 1px ${s.bd};`;
      // barra de datos o ícono: dentro de la combinación entera (la capa ya tiene posición)
      const deco = s.bar || s.icon ? cfDeco(s) : '', txt = esc(display(v, { v: cell ? cell.v : '', s }));
      if (s.icon) css += `padding-left:${cfIconPx(s) + 6}px;`;
      h += `<div style="${css}">${deco ? deco + (cfHideValue(s) ? '' : `<span class="cfv">${txt}</span>`) : txt}</div>`;
    }
    mergeLayer.innerHTML = h;
  }
  function toggleMerge() {
    if (edit && !commitEdit()) return;
    const g = range();
    const hit = (sheet.merges || []).filter(m => !(m.r2 < g.r1 || m.r1 > g.r2 || m.c2 < g.c1 || m.c1 > g.c2));
    if (hit.length) {
      return snapshotOp(() => { sheet.merges = sheet.merges.filter(m => !hit.includes(m)); if (!sheet.merges.length) delete sheet.merges; });
    }
    if (single(g)) return toast('Selecciona varias celdas para combinarlas');
    let others = 0;
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if ((r !== g.r1 || c !== g.c1) && rawOf(getCell(r, c))) others++;
    if (others && !confirm('Combinar celdas solo conserva el valor de la celda superior izquierda y descarta los demás. ¿Continuar?')) return;
    snapshotOp(() => {
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (r !== g.r1 || c !== g.c1) delete sheet.cells[addr(r, c)];
      (sheet.merges = sheet.merges || []).push({ ...g });
      const k = addr(g.r1, g.c1), cell = sheet.cells[k] || { v: '' };
      cell.s = { ...(cell.s || {}), al: 'center' };
      sheet.cells[k] = cell;
    });
  }

  // ---------- Recuadro del desborde e indicador de #¡DESBORDAMIENTO! ----------
  // Como Excel: con la celda activa dentro de un desborde, un borde azul fino rodea todo el rango; si el ancla da
  // #¡DESBORDAMIENTO!, el borde es discontinuo sobre el rango previsto y aparece el indicador de error con el motivo
  // y "Seleccionar celdas que obstruyen". Capa absoluta: se redibuja junto con selBox (drawSel y desplazamiento, L-013)
  const spillBox = document.createElement('div');
  spillBox.id = 'spillBox';
  $('#gridInner').appendChild(spillBox);
  const spillTag = document.createElement('button');
  spillTag.id = 'spillTag';
  spillTag.type = 'button';
  spillTag.tabIndex = -1;
  spillTag.textContent = '!';
  spillTag.title = 'Error de desbordamiento (Alt+Mayús+F10)';
  $('#gridInner').appendChild(spillTag);
  function drawSpill() {
    const sp = eng.spillAt(wb.active, A.r, A.c);
    const er = sp ? null : eng.spillError(wb.active, A.r, A.c);
    const g = sp || er;
    if (!g || g.r1 >= sheet.rows || g.c1 >= sheet.cols) { spillBox.style.display = 'none'; spillTag.style.display = 'none'; return; }
    place(spillBox, { r1: g.r1, c1: g.c1, r2: Math.min(g.r2, sheet.rows - 1), c2: Math.min(g.c2, sheet.cols - 1) });
    spillBox.className = er ? 'err' : '';
    spillBox.style.display = 'block';
    if (!er) { spillTag.style.display = 'none'; return; }
    // indicador a la izquierda de la celda (a la derecha si no hay espacio antes de los encabezados de fila)
    const R = rect({ r1: A.r, c1: A.c, r2: A.r, c2: A.c });
    spillTag.style.left = (R.left - 19 >= colX[0] ? R.left - 19 : R.left + R.width + 3) + 'px';
    spillTag.style.top = R.top + 3 + 'px';
    spillTag.style.display = 'block';
  }
  // Seleccionar celdas que obstruyen: selección múltiple con las celdas bloqueantes (contiguas por fila en un rango);
  // la celda activa pasa a la primera
  function selectBlockers(er) {
    const bl = er.blockers;
    if (!bl.length) return;
    const rs = [];
    for (const p of bl) { const l = rs[rs.length - 1]; if (l && l.r1 === p.r && l.c2 === p.c - 1) l.c2 = p.c; else rs.push({ r1: p.r, c1: p.c, r2: p.r, c2: p.c }); }
    const first = rs.shift();
    extra = rs;
    setSel({ r: first.r1, c: first.c1 }, { r: first.r2, c: first.c2 }, true, true);
  }
  function spillMenu() {
    const er = eng.spillError(wb.active, A.r, A.c);
    if (!er) return;
    const b = spillTag.getBoundingClientRect();
    showMenu({ clientX: b.left, clientY: b.bottom + 2 }, [
      ['Error de desbordamiento', null, { head: true }],
      [er.message, null, { disabled: true }],
      null,
      ['Seleccionar celdas que obstruyen', () => selectBlockers(er), { disabled: !er.blockers.length }],
      ['Modificar en la barra de fórmulas', () => { fb.focus(); fb.setSelectionRange(fb.value.length, fb.value.length); }],
    ]);
  }
  spillTag.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    if (edit && !commitEdit()) return;
    if (menu.style.display === 'block') hideMenu(); else spillMenu();
  });

  const extraBox = document.createElement('div');
  extraBox.id = 'extraSel';
  $('#gridInner').appendChild(extraBox);
  function drawExtra() {
    extraBox.innerHTML = extra.map(g => { const R = rect(g), cp = fzClip(g, R); return `<div style="left:${R.left}px;top:${R.top}px;width:${R.width + 1}px;height:${R.height + 1}px${cp ? ';clip-path:' + cp : ''}"></div>`; }).join('');
  }
  function drawClip() {
    const b = clip && (clip.box || { r1: clip.r1, c1: clip.c1, r2: clip.r1 + clip.h - 1, c2: clip.c1 + clip.w - 1 });
    if (clip && clip.si === wb.active && b.r2 < sheet.rows && b.c2 < sheet.cols) {
      place(clipBox, b);
      clipBox.style.display = 'block';
    } else clipBox.style.display = 'none';
  }
  function ensureVisible(r, c) {
    const R = rect({ r1: r, c1: c, r2: r, c2: c }), f = FZ();
    // el área visible empieza después de los encabezados y de los paneles inmovilizados
    const padL = f.c ? colX[f.c] : HEAD_W, padT = rowY(f.r);
    if (c >= f.c) {
      if (R.left - padL < wrap.scrollLeft) wrap.scrollLeft = R.left - padL;
      else if (R.left + R.width > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = R.left + R.width - wrap.clientWidth;
    }
    if (r >= f.r) {
      if (R.top - padT < wrap.scrollTop) wrap.scrollTop = R.top - padT;
      else if (R.top + R.height > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = R.top + R.height - wrap.clientHeight;
    }
    renderRows(false);
  }

  function setFreeze(r, c) {
    if (edit && !commitEdit()) return;
    sheet.freeze = r || c ? { r, c } : undefined;
    wrap.scrollTo(0, 0);
    buildGrid();
    drawSel();
    scheduleSave();
  }
  function freezeMenu() {
    const b = $('[data-cmd="freeze"]').getBoundingClientRect();
    showMenu({ clientX: b.left, clientY: b.bottom }, [
      ['Inmovilizar paneles (sobre y a la izquierda de la celda activa)', () => setFreeze(A.r, A.c)],
      ['Inmovilizar fila superior', () => setFreeze(1, 0)],
      ['Inmovilizar primera columna', () => setFreeze(0, 1)],
      null, ['Movilizar paneles', () => setFreeze(0, 0)],
    ]);
  }

  function refreshBar() {
    const cell = getCell(A.r, A.c), s = effStyle(A.r, A.c);
    if (!edit) {
      // celda fantasma: la barra muestra en gris la fórmula del ancla (la celda no tiene contenido propio)
      let raw = rawOf(cell), gh = null;
      if (!raw && (gh = ghostOf(A.r, A.c))) raw = rawOf(getCell(gh.anchor.r, gh.anchor.c));
      fb.value = raw;
      fbMirror.classList.toggle('ghost', !!gh);
      paintMirror(fb, fbMirror);
    }
    $('#btnB').classList.toggle('on', !!s.b);
    $('#btnI').classList.toggle('on', !!s.i);
    $('#btnU').classList.toggle('on', !!s.u);
    $('#alL').classList.toggle('on', s.al === 'left');
    $('#alC').classList.toggle('on', s.al === 'center');
    $('#alR').classList.toggle('on', s.al === 'right');
    $('#btnWrap').classList.toggle('on', !!s.wrap);
    $('#vaT').classList.toggle('on', s.va === 'top');
    $('#vaM').classList.toggle('on', s.va === 'middle');
    $('#vaB').classList.toggle('on', s.va === 'bottom');
    $('#fmtSel').value = s.fmt || 'general';
    fontSel.value = s.ff || '';
    if (s.ff && fontSel.value !== s.ff) { fontSel.add(new Option(s.ff, s.ff)); fontSel.value = s.ff; }
    if (document.activeElement !== sizeSel) sizeSel.value = fmtPtNum(s.fs || DEF_PT);
  }

  function status() {
    const gs = allRanges(), st = $('#status');
    if (gs.length === 1 && single(gs[0])) { st.innerHTML = ''; return; }
    // Como Excel, la barra de estado solo cuenta las celdas visibles: salta las filas filtradas y las ocultas a mano
    // y las columnas ocultas (L-042); los valores desbordados (celdas fantasma) sí cuentan
    let n = 0, cnt = 0, sum = 0;
    const add = (r, c) => {
      if (isHidden(r) || isHiddenCol(c)) return;
      const v = eng.value(wb.active, r, c);
      if (v === null || v === '') return;
      cnt++;
      if (typeof v === 'number') { n++; sum += v; }
    };
    const inSel = (r, c) => gs.some(g => inArea(g, r, c));
    for (const [k, cell] of Object.entries(sheet.cells)) {
      if (cell.v === '') continue;   // solo formato (si es fantasma, se cuenta abajo)
      const p = parseAddr(k);
      if (inSel(p.r, p.c)) add(p.r, p.c);
    }
    if (spillList().length) {
      const box = gs.reduce((b, g) => ({ r1: Math.min(b.r1, g.r1), c1: Math.min(b.c1, g.c1), r2: Math.max(b.r2, g.r2), c2: Math.max(b.c2, g.c2) }));
      for (const { r, c } of ghostsIn(box)) if (inSel(r, c)) add(r, c);
    }
    // Promedio y Suma con el formato de número de la celda activa (moneda, porcentaje, fecha, hora…) o, en General,
    // con el ancho de una celda estándar: 2,666666667 y no 2,66666666666667 (como Excel)
    const ac = sheet.cells[addr(A.r, A.c)], af = ac ? autoFmt(ac) : 'general';
    const sf = v => af !== 'general' && af !== 'text' ? display(v, ac) : generalFit(v);
    const parts = [];
    if (n) parts.push(`Promedio: ${sf(sum / n)}`);
    if (cnt) parts.push(`Recuento: ${cnt}`);
    if (n) parts.push(`Suma: ${sf(sum)}`);
    st.innerHTML = parts.map(p => `<span>${p}</span>`).join('');
  }

  function renderTabs() {
    const tabs = $('#tabs');
    tabs.innerHTML = '';
    wb.sheets.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'tab' + (i === wb.active ? ' on' : '');
      b.textContent = s.name;
      b.onmousedown = e => { if (edit) e.preventDefault(); };
      b.onclick = () => { switchSheet(i); if (!edit) wrap.focus({ preventScroll: true }); };
      b.ondblclick = () => renameSheet(i);
      b.oncontextmenu = e => { e.preventDefault(); switchSheet(i); showMenu(e, [['Cambiar nombre', () => renameSheet(i)], ['Duplicar hoja', () => duplicateSheet(i)], ['Eliminar hoja', () => deleteSheet(i)]]); };
      tabs.appendChild(b);
    });
    const add = document.createElement('button');
    add.className = 'tab add'; add.textContent = '+'; add.title = 'Nueva hoja';
    add.onclick = () => { addSheet(); wrap.focus({ preventScroll: true }); };
    tabs.appendChild(add);
  }

  function updTitle() { $('#docName').textContent = wb.name; document.title = wb.name + ' — Bassxcel'; }

  function rebuild() {
    sheet = wb.sheets[wb.active];
    clampSel();
    buildGrid();
    renderTabs();
    updTitle();
  }
  function clampSel() {
    const s = wb.sheets[wb.active];
    const cl = p => ({ r: Math.min(Math.max(0, p.r), s.rows - 1), c: Math.min(Math.max(0, p.c), s.cols - 1) });
    A = cl(A); F = cl(F);
    if (P) P = cl(P);
  }

  // Tras cualquier cambio de datos: recalcular, repintar y autoguardar
  function changed(markDirty = true) {
    recalcAll();
    // el contenido o el formato pueden cambiar los altos automáticos (ajuste de texto, tamaño de fuente)
    if (syncHeights()) renderRows(true); else paintAll();
    drawSel();
    if (markDirty) scheduleSave();
  }
  // dirty: hay cambios que no están guardados en un archivo (el autoguardado guarda un solo libro y no cuenta: L-041).
  // saveFailed: el último autoguardado falló (cuota de localStorage llena, modo privado…)
  let dirty = false, saveFailed = false;
  function scheduleSave(markDirty = true) {
    if (markDirty) dirty = true;
    $('#saveState').textContent = (dirty ? 'Cambios sin guardar en archivo · ' : '') + 'autoguardando…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 400);
  }
  const hasContent = () => wb.sheets.some(s => Object.keys(s.cells).length) || !!(wb.names && wb.names.length);
  // Antes de reemplazar el libro actual (Nuevo, Abrir, archivo recibido por Electron o por la PWA): si tiene cambios
  // sin guardar en un archivo, se pregunta, igual que "Nuevo" (L-041). Primero se confirma la edición en curso
  // (si la fórmula no es válida, no se reemplaza nada).
  function confirmDiscard(question) {
    if (edit && !commitEdit()) return false;
    if (!dirty || !hasContent()) return true;
    return confirm(`${question}\n\nLos cambios de "${wb.name}" que no guardaste en un archivo se perderán (el autoguardado solo conserva un libro). Para conservarlos, elige Cancelar y usa Guardar (Ctrl+G).`);
  }
  // Otra pestaña con Bassxcel abierta autoguardó encima: se avisa una vez (Excel tampoco permite dos ediciones del mismo libro)
  let otherTabWarned = false;
  window.addEventListener('storage', e => {
    if (e.key !== STORE || otherTabWarned) return;
    otherTabWarned = true;
    alert('Bassxcel está abierto en otra pestaña y su autoguardado reemplazó al de esta.\nUsa una sola pestaña, o guarda este libro con Guardar (Ctrl+S) para no perder cambios.');
  });
  function autosave() {
    clearTimeout(saveTimer);
    try {
      wb.sheets[wb.active].sel = selState();
      // dirty viaja con el autoguardado: al restaurar, "Nuevo" y "Abrir" siguen sabiendo si el libro está solo aquí
      localStorage.setItem(STORE, JSON.stringify({ ...serialize(), dirty }));
      saveFailed = false;
      $('#saveState').textContent = 'Autoguardado ' + new Date().toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { saveFailed = true; $('#saveState').textContent = 'No se pudo autoguardar (usa Guardar)'; }
  }

  // ---------- Cambios con deshacer ----------
  function ensureSize(r, c) {
    if (r < sheet.rows && c < sheet.cols) return false;
    sheet.rows = Math.max(sheet.rows, r + 51);
    sheet.cols = Math.max(sheet.cols, c + 6);
    buildGrid();
    return true;
  }
  function pushUndo(rec) { undoStack.push(rec); if (undoStack.length > 300) undoStack.shift(); redoStack = []; }
  // o: { dv } = reglas de validación nuevas de la hoja (pegar, rellenar, Borrar todo): van en el mismo paso de deshacer
  function applyChanges(items, o = {}) {
    const rec = { si: wb.active, items: [] };
    for (const { r, c, cell } of items) {
      const k = addr(r, c), before = sheet.cells[k], after = normCell(cell);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      rec.items.push({ k, before: clone(before), after: clone(after) });
      setKey(sheet, k, after);
    }
    if (o.dv !== undefined && !deepEq(sheet.dv || [], o.dv || [])) {
      rec.dv = { before: clone(sheet.dv || []), after: clone(o.dv || []) };
      setDv(sheet, o.dv);
    }
    // { cf }: reglas de formato condicional nuevas de la hoja (crear, borrar reglas, pegar, rellenar, Borrar formato…)
    if (o.cf !== undefined && !deepEq(sheet.cf || [], o.cf || [])) {
      rec.cf = { before: clone(sheet.cf || []), after: clone(o.cf || []) };
      setCf(sheet, o.cf);
    }
    if (rec.items.length || rec.dv || rec.cf) { pushUndo(rec); changed(); }
    return rec.items.length > 0 || !!rec.dv || !!rec.cf;
  }
  // Operación estructural con deshacer: la instantánea incluye los nombres definidos (insertar/eliminar, hojas,
  // definir, editar o eliminar nombres). Si fn devuelve { error } no cambió nada: no se apila deshacer
  const snapState = () => JSON.stringify({ sheets: wb.sheets, active: wb.active, names: wb.names || [] });
  function snapshotOp(fn) {
    const before = snapState();
    const res = fn();
    if (res && res.error) return res;
    pushUndo({ snap: true, before, after: snapState() });
    rebuild();
    changed();
    return res;
  }
  function restore(rec, which) {
    if (rec.colw) {
      if (rec.si !== wb.active) { wb.active = rec.si; rebuild(); }
      if (rec[which] == null) delete sheet.colW[rec.c]; else sheet.colW[rec.c] = rec[which];
      buildGrid();
    } else if (rec.rowh) {
      // altos de fila: { fila: px } (undefined = alto automático)
      if (rec.si !== wb.active) { wb.active = rec.si; rebuild(); }
      putRowH(rec[which]);
      buildGrid();
    } else if (rec.snap) {
      const o = JSON.parse(rec[which]);
      wb.sheets = o.sheets; wb.active = o.active; wb.names = o.names || [];
      rebuild();
    } else {
      if (rec.si !== wb.active) { wb.active = rec.si; rebuild(); }
      for (const it of rec.items) setKey(sheet, it.k, clone(it[which]));
      if (rec.dv) setDv(sheet, clone(rec.dv[which]));   // reglas de validación del mismo paso
      if (rec.cf) setCf(sheet, clone(rec.cf[which]));   // y de formato condicional
    }
    changed();
  }
  function undo() { const rec = undoStack.pop(); if (!rec) return toast('Nada que deshacer'); restore(rec, 'before'); redoStack.push(rec); }
  function redo() { const rec = redoStack.pop(); if (!rec) return toast('Nada que rehacer'); restore(rec, 'after'); undoStack.push(rec); }

  function setRaw(r, c, val) { applyChanges([{ r, c, cell: entryCell(clone(getCell(r, c)) || {}, val, effStyle(r, c)) }]); }

  // ---------- Alto de fila: arrastre, autoajuste y diálogo ----------
  function putRowH(m) {
    sheet.rowH = sheet.rowH || {};
    for (const [r, h] of Object.entries(m)) { if (h == null) delete sheet.rowH[r]; else sheet.rowH[r] = h; }
    if (!Object.keys(sheet.rowH).length) delete sheet.rowH;
  }
  // Filas afectadas al cambiar el alto de la fila r: si r está dentro de filas completas seleccionadas,
  // todas ellas (como Excel); si no, solo r
  function heightTargets(r) {
    const full = allRanges().filter(g => g.c1 === 0 && g.c2 === sheet.cols - 1);
    if (r != null && !full.some(g => r >= g.r1 && r <= g.r2)) return [r];
    const out = new Set();
    for (const g of full) for (let i = g.r1; i <= g.r2 && out.size <= 20000; i++) if (!isHidden(i)) out.add(i);
    if (out.size > 20000) { toast('Selección demasiado grande: se cambia solo una fila'); return [r ?? A.r]; }
    return [...out];
  }
  // h en px; null = alto automático (autoajustar); 0 = ocultar las filas, como Excel
  function setRowHeights(rows, h) {
    if (!rows.length) return;
    if (h === 0) return hideRowList(rows);
    const before = {}, after = {};
    let diff = false;
    for (const r of rows) {
      before[r] = sheet.rowH ? sheet.rowH[r] : undefined;
      after[r] = h == null ? undefined : h;
      if (before[r] !== after[r]) diff = true;
    }
    if (!diff) return;
    pushUndo({ rowh: true, si: wb.active, before, after });
    putRowH(after);
    buildGrid();
    drawSel();
    scheduleSave();
  }
  function hideRowList(rows) {
    if (rows.length >= visCount()) return toast('No se pueden ocultar todas las filas');
    snapshotOp(() => {
      const set = new Set(sheet.hiddenR || []);
      for (const r of rows) set.add(r);
      sheet.hiddenR = [...set].sort((a, b) => a - b);
    });
    if (isHidden(A.r)) { let r = A.r; while (r < sheet.rows - 1 && isHidden(r)) r++; while (r > 0 && isHidden(r)) r--; setSel({ r, c: A.c }); }
  }
  const fmtPtNum = pt => (+pt).toLocaleString(LOCALE, { maximumFractionDigits: 2, useGrouping: false });
  // px ↔ puntos (Excel muestra el alto de fila en puntos: 1 pt = 4/3 px)
  const pxToPt = px => fmtPtNum(Math.round(px * 0.75 * 100) / 100);
  function rowHeightDialog() {
    if (edit && !commitEdit()) return;
    const full = allRanges().some(g => g.c1 === 0 && g.c2 === sheet.cols - 1);
    let rows = full ? heightTargets(null) : [];
    if (!full) { const s = new Set(); for (const g of allRanges()) for (let r = g.r1; r <= g.r2 && s.size <= 20000; r++) if (!isHidden(r)) s.add(r); rows = [...s]; }
    if (rows.length > 20000) return toast('Selecciona menos filas');
    const ans = prompt('Alto de fila (puntos):', pxToPt(rowH(A.r)));
    if (ans == null || !ans.trim()) return;
    const pt = Number(ans.trim().replace(/\s/g, '').replace(',', '.'));
    if (!isFinite(pt) || pt < 0 || pt > 409) return toast('El alto de fila debe estar entre 0 y 409 puntos');
    setRowHeights(rows, Math.round(pt * 4 / 3));
  }
  function autoFitRows(r) { if (edit && !commitEdit()) return; setRowHeights(heightTargets(r), null); }
  // Aviso flotante con el tamaño mientras se arrastra un borde de encabezado (como Excel)
  const sizeTip = document.createElement('div');
  sizeTip.id = 'sizeTip';
  document.body.appendChild(sizeTip);
  function showSizeTip(e, text) { sizeTip.textContent = text; sizeTip.style.left = e.clientX + 14 + 'px'; sizeTip.style.top = e.clientY - 28 + 'px'; sizeTip.style.display = 'block'; }
  const hideSizeTip = () => { sizeTip.style.display = 'none'; };
  function clearContents() {
    const gs = allRanges(), items = [], fh = filterHidden();
    for (const k of Object.keys(sheet.cells)) {
      const p = parseAddr(k);
      if (fh && fh.has(p.r)) continue;   // con filtro activo, solo las filas visibles (P0 2)
      if (gs.some(g => p.r >= g.r1 && p.r <= g.r2 && p.c >= g.c1 && p.c <= g.c2)) { const cell = clone(sheet.cells[k]); cell.v = ''; items.push({ r: p.r, c: p.c, cell }); }
    }
    applyChanges(items);
  }
  // Partes visibles de los rangos gs con el filtro activo (fh: filas que oculta), en tramos de filas contiguas
  const visParts = (gs, fh) => fh ? gs.flatMap(g => { const out = []; for (let r = g.r1; r <= g.r2; r++) if (!fh.has(r)) { const l = out[out.length - 1]; if (l && l.r2 === r - 1) l.r2 = r; else out.push({ ...g, r1: r, r2: r }); } return out; }) : gs;
  // Inicio ▸ Borrar ▸ Borrar todo: contenido, formato, formato condicional y validación de datos de la selección, en un
  // paso de deshacer (Supr solo borra el contenido y "Borrar formato" no toca la validación, como Excel). Con filtro,
  // solo lo visible
  function clearAll() {
    if (edit && !commitEdit()) return;
    const gs = allRanges(), items = [], fh = filterHidden();
    for (const k of Object.keys(sheet.cells)) {
      const p = parseAddr(k);
      if (fh && fh.has(p.r)) continue;
      if (gs.some(g => inArea(g, p.r, p.c))) items.push({ r: p.r, c: p.c, cell: undefined });
    }
    const vis = visParts(gs, fh);
    applyChanges(items, { dv: dvRemove(sheet.dv || [], vis), cf: dvRemove(sheet.cf || [], vis) });
  }
  // Inicio ▸ Borrar ▸ Borrar formatos: el formato de las celdas y su formato condicional (no la validación), en un paso
  function clearFormats() {
    if (edit && !commitEdit()) return;
    const vis = visParts(allRanges(), filterHidden());
    styleSel(s => { for (const k in s) delete s[k]; }, { cf: dvRemove(sheet.cf || [], vis) });
  }
  // Estilo efectivo de una celda: columna < fila < celda (como Excel)
  function effStyle(r, c) {
    const cell = sheet.cells[addr(r, c)], cs = sheet.colS && sheet.colS[c], rs = sheet.rowS && sheet.rowS[r];
    return cs || rs ? { ...cs, ...rs, ...(cell && cell.s) } : (cell && cell.s) || {};
  }
  // o: opciones de applyChanges que van en el mismo paso de deshacer ({ cf } al borrar formatos)
  function styleSel(fn, o = {}) {
    if (edit && !commitEdit()) return;
    const g = range(), items = [], fh = filterHidden();   // con filtro activo se saltan las filas filtradas (P0 2)
    let fullCols = g.r1 === 0 && g.r2 === sheet.rows - 1;
    const fullRows = g.c1 === 0 && g.c2 === sheet.cols - 1;
    if (extra.length) {
      // Selección múltiple (Ctrl+clic): se aplica celda a celda en cada rango
      for (const gg of allRanges()) for (let r = gg.r1; r <= gg.r2; r++) for (let c = gg.c1; c <= gg.c2; c++) {
        if (fh && fh.has(r)) continue;
        const cell = clone(getCell(r, c)) || { v: '' };
        cell.s = { ...(cell.s || {}) };
        fn(cell.s);
        items.push({ r, c, cell });
      }
      return applyChanges(items, o);
    }
    let rowsTo = g.r2;
    if (fullCols && fh && !fullRows) {
      // columnas completas con filtro: el formato de columna alcanzaría a las filas ocultas; se aplica celda a
      // celda en las filas visibles hasta el final de los datos o de la tabla filtrada
      fullCols = false;
      rowsTo = Math.max(sheet.filter.r2, eng.extent(wb.active).r);
    }
    if (fullCols || fullRows) {
      // Columnas o filas completas: el formato se guarda una vez por columna/fila, no en cada celda
      return snapshotOp(() => {
        const key = fullCols ? 'colS' : 'rowS', lo = fullCols ? g.c1 : g.r1, hi = fullCols ? g.c2 : g.r2;
        sheet[key] = sheet[key] || {};
        for (let i = lo; i <= hi; i++) {
          if (!fullCols && fh && fh.has(i)) continue;
          const s = { ...sheet[key][i] };
          fn(s);
          for (const k of Object.keys(s)) if (!s[k] && !(k === 'dec' && s[k] === 0)) delete s[k];
          if (Object.keys(s).length) sheet[key][i] = s; else delete sheet[key][i];
        }
        for (const [k, cell] of Object.entries(sheet.cells)) {
          const p = parseAddr(k);
          if (p.r < g.r1 || p.r > g.r2 || p.c < g.c1 || p.c > g.c2 || !cell.s || (fh && fh.has(p.r))) continue;
          const s = { ...cell.s };
          fn(s);
          const n = normCell({ v: cell.v, s });
          if (n) sheet.cells[k] = n; else delete sheet.cells[k];
        }
        if (o.cf !== undefined) setCf(sheet, o.cf);
      });
    }
    for (let r = g.r1; r <= rowsTo; r++) for (let c = g.c1; c <= g.c2; c++) {
      if (fh && fh.has(r)) continue;
      const cell = clone(getCell(r, c)) || { v: '' };
      cell.s = { ...(cell.s || {}) };
      fn(cell.s);
      items.push({ r, c, cell });
    }
    applyChanges(items, o);
  }
  function toggleStyle(key) { const cur = !!effStyle(A.r, A.c)[key]; styleSel(s => { s[key] = !cur; }); }

  // ---------- Selección y movimiento ----------
  // Tab avanza a la derecha recordando la columna inicial; Enter después de una serie de Tab
  // vuelve a esa columna en la fila siguiente (como Excel al ingresar datos por filas)
  let tabStart = null;
  function tabOrEnter(isTab, back) {
    const g = range();
    if (!single(g) && !extra.length) {
      // Con un rango seleccionado, Enter/Tab recorren la selección sin perderla (como Excel)
      let { r, c } = A;
      if (isTab) {
        c += back ? -1 : 1;
        if (c > g.c2) { c = g.c1; r = r + 1 > g.r2 ? g.r1 : r + 1; } else if (c < g.c1) { c = g.c2; r = r - 1 < g.r1 ? g.r2 : r - 1; }
      } else {
        r += back ? -1 : 1;
        if (r > g.r2) { r = g.r1; c = c + 1 > g.c2 ? g.c1 : c + 1; } else if (r < g.r1) { r = g.r2; c = c - 1 < g.c1 ? g.c2 : c - 1; }
      }
      // solo se mueve la celda activa: el ancla y el extremo conservan el rango
      P = { ...anchor() };
      A = { r, c };
      drawSel();
      ensureVisible(r, c);
      return;
    }
    const start = tabStart;
    if (isTab) { const keep = start ?? A.c; move(0, back ? -1 : 1); tabStart = back ? null : keep; }
    else if (start != null && !back) { if (ensureSize(A.r + 1, start)) paintAll(); setSel({ r: A.r + 1, c: start }); }
    else move(back ? -1 : 1, 0);
  }
  // a: ancla, f: extremo; act: celda activa si no es el ancla (Shift+Espacio, encabezados, Shift+flechas
  // sobre filas completas). keepExtra: conserva los rangos adicionales de Ctrl+clic (si no, se descartan)
  function setSel(a, f = a, scroll = true, keepExtra = false, act = null) {
    if (!keepExtra) extra = [];
    tabStart = null;
    A = act ? { ...act } : { ...a }; P = act ? { ...a } : null; F = { ...f };
    drawSel();
    if (scroll) ensureVisible(F.r, F.c);
  }
  const selState = () => P ? { A, F, P } : { A, F };
  function loadSel(s) { A = s.sel ? s.sel.A : { r: 0, c: 0 }; F = s.sel ? s.sel.F : A; P = s.sel && s.sel.P || null; }
  const isFullRows = g => g.c1 === 0 && g.c2 === sheet.cols - 1, isFullCols = g => g.r1 === 0 && g.r2 === sheet.rows - 1;
  function move(dr, dc, extend = false) {
    const Q = extend ? F : A, g = range();
    let r = Math.max(0, Q.r + dr), c = Math.max(0, Q.c + dc);
    // las filas y columnas ocultas se saltan
    if (dr) while (isHidden(r) && r > 0 && r < sheet.rows - 1) r += Math.sign(dr);
    if (dc) while (isHiddenCol(c) && c > 0 && c < sheet.cols - 1) c += Math.sign(dc);
    // Shift+flechas sobre filas (o columnas) completas: el eje completo no cambia (no agranda la hoja)
    if (extend && dc && isFullRows(g)) c = Q.c;
    if (extend && dr && isFullCols(g)) r = Q.r;
    if (ensureSize(r, c)) { paintAll(); }
    // al extender, la celda activa y los demás rangos de la selección múltiple se conservan (como Excel)
    if (extend) setSel(anchor(), { r, c }, true, true, A); else setSel({ r, c });
  }
  function jump(dr, dc, extend) {
    const Q = extend ? F : A;
    let r = Q.r, c = Q.c;
    const has = hasData;   // las celdas fantasma (valores desbordados) cuentan como datos
    const inb = (r, c) => r >= 0 && c >= 0 && r < sheet.rows && c < sheet.cols;
    if (!inb(r + dr, c + dc)) return;
    if (has(r, c) && has(r + dr, c + dc)) { while (inb(r + dr, c + dc) && has(r + dr, c + dc)) { r += dr; c += dc; } }
    else { r += dr; c += dc; while (inb(r + dr, c + dc) && !has(r, c)) { r += dr; c += dc; } }
    const g = range();
    if (extend && dc && isFullRows(g)) c = Q.c;
    if (extend && dr && isFullCols(g)) r = Q.r;
    if (extend) setSel(anchor(), { r, c }, true, true, A); else setSel({ r, c });
  }
  // Seleccionar todo: la celda activa no cambia (como Excel)
  const selectAll = () => setSel({ r: 0, c: 0 }, { r: sheet.rows - 1, c: sheet.cols - 1 }, false, false, A);
  // Shift+Espacio (filas) y Ctrl+Espacio (columnas): cada rango de la selección se extiende a filas o
  // columnas completas y la celda activa se queda donde estaba (como Excel)
  function selectEntire(rows) {
    const full = g => rows ? { ...g, c1: 0, c2: sheet.cols - 1 } : { ...g, r1: 0, r2: sheet.rows - 1 };
    const a = anchor();
    extra = extra.map(full);
    if (rows) setSel({ r: a.r, c: 0 }, { r: F.r, c: sheet.cols - 1 }, false, true, A);
    else setSel({ r: 0, c: a.c }, { r: sheet.rows - 1, c: F.c }, false, true, A);
  }

  // ---------- Ir a / cuadro de nombres ----------
  // Texto → rango { si, r1, c1, r2, c2, full } si es una referencia (B5, A1:C3, A:B, 2:4, Hoja2!A1, 'Mi hoja'!A1:B2),
  // null si no lo es, o { error } si nombra una hoja inexistente
  function parseRefText(t) {
    const rs = Bx.findRefs(t);
    if (rs.length !== 1 || rs[0].start !== 0 || rs[0].end !== t.length || rs[0].spill) return null;
    const x = rs[0], si = x.sheet == null ? wb.active : eng.sheetIndex(x.sheet);
    if (si < 0) return { error: 'Referencia no válida.' };
    const b = x.b || x.a, full = x.a.kind || false;
    return { si, r1: Math.min(x.a.r, b.r), c1: Math.min(x.a.c, b.c), r2: Math.max(x.a.r, b.r), c2: Math.max(x.a.c, b.c), full };
  }
  // Selecciona un rango (cambiando de hoja si hace falta) con la celda activa arriba a la izquierda, como Excel
  function goToRange(g) {
    if (g.si !== wb.active) switchSheet(g.si);
    if (g.si !== wb.active) return;
    const S = wb.sheets[g.si];
    let { r1, c1, r2, c2 } = g;
    // columnas o filas completas: toda la altura o el ancho de la hoja
    if (g.full === 'col') { r1 = 0; r2 = S.rows - 1; }
    if (g.full === 'row') { c1 = 0; c2 = S.cols - 1; }
    // Límites de Excel: 1.048.576 filas; las columnas se limitan a ZZ (702) porque no están virtualizadas
    if (r2 >= 1048576 || c2 >= 702) { toast('Fuera del rango admitido (máx. columna ZZ, fila 1.048.576)'); return; }
    if (ensureSize(r2, c2)) paintAll();
    setSel({ r: r1, c: c1 }, { r: Math.min(r2, sheet.rows - 1), c: Math.min(c2, sheet.cols - 1) }, false);
    ensureVisible(r1, c1);
    wrap.focus({ preventScroll: true });
  }
  // Nombre visible desde la hoja si (ámbito de la hoja antes que de libro), o null. Acepta "Hoja2!Nombre"
  function lookupName(text, si = wb.active) {
    const m = /^(?:('(?:[^']|'')+'|[^'!]+)!)?([^!]+)$/.exec(text);
    if (!m) return null;
    let s = si;
    if (m[1]) { s = eng.sheetIndex(m[1][0] === "'" ? m[1].slice(1, -1).replace(/''/g, "'") : m[1]); if (s < 0) return null; }
    const d = eng.nameDef(m[2], s);
    return d ? { def: d, si: s } : null;
  }
  // Ir a (Ctrl+I / F5) y cuadro de nombres (Enter): una referencia va ahí; un nombre existente selecciona su rango;
  // en el cuadro de nombres (define = true), un nombre nuevo válido se asigna a la selección (de libro, o de hoja con
  // "Hoja1!Nombre"), como Excel
  function goToText(text, define = false) {
    const t = String(text || '').trim();
    if (!t) { drawSel(); wrap.focus({ preventScroll: true }); return; }
    const g = parseRefText(t);
    if (g && g.error) return msgBox(g.error).then(drawSel);
    if (g) return goToRange(g);
    const found = lookupName(t);
    if (found) {
      const nr = eng.nameRange(found.def.name, found.si);
      if (!nr) return msgBox('Referencia no válida.').then(drawSel);   // el nombre es una constante o una fórmula
      return goToRange(nr);
    }
    if (!define) return msgBox('Referencia no válida.').then(drawSel);
    const m = /^(?:('(?:[^']|'')+'|[^'!]+)!)?([^!]+)$/.exec(t) || [];
    let scope = null;
    if (m[1]) {
      const si = eng.sheetIndex(m[1][0] === "'" ? m[1].slice(1, -1).replace(/''/g, "'") : m[1]);
      if (si < 0) return msgBox('Referencia no válida.').then(drawSel);
      scope = wb.sheets[si].name;
    }
    const name = m[2] || t, err = Bx.nameError(wb, name, scope);
    if (err) return msgBox(err).then(() => { nameBox.focus(); nameBox.select(); });
    if (extra.length) return msgBox('Bassxcel todavía no admite nombres de selecciones múltiples.').then(drawSel);
    snapshotOp(() => Bx.defineName(wb, { name, scope, ref: selRefText() }));
    wrap.focus({ preventScroll: true });
  }
  // La selección como "Se refiere a" absoluto: =Hoja1!$A$2:$A$5, =Hoja1!$B$3, =Hoja1!$A:$B o =Hoja1!$2:$4
  function selRefText(g = range(), S = sheet) {
    const col = c => '$' + colName(c), cell = (r, c) => col(c) + '$' + (r + 1);
    let body;
    if (isFullCols(g) && !isFullRows(g)) body = col(g.c1) + ':' + col(g.c2);
    else if (isFullRows(g) && !isFullCols(g)) body = '$' + (g.r1 + 1) + ':$' + (g.r2 + 1);
    else body = single(g) ? cell(g.r1, g.c1) : cell(g.r1, g.c1) + ':' + cell(g.r2, g.c2);
    return '=' + Bx.quoteSheet(S.name) + '!' + body;
  }
  const gotoRef = text => goToText(text, false);

  // ---------- Nombres definidos (rangos con nombre) ----------
  // El modelo y las reglas son del motor (Bx.defineName, editName, deleteName, nameError, eng.nameRange…); la UI
  // solo agrega cuadros, deshacer (snapshotOp guarda wb.names) y la reescritura de fórmulas al renombrar.
  const sameSheet = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
  // Nombres que se pueden usar desde la hoja si: los de libro y los de esa hoja (el de hoja oculta al de libro)
  function visibleNames(si = wb.active) {
    const sn = wb.sheets[si] ? wb.sheets[si].name : '';
    const list = Bx.listNames(wb).filter(d => !d.scope || sameSheet(d.scope, sn));
    return list.filter(d => d.scope || !list.some(x => x.scope && x.name.toUpperCase() === d.name.toUpperCase()));
  }
  // Nombre cuyo rango coincide con g en la hoja activa (para el cuadro de nombres), en caché hasta el próximo recálculo
  const gKey = g => g.r1 + ':' + g.c1 + ':' + g.r2 + ':' + g.c2;
  function selNameOf(g) {
    if (!wb.names || !wb.names.length) return null;
    if (!nameMemo || nameMemo.si !== wb.active) {
      const map = new Map();
      for (const d of visibleNames()) {
        const nr = eng.nameRange(d.name, wb.active);
        if (!nr || nr.si !== wb.active) continue;
        const k = nr.full === 'col' ? gKey({ r1: 0, c1: nr.c1, r2: sheet.rows - 1, c2: nr.c2 })
          : nr.full === 'row' ? gKey({ r1: nr.r1, c1: 0, r2: nr.r2, c2: sheet.cols - 1 }) : gKey(nr);
        if (!map.has(k)) map.set(k, d.name);
      }
      nameMemo = { si: wb.active, map };
    }
    return nameMemo.map.get(gKey(g)) || null;
  }
  // ▾ del cuadro de nombres (o Alt+↓): lista de nombres que son rangos; elegir uno lo selecciona
  function nameBoxMenu() {
    if (edit && !commitEdit()) return;
    const b = nameBox.getBoundingClientRect();
    const items = visibleNames().filter(d => eng.nameRange(d.name, wb.active)).map(d => [d.name, () => goToText(d.name)]);
    showMenu({ clientX: b.left, clientY: b.bottom }, items.length ? items : [['(sin nombres definidos)', null]]);
  }
  // (sin stopPropagation, el mousedown del documento cerraría la lista y el clic la volvería a abrir)
  $('#nameBoxBtn').addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  $('#nameBoxBtn').addEventListener('click', () => { if (menu.style.display === 'block') hideMenu(); else nameBoxMenu(); });
  // como Excel, al entrar al cuadro de nombres su texto queda seleccionado para escribir encima
  // (el primer mouseup después del clic que da el foco no debe quitar la selección)
  let nbFresh = false;
  nameBox.addEventListener('focus', () => { if (edit && !commitEdit()) return; nameBox.select(); nbFresh = true; });
  nameBox.addEventListener('mouseup', e => { if (nbFresh) e.preventDefault(); nbFresh = false; });
  // al salir sin Enter vuelve a mostrar la selección (salvo que se abra un mensaje: se conserva lo escrito)
  nameBox.addEventListener('blur', () => { nbFresh = false; if (!edit && !document.querySelector('dialog[open]')) drawSel(); });

  // Mensaje modal (Aceptar o Aceptar/Cancelar). → Promise<boolean> (true = Aceptar). Esc = Cancelar
  const msgDlg = $('#msgDlg');
  function msgBox(text, ask = false) {
    return new Promise(res => {
      if (msgDlg.open) msgDlg.close();   // (el mensaje anterior se resuelve como Cancelar)
      $('#msgText').textContent = text;
      $('#msgCancel').hidden = !ask;
      msgDlg.returnValue = '';
      msgDlg.onclose = () => { msgDlg.onclose = null; res(msgDlg.returnValue === 'ok'); backToGrid(); };
      msgDlg.showModal();
      $('#msgOk').focus();
    });
  }
  const askBox = text => msgBox(text, true);
  // Cuadro de diálogo reutilizable: dlgBox({ title, body, ok, cancel, onOk, focus, id }) → Promise<boolean> (true =
  // Aceptar). body: nodo o texto HTML fijo; focus: selector del control que recibe el foco al abrir; onOk() puede
  // devolver false para dejarlo abierto (validación). Enter = Aceptar (salvo sobre un botón, que hace lo suyo, o en un
  // textarea), Esc = Cancelar, Tab y Mayús+Tab circulan dentro del cuadro. Cada llamada crea su <dialog> y lo quita al
  // cerrarse, así un cuadro puede abrir otro encima (Ordenar ▸ Opciones…); el navegador devuelve el foco (L-047).
  // okEnabled: booleano o función; Aceptar se deshabilita mientras dé false (se vuelve a evaluar después de cada clic,
  // cambio o tecla dentro del cuadro, sin depender de que el ejecutor de la promesa sea síncrono), y Enter no acepta.
  // more: botones que cierran el cuadro con su valor ([{ text, value }], entre Aceptar y Cancelar: Sí / No / Cancelar);
  // aside: botones a la izquierda que no cierran ([{ id, text, onClick }]: "Borrar todos"); after: igual, a la derecha
  // de Cancelar ("Aplicar"). modeless: el cuadro no bloquea la vista de la hoja: una capa transparente cubre la página y
  // un clic en una celda de la grilla llama a onPick(r, c) (como el selector de rangos de Excel); la rueda desplaza la
  // hoja. Desde un cuadro modal no sirve (lo de atrás queda inerte): ahí se abre modal
  // pickDrag: además, arrastrar desde una celda llama a onPick(r, c, rango) con el rectángulo desde la celda inicial
  // ("Se aplica a" del administrador de formato condicional)
  function dlgBox({ title, body, ok = 'Aceptar', cancel = 'Cancelar', onOk, focus, id, okEnabled, more = [], aside = [], after = [], modeless = false, onPick, pickDrag = false, onClose } = {}) {
    return new Promise(res => {
      const d = document.createElement('dialog');
      d.className = 'bxdlg' + (modeless ? ' modeless' : '');
      if (id) d.id = id;
      d.innerHTML = '<h3></h3><div class="dlgbody"></div><div class="row"><button type="button" class="dlg-ok"></button>'
        + (cancel ? '<button type="button" class="dlg-cancel"></button>' : '') + '</div>';
      d.querySelector('h3').textContent = title || 'Bassxcel';
      const bodyEl = d.querySelector('.dlgbody');
      if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
      const okB = d.querySelector('.dlg-ok'), caB = d.querySelector('.dlg-cancel'), row = d.querySelector('.row');
      okB.textContent = ok;
      if (caB) caB.textContent = cancel;
      let done = false, shield = null;
      const finish = v => { if (done) return; done = true; if (onClose) onClose(v); d.close(); d.remove(); if (shield) shield.remove(); res(v); backToGrid(); };
      const accept = () => { if (okB.disabled) return; if (onOk && onOk() === false) return; finish(true); };
      okB.onclick = accept;
      if (caB) caB.onclick = () => finish(false);
      for (const m of more) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'dlg-more'; b.textContent = m.text;
        b.onclick = () => finish(m.value);
        row.insertBefore(b, caB);
      }
      aside.forEach((a, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'dlg-aside'; b.textContent = a.text;
        if (a.id) b.id = a.id;
        b.onclick = a.onClick;
        row.insertBefore(b, row.children[i]);
      });
      for (const a of after) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'dlg-after'; b.textContent = a.text;
        if (a.id) b.id = a.id;
        b.onclick = a.onClick;
        row.appendChild(b);
      }
      const syncOk = () => { if (okEnabled != null) okB.disabled = !(typeof okEnabled === 'function' ? okEnabled() : okEnabled); };
      // en burbuja: los manejadores propios del contenido ya actualizaron su estado
      for (const t of ['click', 'change', 'input', 'keyup']) d.addEventListener(t, syncOk);
      syncOk();
      d.addEventListener('cancel', e => { e.preventDefault(); finish(false); });   // Esc del navegador
      d.addEventListener('keydown', e => {
        // nada llega al manejador del documento: el cuadro puede cerrarse con esta misma tecla (L-046)
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.target.matches('button, textarea')) { e.preventDefault(); accept(); }
        else if (e.key === 'Tab') {
          // foco atrapado: del último control se vuelve al primero (y al revés con Mayús+Tab). En un grupo de radios
          // solo el marcado es una parada de tabulación
          const f = [...d.querySelectorAll('button, input, select, textarea')].filter(x => !x.disabled && x.getClientRects().length
            && !(x.type === 'radio' && !x.checked && d.querySelector(`input[type="radio"][name="${x.name}"]:checked`)));
          if (!f.length) return;
          const i = f.indexOf(document.activeElement);
          if (e.shiftKey ? i <= 0 : i < 0 || i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
        }
      });
      if (modeless) {
        shield = document.createElement('div');
        shield.className = 'dlg-shield';
        const cellAt = e => { const td = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.matches && x.matches('#grid td')); return td && cellOf(td); };
        shield.addEventListener('mousedown', e => {
          e.preventDefault();   // el foco sigue en el campo del cuadro
          const p = cellAt(e);
          if (!p || !onPick || e.button !== 0) return;
          const rect = q => ({ r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) });
          onPick(p.r, p.c, rect(p));
          if (!pickDrag) return;
          let last = p;
          const mv = ev => { const x = cellAt(ev); if (x && (x.r !== last.r || x.c !== last.c)) { last = x; onPick(p.r, p.c, rect(x)); } };
          const up = () => { shield.removeEventListener('mousemove', mv); removeEventListener('mouseup', up, true); };
          shield.addEventListener('mousemove', mv);
          addEventListener('mouseup', up, true);
        });
        shield.addEventListener('wheel', e => { wrap.scrollBy(e.deltaX, e.deltaY); }, { passive: true });
        document.body.appendChild(shield);
      }
      document.body.appendChild(d);
      if (modeless) d.show(); else d.showModal();
      ((focus && d.querySelector(focus)) || okB).focus();
    });
  }
  // Al cerrarse, un <dialog> devuelve el foco a quien lo tenía (cuadro de nombres, editor): se respeta. Si lo tenía un
  // botón de la cinta o nadie, el foco vuelve a la grilla (si no, los atajos de teclado dejarían de funcionar)
  const backToGrid = () => {
    if (document.querySelector('dialog[open]')) return;
    const a = document.activeElement;
    if (!a || a === document.body || !a.matches('input, textarea') || a.closest('dialog')) wrap.focus({ preventScroll: true });
  };

  // Columna "Valor" del administrador: escalar, {"1";"2"} para un rango (\ separa columnas en es-CL) o el error
  function nameValueText(d) {
    const si = d.scope ? eng.sheetIndex(d.scope) : wb.active;
    const nr = eng.nameRange(d.name, si);
    if (nr && (nr.r2 - nr.r1 + 1) * (nr.c2 - nr.c1 + 1) > 400) return '{…}';
    const v = eng.nameValue(d.name, si);
    const one = x => x === null || x === undefined ? '' : display(x, { v: '' });
    if (Array.isArray(v)) {
      const t = '{' + v.map(row => row.map(x => '"' + one(x) + '"').join('\\')).join(';') + '}';
      return t.length > 80 ? t.slice(0, 78) + '…}' : t;
    }
    return typeof v === 'string' ? '"' + v + '"' : one(v);
  }

  // Administrador de nombres (Ctrl+F3): lista, Nuevo…, Editar…, Eliminar y "Se refiere a" editable
  const namesDlg = $('#namesDlg');
  let nmPick = null;   // { name, scope } de la fila elegida
  const scopeLabel = s => s || 'Libro';
  function renderNames() {
    const list = Bx.listNames(wb), tb = $('#nmTable tbody');
    if (!nmPick || !list.some(d => d.name === nmPick.name && sameSheet(d.scope, nmPick.scope))) nmPick = list[0] ? { name: list[0].name, scope: list[0].scope } : null;
    tb.innerHTML = '';
    for (const d of list) {
      const tr = document.createElement('tr');
      if (nmPick && d.name === nmPick.name && sameSheet(d.scope, nmPick.scope)) tr.className = 'on';
      for (const t of [d.name, nameValueText(d), d.ref, scopeLabel(d.scope), d.comment || '']) {
        const td = document.createElement('td');
        td.textContent = t; td.title = t;
        tr.appendChild(td);
      }
      // el clic solo marca la fila (no reconstruye la tabla: el doble clic real necesita el mismo elemento, L-031)
      tr.onclick = () => { nmPick = { name: d.name, scope: d.scope }; tb.querySelectorAll('tr.on').forEach(x => x.classList.remove('on')); tr.classList.add('on'); nmFooter(d); };
      tr.ondblclick = () => { nmPick = { name: d.name, scope: d.scope }; openNameEditor(d); };
      tb.appendChild(tr);
    }
    nmFooter(nmPick && list.find(d => d.name === nmPick.name && sameSheet(d.scope, nmPick.scope)));
  }
  function nmFooter(cur) {
    $('#nmRef').value = cur ? cur.ref : '';
    $('#nmRef').disabled = !cur;
    $('#nmEdit').disabled = $('#nmDel').disabled = $('#nmRefOk').disabled = !cur;
  }
  function openNameManager() {
    if (edit && !commitEdit()) return;
    hideMenu();
    renderNames();
    namesDlg.showModal();
    const on = namesDlg.querySelector('tr.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  namesDlg.addEventListener('close', backToGrid);
  $('#nmNew').onclick = () => openNameEditor(null);
  $('#nmEdit').onclick = () => { const d = nmPick && Bx.listNames(wb).find(x => x.name === nmPick.name && sameSheet(x.scope, nmPick.scope)); if (d) openNameEditor(d); };
  $('#nmDel').onclick = async () => {
    if (!nmPick) return;
    const p = nmPick;
    if (!await askBox(`¿Está seguro de que desea eliminar el nombre ${p.name}?`)) return;
    // las fórmulas que lo usan pasan a #¿NOMBRE?, como en Excel; se deshace con Ctrl+Z
    snapshotOp(() => (Bx.deleteName(wb, p.name, p.scope) ? null : { error: 'El nombre no existe.' }));
    nmPick = null;
    renderNames();
  };
  // "Se refiere a" del pie: Enter o ✓ lo aplican al nombre elegido; Esc vuelve al valor guardado
  function applyPickRef() {
    if (!nmPick) return;
    const d = Bx.listNames(wb).find(x => x.name === nmPick.name && sameSheet(x.scope, nmPick.scope));
    const ref = $('#nmRef').value.trim();
    if (!d || ref === d.ref) return;
    const r = snapshotOp(() => Bx.editName(wb, d.name, d.scope, { ref, base: sheet.name }));
    if (r && r.error) return msgBox(r.error).then(() => $('#nmRef').focus());
    renderNames();
  }
  $('#nmRefOk').onclick = applyPickRef;
  $('#nmRef').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyPickRef(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); renderNames(); }
  });

  // Cuadro "Nombre nuevo" / "Editar nombre". d: definición a editar o null (nuevo, con la selección como referencia)
  const nameEdDlg = $('#nameEdDlg');
  let neEditing = null;
  function openNameEditor(d) {
    if (edit && !commitEdit()) return;
    hideMenu();
    neEditing = d ? { name: d.name, scope: d.scope } : null;
    $('#neTitle').textContent = d ? 'Editar nombre' : 'Nombre nuevo';
    const sc = $('#neScope');
    sc.innerHTML = '';
    sc.add(new Option('Libro', ''));
    for (const s of wb.sheets) sc.add(new Option(s.name, s.name));
    sc.value = d && d.scope ? (wb.sheets.find(s => sameSheet(s.name, d.scope)) || {}).name || '' : '';
    sc.disabled = !!d;   // como Excel: el ámbito no se cambia al editar
    $('#neName').value = d ? d.name : '';
    $('#neComment').value = d ? d.comment || '' : '';
    $('#neRef').value = d ? d.ref : selRefText();
    nameEdDlg.showModal();
    $('#neName').focus(); $('#neName').select();
  }
  // Al renombrar, Excel actualiza todas las fórmulas que usan el nombre. Un nombre de hoja solo se usa en su hoja;
  // uno de libro, en las hojas que no tienen otro de hoja con el mismo nombre
  function renameNameEverywhere(oldName, newName, scope) {
    const shadowed = sn => !scope && (wb.names || []).some(x => x.scope && sameSheet(x.scope, sn) && x.name.toUpperCase() === String(oldName).toUpperCase());
    for (const s of wb.sheets) {
      if (scope ? !sameSheet(s.name, scope) : shadowed(s.name)) continue;
      for (const cell of Object.values(s.cells)) if (isFormula(cell.v)) cell.v = Bx.renameNameInFormula(cell.v, oldName, newName);
      for (const d of s.dv || []) dvMapFormulas(d, f => Bx.renameNameInFormula(f, oldName, newName));   // Origen =Colores
      for (const d of s.cf || []) dvMapFormulas(d, f => Bx.renameNameInFormula(f, oldName, newName));   // formato condicional =A1>Meta
    }
    for (const x of wb.names || []) {
      if (x.name === newName && sameSheet(x.scope, scope)) continue;
      if (scope ? sameSheet(x.scope, scope) : !(x.scope && shadowed(x.scope))) x.ref = Bx.renameNameInFormula(x.ref, oldName, newName);
    }
  }
  $('#nameEdForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#neName').value.trim(), ref = $('#neRef').value.trim(), comment = $('#neComment').value;
    let r;
    if (!neEditing) {
      const scope = $('#neScope').value || null;
      r = snapshotOp(() => Bx.defineName(wb, { name, scope, ref, comment, base: sheet.name }));
    } else {
      const p = neEditing, cur = Bx.listNames(wb).find(x => x.name === p.name && sameSheet(x.scope, p.scope));
      const changes = { name, comment };
      if (!cur || ref !== cur.ref) Object.assign(changes, { ref, base: sheet.name });   // la referencia solo si cambió
      r = snapshotOp(() => {
        const res = Bx.editName(wb, p.name, p.scope, changes);
        if (res.renamed) renameNameEverywhere(res.renamed[0], res.renamed[1], res.def.scope);
        return res;
      });
    }
    if (r && r.error) { msgBox(r.error).then(() => { $('#neName').focus(); }); return; }
    nmPick = { name, scope: r.def.scope };
    nameEdDlg.close();
    if (namesDlg.open) renderNames();
  });
  $('#neCancel').onclick = () => nameEdDlg.close();
  nameEdDlg.addEventListener('close', backToGrid);

  // Pegar nombre (F3, "Utilizar en la fórmula"): en una fórmula lo inserta en el cursor; si no se está editando, empieza
  // a escribir "=Nombre" en la celda activa (como Excel)
  const pasteNameDlg = $('#pasteNameDlg');
  let pnTarget = null;
  function pasteNameDialog() {
    const si = edit ? edit.si : wb.active, list = visibleNames(si);
    if (!list.length) return toast('No hay nombres definidos');
    const inp = edit ? activeInput() : null;
    pnTarget = inp ? { inp, s: inp.selectionStart, e: inp.selectionEnd } : null;
    const sel = $('#pnList');
    sel.innerHTML = '';
    for (const d of list) sel.add(new Option(d.name, d.name));
    sel.selectedIndex = 0;
    hideAssist();
    pasteNameDlg.showModal();
    sel.focus();
  }
  function pasteName(name) {
    pasteNameDlg.close();
    if (!pnTarget || !edit) { if (!edit) startEdit('=' + name, true); return; }
    const { inp, s, e } = pnTarget;
    inp.focus({ preventScroll: true });
    inp.setRangeText(name, s, e, 'end');
    edit.refIns = null;
    mirrorInput(inp);
    updateAssist();
  }
  $('#pasteNameForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#pnList').value; if (v) pasteName(v); });
  $('#pnList').addEventListener('dblclick', () => { const v = $('#pnList').value; if (v) pasteName(v); });
  // en una lista, Enter no envía el formulario: se acepta aquí. stopPropagation: el cuadro ya se cerró, y el manejador
  // de teclado del documento confirmaría la edición con este mismo Enter
  $('#pnList').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const v = $('#pnList').value; if (v) pasteName(v); } });
  $('#pnCancel').onclick = () => pasteNameDlg.close();
  pasteNameDlg.addEventListener('close', () => {
    if (edit) activeInput().focus({ preventScroll: true }); else backToGrid();
    pnTarget = null;
  });

  // Crear nombres a partir de la selección (Ctrl+Mayús+F3): los rótulos de la fila superior/inferior o la columna
  // izquierda/derecha nombran las celdas de su columna o fila
  const createNamesDlg = $('#createNamesDlg');
  // Rótulo → nombre válido: espacios y caracteres no permitidos pasan a "_"; si empieza con un número o parece una
  // referencia (A1, C, R) se antepone "_", como hace Excel. null si no se puede
  function labelToName(label) {
    let s = String(label).trim().replace(/\s+/g, '_').replace(/[^\w.À-ſ]/g, '_');
    if (!s) return null;
    if (!/^[A-Za-z_À-ſ]/.test(s)) s = '_' + s;
    const probe = { sheets: wb.sheets, names: [] };
    if (Bx.nameError(probe, s, null)) s = '_' + s;
    return Bx.nameError(probe, s, null) ? null : s;
  }
  const isLabel = (r, c) => { const v = eng.value(wb.active, r, c); return typeof v === 'string' && v !== ''; };
  function createNamesDialog() {
    if (edit && !commitEdit()) return;
    hideMenu();
    const g = range();
    if (single(g)) return msgBox('Seleccione un rango con rótulos en la fila superior o en la columna izquierda.');
    // casillas sugeridas como Excel: rótulos de texto arriba o a la izquierda
    let top = g.r2 > g.r1, left = g.c2 > g.c1;
    if (top) for (let c = g.c1 + (left ? 1 : 0); c <= g.c2 && top; c++) top = isLabel(g.r1, c);
    if (left) for (let r = g.r1 + 1; r <= g.r2 && left; r++) left = isLabel(r, g.c1);
    $('#cnTop').checked = top; $('#cnLeft').checked = left;
    $('#cnBottom').checked = false; $('#cnRight').checked = false;
    if (!top && !left) $('#cnTop').checked = g.r2 > g.r1;
    createNamesDlg.showModal();
    $('#cnOk').focus();
  }
  $('#cnCancel').onclick = () => createNamesDlg.close();
  createNamesDlg.addEventListener('close', backToGrid);
  $('#createNamesForm').addEventListener('submit', async e => {
    e.preventDefault();
    const o = { top: $('#cnTop').checked, left: $('#cnLeft').checked, bottom: $('#cnBottom').checked, right: $('#cnRight').checked };
    createNamesDlg.close();
    if (!o.top && !o.left && !o.bottom && !o.right) return;
    const g = range(), S = sheet, out = [];
    const rs = g.r1 + (o.top ? 1 : 0), re = g.r2 - (o.bottom ? 1 : 0), cs = g.c1 + (o.left ? 1 : 0), ce = g.c2 - (o.right ? 1 : 0);
    const add = (lr, lc, body) => {
      if (body.r2 < body.r1 || body.c2 < body.c1) return;
      const name = labelToName(cellText(lr, lc));
      if (name && !out.some(x => x.name.toUpperCase() === name.toUpperCase())) out.push({ name, ref: selRefText(body, S) });
    };
    for (let c = cs; c <= ce; c++) {
      if (o.top) add(g.r1, c, { r1: rs, c1: c, r2: re, c2: c });
      if (o.bottom) add(g.r2, c, { r1: rs, c1: c, r2: re, c2: c });
    }
    for (let r = rs; r <= re; r++) {
      if (o.left) add(r, g.c1, { r1: r, c1: cs, r2: r, c2: ce });
      if (o.right) add(r, g.c2, { r1: r, c1: cs, r2: r, c2: ce });
    }
    if (!out.length) return msgBox('No se pudo crear ningún nombre: los rótulos están vacíos o no son válidos.');
    // como Excel, un nombre que ya existe en el libro se reemplaza solo si se confirma
    const todo = [];
    for (const x of out) {
      const ex = (wb.names || []).find(d => !d.scope && d.name.toUpperCase() === x.name.toUpperCase());
      if (ex && ex.ref !== x.ref && !await askBox(`¿Desea reemplazar la definición existente de '${ex.name}'?`)) continue;
      todo.push({ ...x, exists: !!ex });
    }
    if (!todo.length) return;
    snapshotOp(() => {
      for (const x of todo) {
        if (x.exists) Bx.editName(wb, x.name, null, { ref: x.ref }); else Bx.defineName(wb, { name: x.name, ref: x.ref });
      }
    });
  });

  // ---------- Edición ----------
  // edit = { mode: 'cell'|'bar', typed, refIns, si: hoja donde se edita, A: celda que se edita }
  // typed = true es el modo "Introducir" (las flechas señalan celdas o confirman); false es "Modificar" (F2)
  const edMirror = $('#edMirror'), fbMirror = $('#fbMirror'), refHL = $('#refHL'), acList = $('#acList'), sigTip = $('#sigTip');
  const REF_COLORS = ['#2563eb', '#dc2626', '#7c3aed', '#059669', '#d97706', '#db2777', '#0891b2', '#65a30d'];
  const activeInput = () => edit && edit.mode === 'bar' ? fb : ed;
  const isFormulaText = v => typeof v === 'string' && v.startsWith('=');
  const esc = s => s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);

  // El editor crece a lo ancho con el texto y hacia abajo con cada salto de línea (Alt+Enter)
  function sizeEditor() {
    if (!edit || wb.active !== edit.si) return;
    const s = effStyle(edit.A.r, edit.A.c), w = colX[edit.A.c + 1] - colX[edit.A.c];
    const lines = ed.value.split('\n');
    let widest = 0;
    for (const l of lines) widest = Math.max(widest, textWidth(l, s));
    ed.style.width = Math.max(w + 1, Math.min(600, widest + 16)) + 'px';
    const lh = s.fs ? lineH(ptPx(s.fs)) : 19;
    ed.style.height = Math.max(edit.h0, lines.length * lh + 5) + 'px';
  }
  function startEdit(initial, typed, mode = 'cell') {
    const cell = getCell(A.r, A.c), R = rect({ r1: A.r, c1: A.c, r2: A.r, c2: A.c });
    const val = initial != null ? initial : rawOf(cell);
    closeDvList();
    edit = { mode, typed, refIns: null, si: wb.active, A: { ...A }, h0: R.height + 1 };
    ed.value = val; fb.value = val;
    fbMirror.classList.remove('ghost');   // al editar una fantasma se escribe su propio contenido (bloquea el desborde)
    ed.style.left = R.left + 'px';
    ed.style.top = R.top + 'px';
    ed.style.height = R.height + 1 + 'px';
    // el editor usa la fuente efectiva de la celda (celda < fila < columna)
    const s = effStyle(A.r, A.c);
    ed.style.fontWeight = s.b ? '700' : ''; ed.style.fontStyle = s.i ? 'italic' : '';
    ed.style.fontFamily = s.ff ? fontFamily(s) : '';
    ed.style.fontSize = s.fs ? ptPx(s.fs).toFixed(2) + 'px' : '';
    ed.style.lineHeight = s.fs ? lineH(ptPx(s.fs)) + 'px' : '';
    ed.style.display = 'block';
    sizeEditor();
    if (mode === 'cell') { ed.focus({ preventScroll: true }); ed.setSelectionRange(val.length, val.length); }
    updateAssist();
  }
  function endEdit() {
    edit = null;
    ed.style.display = 'none';
    hideAssist();
    refHL.innerHTML = '';
    syncMirrors();
    wrap.focus({ preventScroll: true });
  }
  // Confirma la edición. → true si se confirmó; false si la fórmula no es válida (como Excel: mensaje y la celda sigue
  // en edición). force: confirmar sin validar (cerrar o recargar la página: se conserva lo escrito). next: lo que sigue
  // después de confirmar (Enter, Tab); si la validación de datos pregunta y el usuario acepta el valor, se hace entonces
  function commitEdit(dr = 0, dc = 0, force = false, next = null) {
    if (!edit) return true;
    let val = activeInput().value;
    if (isFormula(val)) val = closeParens(val);
    if (!force && rejectFormula(val)) return false;
    // validación de datos de la celda: un valor no válido muestra el mensaje de error y la celda sigue en edición
    if (!force && dvReject(val, () => commitEdit(dr, dc, true, next))) return false;
    const home = edit.si;
    endEdit();
    if (wb.active !== home) showSheet(home);
    const s = effStyle(A.r, A.c), cell = entryCell(clone(getCell(A.r, A.c)) || {}, val, s);
    // Como Excel: un salto de línea escrito con Alt+Enter activa "Ajustar texto" en la celda (mismo paso de deshacer)
    if (val.includes('\n') && !s.wrap) cell.s = { ...(cell.s || {}), wrap: true };
    if (!applyChanges([{ r: A.r, c: A.c, cell }])) refreshBar();
    if (dr || dc) move(dr, dc);
    if (next) next();
    return true;
  }
  // Validación al ingresar una fórmula (Bx.checkFormula: cantidad de argumentos y sintaxis). Solo se valida lo que se
  // escribe; las fórmulas que ya están en la hoja (archivos, pegar, rellenar) no. → true si se rechazó
  function rejectFormula(val) {
    if (!edit || !isFormula(val)) return false;
    const bad = Bx.checkFormula(val);
    if (!bad) return false;
    const inp = activeInput();
    msgBox(bad.message).then(() => {
      if (!edit) return;
      // se vuelve a la edición con el cursor al final (Excel señala el argumento sobrante: pendiente). Con texto
      // seleccionado, un clic en otra celda insertaría una referencia en vez de intentar confirmar
      const n = inp.value.length;
      inp.focus({ preventScroll: true });
      inp.setSelectionRange(n, n);
      updateAssist();
    });
    return true;
  }
  function cancelEdit() {
    const home = edit.si;
    endEdit();
    if (wb.active !== home) showSheet(home);
    refreshBar();
  }

  // ---------- Asistencia de fórmulas: colores, recuadros, autocompletado y sintaxis ----------
  // Cada referencia distinta recibe un color, en orden de aparición
  // Los nombres que son rangos también reciben color y recuadro (r.g: rango del nombre, de eng.nameRange)
  function refColors(v) {
    const refs = Bx.findRefs(v), map = new Map();
    for (const r of refs) r.key = v.slice(r.start, r.end).replace(/\$/g, '').toUpperCase();
    if (edit && wb.names && wb.names.length) {
      for (const n of Bx.findNames(v)) {
        const g = eng.nameRange(n.name, edit.si);
        if (g) refs.push({ start: n.start, end: n.end, name: n.name, g, key: '\u0000' + n.name.toUpperCase() });
      }
      refs.sort((a, b) => a.start - b.start);
    }
    for (const r of refs) {
      if (!map.has(r.key)) map.set(r.key, REF_COLORS[map.size % REF_COLORS.length]);
      r.color = map.get(r.key);
    }
    return refs;
  }
  function paintMirror(inp, mirror) {
    const v = inp.value, span = mirror.firstElementChild;
    if (edit && isFormulaText(v)) {
      let h = '', pos = 0;
      for (const r of refColors(v)) { h += esc(v.slice(pos, r.start)) + `<i style="color:${r.color}">${esc(v.slice(r.start, r.end))}</i>`; pos = r.end; }
      span.innerHTML = h + esc(v.slice(pos));
    } else span.textContent = v;
    span.style.transform = `translate(${-inp.scrollLeft}px, ${-inp.scrollTop}px)`;
  }
  function syncMirrors() {
    edMirror.style.display = ed.style.display;
    if (ed.style.display !== 'none') {
      for (const p of ['left', 'top', 'width', 'height', 'fontWeight', 'fontStyle', 'fontFamily', 'fontSize', 'lineHeight']) edMirror.style[p] = ed.style[p];
      paintMirror(ed, edMirror);
    }
    paintMirror(fb, fbMirror);
  }
  function drawRefHL() {
    if (!edit || !isFormulaText(activeInput().value)) { refHL.innerHTML = ''; return; }
    const home = wb.sheets[edit.si].name.toLowerCase(), cur = sheet.name.toLowerCase();
    let h = '';
    for (const r of refColors(activeInput().value)) {
      if (r.name) {
        // rango con nombre: recuadro sobre su rango si está en la hoja que se ve (columna o fila completa: entera)
        if (r.g.si !== wb.active) continue;
        const g = { r1: r.g.full === 'col' ? 0 : r.g.r1, c1: r.g.full === 'row' ? 0 : r.g.c1,
          r2: Math.min(r.g.full === 'col' ? sheet.rows - 1 : r.g.r2, sheet.rows - 1), c2: Math.min(r.g.full === 'row' ? sheet.cols - 1 : r.g.c2, sheet.cols - 1) };
        if (g.r1 >= sheet.rows || g.c1 >= sheet.cols) continue;
        const R = rect(g), cp = fzClip(g, R);
        h += `<div class="refbox" data-name="${esc(r.name)}" style="left:${R.left}px;top:${R.top}px;width:${R.width + 1}px;height:${R.height + 1}px;color:${r.color};border-color:${r.color};background:${r.color}1a${cp ? ';clip-path:' + cp : ''}"></div>`;
        continue;
      }
      if ((r.sheet ?? home).toLowerCase() !== cur) continue;
      let b = r.b || r.a, a = r.a;
      // A1#: el recuadro cubre el rango desbordado desde A1 (si A1 no desborda, solo la celda)
      if (r.spill) {
        const sp = eng.spillAt(wb.active, r.a.r, r.a.c);
        if (sp && sp.anchor.r === r.a.r && sp.anchor.c === r.a.c) { a = { r: sp.r1, c: sp.c1 }; b = { r: sp.r2, c: sp.c2 }; }
      }
      const g = { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.min(Math.max(a.r, b.r), sheet.rows - 1), c2: Math.min(Math.max(a.c, b.c), sheet.cols - 1) };
      if (g.r1 >= sheet.rows || g.c1 >= sheet.cols) continue;
      const R = rect(g), cp = fzClip(g, R);
      h += `<div class="refbox" style="left:${R.left}px;top:${R.top}px;width:${R.width + 1}px;height:${R.height + 1}px;color:${r.color};border-color:${r.color};background:${r.color}1a${cp ? ';clip-path:' + cp : ''}"></div>`;
    }
    refHL.innerHTML = h;
  }

  // Sintaxis de cada función (por nombre canónico); se muestra con el nombre que escribió el usuario
  const SIG = {
    SUM: ['número1', '[número2]', '...'], AVERAGE: ['número1', '[número2]', '...'], MIN: ['número1', '[número2]', '...'],
    MAX: ['número1', '[número2]', '...'], MEDIAN: ['número1', '[número2]', '...'], STDEV: ['número1', '[número2]', '...'],
    COUNT: ['valor1', '[valor2]', '...'], COUNTA: ['valor1', '[valor2]', '...'], COUNTBLANK: ['rango'],
    PRODUCT: ['número1', '[número2]', '...'], ROUND: ['número', 'núm_decimales'], ROUNDUP: ['número', 'núm_decimales'],
    ROUNDDOWN: ['número', 'núm_decimales'], INT: ['número'], ABS: ['número'], SQRT: ['número'], POWER: ['número', 'potencia'],
    MOD: ['número', 'divisor'], PI: [], RAND: [], RANDBETWEEN: ['inferior', 'superior'],
    IF: ['prueba_lógica', '[valor_si_verdadero]', '[valor_si_falso]'], IFERROR: ['valor', 'valor_si_error'],
    ISERROR: ['valor'], ISBLANK: ['valor'], ISNUMBER: ['valor'], ISTEXT: ['valor'],
    AND: ['valor_lógico1', '[valor_lógico2]', '...'], OR: ['valor_lógico1', '[valor_lógico2]', '...'], NOT: ['valor_lógico'],
    CONCAT: ['texto1', '[texto2]', '...'], LEN: ['texto'], UPPER: ['texto'], LOWER: ['texto'], PROPER: ['texto'], TRIM: ['texto'],
    LEFT: ['texto', '[núm_caracteres]'], RIGHT: ['texto', '[núm_caracteres]'], MID: ['texto', 'posición_inicial', 'núm_caracteres'],
    SUBSTITUTE: ['texto', 'texto_original', 'texto_nuevo'], REPT: ['texto', 'núm_de_veces'], VALUE: ['texto'],
    TODAY: [], NOW: [], DATE: ['año', 'mes', 'día'], YEAR: ['núm_de_serie'], MONTH: ['núm_de_serie'], DAY: ['núm_de_serie'],
    SUMIF: ['rango', 'criterio', '[rango_suma]'], COUNTIF: ['rango', 'criterio'], AVERAGEIF: ['rango', 'criterio', '[rango_promedio]'],
    VLOOKUP: ['valor_buscado', 'matriz_tabla', 'indicador_columnas', '[rango]'],
    MATCH: ['valor_buscado', 'matriz_buscada', '[tipo_de_coincidencia]'], INDEX: ['matriz', 'núm_fila', '[núm_columna]'],
    SUMIFS: ['rango_suma', 'rango_criterios1', 'criterio1', '[rango_criterios2]', '[criterio2]', '...'],
    COUNTIFS: ['rango_criterios1', 'criterio1', '[rango_criterios2]', '[criterio2]', '...'],
    AVERAGEIFS: ['rango_promedio', 'rango_criterios1', 'criterio1', '[rango_criterios2]', '[criterio2]', '...'],
    MAXIFS: ['rango_max', 'rango_criterios1', 'criterio1', '[rango_criterios2]', '[criterio2]', '...'],
    MINIFS: ['rango_min', 'rango_criterios1', 'criterio1', '[rango_criterios2]', '[criterio2]', '...'],
    IFS: ['prueba_lógica1', 'valor_si_verdadero1', '[prueba_lógica2]', '[valor_si_verdadero2]', '...'],
    XLOOKUP: ['valor_buscado', 'matriz_buscada', 'matriz_devuelta', '[si_no_se_encuentra]', '[modo_de_coincidencia]', '[modo_de_búsqueda]'],
    HLOOKUP: ['valor_buscado', 'matriz_buscar_en', 'indicador_filas', '[ordenado]'],
    IFNA: ['valor', 'valor_si_nd'], ISNA: ['valor'],
    TEXT: ['valor', 'formato'],
    TEXTJOIN: ['delimitador', 'ignorar_vacías', 'texto1', '[texto2]', '...'],
    FIND: ['texto_buscado', 'dentro_del_texto', '[núm_inicial]'], SEARCH: ['texto_buscado', 'dentro_del_texto', '[núm_inicial]'],
    SUMPRODUCT: ['matriz1', '[matriz2]', '...'],
    LARGE: ['matriz', 'k'], SMALL: ['matriz', 'k'],
    RANK: ['número', 'referencia', '[orden]'], 'RANK.EQ': ['número', 'referencia', '[orden]'],
    WEEKDAY: ['núm_de_serie', '[tipo]'], EOMONTH: ['fecha_inicial', 'meses'], EDATE: ['fecha_inicial', 'meses'],
    DATEDIF: ['fecha_inicial', 'fecha_final', 'unidad'], NETWORKDAYS: ['fecha_inicial', 'fecha_final', '[vacaciones]'],
    TRUNC: ['número', '[núm_decimales]'], CEILING: ['número', 'cifra_significativa'], FLOOR: ['número', 'cifra_significativa'],
    CHOOSE: ['núm_índice', 'valor1', '[valor2]', '...'],
    ROW: ['[ref]'], COLUMN: ['[ref]'],
    SUBTOTAL: ['núm_función', 'ref1', '[ref2]', '...'],
    VAR: ['número1', '[número2]', '...'], 'VAR.S': ['número1', '[número2]', '...'], 'VAR.P': ['número1', '[número2]', '...'], VARP: ['número1', '[número2]', '...'],
    'STDEV.S': ['número1', '[número2]', '...'], 'STDEV.P': ['número1', '[número2]', '...'], STDEVP: ['número1', '[número2]', '...'],
    PMT: ['tasa', 'nper', 'va', '[vf]', '[tipo]'], FV: ['tasa', 'nper', 'pago', '[va]', '[tipo]'], PV: ['tasa', 'nper', 'pago', '[vf]', '[tipo]'],
    INDIRECT: ['ref', '[a1]'], OFFSET: ['ref', 'filas', 'columnas', '[alto]', '[ancho]'],
    NPER: ['tasa', 'pago', 'va', '[vf]', '[tipo]'], RATE: ['nper', 'pago', 'va', '[vf]', '[tipo]', '[estimar]'],
    NPV: ['tasa', 'valor1', '[valor2]', '...'], IRR: ['valores', '[estimar]'],
    IPMT: ['tasa', 'período', 'nper', 'va', '[vf]', '[tipo]'], PPMT: ['tasa', 'período', 'nper', 'va', '[vf]', '[tipo]'],
    XNPV: ['tasa', 'valores', 'fechas'], XIRR: ['valores', 'fechas', '[estimar]'],
    MODE: ['número1', '[número2]', '...'], 'MODE.SNGL': ['número1', '[número2]', '...'],
    PERCENTILE: ['matriz', 'k'], 'PERCENTILE.INC': ['matriz', 'k'], 'PERCENTILE.EXC': ['matriz', 'k'],
    QUARTILE: ['matriz', 'cuartil'], 'QUARTILE.INC': ['matriz', 'cuartil'], 'QUARTILE.EXC': ['matriz', 'cuartil'],
    CORREL: ['matriz1', 'matriz2'], PEARSON: ['matriz1', 'matriz2'],
    RSQ: ['conocido_y', 'conocido_x'], SLOPE: ['conocido_y', 'conocido_x'], INTERCEPT: ['conocido_y', 'conocido_x'],
    FORECAST: ['x', 'conocido_y', 'conocido_x'], 'FORECAST.LINEAR': ['x', 'conocido_y', 'conocido_x'],
    'RANK.AVG': ['número', 'referencia', '[orden]'], TRIMMEAN: ['matriz', 'porcentaje'],
    AVERAGEA: ['valor1', '[valor2]', '...'], MAXA: ['valor1', '[valor2]', '...'], MINA: ['valor1', '[valor2]', '...'],
    HOUR: ['núm_de_serie'], MINUTE: ['núm_de_serie'], SECOND: ['núm_de_serie'],
    TIME: ['hora', 'minuto', 'segundo'], TIMEVALUE: ['texto_de_hora'], DATEVALUE: ['texto_de_fecha'],
    AGGREGATE: ['núm_función', 'opciones', 'ref1', '[ref2]', '...'],
    // matrices dinámicas (aridad de Bx.ARITY: SECUENCIA 1–4, UNICOS 1–3, FILTRAR 2–3, ORDENAR 1–4, ORDENARPOR 2+,
    // MATRIZALEAT 0–5, TOMAR/EXCLUIR 2–3, ELEGIRCOLS/ELEGIRFILAS 2+, TRANSPONER 1)
    SEQUENCE: ['filas', '[columnas]', '[inicio]', '[incremento]'],
    UNIQUE: ['matriz', '[por_columna]', '[exactamente_una_vez]'],
    FILTER: ['matriz', 'incluir', '[si_vacío]'],
    SORT: ['matriz', '[índice_de_orden]', '[criterio_de_ordenación]', '[por_columna]'],
    SORTBY: ['matriz', 'por_matriz1', '[criterio_de_ordenación1]', '[por_matriz2]', '[criterio_de_ordenación2]', '...'],
    RANDARRAY: ['[filas]', '[columnas]', '[mín]', '[máx]', '[entero]'],
    'MODE.MULT': ['número1', '[número2]', '...'],
    VSTACK: ['matriz1', '[matriz2]', '...'], HSTACK: ['matriz1', '[matriz2]', '...'],
    TAKE: ['matriz', 'filas', '[columnas]'], DROP: ['matriz', 'filas', '[columnas]'],
    CHOOSECOLS: ['matriz', 'núm_col1', '[núm_col2]', '...'], CHOOSEROWS: ['matriz', 'núm_fila1', '[núm_fila2]', '...'],
    TRANSPOSE: ['matriz'],
  };
  const NAME_END = /([A-Za-z_À-ſ][\w.À-ſ]*)\s*$/;
  // Función más interna abierta antes del cursor y número de argumento actual
  // es-CL: solo ';' separa argumentos (la coma es decimal); no cuentan los ';' dentro de "texto", de
  // 'nombre de hoja' ni de constantes matriciales {1;2}
  function fnContext(v, caret) {
    const s = v.slice(0, caret), stack = [];
    let q = false, sq = false, br = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"' && !sq) { q = !q; continue; }
      if (q) continue;
      if (ch === "'") { sq = !sq; continue; }
      if (sq) continue;
      if (ch === '{') { br++; continue; }
      if (ch === '}') { br = Math.max(0, br - 1); continue; }
      if (br) continue;
      if (ch === '(') { const m = NAME_END.exec(s.slice(0, i)); stack.push({ name: m ? m[1] : null, arg: 0 }); }
      else if (ch === ')') stack.pop();
      else if (ch === ';' && stack.length) stack[stack.length - 1].arg++;
    }
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name) return stack[k];
    return null;
  }
  // Nombre que se está escribiendo justo antes del cursor (para autocompletar)
  function acPrefix(v, caret) {
    const s = v.slice(0, caret);
    if (!isFormulaText(s) || (s.match(/"/g) || []).length % 2) return null;
    const m = /(^=|[(+\-*/^&;<>=:\s{])([A-Za-z_À-ſ][\w.À-ſ]*)$/.exec(s);
    return m ? m[2] : null;
  }

  // Nombre en español de una función (el primer alias distinto del canónico en inglés)
  let ES_NAME = null;
  function esName(n) {
    if (!ES_NAME) { ES_NAME = {}; for (const [name, c] of Object.entries(Bx.CANON)) if (name !== c && !ES_NAME[c]) ES_NAME[c] = name; }
    const c = Bx.CANON[n] || n;
    return ES_NAME[c] || c;
  }

  let ac = { items: [], idx: 0, start: 0 };
  function hideAssist() { acList.style.display = 'none'; sigTip.style.display = 'none'; ac.items = []; }
  function updateAssist() {
    syncMirrors();
    drawRefHL();
    const inp = activeInput();
    if (!edit || !isFormulaText(inp.value)) { hideAssist(); return; }
    const caret = inp.selectionStart, v = inp.value, box = inp.getBoundingClientRect();
    let y = box.bottom + 2;
    const ctx = fnContext(v, caret), canon = ctx && Bx.CANON[ctx.name.toUpperCase()];
    if (canon && SIG[canon]) {
      const args = SIG[canon], i = Math.min(ctx.arg, args.length - 1);
      sigTip.innerHTML = esc(ctx.name.toUpperCase()) + '(' + args.map((a, j) => j === i ? `<b>${esc(a)}</b>` : esc(a)).join('; ') + ')';
      sigTip.style.left = box.left + 'px';
      sigTip.style.top = y + 'px';
      sigTip.style.display = 'block';
      y += sigTip.offsetHeight + 2;
    } else sigTip.style.display = 'none';
    const pre = acPrefix(v, caret), P = pre && pre.toUpperCase();
    // Se listan los nombres en español (como un Excel en español); escribir el nombre en inglés también los encuentra.
    // Junto a las funciones van los nombres definidos del libro y de la hoja que se edita (como Excel, en orden alfabético)
    let items = [];
    if (P) {
      items = [...new Set(Bx.FUNCTIONS.filter(n => n.startsWith(P)).map(esName))].map(t => ({ t, fn: true }));
      for (const d of visibleNames(edit.si)) if (d.name.toUpperCase().startsWith(P) && !items.some(x => x.t.toUpperCase() === d.name.toUpperCase())) items.push({ t: d.name, fn: false });
      items = items.sort((a, b) => a.t.toUpperCase().localeCompare(b.t.toUpperCase(), 'es')).slice(0, 12);
    }
    if (items.length && !(items.length === 1 && items[0].t.toUpperCase() === P)) {
      const keep = ac.items[ac.idx] && ac.items[ac.idx].t;
      ac = { items, idx: Math.max(0, items.findIndex(x => x.t === keep)), start: caret - pre.length };
      acList.innerHTML = items.map((x, j) => `<div class="${j === ac.idx ? 'on' : ''}${x.fn ? '' : ' nm'}" data-i="${j}"><span>${esc(x.t)}</span><small>${x.fn ? (Bx.CANON[x.t] !== x.t ? Bx.CANON[x.t] : '') : 'nombre'}</small></div>`).join('');
      acList.style.left = box.left + 'px';
      acList.style.top = y + 'px';
      acList.style.display = 'block';
    } else { acList.style.display = 'none'; ac.items = []; }
  }
  function mirrorInput(inp) { (inp === ed ? fb : ed).value = inp.value; sizeEditor(); }
  function acceptAC(i = ac.idx) {
    const inp = activeInput(), it = ac.items[i];
    if (!it) return;
    // una función se completa con "(", un nombre definido solo con su nombre
    const name = it.t, open = it.fn ? '(' : '';
    const rest = it.fn ? inp.value.slice(inp.selectionStart).replace(/^\s*\(/, '') : inp.value.slice(inp.selectionStart);
    inp.value = inp.value.slice(0, ac.start) + name + open + rest;
    const pos = ac.start + name.length + open.length;
    inp.focus({ preventScroll: true });
    inp.setSelectionRange(pos, pos);
    edit.refIns = null;
    mirrorInput(inp);
    hideAssist();
    updateAssist();
  }
  acList.addEventListener('mousedown', e => {
    e.preventDefault();
    const d = e.target.closest('[data-i]');
    if (d) acceptAC(+d.dataset.i);
  });

  // F4: A1 → $A$1 → A$1 → $A1 → A1 sobre la referencia donde está el cursor
  function cycleAbs() {
    const inp = activeInput(), v = inp.value, pos = inp.selectionStart;
    const ref = Bx.findRefs(v).find(x => pos >= x.start && pos <= x.end);
    if (!ref) return;
    // A1: 4 estados; columna completa (A:A) o fila completa (1:1): solo alterna su único componente
    const kind = ref.a.kind;
    const ORDER = kind === 'col' ? [0, 2] : kind === 'row' ? [0, 1] : [0, 3, 1, 2];
    const st = kind === 'col' ? (ref.a.ca ? 2 : 0) : kind === 'row' ? (ref.a.ra ? 1 : 0) : (ref.a.ca ? 2 : 0) + (ref.a.ra ? 1 : 0);
    const ns = ORDER[(ORDER.indexOf(st) + 1) % ORDER.length];
    const fix = p => ({ ...p, ca: !!(ns & 2), ra: !!(ns & 1) });
    const txt = ref.sp + Bx.refText(fix(ref.a)) + (ref.b ? ':' + Bx.refText(fix(ref.b)) : '');
    inp.value = v.slice(0, ref.start) + txt + v.slice(ref.end);
    const end = ref.start + txt.length;
    inp.setSelectionRange(end, end);
    if (edit.refIns && edit.refIns.start === ref.start) edit.refIns.end = end; else edit.refIns = null;
    mirrorInput(inp);
    updateAssist();
  }

  // Modo "señalar": las flechas eligen la celda de la referencia; con Shift extienden el rango
  function pointMove(dr, dc, extend) {
    const inp = activeInput(), ri = edit.refIns && inp.selectionStart === edit.refIns.end ? edit.refIns : null;
    const cl = (r, c) => ({ r: Math.min(Math.max(0, r), sheet.rows - 1), c: Math.min(Math.max(0, c), sheet.cols - 1) });
    let p;
    if (!ri) { const base = wb.active === edit.si ? edit.A : A; p = cl(base.r + dr, base.c + dc); beginRefInsert(p.r, p.c); }
    else if (extend) { p = cl(ri.fr + dr, ri.fc + dc); updateRefInsert(p.r, p.c); }
    else { p = cl(ri.fr + dr, ri.fc + dc); ri.ar = p.r; ri.ac = p.c; updateRefInsert(p.r, p.c); }
    ensureVisible(p.r, p.c);
  }
  // Ctrl+Enter: escribe el mismo valor en toda la selección (las fórmulas se ajustan a cada celda)
  function fillSelectionWith(val, checked = false) {
    if (isFormula(val)) val = closeParens(val);
    if (rejectFormula(val)) return;
    // la validación de datos se revisa con la regla de la celda que se edita (la activa), como al confirmar con Enter
    if (!checked && dvReject(val, () => fillSelectionWith(val, true))) return;
    const home = edit.si, base = { ...edit.A };
    endEdit();
    if (wb.active !== home) showSheet(home);
    const g = range(), items = [], fh = filterHidden();
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
      if (fh && fh.has(r)) continue;   // con filtro activo, solo filas visibles (P0 2)
      const cell = clone(getCell(r, c)) || {}, s = effStyle(r, c);
      // misma lógica de entrada que el editor ("$1.500" + Ctrl+Enter → moneda en toda la selección, L-040)
      if (isFormula(val)) cell.v = shiftFormula(val, r - base.r, c - base.c); else entryCell(cell, val, s);
      if (val.includes('\n') && !s.wrap) cell.s = { ...(cell.s || {}), wrap: true };
      items.push({ r, c, cell });
    }
    applyChanges(items);
  }

  // ---------- Autofiltro ----------
  const fltBtns = document.createElement('div');
  fltBtns.id = 'fltBtns';
  $('#gridInner').appendChild(fltBtns);
  function drawFilterButtons() {
    const flt = sheet && sheet.filter;
    if (!flt) { fltBtns.innerHTML = ''; return; }
    let h = '';
    for (let c = flt.c1; c <= flt.c2; c++) {
      const R = rect({ r1: flt.r, c1: c, r2: flt.r, c2: c }), on = flt.crit && flt.crit[c];
      h += `<button class="fbtn${on ? ' on' : ''}" data-c="${c}" style="left:${R.left + R.width - 17}px;top:${R.top + 3}px" title="Filtrar">${on ? '⧩' : '▾'}</button>`;
    }
    fltBtns.innerHTML = h;
  }
  fltBtns.addEventListener('mousedown', e => {
    const b = e.target.closest('.fbtn');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (edit && !commitEdit()) return;
    openFilterPopup(+b.dataset.c, b.getBoundingClientRect());
  });
  function toggleFilter() {
    if (edit && !commitEdit()) return;
    if (sheet.filter) { delete sheet.filter; buildGrid(); rowsChanged(); scheduleSave(); return toast('Filtro quitado'); }
    const g = currentRegion(A.r, A.c);
    if (g.r1 === g.r2) return toast('Selecciona una celda dentro de una tabla con encabezados');
    sheet.filter = { r: g.r1, c1: g.c1, c2: g.c2, r2: g.r2, crit: {}, hidden: [] };
    buildGrid(); drawSel(); scheduleSave();
  }
  // Tras filtrar, ocultar o mostrar filas: SUBTOTALES/AGREGAR dependen de qué filas se ven (P0 3)
  function rowsChanged() { recalcAll(); paintAll(); drawSel(); }
  function applyFilter() {
    const flt = sheet.filter;
    flt.r2 = Math.max(flt.r2, currentRegion(flt.r, flt.c1).r2);   // incluye filas agregadas debajo
    flt.hidden = computeFilterHidden();
    wrap.scrollTop = Math.min(wrap.scrollTop, rowY(flt.r));
    buildGrid();
    if (isHidden(A.r)) setSel({ r: flt.r, c: A.c });
    rowsChanged();
    scheduleSave();
    filterStatus();
  }
  // "N de M registros encontrados" en la barra de estado, como Excel después de filtrar u ordenar con el filtro
  function filterStatus() {
    const flt = sheet.filter;
    if (!flt) return;
    const total = flt.r2 - flt.r, shown = total - (flt.hidden || []).filter(r => r > flt.r && r <= flt.r2).length;
    $('#status').innerHTML = `<span>${shown} de ${total} registros encontrados</span>`;
  }
  // Ctrl+Alt+L: volver a aplicar el filtro con sus criterios (las filas editadas se reevalúan)
  function reapplyFilter() { if (edit && !commitEdit()) return; if (!sheet.filter) return toast('No hay un filtro activo'); applyFilter(); }
  let fltPop = null;
  function closeFilterPopup() { if (fltPop) { fltPop.remove(); fltPop = null; } }
  function openFilterPopup(c, at) {
    closeFilterPopup();
    const flt = sheet.filter;
    flt.r2 = Math.max(flt.r2, currentRegion(flt.r, flt.c1).r2);
    const counts = new Map();
    for (let r = flt.r + 1; r <= flt.r2; r++) { const t = cellText(r, c); counts.set(t, (counts.get(t) || 0) + 1); }
    const values = [...counts.keys()].sort((a, b) => a === '' ? 1 : b === '' ? -1 : compareVals(literal(a) ?? a, literal(b) ?? b));
    const allowed = flt.crit[c] ? new Set(flt.crit[c]) : null;
    fltPop = document.createElement('div');
    fltPop.className = 'fltpop';
    fltPop.innerHTML = `
      <div class="fp-sort"><button data-a="asc">Ordenar de A a Z</button><button data-a="desc">Ordenar de Z a A</button><button data-a="custom">Orden personalizado…</button></div>
      <input class="fp-search" placeholder="Buscar">
      <div class="fp-list">
        <label class="fp-all"><input type="checkbox" checked> (Seleccionar todo)</label>
        ${values.map((v, i) => `<label data-t="${esc(v.toLowerCase())}"><input type="checkbox" data-i="${i}" ${!allowed || allowed.has(v) ? 'checked' : ''}> ${v === '' ? '(Vacías)' : esc(v)}</label>`).join('')}
      </div>
      <div class="fp-btns"><button data-a="ok">Aceptar</button><button data-a="cancel">Cancelar</button></div>`;
    document.body.appendChild(fltPop);
    fltPop.style.left = Math.min(at.left, innerWidth - fltPop.offsetWidth - 8) + 'px';
    fltPop.style.top = Math.min(at.bottom + 2, innerHeight - fltPop.offsetHeight - 8) + 'px';
    const boxes = [...fltPop.querySelectorAll('input[data-i]')], all = fltPop.querySelector('.fp-all input');
    const syncAll = () => { all.checked = boxes.every(b => b.checked); all.indeterminate = !all.checked && boxes.some(b => b.checked); };
    syncAll();
    all.onchange = () => boxes.forEach(b => { if (b.closest('label').style.display !== 'none') b.checked = all.checked; });
    boxes.forEach(b => { b.onchange = syncAll; });
    fltPop.querySelector('.fp-search').oninput = e => {
      const q = e.target.value.toLowerCase();
      boxes.forEach(b => { const l = b.closest('label'); const show = l.dataset.t.includes(q); l.style.display = show ? '' : 'none'; b.checked = show; });
      syncAll();
    };
    fltPop.addEventListener('click', e => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === 'cancel') return closeFilterPopup();
      if (a === 'asc' || a === 'desc') {
        // ordena la tabla (sin el encabezado) por la columna del filtro. Las filas filtradas no se mueven, así que no
        // se vuelve a aplicar el filtro: eso cambiaría filter.hidden fuera del registro de deshacer (L-033)
        closeFilterPopup();
        sortSel(a === 'desc', { r1: flt.r + 1, r2: Math.max(flt.r2, currentRegion(flt.r, flt.c1).r2), c1: flt.c1, c2: flt.c2 }, c);
        return filterStatus();
      }
      if (a === 'custom') {
        // cuadro Ordenar sobre el rango del filtro (encabezado fijo), con esta columna en el primer nivel
        closeFilterPopup();
        const p = openSortDialog({ r1: flt.r, r2: Math.max(flt.r2, currentRegion(flt.r, flt.c1).r2), c1: flt.c1, c2: flt.c2 }, c);
        if (p && p.then) p.then(filterStatus);
        return;
      }
      const chosen = boxes.filter(b => b.checked).map(b => values[+b.dataset.i]);
      if (chosen.length === values.length) delete flt.crit[c]; else flt.crit[c] = chosen;
      closeFilterPopup();
      applyFilter();
    });
  }
  document.addEventListener('mousedown', e => { if (fltPop && !fltPop.contains(e.target)) closeFilterPopup(); });

  // ---------- Imprimir / PDF ----------
  // Como Excel: imprime la selección (si hay más de una celda) o el área usada, sin cuadrícula,
  // con formatos y bordes. El diálogo del sistema permite "Guardar como PDF".
  function printSheet() {
    if (edit && !commitEdit()) return;
    let g = range();
    if (single(g)) {
      const e = usedExtent(true);   // área usada, con formato y desbordes
      if (e.r < 0) return toast('La hoja está vacía: no hay nada que imprimir');
      g = { r1: 0, c1: 0, r2: e.r, c2: e.c };
    }
    // como Excel: las filas y columnas ocultas (también las filtradas) no se imprimen; se respetan altos de fila,
    // fuentes y ajuste de texto; los valores desbordados se imprimen como cualquier valor
    let h = '<table><colgroup>';
    for (let c = g.c1; c <= g.c2; c++) if (!isHiddenCol(c)) h += `<col style="width:${colX[c + 1] - colX[c]}px">`;
    h += '</colgroup>';
    for (let r = g.r1; r <= g.r2; r++) {
      if (isHidden(r)) continue;
      h += Math.abs(rowH(r) - ROW_H) > 0.01 ? `<tr style="height:${rowH(r)}px">` : '<tr>';
      for (let c = g.c1; c <= g.c2; c++) {
        if (isHiddenCol(c)) continue;
        // con el formato condicional encima, como se ve en la hoja (Excel lo imprime)
        const cell = sheet.cells[addr(r, c)], s = withCf(effStyle(r, c), r, c);
        const v = eng.value(wb.active, r, c);   // incluye las celdas fantasma
        let css = fontCss(s);
        if (s.wrap && typeof v === 'string') css += 'white-space:pre-wrap;overflow-wrap:anywhere;';
        if (s.va && VA[s.va]) css += `vertical-align:${VA[s.va]};`;
        css += `text-align:${s.al || (typeof v === 'number' ? 'right' : typeof v === 'boolean' || v instanceof FErr ? 'center' : 'left')};`;
        if (s.bg) css += `background:${s.bg};`;
        if (s.fg) css += `color:${s.fg};`;
        for (const [k, side] of [['bt', 'top'], ['bb', 'bottom'], ['bl', 'left'], ['br', 'right']]) if (s[k]) css += `border-${side}:1px solid #000;`;
        if (s.bd) css += `border:1px solid ${s.bd};`;
        // barras de datos e íconos del formato condicional, como en la hoja
        const deco = s.bar || s.icon ? cfDeco(s) : '', txt = esc(display(v, { v: cell ? cell.v : '', s }));
        if (deco) css += 'position:relative;' + (s.icon ? `padding-left:${cfIconPx(s) + 6}px;` : '');
        h += `<td style="${css}">${deco ? deco + (cfHideValue(s) ? '' : `<span class="cfv">${txt}</span>`) : txt}</td>`;
      }
      h += '</tr>';
    }
    h += '</table>';
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(wb.name)} - ${esc(sheet.name)}</title><style>
      body { font: 10pt "Segoe UI", Arial, sans-serif; margin: 0; }
      table { border-collapse: collapse; table-layout: fixed; }
      td { padding: 1px 4px; height: 18px; white-space: nowrap; overflow: hidden; vertical-align: bottom; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { margin: 1.5cm; }
      ${CF_DECO_CSS}
    </style></head><body>${h}</body></html>`;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(frame);
    frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); };
    frame.srcdoc = doc;
  }

  // ---------- Bordes ----------
  function applyBorders(kind) {
    if (edit && !commitEdit()) return;
    const gs = allRanges();
    if (gs.reduce((n, g) => n + (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1), 0) > 50000) return toast('Selecciona un rango más pequeño para aplicar bordes');
    const items = [], fh = filterHidden();
    for (const g of gs) for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
      if (fh && fh.has(r)) continue;   // con filtro activo, solo filas visibles (P0 2)
      const cell = clone(getCell(r, c)) || { v: '' };
      const s = cell.s = { ...(cell.s || {}) };
      const top = r === g.r1, bot = r === g.r2, left = c === g.c1, right = c === g.c2;
      if (kind === 'none') { delete s.bt; delete s.bb; delete s.bl; delete s.br; }
      else if (kind === 'all') { s.bt = s.bb = s.bl = s.br = true; }
      else if (kind === 'outer') { if (top) s.bt = true; if (bot) s.bb = true; if (left) s.bl = true; if (right) s.br = true; }
      else if (kind === 'bottom' && bot) s.bb = true;
      else if (kind === 'top' && top) s.bt = true;
      else if (kind === 'left' && left) s.bl = true;
      else if (kind === 'right' && right) s.br = true;
      else if (kind === 'thickbottom' && bot) s.bb = true;
      items.push({ r, c, cell });
    }
    applyChanges(items);
  }
  function bordersMenu() {
    const b = $('[data-cmd="borders"]').getBoundingClientRect();
    showMenu({ clientX: b.left, clientY: b.bottom }, [
      ['Todos los bordes', () => applyBorders('all')], ['Borde exterior', () => applyBorders('outer')],
      ['Borde inferior', () => applyBorders('bottom')], ['Borde superior', () => applyBorders('top')],
      ['Borde izquierdo', () => applyBorders('left')], ['Borde derecho', () => applyBorders('right')],
      null, ['Sin borde', () => applyBorders('none')],
    ]);
  }

  // ---------- Decimales y millares ----------
  function changeDecimals(delta) {
    const cell = getCell(A.r, A.c), s = effStyle(A.r, A.c);
    const text = cell ? display(eng.value(wb.active, A.r, A.c), { v: cell.v, s }) : '';
    const cur = s.dec != null ? s.dec : ((/,(\d+)/.exec(text) || [, ''])[1].length);
    const dec = Math.min(10, Math.max(0, cur + delta));
    const fmt = autoFmt({ v: cell ? cell.v : '', s });
    styleSel(st => { st.dec = dec; if (!['number', 'currency', 'percent', 'scientific'].includes(fmt)) st.fmt = 'number'; });
  }

  // Formato automático al escribir, como Excel: "50%" → porcentaje, "$1.000" → moneda (con decimales: 2 fijos,
  // "$#,##0.00"), "1.234,5" → número con separador de miles y los decimales escritos
  function autoEntryFmt(val) {
    const t = String(val).trim();
    if (!t || isFormula(t) || t[0] === "'") return null;
    if (/^[+-]?(\d+([.,]\d+)?|[.,]\d+)\s?%$/.test(t)) return { v: t.replace(/\s/g, ''), fmt: 'percent' };
    const m = /^(-?)\s?\$\s?(-?)(\d{1,3}(\.\d{3})+(,\d+)?|\d+([.,]\d+)?)$/.exec(t);
    if (m) return { v: (m[1] || m[2] ? '-' : '') + m[3], fmt: 'currency', dec: m[5] || /,\d/.test(m[3]) ? 2 : null };
    const th = /^[+-]?\d{1,3}(\.\d{3})+(?:,(\d+))?$/.exec(t);
    if (th) return { v: t, fmt: 'number', dec: th[2] ? Math.min(10, th[2].length) : 0 };
    // notación científica es-CL (1e3, 1,5E-7): Excel aplica el formato Científico 0,00E+00 → 1,00E+03
    if (/^[+-]?(\d+(,\d+)?|,\d+)[eE][+-]?\d+$/.test(t) && typeof literal(t) === 'number') return { v: t, fmt: 'scientific', dec: null };
    return null;
  }
  // Texto escrito → contenido de celda. Es la única lógica de entrada (L-040): editor, Ctrl+Enter, pegar texto de
  // otra aplicación, abrir CSV y Reemplazar pasan por aquí. cell: copia de la celda de destino; s: su estilo efectivo.
  // Con formato General se aplica el formato detectado; con un formato de número propio se conserva el formato y se
  // guarda el número ("$1.500" en una celda Número → 1500). Las fechas y horas es-CL (01/01/2026, 14:30) quedan como
  // texto que el motor lee como fecha y autoFmt muestra como fecha.
  function entryCell(cell, val, s) {
    cell.v = val;
    const fmt = s && s.fmt && s.fmt !== 'general' ? s.fmt : null;
    if (fmt === 'text') return cell;
    const auto = autoEntryFmt(val);
    if (!auto) return cell;
    cell.v = auto.v;
    if (!fmt) {
      cell.s = { ...(cell.s || {}), fmt: auto.fmt };
      if (auto.dec != null) cell.s.dec = auto.dec; else delete cell.s.dec;
    }
    return cell;
  }
  // Cierra paréntesis olvidados, como hace Excel
  function closeParens(f) {
    let depth = 0, q = false;
    for (const ch of f) { if (ch === '"') q = !q; else if (!q) depth += ch === '(' ? 1 : ch === ')' ? -1 : 0; }
    return depth > 0 && !q ? f + ')'.repeat(depth) : f;
  }

  function canInsertRef() {
    const inp = activeInput(), v = inp.value;
    if (!v.startsWith('=')) return false;
    if (edit.refIns && inp.selectionStart === edit.refIns.end) return true;
    // la coma es decimal en es-CL: después de "1," se sigue escribiendo un número, no se señala una celda
    return /[=(+\-*/^&;<>:]$/.test(v.slice(0, inp.selectionStart).trimEnd());
  }
  function beginRefInsert(r, c) {
    const inp = activeInput();
    const start = edit.refIns && inp.selectionStart === edit.refIns.end ? edit.refIns.start : inp.selectionStart;
    edit.refIns = { start, end: edit.refIns && start === edit.refIns.start ? edit.refIns.end : start, ar: r, ac: c, fr: r, fc: c };
    updateRefInsert(r, c);
  }
  function updateRefInsert(r, c) {
    const inp = activeInput(), ri = edit.refIns;
    ri.fr = r; ri.fc = c;
    const pre = wb.active !== edit.si ? Bx.quoteSheet(sheet.name) + '!' : '';
    const txt = pre + (ri.ar === r && ri.ac === c ? addr(r, c)
      : `${addr(Math.min(ri.ar, r), Math.min(ri.ac, c))}:${addr(Math.max(ri.ar, r), Math.max(ri.ac, c))}`);
    inp.value = inp.value.slice(0, ri.start) + txt + inp.value.slice(ri.end);
    ri.end = ri.start + txt.length;
    inp.focus({ preventScroll: true });
    inp.setSelectionRange(ri.end, ri.end);
    mirrorInput(inp);
    updateAssist();
  }

  ed.addEventListener('input', () => { if (!edit) return; edit.refIns = null; fb.value = ed.value; sizeEditor(); updateAssist(); });
  ed.addEventListener('focus', () => { if (edit) edit.mode = 'cell'; });
  fb.addEventListener('focus', () => { if (!edit) startEdit(null, false, 'bar'); else edit.mode = 'bar'; });
  fb.addEventListener('input', () => { if (!edit) startEdit(fb.value, false, 'bar'); edit.refIns = null; ed.value = fb.value; sizeEditor(); updateAssist(); });
  for (const inp of [ed, fb]) {
    inp.addEventListener('keyup', e => { if (edit && !['Enter', 'Tab', 'Escape'].includes(e.key)) updateAssist(); });
    inp.addEventListener('click', () => { if (edit) updateAssist(); });
    inp.addEventListener('scroll', syncMirrors);
  }

  // ---------- Teclado ----------
  const DIRS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  document.addEventListener('keydown', e => {
    // AltGr (teclado español: @ \ [ { | ~ €) llega como Ctrl+Alt: no es un atajo, es un carácter. Pero si la tecla
    // da una letra o dígito ASCII (Ctrl+Alt+V, Ctrl+Alt+L) no hay carácter AltGr: es un atajo de Excel
    const altGr = (e.getModifierState && e.getModifierState('AltGraph') || (e.ctrlKey && e.altKey && e.key.length === 1)) && !/^[a-z0-9]$/i.test(e.key);
    const k = e.key, ctrl = (e.ctrlKey || e.metaKey) && !altGr, tgt = e.target;
    if (document.querySelector('dialog[open]')) return;
    if (dvPop && dvListKey(e)) return;   // lista desplegable de validación abierta: ↑/↓, Enter, Esc
    if (k === 'Escape') hideMenu();
    if (tgt === nameBox) {
      if (k === 'Enter') { e.preventDefault(); goToText(nameBox.value, true); }
      else if (k === 'Escape') { drawSel(); wrap.focus(); }
      else if (k === 'ArrowDown' && e.altKey) { e.preventDefault(); nameBoxMenu(); }   // Alt+↓ abre la lista de nombres
      return;
    }
    if (edit) {
      if (ac.items.length && (k === 'ArrowDown' || k === 'ArrowUp')) {
        e.preventDefault();
        ac.idx = (ac.idx + (k === 'ArrowDown' ? 1 : -1) + ac.items.length) % ac.items.length;
        [...acList.children].forEach((d, j) => d.classList.toggle('on', j === ac.idx));
        acList.children[ac.idx].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (ac.items.length && k === 'Tab') { e.preventDefault(); acceptAC(); return; }
      if (ac.items.length && k === 'Escape') { e.preventDefault(); hideAssist(); return; }
      if (k === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey) {
        // Alt+Enter: salto de línea dentro de la celda (en el editor o en la barra de fórmulas)
        e.preventDefault();
        const inp = activeInput();
        inp.setRangeText('\n', inp.selectionStart, inp.selectionEnd, 'end');
        inp.dispatchEvent(new Event('input'));
      }
      else if (k === 'Enter' && ctrl) { e.preventDefault(); fillSelectionWith(activeInput().value); }
      else if (k === 'Enter' && !e.altKey) { e.preventDefault(); const back = e.shiftKey; commitEdit(0, 0, false, () => tabOrEnter(false, back)); }
      else if (k === 'Tab') { e.preventDefault(); const back = e.shiftKey; commitEdit(0, 0, false, () => tabOrEnter(true, back)); }
      else if (k === 'Escape') { e.preventDefault(); cancelEdit(); }
      else if (k === 'F4') { e.preventDefault(); cycleAbs(); }
      else if (k === 'F3' && !ctrl) { e.preventDefault(); pasteNameDialog(); }   // F3: pegar un nombre en el cursor
      else if (k === 'F3') e.preventDefault();   // Ctrl+F3 no está disponible mientras se edita (como Excel)
      else if (k === 'F2') { e.preventDefault(); edit.typed = !edit.typed; toast(edit.typed ? 'Modo Introducir: las flechas señalan celdas' : 'Modo Modificar: las flechas mueven el cursor'); }
      else if (DIRS[k] && edit.typed && isFormulaText(activeInput().value) && canInsertRef()) { e.preventDefault(); pointMove(...DIRS[k], e.shiftKey); }
      else if (DIRS[k] && edit.typed && edit.mode === 'cell' && wb.active === edit.si) { e.preventDefault(); commitEdit(...DIRS[k]); }
      return;
    }
    if (tgt !== wrap && tgt !== document.body && tgt.matches('input, select, textarea, button')) return;
    // Alt+Mayús+F10: abre el menú del indicador de error (#¡DESBORDAMIENTO!), como en Excel
    if (k === 'F10' && e.altKey && e.shiftKey) { e.preventDefault(); spillMenu(); return; }
    if (ctrl && e.altKey) {
      // Ctrl+Alt+V: Pegado especial · Ctrl+Alt+L: volver a aplicar el filtro; otro Ctrl+Alt+letra no escribe nada
      const actAlt = { v: pasteSpecialMenu, l: reapplyFilter }[k.toLowerCase()];
      if (actAlt || /^[a-z0-9]$/i.test(k)) e.preventDefault();
      if (actAlt) actAlt();
      return;
    }
    if (ctrl) {
      if (DIRS[k]) { e.preventDefault(); jump(...DIRS[k], e.shiftKey); return; }
      // Atajos de Excel en español (decisión del usuario): N/K/S formato, G guardar, A abrir, U nuevo, E seleccionar
      // todo, J/D rellenar abajo/derecha, B buscar, L reemplazar, I ir a. Ctrl+2/3/4 por si el navegador reserva Ctrl+N.
      const act = {
        z: e.shiftKey ? redo : undo, y: redo,
        n: () => toggleStyle('b'), 2: () => toggleStyle('b'), k: () => toggleStyle('i'), 3: () => toggleStyle('i'),
        s: () => toggleStyle('u'), 4: () => toggleStyle('u'),
        g: () => saveFile(e.shiftKey), a: openFile, u: newWorkbookCmd, e: selectAll,
        j: () => fillCopy('down'), d: () => fillCopy('right'),
        b: () => openFind(false), l: e.shiftKey ? toggleFilter : () => openFind(true), i: goToDialog,
        p: printSheet, home: () => setSel({ r: 0, c: 0 }),
        end: () => ctrlEnd(e.shiftKey),
        ' ': () => selectEntire(false),   // Ctrl+Espacio: columnas completas, la celda activa no cambia
        // Agrandar / achicar fuente: se lee e.key (no la tecla física), así funciona con teclado español
        // (Ctrl+Mayús+< da '>', Ctrl+< da '<') y con teclado inglés (Ctrl+Shift+. / Ctrl+Shift+,)
        '>': () => stepFontSize(1), '<': () => stepFontSize(-1),
        pagedown: () => { if (wb.active < wb.sheets.length - 1) switchSheet(wb.active + 1); },
        pageup: () => { if (wb.active > 0) switchSheet(wb.active - 1); },
        ';': () => { const d = new Date(); startEdit(`${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`, true); },  // Ctrl+; fecha de hoy
        ':': () => { const d = new Date(); startEdit(`${p2(d.getHours())}:${p2(d.getMinutes())}`, true); },  // Ctrl+Shift+: hora actual
        '-': () => structMenu(false), '+': () => structMenu(true),
        // Ctrl+F3: Administrador de nombres · Ctrl+Mayús+F3: Crear nombres a partir de la selección
        f3: e.shiftKey ? createNamesDialog : openNameManager,
      }[k.toLowerCase()];
      if (act) { e.preventDefault(); act(); }
      return;
    }
    // Alt+↓: abre la lista desplegable de la validación de datos de la celda activa (como Excel)
    if (k === 'ArrowDown' && e.altKey) { e.preventDefault(); openDvList(); return; }
    if (DIRS[k]) { e.preventDefault(); move(...DIRS[k], e.shiftKey); return; }
    if (k === ' ' && e.shiftKey) { e.preventDefault(); selectEntire(true); return; }   // Shift+Espacio: filas completas, la celda activa no cambia
    switch (k) {
      case 'Enter': if (!e.altKey) tabOrEnter(false, e.shiftKey); break;
      case 'Tab': tabOrEnter(true, e.shiftKey); break;
      case 'Delete': clearContents(); break;
      case 'Backspace': startEdit('', true); break;   // como Excel: vacía la celda activa y entra a editarla
      case 'F2': startEdit(null, false); break;
      case 'F3': pasteNameDialog(); break;      // Pegar nombre: empieza "=Nombre" en la celda activa
      case 'F5': goToDialog(); break;           // Ir a (en el navegador F5 recargaría la página)
      case 'F12': saveFile(true); break;        // Guardar como
      case 'Home': setSel({ r: A.r, c: 0 }); break;
      case 'PageDown': move(20, 0, e.shiftKey); break;
      case 'PageUp': move(-20, 0, e.shiftKey); break;
      case 'Escape': clip = null; drawClip(); break;
      default:
        if (k.length === 1 && (!e.altKey || altGr)) { e.preventDefault(); startEdit(k, true); }
        return;
    }
    e.preventDefault();
  });

  // ---------- Ratón ----------
  const cellOf = el => {
    const td = el && el.closest && el.closest('#grid td');
    return td && td.parentNode.dataset.r != null ? { r: +td.parentNode.dataset.r, c: td.cellIndex - 1 } : null;
  };
  const inSel = p => { const g = range(); return p.r >= g.r1 && p.r <= g.r2 && p.c >= g.c1 && p.c <= g.c2; };

  wrap.addEventListener('mousedown', e => {
    hideMenu();
    if (e.target === $('#fillHandle')) { e.preventDefault(); if (edit && !commitEdit()) return; drag = { type: 'fill', src: range(), tgt: range() }; return; }
    const rz = e.target.closest('.rz');
    if (rz) { e.preventDefault(); const c = +rz.dataset.c; drag = { type: 'rz', c, x: e.clientX, w: colX[c + 1] - colX[c] || DEF_W, before: sheet.colW[c] }; return; }
    // Borde inferior del encabezado de fila: arrastrar cambia el alto (doble clic autoajusta)
    const rzr = e.target.closest('.rzr');
    if (rzr && e.button === 0) {
      e.preventDefault();
      if (edit && !commitEdit()) return;
      const r = +rzr.dataset.r;
      drag = { type: 'rzr', r, y: e.clientY, h: rowH(r), before: sheet.rowH ? sheet.rowH[r] : undefined, cur: null };
      return;
    }
    const p = cellOf(e.target);
    if (p) {
      if (e.button !== 0) { if (!inSel(p)) { if (edit && !commitEdit()) return; setSel(p, p, false); } return; }
      if (edit && canInsertRef()) { e.preventDefault(); beginRefInsert(p.r, p.c); drag = { type: 'ref' }; return; }
      if (edit && !commitEdit()) return;
      e.preventDefault();
      wrap.focus({ preventScroll: true });
      const mg = mergeAt(p.r, p.c);
      if (e.shiftKey) setSel(A, p, false, true);
      else if (e.ctrlKey || e.metaKey) { extra.push(range()); setSel(p, p, false, true); }   // Ctrl+clic: agrega un rango
      else if (mg) setSel({ r: mg.r1, c: mg.c1 }, { r: mg.r2, c: mg.c2 }, false);          // clic en una combinación: se selecciona entera
      else setSel(p, p, false);
      drag = { type: 'sel' };
      return;
    }
    const th = e.target.closest('#grid th');
    if (!th) return;
    if (e.button === 2) {
      // Clic derecho en un encabezado: si la fila o columna no está dentro de la selección, se selecciona
      // (como Excel); si ya lo está, la selección se conserva para el menú contextual
      if (edit && !commitEdit()) return;
      const inAny = t => allRanges().some(t);
      if (th.dataset.c != null) {
        const c = +th.dataset.c;
        if (!inAny(g => isFullCols(g) && c >= g.c1 && c <= g.c2)) setSel({ r: 0, c }, { r: sheet.rows - 1, c }, false, false, { r: topVisRow(), c });
      } else if (th.classList.contains('rh') && th.parentNode.dataset.r != null) {
        const r = +th.parentNode.dataset.r;
        if (!inAny(g => isFullRows(g) && r >= g.r1 && r <= g.r2)) setSel({ r, c: 0 }, { r, c: sheet.cols - 1 }, false, false, { r, c: leftVisCol() });
      }
      return;
    }
    if (e.button !== 0) return;
    if (edit && !commitEdit()) return;
    e.preventDefault();
    wrap.focus({ preventScroll: true });
    // Encabezados (como Excel): clic selecciona la columna o fila completa con la celda activa en la primera
    // celda visible; Shift+clic extiende desde la celda activa; Ctrl+clic agrega columnas o filas a la
    // selección múltiple; arrastrar (también con Ctrl) extiende sobre varios encabezados
    const ctrlKey = e.ctrlKey || e.metaKey;
    if (th.classList.contains('corner')) selectAll();
    else if (th.dataset.c != null) {
      const c = +th.dataset.c;
      if (e.shiftKey) setSel({ r: 0, c: A.c }, { r: sheet.rows - 1, c }, false, false, A);
      else {
        if (ctrlKey) extra.push(range());
        setSel({ r: 0, c }, { r: sheet.rows - 1, c }, false, ctrlKey, { r: topVisRow(), c });
      }
      drag = { type: 'col' };
    } else if (th.parentNode.dataset.r != null) {
      const r = +th.parentNode.dataset.r;
      if (e.shiftKey) setSel({ r: A.r, c: 0 }, { r, c: sheet.cols - 1 }, false, false, A);
      else {
        if (ctrlKey) extra.push(range());
        setSel({ r, c: 0 }, { r, c: sheet.cols - 1 }, false, ctrlKey, { r, c: leftVisCol() });
      }
      drag = { type: 'row' };
    }
  });

  // Desplazamiento automático al arrastrar fuera del área visible (selección, relleno, referencias)
  let lastPt = null, autoScrollTimer = null;
  function autoScrollTick() {
    if (!drag || !['sel', 'fill', 'ref', 'col', 'row'].includes(drag.type) || !lastPt) { clearInterval(autoScrollTimer); autoScrollTimer = null; return; }
    const R = wrap.getBoundingClientRect();
    const dx = lastPt.x > R.right - 12 ? 30 : lastPt.x < R.left + HEAD_W ? -30 : 0;
    const dy = lastPt.y > R.bottom - 12 ? ROW_H : lastPt.y < R.top + HEAD_H ? -ROW_H : 0;
    if (!dx && !dy) return;
    wrap.scrollLeft += dx; wrap.scrollTop += dy;
    renderRows(false);
    const x = Math.min(Math.max(lastPt.x, R.left + HEAD_W + 2), R.right - 20), y = Math.min(Math.max(lastPt.y, R.top + HEAD_H + 2), R.bottom - 20);
    onDragMove({ target: document.elementFromPoint(x, y), clientX: lastPt.x });
  }
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    lastPt = { x: e.clientX, y: e.clientY };
    if (!autoScrollTimer) autoScrollTimer = setInterval(autoScrollTick, 60);
    onDragMove(e);
  });
  function onDragMove(e) {
    if (!drag || !e.target) return;
    if (drag.type === 'rz') {
      const w = Math.max(24, drag.w + e.clientX - drag.x);
      colEls[drag.c].style.width = w + 'px';
      sheet.colW[drag.c] = w;
      computeColX();
      drawSel();
      if (e.clientX != null && e.clientY != null) showSizeTip(e, `Ancho: ${fmtPtNum(Math.max(0, Math.round((w - 5) / 7 * 100) / 100))} (${Math.round(w)} píxeles)`);
      return;
    }
    if (drag.type === 'rzr') {
      // vista previa en vivo de la fila arrastrada; el cambio con deshacer se registra al soltar
      if (e.clientY == null) return;
      const h = Math.max(0, Math.round(drag.h + e.clientY - drag.y));
      // sin cambio real no se redibuja: reemplazar la fila bajo el puntero rompe el doble clic del navegador (L-031)
      if (drag.cur == null && Math.abs(e.clientY - drag.y) < 3) return;   // temblor del ratón durante un doble clic
      if (h === drag.cur || (drag.cur == null && h === Math.round(drag.h))) return;
      drag.cur = h;
      sheet.rowH = sheet.rowH || {};
      sheet.rowH[drag.r] = Math.max(1, h);
      buildRowIndex();
      renderRows(true);
      drawSel();
      showSizeTip(e, `Alto: ${pxToPt(h)} (${h} píxeles)`);
      return;
    }
    if (drag.type === 'col' || drag.type === 'row') {
      const th = e.target.closest && e.target.closest('#grid th');
      if (!th) return;
      // el ancla (primer encabezado) y la celda activa no cambian; Ctrl+arrastrar conserva los demás rangos
      if (drag.type === 'col' && th.dataset.c != null) setSel(anchor(), { r: sheet.rows - 1, c: +th.dataset.c }, false, true, A);
      if (drag.type === 'row' && th.classList.contains('rh') && th.parentNode.dataset.r != null) setSel(anchor(), { r: +th.parentNode.dataset.r, c: sheet.cols - 1 }, false, true, A);
      return;
    }
    const p = cellOf(e.target);
    if (!p) return;
    if (drag.type === 'sel') { if (p.r !== F.r || p.c !== F.c) setSel(A, p, false, true); }
    else if (drag.type === 'ref') updateRefInsert(p.r, p.c);
    else if (drag.type === 'fill') {
      const g = drag.src, t = { ...g };
      const dv = p.r > g.r2 ? p.r - g.r2 : p.r < g.r1 ? p.r - g.r1 : 0;
      const dh = p.c > g.c2 ? p.c - g.c2 : p.c < g.c1 ? p.c - g.c1 : 0;
      if (Math.abs(dv) >= Math.abs(dh)) { if (dv > 0) t.r2 = p.r; else if (dv < 0) t.r1 = p.r; }
      else { if (dh > 0) t.c2 = p.c; else t.c1 = p.c; }
      drag.tgt = t;
      place(fillBox, t);
      fillBox.style.display = 'block';
    }
  }

  document.addEventListener('mouseup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.type === 'rz') {
      hideSizeTip();
      if (sheet.colW[d.c] !== d.before) pushUndo({ colw: true, si: wb.active, c: d.c, before: d.before, after: sheet.colW[d.c] });
      if (syncHeights()) renderRows(true);   // el texto ajustado de esa columna puede ocupar más o menos líneas
      drawSel(); scheduleSave();
    }
    if (d.type === 'rzr') {
      hideSizeTip();
      // sin arrastre (clic o primer clic de un doble clic) no se toca el DOM, para que llegue el dblclick
      if (d.cur == null) return;
      // se deshace la vista previa y se aplica el alto (a todas las filas completas seleccionadas que incluyan la arrastrada)
      putRowH({ [d.r]: d.before });
      if (d.cur !== Math.round(d.h)) setRowHeights(heightTargets(d.r), d.cur);
      buildRowIndex(); renderRows(true); drawSel();
    }
    if (d.type === 'fill') {
      fillBox.style.display = 'none';
      if (JSON.stringify(d.src) !== JSON.stringify(d.tgt)) doFill(d.src, d.tgt, true);
    }
  });

  // Doble clic en el controlador de relleno: rellena hacia abajo tantas filas como datos haya en la columna vecina
  function autoFillDown() {
    const g = range();
    const has = (r, c) => c >= 0 && c < sheet.cols && r < sheet.rows && hasData(r, c);   // una columna desbordada también guía el relleno
    const side = has(g.r2 + 1, g.c1 - 1) ? g.c1 - 1 : has(g.r2 + 1, g.c2 + 1) ? g.c2 + 1 : null;
    if (side == null) return;
    let r = g.r2 + 1;
    while (has(r + 1, side)) r++;
    doFill(g, { ...g, r2: r }, true);
  }

  wrap.addEventListener('dblclick', e => {
    if (e.target === $('#fillHandle')) { if (edit && !commitEdit()) return; autoFillDown(); return; }
    const p = cellOf(e.target);
    if (p && !edit) { setSel(p, p, false); startEdit(null, false); }
    const rz = e.target.closest('.rz');
    if (rz) autoFitColumn(+rz.dataset.c);
    const rzr = e.target.closest('.rzr');
    if (rzr) autoFitRows(+rzr.dataset.r);   // doble clic en el borde de la fila: alto automático
  });

  wrap.addEventListener('contextmenu', e => {
    if (!e.target.closest('#grid')) return;
    e.preventDefault();
    showMenu(e, [
      ['Cortar', () => document.execCommand('cut')],
      ['Copiar', () => document.execCommand('copy')],
      ['Pegar', pasteFromMenu],
      ['Pegar valores', () => pasteSpecial('values')], ['Pegar formato', () => pasteSpecial('formats')],
      ['Pegar transpuesto', () => pasteSpecial('transpose')],
      null,
      ['Insertar filas', insertRows], ['Eliminar filas', deleteRows],
      ['Insertar columnas', insertCols], ['Eliminar columnas', deleteCols],
      null,
      ['Ocultar filas', () => setHidden('R', true)], ['Mostrar filas', () => setHidden('R', false)],
      ['Ocultar columnas', () => setHidden('C', true)], ['Mostrar columnas', () => setHidden('C', false)],
      ['Alto de fila…', rowHeightDialog],
      null,
      ['Borrar contenido', clearContents], ['Borrar formato', clearFormats], ['Borrar todo', clearAll],
      ['Ordenar A → Z', () => sortSel(false)], ['Ordenar Z → A', () => sortSel(true)], ['Orden personalizado…', () => openSortDialog()],
      null,
      ['Definir nombre…', () => openNameEditor(null)],
    ]);
  });

  // Autoajustar ancho: se mide con canvas usando la fuente efectiva de cada celda (la línea más larga si hay saltos)
  function autoFitColumn(c) {
    let w = 40;
    for (const [k, cell] of Object.entries(sheet.cells)) {
      const p = parseAddr(k);
      if (p.c !== c || isHidden(p.r)) continue;
      const s = effStyle(p.r, p.c), text = display(eng.value(wb.active, p.r, p.c), { v: cell.v, s });
      if (!text) continue;
      for (const line of text.split('\n')) w = Math.max(w, Math.ceil(textWidth(line, s)) + 12);
    }
    // valores desbordados de la columna (celdas fantasma)
    for (const { r } of ghostsIn({ r1: 0, c1: c, r2: sheet.rows - 1, c2: c })) {
      if (isHidden(r) || sheet.cells[addr(r, c)]) continue;   // las que tienen solo formato ya se midieron arriba
      const s = effStyle(r, c), text = display(eng.value(wb.active, r, c), { v: '', s });
      if (text) w = Math.max(w, Math.ceil(textWidth(text, s)) + 12);
    }
    pushUndo({ colw: true, si: wb.active, c, before: sheet.colW[c], after: Math.min(500, w) });
    sheet.colW[c] = Math.min(500, w);
    colEls[c].style.width = sheet.colW[c] + 'px';
    computeColX();
    if (syncHeights()) renderRows(true);
    drawSel();
    scheduleSave();
  }

  // ---------- Menú contextual y avisos ----------
  const menu = $('#menu');
  // Submenú (Formato condicional ▸ Reglas para resaltar celdas ▸ …): se abre al pasar el ratón o al hacer clic
  const menu2 = document.createElement('div');
  menu2.id = 'menu2'; menu2.className = 'menu';
  document.body.appendChild(menu2);
  // items: [texto, acción, { disabled, head, sub }] o null (separador). Sin acción o con disabled: opción deshabilitada
  // (gris, no hace nada); head: título del menú (indicador de error); sub: opciones del submenú (▸)
  function fillMenu(el, items, isSub) {
    el.innerHTML = '';
    for (const it of items) {
      if (!it) { el.appendChild(document.createElement('hr')); continue; }
      const d = document.createElement('div'), o = it[2] || {};
      // html: muestra fija antes del texto (galerías del formato condicional); hover: vista previa al pasar el ratón
      if (o.html) { d.innerHTML = o.html; d.appendChild(document.createTextNode(it[0])); } else d.textContent = it[0];
      if (o.hover) { d.addEventListener('mouseenter', o.hover); d.addEventListener('mouseleave', o.unhover); }
      d.onmousedown = ev => ev.preventDefault();
      if (o.head) d.className = 'head';
      else if (o.sub && !o.disabled) { d.className = 'sub'; d.onmouseenter = d.onclick = () => openSubMenu(d, o.sub); }
      else if (o.disabled || !it[1]) { d.className = 'dis'; d.setAttribute('aria-disabled', 'true'); if (o.title) d.title = o.title; }
      else d.onclick = () => { hideMenu(); it[1](); };
      if (!isSub && !(o.sub && !o.disabled)) d.addEventListener('mouseenter', hideSubMenu);
      el.appendChild(d);
    }
  }
  function showMenu(e, items) {
    hideSubMenu();
    fillMenu(menu, items, false);
    menu.style.display = 'block';
    menu.style.left = Math.min(e.clientX, innerWidth - menu.offsetWidth - 4) + 'px';
    menu.style.top = Math.min(e.clientY, innerHeight - menu.offsetHeight - 4) + 'px';
  }
  function openSubMenu(from, items) {
    if (menu2.style.display === 'block' && menu2._from === from) return;
    fillMenu(menu2, items, true);
    menu2._from = from;
    menu.querySelectorAll('div.open').forEach(x => x.classList.remove('open'));
    from.classList.add('open');
    menu2.style.display = 'block';
    const b = from.getBoundingClientRect();
    const x = b.right + menu2.offsetWidth > innerWidth - 4 ? b.left - menu2.offsetWidth + 2 : b.right - 2;
    menu2.style.left = Math.max(0, x) + 'px';
    menu2.style.top = Math.max(0, Math.min(b.top - 5, innerHeight - menu2.offsetHeight - 4)) + 'px';
  }
  function hideSubMenu() { menu2.style.display = 'none'; menu2._from = null; menu.querySelectorAll('div.open').forEach(x => x.classList.remove('open')); cfHoverOff(); }
  function hideMenu() { menu.style.display = 'none'; hideSubMenu(); }
  document.addEventListener('mousedown', e => { if (!menu.contains(e.target) && !menu2.contains(e.target)) hideMenu(); });

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- Copiar / cortar / pegar ----------
  const isOtherInput = t => t && t !== wrap && t.matches && t.matches('input, textarea, select');
  // Texto del portapapeles: lo que se ve en cada celda (también los valores desbordados), solo de las filas copiadas
  function selectionTSV(g, rows) {
    const lines = [];
    for (const r of rows) {
      const row = [];
      for (let c = g.c1; c <= g.c2; c++) {
        const cell = getCell(r, c);
        let t = display(eng.value(wb.active, r, c), { v: cell ? cell.v : '', s: effStyle(r, c) });
        if (/[\t\n"]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
        row.push(t);
      }
      lines.push(row.join('\t'));
    }
    return lines.join('\r\n');
  }
  // Contenido de una celda al copiarla o rellenar desde ella dentro del área g. Una celda fantasma no tiene contenido
  // propio: se copia su valor (como Excel), salvo que el ancla también esté en g (la fórmula vuelve a desbordar)
  function copyCell(r, c, g) {
    const x = getCell(r, c);
    if (x && x.v !== '') return clone(x);
    const sp = ghostOf(r, c);
    if (!sp || inArea(g, sp.anchor.r, sp.anchor.c)) return clone(x);
    return { ...(clone(x) || {}), v: Bx.toRaw(eng.value(wb.active, r, c)) };
  }
  function doCopy(dt, cut) {
    if (extra.length) return toast('Copiar y cortar no funcionan con selecciones múltiples');
    const g = range();
    // Con un filtro activo, Copiar toma solo las filas visibles (como Excel); las ocultas a mano sí se copian.
    // Cortar mueve el bloque completo.
    const fh = cut ? null : filterHidden(), rows = [];
    for (let r = g.r1; r <= g.r2; r++) if (!fh || !fh.has(r)) rows.push(r);
    // cortar mueve el contenido propio (una celda fantasma no tiene: su valor se recalcula donde quede el ancla)
    const cells = rows.map(r => { const row = []; for (let c = g.c1; c <= g.c2; c++) row.push(cut ? clone(getCell(r, c)) : copyCell(r, c, g)); return row; });
    const text = selectionTSV(g, rows);
    // rows: fila de origen de cada fila copiada (para ajustar las fórmulas al pegar); box: área marcada con hormigas
    clip = { si: wb.active, r1: g.r1, c1: g.c1, h: rows.length, w: g.c2 - g.c1 + 1, cells, text, cut, rows, box: { ...g } };
    // reglas de validación de lo copiado (se pegan con Pegar); sin ellas si se saltaron filas filtradas
    if (!cut && rows.length === g.r2 - g.r1 + 1) clip.dv = dvPieces(sheet, g);
    // y las de formato condicional (Pegar y Pegado especial ▸ Formatos las pegan)
    if (!cut && rows.length === g.r2 - g.r1 + 1) clip.cf = cfPieces(sheet, g);
    if (dt) dt.setData('text/plain', text);
    drawClip();
  }
  const clipRow = (cp, i) => cp.rows ? cp.rows[i] : cp.r1 + i;
  document.addEventListener('copy', e => { if (edit || isOtherInput(e.target)) return; e.preventDefault(); doCopy(e.clipboardData, false); });
  document.addEventListener('cut', e => { if (edit || isOtherInput(e.target)) return; e.preventDefault(); doCopy(e.clipboardData, true); });
  document.addEventListener('paste', e => {
    if (edit || isOtherInput(e.target)) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  });
  async function pasteFromMenu() {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch { /* sin permiso: usar portapapeles interno */ }
    if (text == null && clip) text = clip.text;
    if (text != null) pasteText(text);
  }

  function pasteText(text) {
    const g = range();
    if (clip && text.replace(/\r/g, '') === clip.text.replace(/\r/g, '')) return pasteInternal(g);
    let rows = parseDelimited(text, '\t');
    if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    if (!rows.length) return;
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const tile = h === 1 && w === 1 && !single(g);
    const R = tile ? g.r2 - g.r1 + 1 : h, C = tile ? g.c2 - g.c1 + 1 : w;
    if (ensureSize(g.r1 + R - 1, g.c1 + C - 1)) paintAll();
    const items = [];
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const r = g.r1 + i, c = g.c1 + j;
      // texto de otra aplicación: misma lógica de entrada que escribir ($1.500 → moneda, 50% → porcentaje, L-040)
      const cell = entryCell(clone(getCell(r, c)) || {}, tile ? rows[0][0] : (rows[i][j] ?? ''), effStyle(r, c));
      items.push({ r, c, cell });
    }
    applyChanges(items);
    setSel({ r: g.r1, c: g.c1 }, { r: g.r1 + R - 1, c: g.c1 + C - 1 }, false);
  }
  // Pegado especial (desde lo copiado en Bassxcel): fórmulas, solo valores, solo formato o transpuesto
  function pasteSpecial(mode) {
    if (edit && !commitEdit()) return;
    if (!clip) return toast('Primero copia celdas (Ctrl+C)');
    // como Excel: después de Cortar solo se puede Pegar (mover)
    if (clip.cut) return toast('Pegado especial no está disponible después de Cortar: usa Pegar (Ctrl+V)');
    const cp = clip, g = range(), tr = mode === 'transpose';
    const H = tr ? cp.w : cp.h, W = tr ? cp.h : cp.w;
    if (ensureSize(g.r1 + H - 1, g.c1 + W - 1)) paintAll();
    const items = [];
    for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
      const si = tr ? j : i, sj = tr ? i : j, src = cp.cells[si][sj], sr = clipRow(cp, si), sc = cp.c1 + sj;
      const r = g.r1 + i, c = g.c1 + j, cell = clone(getCell(r, c)) || { v: '' };
      if (mode === 'values') {
        const v = eng.value(cp.si, sr, sc);
        // toRaw: número con coma decimal (3,234 no se relee como 3234, P0 1); los errores con su nombre en español
        cell.v = Bx.toRaw(v);   // los errores salen como #N/D, #¡DIV/0!… y se releen como error
      } else if (mode === 'formulas') {
        // Fórmulas: fórmulas (ajustadas al destino) y constantes, con el formato del destino (como Excel)
        cell.v = !src ? '' : isFormula(src.v) ? shiftFormula(src.v, r - sr, c - sc) : src.v;
      } else if (mode === 'formats') {
        cell.s = src && src.s ? clone(src.s) : undefined;
      } else {
        const n = clone(src);
        if (n && isFormula(n.v)) n.v = shiftFormula(n.v, r - sr, c - sc);
        items.push({ r, c, cell: n });
        continue;
      }
      items.push({ r, c, cell });
    }
    // Formatos también pega el formato condicional de lo copiado (como Excel) y reemplaza el del destino
    const cf = mode === 'formats' && cp.cf ? cfPaste(sheet.cf || [], cp.cf, { r1: g.r1, c1: g.c1, r2: g.r1 + H - 1, c2: g.c1 + W - 1 }, [[g.r1 - cp.r1, g.c1 - cp.c1]]) : undefined;
    applyChanges(items, { cf });
    setSel({ r: g.r1, c: g.c1 }, { r: g.r1 + H - 1, c: g.c1 + W - 1 }, false);
  }

  // Cortar + pegar = mover (como Excel): las fórmulas que apuntaban al área movida pasan a apuntar al destino
  function cutPaste(cp, g) {
    const src = wb.sheets[cp.si], dst = sheet, dr = g.r1 - cp.r1, dc = g.c1 - cp.c1;
    if (ensureSize(g.r1 + cp.h - 1, g.c1 + cp.w - 1)) paintAll();
    snapshotOp(() => {
      for (let i = 0; i < cp.h; i++) for (let j = 0; j < cp.w; j++) delete src.cells[addr(cp.r1 + i, cp.c1 + j)];
      for (let i = 0; i < cp.h; i++) for (let j = 0; j < cp.w; j++) setKey(dst, addr(g.r1 + i, g.c1 + j), normCell(clone(cp.cells[i][j])));
      // la validación de datos se mueve con las celdas (sus fórmulas siguen apuntando a las mismas celdas, como al
      // cortar una fórmula): sale del origen y reemplaza la del destino
      const box = { r1: cp.r1, c1: cp.c1, r2: cp.r1 + cp.h - 1, c2: cp.c1 + cp.w - 1 }, to = { r1: g.r1, c1: g.c1, r2: g.r1 + cp.h - 1, c2: g.c1 + cp.w - 1 };
      const moved = dvPieces(src, box).map(d => dvMove(d, dr, dc, false));
      setDv(src, dvRemove(src.dv || [], [box]));
      setDv(dst, dvAddAll(dvRemove(dst.dv || [], [to]), moved));
      // el formato condicional también se mueve con las celdas (como Excel)
      const movedCf = cfPieces(src, box).map(d => dvMove(d, dr, dc, false));
      setCf(src, dvRemove(src.cf || [], [box]));
      setCf(dst, cfAddAll(dvRemove(dst.cf || [], [to]), movedCf));
      const srcName = src.name.toLowerCase();
      const inside = (sh, p) => sh === srcName && p.r >= cp.r1 && p.r < cp.r1 + cp.h && p.c >= cp.c1 && p.c < cp.c1 + cp.w;
      const mv = p => ({ ...p, r: p.r + dr, c: p.c + dc });
      // referencias de f que caen enteras en el área movida → al destino. home: hoja de las referencias sin hoja
      // (null: no se mueven); pre: prefijo de hoja del destino
      const moveRefs = (f, home, pre) => {
        let out = '', pos = 0, touched = false;
        for (const ref of Bx.findRefs(f)) {
          const sh = (ref.sheet ?? home ?? '').toLowerCase();
          if (!inside(sh, ref.a) || !inside(sh, ref.b || ref.a)) continue;
          out += f.slice(pos, ref.start) + pre + Bx.refText(mv(ref.a)) + (ref.b ? ':' + Bx.refText(mv(ref.b)) : '');
          pos = ref.end; touched = true;
        }
        return touched ? out + f.slice(pos) : f;
      };
      for (const s of wb.sheets) for (const cell of Object.values(s.cells)) {
        if (isFormula(cell.v)) cell.v = moveRefs(cell.v, s.name, s === dst ? '' : Bx.quoteSheet(dst.name) + '!');
      }
      // como Excel, un rango con nombre que estaba entero en el área movida pasa a referirse al destino
      for (const d of wb.names || []) d.ref = moveRefs(d.ref, d.scope, Bx.quoteSheet(dst.name) + '!');
      dvFormulasAll((f, s) => moveRefs(f, s.name, s === dst ? '' : Bx.quoteSheet(dst.name) + '!'));
    });
    clip = null;
    setSel({ r: g.r1, c: g.c1 }, { r: g.r1 + cp.h - 1, c: g.c1 + cp.w - 1 }, false);
  }
  function pasteInternal(g) {
    const cp = clip;
    if (cp.cut) return cutPaste(cp, g);
    // Si la selección es múltiplo exacto del área copiada, se repite (como Excel)
    const H = g.r2 - g.r1 + 1, W = g.c2 - g.c1 + 1;
    const R = H % cp.h === 0 && W % cp.w === 0 && !single(g) ? H : cp.h;
    const C = H % cp.h === 0 && W % cp.w === 0 && !single(g) ? W : cp.w;
    if (ensureSize(g.r1 + R - 1, g.c1 + C - 1)) paintAll();
    const items = [];
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const src = clone(cp.cells[i % cp.h][j % cp.w]);
      const r = g.r1 + i, c = g.c1 + j;
      if (src && isFormula(src.v)) src.v = shiftFormula(src.v, r - clipRow(cp, i % cp.h), c - (cp.c1 + j % cp.w));
      items.push({ r, c, cell: src });
    }
    // Pegar (todo) también pega la validación de datos de lo copiado, en cada repetición, y reemplaza la del destino
    // (como Excel; Pegado especial ▸ Validación queda P2). Copia con filas filtradas salteadas: no se pegan reglas
    const to = { r1: g.r1, c1: g.c1, r2: g.r1 + R - 1, c2: g.c1 + C - 1 }, rules = cp.dv;
    let dv;
    if (rules) {
      dv = dvRemove(sheet.dv || [], [to]);
      for (let i = 0; i < R; i += cp.h) for (let j = 0; j < C; j += cp.w) {
        dv = dvAddAll(dv, rules.map(d => dvMove(d, g.r1 + i - cp.r1, g.c1 + j - cp.c1, true)));
      }
    }
    // el formato condicional, igual (en cada repetición; reemplaza el del destino)
    const moves = [];
    for (let i = 0; i < R; i += cp.h) for (let j = 0; j < C; j += cp.w) moves.push([g.r1 + i - cp.r1, g.c1 + j - cp.c1]);
    const cf = cp.cf ? cfPaste(sheet.cf || [], cp.cf, to, moves) : undefined;
    applyChanges(items, { dv, cf });
    setSel({ r: g.r1, c: g.c1 }, { r: g.r1 + R - 1, c: g.c1 + C - 1 }, false);
  }

  // ---------- Relleno (controlador de relleno, Ctrl+D, Ctrl+R) ----------
  const mod = (a, n) => ((a % n) + n) % n;
  const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const DAYS3 = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MONTHS3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const dateRaw = s => { const d = serialDate(Math.round(s)); return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
  // Serie que continúa los valores de origen de una línea (como el controlador de relleno de Excel).
  // Devuelve k → valor (k = desplazamiento desde la primera celda de origen) o null si solo hay que copiar.
  function seriesFor(raws) {
    if (raws.some(v => !v || isFormula(v))) return null;
    const n = raws.length, lin = xs => [xs[0], n > 1 ? (xs[n - 1] - xs[0]) / (n - 1) : 1];
    if (raws.every(isDateLiteral)) {
      // fechas con el mismo día y meses a intervalos fijos (01/01, 01/02 o ene-45, feb-45): serie por meses, con el día
      // limitado al largo del mes; si no, por días (1/12, 2/12 → 03/12; también las fechas es-CL 1/1/26, 1-ene, 12/99)
      const ds = raws.map(v => serialDate(Math.floor(literal(v)))), ym = d => d.getUTCFullYear() * 12 + d.getUTCMonth();
      const day = ds[0].getUTCDate(), stM = n > 1 ? ym(ds[1]) - ym(ds[0]) : 0;
      if (n > 1 && stM && ds.every((d, i) => d.getUTCDate() === day && ym(d) - ym(ds[0]) === stM * i)) {
        return k => {
          const t = ym(ds[0]) + stM * k, y = Math.floor(t / 12), m = mod(t, 12) + 1;
          const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
          return `${p2(Math.min(day, dim))}/${p2(m)}/${y}`;
        };
      }
      const [a, st] = lin(raws.map(literal));
      return k => dateRaw(a + st * k);
    }
    if (raws.every(v => typeof literal(v) === 'number')) {
      if (n < 2) return null;
      const [a, st] = lin(raws.map(literal));
      return k => Bx.toRaw(+(a + st * k).toPrecision(15));   // 1,125 · 2,25 → 3,375 (no 3375, P0 1)
    }
    for (const list of [DAYS, DAYS3, MONTHS, MONTHS3]) {
      const idx = raws.map(v => list.indexOf(v.trim().toLowerCase()));
      if (idx.every(i => i >= 0)) {
        const st = n > 1 ? idx[1] - idx[0] : 1, up = raws[0].trim()[0] !== raws[0].trim()[0].toLowerCase();
        return k => { const s = list[mod(idx[0] + st * k, list.length)]; return up ? s[0].toUpperCase() + s.slice(1) : s; };
      }
    }
    const m = raws.map(v => /^(.*\D)(\d+)$/.exec(v));
    if (m.every(x => x && x[1] === m[0][1])) {
      const [a, st] = lin(m.map(x => +x[2]));
      return k => m[0][1] + Math.max(0, Math.round(a + st * k));
    }
    return null;
  }
  function doFill(src, tgt, series) {
    const h = src.r2 - src.r1 + 1, w = src.c2 - src.c1 + 1;
    const vertical = tgt.c1 === src.c1 && tgt.c2 === src.c2;
    const gen = {};
    // origen: contenido propio; una celda fantasma aporta su valor (copyCell), como al copiarla
    const srcCell = (r, c) => copyCell(r, c, src);
    if (series) {
      if (vertical) for (let c = src.c1; c <= src.c2; c++) {
        const raws = []; for (let r = src.r1; r <= src.r2; r++) raws.push(rawOf(srcCell(r, c)));
        gen['c' + c] = seriesFor(raws);
      } else for (let r = src.r1; r <= src.r2; r++) {
        const raws = []; for (let c = src.c1; c <= src.c2; c++) raws.push(rawOf(srcCell(r, c)));
        gen['r' + r] = seriesFor(raws);
      }
    }
    if (ensureSize(tgt.r2, tgt.c2)) paintAll();
    const items = [], fh = filterHidden();
    for (let r = tgt.r1; r <= tgt.r2; r++) for (let c = tgt.c1; c <= tgt.c2; c++) {
      if (r >= src.r1 && r <= src.r2 && c >= src.c1 && c <= src.c2) continue;
      if (fh && fh.has(r)) continue;   // rellenar sobre un rango filtrado solo escribe en las filas visibles (P0 2)
      const sr = src.r1 + mod(r - src.r1, h), sc = src.c1 + mod(c - src.c1, w);
      const cell = srcCell(sr, sc);
      const g = vertical ? gen['c' + c] : gen['r' + r];
      if (cell && g) cell.v = g(vertical ? r - src.r1 : c - src.c1);
      else if (cell && isFormula(cell.v)) cell.v = shiftFormula(cell.v, r - sr, c - sc);
      items.push({ r, c, cell });
    }
    // la validación de datos del origen se repite en lo rellenado (como copiarla), en el mismo paso de deshacer
    const rules = dvPieces(sheet, src);
    let dv = dvRemove(sheet.dv || [], dvSubtract(tgt, [src]));
    const k0 = vertical ? Math.floor((tgt.r1 - src.r1) / h) : Math.floor((tgt.c1 - src.c1) / w);
    for (let k = k0; vertical ? src.r1 + k * h <= tgt.r2 : src.c1 + k * w <= tgt.c2; k++) {
      if (!k) continue;
      const dr = vertical ? k * h : 0, dc = vertical ? 0 : k * w;
      dv = dvAddAll(dv, rules.map(d => dvClip(dvMove(d, dr, dc, true), tgt)).filter(Boolean));
    }
    // y el formato condicional, igual: las copias que coinciden con la regla de origen la extienden (una sola regla)
    const cfRules = cfPieces(sheet, src);
    let cf = dvRemove(sheet.cf || [], dvSubtract(tgt, [src]));
    for (let k = k0; vertical ? src.r1 + k * h <= tgt.r2 : src.c1 + k * w <= tgt.c2; k++) {
      if (!k) continue;
      cf = cfAddAll(cf, cfRules.map(d => dvClip(dvMove(d, vertical ? k * h : 0, vertical ? 0 : k * w, true), tgt)).filter(Boolean));
    }
    applyChanges(items, { dv, cf });
    setSel({ r: tgt.r1, c: tgt.c1 }, { r: tgt.r2, c: tgt.c2 }, false);
  }
  function fillCopy(dir) {
    const g = range();
    if (dir === 'down') {
      if (g.r1 === g.r2) { if (g.r1 === 0) return; doFill({ ...g, r1: g.r1 - 1, r2: g.r1 - 1 }, { ...g, r1: g.r1 - 1 }, false); }
      else doFill({ ...g, r2: g.r1 }, g, false);
    } else {
      if (g.c1 === g.c2) { if (g.c1 === 0) return; doFill({ ...g, c1: g.c1 - 1, c2: g.c1 - 1 }, { ...g, c1: g.c1 - 1 }, false); }
      else doFill({ ...g, c2: g.c1 }, g, false);
    }
  }

  // ---------- Filas / columnas ----------
  function shiftCells(s, axis, at, n) {
    const out = {};
    for (const [k, cell] of Object.entries(s.cells)) {
      const p = parseAddr(k);
      let v = p[axis];
      if (n < 0) { if (v >= at && v < at - n) continue; if (v >= at - n) v += n; }
      else if (v >= at) v += n;
      p[axis] = v;
      out[addr(p.r, p.c)] = cell;
    }
    s.cells = out;
    // Anchos y estilos de columna/fila se desplazan con sus columnas/filas
    const shiftMap = m => {
      const o = {};
      for (const [k, val] of Object.entries(m || {})) {
        let i = +k;
        if (n < 0) { if (i >= at && i < at - n) continue; if (i >= at - n) i += n; } else if (i >= at) i += n;
        o[i] = val;
      }
      return o;
    };
    if (axis === 'c') { s.colW = shiftMap(s.colW); s.colS = shiftMap(s.colS); }
    else {
      s.rowS = shiftMap(s.rowS);
      if (s.rowH) { s.rowH = shiftMap(s.rowH); if (!Object.keys(s.rowH).length) delete s.rowH; }   // el alto viaja con su fila
    }
    // filas/columnas ocultas siguen a su fila/columna
    const hk = axis === 'r' ? 'hiddenR' : 'hiddenC';
    if (s[hk]) { s[hk] = Object.keys(shiftMap(Object.fromEntries(s[hk].map(i => [i, 1])))).map(Number); if (!s[hk].length) delete s[hk]; }
    // el autofiltro sigue a su tabla: encabezado, última fila, filas que oculta y criterios por columna
    if (s.filter) {
      const f = s.filter, mv = i => n > 0 ? (i >= at ? i + n : i) : (i >= at - n ? i + n : i >= at ? null : i);
      if (axis === 'r') {
        const hr = mv(f.r);
        if (hr == null) delete s.filter;   // se eliminó la fila de encabezados: el filtro desaparece (como Excel)
        else {
          f.r = hr;
          f.r2 = Math.max(f.r, mv(f.r2) ?? (at - 1));
          if (Array.isArray(f.hidden)) f.hidden = f.hidden.map(mv).filter(i => i != null);
        }
      } else {
        const c1 = mv(f.c1), c2 = mv(f.c2), crit = {};
        for (const [c, v] of Object.entries(f.crit || {})) { const nc = mv(+c); if (nc != null) crit[nc] = v; }
        f.c1 = c1 ?? at; f.c2 = c2 ?? (at - 1); f.crit = crit;
        if (f.c2 < f.c1) delete s.filter;
      }
    }
    // las estructuras guardadas como rectángulos (combinaciones…) siguen a sus celdas
    shiftRanges(s, axis, at, n);
  }
  // ---------- Estructuras con rango (L-013) ----------
  // Un rectángulo { r1, c1, r2, c2, … } al insertar (n > 0) o eliminar (n < 0) |n| filas (axis 'r') o columnas ('c')
  // desde `at`: se desplaza, se recorta si pierde una parte, y da null si queda entero dentro de lo eliminado.
  // Las demás propiedades del objeto se conservan.
  function shiftRect(g, axis, at, n) {
    const o = { ...g }, k1 = axis + '1', k2 = axis + '2';
    for (const k of [k1, k2]) {
      if (n > 0) { if (o[k] >= at) o[k] += n; }
      else if (o[k] >= at - n) o[k] += n; else if (o[k] >= at) o[k] = k === k1 ? at : at - 1;
    }
    return o[k2] >= o[k1] ? o : null;
  }
  // Listas de la hoja cuyos elementos son rectángulos que siguen a sus celdas: [clave, keep, shift], donde keep(x) dice si
  // el elemento desplazado sigue valiendo y shift (opcional, por omisión shiftRect) desplaza un elemento con varios
  // rangos
  const RANGE_LISTS = [
    ['merges', m => m.r1 !== m.r2 || m.c1 !== m.c2],   // una combinación que queda de una sola celda deja de serlo
    ['dv', d => d.ranges.length > 0, (d, axis, at, n) => dvShift(d, axis, at, n)],   // validación de datos: cada regla con sus rangos
    ['cf', d => d.ranges.length > 0, (d, axis, at, n) => dvShift(d, axis, at, n)],   // formato condicional: igual que la validación
  ];
  function shiftRanges(s, axis, at, n) {
    for (const [key, keep, shift = shiftRect] of RANGE_LISTS) {
      if (!Array.isArray(s[key])) continue;
      s[key] = s[key].map(x => shift(x, axis, at, n)).filter(x => x && keep(x));
      if (!s[key].length) delete s[key];
    }
  }
  function structOp(axis, n) {
    if (edit && !commitEdit()) return;
    const g = range(), at = axis === 'r' ? g.r1 : g.c1;
    const count = axis === 'r' ? g.r2 - g.r1 + 1 : g.c2 - g.c1 + 1;
    const delta = n > 0 ? count : -count;
    if (delta < 0 && (axis === 'r' ? sheet.rows : sheet.cols) - count < 1) return toast('No se puede eliminar todo');
    const fh = axis === 'r' && delta < 0 ? filterHidden() : null;
    if (fh && [...fh].some(r => r >= g.r1 && r <= g.r2)) {
      // Con filtro activo, "Eliminar filas" elimina solo las filas visibles del rango, como Excel (P0 2)
      if (!confirm('¿Eliminar toda la fila de la hoja?')) return;
      const vis = [];
      for (let r = g.r2; r >= g.r1; r--) if (!fh.has(r)) vis.push(r);   // de abajo hacia arriba
      if (!vis.length) return;
      return snapshotOp(() => {
        const target = sheet.name;
        for (const r of vis) {
          shiftCells(sheet, 'r', r, -1);
          for (const s of wb.sheets) for (const cell of Object.values(s.cells)) {
            if (isFormula(cell.v)) cell.v = structural(cell.v, s.name, target, 'r', r, -1);
          }
          Bx.namesStructural(wb, target, 'r', r, -1);
          dvFormulasAll((f, s) => structural(f, s.name, target, 'r', r, -1));
        }
      });
    }
    snapshotOp(() => {
      const target = sheet.name;
      shiftCells(sheet, axis, at, delta);
      for (const s of wb.sheets) for (const cell of Object.values(s.cells)) {
        if (isFormula(cell.v)) cell.v = structural(cell.v, s.name, target, axis, at, delta);
      }
      Bx.namesStructural(wb, target, axis, at, delta);   // los rangos con nombre siguen a sus celdas (L-013)
      // las fórmulas de la validación de datos (Mínimo, Máximo, Origen, Personalizada) de todas las hojas, igual que las de las celdas
      dvFormulasAll((f, s) => structural(f, s.name, target, axis, at, delta));
      // Excel conserva el total de filas y columnas al eliminar; al insertar la hoja crece (cuadrícula "infinita")
      if (delta > 0) { if (axis === 'r') sheet.rows += delta; else sheet.cols += delta; }
    });
  }
  const insertRows = () => structOp('r', 1), deleteRows = () => structOp('r', -1);
  const insertCols = () => structOp('c', 1), deleteCols = () => structOp('c', -1);

  // Ocultar / mostrar filas (axis 'R') o columnas (axis 'C') de la selección
  function setHidden(axis, hide) {
    if (edit && !commitEdit()) return;
    const g = range(), key = 'hidden' + axis, lo = axis === 'R' ? g.r1 : g.c1, hi = axis === 'R' ? g.r2 : g.c2;
    const max = axis === 'R' ? sheet.rows : sheet.cols;
    if (hide && hi - lo + 1 >= max) return toast('No se pueden ocultar todas las ' + (axis === 'R' ? 'filas' : 'columnas'));
    snapshotOp(() => {
      const set = new Set(sheet[key] || []);
      for (let i = lo; i <= hi; i++) { if (hide) set.add(i); else set.delete(i); }
      if (set.size) sheet[key] = [...set].sort((a, b) => a - b); else delete sheet[key];
    });
    if (hide) {
      // la celda activa pasa a la primera fila/columna visible siguiente
      if (axis === 'R') { let r = hi + 1; while (r < sheet.rows - 1 && isHidden(r)) r++; setSel({ r: Math.min(r, sheet.rows - 1), c: A.c }); }
      else { let c = hi + 1; while (c < sheet.cols - 1 && isHiddenCol(c)) c++; setSel({ r: A.r, c: Math.min(c, sheet.cols - 1) }); }
    }
  }
  // Ctrl+- / Ctrl++: con filas o columnas completas seleccionadas actúa directo; si no, pregunta
  function structMenu(insert) {
    if (edit) return;
    const g = range();
    if (g.c1 === 0 && g.c2 === sheet.cols - 1) return insert ? insertRows() : deleteRows();
    if (g.r1 === 0 && g.r2 === sheet.rows - 1) return insert ? insertCols() : deleteCols();
    const R = rect({ r1: A.r, c1: A.c, r2: A.r, c2: A.c }), W = wrap.getBoundingClientRect();
    showMenu({ clientX: W.left + R.left + R.width - wrap.scrollLeft, clientY: W.top + R.top + R.height - wrap.scrollTop }, insert
      ? [['Insertar filas completas', insertRows], ['Insertar columnas completas', insertCols]]
      : [['Eliminar filas completas', deleteRows], ['Eliminar columnas completas', deleteCols]]);
  }
  // Ctrl+Fin: última celda usada (con Shift, extiende la selección hasta ella)
  function ctrlEnd(extend) {
    const e = usedExtent(false), maxR = Math.max(0, e.r), maxC = Math.max(0, e.c);   // cuenta los desbordes
    if (extend) setSel(A, { r: maxR, c: maxC }); else setSel({ r: maxR, c: maxC });
  }

  // ---------- Ordenar ----------
  // Motor de orden único: lo usan A→Z/Z→A (cinta y menú), el ▾ del autofiltro y el cuadro "Ordenar" (varios niveles).
  // g: datos sin la fila de encabezados; levels: [{ key, desc }], key = columna (de arriba hacia abajo) o fila (de
  // izquierda a derecha); o: { caseSens, lr }. Como Excel: orden estable; números < texto < lógicos < errores
  // (compareVals, colación española); las vacías siempre al final, también en descendente. "Las filas ocultas no se
  // mueven al ordenar las filas" (y las columnas ocultas al ordenar columnas): las visibles se ordenan entre las
  // posiciones visibles, así sheet.filter.hidden no cambia y el deshacer por celdas restaura todo en un paso (L-033).
  // Devuelve true si ordenó.
  function sortRange(g, levels, o = {}) {
    const lr = !!o.lr;
    // Un desborde no se puede reordenar celda por celda: mover sus valores escribiría contenido en las celdas
    // fantasma y bloquearía el ancla. Se ordena con la fórmula (ORDENAR) o fuera del rango desbordado
    if (spillList().some(s => !(s.r2 < g.r1 || s.r1 > g.r2 || s.c2 < g.c1 || s.c1 > g.c2))) {
      toast('No se puede ordenar parte de una matriz desbordada: usa ORDENAR en su fórmula');
      return false;
    }
    if (!mergesSortable(g, lr)) { msgBox('Para ello, todas las celdas combinadas deben tener el mismo tamaño.'); return false; }
    // solo se mueven las líneas (filas o columnas) visibles: slots = sus posiciones, en orden
    const hid = hiddenRows(), lines = [], slots = [];
    for (let i = lr ? g.c1 : g.r1, hi = lr ? g.c2 : g.r2; i <= hi; i++) {
      if (lr ? isHiddenCol(i) : hid.has(i)) continue;
      const cells = [];
      if (lr) for (let r = g.r1; r <= g.r2; r++) cells.push(clone(getCell(r, i)));
      else for (let c = g.c1; c <= g.c2; c++) cells.push(clone(getCell(i, c)));
      lines.push({ i, ks: levels.map(L => lr ? eng.value(wb.active, L.key, i) : eng.value(wb.active, i, L.key)), cells });
      slots.push(i);
    }
    lines.sort((x, y) => {
      for (let j = 0; j < levels.length; j++) { const c = sortCompare(x.ks[j], y.ks[j], levels[j].desc, o.caseSens); if (c) return c; }
      return x.i - y.i;   // estable
    });
    const items = [];
    lines.forEach((line, k) => line.cells.forEach((cell, j) => {
      const n = slots[k];
      // las fórmulas se ajustan como al copiarlas a su nueva posición (como hasta ahora)
      if (cell && isFormula(cell.v)) cell.v = lr ? shiftFormula(cell.v, 0, n - line.i) : shiftFormula(cell.v, n - line.i, 0);
      items.push(lr ? { r: g.r1 + j, c: n, cell } : { r: n, c: g.c1 + j, cell });
    }));
    applyChanges(items);   // un solo paso de deshacer
    return true;
  }
  // Una clave de orden: vacías al final en ambos sentidos. Con "Distinguir mayúsculas de minúsculas", a igualdad sin
  // distinguir, la minúscula va antes que la mayúscula (como Excel; en descendente, al revés)
  function sortCompare(a, b, desc, caseSens) {
    if (a === null || b === null) return (a === null) - (b === null);
    let c = compareVals(a, b);
    if (!c && caseSens && typeof a === 'string' && typeof b === 'string') c = caseCompare(a, b);
    return desc ? -c : c;
  }
  function caseCompare(a, b) {
    for (let i = 0, n = Math.min(a.length, b.length); i < n; i++) {
      if (a[i] !== b[i]) return a[i] === a[i].toLowerCase() ? -1 : 1;
    }
    return 0;
  }
  // Excel solo ordena un rango con combinaciones si todas tienen el mismo tamaño y la orientación no las parte: cada
  // fila (o columna) que se mueve tiene las mismas combinaciones, de una sola fila (o columna). Una combinación que
  // sale del rango también lo impide (P1 del backlog: antes se movían los valores y las combinaciones no)
  function mergesSortable(g, lr) {
    const ms = (sheet.merges || []).filter(m => !(m.r2 < g.r1 || m.r1 > g.r2 || m.c2 < g.c1 || m.c1 > g.c2));
    if (!ms.length) return true;
    if (ms.some(m => m.r1 < g.r1 || m.r2 > g.r2 || m.c1 < g.c1 || m.c2 > g.c2)) return false;
    if (ms.some(m => lr ? m.c1 !== m.c2 : m.r1 !== m.r2)) return false;
    const sig = new Map();   // línea → figura de sus combinaciones
    for (const m of ms) { const k = lr ? m.c1 : m.r1; sig.set(k, (sig.get(k) || []).concat(lr ? m.r1 + ':' + m.r2 : m.c1 + ':' + m.c2)); }
    const hid = hiddenRows();
    let ref = null;
    for (let i = lr ? g.c1 : g.r1, hi = lr ? g.c2 : g.r2; i <= hi; i++) {
      if (lr ? isHiddenCol(i) : hid.has(i)) continue;   // las ocultas no se mueven
      const s = (sig.get(i) || []).sort().join();
      if (ref === null) ref = s; else if (s !== ref) return false;
    }
    return true;
  }
  // Encabezado probable en la primera fila de g (como Excel al ordenar): negrita en la columna activa, o una columna
  // con texto arriba y debajo un dato que no es texto
  function guessHeader(g, keyCol) {
    if (g.r1 >= g.r2) return false;
    if (effStyle(g.r1, keyCol).b) return true;
    for (let c = g.c1; c <= g.c2; c++) {
      const top = eng.value(wb.active, g.r1, c), second = eng.value(wb.active, g.r1 + 1, c);
      if (typeof top === 'string' && second !== null && typeof second !== 'string') return true;
    }
    return false;
  }
  // Qué se ordena (cinta, menú y cuadro Ordenar): { g (con la posible fila de encabezados), header, lock, select, flt },
  // null, o una promesa de eso si hay que preguntar. Una fila de celdas (o columnas completas): la región actual y su
  // encabezado probable; dentro del autofiltro, su rango con su encabezado (fijo); un rango con datos al lado:
  // "Advertencia antes de ordenar". forDialog: el cuadro propone el encabezado también para un rango elegido.
  function sortTarget(forDialog) {
    const g = range(), flt = sheet.filter;
    if (extra.length) { msgBox('Este comando no se puede usar en selecciones múltiples.'); return null; }
    const wide = g.r1 === g.r2 || g.r2 - g.r1 + 1 === sheet.rows;
    if (wide && flt && A.r >= flt.r && A.c >= flt.c1 && A.c <= flt.c2 && A.r <= Math.max(flt.r2, currentRegion(flt.r, flt.c1).r2)) {
      // una celda dentro de un rango con autofiltro: se ordena el rango del filtro (su encabezado es la fila del filtro)
      return { g: { r1: flt.r, r2: Math.max(flt.r2, currentRegion(flt.r, flt.c1).r2), c1: flt.c1, c2: flt.c2 }, header: true, lock: true, select: true, flt: true };
    }
    if (wide) { const reg = currentRegion(A.r, A.c); return { g: reg, header: guessHeader(reg, A.c), select: true }; }
    // un rango con datos contiguos a los lados: Excel pregunta si se amplía la selección a la región actual
    const reg = regionOf(g);
    if (reg.c1 < g.c1 || reg.c2 > g.c2) {
      return rangeWarning().then(ans => ans === 'expand' ? { g: reg, header: guessHeader(reg, A.c), select: true }
        : ans === 'current' ? { g, header: !!forDialog && guessHeader(g, A.c) } : null);
    }
    return { g, header: !!forDialog && guessHeader(g, A.c) };
  }
  // Parte de datos de un destino de orden (sin la fila de encabezados), o null si no queda nada que ordenar
  function sortData(t, header, lr) {
    const d = { ...t.g };
    if (header && !lr) d.r1++;
    if (d.r1 > d.r2 || (!lr && t.select && !t.flt && t.g.r1 === t.g.r2)) return null;
    return d;
  }
  // Después de ordenar una región, queda seleccionada (sin el encabezado). La celda activa se queda donde estaba si cae
  // dentro de los datos (comportamiento observado de Excel, P2 de qa ronda 5a); si no (estaba en el encabezado o en una
  // fila oculta), pasa a la primera fila visible de los datos, en su columna. Solo se llama si el orden se hizo: un
  // orden rechazado (combinaciones, desborde, Cancelar) no cambia la selección
  function selectSorted(t, d) {
    if (!t.select) return;
    const keep = inArea(d, A.r, A.c) && !isHidden(A.r);
    const act = keep ? A : { r: Math.min(rowAt(posOf(d.r1)), d.r2), c: Math.min(Math.max(A.c, d.c1), d.c2) };
    setSel({ r: d.r1, c: d.c1 }, { r: d.r2, c: d.c2 }, false, false, act);
  }
  // A→Z / Z→A por la columna activa. given/keyCol: datos (sin encabezado) y columna explícitos (▾ del autofiltro)
  function sortSel(desc, given, keyCol) {
    if (edit && !commitEdit()) return;
    if (given) return sortRange(given, [{ key: keyCol, desc }]);
    const run = t => {
      if (!t) return;
      const d = sortData(t, t.header, false);
      if (!d) return toast('No hay datos para ordenar alrededor de la celda activa');
      const ok = sortRange(d, [{ key: A.c, desc }]);
      if (ok) selectSorted(t, d);   // la selección cambia solo si ordenó
      return ok;
    };
    const t = sortTarget(false);
    return t && t.then ? t.then(run) : run(t);
  }

  // "Advertencia antes de ordenar" (compartida: Quitar duplicados la usa con su título, verbo y botón).
  // → Promise<'expand' | 'current' | null> (null = Cancelar o Esc)
  function rangeWarning({ title = 'Advertencia antes de ordenar', verb = 'ordenarán', ok = 'Ordenar' } = {}) {
    const body = document.createElement('div');
    body.innerHTML = `<p id="rwText"></p><p>¿Qué desea hacer?</p>
      <label class="chk"><input type="radio" name="rwOpt" id="rwExpand" checked> Ampliar la selección</label>
      <label class="chk"><input type="radio" name="rwOpt" id="rwCurrent"> Continuar con la selección actual</label>`;
    body.querySelector('#rwText').textContent = `Bassxcel encontró datos junto a la selección. Como no ha seleccionado estos datos, no se ${verb}.`;
    return dlgBox({ id: 'warnDlg', title, body, ok, focus: '#rwExpand' })
      .then(yes => yes ? (body.querySelector('#rwExpand').checked ? 'expand' : 'current') : null);
  }

  // ---------- Cuadro "Ordenar" (Datos ▸ Ordenar y "Orden personalizado…") ----------
  const SORT_MAX = 64;   // niveles, como Excel
  const ORDER_TXT = { text: ['A a Z', 'Z a A'], num: ['De menor a mayor', 'De mayor a menor'], date: ['De más antiguos a más recientes', 'De más recientes a más antiguos'] };
  // niveles, opciones y encabezado del último orden de cada hoja durante la sesión (no se guardan en el archivo)
  const sortMemo = new Map();
  const sameRect = (a, b) => !!a && !!b && a.r1 === b.r1 && a.r2 === b.r2 && a.c1 === b.c1 && a.c2 === b.c2;
  // Tipo dominante de la columna (o fila) k dentro de los datos de g, para los textos del Criterio: 'num', 'date'
  // (números con formato de fecha) o 'text' (también lógicos, errores o sin datos)
  function lineType(g, k, lr, header) {
    let n = 0, s = 0, d = 0;
    const from = lr ? g.c1 : g.r1 + (header ? 1 : 0), to = Math.min(lr ? g.c2 : g.r2, from + 5000);
    for (let i = from; i <= to; i++) {
      const r = lr ? k : i, c = lr ? i : k, v = eng.value(wb.active, r, c);
      if (typeof v === 'string') s++;
      else if (typeof v === 'number') {
        n++;
        const cell = getCell(r, c), f = autoFmt({ v: cell ? cell.v : '', s: effStyle(r, c) });
        if (f === 'date' || f === 'datetime') d++;
      }
    }
    return n > s ? (d * 2 >= n ? 'date' : 'num') : 'text';
  }
  // given: rango del autofiltro con su encabezado (▾ ▸ Orden personalizado…) y keyCol, su columna
  function openSortDialog(given, keyCol) {
    if (edit && !commitEdit()) return;
    hideMenu();
    const t = given ? { g: given, header: true, lock: true } : sortTarget(true);
    return t && t.then ? t.then(x => x && sortDialog(x, keyCol)) : t && sortDialog(t, keyCol);
  }
  function sortDialog(t, keyCol) {
    const memo = keyCol == null ? sortMemo.get(sheet.name) : null;
    // Reabrir sobre la selección que dejó el último orden (sus datos, sin el encabezado) vuelve a esa región con su
    // encabezado: "Mis datos tienen encabezados" queda como en la última ejecución (P2 de qa ronda 5a)
    if (memo && !t.lock && memo.header && !memo.lr && sameRect(memo.d, t.g)) t = { ...t, g: { ...memo.g }, select: true };
    const g = t.g;
    if (g.r1 === g.r2 && g.c1 === g.c2 && !hasData(g.r1, g.c1)) return toast('No hay datos para ordenar alrededor de la celda activa');
    const inside = (lr, k) => lr ? k >= g.r1 && k <= g.r2 : k >= g.c1 && k <= g.c2;
    const defKey = lr => lr ? (inside(true, A.r) ? A.r : g.r1) : keyCol ?? (inside(false, A.c) ? A.c : g.c1);
    const st = { header: !!t.header, caseSens: false, lr: false, levels: null, sel: 0 };
    if (memo && memo.levels.every(L => L.key === '' || inside(memo.lr, L.key))) {
      Object.assign(st, { caseSens: memo.caseSens, lr: memo.lr, levels: memo.levels.map(L => ({ ...L })) });
      if (!t.lock && sameRect(memo.g, g)) st.header = memo.header;
    }
    if (!st.levels) st.levels = [{ key: defKey(false), desc: false }];
    const useHeader = () => st.header && !st.lr;
    const body = document.createElement('div');
    body.innerHTML = `<div class="srt-bar">
        <button type="button" id="srtAdd">+ Agregar nivel</button><button type="button" id="srtDel">✕ Eliminar nivel</button>
        <button type="button" id="srtCopy">Copiar nivel</button><button type="button" id="srtUp" title="Subir">▲</button>
        <button type="button" id="srtDown" title="Bajar">▼</button><button type="button" id="srtOpts">Opciones…</button>
        <label class="chk"><input type="checkbox" id="srtHeader"> Mis datos tienen encabezados</label>
      </div>
      <div class="srt-head"><span></span><span id="srtColHead">Columna</span><span>Ordenar según</span><span>Criterio</span></div>
      <div class="srt-levels" id="srtLevels"></div>`;
    const q = s => body.querySelector(s), list = q('#srtLevels'), hdr = q('#srtHeader');
    const keys = () => { const out = []; for (let i = st.lr ? g.r1 : g.c1, hi = st.lr ? g.r2 : g.c2; i <= hi; i++) out.push(i); return out; };
    const label = k => st.lr ? 'Fila ' + (k + 1) : (useHeader() && cellText(g.r1, k)) || 'Columna ' + colName(k);
    function fillOrd(row, L) {
      const os = row.querySelector('.srt-ord'), [a, z] = ORDER_TXT[L.key === '' ? 'text' : lineType(g, L.key, st.lr, useHeader())];
      os.innerHTML = '';
      os.add(new Option(a, 'asc')); os.add(new Option(z, 'desc'));
      os.value = L.desc ? 'desc' : 'asc';
    }
    function syncBtns() {
      q('#srtAdd').disabled = q('#srtCopy').disabled = st.levels.length >= SORT_MAX;
      q('#srtDel').disabled = st.levels.length <= 1;
      q('#srtUp').disabled = st.sel <= 0;
      q('#srtDown').disabled = st.sel >= st.levels.length - 1;
      // de izquierda a derecha no hay fila de encabezados; en el autofiltro el encabezado es fijo
      hdr.disabled = !!t.lock || st.lr;
      hdr.checked = useHeader();
      q('#srtColHead').textContent = st.lr ? 'Fila' : 'Columna';
      // un botón que se deshabilita con el foco lo pierde: vuelve al nivel elegido (Enter y Tab siguen en el cuadro)
      const a = document.activeElement;
      if (body.isConnected && (!a || a.disabled || !a.closest('dialog'))) { const s = list.querySelector('.srt-lvl.on .srt-col'); if (s) s.focus(); }
    }
    function render() {
      list.innerHTML = '';
      st.levels.forEach((L, i) => {
        const row = document.createElement('div');
        row.className = 'srt-lvl' + (i === st.sel ? ' on' : '');
        row.dataset.i = i;
        row.innerHTML = `<span class="srt-lbl"></span><select class="srt-col" aria-label="Columna"></select><select class="srt-on" aria-label="Ordenar según"><option>Valores de celda</option></select><select class="srt-ord" aria-label="Criterio"></select>`;
        row.querySelector('.srt-lbl').textContent = i ? 'Luego por' : 'Ordenar por';
        const cs = row.querySelector('.srt-col');
        if (L.key === '') cs.add(new Option('', ''));   // nivel nuevo: sin columna, como Excel
        for (const k of keys()) cs.add(new Option(label(k), String(k)));
        cs.value = String(L.key);
        fillOrd(row, L);
        cs.onchange = () => {
          L.key = cs.value === '' ? '' : +cs.value;
          if (L.key !== '' && cs.options[0].value === '') cs.remove(0);
          fillOrd(row, L);   // el Criterio cambia de textos según el tipo de la columna; el sentido se conserva
        };
        row.querySelector('.srt-ord').onchange = e => { L.desc = e.target.value === 'desc'; };
        list.appendChild(row);
      });
      syncBtns();
    }
    // elegir un nivel solo marca la fila (no reconstruye: el clic que abre una lista necesita el mismo elemento, L-031)
    const pick = e => {
      const row = e.target.closest('.srt-lvl');
      if (!row) return;
      st.sel = +row.dataset.i;
      list.querySelectorAll('.srt-lvl').forEach(x => x.classList.toggle('on', x === row));
      syncBtns();
    };
    list.addEventListener('mousedown', pick);
    list.addEventListener('focusin', pick);
    const focusSel = () => { const s = list.querySelector('.srt-lvl.on .srt-col'); if (s) s.focus(); };
    q('#srtAdd').onclick = () => { st.levels.splice(st.sel + 1, 0, { key: '', desc: false }); st.sel++; render(); focusSel(); };
    q('#srtCopy').onclick = () => { st.levels.splice(st.sel + 1, 0, { ...st.levels[st.sel] }); st.sel++; render(); };
    q('#srtDel').onclick = () => { st.levels.splice(st.sel, 1); st.sel = Math.min(st.sel, st.levels.length - 1); render(); };
    const swap = d => { const L = st.levels, i = st.sel; [L[i], L[i + d]] = [L[i + d], L[i]]; st.sel += d; render(); };
    q('#srtUp').onclick = () => { if (st.sel > 0) swap(-1); };
    q('#srtDown').onclick = () => { if (st.sel < st.levels.length - 1) swap(1); };
    hdr.onchange = () => { st.header = hdr.checked; render(); };   // cambian los nombres de las columnas
    q('#srtOpts').onclick = () => {
      const ob = document.createElement('div');
      ob.innerHTML = `<label class="chk"><input type="checkbox" id="soCase"> Distinguir mayúsculas de minúsculas</label>
        <fieldset><legend>Orientación</legend>
          <label class="chk"><input type="radio" name="soOr" id="soTB"> Ordenar de arriba hacia abajo</label>
          <label class="chk"><input type="radio" name="soOr" id="soLR"> Ordenar de izquierda a derecha</label>
        </fieldset>`;
      ob.querySelector('#soCase').checked = st.caseSens;
      ob.querySelector(st.lr ? '#soLR' : '#soTB').checked = true;
      dlgBox({ id: 'sortOptDlg', title: 'Opciones de ordenación', body: ob, focus: '#soCase' }).then(yes => {
        if (!yes) return;
        st.caseSens = ob.querySelector('#soCase').checked;
        const lr = ob.querySelector('#soLR').checked;
        // otra orientación: las claves pasan de columnas a filas, así que los niveles vuelven a uno
        if (lr !== st.lr) { st.lr = lr; st.levels = [{ key: defKey(lr), desc: false }]; st.sel = 0; }
        render();
      });
    };
    const validate = () => {
      if (st.levels.some(L => L.key === '')) {
        msgBox(`Todos los criterios de ordenación deben tener una ${st.lr ? 'fila' : 'columna'} especificada. Compruebe los criterios de ordenación seleccionados e inténtelo de nuevo.`);
        return false;
      }
      const seen = new Set();
      for (const L of st.levels) {
        if (seen.has(L.key)) { msgBox(`${label(L.key)} se está ordenando por Valores de celda más de una vez. Elimine los criterios de ordenación duplicados e inténtelo de nuevo.`); return false; }
        seen.add(L.key);
      }
      return true;
    };
    render();
    return dlgBox({ id: 'sortDlg', title: 'Ordenar', body, focus: '.srt-lvl.on .srt-col', onOk: validate }).then(yes => {
      if (!yes) return;
      const d = sortData(t, useHeader(), st.lr);
      if (!d) return toast('No hay datos para ordenar');
      const ok = sortRange(d, st.levels, { caseSens: st.caseSens, lr: st.lr });
      if (!ok) return false;   // rechazado (combinaciones, desborde): no cambia la selección ni la memoria del cuadro
      // d: la selección que deja el orden (sin el encabezado), para reconocerla al reabrir el cuadro
      sortMemo.set(sheet.name, { g: { ...g }, d: { ...d }, header: st.header, caseSens: st.caseSens, lr: st.lr, levels: st.levels.map(L => ({ ...L })) });
      selectSorted(t, d);
      return ok;
    });
  }

  // ---------- Quitar duplicados (Datos ▸ Herramientas de datos) ----------
  // Como Excel: con una celda (o una fila de celdas, o columnas completas, igual que ordenar) usa la región actual; con un
  // rango junto a más datos, "Advertencia antes de quitar duplicados". Compara el valor mostrado (cellText, el mismo texto
  // que pinta la grilla: 01-01-2026 con formato de fecha y 46023 en General son distintos) sin distinguir mayúsculas,
  // conserva la primera aparición y elimina filas solo dentro del rango: las de abajo, dentro del rango, suben con su
  // formato; lo que está fuera no se mueve. Un comando rechazado (selección múltiple, combinaciones, filas ocultas o
  // filtradas, desborde, Cancelar) no cambia nada, tampoco la selección.
  // Qué se revisa: { g, header } (header = encabezado probable), null, o una promesa de eso si hay que advertir
  function dedupeTarget() {
    const g = range();
    if (extra.length) { msgBox('Este comando no se puede usar en selecciones múltiples.'); return null; }
    if (g.r1 === g.r2 || g.r2 - g.r1 + 1 === sheet.rows) { const reg = currentRegion(A.r, A.c); return { g: reg, header: guessHeader(reg, A.c) }; }
    const reg = regionOf(g);
    if (reg.c1 < g.c1 || reg.c2 > g.c2) {
      return rangeWarning({ title: 'Advertencia antes de quitar duplicados', verb: 'quitarán', ok: 'Quitar duplicados' })
        .then(ans => ans === 'expand' ? { g: reg, header: guessHeader(reg, A.c) } : ans === 'current' ? { g, header: guessHeader(g, A.c) } : null);
    }
    return { g, header: guessHeader(g, A.c) };
  }
  // Motivo por el que no se puede quitar duplicados en g (texto del mensaje), o null
  function dedupeBlocked(g) {
    const hit = x => !(x.r2 < g.r1 || x.r1 > g.r2 || x.c2 < g.c1 || x.c1 > g.c2);
    if ((sheet.merges || []).some(hit)) return 'No se puede hacer eso en una celda combinada.';
    // provisional (backlog: por confirmar en Excel): con filas ocultas o filtradas en el rango, avisa y no actúa
    if ([...hiddenRows()].some(r => r >= g.r1 && r <= g.r2)) return 'Quitar duplicados todavía no admite filas ocultas o filtradas dentro del rango. Muestre todas las filas (o borre el filtro) e inténtelo de nuevo.';
    // mover los valores de un desborde escribiría en sus celdas fantasma (como al ordenar)
    if (spillList().some(hit)) return 'No se pueden quitar duplicados en parte de una matriz desbordada.';
    return null;
  }
  function openDedupe() {
    if (edit && !commitEdit()) return;
    hideMenu();
    const t = dedupeTarget();
    return t && t.then ? t.then(x => x && dedupeDialog(x)) : t && dedupeDialog(t);
  }
  // Cuadro "Quitar duplicados": columnas con casillas (todas marcadas), Seleccionar todo / Anular selección y "Mis datos
  // tienen encabezados" (nombres de las columnas, o "Columna A…"). Sin columnas marcadas, Aceptar se deshabilita
  function dedupeDialog(t) {
    const g = t.g;
    if (single(g) && !hasData(g.r1, g.c1)) return toast('No hay datos para quitar duplicados alrededor de la celda activa');
    const why = dedupeBlocked(g);
    if (why) return msgBox(why);
    const body = document.createElement('div');
    body.innerHTML = `<p>Para eliminar valores duplicados, seleccione una o varias columnas que contengan duplicados.</p>
      <div class="dd-bar"><button type="button" id="ddAll">Seleccionar todo</button><button type="button" id="ddNone">Anular selección</button>
        <label class="chk"><input type="checkbox" id="ddHeader"> Mis datos tienen encabezados</label></div>
      <div class="dd-head">Columnas</div><div class="dd-list" id="ddList"></div>`;
    const q = s => body.querySelector(s), list = q('#ddList'), hdr = q('#ddHeader');
    hdr.checked = !!t.header;
    for (let c = g.c1; c <= g.c2; c++) {
      const l = document.createElement('label');
      l.className = 'chk';
      l.innerHTML = '<input type="checkbox" checked><span></span>';
      l.firstChild.dataset.c = c;
      list.appendChild(l);
    }
    const boxes = () => [...list.querySelectorAll('input')];
    const names = () => boxes().forEach(b => { const c = +b.dataset.c; b.nextSibling.textContent = (hdr.checked && cellText(g.r1, c)) || 'Columna ' + colName(c); });
    names();
    hdr.onchange = names;   // cambian los nombres de las columnas; las marcas se conservan
    q('#ddAll').onclick = () => { boxes().forEach(b => { b.checked = true; }); };
    q('#ddNone').onclick = () => { boxes().forEach(b => { b.checked = false; }); };
    // sin columnas marcadas, Aceptar se deshabilita (y Enter no acepta): dlgBox lo reevalúa tras cada clic o cambio
    const p = dlgBox({ id: 'dedupeDlg', title: 'Quitar duplicados', body, okEnabled: () => boxes().some(b => b.checked) });
    return p.then(yes => {
      if (!yes) return false;
      const res = removeDuplicates(g, boxes().filter(b => b.checked).map(b => +b.dataset.c), hdr.checked);
      // queda seleccionado el rango que conserva datos (con su encabezado); la activa se queda si cae dentro
      const left = { r1: g.r1, c1: g.c1, r2: Math.max(g.r1, g.r2 - res.removed), c2: g.c2 };
      setSel({ r: left.r1, c: left.c1 }, { r: left.r2, c: left.c2 }, false, false, inArea(left, A.r, A.c) ? A : null);
      return msgBox(res.removed ? `Se encontraron y quitaron ${res.removed} valores duplicados; quedan ${res.kept} valores únicos.`
        : 'No se encontraron valores duplicados.').then(() => true);
    });
  }
  // Quita las filas repetidas de g según las columnas cols, con un solo paso de deshacer. → { removed, kept } (filas de
  // datos). Las fórmulas de las filas que suben se ajustan como al ordenar (sortRange): sus referencias relativas se
  // desplazan con la fila, así una fórmula que mira su propia fila sigue mirándola; las absolutas no cambian y las
  // fórmulas de fuera que apuntan al rango no se reescriben (igual que ordenar)
  function removeDuplicates(g, cols, header) {
    const r1 = g.r1 + (header ? 1 : 0), seen = new Set(), keep = [];
    for (let r = r1; r <= g.r2; r++) {
      const k = JSON.stringify(cols.map(c => cellText(r, c).toLocaleLowerCase(LOCALE)));   // valor mostrado, sin mayúsculas
      if (!seen.has(k)) { seen.add(k); keep.push(r); }
    }
    const removed = Math.max(0, g.r2 - r1 + 1) - keep.length;
    if (!removed) return { removed: 0, kept: keep.length };
    const items = [];
    keep.forEach((r, k) => {
      const n = r1 + k;   // fila de destino: las que se conservan suben en orden
      for (let c = g.c1; c <= g.c2; c++) {
        const cell = clone(getCell(r, c));   // con su formato
        if (cell && isFormula(cell.v) && n !== r) cell.v = shiftFormula(cell.v, n - r, 0);
        items.push({ r: n, c, cell });
      }
    });
    // las filas que quedan libres al final del rango se vacían (contenido y formato)
    for (let r = r1 + keep.length; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) items.push({ r, c, cell: undefined });
    applyChanges(items);   // un solo paso de deshacer (Ctrl+Z restaura todo)
    return { removed, kept: keep.length };
  }

  // ---------- Validación de datos (Datos ▸ Herramientas de datos ▸ Validación de datos) ----------
  // Modelo: sheet.dv = [{ ranges: [{ r1, c1, r2, c2 }], type, op, f1, f2, allowBlank, list, inCell,
  //   input: { show, title, msg }, error: { show, style, title, msg } }]; cada celda tiene a lo sumo una regla. Los textos
  // se guardan como se escribieron en es-CL (1,5 · 01/01/2026 · 14:30 · =B1 · Sí;No). Las fórmulas (Mínimo, Máximo,
  // Origen y Personalizada) están escritas para la celda superior izquierda del primer rango (el ancla); en otra celda
  // de la regla se desplazan como al copiarlas (=A1>0 en B1 es =A2>0 en B2). El estado vive en el modelo y lo mantienen
  // insertar/eliminar (RANGE_LISTS y dvFormulasAll), pegar, rellenar, cortar, Borrar todo, hojas y deshacer (L-013, L-033)
  const DV_TYPES = [['any', 'Cualquier valor'], ['whole', 'Número entero'], ['decimal', 'Decimal'], ['list', 'Lista'], ['date', 'Fecha'], ['time', 'Hora'], ['length', 'Longitud del texto'], ['custom', 'Personalizada']];
  const DV_OPS = [['between', 'entre'], ['notBetween', 'no está entre'], ['equal', 'igual a'], ['notEqual', 'no igual a'], ['greaterThan', 'mayor que'], ['lessThan', 'menor que'], ['greaterThanOrEqual', 'mayor o igual que'], ['lessThanOrEqual', 'menor o igual que']];
  const DV_STYLES = ['stop', 'warning', 'information'];
  const DV_MSG = 'Este valor no coincide con las restricciones de validación de datos definidas para esta celda.';
  const DV_XLSX_LOSS = 'Este libro tiene validación de datos y Bassxcel todavía no la guarda en .xlsx: el archivo exportado tendrá los datos, pero no las reglas ni las listas desplegables.\n\n¿Desea exportar de todos modos?';
  const DV_ROWS = 8;   // elementos visibles de la lista desplegable (como Excel); el resto, con desplazamiento
  const dvTwoArgs = op => op === 'between' || op === 'notBetween';
  const dvLow = t => String(t).toLocaleLowerCase(LOCALE);
  // Igualdad de estructuras sin depender del orden de las claves (L-059)
  function deepEq(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
    return ka.length === kb.length && ka.every(k => deepEq(a[k], b[k]));
  }
  function setDv(S, list) { if (list && list.length) S.dv = list; else delete S.dv; }
  // Regla de un archivo o del cuadro → regla completa, o null si está mal formada
  function normDv(d) {
    if (!d || !Array.isArray(d.ranges) || !DV_TYPES.some(t => t[0] === d.type)) return null;
    const int = x => Number.isInteger(x) && x >= 0;
    const ranges = d.ranges.filter(g => g && int(g.r1) && int(g.c1) && int(g.r2) && int(g.c2) && g.r2 >= g.r1 && g.c2 >= g.c1).map(g => ({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 }));
    if (!ranges.length) return null;
    const str = x => x == null ? '' : String(x), i = d.input || {}, e = d.error || {};
    return {
      ranges, type: d.type, op: DV_OPS.some(o => o[0] === d.op) ? d.op : 'between', f1: str(d.f1).trim(), f2: str(d.f2).trim(),
      allowBlank: d.allowBlank !== false, list: str(d.list).trim(), inCell: d.inCell !== false,
      input: { show: i.show !== false, title: str(i.title).slice(0, 32), msg: str(i.msg).slice(0, 255) },
      error: { show: e.show !== false, style: DV_STYLES.includes(e.style) ? e.style : 'stop', title: str(e.title).slice(0, 32), msg: str(e.msg).slice(0, 225) },
    };
  }
  const dvAnchor = d => ({ r: d.ranges[0].r1, c: d.ranges[0].c1 });
  // fn(texto) sobre cada fórmula de la regla (las constantes no cambian)
  function dvMapFormulas(d, fn) {
    for (const k of ['f1', 'f2', 'list']) if (isFormula(d[k])) d[k] = fn(d[k]);
    // puntos de escalas, barras e íconos del formato condicional: arreglos y objetos nuevos (la regla original no cambia)
    for (const k of ['pts', 'th']) if (Array.isArray(d[k])) d[k] = d[k].map(p => isFormula(p.v) ? { ...p, v: fn(p.v) } : p);
    for (const k of ['lo', 'hi']) if (d[k] && isFormula(d[k].v)) d[k] = { ...d[k], v: fn(d[k].v) };
  }
  // las fórmulas de las reglas de validación y de formato condicional de todas las hojas (insertar/eliminar, cortar,
  // renombrar o eliminar hojas)
  function dvFormulasAll(fn) { for (const s of wb.sheets) for (const d of [...(s.dv || []), ...(s.cf || [])]) dvMapFormulas(d, f => fn(f, s)); }
  // La regla con otros rangos, sin cambiar lo que sus fórmulas significan en cada celda (se reescriben para la nueva ancla)
  function dvReanchor(d, ranges) {
    const a = dvAnchor(d), o = { ...d, ranges }, b = dvAnchor(o);
    if (a.r !== b.r || a.c !== b.c) dvMapFormulas(o, f => shiftFormula(f, b.r - a.r, b.c - a.c));
    return o;
  }
  // Insertar o eliminar filas o columnas (shiftRanges): cada rango con shiftRect; las fórmulas quedan escritas para la
  // celda que ahora es el ancla, vista en su posición anterior (structOp ajusta después sus referencias con structural)
  function dvShift(d, axis, at, n) {
    const ranges = d.ranges.map(g => shiftRect(g, axis, at, n)).filter(Boolean);
    if (!ranges.length) return null;
    const a = dvAnchor(d), o = { ...clone(d), ranges }, old = dvAnchor(o);
    if (n > 0 ? old[axis] >= at + n : old[axis] >= at) old[axis] -= n;
    if (old.r !== a.r || old.c !== a.c) dvMapFormulas(o, f => shiftFormula(f, old.r - a.r, old.c - a.c));
    return o;
  }
  // Regla de la celda (r, c) de la hoja S, o null
  const dvAt = (r, c, S = sheet) => (S.dv || []).find(d => d.ranges.some(g => inArea(g, r, c))) || null;
  const overlaps = (a, b) => !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2);
  // g menos h: hasta cuatro rectángulos (arriba, abajo, izquierda, derecha)
  function subRect(g, h) {
    if (!overlaps(g, h)) return [g];
    const out = [], r1 = Math.max(g.r1, h.r1), r2 = Math.min(g.r2, h.r2);
    if (g.r1 < h.r1) out.push({ r1: g.r1, c1: g.c1, r2: h.r1 - 1, c2: g.c2 });
    if (g.r2 > h.r2) out.push({ r1: h.r2 + 1, c1: g.c1, r2: g.r2, c2: g.c2 });
    if (g.c1 < h.c1) out.push({ r1, c1: g.c1, r2, c2: h.c1 - 1 });
    if (g.c2 > h.c2) out.push({ r1, c1: h.c2 + 1, r2, c2: g.c2 });
    return out;
  }
  const dvSubtract = (g, hs) => hs.reduce((parts, h) => parts.flatMap(p => subRect(p, h)), [g]);
  // Agrega g a una lista de rangos, uniéndolo con uno vecino si forman un rectángulo (sin modificar los objetos)
  function pushRange(ranges, g) {
    for (let j = 0; j < ranges.length; j++) {
      const x = ranges[j];
      if (x.c1 === g.c1 && x.c2 === g.c2 && (x.r2 + 1 === g.r1 || g.r2 + 1 === x.r1)) { ranges[j] = { r1: Math.min(x.r1, g.r1), c1: x.c1, r2: Math.max(x.r2, g.r2), c2: x.c2 }; return; }
      if (x.r1 === g.r1 && x.r2 === g.r2 && (x.c2 + 1 === g.c1 || g.c2 + 1 === x.c1)) { ranges[j] = { r1: x.r1, c1: Math.min(x.c1, g.c1), r2: x.r2, c2: Math.max(x.c2, g.c2) }; return; }
    }
    ranges.push({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 });
  }
  // Lista nueva sin los rectángulos hs (las reglas que quedan sin celdas desaparecen)
  function dvRemove(list, hs) {
    const out = [];
    for (const d of list) {
      const ranges = d.ranges.flatMap(g => dvSubtract(g, hs));
      if (!ranges.length) continue;
      out.push(ranges.length === d.ranges.length && ranges.every((g, i) => sameRect(g, d.ranges[i])) ? clone(d) : dvReanchor(clone(d), ranges));
    }
    return out;
  }
  // La regla recortada al rectángulo g, o null si no tiene celdas dentro
  function dvClip(d, g) {
    const ranges = d.ranges.filter(x => overlaps(x, g)).map(x => ({ r1: Math.max(x.r1, g.r1), c1: Math.max(x.c1, g.c1), r2: Math.min(x.r2, g.r2), c2: Math.min(x.c2, g.c2) }));
    return ranges.length ? dvReanchor(d, ranges) : null;
  }
  // Partes de las reglas de la hoja S dentro de g (copiar, cortar, rellenar)
  const dvPieces = (S, g) => (S.dv || []).map(d => dvClip(clone(d), g)).filter(Boolean);
  // La regla desplazada dr filas y dc columnas. copy: como al copiar (las referencias relativas se desplazan); si no,
  // como al cortar (las fórmulas siguen apuntando a las mismas celdas)
  function dvMove(d, dr, dc, copy) {
    const o = { ...clone(d), ranges: d.ranges.map(g => ({ r1: g.r1 + dr, c1: g.c1 + dc, r2: g.r2 + dr, c2: g.c2 + dc })) };
    if (copy) dvMapFormulas(o, f => shiftFormula(f, dr, dc));
    return o;
  }
  // ¿Misma configuración? (las fórmulas de b, llevadas al ancla de a, son iguales a las de a)
  function dvSameConfig(a, b) {
    const pa = dvAnchor(a), pb = dvAnchor(b), t = clone(b);
    dvMapFormulas(t, f => shiftFormula(f, pa.r - pb.r, pa.c - pb.c));
    return deepEq({ ...a, ranges: null }, { ...t, ranges: null });
  }
  // Agrega reglas a la lista; una con la misma configuración que otra se une a ella (pegar o rellenar la misma regla
  // no la parte en pedazos, así "Aplicar estos cambios a otras celdas…" las encuentra juntas)
  function dvAddAll(list, adds) {
    const out = list.slice();
    for (const d of adds) {
      const i = out.findIndex(x => dvSameConfig(x, d));
      if (i < 0) { out.push(d); continue; }
      const rs = out[i].ranges.slice();
      for (const g of d.ranges) for (const p of dvSubtract(g, rs)) pushRange(rs, p);
      out[i] = dvReanchor(clone(out[i]), rs);
    }
    return out;
  }
  // Estilo efectivo y texto mostrado de una celda de cualquier hoja (effStyle y cellText son los de la hoja activa)
  function styleIn(S, r, c) {
    const cell = S.cells[addr(r, c)], cs = S.colS && S.colS[c], rs = S.rowS && S.rowS[r];
    return cs || rs ? { ...cs, ...rs, ...(cell && cell.s) } : (cell && cell.s) || {};
  }
  function textIn(si, r, c) {
    const S = wb.sheets[si], cell = S && S.cells[addr(r, c)], v = eng.value(si, r, c);
    return v === null ? '' : display(v, { v: cell ? cell.v : '', s: styleIn(S, r, c) });
  }
  // Único punto donde la UI evalúa una fórmula suelta (validación de datos y operandos del formato condicional): el
  // texto `text` (con "=") como si estuviera escrito en la celda (r, c) de la hoja si, con la API del motor
  // (eng.evalFormula: no escribe en el libro; los errores vuelven como FErr). ref: una referencia vuelve como objeto
  // rango ({ range, si, r1… }: origen de una lista; dvScalar lo reduce). Se llama después de recalc() + prime()
  function evalAt(si, r, c, text) {
    return eng.evalFormula(si, r, c, text, { ref: true });
  }
  // Valor de la fórmula f de la regla d (escrita para su ancla) en la celda (r, c) de la hoja si
  function dvEval(d, f, si, r, c) {
    const a = dvAnchor(d);
    return evalAt(si, r, c, shiftFormula(f, r - a.r, c - a.c));
  }
  // Un resultado como valor suelto: rango de una celda → su valor; rango mayor → #¡VALOR!; matriz → primer elemento
  function dvScalar(x) {
    if (x && x.range) return x.r1 === x.r2 && x.c1 === x.c2 ? eng.value(x.si, x.r1, x.c1) : Bx.E.value;
    if (Array.isArray(x)) return Array.isArray(x[0]) ? x[0][0] : x[0];
    return x === undefined ? null : x;
  }
  // Elementos de la lista de la regla d en la celda (r, c): [{ t: texto mostrado, v: valor }]. Origen escrito (Sí;No,
  // con ";", el separador de listas de es-CL) o una fórmula: un rango (también de otra hoja) o un nombre definido
  function dvItems(d, si, r, c) {
    const src = String(d.list || '');
    if (!isFormula(src)) return src.split(';').map(t => t.trim()).filter(t => t !== '').map(t => ({ t, v: literal(t) }));
    const x = dvEval(d, src, si, r, c), out = [];
    if (x && x.range) {
      const { r2, c2 } = eng.bounds(x);
      for (let i = x.r1; i <= r2 && out.length < 5000; i++) for (let j = x.c1; j <= c2; j++) out.push({ t: textIn(x.si, i, j), v: eng.value(x.si, i, j) });
    } else if (Array.isArray(x)) {
      for (const row of x) for (const v of Array.isArray(row) ? row : [row]) out.push({ t: display(v ?? null, { v: '' }), v });
    } else if (x != null && !(x instanceof FErr)) out.push({ t: display(x, { v: '' }), v: x });
    return out;
  }
  // Validador puro: ¿el valor v (del motor: número, texto, lógico, error, o null si la celda queda vacía) cumple la
  // regla d? ctx: { text: texto mostrado de lo escrito, evalF(f) → valor de una fórmula de la regla en la celda, items() →
  // elementos de la lista }. La lista compara sin distinguir mayúsculas (decisión por confirmar en Excel)
  function dvCheck(d, v, ctx = {}) {
    if (!d || d.type === 'any') return true;
    if (v === null || v === undefined || v === '') return d.allowBlank !== false;   // "Omitir blancos"
    if (v instanceof FErr) return false;
    if (d.type === 'custom') { const x = dvScalar(ctx.evalF ? ctx.evalF(d.f1) : null); return x === true || (typeof x === 'number' && x !== 0); }
    if (d.type === 'list') {
      const t = dvLow(ctx.text != null ? ctx.text : Bx.toRaw(v));
      return (ctx.items ? ctx.items() : []).some(it => dvLow(it.t) === t || (typeof v === 'number' && it.v === v) || (typeof v === 'string' && typeof it.v === 'string' && dvLow(it.v) === dvLow(v)));
    }
    let x;
    if (d.type === 'length') x = (typeof v === 'string' ? v : Bx.toRaw(v)).length;
    else {
      if (typeof v !== 'number') return false;
      if (d.type === 'whole' && !Number.isInteger(v)) return false;
      x = v;
    }
    // Mínimo y Máximo: número es-CL, fecha dd/mm/aaaa, hora hh:mm o fórmula (una celda vacía cuenta como 0)
    const bound = f => {
      const t = String(f == null ? '' : f).trim();
      const y = isFormula(t) ? dvScalar(ctx.evalF ? ctx.evalF(t) : null) : t === '' ? null : literal(t);
      return y === null ? 0 : y;
    };
    const a = bound(d.f1), b = dvTwoArgs(d.op) ? bound(d.f2) : null;
    if (typeof a !== 'number' || (b !== null && typeof b !== 'number')) return false;
    switch (d.op) {
      case 'notBetween': return x < Math.min(a, b) || x > Math.max(a, b);
      case 'equal': return x === a;
      case 'notEqual': return x !== a;
      case 'greaterThan': return x > a;
      case 'lessThan': return x < a;
      case 'greaterThanOrEqual': return x >= a;
      case 'lessThanOrEqual': return x <= a;
      default: return x >= Math.min(a, b) && x <= Math.max(a, b);
    }
  }
  // ¿Pasa lo escrito (val) en la celda (r, c) de la hoja si? Se evalúa con el valor ya puesto en la celda (una regla
  // Personalizada =A1>0 sobre A1 mira lo nuevo) y después se restaura la celda. → { ok, d }
  function dvVerdict(val, si, r, c) {
    const S = wb.sheets[si], d = S && dvAt(r, c, S);
    if (!d || d.type === 'any') return { ok: true, d };
    const k = addr(r, c), old = S.cells[k];
    setKey(S, k, normCell(entryCell(clone(old) || {}, val, styleIn(S, r, c))));
    eng.recalc(); eng.prime(si);   // evalFormula se llama después de recalc() + prime() (L-005)
    try {
      const ctx = { text: textIn(si, r, c), evalF: f => dvEval(d, f, si, r, c), items: () => dvItems(d, si, r, c) };
      return { ok: dvCheck(d, eng.value(si, r, c), ctx), d };
    } finally { setKey(S, k, old); recalcAll(); }
  }
  // Al confirmar lo escrito (Enter, Tab, flechas, clic en otra celda, Ctrl+Enter): si no es válido y la regla muestra el
  // mensaje de error, lo muestra y devuelve true (la celda sigue en edición). Como Excel, solo valida lo que se escribe:
  // pegar, rellenar o abrir un archivo no validan. accept(): confirmar igual (Advertencia ▸ Sí, Información ▸ Aceptar)
  function dvReject(val, accept) {
    if (!edit) return false;
    const { ok, d } = dvVerdict(val, edit.si, edit.A.r, edit.A.c);
    if (ok || !d.error || d.error.show === false) return false;
    const inp = activeInput();
    dvErrorBox(d).then(ans => {
      if (!edit) return;
      if (ans === 'accept') return accept();
      if (ans === 'cancel') return cancelEdit();   // descarta lo escrito: la celda queda como estaba
      // Reintentar (o No en Advertencia): de vuelta a la edición con todo el texto seleccionado, como Excel
      inp.focus({ preventScroll: true });
      inp.select();   // Reintentar
      updateAssist();
    });
    return true;
  }
  // Mensaje de error de la regla → Promise<'accept' | 'retry' | 'cancel'>. Título propio o "Bassxcel"; sin mensaje propio,
  // el de Excel. Detener: Reintentar / Cancelar · Advertencia: "¿Desea continuar?" Sí / No / Cancelar · Información:
  // Aceptar / Cancelar. Esc = Cancelar
  function dvErrorBox(d) {
    const e = d.error || {}, style = DV_STYLES.includes(e.style) ? e.style : 'stop';
    const body = document.createElement('div');
    body.className = 'dv-err';
    body.innerHTML = `<span class="dv-ico ${style}"></span><p id="dvErrText"></p>`;
    body.querySelector('p').textContent = (e.msg || DV_MSG) + (style === 'warning' ? '\n¿Desea continuar?' : '');
    const o = { id: 'dvErrDlg', title: e.title || 'Bassxcel', body };
    if (style === 'warning') return dlgBox({ ...o, ok: 'Sí', more: [{ text: 'No', value: 'no' }], focus: '.dlg-more' }).then(v => v === true ? 'accept' : v === 'no' ? 'retry' : 'cancel');
    if (style === 'information') return dlgBox({ ...o, ok: 'Aceptar' }).then(v => v ? 'accept' : 'cancel');
    return dlgBox({ ...o, ok: 'Reintentar' }).then(v => v ? 'retry' : 'cancel');
  }

  // ▾ a la derecha de la celda activa (regla de lista con "Celda con lista desplegable") y mensaje de entrada debajo.
  // Capas absolutas de #gridInner: se redibujan con la selección y al desplazar con paneles inmovilizados (L-013)
  const dvBtn = document.createElement('button');
  dvBtn.id = 'dvBtn'; dvBtn.type = 'button'; dvBtn.tabIndex = -1; dvBtn.textContent = '▾'; dvBtn.title = 'Elegir de la lista (Alt+↓)';
  $('#gridInner').appendChild(dvBtn);
  const dvTip = document.createElement('div');
  dvTip.id = 'dvTip';
  $('#gridInner').appendChild(dvTip);
  function drawDv() {
    if (!sheet) return;
    if (dvPop && (dvPop.si !== wb.active || dvPop.r !== A.r || dvPop.c !== A.c)) closeDvList();
    const d = dvAt(A.r, A.c), vis = d && !isHidden(A.r) && !isHiddenCol(A.c);
    const R = vis ? rect((sheet.merges && mergeAt(A.r, A.c)) || { r1: A.r, c1: A.c, r2: A.r, c2: A.c }) : null;
    if (vis && d.type === 'list' && d.inCell !== false) {
      const h = Math.min(R.height + 1, 20);
      dvBtn.style.left = R.left + R.width + 1 + 'px';
      dvBtn.style.top = R.top + R.height + 1 - h + 'px';
      dvBtn.style.height = h + 'px';
      dvBtn.style.display = 'block';
    } else dvBtn.style.display = 'none';
    const inp = vis && d.input;
    if (inp && inp.show !== false && (inp.title || inp.msg)) {
      dvTip.innerHTML = (inp.title ? `<b>${esc(inp.title)}</b>` : '') + (inp.msg ? `<div>${esc(inp.msg)}</div>` : '');
      dvTip.style.left = R.left + Math.min(Math.round(R.width / 2), 48) + 'px';
      dvTip.style.top = R.top + R.height + 6 + 'px';
      dvTip.style.display = 'block';
    } else dvTip.style.display = 'none';
  }
  // Lista desplegable: clic en ▾ o Alt+↓; ↑/↓, RePág/AvPág, Inicio/Fin y Enter eligen; Esc o Alt+↑ cierran. Muestra el
  // texto mostrado del origen, hasta DV_ROWS elementos a la vista. Elegir es como escribir el elemento (un paso de deshacer)
  let dvPop = null;   // { el, items, idx, si, r, c }
  function closeDvList() { if (dvPop) { dvPop.el.remove(); dvPop = null; } }
  function openDvList() {
    if (edit && !commitEdit()) return;
    const d = dvAt(A.r, A.c);
    if (!d || d.type !== 'list' || d.inCell === false) return;
    closeDvList();
    hideMenu();
    const items = dvItems(d, wb.active, A.r, A.c), el = document.createElement('div');
    el.id = 'dvList';
    el.setAttribute('role', 'listbox');
    items.forEach((it, i) => { const o = document.createElement('div'); o.textContent = it.t; o.dataset.i = i; o.setAttribute('role', 'option'); el.appendChild(o); });
    // elemento marcado al abrir: el valor actual de la celda o, si no está en la lista, el primero
    const cur = dvLow(cellText(A.r, A.c));
    let idx = cur ? items.findIndex(it => dvLow(it.t) === cur) : -1;
    if (idx < 0) idx = 0;
    document.body.appendChild(el);
    const ih = el.firstChild ? el.firstChild.offsetHeight : 18;
    el.style.maxHeight = DV_ROWS * ih + 2 + 'px';
    const b = actBox.getBoundingClientRect();
    el.style.minWidth = Math.max(b.width + 16, 48) + 'px';
    const top = b.bottom + el.offsetHeight > innerHeight - 4 ? Math.max(4, b.top - el.offsetHeight) : b.bottom;
    el.style.left = Math.max(0, Math.min(b.left, innerWidth - el.offsetWidth - 4)) + 'px';
    el.style.top = top + 'px';
    dvPop = { el, items, idx: items.length ? idx : -1, si: wb.active, r: A.r, c: A.c };
    dvMark();
    el.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('mousemove', e => { const o = e.target.closest('[data-i]'); if (o && dvPop && +o.dataset.i !== dvPop.idx) { dvPop.idx = +o.dataset.i; dvMark(false); } });
    el.addEventListener('click', e => { const o = e.target.closest('[data-i]'); if (o) dvChoose(+o.dataset.i); });
  }
  function dvMark(scroll = true) {
    const { el, idx } = dvPop, o = el.children[idx];
    [...el.children].forEach((x, i) => x.classList.toggle('on', i === idx));
    if (!scroll || !o) return;
    if (o.offsetTop < el.scrollTop) el.scrollTop = o.offsetTop;
    else if (o.offsetTop + o.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = o.offsetTop + o.offsetHeight - el.clientHeight;
  }
  function dvChoose(i) {
    const p = dvPop;
    closeDvList();
    const it = p && p.items[i];
    if (!it || p.si !== wb.active) return;
    setRaw(p.r, p.c, it.t);   // misma lógica de entrada que escribirlo ("1,5" es un número); la activa no se mueve
    wrap.focus({ preventScroll: true });
  }
  // Teclado con la lista abierta → true si la tecla era de la lista (otra tecla la cierra y sigue su curso)
  function dvListKey(e) {
    const k = e.key, n = dvPop.items.length;
    if (['Shift', 'Control', 'Alt', 'AltGraph', 'Meta'].includes(k)) return true;
    const go = i => { e.preventDefault(); if (n) { dvPop.idx = Math.max(0, Math.min(n - 1, i)); dvMark(); } return true; };
    if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); closeDvList(); return true; }
    if (k === 'ArrowDown') return go(dvPop.idx + 1);
    if (k === 'ArrowUp') return go(dvPop.idx - 1);
    if (k === 'PageDown') return go(dvPop.idx + DV_ROWS - 1);
    if (k === 'PageUp') return go(dvPop.idx - DV_ROWS + 1);
    if (k === 'Home') return go(0);
    if (k === 'End') return go(n - 1);
    if (k === 'Enter') { e.preventDefault(); dvChoose(dvPop.idx); return true; }
    if (k === 'Escape') { e.preventDefault(); closeDvList(); return true; }
    closeDvList();
    return false;
  }
  dvBtn.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();   // (el mousedown del documento cerraría la lista que este clic abre)
    if (e.button !== 0) return;
    if (dvPop) closeDvList(); else openDvList();
  });
  document.addEventListener('mousedown', e => { if (dvPop && !dvPop.el.contains(e.target)) closeDvList(); });

  // ▾ "Validación de datos" de la cinta (Rodear con un círculo / Borrar círculos: P2, deshabilitados)
  function dvMenu() {
    const b = $('[data-cmd="dv"]').getBoundingClientRect();
    showMenu({ clientX: b.left, clientY: b.bottom }, [
      ['Validación de datos…', openDvDialog],
      ['Rodear con un círculo datos no válidos', null], ['Borrar círculos de validación', null],
    ]);
  }
  const yesNo = text => { const p = document.createElement('p'); p.textContent = text; return dlgBox({ id: 'dvAskDlg', body: p, ok: 'Sí', cancel: 'No' }); };
  // Con la selección sobre varias reglas, o sobre una regla y celdas sin validación, Excel pregunta antes de abrir el cuadro
  async function openDvDialog() {
    if (edit && !commitEdit()) return;
    hideMenu();
    const gs = [range(), ...extra];   // el rango de la celda activa primero: su esquina es el ancla de la regla
    const hits = (sheet.dv || []).filter(d => d.ranges.some(g => gs.some(h => overlaps(g, h))));
    let base = dvAt(A.r, A.c);
    if (hits.length > 1) {
      if (!await yesNo('La selección contiene más de un tipo de validación. ¿Desea borrar la configuración actual y continuar?')) return false;
      base = null;
    } else if (hits.length === 1 && gs.some(g => dvSubtract(g, hits[0].ranges).length)) {
      if (!await yesNo('La selección contiene algunas celdas sin configuración de validación de datos. ¿Desea extender la validación a estas celdas?')) return false;
      base = hits[0];
    }
    return dvDialog(base, gs);
  }
  // Cuadro "Validación de datos" con sus tres pestañas; base: regla que se edita (o null). Aceptar aplica la regla a la
  // selección (o, con "Aplicar estos cambios…", a todas las celdas de la regla) en un paso de deshacer
  function dvDialog(base, gs) {
    const body = document.createElement('div');
    body.innerHTML = `<div class="dv-tabs" role="tablist"><button type="button" class="dv-tab on" role="tab">Configuración</button><button type="button" class="dv-tab" role="tab">Mensaje de entrada</button><button type="button" class="dv-tab" role="tab">Mensaje de error</button></div>
      <div class="dv-page" id="dvPage0"><fieldset><legend>Criterio de validación</legend>
        <div class="dv-grid"><label>Permitir:<select id="dvType"></select></label><label class="chk"><input type="checkbox" id="dvBlank"> Omitir blancos</label>
        <label id="dvOpL">Datos:<select id="dvOp"></select></label><label class="chk" id="dvInCellL"><input type="checkbox" id="dvInCell"> Celda con lista desplegable</label></div>
        <label id="dvF1L"><span id="dvF1T">Mínimo:</span><input id="dvF1" spellcheck="false" autocomplete="off"></label>
        <label id="dvF2L"><span id="dvF2T">Máximo:</span><input id="dvF2" spellcheck="false" autocomplete="off"></label>
        <label id="dvSrcL">Origen:<input id="dvSrc" spellcheck="false" autocomplete="off"></label>
        <label id="dvFmlL">Fórmula:<input id="dvFml" spellcheck="false" autocomplete="off"></label></fieldset>
        <label class="chk"><input type="checkbox" id="dvAll"> Aplicar estos cambios a otras celdas con la misma configuración</label></div>
      <div class="dv-page" id="dvPage1" hidden><label class="chk"><input type="checkbox" id="dvInShow"> Mostrar mensaje de entrada al seleccionar la celda</label>
        <p>Cuando se seleccione la celda, mostrar este mensaje de entrada:</p>
        <label>Título:<input id="dvInTitle" maxlength="32" autocomplete="off"></label><label>Mensaje de entrada:<textarea id="dvInMsg" rows="4" maxlength="255"></textarea></label></div>
      <div class="dv-page" id="dvPage2" hidden><label class="chk"><input type="checkbox" id="dvErrShow"> Mostrar mensaje de error si se introducen datos no válidos</label>
        <p>Cuando se introduzcan datos no válidos, mostrar este mensaje de error:</p>
        <label>Estilo:<select id="dvErrStyle"><option value="stop">Detener</option><option value="warning">Advertencia</option><option value="information">Información</option></select></label>
        <label>Título:<input id="dvErrTitle" maxlength="32" autocomplete="off"></label><label>Mensaje de error:<textarea id="dvErrMsg" rows="4" maxlength="225"></textarea></label></div>`;
    const q = s => body.querySelector(s), typeSel = q('#dvType'), opSel = q('#dvOp');
    for (const [v, t] of DV_TYPES) typeSel.add(new Option(t, v));
    for (const [v, t] of DV_OPS) opSel.add(new Option(t, v));
    const a = { r: gs[0].r1, c: gs[0].c1 };   // ancla de la regla nueva
    // las fórmulas se muestran y se escriben para la celda activa, como Excel; se guardan para el ancla
    const toActive = (d, f) => isFormula(f) ? shiftFormula(f, A.r - dvAnchor(d).r, A.c - dvAnchor(d).c) : f;
    const fromActive = f => isFormula(f) ? shiftFormula(f, a.r - A.r, a.c - A.c) : f;
    const LBL = { date: ['Fecha de inicio:', 'Fecha de finalización:', 'Fecha:'], time: ['Hora de inicio:', 'Hora de finalización:', 'Hora:'], length: ['Mínimo:', 'Máximo:', 'Longitud:'] };
    const RANGED = ['whole', 'decimal', 'date', 'time', 'length'];
    const layout = () => {
      const t = typeSel.value, op = opSel.value, ranged = RANGED.includes(t);
      const show = (id, on) => { q(id).hidden = !on; };
      show('#dvOpL', ranged); show('#dvF1L', ranged); show('#dvF2L', ranged && dvTwoArgs(op));
      show('#dvInCellL', t === 'list'); show('#dvSrcL', t === 'list'); show('#dvFmlL', t === 'custom');
      q('#dvBlank').disabled = t === 'any';
      const L = LBL[t] || ['Mínimo:', 'Máximo:', 'Valor:'];
      q('#dvF1T').textContent = dvTwoArgs(op) || op === 'greaterThan' || op === 'greaterThanOrEqual' ? L[0] : op === 'equal' || op === 'notEqual' ? L[2] : L[1];
      q('#dvF2T').textContent = L[1];
    };
    const fill = d => {
      typeSel.value = d ? d.type : 'any';
      opSel.value = d ? d.op : 'between';
      q('#dvBlank').checked = d ? d.allowBlank !== false : true;
      q('#dvInCell').checked = d ? d.inCell !== false : true;
      const ranged = d && RANGED.includes(d.type);
      q('#dvF1').value = ranged ? toActive(d, d.f1) : '';
      q('#dvF2').value = ranged && dvTwoArgs(d.op) ? toActive(d, d.f2) : '';
      q('#dvSrc').value = d && d.type === 'list' ? toActive(d, d.list) : '';
      q('#dvFml').value = d && d.type === 'custom' ? toActive(d, d.f1) : '';
      const i = (d && d.input) || {}, e = (d && d.error) || {};
      q('#dvInShow').checked = i.show !== false; q('#dvInTitle').value = i.title || ''; q('#dvInMsg').value = i.msg || '';
      q('#dvErrShow').checked = e.show !== false; q('#dvErrStyle').value = e.style || 'stop';
      q('#dvErrTitle').value = e.title || ''; q('#dvErrMsg').value = e.msg || '';
      layout();
    };
    fill(base);
    q('#dvAll').disabled = !base;   // solo al editar una regla existente
    typeSel.onchange = layout; opSel.onchange = layout;
    // pestañas: clic, o Ctrl+AvPág / Ctrl+RePág (en el navegador Chrome se reserva esas teclas; en la app de escritorio no)
    const tabs = [...body.querySelectorAll('.dv-tab')], pages = [0, 1, 2].map(i => q('#dvPage' + i));
    const tab = i => { tabs.forEach((b, j) => { b.classList.toggle('on', i === j); b.setAttribute('aria-selected', String(i === j)); }); pages.forEach((p, j) => { p.hidden = i !== j; }); };
    tabs.forEach((b, i) => { b.onclick = () => tab(i); });
    body.addEventListener('keydown', e => {
      if (!e.ctrlKey || (e.key !== 'PageDown' && e.key !== 'PageUp')) return;
      e.preventDefault();
      const i = tabs.findIndex(b => b.classList.contains('on'));
      tab((i + (e.key === 'PageDown' ? 1 : 2)) % 3);
    });
    // Revisión al aceptar → null (válido), texto del mensaje, o { ask } si hay que preguntar
    let forced = false;
    const check = () => {
      const t = typeSel.value, op = opSel.value, val = id => q(id).value.trim();
      const label = id => q(id).textContent.replace(/:$/, '');
      const field = (id, tid, kind) => {
        const v = val(id);
        if (!v) return { id, msg: `Debe escribir un valor en "${label(tid)}".` };
        if (isFormula(v)) { const bad = Bx.checkFormula(v); return bad ? { id, msg: bad.message } : null; }
        if (typeof literal(v) === 'number') return null;
        return { id, msg: `"${label(tid)}" debe ser ${kind === 'date' ? 'una fecha (dd/mm/aaaa)' : kind === 'time' ? 'una hora (hh:mm)' : 'un número'}, una referencia a una celda o una fórmula.` };
      };
      if (RANGED.includes(t)) {
        const e1 = field('#dvF1', '#dvF1T', t);
        if (e1) return e1;
        if (dvTwoArgs(op)) {
          const e2 = field('#dvF2', '#dvF2T', t);
          if (e2) return e2;
          const x = literal(val('#dvF1')), y = literal(val('#dvF2'));
          if (typeof x === 'number' && typeof y === 'number' && x > y) return { id: '#dvF2', msg: 'El valor Máximo debe ser mayor o igual que el valor Mínimo.' };
        }
      } else if (t === 'list') {
        const v = val('#dvSrc');
        if (!v) return { id: '#dvSrc', msg: 'Debe escribir el origen de la lista: valores separados por punto y coma (Sí;No) o una referencia (=$E$1:$E$5).' };
        if (isFormula(v)) {
          const bad = Bx.checkFormula(v);
          if (bad) return { id: '#dvSrc', msg: bad.message };
          const x = dvEval({ ranges: [{ r1: A.r, c1: A.c, r2: A.r, c2: A.c }] }, v, wb.active, A.r, A.c);
          if (x && x.range && x.r1 !== x.r2 && x.c1 !== x.c2) return { id: '#dvSrc', msg: 'El origen de la lista debe ser una lista delimitada o una referencia a una sola fila o columna.' };
          if (x instanceof FErr && !forced) return { id: '#dvSrc', ask: 'El origen actualmente se evalúa como un error. ¿Desea continuar?' };
        }
      } else if (t === 'custom') {
        const v = val('#dvFml');
        if (!v) return { id: '#dvFml', msg: 'Debe escribir una fórmula (por ejemplo, =A1>0).' };
        const bad = Bx.checkFormula(v.startsWith('=') ? v : '=' + v);
        if (bad) return { id: '#dvFml', msg: bad.message };
      }
      return null;
    };
    const onOk = () => {
      const err = check();
      if (!err) return true;
      const back = () => { tab(0); const f = q(err.id); f.focus(); f.select(); };
      if (err.ask) yesNo(err.ask).then(yes => { if (yes) { forced = true; body.closest('dialog').querySelector('.dlg-ok').click(); } else back(); });
      else msgBox(err.msg).then(back);
      return false;
    };
    const build = () => {
      const t = typeSel.value, op = opSel.value, val = id => q(id).value.trim();
      let f1 = '', f2 = '', list = '';
      if (t === 'list') list = fromActive(val('#dvSrc'));
      else if (t === 'custom') { const f = val('#dvFml'); f1 = fromActive(f.startsWith('=') ? f : '=' + f); }
      else if (t !== 'any') { f1 = fromActive(val('#dvF1')); if (dvTwoArgs(op)) f2 = fromActive(val('#dvF2')); }
      return normDv({
        ranges: gs.map(g => ({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 })), type: t, op, f1, f2, allowBlank: q('#dvBlank').checked, list, inCell: q('#dvInCell').checked,
        input: { show: q('#dvInShow').checked, title: q('#dvInTitle').value, msg: q('#dvInMsg').value },
        error: { show: q('#dvErrShow').checked, style: q('#dvErrStyle').value, title: q('#dvErrTitle').value, msg: q('#dvErrMsg').value },
      });
    };
    // "Borrar todos": el cuadro vuelve a Cualquier valor y sin mensajes; Aceptar quita la validación
    const clearAllDv = () => { fill(null); q('#dvAll').checked = false; };
    return dlgBox({ id: 'dvDlg', title: 'Validación de datos', body, onOk, focus: '#dvType', aside: [{ id: 'dvClear', text: 'Borrar todos', onClick: clearAllDv }] }).then(yes => {
      if (!yes) return false;
      const d = build(), all = !!base && q('#dvAll').checked;
      const none = d.type === 'any' && !d.input.title && !d.input.msg;   // sin restricción ni mensaje: no queda regla
      snapshotOp(() => {
        let list = dvRemove((sheet.dv || []).filter(x => !all || x !== base), gs);
        if (!none) {
          let rule = d;
          if (all) { const rs = base.ranges.map(g => ({ ...g })); for (const g of gs) for (const p of dvSubtract(g, rs)) pushRange(rs, p); rule = dvReanchor(d, rs); }
          list = dvAddAll(list, [rule]);   // extender una regla a celdas vecinas la deja como una sola regla
        }
        setDv(sheet, list);
      });
      return true;
    });
  }

  // ---------- Formato condicional (Inicio ▸ Estilos ▸ Formato condicional) ----------
  // sheet.cf: reglas en orden de prioridad (la primera es la de mayor prioridad: gana en las propiedades en conflicto y
  // las demás se combinan; "Detener si es verdad" corta las de abajo). Cada regla: { ranges, type, …parámetros, style,
  // stop }. Las fórmulas (f1, f2) están escritas para la celda superior izquierda de ranges[0], como en la validación:
  // dvShift, dvReanchor, dvClip, dvMove, dvRemove, dvSameConfig y dvFormulasAll sirven para las dos listas. El formato
  // condicional se dibuja encima del formato de la celda y no lo cambia (effStyle no lo incluye; copiar el formato de
  // la celda no lo lleva). Tipos de la parte 1; la 5e agrega 'scale', 'bar' e 'icons' (cfMatch devolverá su estilo
  // calculado en vez de verdadero/falso, y normCf sus parámetros). Ronda 5e: 'scale' (escala de 2 o 3 colores: pts),
  // 'bar' (barra de datos: lo, hi, color, grad, border, neg, axis, only) e 'icons' (conjunto de íconos: set, th, rev,
  // only). Sus puntos { k, v } son los cfvo de Excel: k = min, max, auto, num, percent, formula o percentile; v, el texto
  // es-CL o la fórmula (solo referencias absolutas, como exige Excel en estos tres tipos)
  const CF_TYPES = ['cellIs', 'text', 'date', 'blanks', 'noBlanks', 'errors', 'noErrors', 'top', 'avg', 'dup', 'expr', 'scale', 'bar', 'icons'];
  // Tipos visuales ("Aplicar formato a todas las celdas según sus valores"): sin estilo propio y sin "Detener si es
  // verdad" (Excel no deja marcarlo en barras, escalas ni íconos); solo dan formato a los números
  const CF_VIS = new Set(['scale', 'bar', 'icons']);
  const CFVO = { min: 'Valor más bajo', max: 'Valor más alto', auto: 'Automático', num: 'Número', percent: 'Porcentaje', formula: 'Fórmula', percentile: 'Percentil' };
  const CFVO_MID = ['num', 'percent', 'formula', 'percentile'], CFVO_LO = ['min', ...CFVO_MID], CFVO_HI = ['max', ...CFVO_MID];
  const CFVO_BLO = ['auto', ...CFVO_LO], CFVO_BHI = ['auto', ...CFVO_HI];
  const CF_REL_MSG = 'No se pueden usar referencias relativas en los criterios de formato condicional de escalas de color, barras de datos y conjuntos de íconos.';
  // Colores de las galerías de Excel: escalas (rojo, amarillo, verde, blanco, azul) y barras de datos
  const CFK = { r: '#f8696b', y: '#ffeb84', g: '#63be7b', w: '#fcfcff', b: '#5a8ac6', y2: '#ffef9c' };
  // Escalas de la galería: [nombre, colores de los valores altos a los bajos (como el ícono: arriba, los altos)]
  const CF_SCALES = [['Verde - Amarillo - Rojo', 'g y r'], ['Rojo - Amarillo - Verde', 'r y g'], ['Verde - Blanco - Rojo', 'g w r'], ['Rojo - Blanco - Verde', 'r w g'],
    ['Azul - Blanco - Rojo', 'b w r'], ['Rojo - Blanco - Azul', 'r w b'], ['Verde - Blanco', 'g w'], ['Blanco - Verde', 'w g'], ['Rojo - Blanco', 'r w'], ['Blanco - Rojo', 'w r'],
    ['Verde - Amarillo', 'g y2'], ['Amarillo - Verde', 'y2 g']].map(([n, k]) => [n, k.split(' ').map(x => CFK[x])]);
  const CF_BARS = [['azul', '#638ec6'], ['verde', '#63c384'], ['rojo', '#ff555a'], ['naranja', '#ffb628'], ['celeste', '#008aef'], ['morado', '#d6007b']];
  // Conjuntos de íconos: [clave, nombre, grupo de la galería, íconos del más alto al más bajo]
  const CF_ICONSETS = [
    ['3arrows', '3 flechas (de color)', 'Direccional', ['upG', 'rightY', 'downR']], ['3arrowsGray', '3 flechas (gris)', 'Direccional', ['upK', 'rightK', 'downK']],
    ['4arrows', '4 flechas (de color)', 'Direccional', ['upG', 'upRightY', 'downRightY', 'downR']], ['5arrows', '5 flechas (de color)', 'Direccional', ['upG', 'upRightY', 'rightY', 'downRightY', 'downR']],
    ['3traffic', '3 semáforos (sin marco)', 'Formas', ['cirG', 'cirY', 'cirR']], ['3signs', '3 señales', 'Formas', ['cirG', 'triY', 'diaR']],
    ['3symbols', '3 símbolos (en un círculo)', 'Indicadores', ['okG', 'warnY', 'noR']], ['3flags', '3 banderas', 'Indicadores', ['flagG', 'flagY', 'flagR']],
    ['3stars', '3 estrellas', 'Valoraciones', ['star2', 'star1', 'star0']], ['4ratings', '4 valoraciones', 'Valoraciones', ['bars4', 'bars3', 'bars2', 'bars1']],
    ['5ratings', '5 valoraciones', 'Valoraciones', ['bars4', 'bars3', 'bars2', 'bars1', 'bars0']]];
  // Umbrales por omisión de Excel (porcentajes, operador >=): partes iguales del rango
  const CF_ICON_DEF = { 3: ['67', '33'], 4: ['75', '50', '25'], 5: ['80', '60', '40', '20'] };
  const cfIconSet = k => CF_ICONSETS.find(x => x[0] === k) || null;
  const CF_TEXT_OPS = [['contains', 'que contiene'], ['notContains', 'que no contiene'], ['beginsWith', 'que comienza con'], ['endsWith', 'que termina en']];
  const CF_PERIODS = [['yesterday', 'Ayer'], ['today', 'Hoy'], ['tomorrow', 'Mañana'], ['last7', 'En los últimos 7 días'], ['lastWeek', 'Semana pasada'],
    ['thisWeek', 'Esta semana'], ['nextWeek', 'Semana próxima'], ['lastMonth', 'Mes pasado'], ['thisMonth', 'Este mes'], ['nextMonth', 'Mes próximo']];
  // Formatos predefinidos de los cuadros rápidos (colores de los estilos de Excel)
  const CF_PRESETS = [
    ['Relleno rojo claro con texto rojo oscuro', { bg: '#ffc7ce', fg: '#9c0006' }],
    ['Relleno amarillo con texto amarillo oscuro', { bg: '#ffeb9c', fg: '#9c5700' }],
    ['Relleno verde con texto verde oscuro', { bg: '#c6efce', fg: '#006100' }],
    ['Relleno rojo claro', { bg: '#ffc7ce' }],
    ['Texto rojo', { fg: '#9c0006' }],
    ['Borde rojo', { bd: '#9c0006' }],
  ];
  const CF_AVG = [['above', 'por encima', 0, false, false], ['below', 'por debajo', 0, true, false], ['eqAbove', 'igual o por encima', 0, false, true], ['eqBelow', 'igual o por debajo', 0, true, true],
    ['sd1a', '1 desv. est. por encima', 1, false, false], ['sd2a', '2 desv. est. por encima', 2, false, false], ['sd3a', '3 desv. est. por encima', 3, false, false],
    ['sd1b', '1 desv. est. por debajo', 1, true, false], ['sd2b', '2 desv. est. por debajo', 2, true, false], ['sd3b', '3 desv. est. por debajo', 3, true, false]];
  const CF_XLSX_LOSS = 'Este libro tiene formato condicional y Bassxcel todavía no lo guarda en .xlsx: el archivo exportado tendrá los datos, pero no las reglas de formato condicional.\n\n¿Desea exportar de todos modos?';
  const CF_NONE = Object.freeze([]);
  // Aviso de exportación a .xlsx: lo que SheetJS CE no escribe (null si no se pierde nada)
  function xlsxLossText() {
    const dv = wb.sheets.some(s => s.dv && s.dv.length), cf = wb.sheets.some(s => s.cf && s.cf.length);
    if (dv && cf) return 'Este libro tiene validación de datos y formato condicional, y Bassxcel todavía no los guarda en .xlsx: el archivo exportado tendrá los datos, pero no las reglas de validación, las listas desplegables ni las reglas de formato condicional.\n\n¿Desea exportar de todos modos?';
    return dv ? DV_XLSX_LOSS : cf ? CF_XLSX_LOSS : null;
  }
  function setCf(S, list) { if (list && list.length) S.cf = list; else delete S.cf; }
  const isColor = x => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);
  // Formatos de número de la pestaña Número ('' = la regla no cambia el de la celda) y los que llevan decimales
  const CF_NUM_FMTS = [['', '(sin cambiar)'], ['general', 'General'], ['number', 'Número'], ['currency', 'Moneda'], ['percent', 'Porcentaje'], ['scientific', 'Científica'],
    ['date', 'Fecha'], ['time', 'Hora'], ['datetime', 'Fecha y hora']];
  const CF_DEC_FMTS = ['number', 'currency', 'percent', 'scientific'];
  // Estilo de una regla: colores de relleno (bg), fuente (fg) y borde (bd); negrita, cursiva, subrayado y tachado (st);
  // formato de número (fmt) con sus decimales (dec: null = los del formato, también si la celda tenía otros)
  function normCfStyle(s) {
    const o = {};
    if (!s || typeof s !== 'object') return o;
    for (const k of ['bg', 'fg', 'bd']) if (isColor(s[k])) o[k] = s[k].toLowerCase();
    for (const k of ['b', 'i', 'u', 'st']) if (s[k] === true) o[k] = true;
    if (CF_NUM_FMTS.some(x => x[0] && x[0] === s.fmt)) { o.fmt = s.fmt; o.dec = CF_DEC_FMTS.includes(s.fmt) && Number.isInteger(s.dec) && s.dec >= 0 && s.dec <= 30 ? s.dec : null; }
    return o;
  }
  // Regla de un archivo o de un cuadro → regla completa (claves siempre en el mismo orden), o null si está mal formada
  function normCf(d) {
    if (!d || !Array.isArray(d.ranges) || !CF_TYPES.includes(d.type)) return null;
    const int = x => Number.isInteger(x) && x >= 0;
    const ranges = d.ranges.filter(g => g && int(g.r1) && int(g.c1) && int(g.r2) && int(g.c2) && g.r2 >= g.r1 && g.c2 >= g.c1).map(g => ({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 }));
    if (!ranges.length) return null;
    const str = x => x == null ? '' : String(x).trim(), o = { ranges, type: d.type };
    if (d.type === 'cellIs') { o.op = DV_OPS.some(x => x[0] === d.op) ? d.op : 'greaterThan'; o.f1 = str(d.f1); if (dvTwoArgs(o.op)) o.f2 = str(d.f2); }
    else if (d.type === 'text') { o.op = CF_TEXT_OPS.some(x => x[0] === d.op) ? d.op : 'contains'; o.f1 = str(d.f1); }
    else if (d.type === 'date') o.period = CF_PERIODS.some(x => x[0] === d.period) ? d.period : 'today';
    else if (d.type === 'top') {
      o.bottom = d.bottom === true; o.percent = d.percent === true;
      o.rank = Math.min(o.percent ? 100 : 1000, Math.max(1, Math.round(+d.rank) || 10));   // límites de Excel
    } else if (d.type === 'avg') { o.below = d.below === true; o.sd = [1, 2, 3].includes(d.sd) ? d.sd : 0; o.equal = !o.sd && d.equal === true; }
    else if (d.type === 'dup') o.unique = d.unique === true;
    else if (d.type === 'expr') { o.f1 = str(d.f1); if (!isFormula(o.f1)) return null; }
    else if (d.type === 'scale') {
      const ps = Array.isArray(d.pts) && (d.pts.length === 2 || d.pts.length === 3) ? d.pts : null;
      if (!ps) return null;
      const n = ps.length, def = n === 2 ? [['min', '', '#ff7128'], ['max', '', '#ffef9c']] : [['min', '', CFK.r], ['percentile', '50', CFK.y], ['max', '', CFK.g]];
      o.pts = ps.map((p, i) => ({ ...cfvoNorm(p, i === 0 ? CFVO_LO : i === n - 1 ? CFVO_HI : CFVO_MID, def[i][0], def[i][1]), color: isColor(p && p.color) ? p.color.toLowerCase() : def[i][2] }));
    } else if (d.type === 'bar') {
      o.lo = cfvoNorm(d.lo, CFVO_BLO, 'auto', ''); o.hi = cfvoNorm(d.hi, CFVO_BHI, 'auto', '');
      o.color = isColor(d.color) ? d.color.toLowerCase() : CF_BARS[0][1];
      o.grad = d.grad !== false; o.border = d.border === true;
      o.neg = isColor(d.neg) ? d.neg.toLowerCase() : '#ff0000';
      o.axis = ['auto', 'mid', 'none'].includes(d.axis) ? d.axis : 'auto';
      o.only = d.only === true;
    } else if (d.type === 'icons') {
      const set = cfIconSet(d.set) || cfIconSet('3traffic'), n = set[3].length, th = Array.isArray(d.th) ? d.th : [];
      o.set = set[0];
      o.th = CF_ICON_DEF[n].map((v, i) => ({ op: th[i] && th[i].op === 'gt' ? 'gt' : 'gte', ...cfvoNorm(th[i], CFVO_MID, 'percent', v) }));
      o.rev = d.rev === true; o.only = d.only === true;
    }
    o.style = CF_VIS.has(d.type) ? {} : normCfStyle(d.style);
    o.stop = !CF_VIS.has(d.type) && d.stop === true;   // Excel no deja marcarlo en escalas, barras ni íconos
    return o;
  }
  // Un punto (cfvo) de un archivo o de un cuadro: tipo permitido (o el de omisión) y su valor como texto
  function cfvoNorm(p, kinds, k0, v0) {
    const k = p && kinds.includes(p.k) ? p.k : k0;
    if (k === 'min' || k === 'max' || k === 'auto') return { k, v: '' };
    const v = p && p.k === k && p.v != null ? String(p.v).trim() : '';
    return { k, v: v || (k === k0 ? v0 : '') };
  }
  // Reglas de la hoja S (índice si) que se dibujan: las de la vista previa de un cuadro abierto, o las guardadas
  const cfList = (S, si) => cfPreview && cfPreview.si === si && wb.sheets[si] === S ? cfPreview.list : S.cf || CF_NONE;
  // Partes de las reglas de S dentro de g (copiar, cortar, rellenar)
  const cfPieces = (S, g) => (S.cf || []).map(d => dvClip(clone(d), g)).filter(Boolean);
  // Agrega reglas a la lista: una con la misma configuración que otra se une a ella (pegar o rellenar la misma regla no
  // la multiplica); las demás entran arriba, con la mayor prioridad y en su orden, como una regla nueva de Excel
  function cfAddAll(list, adds) {
    const out = list.slice(), fresh = [];
    const join = (arr, d) => {
      const i = arr.findIndex(x => dvSameConfig(x, d));
      if (i < 0) return false;
      const rs = arr[i].ranges.slice();
      for (const g of d.ranges) for (const p of dvSubtract(g, rs)) pushRange(rs, p);
      arr[i] = dvReanchor(clone(arr[i]), rs);
      return true;
    };
    for (const d of adds) if (!join(out, d) && !join(fresh, d)) fresh.push(d);
    return [...fresh, ...out];
  }
  // Pegar reglas copiadas en `to` (reemplazan las del destino), una vez por cada desplazamiento [dr, dc] (repeticiones)
  function cfPaste(list, rules, to, moves) {
    let out = dvRemove(list, [to]);
    for (const [dr, dc] of moves) out = cfAddAll(out, rules.map(d => dvMove(d, dr, dc, true)));
    return out;
  }
  // Estilo de la celda con el formato condicional encima (para dibujar e imprimir la hoja activa)
  function withCf(s, r, c) {
    const cf = sheet.cf || cfPreview ? cfStyle(sheet, wb.active, r, c) : null;
    return cf ? { ...s, ...cf } : s;
  }
  function cfRefresh() { cfMemo = null; paintAll(); drawMerges(); }

  // Fecha de hoy como serial de Excel (la de la computadora, como HOY()); los arneses la fijan con __bxCf.setToday
  let cfTodayFix = null;
  function cfToday() {
    if (cfTodayFix != null) return cfTodayFix;
    const d = new Date();
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5);
  }
  const cfYm = x => { const d = serialDate(x); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  // Valor de un operando (Mínimo, Máximo, texto): constante es-CL (1,5 · 01/02/2026 · Sí) o fórmula relativa a la celda
  function cfOperand(d, f, si, r, c) {
    const t = String(f == null ? '' : f).trim();
    if (isFormula(t)) return dvScalar(dvEval(d, t, si, r, c));
    return t === '' ? null : literal(t);
  }
  const cfBlank = v => v === null || (typeof v === 'string' && v.trim() === '');   // LEN(TRIM(celda))=0
  // Texto de un valor para las reglas de texto (como HALLAR: el número sin formato, con coma decimal)
  const cfText = v => v === null ? '' : typeof v === 'string' ? v : Bx.toRaw(v);
  // Clave de "Duplicar valores": sin distinguir mayúsculas; los números a 15 cifras; vacías y errores no cuentan
  function cfKey(v) {
    if (typeof v === 'number') return 'n' + (v === 0 ? 0 : +v.toPrecision(15));
    if (typeof v === 'string') return v === '' ? null : 's' + v.toLocaleLowerCase(LOCALE);
    if (typeof v === 'boolean') return 'b' + v;
    return null;
  }
  // Recorre los valores de las celdas de la regla que tienen contenido o un valor desbordado (las vacías no cuentan para
  // el promedio, los superiores ni los duplicados), sin recorrer celda por celda los rangos grandes (A:A)
  function cfEach(d, S, si, fn) {
    const seen = d.ranges.length > 1 ? new Set() : null;
    const visit = (r, c) => { if (seen) { const k = r * GK + c; if (seen.has(k)) return; seen.add(k); } fn(eng.value(si, r, c)); };
    for (const k of Object.keys(S.cells)) { const p = parseAddr(k); if (d.ranges.some(g => inArea(g, p.r, p.c))) visit(p.r, p.c); }
    for (const sp of si === wb.active ? spillList() : eng.spills(si)) for (const g of d.ranges) {
      const r1 = Math.max(sp.r1, g.r1), r2 = Math.min(sp.r2, g.r2), c1 = Math.max(sp.c1, g.c1), c2 = Math.min(sp.c2, g.c2);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if ((r !== sp.anchor.r || c !== sp.anchor.c) && !S.cells[addr(r, c)]) visit(r, c);
    }
  }
  // Agregados de una regla sobre todas sus celdas (una vez por recálculo): números, umbral de superiores e inferiores,
  // promedio y desviación estándar (muestral), y cuántas veces aparece cada valor
  function cfAgg(d, S, si) {
    let a = cfMemo.agg.get(d);
    if (a) return a;
    const nums = [], counts = new Map();
    cfEach(d, S, si, v => {
      if (typeof v === 'number') nums.push(v);
      const k = cfKey(v);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    });
    a = { n: nums.length, counts };
    if (d.type === 'top' && nums.length) {
      // 10 superiores con empates: todos los valores iguales o mayores que el N-ésimo (N = rango, o el porcentaje de
      // la cantidad de números redondeado hacia abajo, al menos 1)
      nums.sort((x, y) => d.bottom ? x - y : y - x);
      const k = d.percent ? Math.max(1, Math.floor(nums.length * d.rank / 100)) : d.rank;
      a.thr = nums[Math.min(k, nums.length) - 1];
    }
    if (d.type === 'avg' && nums.length) {
      a.mean = nums.reduce((s, x) => s + x, 0) / nums.length;
      a.sd = nums.length > 1 ? Math.sqrt(nums.reduce((s, x) => s + (x - a.mean) ** 2, 0) / (nums.length - 1)) : null;
    }
    if (CF_VIS.has(d.type) && nums.length) {
      // umbrales de la escala, la barra o los íconos, calculados una vez por recálculo con los números de la regla
      nums.sort((x, y) => x - y);
      a.lo = nums[0]; a.hi = nums[nums.length - 1]; a.sorted = nums;
      const pts = d.type === 'scale' ? d.pts : d.type === 'bar' ? [d.lo, d.hi] : d.th;
      a.t = pts.map((p, i) => cfvoValue(d, p, a, si, d.type === 'icons' || i < pts.length - 1 ? 'lo' : 'hi'));
      a.bad = a.t.some(x => x === null);   // un umbral que no es un número (fórmula con error o texto): sin formato
    }
    cfMemo.agg.set(d, a);
    return a;
  }
  // Percentil inclusivo (como PERCENTIL.INC) de números ordenados de menor a mayor; p entre 0 y 1
  function cfPercentile(sorted, p) {
    const h = (sorted.length - 1) * p, i = Math.floor(h);
    return i + 1 < sorted.length ? sorted[i] + (h - i) * (sorted[i + 1] - sorted[i]) : sorted[i];
  }
  // Valor de un punto (cfvo) de la regla d sobre sus números (a.lo, a.hi, a.sorted), o null si no es un número. Porcentaje:
  // el mínimo más X % de la diferencia entre el máximo y el mínimo; Automático: el menor entre 0 y el mínimo (o el mayor
  // entre 0 y el máximo) [MS-XLSX] ST_CfvoType. Número y Fórmula: constante es-CL o fórmula, evaluada en el ancla
  function cfvoValue(d, p, a, si, end) {
    if (p.k === 'min') return a.lo;
    if (p.k === 'max') return a.hi;
    if (p.k === 'auto') return end === 'lo' ? Math.min(0, a.lo) : Math.max(0, a.hi);
    const an = dvAnchor(d), x = cfOperand(d, p.v, si, an.r, an.c);
    if (typeof x !== 'number' || !isFinite(x)) return null;
    if (p.k === 'percent') return a.lo + (a.hi - a.lo) * x / 100;
    if (p.k === 'percentile') return cfPercentile(a.sorted, Math.max(0, Math.min(100, x)) / 100);
    return x;
  }
  // Color entre a y b (#rrggbb) en la fracción f, interpolado en RGB
  function cfMix(a, b, f) {
    const ch = (x, i) => parseInt(x.slice(1 + 2 * i, 3 + 2 * i), 16);
    return '#' + [0, 1, 2].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * f).toString(16).padStart(2, '0')).join('');
  }
  // Color de la escala (colores y umbrales de mínimo a máximo) para v: fuera del rango, el color del extremo
  function cfScaleColor(cs, t, v) {
    const lo = t[0], hi = t[t.length - 1];
    if (v >= hi) return cs[cs.length - 1];
    if (v <= lo) return cs[0];
    if (cs.length === 2) return cfMix(cs[0], cs[1], (v - lo) / (hi - lo));
    const m = t[1];
    return v <= m ? cfMix(cs[0], cs[1], (v - lo) / (m - lo)) : cfMix(cs[1], cs[2], (v - m) / (hi - m));
  }
  // Barra de datos de v entre lo y hi: inicio y fin (s, e) y eje (ax) como fracciones del ancho útil de la celda. Eje
  // automático con negativos: en el punto del 0 (los positivos crecen hacia la derecha según el máximo y los negativos
  // hacia la izquierda según el mínimo); punto medio de la celda: en la mitad; ninguno o sin negativos: desde la izquierda
  function cfBarGeom(d, lo, hi, v) {
    const cl = x => Math.max(0, Math.min(1, x));
    let s = 0, e, ax = null;
    if (d.axis === 'mid') {
      const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
      ax = 0.5;
      if (v >= 0) { s = 0.5; e = 0.5 + 0.5 * cl(v / m); } else { e = 0.5; s = 0.5 - 0.5 * cl(-v / m); }
    } else if (d.axis === 'auto' && lo < 0) {
      ax = hi <= 0 ? 1 : -lo / (hi - lo);
      if (v >= 0) { s = ax; e = ax + (1 - ax) * (hi > 0 ? cl(v / hi) : 0); } else { e = ax; s = ax - ax * cl(v / lo); }
    } else e = hi > lo ? cl((v - lo) / (hi - lo)) : v >= hi ? 1 : 0;
    const neg = v < 0;
    return { s, e, ax, neg, color: neg ? d.neg : d.color, grad: d.grad, border: d.border, only: d.only };
  }
  // Formato visual de la regla d (escala, barra o íconos) para el valor v: { bg } | { bar } | { icon }, o null (texto,
  // vacías, errores, una regla sin números o con un umbral que no es un número)
  function cfVisual(d, S, si, v) {
    if (typeof v !== 'number') return null;
    const a = cfAgg(d, S, si);
    if (!a.n || a.bad) return null;
    if (d.type === 'scale') return { bg: cfScaleColor(d.pts.map(p => p.color), a.t, v) };
    if (d.type === 'bar') return { bar: cfBarGeom(d, a.t[0], a.t[1], v) };
    // íconos: el primero cuyo umbral se cumple, de arriba hacia abajo (comparación de Excel, 15 cifras); si ninguno, el último
    let i = 0;
    while (i < d.th.length && !(d.th[i].op === 'gt' ? compareVals(v, a.t[i], true) > 0 : compareVals(v, a.t[i], true) >= 0)) i++;
    return { icon: { set: d.set, i: d.rev ? d.th.length - i : i, only: d.only } };
  }
  // ¿La regla d se cumple en la celda (r, c) de la hoja S (índice si), cuyo valor es v?
  function cfMatch(d, S, si, r, c, v) {
    const err = v instanceof FErr;
    switch (d.type) {
      case 'cellIs': {
        // Valor de la celda: solo compara valores del mismo tipo ("Mayor que 5" no aplica a texto ni "Es igual a Sí" a
        // números); vacías y errores tampoco (su tipo no es el de ningún operando). Comparación de Excel: 15 cifras, texto
        // sin distinguir mayúsculas
        const two = dvTwoArgs(d.op), a = cfOperand(d, d.f1, si, r, c) ?? 0, b = two ? cfOperand(d, d.f2, si, r, c) ?? 0 : null;
        const same = x => typeof x === typeof v && !(x instanceof FErr);
        if (!same(a) || (two && !same(b))) return false;
        const cmp = x => compareVals(v, x, true);
        if (two) {
          const lo = compareVals(a, b, true) <= 0 ? a : b, hi = lo === a ? b : a, inside = cmp(lo) >= 0 && cmp(hi) <= 0;
          return d.op === 'between' ? inside : !inside;
        }
        const k = cmp(a);
        return { equal: k === 0, notEqual: k !== 0, greaterThan: k > 0, lessThan: k < 0, greaterThanOrEqual: k >= 0, lessThanOrEqual: k <= 0 }[d.op];
      }
      case 'text': {
        // como las fórmulas que escribe Excel: HALLAR (sin distinguir mayúsculas), IZQUIERDA y DERECHA
        let q = d.f1 || '';
        if (isFormula(q)) { const x = cfOperand(d, q, si, r, c); if (x instanceof FErr) return false; q = cfText(x); }
        const t = err ? null : cfText(v).toLocaleLowerCase(LOCALE), s = String(q).toLocaleLowerCase(LOCALE);
        if (d.op === 'notContains') return err || !t.includes(s);   // ESERROR(HALLAR(…)): un error también "no contiene"
        if (err) return false;
        return d.op === 'beginsWith' ? t.startsWith(s) : d.op === 'endsWith' ? t.endsWith(s) : t.includes(s);
      }
      case 'date': {
        // Una fecha: solo números (las fechas son seriales), por día; la semana empieza el domingo (DIASEM tipo 1, como
        // las fórmulas que Excel escribe para estas reglas)
        if (typeof v !== 'number') return false;
        const x = Math.floor(v), T = cfToday(), p = d.period;
        if (p === 'yesterday') return x === T - 1;
        if (p === 'tomorrow') return x === T + 1;
        if (p === 'last7') return x >= T - 6 && x <= T;
        if (p === 'lastWeek' || p === 'thisWeek' || p === 'nextWeek') {
          const s0 = T - mod(T - 1, 7) + (p === 'lastWeek' ? -7 : p === 'nextWeek' ? 7 : 0);
          return x >= s0 && x <= s0 + 6;
        }
        if (p === 'lastMonth' || p === 'thisMonth' || p === 'nextMonth') return x >= 1 && cfYm(x) - cfYm(T) === (p === 'lastMonth' ? -1 : p === 'nextMonth' ? 1 : 0);
        return x === T;
      }
      case 'blanks': return !err && cfBlank(v);
      case 'noBlanks': return !err && !cfBlank(v);
      case 'errors': return err;
      case 'noErrors': return !err;
      case 'top': { if (typeof v !== 'number') return false; const a = cfAgg(d, S, si); return a.thr != null && (d.bottom ? v <= a.thr : v >= a.thr); }
      case 'avg': {
        // promedio de los números del rango de la regla; con desviaciones estándar, más allá de N desviaciones
        if (typeof v !== 'number') return false;
        const a = cfAgg(d, S, si);
        if (!a.n || (d.sd && a.sd == null)) return false;
        const lim = a.mean + (d.below ? -1 : 1) * d.sd * (a.sd || 0);
        return d.below ? (d.equal ? v <= lim : v < lim) : (d.equal ? v >= lim : v > lim);
      }
      case 'dup': { const k = cfKey(v); if (!k) return false; const n = cfAgg(d, S, si).counts.get(k) || 0; return d.unique ? n === 1 : n > 1; }
      // fórmula escrita para el ancla de la regla: el motor desplaza sus referencias relativas hasta (r, c); VERDADERO
      // o un número ≠ 0 aplican el formato; FALSO, 0, texto y errores, no
      case 'expr': return eng.evalFormulaBool(si, r, c, d.f1, { from: dvAnchor(d) });
      default: return false;
    }
  }
  // Estilo del formato condicional de la celda (r, c) de la hoja S (índice si), o null: función pura del modelo y de los
  // valores del motor, en caché hasta el próximo recálculo. Las reglas se aplican en orden de prioridad: una propiedad ya
  // puesta por una regla de más arriba no se cambia, las demás se suman; una regla con "Detener si es verdad" que se
  // cumple corta las de abajo
  function cfStyle(S, si, r, c) {
    const list = cfList(S, si);
    if (!list.length) return null;
    if (!cfMemo || cfMemo.si !== si || cfMemo.list !== list || cfMemo.cells.size > 200000) cfMemo = { si, list, cells: new Map(), agg: new Map() };
    const k = r * GK + c;
    if (cfMemo.cells.has(k)) return cfMemo.cells.get(k);
    let out = null, v, got = false;
    for (const d of list) {
      if (!d.ranges.some(g => inArea(g, r, c))) continue;
      if (!got) { v = eng.value(si, r, c); got = true; }
      if (CF_VIS.has(d.type)) {
        // escala, barra o íconos: sus propiedades (bg, bar, icon) se suman como las de cualquier regla; nunca cortan las de abajo
        let x = null;
        try { x = cfVisual(d, S, si, v); } catch (e) { x = null; }
        if (x) for (const [p, y] of Object.entries(x)) { if (!out) out = {}; if (!(p in out)) out[p] = y; }
        continue;
      }
      let hit = false;
      try { hit = cfMatch(d, S, si, r, c, v); } catch (e) { hit = false; }   // una fórmula rota no rompe el dibujo
      if (!hit) continue;
      for (const [p, x] of Object.entries(d.style || {})) { if (!out) out = {}; if (!(p in out)) out[p] = x; }
      if (d.stop) break;
    }
    cfMemo.cells.set(k, out);
    return out;
  }

  // Íconos de los conjuntos dibujados con SVG en línea (sin recursos externos), en un cuadro de 16 × 16
  const CF_IC = { G: '#00a651', Y: '#ffc000', R: '#e0301e', K: '#808080', B: '#2f75b5', E: '#d9d9d9' };
  function cfIconSvg(id, px = 14) {
    const arrow = (deg, col) => `<g transform="rotate(${deg} 8 8)"><polygon points="8,1 15,8 10.6,8 10.6,15 5.4,15 5.4,8 1,8" fill="${col}"/></g>`;
    // estrella de 5 puntas: la mitad izquierda son los puntos 5 a 9 y el 0 (de abajo hacia arriba por la izquierda)
    const sp = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.9 : 7, t = -Math.PI / 2 + i * Math.PI / 5; sp.push((8 + r * Math.cos(t)).toFixed(2) + ',' + (8.6 + r * Math.sin(t)).toFixed(2)); }
    const star = k => `<polygon points="${sp.join(' ')}" fill="${k === 2 ? CF_IC.Y : '#fff'}" stroke="${CF_IC.Y}" stroke-width="1"/>` + (k === 1 ? `<polygon points="${[...sp.slice(5), sp[0]].join(' ')}" fill="${CF_IC.Y}"/>` : '');
    const bars = k => [0, 1, 2, 3].map(i => `<rect x="${1 + i * 3.8}" y="${12 - i * 3}" width="2.8" height="${3 + i * 3}" fill="${i < k ? CF_IC.B : CF_IC.E}"/>`).join('');
    const flag = col => `<rect x="3" y="1.5" width="1.4" height="13" fill="#595959"/><polygon points="4.4,2 14,5 4.4,8.5" fill="${col}"/>`;
    const cir = col => `<circle cx="8" cy="8" r="6.5" fill="${col}"/>`;
    const body = {
      upG: arrow(0, CF_IC.G), rightY: arrow(90, CF_IC.Y), downR: arrow(180, CF_IC.R), upK: arrow(0, CF_IC.K), rightK: arrow(90, CF_IC.K), downK: arrow(180, CF_IC.K),
      upRightY: arrow(45, CF_IC.Y), downRightY: arrow(135, CF_IC.Y),
      cirG: cir(CF_IC.G), cirY: cir(CF_IC.Y), cirR: cir(CF_IC.R),
      triY: `<polygon points="8,1.5 15,14.5 1,14.5" fill="${CF_IC.Y}"/>`, diaR: `<polygon points="8,1 15,8 8,15 1,8" fill="${CF_IC.R}"/>`,
      okG: cir(CF_IC.G) + '<path d="M4.6 8.3l2.3 2.3 4.6-4.8" stroke="#fff" stroke-width="2" fill="none"/>',
      warnY: cir(CF_IC.Y) + '<rect x="7" y="3.6" width="2" height="5.6" fill="#fff"/><rect x="7" y="10.6" width="2" height="2" fill="#fff"/>',
      noR: cir(CF_IC.R) + '<path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="2"/>',
      flagG: flag(CF_IC.G), flagY: flag(CF_IC.Y), flagR: flag(CF_IC.R),
      star2: star(2), star1: star(1), star0: star(0), bars4: bars(4), bars3: bars(3), bars2: bars(2), bars1: bars(1), bars0: bars(0),
    }[id] || '';
    return `<svg viewBox="0 0 16 16" width="${px}" height="${px}" data-ic="${id}">${body}</svg>`;
  }
  // Íconos de un conjunto en el orden en que se ven (Invertir criterio de ordenación los da vuelta)
  const cfIconIds = (set, rev) => { const s = (cfIconSet(set) || cfIconSet('3traffic'))[3]; return rev ? s.slice().reverse() : s; };
  const cfIconPx = s => Math.round((s.fs ? ptPx(s.fs) : 13) * 1.1);   // crece con la fuente, como en Excel
  const CF_PAD = 2;   // margen de la barra de datos dentro de la celda (px)
  // Barra de datos, eje e ícono de una celda (HTML de capas absolutas detrás del valor, dentro del td, de la combinación o
  // de la celda impresa; el contenedor tiene posición). El valor va en <span class="cfv"> para quedar encima de la barra
  function cfDeco(s) {
    let h = '';
    const b = s.bar, W = `(100% - ${2 * CF_PAD}px)`, f = x => +x.toFixed(4);
    if (b) {
      // degradado: del color en el eje (o el borde izquierdo) hacia casi blanco en la punta, como en Excel 2010+
      const fill = b.grad ? `linear-gradient(${b.neg ? 270 : 90}deg,${b.color},${cfMix(b.color, '#ffffff', 0.9)})` : b.color;
      if (b.e > b.s) h += `<span class="cfbar" style="left:calc(${CF_PAD}px + ${W} * ${f(b.s)});width:calc(${W} * ${f(b.e - b.s)});background:${fill};${b.border ? `border:1px solid ${b.color};` : ''}"></span>`;
      if (b.ax != null) h += `<span class="cfaxis" style="left:calc(${CF_PAD}px + ${W} * ${f(b.ax)})"></span>`;
    }
    if (s.icon) h += `<span class="cfic">${cfIconSvg(cfIconIds(s.icon.set)[s.icon.i], cfIconPx(s))}</span>`;
    return h;
  }
  // El valor de la celda se oculta con "Mostrar solo la barra" o "Mostrar ícono únicamente"
  const cfHideValue = s => !!((s.bar && s.bar.only) || (s.icon && s.icon.only));
  const CF_DECO_CSS = '.cfbar{position:absolute;top:2px;bottom:2px;box-sizing:border-box;pointer-events:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}.cfaxis{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed #000;pointer-events:none}.cfv{position:relative}.cfic{position:absolute;left:2px;bottom:3px;line-height:0;pointer-events:none}';

  // Texto de la columna "Regla" del administrador (las fórmulas, para la celda activa)
  function cfDescribe(d, f = x => x) {
    const OPS = { between: 'entre', notBetween: 'no está entre', equal: '=', notEqual: '<>', greaterThan: '>', lessThan: '<', greaterThanOrEqual: '>=', lessThanOrEqual: '<=' };
    const lbl = (list, k) => (list.find(x => x[0] === k) || [k, k])[1];
    switch (d.type) {
      case 'cellIs': return `Valor de la celda ${OPS[d.op]} ${f(d.f1)}` + (dvTwoArgs(d.op) ? ` y ${f(d.f2)}` : '');
      case 'text': return `El valor de la celda ${lbl(CF_TEXT_OPS, d.op).replace(/^que /, '')} "${f(d.f1)}"`;
      case 'date': return 'Una fecha: ' + lbl(CF_PERIODS, d.period);
      case 'blanks': return 'Celdas en blanco';
      case 'noBlanks': return 'Sin espacios en blanco';
      case 'errors': return 'Errores';
      case 'noErrors': return 'Sin errores';
      case 'top': return `${d.rank}${d.percent ? '%' : ''} ${d.bottom ? 'inferiores' : 'superiores'}`;
      case 'avg': { const m = CF_AVG.find(x => x[2] === d.sd && x[3] === d.below && x[4] === d.equal) || CF_AVG[0]; return m[1][0].toUpperCase() + m[1].slice(1) + ' del promedio'; }
      case 'dup': return d.unique ? 'Valores únicos' : 'Valores duplicados';
      case 'expr': return 'Fórmula: ' + f(d.f1);
      case 'scale': return 'Escala de colores';
      case 'bar': return 'Barra de datos';
      case 'icons': return 'Conjunto de íconos';
      default: return d.type;
    }
  }
  // Muestra del formato (administrador, Nueva regla, Formato de celdas)
  function cfSampleCss(s) {
    let css = `background:${s.bg || '#fff'};color:${s.fg || '#222'};border:1px solid ${s.bd || '#c8c8c8'};`;
    if (s.b) css += 'font-weight:700;';
    if (s.i) css += 'font-style:italic;';
    if (s.u || s.st) css += `text-decoration:${[s.u && 'underline', s.st && 'line-through'].filter(Boolean).join(' ')};`;
    return css;
  }
  const cfHasStyle = s => !!s && Object.keys(s).length > 0;
  const absRef = (r, c) => '$' + colName(c) + '$' + (r + 1);
  // "Se aplica a" como texto: =$C$2:$C$9;$E$2 (";" une rangos en es-CL); columnas o filas completas como $A:$A o $2:$4
  function cfRangesText(ranges, S) {
    return '=' + ranges.map(g => {
      if (g.r1 === 0 && g.r2 >= S.rows - 1 && !(g.c1 === 0 && g.c2 >= S.cols - 1)) return '$' + colName(g.c1) + ':$' + colName(g.c2);
      if (g.c1 === 0 && g.c2 >= S.cols - 1 && !(g.r1 === 0 && g.r2 >= S.rows - 1)) return '$' + (g.r1 + 1) + ':$' + (g.r2 + 1);
      return g.r1 === g.r2 && g.c1 === g.c2 ? absRef(g.r1, g.c1) : absRef(g.r1, g.c1) + ':' + absRef(g.r2, g.c2);
    }).join(';');
  }
  // Texto de "Se aplica a" → rangos de la hoja S, o null si no es válido (acepta ; o , entre rangos y el nombre de la hoja)
  function cfParseRanges(text, S) {
    const t = String(text || '').trim().replace(/^=/, '');
    if (!t) return null;
    const out = [];
    for (const part of t.split(/[;,]/)) {
      let p = part.trim();
      const m = /^(?:('(?:[^']|'')+'|[^'!]+)!)?(.+)$/.exec(p);
      if (!m) return null;
      if (m[1]) { const n = m[1][0] === "'" ? m[1].slice(1, -1).replace(/''/g, "'") : m[1]; if (!sameSheet(n, S.name)) return null; p = m[2]; }
      const rs = Bx.findRefs(p);
      if (rs.length !== 1 || rs[0].start !== 0 || rs[0].end !== p.length || rs[0].sheet || rs[0].spill) return null;
      const x = rs[0], b = x.b || x.a, g = { r1: Math.min(x.a.r, b.r), c1: Math.min(x.a.c, b.c), r2: Math.max(x.a.r, b.r), c2: Math.max(x.a.c, b.c) };
      if (x.a.kind === 'col') { g.r1 = 0; g.r2 = S.rows - 1; } else if (x.a.kind === 'row') { g.c1 = 0; g.c2 = S.cols - 1; }
      if (!(g.r1 >= 0 && g.c1 >= 0)) return null;
      out.push(g);
    }
    return out;
  }

  // Muestra de una regla visual (columna Formato del administrador, vista previa de Nueva regla y galerías del menú),
  // dentro de un contenedor con posición (.cf-vsm o .cf-sw)
  function cfVisSample(d) {
    if (d.type === 'scale') return `<span class="cfbar" style="left:0;right:0;top:0;bottom:0;background:linear-gradient(90deg,${d.pts.map(p => p.color).join(',')})"></span>`;
    if (d.type === 'bar') {
      const fill = d.grad ? `linear-gradient(90deg,${d.color},${cfMix(d.color, '#ffffff', 0.9)})` : d.color;
      return `<span class="cfbar" style="top:1px;bottom:1px;left:1px;width:65%;background:${fill};${d.border ? `border:1px solid ${d.color};` : ''}"></span>`;
    }
    return d.type === 'icons' ? cfIconIds(d.set, d.rev).map(id => cfIconSvg(id, 14)).join('') : '';
  }
  // Parámetros de las galerías: escalas (3 colores con punto medio en el percentil 50, como Excel), barras (mínimo y
  // máximo automáticos; degradado con borde, sólido sin borde) e íconos (umbrales por omisión en porcentaje)
  const cfScaleOf = cs => ({ type: 'scale', pts: cs.length === 3 ? [{ k: 'min', color: cs[2] }, { k: 'percentile', v: '50', color: cs[1] }, { k: 'max', color: cs[0] }] : [{ k: 'min', color: cs[1] }, { k: 'max', color: cs[0] }] });
  const cfBarOf = (color, grad) => ({ type: 'bar', lo: { k: 'auto' }, hi: { k: 'auto' }, color, grad, border: grad });
  const cfIconsOf = set => ({ type: 'icons', set });
  // Regla de una galería para la selección (rangos de la selección, como una regla nueva)
  const cfGalleryRule = p => normCf({ ...p, ranges: [range(), ...extra].map(g => ({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 })) });
  // Vista previa al pasar el ratón por una opción de la galería (como Excel); se apaga al salir de la opción o al cerrar
  // el menú (L-064: la marca cfHover evita que una salida tardía la vuelva a pintar)
  let cfHover = false;
  function cfHoverOn(p) {
    if (edit) return;
    cfHover = true;
    cfPreview = { si: wb.active, list: [cfGalleryRule(p), ...(sheet.cf || [])] };
    cfRefresh();
  }
  function cfHoverOff() { if (!cfHover) return; cfHover = false; cfPreview = null; cfRefresh(); }
  function cfApplyGallery(p) {
    cfHoverOff();
    if (edit && !commitEdit()) return;
    const rule = cfGalleryRule(p);
    if (rule) applyChanges([], { cf: [rule, ...(sheet.cf || [])] });   // arriba de las demás, un paso de deshacer
  }
  const cfGalleryItem = (name, p, cls) => [name, () => cfApplyGallery(p), { html: `<span class="cf-sw${cls ? ' ' + cls : ''}">${cfVisSample(normCf({ ...p, ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }] }))}</span>`,
    hover: () => cfHoverOn(p), unhover: cfHoverOff }];
  // ▾ "Formato condicional" de la cinta
  function cfMenu() {
    const b = $('[data-cmd="cf"]').getBoundingClientRect(), q = k => () => cfQuick(k);
    const head = t => [t, null, { head: true }];
    const groups = [...new Set(CF_ICONSETS.map(x => x[2]))];
    showMenu({ clientX: b.left, clientY: b.bottom }, [
      ['Reglas para resaltar celdas', null, { sub: [['Mayor que…', q('gt')], ['Menor que…', q('lt')], ['Entre…', q('between')], ['Es igual a…', q('eq')],
        ['Texto que contiene…', q('text')], ['Una fecha…', q('date')], ['Duplicar valores…', q('dup')], null, ['Más reglas…', () => cfNewRule('cell')]] }],
      ['Reglas superiores e inferiores', null, { sub: [['10 superiores…', q('top')], ['10% de valores superiores…', q('topPct')], ['10 inferiores…', q('bottom')],
        ['10% de valores inferiores…', q('bottomPct')], ['Por encima del promedio…', q('above')], ['Por debajo del promedio…', q('below')], null, ['Más reglas…', () => cfNewRule('top')]] }],
      ['Barras de datos', null, { sub: [head('Relleno degradado'), ...CF_BARS.map(([n, c]) => cfGalleryItem('Degradado ' + n, cfBarOf(c, true))),
        head('Relleno sólido'), ...CF_BARS.map(([n, c]) => cfGalleryItem('Sólido ' + n, cfBarOf(c, false))), null, ['Más reglas…', () => cfNewRule('scale', 'bar')]] }],
      ['Escalas de color', null, { sub: [...CF_SCALES.map(([n, cs]) => cfGalleryItem(n, cfScaleOf(cs))), null, ['Más reglas…', () => cfNewRule('scale', 'scale2')]] }],
      ['Conjuntos de íconos', null, { sub: [...groups.flatMap(g => [head(g), ...CF_ICONSETS.filter(x => x[2] === g).map(x => cfGalleryItem(x[1], cfIconsOf(x[0]), 'ic'))]),
        null, ['Más reglas…', () => cfNewRule('scale', 'icons')]] }],
      null,
      ['Nueva regla…', () => cfNewRule()],
      ['Borrar reglas', null, { sub: [['Borrar reglas de las celdas seleccionadas', cfClearSel], ['Borrar reglas de toda la hoja', cfClearSheet]] }],
      ['Administrar reglas…', cfManager],
    ]);
  }
  function cfClearSel() { if (edit && !commitEdit()) return; applyChanges([], { cf: dvRemove(sheet.cf || [], allRanges()) }); }
  function cfClearSheet() { if (edit && !commitEdit()) return; applyChanges([], { cf: [] }); }

  // Cuadros rápidos: [título, texto, tipo de campos, parámetros de la regla a partir de los campos]
  const CF_QUICK = {
    gt: ['Mayor que', 'Aplicar formato a las celdas que son MAYORES QUE:', 'one', v => ({ type: 'cellIs', op: 'greaterThan', f1: v[0] })],
    lt: ['Menor que', 'Aplicar formato a las celdas que son MENORES QUE:', 'one', v => ({ type: 'cellIs', op: 'lessThan', f1: v[0] })],
    between: ['Entre', 'Aplicar formato a las celdas que están ENTRE:', 'two', v => ({ type: 'cellIs', op: 'between', f1: v[0], f2: v[1] })],
    eq: ['Es igual a', 'Aplicar formato a las celdas que son IGUALES A:', 'one', v => ({ type: 'cellIs', op: 'equal', f1: v[0] })],
    text: ['Texto que contiene', 'Aplicar formato a las celdas que contienen el texto:', 'one', v => ({ type: 'text', op: 'contains', f1: v[0] })],
    date: ['Una fecha', 'Aplicar formato a las celdas que contienen una fecha:', 'period', v => ({ type: 'date', period: v[0] })],
    dup: ['Duplicar valores', 'Aplicar formato a las celdas que contienen:', 'dup', v => ({ type: 'dup', unique: v[0] === 'unique' })],
    top: ['10 superiores', 'Aplicar formato a las celdas que se encuentran en el rango SUPERIOR:', 'rank', v => ({ type: 'top', rank: v[0] })],
    topPct: ['10% de valores superiores', 'Aplicar formato a las celdas que se encuentran en el rango SUPERIOR:', 'pct', v => ({ type: 'top', rank: v[0], percent: true })],
    bottom: ['10 inferiores', 'Aplicar formato a las celdas que se encuentran en el rango INFERIOR:', 'rank', v => ({ type: 'top', rank: v[0], bottom: true })],
    bottomPct: ['10% de valores inferiores', 'Aplicar formato a las celdas que se encuentran en el rango INFERIOR:', 'pct', v => ({ type: 'top', rank: v[0], bottom: true, percent: true })],
    above: ['Por encima del promedio', 'Aplicar formato a las celdas que están POR ENCIMA DEL PROMEDIO:', 'avg', () => ({ type: 'avg' })],
    below: ['Por debajo del promedio', 'Aplicar formato a las celdas que están POR DEBAJO DEL PROMEDIO:', 'avg', () => ({ type: 'avg', below: true })],
  };
  const cfPresetOptions = () => CF_PRESETS.map(([t], i) => `<option value="${i}">${t}</option>`).join('') + '<option value="custom">Formato personalizado…</option>';
  // Valor de la celda activa como texto de entrada (valor inicial de los cuadros rápidos)
  const activeEntry = () => { const v = eng.value(wb.active, A.r, A.c); return v === null || v instanceof FErr ? '' : typeof v === 'string' ? v : Bx.toRaw(v); };
  // Revisión de un campo de valor (número es-CL, fecha, texto o fórmula) → mensaje o null
  const cfValueError = v => !v ? 'Debe escribir un valor o una referencia a una celda.' : isFormula(v) ? (Bx.checkFormula(v) || {}).message || null : null;
  // Cuadro rápido (Mayor que, Entre, Una fecha, 10 superiores…): no modal, con vista previa en vivo en la hoja; un clic en
  // una celda escribe su referencia absoluta (=$E$1) en el campo; Aceptar crea la regla para la selección, arriba de las
  // demás (un paso de deshacer); Cancelar o Esc no cambian nada
  function cfQuick(kind) {
    if (edit && !commitEdit()) return;
    hideMenu();
    const [title, text, fields, make] = CF_QUICK[kind], gs = [range(), ...extra], a = { r: gs[0].r1, c: gs[0].c1 };
    const body = document.createElement('div');
    const presetSel = `<span>con</span><select id="cfPreset">${cfPresetOptions()}</select>`;
    let row;
    if (fields === 'one') row = `<input id="cfV1" class="cf-ref" spellcheck="false" autocomplete="off">${presetSel}`;
    else if (fields === 'two') row = `<input id="cfV1" class="cf-ref" spellcheck="false" autocomplete="off"><span>y</span><input id="cfV2" class="cf-ref" spellcheck="false" autocomplete="off">${presetSel}`;
    else if (fields === 'period') row = `<select id="cfPeriod">${CF_PERIODS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>${presetSel}`;
    else if (fields === 'dup') row = `<select id="cfDupKind"><option value="dup">Duplicado</option><option value="unique">Único</option></select><span>valores con</span><select id="cfPreset">${cfPresetOptions()}</select>`;
    else if (fields === 'rank' || fields === 'pct') row = `<input id="cfRank" type="number" min="1" max="${fields === 'pct' ? 100 : 1000}" value="10">${fields === 'pct' ? '<span>%</span>' : ''}${presetSel}`;
    else row = `<span>para el rango seleccionado con</span><select id="cfPreset">${cfPresetOptions()}</select>`;
    body.innerHTML = `<p class="cf-q">${text}</p><div class="cf-qrow">${row}</div>`;
    const q = s => body.querySelector(s), sel = q('#cfPreset');
    if (fields === 'one') q('#cfV1').value = activeEntry();
    if (fields === 'two') {
      // Entre: el menor y el mayor de los números de la selección
      let lo = null, hi = null;
      for (const [k] of Object.entries(sheet.cells)) { const p = parseAddr(k), v = eng.value(wb.active, p.r, p.c); if (typeof v === 'number' && gs.some(g => inArea(g, p.r, p.c))) { lo = lo === null ? v : Math.min(lo, v); hi = hi === null ? v : Math.max(hi, v); } }
      q('#cfV1').value = lo === null ? '' : Bx.toRaw(lo); q('#cfV2').value = hi === null ? '' : Bx.toRaw(hi);
    }
    let custom = null, last = '0', lastRef = q('.cf-ref');
    body.addEventListener('focusin', e => { if (e.target.classList.contains('cf-ref')) lastRef = e.target; });
    const fromActive = f => isFormula(f) ? shiftFormula(f, a.r - A.r, a.c - A.c) : f;   // lo escrito es de la celda activa
    // Regla con los campos actuales → { rule } o { err, id } (strict) o null (sin vista previa)
    const build = strict => {
      const vals = [];
      for (const id of ['#cfV1', '#cfV2']) {
        const f = q(id);
        if (!f) continue;
        const v = f.value.trim(), e = cfValueError(v);
        if (e) return strict ? { err: e, id } : null;
        vals.push(fromActive(v));
      }
      if (q('#cfPeriod')) vals.push(q('#cfPeriod').value);
      if (q('#cfDupKind')) vals.push(q('#cfDupKind').value);
      if (q('#cfRank')) {
        const n = literal(q('#cfRank').value.trim()), max = fields === 'pct' ? 100 : 1000;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max) return strict ? { err: `Escriba un número entero entre 1 y ${max}.`, id: '#cfRank' } : null;
        vals.push(n);
      }
      const style = sel.value === 'custom' ? custom || {} : CF_PRESETS[+sel.value][1];
      return { rule: normCf({ ...make(vals), ranges: gs.map(g => ({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 })), style, stop: false }) };
    };
    // (al cerrar con Esc, quitar el cuadro hace que el campo enfocado dispare "change": ya cerrado, no hay vista previa)
    let closed = false;
    const preview = () => { if (closed) return; const b = build(false); cfPreview = { si: wb.active, list: b && b.rule ? [b.rule, ...(sheet.cf || [])] : sheet.cf || CF_NONE }; cfRefresh(); };
    body.addEventListener('input', preview);
    body.addEventListener('change', e => {
      if (e.target !== sel) return preview();
      if (sel.value !== 'custom') { last = sel.value; return preview(); }
      // Formato personalizado…: cuadro "Formato de celdas"; Cancelar vuelve al formato anterior
      cfFormatDialog(custom || {}).then(s => { if (s) { custom = s; last = 'custom'; } else sel.value = last; preview(); });
    });
    let rule = null;
    const onOk = () => {
      const b = build(true);
      if (b.err) { msgBox(b.err).then(() => { const f = q(b.id); f.focus(); f.select(); }); return false; }
      rule = b.rule;
      return true;
    };
    const onPick = (r, c) => { if (!lastRef) return; lastRef.value = '=' + absRef(r, c); lastRef.focus(); lastRef.select(); preview(); };
    const p = dlgBox({ id: 'cfQuickDlg', title, body, onOk, modeless: true, onPick, focus: fields === 'one' || fields === 'two' ? '#cfV1' : fields === 'rank' || fields === 'pct' ? '#cfRank' : '#cfPreset',
      onClose: () => { closed = true; cfPreview = null; cfRefresh(); } });
    const f0 = q('#cfV1') || q('#cfRank');
    if (f0) f0.select();
    preview();
    return p.then(yes => { if (yes && rule) applyChanges([], { cf: [rule, ...(sheet.cf || [])] }); return yes; });
  }

  // Cuadro "Formato de celdas" del formato condicional (Fuente, Borde, Relleno) → Promise<estilo | null>
  function cfFormatDialog(style) {
    let s = normCfStyle(style);
    const body = document.createElement('div');
    body.innerHTML = `<div class="dv-tabs" role="tablist"><button type="button" class="dv-tab" role="tab">Número</button><button type="button" class="dv-tab on" role="tab">Fuente</button><button type="button" class="dv-tab" role="tab">Borde</button><button type="button" class="dv-tab" role="tab">Relleno</button></div>
      <div class="cf-page" id="cfPgN" hidden><label>Categoría:<select id="cfNumFmt">${CF_NUM_FMTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
        <label>Posiciones decimales:<input type="number" id="cfNumDec" min="0" max="30"></label></div>
      <div class="cf-page" id="cfPg0"><label>Estilo de fuente:<select id="cfFontStyle"><option value="">Normal</option><option value="i">Cursiva</option><option value="b">Negrita</option><option value="bi">Negrita Cursiva</option></select></label>
        <label>Subrayado:<select id="cfUnder"><option value="">Ninguno</option><option value="u">Simple</option></select></label>
        <label class="chk"><input type="checkbox" id="cfStrike"> Tachado</label>
        <div class="cf-color"><span>Color:</span><label class="chk"><input type="checkbox" id="cfFgAuto"> Automático</label><input type="color" id="cfFg" value="#000000"></div></div>
      <div class="cf-page" id="cfPg1" hidden><label class="chk"><input type="checkbox" id="cfBorder"> Contorno</label><div class="cf-color"><span>Color:</span><input type="color" id="cfBd" value="#000000"></div></div>
      <div class="cf-page" id="cfPg2" hidden><label class="chk"><input type="checkbox" id="cfBgNone"> Sin color</label><div class="cf-color"><span>Color de fondo:</span><input type="color" id="cfBg" value="#ffff00"></div></div>
      <p class="cf-mlbl">Muestra</p><div class="cf-sample big" id="cfFmtSample">AaBbCcYyZz</div>`;
    const q = x => body.querySelector(x);
    const tabs = [...body.querySelectorAll('.dv-tab')], pages = ['N', 0, 1, 2].map(i => q('#cfPg' + i));
    tabs.forEach((b, i) => { b.onclick = () => { tabs.forEach((x, j) => x.classList.toggle('on', i === j)); pages.forEach((x, j) => { x.hidden = i !== j; }); }; });
    const fill = () => {
      q('#cfFontStyle').value = (s.b ? 'b' : '') + (s.i ? 'i' : '') === 'bi' || (s.b && s.i) ? 'bi' : s.b ? 'b' : s.i ? 'i' : '';
      q('#cfUnder').value = s.u ? 'u' : ''; q('#cfStrike').checked = !!s.st;
      q('#cfFgAuto').checked = !s.fg; if (s.fg) q('#cfFg').value = s.fg;
      q('#cfBorder').checked = !!s.bd; if (s.bd) q('#cfBd').value = s.bd;
      q('#cfBgNone').checked = !s.bg; if (s.bg) q('#cfBg').value = s.bg;
      q('#cfNumFmt').value = s.fmt || ''; q('#cfNumDec').value = s.dec == null ? '' : s.dec;
    };
    const read = () => {
      const fs = q('#cfFontStyle').value, o = {}, nf = q('#cfNumFmt').value, nd = q('#cfNumDec').value.trim();
      // Número: el formato de número de la regla reemplaza al de la celda (con sus decimales, L-055)
      if (nf) { o.fmt = nf; if (CF_DEC_FMTS.includes(nf) && /^\d+$/.test(nd)) o.dec = +nd; }
      if (fs.includes('b')) o.b = true;
      if (fs.includes('i')) o.i = true;
      if (q('#cfUnder').value) o.u = true;
      if (q('#cfStrike').checked) o.st = true;
      if (!q('#cfFgAuto').checked) o.fg = q('#cfFg').value;
      if (q('#cfBorder').checked) o.bd = q('#cfBd').value;
      if (!q('#cfBgNone').checked) o.bg = q('#cfBg').value;
      return normCfStyle(o);
    };
    const sample = () => {
      const st = read();
      q('#cfNumDec').disabled = !CF_DEC_FMTS.includes(q('#cfNumFmt').value);
      q('#cfFmtSample').style.cssText = cfSampleCss(st);
      // con formato de número, la muestra es un número con ese formato (como la muestra de Excel)
      q('#cfFmtSample').textContent = st.fmt ? display(1234.5, { v: '', s: st }) : 'AaBbCcYyZz';
    };
    // elegir un color quita "Automático" / "Sin color" y marca el contorno
    body.addEventListener('input', e => {
      if (e.target.id === 'cfFg') q('#cfFgAuto').checked = false;
      if (e.target.id === 'cfBg') q('#cfBgNone').checked = false;
      if (e.target.id === 'cfBd') q('#cfBorder').checked = true;
      sample();
    });
    body.addEventListener('change', sample);
    fill(); sample();
    const clearAllFmt = () => { s = {}; fill(); sample(); };
    return dlgBox({ id: 'cfFmtDlg', title: 'Formato de celdas', body, focus: '#cfFontStyle', aside: [{ id: 'cfFmtClear', text: 'Borrar', onClick: clearAllFmt }] }).then(ok => ok ? read() : null);
  }

  // Tipos de "Nueva regla de formato" (la primera, escalas, barras e íconos: 5e)
  const CF_RULE_TYPES = [['scale', 'Aplicar formato a todas las celdas según sus valores'], ['cell', 'Aplicar formato únicamente a las celdas que contengan'],
    ['top', 'Aplicar formato únicamente a los valores con rango inferior o superior'], ['avg', 'Aplicar formato únicamente a los valores que estén por encima o por debajo del promedio'],
    ['dup', 'Aplicar formato únicamente a los valores únicos o duplicados'], ['expr', 'Utilice una fórmula que determine las celdas para aplicar formato']];
  const CF_KINDS = [['value', 'Valor de la celda'], ['text', 'Texto específico'], ['date', 'Fechas'], ['blanks', 'Celdas en blanco'], ['noBlanks', 'Sin espacios en blanco'], ['errors', 'Errores'], ['noErrors', 'Sin errores']];
  // Cuadro "Nueva regla de formato" / "Editar regla de formato". base: regla que se edita o null; gs: rangos de la regla
  // nueva; o.type: tipo elegido al abrir ("Más reglas…"); o.modeless: desde la cinta (clic en celdas para referencias);
  // desde el administrador, modal. → Promise<regla | null> (sin aplicarla: lo hace quien llama)
  function cfRuleDialog(base, gs, o = {}) {
    const ranges = base ? base.ranges : gs.map(g => ({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 })), a = { r: ranges[0].r1, c: ranges[0].c1 };
    const toActive = f => isFormula(f) ? shiftFormula(f, A.r - a.r, A.c - a.c) : f;   // se muestran y escriben para la celda activa
    const fromActive = f => isFormula(f) ? shiftFormula(f, a.r - A.r, a.c - A.c) : f;
    const opt = list => list.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    const body = document.createElement('div');
    const optK = ks => ks.map(k => `<option value="${k}">${CFVO[k]}</option>`).join('');
    const ri = (id, cls = 'cf-ref') => `<input id="${id}" class="${cls}" spellcheck="false" autocomplete="off">`;
    body.innerHTML = `<p>Seleccionar un tipo de regla:</p><select id="cfTypes" size="6">${CF_RULE_TYPES.map(([v, t]) => `<option value="${v}">► ${t}</option>`).join('')}</select>
      <p>Editar una descripción de regla:</p><fieldset class="cf-desc">
        <div id="cfDescCell"><p>Dar formato únicamente a las celdas con:</p><div class="cf-qrow"><select id="cfKind">${opt(CF_KINDS)}</select><select id="cfOp">${opt(DV_OPS)}</select><select id="cfTextOp">${opt(CF_TEXT_OPS)}</select><select id="cfPer">${opt(CF_PERIODS)}</select>
          <input id="cfN1" class="cf-ref" spellcheck="false" autocomplete="off"><span id="cfAnd">y</span><input id="cfN2" class="cf-ref" spellcheck="false" autocomplete="off"></div></div>
        <div id="cfDescTop"><p>Aplicar formato a los valores que estén en el rango:</p><div class="cf-qrow"><select id="cfTopDir"><option value="top">superior</option><option value="bottom">inferior</option></select><input id="cfTopN" type="number" min="1" max="1000" value="10"><label class="chk"><input type="checkbox" id="cfTopPct"> % del rango seleccionado</label></div></div>
        <div id="cfDescAvg"><p>Aplicar formato a los valores que estén:</p><div class="cf-qrow"><select id="cfAvgMode">${opt(CF_AVG)}</select><span>del promedio del rango seleccionado</span></div></div>
        <div id="cfDescDup"><p>Dar formato a todos:</p><div class="cf-qrow"><select id="cfDupMode"><option value="dup">duplicado</option><option value="unique">único</option></select><span>los valores en el rango seleccionado</span></div></div>
        <div id="cfDescExpr"><p>Dar formato a los valores donde esta fórmula sea verdadera:</p><input id="cfFml" class="cf-ref" spellcheck="false" autocomplete="off"></div>
        <div id="cfDescVis" class="cf-vis"><p>Dar formato a todas las celdas según sus valores:</p>
          <div class="cf-qrow"><span>Estilo de formato:</span><select id="cfVStyle"><option value="scale2">Escala de 2 colores</option><option value="scale3">Escala de 3 colores</option><option value="bar">Barra de datos</option><option value="icons">Conjunto de íconos</option></select></div>
          <div id="cfVScale"><table><thead><tr><th></th><th>Mínima</th><th class="cf-mid">Punto medio</th><th>Máxima</th></tr></thead><tbody>
            <tr><th>Tipo:</th><td><select id="cfSK0">${optK(CFVO_LO)}</select></td><td class="cf-mid"><select id="cfSK1">${optK(CFVO_MID)}</select></td><td><select id="cfSK2">${optK(CFVO_HI)}</select></td></tr>
            <tr><th>Valor:</th><td>${ri('cfSV0')}</td><td class="cf-mid">${ri('cfSV1')}</td><td>${ri('cfSV2')}</td></tr>
            <tr><th>Color:</th><td><input type="color" id="cfSC0"></td><td class="cf-mid"><input type="color" id="cfSC1"></td><td><input type="color" id="cfSC2"></td></tr></tbody></table></div>
          <div id="cfVBar"><label class="chk"><input type="checkbox" id="cfBOnly"> Mostrar solo la barra</label>
            <table><thead><tr><th></th><th>Mínima</th><th>Máxima</th></tr></thead><tbody>
              <tr><th>Tipo:</th><td><select id="cfBK0">${optK(CFVO_BLO)}</select></td><td><select id="cfBK1">${optK(CFVO_BHI)}</select></td></tr>
              <tr><th>Valor:</th><td>${ri('cfBV0')}</td><td>${ri('cfBV1')}</td></tr></tbody></table>
            <div class="cf-qrow"><span>Relleno:</span><select id="cfBFill"><option value="grad">Relleno degradado</option><option value="solid">Relleno sólido</option></select>
              <span>Color:</span><input type="color" id="cfBColor"><span>Borde:</span><select id="cfBBorder"><option value="none">Sin borde</option><option value="solid">Borde sólido</option></select></div>
            <div class="cf-qrow"><span>Valor negativo:</span><input type="color" id="cfBNeg"><span>Eje:</span><select id="cfBAxis"><option value="auto">Automático</option><option value="mid">Punto medio de la celda</option><option value="none">Ninguno</option></select></div></div>
          <div id="cfVIcons"><div class="cf-qrow"><span>Estilo de ícono:</span><select id="cfISet">${CF_ICONSETS.map(x => `<option value="${x[0]}">${x[1]}</option>`).join('')}</select>
              <button type="button" id="cfIRev">Invertir criterio de ordenación de los íconos</button><label class="chk"><input type="checkbox" id="cfIOnly"> Mostrar ícono únicamente</label></div>
            <p>Mostrar cada ícono según estas reglas:</p><table class="cf-irows"><tbody id="cfIRows"></tbody></table></div>
          <div class="cf-vprev"><span>Vista previa:</span><span class="cf-vsm" id="cfVPrev"></span></div></div>
        <div class="cf-prev"><span>Vista previa:</span><span class="cf-sample" id="cfSample"></span><button type="button" id="cfFmtBtn">Formato…</button></div>
      </fieldset>`;
    const q = s => body.querySelector(s), show = (id, on) => { q(id).hidden = !on; };
    let style = base ? { ...base.style } : {}, lastRef = q('#cfN1');
    const layout = () => {
      const t = q('#cfTypes').value, k = q('#cfKind').value, two = dvTwoArgs(q('#cfOp').value);
      for (const [id, tt] of [['#cfDescCell', 'cell'], ['#cfDescTop', 'top'], ['#cfDescAvg', 'avg'], ['#cfDescDup', 'dup'], ['#cfDescExpr', 'expr'], ['#cfDescVis', 'scale']]) show(id, t === tt);
      // escalas, barras e íconos no tienen "Formato…" (su formato es la escala, la barra o el ícono)
      q('.cf-prev').hidden = t === 'scale';
      visLayout();
      show('#cfOp', k === 'value'); show('#cfTextOp', k === 'text'); show('#cfPer', k === 'date');
      show('#cfN1', k === 'value' || k === 'text'); show('#cfAnd', k === 'value' && two); show('#cfN2', k === 'value' && two);
      q('#cfTopN').max = q('#cfTopPct').checked ? 100 : 1000;
      const sm = q('#cfSample');
      sm.textContent = cfHasStyle(style) ? 'AaBbCcYyZz' : 'Sin formato establecido';
      sm.style.cssText = cfHasStyle(style) ? cfSampleCss(style) : '';
    };
    // campos a partir de la regla (o los valores por omisión de Excel)
    const d = base || {};
    q('#cfTypes').value = o.type || ({ top: 'top', avg: 'avg', dup: 'dup', expr: 'expr', scale: 'scale', bar: 'scale', icons: 'scale' }[d.type] || 'cell');
    q('#cfKind').value = { cellIs: 'value', text: 'text', date: 'date', blanks: 'blanks', noBlanks: 'noBlanks', errors: 'errors', noErrors: 'noErrors' }[d.type] || 'value';
    q('#cfOp').value = d.type === 'cellIs' ? d.op : 'between';
    q('#cfTextOp').value = d.type === 'text' ? d.op : 'contains';
    q('#cfPer').value = d.type === 'date' ? d.period : 'yesterday';
    if (d.type === 'cellIs' || d.type === 'text') { q('#cfN1').value = toActive(d.f1 || ''); q('#cfN2').value = toActive(d.f2 || ''); }
    if (d.type === 'top') { q('#cfTopDir').value = d.bottom ? 'bottom' : 'top'; q('#cfTopN').value = d.rank; q('#cfTopPct').checked = d.percent; }
    if (d.type === 'avg') q('#cfAvgMode').value = (CF_AVG.find(x => x[2] === d.sd && x[3] === d.below && x[4] === d.equal) || CF_AVG[0])[0];
    if (d.type === 'dup') q('#cfDupMode').value = d.unique ? 'unique' : 'dup';
    if (d.type === 'expr') q('#cfFml').value = toActive(d.f1);

    // --- Aplicar formato a todas las celdas según sus valores: escala de 2 o 3 colores, barra de datos, conjunto de íconos
    const VN = ['Mínima', 'Punto medio', 'Máxima'], val = id => q(id).value.trim();
    const fixedK = k => k === 'min' || k === 'max' || k === 'auto';
    // valor por omisión de un punto al elegir su tipo (pos: 0 mínima, 1 punto medio, 2 máxima)
    const kDef = (k, pos) => k === 'percent' ? ['0', '50', '100'][pos] : k === 'percentile' ? ['10', '50', '90'][pos] : '';
    const setPt = (kId, vId, p) => { q(kId).value = p.k; q(vId).value = fixedK(p.k) ? '' : p.v; };
    const scaleDefs = n => normCf({ type: 'scale', ranges, pts: n === 2 ? [{}, {}] : [{}, {}, {}] }).pts;
    const fillScale = pts => {
      const at = pts.length === 2 ? [0, 2] : [0, 1, 2];
      pts.forEach((p, j) => { setPt('#cfSK' + at[j], '#cfSV' + at[j], p); q('#cfSC' + at[j]).value = p.color; });
      if (pts.length === 2) { setPt('#cfSK1', '#cfSV1', { k: 'percentile', v: '50' }); q('#cfSC1').value = CFK.y; }
    };
    let iRev = false;
    // filas de los íconos: [ícono] cuando el valor es [>= / >] [valor] [tipo]; la última, "cuando < …"
    const iconRows = th => {
      const ids = cfIconIds(q('#cfISet').value, iRev);
      q('#cfIRows').innerHTML = ids.map((id, i) => `<tr><td>${cfIconSvg(id, 16)}</td>` + (i < ids.length - 1
        ? `<td class="cf-iwhen"></td><td><select id="cfIO${i}"><option value="gte">&gt;=</option><option value="gt">&gt;</option></select></td><td>${ri('cfIV' + i)}</td><td><select id="cfIK${i}">${optK(CFVO_MID)}</select></td>`
        : '<td class="cf-iwhen" colspan="4"></td>') + '</tr>').join('');
      th.forEach((t, i) => { q('#cfIO' + i).value = t.op; q('#cfIK' + i).value = t.k; q('#cfIV' + i).value = t.v; });
    };
    const iconTh = () => [...body.querySelectorAll('#cfIRows select[id^="cfIO"]')].map((x, i) => ({ op: x.value, k: q('#cfIK' + i).value, v: val('#cfIV' + i) }));
    const iconsDef = set => normCf({ type: 'icons', ranges, set }).th;
    const visFill = (d0, vis) => {
      const bd = d0.type === 'bar' ? d0 : normCf({ ...cfBarOf(CF_BARS[0][1], true), ranges });
      const id = d0.type === 'icons' ? d0 : normCf({ type: 'icons', ranges, set: '3traffic' });   // el conjunto por omisión de Excel
      q('#cfVStyle').value = d0.type === 'scale' ? 'scale' + d0.pts.length : d0.type === 'bar' || d0.type === 'icons' ? d0.type : vis || 'scale2';
      fillScale(d0.type === 'scale' ? d0.pts : scaleDefs(q('#cfVStyle').value === 'scale3' ? 3 : 2));
      setPt('#cfBK0', '#cfBV0', bd.lo); setPt('#cfBK1', '#cfBV1', bd.hi);
      q('#cfBFill').value = bd.grad ? 'grad' : 'solid'; q('#cfBColor').value = bd.color; q('#cfBBorder').value = bd.border ? 'solid' : 'none';
      q('#cfBNeg').value = bd.neg; q('#cfBAxis').value = bd.axis; q('#cfBOnly').checked = bd.only;
      q('#cfISet').value = id.set; iRev = id.rev; q('#cfIOnly').checked = id.only;
      iconRows(id.th);
    };
    // Un punto con su tipo y su campo → { p } o { err, id } (strict) o null (vista previa con un campo incompleto)
    const visPoint = (k, id, name, strict) => {
      const no = err => strict ? { err, id } : null;
      if (fixedK(k)) return { p: { k } };
      let v = val(id);
      if (!v) return no(`Debe escribir un valor en "${name}".`);
      if (k === 'formula' && !isFormula(v)) v = '=' + v;
      if (isFormula(v)) {
        const bad = Bx.checkFormula(v);
        if (bad) return no(bad.message);
        // como Excel: en escalas, barras e íconos la fórmula no puede tener referencias relativas
        if (shiftFormula(v, 1, 1) !== v) return no(CF_REL_MSG);
        return { p: { k, v } };
      }
      const x = literal(v);
      if (typeof x !== 'number') return no(`"${name}": escriba un número, una fecha, una hora o una fórmula.`);
      if ((k === 'percent' || k === 'percentile') && (x < 0 || x > 100)) return no(`"${name}": ${k === 'percent' ? 'el porcentaje' : 'el percentil'} debe ser un número entre 0 y 100.`);
      return { p: { k, v } };
    };
    // dos puntos constantes del mismo tipo (Número, Porcentaje o Percentil): el primero tiene que ser menor
    const visOrder = (a, b, na, nb, id) => a.k === b.k && CFVO_MID.includes(a.k) && a.k !== 'formula' && !isFormula(a.v) && !isFormula(b.v)
      && literal(a.v) >= literal(b.v) ? { err: `El valor de "${na}" debe ser menor que el de "${nb}".`, id } : null;
    const visBuild = strict => {
      const vs = q('#cfVStyle').value;
      if (vs === 'scale2' || vs === 'scale3') {
        const at = vs === 'scale3' ? [0, 1, 2] : [0, 2], pts = [];
        for (const i of at) { const r = visPoint(q('#cfSK' + i).value, '#cfSV' + i, VN[i], strict); if (!r || r.err) return r; pts.push({ ...r.p, color: q('#cfSC' + i).value }); }
        if (strict) for (let j = 0; j + 1 < pts.length; j++) { const e = visOrder(pts[j], pts[j + 1], VN[at[j]], VN[at[j + 1]], '#cfSV' + at[j]); if (e) return e; }
        return { p: { type: 'scale', pts } };
      }
      if (vs === 'bar') {
        const lo = visPoint(q('#cfBK0').value, '#cfBV0', 'Mínima', strict);
        if (!lo || lo.err) return lo;
        const hi = visPoint(q('#cfBK1').value, '#cfBV1', 'Máxima', strict);
        if (!hi || hi.err) return hi;
        const e = strict && visOrder(lo.p, hi.p, 'Mínima', 'Máxima', '#cfBV0');
        if (e) return e;
        return { p: { type: 'bar', lo: lo.p, hi: hi.p, color: q('#cfBColor').value, grad: q('#cfBFill').value === 'grad', border: q('#cfBBorder').value === 'solid',
          neg: q('#cfBNeg').value, axis: q('#cfBAxis').value, only: q('#cfBOnly').checked } };
      }
      const th = [];
      for (const [i, t] of iconTh().entries()) { const r = visPoint(t.k, '#cfIV' + i, 'Valor del ícono ' + (i + 1), strict); if (!r || r.err) return r; th.push({ ...r.p, op: t.op }); }
      return { p: { type: 'icons', set: q('#cfISet').value, th, rev: iRev, only: q('#cfIOnly').checked } };
    };
    // muestras: columnas visibles, campos de valor deshabilitados en Valor más bajo/alto y Automático, textos "cuando <"
    const visLayout = () => {
      const vs = q('#cfVStyle').value;
      show('#cfVScale', vs === 'scale2' || vs === 'scale3'); show('#cfVBar', vs === 'bar'); show('#cfVIcons', vs === 'icons');
      body.querySelectorAll('#cfVScale .cf-mid').forEach(x => { x.hidden = vs !== 'scale3'; });
      for (const [k, v] of [['#cfSK0', '#cfSV0'], ['#cfSK1', '#cfSV1'], ['#cfSK2', '#cfSV2'], ['#cfBK0', '#cfBV0'], ['#cfBK1', '#cfBV1']]) q(v).disabled = fixedK(q(k).value);
      const th = iconTh(), w = body.querySelectorAll('#cfIRows .cf-iwhen');
      w.forEach((x, i) => { x.textContent = i === 0 ? 'cuando el valor es' : `cuando ${th[i - 1].op === 'gt' ? '<=' : '<'} ${th[i - 1].v}` + (i < th.length ? ' y' : ''); });
      const b = visBuild(false), pv = q('#cfVPrev');
      if (b && b.p) { const r = normCf({ ...b.p, ranges }); pv.innerHTML = r ? cfVisSample(r) : ''; pv.classList.toggle('ic', r && r.type === 'icons'); }
    };
    // cambiar el estilo o el tipo de un punto: valores por omisión de Excel
    const visChange = e => {
      const id = e.target.id;
      if (id === 'cfVStyle' && (e.target.value === 'scale2' || e.target.value === 'scale3')) fillScale(scaleDefs(e.target.value === 'scale3' ? 3 : 2));
      if (id === 'cfISet') iconRows(iconsDef(e.target.value));
      const m = /^cf(S|B|I)K(\d)$/.exec(id);
      if (m) {
        const v = q(`#cf${m[1]}V${m[2]}`), pos = m[1] === 'S' ? +m[2] : m[1] === 'B' ? +m[2] * 2 : 1;
        v.value = fixedK(e.target.value) ? '' : m[1] === 'I' ? v.value : kDef(e.target.value, pos);
      }
    };
    visFill(d, o.vis);
    q('#cfIRev').onclick = () => { const th = iconTh(); iRev = !iRev; iconRows(th); visLayout(); };
    body.addEventListener('change', e => { visChange(e); layout(); });
    body.addEventListener('input', () => { if (q('#cfTypes').value === 'scale') visLayout(); });
    body.addEventListener('focusin', e => { if (e.target.classList.contains('cf-ref')) lastRef = e.target; });
    q('#cfFmtBtn').onclick = () => cfFormatDialog(style).then(s => { if (s) { style = s; layout(); } });
    layout();
    // Parámetros de la regla con los campos → { rule } o { err, id }
    const build = () => {
      const t = q('#cfTypes').value, val = id => q(id).value.trim();
      let p;
      if (t === 'cell') {
        const k = q('#cfKind').value;
        if (k === 'value') {
          const op = q('#cfOp').value, ids = dvTwoArgs(op) ? ['#cfN1', '#cfN2'] : ['#cfN1'];
          for (const id of ids) { const e = cfValueError(val(id)); if (e) return { err: e, id }; }
          p = { type: 'cellIs', op, f1: fromActive(val('#cfN1')), f2: dvTwoArgs(op) ? fromActive(val('#cfN2')) : undefined };
        } else if (k === 'text') {
          const v = val('#cfN1'), e = isFormula(v) ? cfValueError(v) : null;
          if (e) return { err: e, id: '#cfN1' };
          p = { type: 'text', op: q('#cfTextOp').value, f1: fromActive(v) };
        } else if (k === 'date') p = { type: 'date', period: q('#cfPer').value };
        else p = { type: k };
      } else if (t === 'top') {
        const pct = q('#cfTopPct').checked, n = literal(val('#cfTopN')), max = pct ? 100 : 1000;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max) return { err: `Escriba un número entero entre 1 y ${max}.`, id: '#cfTopN' };
        p = { type: 'top', bottom: q('#cfTopDir').value === 'bottom', rank: n, percent: pct };
      } else if (t === 'avg') { const m = CF_AVG.find(x => x[0] === q('#cfAvgMode').value); p = { type: 'avg', sd: m[2], below: m[3], equal: m[4] }; }
      else if (t === 'dup') p = { type: 'dup', unique: q('#cfDupMode').value === 'unique' };
      else if (t === 'expr') {
        let f = val('#cfFml');
        if (!f) return { err: 'Debe escribir una fórmula (por ejemplo, =A1>0).', id: '#cfFml' };
        if (!f.startsWith('=')) f = '=' + f;
        const bad = Bx.checkFormula(f);
        if (bad) return { err: bad.message, id: '#cfFml' };
        p = { type: 'expr', f1: fromActive(f) };
      } else if (t === 'scale') {
        const r = visBuild(true);
        if (r.err) return r;
        p = r.p;
      } else return { err: 'Elija un tipo de regla.', id: '#cfTypes' };
      return { rule: normCf({ ...p, ranges, style, stop: base ? base.stop : false }) };
    };
    let rule = null;
    const onOk = () => {
      const b = build();
      if (b.err) { msgBox(b.err).then(() => { const f = q(b.id); f.focus(); if (f.select) f.select(); }); return false; }
      rule = b.rule;
      return true;
    };
    const onPick = (r, c) => { if (!lastRef || lastRef.disabled || lastRef.closest('[hidden]')) return; lastRef.value = '=' + absRef(r, c); lastRef.focus(); if (q('#cfTypes').value === 'scale') visLayout(); };
    return dlgBox({ id: 'cfRuleDlg', title: base ? 'Editar regla de formato' : 'Nueva regla de formato', body, onOk, focus: '#cfTypes', modeless: !!o.modeless, onPick })
      .then(yes => yes ? rule : null);
  }
  // Inicio ▸ Formato condicional ▸ Nueva regla… (o "Más reglas…"): la regla nueva para la selección, arriba de las demás
  function cfNewRule(type, vis) {
    if (edit && !commitEdit()) return;
    hideMenu();
    return cfRuleDialog(null, [range(), ...extra], { type, vis, modeless: true }).then(rule => { if (rule) applyChanges([], { cf: [rule, ...(sheet.cf || [])] }); return rule; });
  }

  // "Administrador de reglas de formato condicionales": trabaja sobre una copia de las reglas de todas las hojas; Aplicar
  // y Aceptar la guardan en un paso de deshacer; Cancelar descarta lo que no se aplicó
  function cfManager() {
    if (edit && !commitEdit()) return;
    hideMenu();
    const work = wb.sheets.map(s => clone(s.cf || []));
    let view = 'sel', pick = -1;
    const body = document.createElement('div');
    body.innerHTML = `<label class="cf-show">Mostrar reglas de formato para:<select id="cfShow"><option value="sel">Selección actual</option><option value="sheet">Esta hoja</option>${wb.sheets.map((s, i) => i === wb.active ? '' : `<option value="s${i}"></option>`).join('')}</select></label>
      <div class="cf-bar"><button type="button" id="cfNew">Nueva regla…</button><button type="button" id="cfEdit">Editar regla…</button><button type="button" id="cfDel">Eliminar regla</button><button type="button" id="cfUp" title="Subir (más prioridad)">▲</button><button type="button" id="cfDown" title="Bajar (menos prioridad)">▼</button></div>
      <div class="cf-list"><table id="cfTable"><thead><tr><th>Regla (aplicada en el orden mostrado)</th><th>Formato</th><th>Se aplica a</th><th>Detener si es verdad</th></tr></thead><tbody></tbody></table></div>`;
    const q = s => body.querySelector(s), showSel = q('#cfShow');
    wb.sheets.forEach((s, i) => { const op = showSel.querySelector(`option[value="s${i}"]`); if (op) op.textContent = s.name; });
    const viewSi = () => view === 'sel' || view === 'sheet' ? wb.active : +view.slice(1);
    const sel = allRanges();
    const shown = () => work[viewSi()].map((d, i) => ({ d, i })).filter(({ d }) => view !== 'sel' || d.ranges.some(g => sel.some(h => overlaps(g, h))));
    // "Se aplica a" de las filas a la vista → rangos (false si alguno no es válido: se avisa y no se sigue)
    const readRanges = () => {
      const si = viewSi();
      for (const inp of body.querySelectorAll('.cf-at')) {
        const g = cfParseRanges(inp.value, wb.sheets[si]);
        if (!g) { msgBox('Referencia no válida.').then(() => { inp.focus(); inp.select(); }); return false; }
        const i = +inp.closest('tr').dataset.i;
        if (!deepEq(g, work[si][i].ranges)) work[si][i] = { ...work[si][i], ranges: g };
      }
      return true;
    };
    const render = () => {
      const si = viewSi(), S = wb.sheets[si], rows = shown(), tb = q('#cfTable tbody');
      if (!rows.some(x => x.i === pick)) pick = rows.length ? rows[0].i : -1;
      tb.innerHTML = '';
      for (const { d, i } of rows) {
        const tr = document.createElement('tr');
        tr.dataset.i = i;
        if (i === pick) tr.className = 'on';
        const f = x => isFormula(x) ? shiftFormula(x, A.r - d.ranges[0].r1, A.c - d.ranges[0].c1) : x;
        tr.innerHTML = '<td class="cf-rule"></td><td><span class="cf-sample"></span></td><td><input class="cf-at" spellcheck="false" autocomplete="off"></td><td class="cf-stopc"><input type="checkbox" class="cf-stop"></td>';
        tr.querySelector('.cf-rule').textContent = cfDescribe(d, f);
        const sm = tr.querySelector('.cf-sample');
        if (CF_VIS.has(d.type)) {
          // escala, barra o íconos: su muestra; "Detener si es verdad" no se puede marcar (como Excel)
          sm.className = 'cf-vsm' + (d.type === 'icons' ? ' ic' : '');
          sm.innerHTML = cfVisSample(d);
          tr.querySelector('.cf-stop').disabled = true;
        } else {
          sm.textContent = cfHasStyle(d.style) ? 'AaBbCcYyZz' : 'Sin formato establecido';
          if (cfHasStyle(d.style)) sm.style.cssText = cfSampleCss(d.style);
        }
        tr.querySelector('.cf-at').value = cfRangesText(d.ranges, S);
        tr.querySelector('.cf-stop').checked = !!d.stop;
        tb.appendChild(tr);
      }
      const k = rows.findIndex(x => x.i === pick);
      q('#cfEdit').disabled = q('#cfDel').disabled = k < 0;
      q('#cfUp').disabled = k <= 0;
      q('#cfDown').disabled = k < 0 || k === rows.length - 1;
    };
    showSel.onchange = () => { if (!readRanges()) { showSel.value = view; return; } view = showSel.value; pick = -1; render(); };
    q('#cfTable').addEventListener('mousedown', e => {
      const tr = e.target.closest('tbody tr');
      if (!tr || +tr.dataset.i === pick) return;
      if (!readRanges()) return;
      pick = +tr.dataset.i;
      body.querySelectorAll('#cfTable tbody tr').forEach(x => x.classList.toggle('on', +x.dataset.i === pick));
      render();
    });
    q('#cfTable').addEventListener('change', e => {
      if (!e.target.classList.contains('cf-stop')) return;
      const i = +e.target.closest('tr').dataset.i, si = viewSi();
      work[si][i] = { ...work[si][i], stop: e.target.checked };
    });
    const editPick = () => {
      if (pick < 0 || !readRanges()) return;
      const si = viewSi(), base = work[si][pick];
      cfRuleDialog(base, base.ranges).then(rule => { if (rule) { work[si][pick] = { ...rule, ranges: base.ranges, stop: base.stop }; render(); } });
    };
    q('#cfTable').addEventListener('dblclick', e => { if (e.target.closest('tbody tr') && !e.target.matches('input')) editPick(); });
    q('#cfEdit').onclick = editPick;
    q('#cfNew').onclick = () => {
      if (!readRanges()) return;
      cfRuleDialog(null, sel).then(rule => {
        if (!rule) return;
        work[wb.active].unshift(rule);   // arriba de todo, como en Excel
        if (viewSi() !== wb.active) { view = 'sheet'; showSel.value = view; }
        pick = 0;
        render();
      });
    };
    q('#cfDel').onclick = () => { if (pick < 0 || !readRanges()) return; work[viewSi()].splice(pick, 1); pick = -1; render(); };
    // ▲/▼: la regla pasa antes (o después) de la vecina que se ve en la lista
    const moveBy = dir => {
      if (pick < 0 || !readRanges()) return;
      const list = work[viewSi()], rows = shown(), k = rows.findIndex(x => x.i === pick), other = rows[k + dir];
      if (!other) return;
      const [d] = list.splice(pick, 1), j = list.indexOf(other.d);
      list.splice(dir < 0 ? j : j + 1, 0, d);
      pick = list.indexOf(d);
      render();
    };
    q('#cfUp').onclick = () => moveBy(-1);
    q('#cfDown').onclick = () => moveBy(1);
    const commit = () => {
      if (!readRanges()) return false;
      const diff = work.map((l, si) => !deepEq(l, wb.sheets[si].cf || []));
      if (diff.some(Boolean)) snapshotOp(() => { work.forEach((l, si) => { if (diff[si]) setCf(wb.sheets[si], l.map(normCf).filter(Boolean)); }); });
      work.forEach((l, si) => { work[si] = clone(wb.sheets[si].cf || []); });
      return true;
    };
    render();
    // "Se aplica a" con la hoja: el cuadro no es modal; un clic o un arrastre en la grilla escribe el rango en el campo
    // "Se aplica a" de la regla elegida (o en el último que tuvo el foco), como al contraer el cuadro en Excel. Solo en la
    // hoja activa (las reglas de otra hoja se escriben a mano)
    let lastAt = null;
    body.addEventListener('focusin', e => { if (e.target.classList.contains('cf-at')) lastAt = e.target; });
    const onPick = (r, c, g) => {
      if (viewSi() !== wb.active) return;
      const inp = lastAt && lastAt.isConnected ? lastAt : body.querySelector('#cfTable tbody tr.on .cf-at');
      if (!inp) return;
      inp.value = cfRangesText([g], sheet);
      inp.focus();
    };
    return dlgBox({ id: 'cfMgrDlg', title: 'Administrador de reglas de formato condicionales', body, onOk: commit, focus: '#cfShow', modeless: true, onPick, pickDrag: true,
      after: [{ id: 'cfApply', text: 'Aplicar', onClick: () => { if (commit()) render(); } }] });
  }

  // Región actual: el rectángulo de datos contiguo alrededor de (r, c), como Ctrl+* en Excel
  function currentRegion(r, c) { return regionOf({ r1: r, r2: r, c1: c, c2: c }); }
  // Región actual de un rango: g ampliado con los datos contiguos (también en diagonal)
  function regionOf(g0) {
    // una celda combinada cuenta entera: sus celdas cubiertas tienen el dato de la superior izquierda (como Excel)
    const ms = sheet.merges || [];
    const mergeHas = (r, c) => ms.some(m => inArea(m, r, c) && hasData(m.r1, m.c1));
    const has = (r, c) => r >= 0 && c >= 0 && r < sheet.rows && c < sheet.cols && (hasData(r, c) || (ms.length > 0 && mergeHas(r, c)));   // incluye celdas fantasma
    const g = { r1: g0.r1, r2: g0.r2, c1: g0.c1, c2: g0.c2 };
    for (let grew = true; grew;) {
      grew = false;
      const rowHas = rr => { for (let cc = g.c1 - 1; cc <= g.c2 + 1; cc++) if (has(rr, cc)) return true; return false; };
      const colHas = cc => { for (let rr = g.r1 - 1; rr <= g.r2 + 1; rr++) if (has(rr, cc)) return true; return false; };
      if (rowHas(g.r1 - 1)) { g.r1--; grew = true; }
      if (rowHas(g.r2 + 1)) { g.r2++; grew = true; }
      if (colHas(g.c1 - 1)) { g.c1--; grew = true; }
      if (colHas(g.c2 + 1)) { g.c2++; grew = true; }
    }
    return g;
  }

  // ---------- Autosuma ----------
  function autosum() {
    if (edit && !commitEdit()) return;
    const g = range();
    const isNum = (r, c) => hasData(r, c) && typeof eng.value(wb.active, r, c) === 'number';
    if (single(g)) {
      let r = A.r - 1;
      while (r >= 0 && isNum(r, A.c)) r--;
      if (r < A.r - 1) return startEdit(`=SUMA(${addr(r + 1, A.c)}:${addr(A.r - 1, A.c)})`, false);
      let c = A.c - 1;
      while (c >= 0 && isNum(A.r, c)) c--;
      if (c < A.c - 1) return startEdit(`=SUMA(${addr(A.r, c + 1)}:${addr(A.r, A.c - 1)})`, false);
      return startEdit('=SUMA()', false);
    }
    if (ensureSize(g.r2 + 1, g.c2)) paintAll();
    const items = [];
    for (let c = g.c1; c <= g.c2; c++) items.push({ r: g.r2 + 1, c, cell: { ...(clone(getCell(g.r2 + 1, c)) || {}), v: `=SUMA(${addr(g.r1, c)}:${addr(g.r2, c)})` } });
    applyChanges(items);
  }

  // ---------- Hojas ----------
  function switchSheet(i) {
    if (edit) {
      // Escribiendo una fórmula: cambiar de hoja permite señalar celdas de esa hoja (Hoja2!A1)
      if (isFormulaText(activeInput().value) && canInsertRef()) return pointSheet(i);
      if (!commitEdit()) return;
    }
    if (i !== wb.active) showSheet(i);
  }
  function pointSheet(i) {
    if (i === wb.active) return;
    const pos = activeInput().selectionStart;
    edit.refIns = null;
    showSheet(i);
    const home = i === edit.si;
    ed.style.display = home ? 'block' : 'none';
    edit.mode = home ? 'cell' : 'bar';
    const target = home ? ed : fb;
    target.focus({ preventScroll: true });
    target.setSelectionRange(pos, pos);
    updateAssist();
  }
  function showSheet(i) {
    sheet.sel = selState();
    wb.active = i;
    const s = wb.sheets[i];
    loadSel(s);
    rebuild();
    changed(false);
    wrap.scrollTo(0, 0);
    ensureVisible(A.r, A.c);
  }
  function uniqueName(base) {
    let n = 1, name;
    do { name = base + n++; } while (wb.sheets.some(s => s.name.toLowerCase() === name.toLowerCase()));
    return name;
  }
  function addSheet() {
    if (edit && !commitEdit()) return;
    sheet.sel = selState();
    snapshotOp(() => { wb.sheets.push(newSheet(uniqueName('Hoja'))); wb.active = wb.sheets.length - 1; A = F = { r: 0, c: 0 }; P = null; });
  }
  function duplicateSheet(i) {
    const s = clone(wb.sheets[i]);
    let base = s.name + ' (', n = 2;
    while (wb.sheets.some(x => x.name.toLowerCase() === (base + n + ')').toLowerCase())) n++;
    s.name = base + n + ')';
    // los nombres con ámbito en la hoja original se copian con ámbito en la copia (como Excel)
    snapshotOp(() => { wb.sheets.splice(i + 1, 0, s); wb.active = i + 1; Bx.namesDuplicateSheet(wb, wb.sheets[i].name, s.name); });
  }
  function renameSheet(i) {
    const s = wb.sheets[i];
    const name = (prompt('Nombre de la hoja:', s.name) || '').trim();
    if (!name || name === s.name) return;
    if (/[\[\]:*?\/\\]/.test(name) || name.length > 31) return toast('Nombre no válido (máx. 31 caracteres, sin [ ] : * ? / \\)');
    if (wb.sheets.some((x, j) => j !== i && x.name.toLowerCase() === name.toLowerCase())) return toast('Ya existe una hoja con ese nombre');
    snapshotOp(() => {
      for (const sh of wb.sheets) for (const cell of Object.values(sh.cells)) if (isFormula(cell.v)) cell.v = renameSheetInFormula(cell.v, s.name, name);
      Bx.namesRenameSheet(wb, s.name, name);   // "Se refiere a" y ámbito de los nombres
      dvFormulasAll(f => renameSheetInFormula(f, s.name, name));   // Origen =Hoja2!$A$1:$A$3 y demás fórmulas de validación
      s.name = name;
    });
  }
  function deleteSheet(i) {
    if (wb.sheets.length === 1) return toast('El libro debe tener al menos una hoja');
    if (!confirm(`¿Eliminar la hoja "${wb.sheets[i].name}"?`)) return;
    snapshotOp(() => {
      const gone = wb.sheets[i].name;
      wb.sheets.splice(i, 1); wb.active = Math.min(wb.active, wb.sheets.length - 1); A = F = { r: 0, c: 0 }; P = null;
      // como Excel, las referencias a la hoja eliminada quedan en #¡REF! para siempre (aunque se cree otra con ese
      // nombre); los nombres con ámbito en ella se eliminan
      for (const sh of wb.sheets) for (const cell of Object.values(sh.cells)) if (isFormula(cell.v)) cell.v = Bx.deleteSheetInFormula(cell.v, gone);
      Bx.namesDeleteSheet(wb, gone);
      dvFormulasAll(f => Bx.deleteSheetInFormula(f, gone));
    });
  }

  // ---------- Buscar y reemplazar ----------
  const findDlg = $('#findDlg');
  // Ctrl+B: Buscar · Ctrl+L: Reemplazar (mismo cuadro; con Reemplazar el foco va al campo de búsqueda igual que Excel)
  function openFind(replace) {
    if (edit && !commitEdit()) return;
    findDlg.querySelector('h3').textContent = replace ? 'Reemplazar' : 'Buscar y reemplazar';
    findDlg.showModal();
    $('#findText').select();
  }
  // Ctrl+I / F5: Ir a (referencia o rango, como el cuadro de nombres)
  function goToDialog() {
    if (edit && !commitEdit()) return;
    const ref = prompt('Ir a — Referencia:', addr(A.r, A.c));
    if (ref && ref.trim()) gotoRef(ref);
  }
  // Ctrl+Alt+V: Pegado especial (lo copiado en Bassxcel), en el orden del cuadro de Excel: Todo, Fórmulas, Valores,
  // Formatos y Transponer. Sin nada copiado (o después de Cortar) el menú aparece igual con las opciones deshabilitadas
  function pasteSpecialMenu() {
    if (edit && !commitEdit()) return;
    const off = { disabled: !clip || clip.cut };
    const R = rect({ r1: A.r, c1: A.c, r2: A.r, c2: A.c }), W = wrap.getBoundingClientRect();
    showMenu({ clientX: W.left + R.left + R.width - wrap.scrollLeft, clientY: W.top + R.top + R.height - wrap.scrollTop }, [
      ['Pegado especial: Todo', () => pasteInternal(range()), off], ['Fórmulas', () => pasteSpecial('formulas'), off],
      ['Valores', () => pasteSpecial('values'), off], ['Formatos', () => pasteSpecial('formats'), off],
      ['Transponer', () => pasteSpecial('transpose'), off],
    ]);
  }
  // Enter en los campos del diálogo busca el siguiente (no cierra el diálogo)
  for (const id of ['#findText', '#replText']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#findNext').click(); } });
  $('#findNext').onclick = () => {
    const q = $('#findText').value.toLowerCase();
    if (!q) return;
    // también los valores desbordados (celdas fantasma)
    const keys = Object.keys(sheet.cells).map(parseAddr).concat(ghostsIn({ r1: 0, c1: 0, r2: sheet.rows - 1, c2: sheet.cols - 1 }).filter(p => !getCell(p.r, p.c)))
      .sort((a, b) => a.r - b.r || a.c - b.c);
    const after = keys.filter(p => p.r > A.r || (p.r === A.r && p.c > A.c));
    const hit = [...after, ...keys].find(p => {
      const cell = getCell(p.r, p.c);
      return rawOf(cell).toLowerCase().includes(q) || display(eng.value(wb.active, p.r, p.c), cell).toLowerCase().includes(q);
    });
    if (hit) setSel(hit); else toast('No se encontró "' + $('#findText').value + '"');
  };
  $('#replAll').onclick = () => {
    const q = $('#findText').value, rep = $('#replText').value;
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const items = [];
    for (const [k, cell] of Object.entries(sheet.cells)) {
      if (!re.test(cell.v)) continue;
      re.lastIndex = 0;
      const p = parseAddr(k);
      // el texto reemplazado se vuelve a ingresar, como si se escribiera (misma lógica de entrada, L-040)
      items.push({ r: p.r, c: p.c, cell: entryCell(clone(cell), cell.v.replace(re, () => rep), effStyle(p.r, p.c)) });
    }
    applyChanges(items);
    toast(items.length ? `${items.length} celda(s) reemplazada(s)` : 'Sin coincidencias');
  };

  // ---------- Archivos ----------
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const safeName = n => n.replace(/[\\/:*?"<>|]/g, '_');

  async function saveFile(as) {
    if (edit && !commitEdit()) return;
    sheet.sel = selState();
    const data = JSON.stringify(serialize());
    if (window.showSaveFilePicker) {
      try {
        if (!fileHandle || as) fileHandle = await showSaveFilePicker({ suggestedName: safeName(wb.name) + '.bassx', types: [{ description: 'Libro Bassxcel', accept: { 'application/json': ['.bassx'] } }] });
        const w = await fileHandle.createWritable();
        await w.write(data);
        await w.close();
        wb.name = fileHandle.name.replace(/\.bassx$/i, '');
        dirty = false;
        updTitle(); autosave();
        $('#saveState').textContent = 'Guardado en ' + fileHandle.name;
        toast('Guardado');
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
        fileHandle = null;
      }
    }
    download(new Blob([data], { type: 'application/json' }), safeName(wb.name) + '.bassx');
    dirty = false;   // descarga: no hay cómo saber si se completó; se considera guardado
    autosave();
    return true;
  }

  function openFile() { if (edit && !commitEdit()) return; $('#fileInput').value = ''; $('#fileInput').click(); }
  $('#fileInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase(), base = file.name.replace(/\.[^.]+$/, '');
    try {
      let next;
      if (ext === 'bassx' || ext === 'json') next = parseBassx(await file.text(), file.name);
      else if (['csv', 'tsv', 'txt'].includes(ext)) {
        const s = newSheet(base.slice(0, 31) || 'Hoja1');
        const rows = parseDelimited(decodeText(await file.arrayBuffer()).replace(/^﻿/, ''));
        // cada valor pasa por la lógica de entrada, como si se escribiera ($1.500, 50%, 1.234,5, 01/01/2026; L-040)
        rows.forEach((row, r) => row.forEach((v, c) => { const n = v !== '' && normCell(entryCell({}, v, {})); if (n) s.cells[addr(r, c)] = n; }));
        s.rows = Math.max(s.rows, rows.length + 50);
        s.cols = Math.max(s.cols, rows.reduce((m, r) => Math.max(m, r.length + 5), 0));
        next = { name: base, active: 0, sheets: [s] };
      } else {
        if (!window.XLSX) throw new Error('Falta vendor/xlsx.full.min.js para abrir archivos de Excel');
        next = fromXlsx(await file.arrayBuffer(), base);
      }
      next.name = base;
      const skipped = next.skippedNames || [];
      delete next.skippedNames;
      if (openWorkbook(next, null, file.name) && skipped.length) {
        msgBox(`No se importaron ${skipped.length === 1 ? 'este nombre definido' : 'estos ' + skipped.length + ' nombres definidos'} (ocultos, internos de Excel o no válidos en Bassxcel):\n${skipped.slice(0, 12).join(', ')}${skipped.length > 12 ? '…' : ''}`);
      }
    } catch (err) {
      console.error(err);
      alert('No se pudo abrir el archivo:\n' + err.message);
    }
  });
  // Abrir un libro ya leído (botón Abrir, archivo de Electron o de la PWA): pregunta si el actual tiene cambios sin
  // guardar (L-041) y lo reemplaza. handle: FileSystemFileHandle para Guardar (PWA) o null. → true si se abrió
  function openWorkbook(next, handle, fileName) {
    if (!confirmDiscard(`¿Abrir "${fileName}"?`)) return false;
    loadWorkbook(next);
    fileHandle = handle || null;
    toast('Abierto: ' + fileName);
    return true;
  }
  // .bassx (texto JSON) → libro normalizado
  function parseBassx(text, fileName) {
    const o = JSON.parse(text);
    if (!o || !Array.isArray(o.sheets)) throw new Error('El archivo no es un libro de Bassxcel');
    const next = normalize(o);
    next.name = fileName.replace(/\.[^.]+$/, '');
    return next;
  }

  function loadWorkbook(next) {
    // una edición en curso se confirma en el libro actual, nunca en el nuevo (P2 5: archivo recibido mientras se edita)
    if (edit) commitEdit(0, 0, true);
    wb = next;
    if (!Array.isArray(wb.names)) wb.names = [];   // CSV y libros nuevos
    eng = new Engine(wb);
    spillMemo = null;
    undoStack = []; redoStack = []; clip = null;
    const s = wb.sheets[wb.active];
    loadSel(s);
    rebuild();
    changed(false);
    // recién abierto (o nuevo): no hay cambios sin guardar; el autoguardado pasa a ser este libro
    dirty = false;
    scheduleSave(false);
    wrap.scrollTo(0, 0);
  }

  function newWorkbookCmd() {
    if (!confirmDiscard('¿Crear un libro nuevo?')) return;
    fileHandle = null;
    loadWorkbook(newWorkbook());
  }

  // Excel en Windows guarda los CSV en ANSI (Windows-1252); si no es UTF-8 válido se decodifica así
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { return new TextDecoder('windows-1252').decode(buf); }
  }
  // CSV/TSV con comillas; detecta el separador si no se indica
  function parseDelimited(text, delim) {
    if (!delim) {
      const first = text.split(/\r?\n/, 1)[0];
      const cnt = ch => first.split(ch).length;
      delim = cnt('\t') > 1 ? '\t' : cnt(';') > cnt(',') ? ';' : ',';
    }
    const rows = [];
    let row = [], f = '', q = false, quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"' && f === '' && !quoted) { q = true; quoted = true; }
      else if (ch === delim) { row.push(f); f = ''; quoted = false; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(f); rows.push(row); row = []; f = ''; quoted = false;
      } else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  function exportCSV() {
    if (edit && !commitEdit()) return;
    const dec = (1.5).toLocaleString(LOCALE).includes(',');
    const d = dec ? ';' : ',';
    const { r: maxR, c: maxC } = usedExtent(false);   // con los valores desbordados
    const lines = [];
    for (let r = 0; r <= maxR; r++) {
      const row = [];
      for (let c = 0; c <= maxC; c++) {
        const cell = getCell(r, c);
        let t = display(eng.value(wb.active, r, c), { v: cell ? cell.v : '', s: effStyle(r, c) });
        if (t.includes(d) || /["\r\n]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
        row.push(t);
      }
      lines.push(row.join(d));
    }
    download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), safeName(wb.name + ' - ' + sheet.name) + '.csv');
  }

  const XFMT = { number: '#,##0.00', integer: '#,##0', currency: '"$"#,##0', percent: '0.00%', date: 'dd-mm-yyyy', datetime: 'dd-mm-yyyy hh:mm', time: 'hh:mm', scientific: '0.00E+00' };
  // Códigos de error de SheetJS (tabla BErr de vendor/xlsx 0.20.3, medido con tests/xlsx-spill.measure.js): llega
  // hasta #GETTING_DATA (0x2B) y no tiene #SPILL! ni #CALC! (los escribiría como "undefined"). Esos dos se guardan como
  // valor de texto en caché junto con su fórmula: Excel recalcula al abrir (SheetJS no escribe calcId) y vuelve a
  // mostrar el error; al importar en Bassxcel manda la fórmula. #CIRC! no existe en Excel: 0.
  const XERR = { '#NULL!': 0x00, '#DIV/0!': 0x07, '#VALUE!': 0x0F, '#REF!': 0x17, '#NAME?': 0x1D, '#NUM!': 0x24, '#N/A': 0x2A };
  const XERR_TEXT = new Set(['#SPILL!', '#CALC!']);
  // valor del motor → celda de SheetJS (t, v)
  function xCell(v) {
    if (v instanceof FErr) return XERR[v.code] != null ? { t: 'e', v: XERR[v.code], w: v.code } : XERR_TEXT.has(v.code) ? { t: 's', v: v.code } : { t: 'n', v: 0 };
    if (typeof v === 'number') return { t: 'n', v };
    if (typeof v === 'boolean') return { t: 'b', v };
    return { t: 's', v: v == null ? '' : String(v) };
  }
  const xFmt = (o, fmt) => { if (XFMT[fmt] && o.t === 'n') o.z = fmt === 'currency' && !Number.isInteger(o.v) ? '"$"#,##0.00' : XFMT[fmt]; };
  async function exportXlsx() {
    if (edit && !commitEdit()) return;
    if (!window.XLSX) return toast('Exportación .xlsx no disponible (falta vendor/xlsx.full.min.js)');
    // SheetJS CE no lee ni escribe dataValidations ni conditionalFormatting (vendor/xlsx.full.min.js no los menciona,
    // medido con grep el 2026-11-04): se avisa antes de perderlos
    const loss = xlsxLossText();
    if (loss && !await askBox(loss)) return;
    const book = XLSX.utils.book_new();
    wb.sheets.forEach((s, i) => {
      const ws = {};
      let maxR = 0, maxC = 0;
      // Matrices dinámicas: el ancla va con su fórmula, F (rango desbordado) y D: true (SheetJS escribe cm="1" y la
      // metadata XLDAPR, como Excel 365); las celdas fantasma solo con su valor en caché (t/v)
      const spills = eng.spills(i), anchors = new Map(spills.map(sp => [addr(sp.anchor.r, sp.anchor.c), sp]));
      for (const [k, cell] of Object.entries(s.cells)) {
        if (cell.v === '') continue;
        const p = parseAddr(k);
        maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
        const o = xCell(eng.value(i, p.r, p.c));
        if (isFormula(cell.v)) {
          o.f = toExcelFormula(cell.v.slice(1));
          const sp = anchors.get(k);
          // también una fórmula que puede devolver una matriz sin desbordar (1x1, #¡DESBORDAMIENTO!): con D, Excel no
          // le agrega @ al abrirla (sin D la leería como fórmula de siempre, con intersección implícita)
          if (sp) { o.F = addr(sp.r1, sp.c1) + ':' + addr(sp.r2, sp.c2); o.D = true; }
          else if (Bx.mayArrayFormula(cell.v)) { o.F = k + ':' + k; o.D = true; }
        }
        xFmt(o, autoFmt(cell));
        ws[k] = o;
      }
      for (const sp of spills) {
        for (let r = sp.r1; r <= sp.r2; r++) for (let c = sp.c1; c <= sp.c2; c++) {
          if (r === sp.anchor.r && c === sp.anchor.c) continue;
          const k = addr(r, c), own = s.cells[k], o = xCell(eng.value(i, r, c));
          xFmt(o, own && own.s && own.s.fmt);   // formato propio de la celda fantasma (no el del ancla)
          ws[k] = o;
        }
        maxR = Math.max(maxR, sp.r2); maxC = Math.max(maxC, sp.c2);
      }
      ws['!ref'] = 'A1:' + addr(maxR, maxC);
      ws['!cols'] = Array.from({ length: maxC + 1 }, (_, c) => (s.hiddenC || []).includes(c) ? { wpx: s.colW[c] || DEF_W, hidden: true } : { wpx: s.colW[c] || DEF_W });
      // altos de fila manuales y filas ocultas a mano. Se pasa hpt (puntos = px × 0,75): SheetJS 1.15 convierte
      // hpx con 96 ppp y escribiría los píxeles como si fueran puntos
      const rws = [];
      for (const [r, h] of Object.entries(s.rowH || {})) rws[+r] = { hpt: Math.round(h * 0.75 * 100) / 100 };
      for (const r of s.hiddenR || []) rws[r] = { ...(rws[r] || {}), hidden: true };
      if (rws.length) ws['!rows'] = rws;   // arreglo disperso: SheetJS omite los huecos
      if (s.merges) ws['!merges'] = s.merges.map(m => ({ s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } }));
      XLSX.utils.book_append_sheet(book, ws, s.name.slice(0, 31));
    });
    // nombres definidos (definedNames): "Se refiere a" en inglés sin "=" y Sheet = índice de la hoja de ámbito
    if (wb.names && wb.names.length) { book.Workbook = book.Workbook || {}; book.Workbook.Names = Bx.namesToXlsx(wb); }
    XLSX.writeFile(book, safeName(wb.name) + '.xlsx');
  }

  function fromXlsx(buf, base) {
    // cellStyles: SheetJS solo lee los altos de fila (!rows) y las filas ocultas con esta opción.
    // xlfn: sin ella SheetJS quita "_xlfn." y el motor ya no reconoce _xlfn.ANCHORARRAY (A1#) ni _xlfn.SINGLE (@)
    // (medido con tests/xlsx-spill.measure.js); fromExcelFormula quita los prefijos de las funciones
    const x = XLSX.read(buf, { type: 'array', cellStyles: true, xlfn: true });
    const sheets = x.SheetNames.map(name => {
      const ws = x.Sheets[name], s = newSheet(name.slice(0, 31));
      if (ws['!ref']) {
        const rg = XLSX.utils.decode_range(ws['!ref']);
        s.rows = Math.max(s.rows, rg.e.r + 51);
        s.cols = Math.max(s.cols, rg.e.c + 6);
      }
      for (const k of Object.keys(ws)) {
        if (k[0] === '!') continue;
        const c = ws[k], p = parseAddr(k);
        if (!p) continue;
        // Rango de una fórmula de matriz (F): SheetJS pone F en todas sus celdas y la fórmula solo en la esquina. Las
        // demás son celdas fantasma (valores en caché de un desborde): no se importan, el motor las vuelve a calcular
        if (c.F && String(c.F).split(':')[0].replace(/\$/g, '').toUpperCase() !== k) continue;
        let raw;
        // fórmulas: del formato .xlsx (inglés, ',') a es-CL (español, ';', coma decimal). Con D (matriz dinámica de
        // Excel 365) o F (matriz) se importa tal cual y desborda; sin ellas es una fórmula de siempre y Excel le aplica
        // la intersección implícita: =A1:A3*2 → =@A1:A3*2 (Bx.implicitIntersect)
        if (c.f) {
          raw = '=' + Bx.fromExcelFormula(c.f);
          if (!c.D && !c.F) raw = Bx.implicitIntersect(raw);
        }
        else if (c.t === 'b') raw = Bx.toRaw(!!c.v);
        // números: toRaw (coma decimal, sin miles); String(1.234) se releería como 1234 (P0 1, L-014)
        else if (c.t === 'n') raw = Bx.toRaw(c.v);
        else if (c.t === 'e') raw = ERR_TXT(c.w || '#N/A');
        else if (c.t === 'd') {
          // Excel cuenta el 29/02/1900: antes del serial 61 el cálculo desde el 30/12/1899 va un día adelantado (L-017)
          let sr = (c.v - Date.UTC(1899, 11, 30)) / 86400000;
          if (sr < 61) sr -= 1;
          raw = Bx.toRaw(sr);
        } else {
          raw = c.v == null ? '' : String(c.v);
          if (literal(raw) !== raw || raw.startsWith('=') || raw.startsWith("'")) raw = "'" + raw;
        }
        if (raw === '') continue;
        const cell = { v: raw };
        if (c.z && c.t === 'n') {
          const z = String(c.z);
          let fmt = null;
          if (/General/i.test(z)) fmt = null;
          // se ignoran textos entre comillas y modificadores [Red]/[$-409] antes de buscar códigos de fecha
          else if (/[dy]/i.test(z.replace(/"[^"]*"|\[[^\]]*\]/g, ''))) fmt = /h/i.test(z) ? 'datetime' : 'date';
          else if (/h+:mm/i.test(z)) fmt = 'time';
          else if (/E[+-]/i.test(z.replace(/"[^"]*"/g, ''))) fmt = 'scientific';
          else if (z.includes('%')) fmt = 'percent';
          else if (z.includes('$')) fmt = 'currency';
          else if (/0[.,]0/.test(z)) fmt = 'number';
          else if (/#,##0/.test(z)) fmt = 'integer';
          if (fmt) cell.s = { fmt };
        }
        s.cells[addr(p.r, p.c)] = cell;
      }
      (ws['!cols'] || []).forEach((col, i) => {
        if (col && (col.wpx || col.wch)) s.colW[i] = Math.round(col.wpx || col.wch * 7 + 5);
        if (col && col.hidden) (s.hiddenC = s.hiddenC || []).push(i);
      });
      // altos de fila: ht viene en puntos (hpt); SheetJS calcula hpx con 96 ppp (= puntos), por eso hpt × 4/3.
      // Los altos ≈ predeterminados de Excel (15 pt) quedan con el alto predeterminado de Bassxcel
      (ws['!rows'] || []).forEach((row, i) => {
        if (!row) return;
        if (row.hidden) (s.hiddenR = s.hiddenR || []).push(i);
        else if (row.hpt && Math.abs(row.hpt - 15) > 0.3) (s.rowH = s.rowH || {})[i] = Math.min(546, Math.max(1, Math.round(row.hpt * 4 / 3)));
      });
      if (ws['!merges'] && ws['!merges'].length) s.merges = ws['!merges'].map(m => ({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c }));
      return s;
    });
    if (!sheets.length) sheets.push(newSheet('Hoja1'));
    // nombres definidos: el motor convierte la fórmula a es-CL y omite los ocultos, los internos de Excel
    // (_xlnm.Print_Area, _xlnm._FilterDatabase…) y los inválidos; se avisa de los omitidos que ve el usuario
    const nm = Bx.namesFromXlsx(x.Workbook && x.Workbook.Names, { sheets });
    const skipped = nm.skipped.filter(n => !/^_xlnm\._FilterDatabase$/i.test(n));
    return { name: base, active: 0, sheets, names: nm.names, skippedNames: skipped };
  }

  // ---------- Cinta de opciones ----------
  const CMDS = {
    new: newWorkbookCmd, open: openFile, save: () => saveFile(false), saveas: () => saveFile(true),
    xlsx: exportXlsx, csv: exportCSV, undo, redo,
    b: () => toggleStyle('b'), i: () => toggleStyle('i'), u: () => toggleStyle('u'),
    clearfmt: clearFormats, cf: cfMenu,
    borders: bordersMenu, freeze: freezeMenu, print: printSheet, filter: toggleFilter, merge: toggleMerge, 'dec-more': () => changeDecimals(1), 'dec-less': () => changeDecimals(-1),
    thousands: () => styleSel(s => { s.fmt = 'number'; delete s.dec; }),
    'bg-last': () => styleSel(s => { s.bg = $('#bgColor').value; }), 'bg-none': () => styleSel(s => { delete s.bg; }),
    'fg-last': () => styleSel(s => { s.fg = $('#fgColor').value; }),
    'al-left': () => styleSel(s => { s.al = 'left'; }), 'al-center': () => styleSel(s => { s.al = 'center'; }), 'al-right': () => styleSel(s => { s.al = 'right'; }),
    'ins-row': insertRows, 'del-row': deleteRows, 'ins-col': insertCols, 'del-col': deleteCols,
    autosum, 'sort-asc': () => sortSel(false), 'sort-desc': () => sortSel(true), sort: () => openSortDialog(), dedupe: openDedupe, dv: dvMenu, find: openFind,
    help: () => { $('#fnList').textContent = Bx.FUNCTIONS.join('  ·  '); $('#helpDlg').showModal(); },
    // Ajustar texto alterna según la celda activa (como Excel); la alineación vertical "inferior" es la predeterminada
    wrap: () => toggleStyle('wrap'),
    'va-top': () => styleSel(s => { s.va = 'top'; }), 'va-middle': () => styleSel(s => { s.va = 'middle'; }), 'va-bottom': () => styleSel(s => { s.va = 'bottom'; }),
    'font-up': () => stepFontSize(1), 'font-down': () => stepFontSize(-1),
    // Fórmulas ▸ Nombres definidos
    names: openNameManager, definename: () => openNameEditor(null), usename: pasteNameDialog, createnames: createNamesDialog,
  };
  // ---------- Fuente y tamaño ----------
  const fontSel = $('#fontSel'), sizeSel = $('#sizeSel');
  // tamaño en puntos (1..409, admite medios puntos y coma decimal, como Excel); 11 = predeterminado (no se guarda)
  function setFontSize(pt) {
    pt = Math.round(pt * 2) / 2;
    styleSel(s => { if (pt === DEF_PT) delete s.fs; else s.fs = pt; });
  }
  // Ctrl+Mayús+> / Ctrl+< y botones A▲/A▼: siguiente tamaño de la lista estándar de Excel
  function stepFontSize(dir) {
    const cur = effStyle(A.r, A.c).fs || DEF_PT;
    const next = dir > 0 ? FONT_SIZES.find(x => x > cur) ?? Math.min(409, Math.ceil(cur / 10) * 10 + 10)
      : [...FONT_SIZES].reverse().find(x => x < cur) ?? Math.max(1, cur - 1);
    setFontSize(next);
  }
  fontSel.addEventListener('change', () => { const v = fontSel.value; styleSel(s => { if (v) s.ff = v; else delete s.ff; }); wrap.focus({ preventScroll: true }); });
  function applySizeInput() {
    const pt = Number(sizeSel.value.trim().replace(',', '.'));
    if (!isFinite(pt) || pt < 1 || pt > 409) {
      // como Excel: aviso, el cuadro vuelve al tamaño vigente y queda seleccionado para corregirlo
      toast('El número debe estar entre 1 y 409');
      sizeSel.value = fmtPtNum(effStyle(A.r, A.c).fs || DEF_PT);
      sizeSel.select();
      return;
    }
    if (pt !== (effStyle(A.r, A.c).fs || DEF_PT)) setFontSize(pt);
    sizeSel.blur();
    wrap.focus({ preventScroll: true });
  }
  sizeSel.addEventListener('change', applySizeInput);
  // elegir un valor de la lista desplegable también aplica sin esperar a Enter
  sizeSel.addEventListener('input', e => { if (e.inputType === 'insertReplacementText' || e.inputType == null) applySizeInput(); });
  sizeSel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); sizeSel.blur(); refreshBar(); wrap.focus({ preventScroll: true }); } });
  sizeSel.addEventListener('focus', () => { if (edit && !commitEdit()) return; sizeSel.select(); });
  fontSel.addEventListener('mousedown', () => { if (edit && !commitEdit()) return; });
  document.querySelector('.ribbon').addEventListener('click', e => {
    const b = e.target.closest('button[data-cmd]');
    if (!b) return;
    if (edit && !['autosum', 'usename'].includes(b.dataset.cmd) && !commitEdit()) return;
    CMDS[b.dataset.cmd]();
    if (!edit) wrap.focus({ preventScroll: true });
  });
  // Colores: el botón aplica el último color elegido; el selector elige uno nuevo (una sola entrada de deshacer)
  $('#bgColor').addEventListener('change', e => styleSel(s => { s.bg = e.target.value; }));
  $('#fgColor').addEventListener('change', e => styleSel(s => { s.fg = e.target.value; }));
  $('#fmtSel').addEventListener('change', e => { styleSel(s => { s.fmt = e.target.value; }); wrap.focus(); });
  $('#docName').addEventListener('click', () => {
    const n = (prompt('Nombre del libro:', wb.name) || '').trim();
    if (n) { wb.name = n; updTitle(); scheduleSave(); }
  });

  // Al recargar o cerrar: se confirma la edición y se autoguarda. Si el autoguardado falló, o si otra pestaña de
  // Bassxcel lo va a sobrescribir, los cambios sin guardar en un archivo se perderían: el navegador pide confirmación
  // (L-041). Con el autoguardado funcionando no se pregunta (Ctrl+R recupera el libro, como hasta ahora).
  window.addEventListener('beforeunload', e => {
    if (edit) commitEdit(0, 0, true);   // al cerrar no se valida: se guarda lo escrito
    autosave();
    if (dirty && hasContent() && (saveFailed || otherTabWarned)) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('resize', drawSel);

  // Gancho de pruebas (tests/ui-dv.harness.js): el validador puro con una regla suelta en una celda de la hoja activa.
  // raw es lo escrito ('' = vacía); las fórmulas de la regla se evalúan en esa celda. No cambia nada del libro
  window.__bxDv = {
    check(rule, raw, at = 'A1') {
      const p = parseAddr(at), d = normDv({ ...rule, ranges: rule.ranges || [{ r1: p.r, c1: p.c, r2: p.r, c2: p.c }] });
      const v = raw === '' ? null : literal(raw);
      return dvCheck(d, v, { text: raw, evalF: f => dvEval(d, f, wb.active, p.r, p.c), items: () => dvItems(d, wb.active, p.r, p.c) });
    },
  };

  // Gancho de pruebas (tests/ui-cf.harness.js): el estilo condicional calculado de una celda de la hoja activa (null si
  // no aplica ninguna regla) y la fecha de "hoy" fija para las reglas de fechas (serial; null = la de la computadora)
  window.__bxCf = {
    style(at) { const p = parseAddr(at); return cfStyle(sheet, wb.active, p.r, p.c); },
    setToday(serial) { cfTodayFix = serial == null ? null : +serial; cfRefresh(); return cfToday(); },
    // reemplaza las reglas de la hoja activa (un paso de deshacer); at: rangos como texto ("A1:A8 C1"), en vez de ranges
    set(rules) {
      const list = rules.map(d => normCf({ ...d, ranges: d.ranges || String(d.at).split(/\s+/).map(t => { const g = parseRefText(t); return { r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 }; }) })).filter(Boolean);
      applyChanges([], { cf: list });
      return list.length;
    },
  };

  // ---------- Inicio ----------
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch { saved = null; }
  // Sintaxis de Excel en español (Chile): ';' entre argumentos y coma decimal, antes de crear el motor (L-026)
  Bx.setSyntax('es-CL');
  loadWorkbook(saved && Array.isArray(saved.sheets) ? normalize(saved) : newWorkbook());
  // el libro restaurado conserva su estado "sin guardar en archivo" (autoguardados viejos sin el dato: si tiene datos)
  dirty = !!saved && saved.dirty !== false && hasContent();
  clearTimeout(saveTimer);
  $('#saveState').textContent = saved ? 'Libro restaurado del autoguardado' : '';
  wrap.focus();

  // Versión web: habilita uso sin conexión e instalación como app (no aplica en file:// ni en el escritorio)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});

  // Abrir un .bassx con doble clic en la app de escritorio
  if (window.bassxcelDesktop) {
    // también pregunta si el libro actual tiene cambios sin guardar (L-041)
    window.bassxcelDesktop.onOpenFile(({ name, text }) => {
      try { openWorkbook(parseBassx(text, name), null, name); }
      catch (err) { alert('No se pudo abrir el archivo:\n' + err.message); }
    });
  }

  // Abrir un .bassx con doble clic (PWA instalada con file_handlers); igual que Abrir (pregunta si hay cambios)
  if ('launchQueue' in window) {
    launchQueue.setConsumer(async params => {
      const h = params.files && params.files[0];
      if (!h) return;
      try {
        const file = await h.getFile();
        openWorkbook(parseBassx(await file.text(), file.name), h, file.name);
      } catch (err) { alert('No se pudo abrir el archivo:\n' + err.message); }
    });
  }
})();

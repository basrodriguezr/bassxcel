'use strict';
// Bassxcel — motor de fórmulas (tokenizador, parser, evaluador y funciones)
const Bx = (() => {
  const colName = c => { let s = ''; for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s; return s; };
  const colIndex = name => [...name.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const addr = (r, c) => colName(c) + (r + 1);
  const parseAddr = a => { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(a); return m ? { r: +m[2] - 1, c: colIndex(m[1]) } : null; };

  class FErr { constructor(code) { this.code = code; } toString() { return this.code; } }
  const E = {
    div0: new FErr('#DIV/0!'), value: new FErr('#VALUE!'), ref: new FErr('#REF!'), name: new FErr('#NAME?'),
    circ: new FErr('#CIRC!'), na: new FErr('#N/A'), num: new FErr('#NUM!'),
    spill: new FErr('#SPILL!'), calc: new FErr('#CALC!'), // matrices dinámicas: desborde bloqueado; matriz vacía o anidada
  };
  // Códigos de error como los muestra Excel en español (los internos y los de .xlsx van en inglés)
  const ERR_ES = { '#DIV/0!': '#¡DIV/0!', '#VALUE!': '#¡VALOR!', '#REF!': '#¡REF!', '#NAME?': '#¿NOMBRE?', '#N/A': '#N/D', '#NUM!': '#¡NUM!', '#CIRC!': '#CIRC!',
    '#SPILL!': '#¡DESBORDAMIENTO!', '#CALC!': '#¡CALC!' };
  // Error escrito en una fórmula (en inglés o en español) → objeto de error
  const ERR_IN = {};
  for (const e of Object.values(E)) { ERR_IN[e.code] = e; ERR_IN[ERR_ES[e.code]] = e; }
  ERR_IN['#DESBORDAMIENTO!'] = E.spill; // la documentación en español lo escribe también sin "¡"

  const isFormula = raw => typeof raw === 'string' && raw.length > 1 && raw[0] === '=';

  // ---------- Fechas (serial estilo hoja de cálculo: días desde 1899-12-30) ----------
  const EPOCH = Date.UTC(1899, 11, 30);
  // Excel trata 1900 como bisiesto (serial 60 = 29/02/1900 ficticio): antes del 01/03/1900 (serial 61)
  // los seriales van un día atrás, así 01/01/1900 = 1 y AÑO(1) = 1900, como en Excel
  // El serial se cuenta desde el día 1 del mes (ya normalizado), así febrero de 1900 tiene 29 días como en
  // Excel: FECHA(1900;2;29) = 60 y FECHA(1900;3;0) = 60
  const dateSerial = (y, m, d) => {
    const yy = y + Math.floor((m - 1) / 12), mm = ((m - 1) % 12 + 12) % 12;
    const s1 = (Date.UTC(yy, mm, 1) - EPOCH) / 86400000;
    return (s1 < 61 ? s1 - 1 : s1) + d - 1;
  };
  const serialDate = s => new Date(EPOCH + Math.round((s < 61 ? s + 1 : s) * 86400000));
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Meses en español (Excel es-CL: "30-Ene-2008", "5-jul"), abreviados o completos, sin distinguir mayúsculas
  const MES_IN = { ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
    jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10,
    nov: 11, noviembre: 11, dic: 12, diciembre: 12 };
  // Año escrito: 4 dígitos tal cual; 1 o 2 dígitos con la regla de 2029 de Windows (00–29 → 20xx, 30–99 → 19xx)
  const yearOf = s => s.length === 4 ? +s : s.length <= 2 ? (+s < 30 ? 2000 : 1900) + +s : NaN;
  // Fecha válida en el calendario de Excel (01/01/1900–31/12/9999; 1900 es bisiesto: 29/02/1900 = serial 60)
  const validYMD = (y, m, d) => y >= 1900 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && (d <= daysIn(y, m) || (y === 1900 && m === 2 && d === 29));
  const ISO_RE = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/;
  const DMY_RE = /^(\d{1,2})[\/-](\d{1,4})(?:[\/-](\d{1,4}))?$/;
  const DAY_NAME_RE = /^(\d{1,2})(?:[\/-]|\s+)([a-z]+)\.?(?:(?:[\/-]|\s+)(\d{1,4}))?$/i;
  const NAME_NUM_RE = /^([a-z]+)\.?(?:[\/-]|\s+)(\d{1,4})$/i;
  const ymdSerial = (y, m, d) => validYMD(y, m, d) ? dateSerial(y, m, d) : null;
  // Fecha con dos partes, como Excel: primero día/mes del año actual; si no, mes/año con día 1
  // ("12/99" → 01/12/1999, "ene-45" → 01/01/1945); si tampoco, texto
  const twoParts = (d, m, my, yText) => ymdSerial(new Date().getFullYear(), m, d) ?? ymdSerial(yearOf(yText), my, 1);
  // Fecha escrita (es-CL: d/m/aa, d/m/aaaa, d-m-aa, d/m, aaaa-mm-dd, 1-ene-26, 1-ene, ene-26) → serial;
  // null si no es una fecha válida (31/02/2026 queda como texto)
  function parseDate(t) {
    let x = ISO_RE.exec(t);
    if (x) return ymdSerial(+x[1], +x[2], +x[3]);
    if ((x = DMY_RE.exec(t))) {
      if (x[3] === undefined) return twoParts(+x[1], +x[2], +x[1], x[2]);
      return x[2].length <= 2 ? ymdSerial(yearOf(x[3]), +x[2], +x[1]) : null;
    }
    if ((x = DAY_NAME_RE.exec(t))) {
      const m = MES_IN[x[2].toLowerCase()];
      return m ? ymdSerial(x[3] === undefined ? new Date().getFullYear() : yearOf(x[3]), m, +x[1]) : null;
    }
    if ((x = NAME_NUM_RE.exec(t))) {
      const m = MES_IN[x[1].toLowerCase()];
      return m ? twoParts(+x[2], m, m, x[2]) : null;
    }
    return null;
  }
  const isDateLiteral = raw => typeof raw === 'string' && parseDate(raw.trim()) !== null;

  // Hora escrita (hh:mm o hh:mm:ss, opcionalmente después de una fecha) → fracción de día, como Excel
  const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
  function parseTime(t) {
    const m = TIME_RE.exec(t);
    if (!m || +m[2] > 59 || (m[3] && +m[3] > 59)) return null;
    return (+m[1] * 3600 + +m[2] * 60 + (+m[3] || 0)) / 86400;
  }
  // "22/10/2026 14:30" (o "1 ene 2026 14:30") → serial de fecha + fracción de hora
  function parseDateTime(t) {
    const m = /^(.+)\s+(\S+)$/.exec(t);
    if (!m) return null;
    const d = parseDate(m[1]), h = parseTime(m[2]);
    return d !== null && h !== null ? d + h : null;
  }
  const isTimeLiteral = raw => typeof raw === 'string' && parseTime(raw.trim()) !== null;
  const isDateTimeLiteral = raw => typeof raw === 'string' && parseDateTime(raw.trim()) !== null;

  // Separador de miles es-CL: "1.500" → 1500, "12.345.678" → 12345678, "1.234,5" → 1234,5.
  // Regla: parte entera de 1 a 3 dígitos (sin cero inicial) seguida de uno o más grupos ".ddd" de
  // exactamente 3 dígitos. "1.5", "1.50", "1.5000" y "0.500" no cumplen y se leen con punto decimal.
  const THOUS_RE = /^[+-]?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/;

  // Interpreta lo que el usuario escribió en una celda (no fórmula)
  function literal(raw) {
    if (typeof raw !== 'string') return raw;
    if (raw[0] === "'") return raw.slice(1);
    const t = raw.trim();
    if (t === '') return null;
    if (THOUS_RE.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
    if (/^[+-]?(\d+([.,]\d+)?|[.,]\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t.replace(',', '.'));
    if (/^[+-]?\d+([.,]\d+)?%$/.test(t)) return parseFloat(t.replace(',', '.')) / 100;
    const d = parseDate(t);
    if (d !== null) return d;
    const h = parseTime(t) ?? parseDateTime(t);
    if (h !== null) return h;
    const u = t.toUpperCase();
    if (u === 'TRUE' || u === 'VERDADERO') return true;
    if (u === 'FALSE' || u === 'FALSO') return false;
    // un error escrito (#N/D, #¡VALOR!, #REF!…, en español o inglés, sin distinguir mayúsculas) es el error, como en Excel
    if (t[0] === '#') { const em = ERR_TOK.exec(t); if (em && em[0].length === t.length) return ERR_IN[em[0].toUpperCase()]; }
    return raw;
  }

  // Valor interno → texto de entrada es-CL que literal() vuelve a leer igual (pegar valores, importar, series).
  // Números: coma decimal, sin miles, precisión completa, exponente "1,5E-7" (nunca String(v): "1.234" se
  // leería como 1234). Texto que se reinterpretaría (número, fecha, VERDADERO, "=…", "'…") lleva apóstrofo.
  function toRaw(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isFinite(v) ? String(v === 0 ? 0 : v).replace('.', ',').replace('e', 'E') : String(v);
    if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
    if (v instanceof FErr) return ERR_ES[v.code] || v.code; // "#N/D": literal() lo vuelve a leer como el error
    const s = String(v);
    return literal(s) !== s || isFormula(s) ? "'" + s : s;
  }

  // ---------- Conversión de tipos ----------
  // Número → texto como el formato General sin límite de ancho (&, CONCATENAR, TEXTO "General"): 15 cifras
  // significativas, coma decimal; notación científica E+NN solo si |x| ≥ 1E+15 o |x| < 1E-4 (0,000552 queda
  // decimal; 1/3 → 0,333333333333333). La regla de "12 o más cifras" de la documentación es la de la celda,
  // que depende del ancho de la columna (la aplica la UI). toRaw no usa esto: necesita precisión completa.
  function numText(v) {
    if (v === 0 || !isFinite(v)) return v === 0 ? '0' : String(v);
    const x = +v.toPrecision(15), a = Math.abs(x);
    if (a >= 1e15 || a < 1e-4) {
      const [m, e] = x.toExponential(14).split('e');
      return m.replace(/\.?0+$/, '').replace('.', ',') + 'E' + (+e < 0 ? '-' : '+') + String(Math.abs(+e)).padStart(2, '0');
    }
    return String(x).replace('.', ',');
  }
  function toNum(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof FErr) throw v;
    if (typeof v === 'string') {
      const x = literal(v.trim());
      if (typeof x === 'number') return x;
      throw E.value;
    }
    throw E.value;
  }
  function toStr(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
    if (typeof v === 'number') return numText(v);
    if (v instanceof FErr) throw v;
    return String(v);
  }
  function truthy(v) {
    if (typeof v === 'string') {
      const u = v.toUpperCase();
      if (u === 'TRUE' || u === 'VERDADERO') return true;
      if (u === 'FALSE' || u === 'FALSO') return false;
      throw E.value;
    }
    return toNum(v) !== 0;
  }
  function scalar(v) {
    if (v && v.range) {
      if (v.r1 === v.r2 && v.c1 === v.c2) {
        const x = v.eng.value(v.si, v.r1, v.c1);
        if (x instanceof FErr) throw x;
        return x;
      }
      throw E.value;
    }
    if (Array.isArray(v)) { // matriz 1x1 → su valor; más grande en un contexto escalar → #VALUE!
      if (v.length === 1 && v[0].length === 1) { const x = v[0][0]; if (x instanceof FErr) throw x; return x; }
      throw E.value;
    }
    return v;
  }

  // ---------- Matrices (matrices dinámicas) ----------
  // Una matriz es un arreglo de filas: [[1, 2], [3, 4]]. Los rangos de varias celdas se comportan como matrices en las
  // operaciones elemento a elemento; las celdas vacías quedan como null (al desbordar se muestran como 0, como Excel).
  const MAX_ELEMS = 5e6; // tope de elementos de una matriz calculada (protege la memoria; Excel no lo documenta)
  const isMat = v => Array.isArray(v);
  const isMulti = v => !!v && ((v.range && (v.r1 !== v.r2 || v.c1 !== v.c2)) || (isMat(v) && (v.length > 1 || v[0].length > 1)));
  function toMat(x) {
    if (isMat(x)) return x;
    if (x && x.range) return x.eng.rangeValues(x);
    if (x && x.arr) return [x.vals];
    return [[x === undefined ? null : x]];
  }
  const transpose = m => m[0].map((_, j) => m.map(row => row[j]));
  const guardSize = n => { if (n > MAX_ELEMS) throw E.num; };
  // Resultado de un elemento: un rango 1x1 o una matriz 1x1 dan su valor; algo más grande es una matriz anidada (#CALC!)
  function elemOut(v) {
    if (v && v.range) return v.r1 === v.r2 && v.c1 === v.c2 ? v.eng.value(v.si, v.r1, v.c1) : E.calc;
    if (isMat(v)) return v.length === 1 && v[0].length === 1 ? v[0][0] : E.calc;
    return v === undefined ? null : v;
  }
  // Aplica fn elemento a elemento con la difusión de Excel: el resultado tiene el mayor alto y el mayor ancho; una
  // matriz de una fila (o columna) se repite hacia abajo (o a la derecha); donde una matriz no alcanza → #N/A.
  // passErr = false: un error en un elemento de entrada es el resultado de ese elemento sin llamar a fn.
  function broadcast(vals, fn, passErr = false) {
    const ms = vals.map(toMat);
    const H = Math.max(...ms.map(m => m.length)), W = Math.max(...ms.map(m => m[0].length));
    guardSize(H * W);
    const out = [];
    for (let i = 0; i < H; i++) {
      const row = [];
      for (let j = 0; j < W; j++) {
        const args = ms.map(m => {
          const ii = m.length === 1 ? 0 : i, jj = m[0].length === 1 ? 0 : j;
          return ii < m.length && jj < m[0].length ? m[ii][jj] : E.na;
        });
        const bad = passErr ? null : args.find(a => a instanceof FErr);
        if (bad) { row.push(bad); continue; }
        try { row.push(elemOut(fn(...args))); } catch (e) { if (e instanceof FErr) row.push(e); else throw e; }
      }
      out.push(row);
    }
    return out;
  }
  // ---------- Orden de texto como Excel en español (fijo, sin depender del idioma del navegador: L-006) ----------
  // Documentación de Excel: dígitos < espacio < signos < letras; sin distinguir mayúsculas; apóstrofo y guion se
  // ignoran salvo para desempatar (el que tiene guion va después). Español: ñ es una letra después de n; los acentos
  // son una diferencia secundaria (a < á < b, y "a" <> "á").
  const PUNCT = ' !"#$%&()*,./:;?@[\\]^_`{|}~+<=>', ALPHA = 'abcdefghijklmnñopqrstuvwxyz';
  const W_N = 400 + ALPHA.indexOf('n'), W_ENE = 400 + ALPHA.indexOf('ñ');
  function textKey(s) {
    const prim = [], sec = [];
    let ign = '';
    for (const ch of s.toLowerCase()) {
      if (ch === "'" || ch === '-') { ign += ch + prim.length; continue; }
      if (/[̀-ͯ]/.test(ch)) { // marca combinante suelta (texto ya descompuesto)
        if (!prim.length) continue;
        if (ch === '̃' && prim[prim.length - 1] === W_N) prim[prim.length - 1] = W_ENE; else sec[sec.length - 1] += ch;
        continue;
      }
      const d = ch === 'ñ' ? 'ñ' : ch.normalize('NFD'), base = d[0];
      let w = ALPHA.indexOf(base);
      if (w >= 0) w += 400;
      else if (base >= '0' && base <= '9') w = 100 + base.charCodeAt(0) - 48;
      else if ((w = PUNCT.indexOf(base)) >= 0) w += 200;
      else w = 1000 + base.codePointAt(0);
      prim.push(w); sec.push(d.slice(1));
    }
    return { prim, sec, ign };
  }
  const keyCache = new Map();
  const keyOf = s => { let k = keyCache.get(s); if (!k) { if (keyCache.size > 20000) keyCache.clear(); keyCache.set(s, k = textKey(s)); } return k; };
  const cmpSeq = (p, q, f) => { for (let i = 0, n = Math.min(p.length, q.length); i < n; i++) { const c = f(p[i], q[i]); if (c) return c; } return Math.sign(p.length - q.length); };
  const cmpStr = (u, v) => u === v ? 0 : u < v ? -1 : 1;
  function compareText(a, b) {
    if (a === b) return 0;
    const x = keyOf(a), y = keyOf(b);
    return cmpSeq(x.prim, y.prim, (u, v) => Math.sign(u - v)) || cmpSeq(x.sec, y.sec, cmpStr) || cmpStr(x.ign, y.ign);
  }
  // Excel compara con los operadores (=, <>, <, >…) y en los criterios de *.SI / *.SI.CONJUNTO redondeando cada número
  // a 15 cifras significativas (0,1+0,2 = 0,3 es VERDADERO); BUSCARV, COINCIDIR y ordenar comparan el valor exacto.
  const round15 = x => x === 0 || !isFinite(x) ? x : +x.toPrecision(15);
  const rank = v => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3;
  function compareVals(l, r, r15 = false) {
    if (l === null) l = typeof r === 'string' ? '' : typeof r === 'boolean' ? false : 0;
    if (r === null) r = typeof l === 'string' ? '' : typeof l === 'boolean' ? false : 0;
    const a = rank(l), b = rank(r);
    if (a !== b) return a < b ? -1 : 1;
    if (a === 1) return compareText(l, r);
    if (a === 3) return 0;
    if (a === 0 && r15) { l = round15(l); r = round15(r); }
    return l < r ? -1 : l > r ? 1 : 0;
  }

  // ---------- Tokenizador ----------
  const NAME = '[A-Za-z_\\u00C0-\\u017F][\\w.\\u00C0-\\u017F]*';
  const CELL = '\\$?[A-Za-z]{1,3}\\$?\\d+';
  // Columna o fila completa: A:A, $B:$C, 1:1, $2:$5
  const COLS = '(\\$?[A-Za-z]{1,3}):(\\$?[A-Za-z]{1,3})';
  const ROWS = '(\\$?\\d+):(\\$?\\d+)';
  const REFBODY = `(?:(${CELL})(?::(${CELL}))?|${COLS}|${ROWS})`;
  const T_SHEETREF = new RegExp(`^(?:'((?:[^']|'')+)'|(${NAME}))!${REFBODY}(?![\\w(.])`);
  const T_REF = new RegExp(`^${REFBODY}(?![\\w(.!])`);
  // Grupos de REFBODY a partir de `o`: celda, celda2, col1, col2, fila1, fila2
  const refTok = (m, o) => m[o] ? { a: m[o], b: m[o + 1] }
    : m[o + 2] ? { a: m[o + 2], b: m[o + 3], kind: 'col' } : { a: m[o + 4], b: m[o + 5], kind: 'row' };
  const T_NAME = new RegExp(`^${NAME}`);
  // Después de "A1#": si sigue una letra, dígito, "¡" o "¿", el "#" empieza un error (A1#REF! no es A1#)
  const SPILL_NEXT = /[\w¡¿]/;
  // Errores literales: #REF!, #DIV/0!, … y sus formas en español #¡REF!, #¡VALOR!, #¿NOMBRE?, #N/D, #¡NUM!
  // y los de matrices dinámicas: #SPILL!/#¡DESBORDAMIENTO! (también sin "¡") y #CALC!/#¡CALC!
  const ERR_TOK = /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|SPILL!|CALC!|DESBORDAMIENTO!|¡(?:REF|DIV\/0|VALOR|NUM|DESBORDAMIENTO|CALC)!|¿NOMBRE\?|N\/D)/i;

  // Coma decimal estilo Excel en español: "=REDONDEAR(2,5;0)" o "=A1*1,5" → punto decimal.
  // Si la fórmula usa ';' como separador, toda coma entre dígitos de un número es decimal;
  // si no, solo lo es fuera de los paréntesis (dentro, la coma separa argumentos: "=SUM(1,5)").
  function normalizeDecimals(src) {
    const semi = src.split(/"(?:[^"]|"")*"/).some(seg => seg.includes(';'));
    let out = '', q = false, depth = 0;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '"') q = !q;
      else if (!q) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && (semi || depth === 0) && /\d/.test(src[i - 1] || '') && /\d/.test(src[i + 1] || '')) {
          let j = i - 1;
          while (j >= 0 && /\d/.test(src[j])) j--;
          // la coma pertenece a un número (no a una referencia como A1,5) y el número no tiene ya un punto
          if (j < 0 || !/[A-Za-z_$.\dÀ-ſ]/.test(src[j])) { out += '.'; continue; }
        }
      }
      out += ch;
    }
    return out;
  }

  // ---------- Sintaxis de fórmulas: es-CL (Excel en español) ↔ inglés (.xlsx) ----------
  // es-CL: ';' separa argumentos, ',' es decimal y en constantes matriciales '\' separa columnas y ';' filas
  // ({1\2;3\4}, como la documentación de Excel en español). Inglés: ',' separa, '.' es decimal, {1,2;3,4}.
  // Modo 'es-CL' (por omisión, estricto): la coma siempre es decimal; una coma suelta es un error (Excel la rechaza).
  // Modo 'legacy' (solo si se pide explícitamente con setSyntax('legacy')): normalizeDecimals adivina si la coma
  // es decimal (L-018); queda para leer autoguardados de prueba, junto con migrateLegacyFormula.
  let SYNTAX = 'es-CL';
  const setSyntax = m => { SYNTAX = m === 'legacy' ? 'legacy' : 'es-CL'; };
  const getSyntax = () => SYNTAX;
  const IDENT = new RegExp(`^${NAME}`);
  // Número es-CL: "1,5", ",5", "1,5E3", y con decimal final "1," (= 1, como "1." en inglés) o "1,E3" (= 1000)
  const NUM_EN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/, NUM_ES = /^(?:\d+(?:,\d*|\.\d+)?|[,.]\d+)(?:[eE][+-]?\d+)?/;
  const BOOLS = { TRUE: 0, FALSE: 1, VERDADERO: 0, FALSO: 1 }, BOOL_EN = ['TRUE', 'FALSE'], BOOL_ES = ['VERDADERO', 'FALSO'];
  const IDCH = /[\w.$À-ſ]/;
  // Nombre de función en el idioma destino (sin _xlfn./_xlws.; al inglés se le agrega _xlfn. si corresponde)
  function fnName(id, toEs) {
    const bare = id.replace(/^(?:_xlfn\.|_xlws\.)+/i, ''), c = CANON[bare.toUpperCase()];
    if (!c) return toEs ? bare : id;
    return toEs ? ES[c] || c : (XLWS.has(c) ? '_xlfn._xlws.' : XLFN.has(c) ? '_xlfn.' : '') + c;
  }
  // Traduce la sintaxis de una fórmula (con o sin '=' inicial). from: 'en' | 'loose' (decimal '.', separa ',' o ';',
  // lo que deja normalizeDecimals) | 'es'. to: 'en' | 'es'. names: 'loc' traduce funciones, VERDADERO/FALSO y
  // errores; 'keep' los deja como están. strict: una coma que no es decimal en es-CL lanza #VALUE!.
  // Textos "…" y hojas '…' se copian tal cual (también si están sin cerrar: fórmulas a medio escribir, L-009).
  function xlate(src, from, to, names, strict) {
    const es = from === 'es', toEs = to === 'es', loc = names === 'loc';
    let out = '', i = 0, arr = 0, m;
    while (i < src.length) {
      const ch = src[i], rest = src.slice(i);
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < src.length) { if (src[j] === ch) { if (src[j + 1] === ch) { j += 2; continue; } break; } j++; }
        out += src.slice(i, j + 1); i = j + 1; continue;
      }
      if (ch === '{') { arr++; out += ch; i++; continue; }
      if (ch === '}') { if (arr) arr--; out += ch; i++; continue; }
      if (ch === '#' && (m = ERR_TOK.exec(rest))) {
        const e = ERR_IN[m[0].toUpperCase()];
        out += !loc || !e ? m[0] : toEs ? ERR_ES[e.code] : e.code; i += m[0].length; continue;
      }
      if (!IDCH.test(src[i - 1] || '') && (/\d/.test(ch) || ((ch === '.' || (es && ch === ',')) && /\d/.test(src[i + 1] || '')))) {
        m = (es ? NUM_ES : NUM_EN).exec(rest);
        // al inglés sin decimal final ("1," → "1", "1,E3" → "1E3"): la gramática de .xlsx exige dígitos tras el punto.
        // Si sigue una coma o un punto se conserva, para no pegar dos números ("1,,5" no es "1.5")
        const num = m[0].replace(/[.,]/, toEs ? ',' : '.'), glued = /[.,]/.test(src[i + m[0].length] || '');
        out += toEs || glued ? num : num.replace(/\.(?=[eE]|$)/, ''); i += m[0].length; continue;
      }
      if ((m = IDENT.exec(rest)) && !IDCH.test(src[i - 1] || '')) {
        const id = m[0], u = id.toUpperCase();
        let j = i + id.length;
        while (src[j] === ' ') j++;
        if (src[j] === '(') out += loc ? fnName(id, toEs) : id;
        else if (src[j] !== '!' && loc && u in BOOLS) out += (toEs ? BOOL_ES : BOOL_EN)[BOOLS[u]];
        else out += id;
        i += id.length; continue;
      }
      if (ch === ',') {
        if (es) { if (strict) throw E.value; out += ch; }
        else out += arr ? (toEs ? '\\' : ',') : (toEs ? ';' : ',');
        i++; continue;
      }
      if (ch === ';') { out += arr || toEs ? ';' : ','; i++; continue; }
      if (ch === '\\' && arr && es) { out += toEs ? '\\' : ','; i++; continue; }
      out += ch; i++;
    }
    return out;
  }
  // .xlsx (inglés) → es-CL con nombres en español: "ROUND(2.5,0)" → "REDONDEAR(2,5;0)"
  // Matrices dinámicas: _xlfn.ANCHORARRAY(A1) → A1#, _xlfn.SINGLE(x) → @x; _xlfn._xlws.SORT → ORDENAR
  const fromExcelFormula = f => {
    let s = codeParts(String(f), seg => seg.replace(ANCHOR_EN, (m, sh, ref) => (sh || '') + ref + '#'));
    if (/_xlfn\.SINGLE\(/i.test(s)) s = atFromExcel(s);
    return xlate(s, 'en', 'es', 'loc', false);
  };
  // Fórmula guardada con la regla vieja (modo legacy) → es-CL estricto con el MISMO resultado y, como fromExcelFormula,
  // con funciones, VERDADERO/FALSO y errores en español (lo que muestra la barra de fórmulas).
  // "=SUM(1,5)" (separador) → "=SUMA(1;5)"; "=SUM(1,5;2)" → "=SUMA(1,5;2)"; "=A1*1.5" → "=A1*1,5".
  const migrateLegacyFormula = f => xlate(normalizeDecimals(String(f)), 'loose', 'es', 'loc', false);

  function tokenize(src) {
    src = SYNTAX === 'es-CL' ? xlate(src, 'es', 'en', 'keep', true) : normalizeDecimals(src);
    const t = [];
    let i = 0, m;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"') {
        let j = i + 1, s = '';
        for (;;) {
          if (j >= src.length) throw E.value;
          if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
          s += src[j++];
        }
        t.push({ t: 'str', v: s }); i = j + 1; continue;
      }
      const rest = src.slice(i);
      // las referencias van antes que los números para reconocer filas completas (1:1)
      let tk = null;
      if ((m = T_SHEETREF.exec(rest))) tk = { t: 'ref', sheet: m[1] ? m[1].replace(/''/g, "'") : m[2], ...refTok(m, 3) };
      else if ((m = T_REF.exec(rest))) tk = { t: 'ref', ...refTok(m, 1) };
      if (tk) {
        i += m[0].length;
        // A1# (rango desbordado): "#" pegado a una celda y no seguido de letra o dígito (#REF!, #N/D… son errores)
        if (src[i] === '#' && !tk.b && !tk.kind && !SPILL_NEXT.test(src[i + 1] || '')) { tk.spill = true; i++; }
        t.push(tk); continue;
      }
      // "1." (decimal final) es un número; "1..5" son dos números y el parser lo rechaza
      if ((m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(rest))) { t.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = ERR_TOK.exec(rest))) { t.push({ t: 'err', v: ERR_IN[m[0].toUpperCase()] || E.value }); i += m[0].length; continue; }
      // nombre definido que empieza con "\" (Excel lo permite)
      if ((m = /^\\[\w.À-ſ]*/.exec(rest))) { t.push({ t: 'name', v: m[0] }); i += m[0].length; continue; }
      if ((m = T_NAME.exec(rest))) {
        const name = m[0], u = name.toUpperCase();
        i += name.length;
        if (/^\s*\(/.test(src.slice(i))) t.push({ t: 'func', v: u.replace(/^(?:_XLFN\.|_XLWS\.)+/, '') });
        else if (u === 'TRUE' || u === 'VERDADERO') t.push({ t: 'bool', v: true });
        else if (u === 'FALSE' || u === 'FALSO') t.push({ t: 'bool', v: false });
        else t.push({ t: 'name', v: name });
        continue;
      }
      if ((m = /^(<=|>=|<>)/.exec(rest))) { t.push({ t: 'op', v: m[0] }); i += 2; continue; }
      // { } constantes matriciales (ya en inglés: "," separa columnas y ";" filas); @ intersección implícita
      if ('+-*/^&=<>%(),;:{}@'.includes(ch)) { t.push({ t: 'op', v: ch }); i++; continue; }
      throw E.value;
    }
    return t;
  }

  // ---------- Parser (descenso recursivo, precedencia estilo Excel) ----------
  function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p];
    const next = () => tokens[p++];
    const isOp = v => peek() && peek().t === 'op' && peek().v === v;
    const isSep = () => isOp(',') || isOp(';');
    const CMP = ['=', '<>', '<', '>', '<=', '>='];

    function cmp() { let l = concat(); while (peek() && peek().t === 'op' && CMP.includes(peek().v)) { const o = next().v; l = { k: 'bin', o, l, r: concat() }; } return l; }
    function concat() { let l = add(); while (isOp('&')) { next(); l = { k: 'bin', o: '&', l, r: add() }; } return l; }
    function add() { let l = mul(); while (isOp('+') || isOp('-')) { const o = next().v; l = { k: 'bin', o, l, r: mul() }; } return l; }
    function mul() { let l = pow(); while (isOp('*') || isOp('/')) { const o = next().v; l = { k: 'bin', o, l, r: pow() }; } return l; }
    function pow() { let l = unary(); while (isOp('^')) { next(); l = { k: 'bin', o: '^', l, r: unary() }; } return l; }
    function unary() {
      if (isOp('-')) { next(); return { k: 'neg', e: unary() }; }
      if (isOp('+')) { next(); return unary(); }
      if (isOp('@')) { next(); return { k: 'at', e: postfix() }; } // =@A1:A3 (intersección implícita)
      return postfix();
    }
    // Constante matricial {1,2;3,4} (tokens ya en inglés): números (con signo), textos, VERDADERO/FALSO y errores;
    // filas de distinto largo → error, como Excel
    function arrayConst() {
      const rows = [[]];
      for (;;) {
        let neg = false;
        while (isOp('-') || isOp('+')) { if (next().v === '-') neg = !neg; }
        const e = next();
        if (!e) throw E.value;
        if (e.t === 'num') rows[rows.length - 1].push(neg ? -e.v : e.v);
        else if (!neg && (e.t === 'str' || e.t === 'bool' || e.t === 'err')) rows[rows.length - 1].push(e.v);
        else throw E.value;
        if (isOp(',')) { next(); continue; }
        if (isOp(';')) { next(); rows.push([]); continue; }
        if (isOp('}')) { next(); break; }
        throw E.value;
      }
      if (rows.some(r => r.length !== rows[0].length)) throw E.value;
      return { k: 'arr', v: rows };
    }
    function postfix() { let e = primary(); while (isOp('%')) { next(); e = { k: 'pct', e }; } return e; }
    function primary() {
      const tk = next();
      if (!tk) throw E.value;
      switch (tk.t) {
        case 'num': case 'str': case 'bool': return { k: 'lit', v: tk.v };
        case 'err': return { k: 'err', v: tk.v };
        case 'ref': return { k: 'ref', sheet: tk.sheet, a: tk.a, b: tk.b, kind: tk.kind, spill: !!tk.spill };
        case 'name': return { k: 'name', v: tk.v }; // nombre definido; si no existe, #NAME? al evaluar
        case 'func': {
          next(); // '('
          const args = [];
          if (isOp(')')) { next(); return { k: 'call', n: tk.v, args }; }
          for (;;) {
            args.push(isSep() || isOp(')') ? { k: 'lit', v: null } : cmp());
            if (isSep()) { next(); continue; }
            if (isOp(')')) { next(); break; }
            throw E.value;
          }
          return { k: 'call', n: tk.v, args };
        }
        case 'op':
          if (tk.v === '{') return arrayConst();
          if (tk.v === '(') { const e = cmp(); if (!isOp(')')) throw E.value; next(); e.paren = true; return e; } // paren: anula el ajuste "cerca de cero"
      }
      throw E.value;
    }
    const ast = cmp();
    if (p < tokens.length) throw E.value;
    return ast;
  }

  // ---------- Operadores ----------
  // Ajuste "cerca de cero" (ver Engine.ast): Microsoft no publica el umbral; se usa |resultado| ≤ 2^-50 · el mayor
  // operando, del orden del error de convertir decimales a binario (unas pocas unidades del último bit)
  const SNAP = Math.pow(2, -50);
  function snapZero(v, l, r) {
    if (typeof v !== 'number' || v === 0) return v;
    return Math.abs(v) <= Math.max(Math.abs(toNum(l)), Math.abs(toNum(r))) * SNAP ? 0 : v;
  }
  function binop(o, l, r) {
    switch (o) {
      case '+': return toNum(l) + toNum(r);
      case '-': return toNum(l) - toNum(r);
      case '*': return toNum(l) * toNum(r);
      case '/': { const d = toNum(r); if (d === 0) throw E.div0; return toNum(l) / d; }
      case '^': return Math.pow(toNum(l), toNum(r));
      case '&': return toStr(l) + toStr(r);
    }
    const c = compareVals(l, r, true); // operadores: 15 cifras significativas
    switch (o) {
      case '=': return c === 0;
      case '<>': return c !== 0;
      case '<': return c < 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '>=': return c >= 0;
    }
    throw E.value;
  }

  // ---------- Motor ----------
  const MAXR = 1048576, MAXC = 16384;
  // Gancho global del estado de filas (ver Engine.rowState); la UI puede proveerlo con Bx.setRowState
  let rowHook = null;
  const setRowState = fn => { rowHook = typeof fn === 'function' ? fn : null; };
  // Señal interna de la evaluación tentativa (ver Engine.tryEval); nunca llega a una celda
  const ABORT = Object.freeze({ abort: true });
  const SPILL_MSG = {
    blocked: 'El rango de desbordamiento no está en blanco.',
    spill: 'El rango de desbordamiento se cruza con otra matriz desbordada.',
    merged: 'El rango de desbordamiento contiene celdas combinadas.',
    edge: 'El rango de desbordamiento se extiende más allá del borde de la hoja de cálculo.',
  };
  const hit = (s, r, c) => r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2;
  const cross = (a, b) => !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2);
  // ¿q se cruza con el área sin contar la celda (r, c)? (el ancla puede leerse a sí misma sin ser circular aquí)
  const crossBut = (q, a, r, c) => {
    const r1 = Math.max(q.r1, a.r1), r2 = Math.min(q.r2, a.r2), c1 = Math.max(q.c1, a.c1), c2 = Math.min(q.c2, a.c2);
    return r1 <= r2 && c1 <= c2 && !(r1 === r && r2 === r && c1 === c && c2 === c);
  };
  const hasContent = cell => !!cell && cell.v != null && cell.v !== '';
  // Valor de un elemento al desbordar: vacío → 0 (como Excel), número no finito → #NUM!, matriz anidada → #CALC!
  const spillVal = x => x === null || x === undefined ? 0 : typeof x === 'number' && !isFinite(x) ? E.num
    : (x && x.range) || isMat(x) ? E.calc : x;
  class Engine {
    constructor(wb) {
      this.wb = wb; this.cache = new Map(); this.stack = new Map(); this.asts = new Map(); this.exts = new Map(); this.cur = null;
      this.rowSets = new Map(); this.rowFn = null; this.nameMap = null; this.nameStack = new Set();
      // Matrices dinámicas (se reconstruyen en cada recalc): spillReg hoja → Map(clave ancla → desborde),
      // spillErrs clave → motivo del #SPILL!, candMap hoja → fórmulas que pueden devolver una matriz,
      // skips: lecturas que no pudieron consultar una fórmula en curso; log/tent/tentBase: evaluación tentativa
      this.spillReg = new Map(); this.spillErrs = new Map(); this.candMap = new Map(); this.skips = new Map();
      this.log = []; this.tent = 0; this.tentBase = 0; this.skipSeq = 0;
    }
    recalc() {
      this.cache.clear(); this.exts.clear(); this.rowSets.clear(); this.nameMap = null;
      this.spillReg.clear(); this.spillErrs.clear(); this.candMap.clear(); this.skips.clear(); this.log = [];
    }
    // Agrega a un Map registrando la operación si hay una evaluación tentativa abierta (para deshacerla)
    put(map, key, v) { map.set(key, v); if (this.tent) this.log.push([map, key]); }
    undo(mark) { while (this.log.length > mark) { const [m, k] = this.log.pop(); m.delete(k); } }
    reg(si) { let m = this.spillReg.get(si); if (!m) this.spillReg.set(si, m = new Map()); return m; }

    // ---------- Matrices dinámicas: desborde ----------
    // Fórmulas de la hoja que pueden devolver una matriz (análisis estático, mayArray), en orden fila por fila.
    // pend: las que aún no se evaluaron en este recálculo.
    cands(si) {
      let cs = this.candMap.get(si);
      if (!cs) {
        cs = [];
        const sh = this.wb.sheets[si];
        if (sh) for (const k in sh.cells) {
          const v = sh.cells[k] && sh.cells[k].v;
          if (!isFormula(v)) continue;
          const a = this.ast(v);
          if (a.ma === undefined) a.ma = mayArray(a);
          if (!a.ma) continue;
          const p = parseAddr(k);
          if (p) cs.push({ r: p.r, c: p.c, key: si + ':' + p.r + ':' + p.c });
        }
        cs.sort((a, b) => a.r - b.r || a.c - b.c);
        cs.pend = cs.slice();
        // fila y columna mínimas: una candidata solo desborda hacia abajo y a la derecha (atajo para A:A y 1:1)
        cs.minR = cs.length ? cs[0].r : MAXR; cs.minC = cs.reduce((m, k) => Math.min(m, k.c), MAXC);
        this.candMap.set(si, cs);
      }
      return cs;
    }
    // Evalúa una candidata sin arriesgar un falso #CIRC!: si su cálculo llega a una celda que ya estaba en curso
    // (antes de empezar), se aborta, se deshace todo lo que guardó y se anota en skips con el rectángulo leído.
    // → true si la candidata quedó calculada.
    tryEval(si, k, rect) {
      if (this.cache.has(k.key)) return true;
      if (this.stack.has(k.key)) {
        // en curso desde fuera de la tentativa abierta: la tentativa depende de ella → abortarla (no es un ciclo)
        if (this.stack.get(k.key) < this.tentBase) throw ABORT;
        if (rect) this.addSkip(k.key, si, rect);
        return false;
      }
      const base = this.tentBase, mark = this.log.length;
      let ok = false;
      this.tentBase = this.stack.size; this.tent++;
      try { this.value(si, k.r, k.c); ok = true; }
      catch (e) { if (e !== ABORT) throw e; this.undo(mark); }
      finally { this.tent--; this.tentBase = base; if (!this.tent) this.log.length = 0; } // fuera de toda tentativa, lo guardado es definitivo
      if (!ok) { if (rect) this.addSkip(k.key, si, rect); return false; }
      return this.cache.has(k.key);
    }
    addSkip(key, si, rect) { this.put(this.skips, ++this.skipSeq, { key, si, ...rect }); }
    // Calcula las candidatas hasta (rMax, cMax) [y, con `before`, solo las anteriores a esa celda en orden fila por fila]
    ensure(si, rMax, cMax, before, rect) {
      const cs = this.cands(si), pend = cs.pend;
      if (!pend.length) return;
      const keep = [];
      let i = 0;
      for (; i < pend.length; i++) {
        const k = pend[i];
        if (k.r > rMax || (before && (k.r > before.r || (k.r === before.r && k.c >= before.c)))) break;
        if (k.c > cMax || !this.tryEval(si, k, rect)) keep.push(k);
      }
      // solo fuera de una evaluación tentativa lo calculado es definitivo
      if (!this.tent) cs.pend = keep.concat(pend.slice(i));
    }
    // Valor de una celda vacía cubierta por un desborde (o undefined)
    ghost(si, r, c) {
      if (!this.cands(si).length) return undefined;
      this.ensure(si, r, c, null, { r1: r, c1: c, r2: r, c2: c });
      for (const s of this.reg(si).values()) if (hit(s, r, c) && (s.r !== r || s.c !== c)) return s.mat[r - s.r1][c - s.c1];
      return undefined;
    }
    // Registra el desborde de la matriz `mat` desde (r, c) o devuelve #SPILL! con su motivo. → valor del ancla
    spillOut(si, r, c, key, mat) {
      const h = mat.length, w = h ? mat[0].length : 0;
      if (!h || !w) return E.calc;
      guardSize(h * w);
      const area = { r1: r, c1: c, r2: r + h - 1, c2: c + w - 1 };
      const sh = this.wb.sheets[si];
      let reason = null;
      const blockers = [];
      if (area.r2 >= MAXR || area.c2 >= MAXC) reason = 'edge';
      else if (h * w > 1) {
        // celdas con contenido dentro del área (el ancla no cuenta); se recorre lo más corto: el área o las celdas
        const keys = Object.keys(sh.cells);
        if (h * w > keys.length) {
          for (const k of keys) { const p = parseAddr(k); if (p && hit(area, p.r, p.c) && (p.r !== r || p.c !== c) && hasContent(sh.cells[k])) blockers.push(p); }
          blockers.sort((a, b) => a.r - b.r || a.c - b.c);
        } else {
          for (let i = area.r1; i <= area.r2; i++) for (let j = area.c1; j <= area.c2; j++) if ((i !== r || j !== c) && hasContent(sh.cells[addr(i, j)])) blockers.push({ r: i, c: j });
        }
        if (blockers.length) reason = 'blocked';
        else if ((sh.merges || []).some(m => cross(m, area))) reason = 'merged';
        else {
          // otra matriz ya desbordada en el área: gana la primera en orden fila por fila (se calculan antes las anteriores)
          this.ensure(si, area.r2, area.c2, { r, c }, null);
          for (const s of this.reg(si).values()) {
            if (s.key === key || !cross(s, area)) continue;
            reason = 'spill';
            for (let i = Math.max(s.r1, area.r1); i <= Math.min(s.r2, area.r2) && blockers.length < 1000; i++)
              for (let j = Math.max(s.c1, area.c1); j <= Math.min(s.c2, area.c2) && blockers.length < 1000; j++) blockers.push({ r: i, c: j });
          }
        }
      }
      // la fórmula leyó su propia área de desborde mientras se calculaba: referencia circular
      for (const q of this.skips.values()) if (q.key === key && q.si === si && crossBut(q, area, r, c)) return E.circ;
      if (reason) { this.put(this.spillErrs, key, { reason, ...area, blockers }); return E.spill; }
      const m = mat.map(row => row.map(spillVal));
      this.put(this.reg(si), key, { key, r, c, ...area, mat: m });
      return m[0][0];
    }
    // A1#: el rango desbordado desde A1. Si A1 no es una matriz dinámica → #REF!; si está bloqueada → #SPILL!
    spillRef(n, si) {
      let tsi = si;
      if (n.sheet != null) { tsi = this.sheetIndex(n.sheet); if (tsi < 0) throw E.ref; }
      const a = parseAddr(n.a), key = tsi + ':' + a.r + ':' + a.c;
      if (this.stack.has(key)) { if (this.stack.get(key) < this.tentBase) throw ABORT; throw E.circ; }
      this.value(tsi, a.r, a.c);
      const s = this.reg(tsi).get(key);
      if (s) return { range: true, eng: this, si: tsi, r1: s.r1, c1: s.c1, r2: s.r2, c2: s.c2, full: false };
      if (this.spillErrs.has(key)) throw E.spill;
      throw E.ref;
    }

    // ---------- API de matrices dinámicas para la UI ----------
    // Desborde al que pertenece la celda (ancla o celda fantasma) → { anchor: { r, c }, r1, c1, r2, c2, ghost } o null.
    // ghost: true si la celda no es el ancla (no tiene contenido propio; la barra de fórmulas muestra la del ancla en gris).
    // Las matrices 1x1 no desbordan (null).
    spillAt(si, r, c) {
      this.value(si, r, c);
      const reg = this.reg(si), own = reg.get(si + ':' + r + ':' + c);
      let s = own;
      if (!s) for (const x of reg.values()) if (hit(x, r, c)) { s = x; break; }
      if (!s || (s.r1 === s.r2 && s.c1 === s.c2)) return null;
      return { anchor: { r: s.r, c: s.c }, r1: s.r1, c1: s.c1, r2: s.r2, c2: s.c2, ghost: !own };
    }
    // Ancla con #SPILL! → { reason: 'blocked' | 'spill' | 'merged' | 'edge', message, r1, c1, r2, c2 (área prevista,
    // para el borde discontinuo), blockers: [{ r, c }] (celdas que obstruyen) } o null
    spillError(si, r, c) {
      this.value(si, r, c);
      const e = this.spillErrs.get(si + ':' + r + ':' + c);
      return e ? { ...e, message: SPILL_MSG[e.reason], blockers: e.blockers.slice() } : null;
    }
    // Todos los desbordes de la hoja (de más de una celda) → [{ anchor: { r, c }, r1, c1, r2, c2 }] en orden fila por fila
    spills(si) {
      this.ensure(si, MAXR, MAXC, null, null);
      return [...this.reg(si).values()].filter(s => s.r1 !== s.r2 || s.c1 !== s.c2)
        .map(s => ({ anchor: { r: s.r, c: s.c }, r1: s.r1, c1: s.c1, r2: s.r2, c2: s.c2 }))
        .sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1);
    }

    // ---------- Nombres definidos (wb.names) ----------
    // { name, scope: null (libro) | nombre de hoja, ref: '=Hoja1!$A$2:$A$20' | '=0,19' | '=SUMA(…)', comment }.
    // El nombre de hoja tiene prioridad sobre el de libro en esa hoja; sin distinguir mayúsculas. Tras editar: recalc().
    nameDef(name, si) {
      if (!this.nameMap) {
        this.nameMap = new Map();
        for (const d of this.wb.names || []) if (d && d.name) this.nameMap.set((d.scope ? String(d.scope).toLowerCase() : '') + '\u0000' + d.name.toUpperCase(), d);
      }
      const u = String(name).toUpperCase(), sh = this.wb.sheets[si];
      return (sh && this.nameMap.get(sh.name.toLowerCase() + '\u0000' + u)) || this.nameMap.get('\u0000' + u) || null;
    }
    // Valor de un nombre en la hoja si: una referencia → objeto rango (reglas de rango, L-007); si no, el valor de su
    // fórmula o constante. Las referencias sin hoja se resuelven en la hoja de la fórmula. Inexistente → #NAME?
    evalName(name, si) {
      const d = this.nameDef(name, si);
      if (!d) throw E.name;
      const key = si + '\u0000' + d.name.toUpperCase() + '\u0000' + (d.scope || '');
      if (this.nameStack.has(key)) throw E.circ; // nombre que se refiere a sí mismo
      this.nameStack.add(key);
      try {
        const a = this.ast(String(d.ref)[0] === '=' ? String(d.ref) : '=' + d.ref);
        return a.k === 'ref' ? this.refRange(a, si) : this.evalNode(a, si);
      } finally { this.nameStack.delete(key); }
    }
    // Rango de un nombre (para resaltarlo o seleccionarlo desde el cuadro de nombres) o null si no es una referencia
    nameRange(name, si) {
      try {
        const g = this.evalName(name, si);
        if (!g || !g.range) return null;
        const { r2, c2 } = this.bounds(g);
        return { si: g.si, r1: g.r1, c1: g.c1, r2, c2, full: g.full };
      } catch (e) { if (e instanceof FErr) return null; throw e; }
    }
    // Columna "Valor" del administrador de nombres: escalar, matriz de valores (rango) o error
    nameValue(name, si) {
      try {
        const v = this.evalName(name, si);
        return v && v.range ? this.rangeValues(v) : v;
      } catch (e) { if (e instanceof FErr) return e; throw e; }
    }
    // Estado de una fila para SUBTOTALES/AGREGAR: { hidden: oculta a mano, filtered: oculta por el filtro }.
    // Fuente: gancho de la instancia (eng.setRowState), gancho global (Bx.setRowState) o, por omisión, el
    // modelo: sheet.hiddenR (ocultas a mano) y sheet.filter.hidden (filtradas). Tras filtrar u ocultar: recalc().
    // Firma del gancho: fn(sheet, r, si) → { hidden, filtered }
    setRowState(fn) { this.rowFn = typeof fn === 'function' ? fn : null; this.rowSets.clear(); }
    rowState(si, r) {
      const sh = this.wb.sheets[si], fn = this.rowFn || rowHook;
      if (fn) { const s = fn(sh, r, si) || {}; return { hidden: !!s.hidden, filtered: !!s.filtered }; }
      let m = this.rowSets.get(si);
      if (!m) {
        m = { hidden: new Set((sh && sh.hiddenR) || []), filtered: new Set((sh && sh.filter && sh.filter.hidden) || []) };
        this.rowSets.set(si, m);
      }
      return { hidden: m.hidden.has(r), filtered: m.filtered.has(r) };
    }
    // Última fila y columna usadas de una hoja (acota A:A y 1:1); se recalcula tras recalc()
    extent(si) {
      let e = this.exts.get(si);
      if (!e) {
        e = { r: 0, c: 0 };
        const sh = this.wb.sheets[si];
        if (sh) for (const k in sh.cells) { const p = parseAddr(k); if (p) { if (p.r > e.r) e.r = p.r; if (p.c > e.c) e.c = p.c; } }
        this.exts.set(si, e);
      }
      return e;
    }
    // Límites efectivos de un rango: una columna completa se recorta a las filas usadas (y una fila, a las columnas)
    // (incluye los desbordes que caen en esas columnas o filas: =SUMA(A:A) suma los valores desbordados en A)
    bounds(g) {
      let { r2, c2 } = g;
      if (g.full) {
        const e = this.extent(g.si);
        let er = e.r, ec = e.c;
        const cs = this.cands(g.si);
        if (cs.length && (g.full === 'col' ? cs.minC <= g.c2 : cs.minR <= g.r2)) {
          const rect = { r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 };
          this.ensure(g.si, g.full === 'col' ? MAXR : g.r2, g.full === 'col' ? g.c2 : MAXC, null, rect);
          for (const s of this.reg(g.si).values()) if (cross(s, rect)) { er = Math.max(er, s.r2); ec = Math.max(ec, s.c2); }
        }
        if (g.full === 'col') r2 = Math.max(g.r1, Math.min(r2, er));
        else c2 = Math.max(g.c1, Math.min(c2, ec));
      }
      return { r2, c2 };
    }
    dims(g) { const b = this.bounds(g); return [b.r2 - g.r1 + 1, b.c2 - g.c1 + 1]; }
    // Evalúa las fórmulas de una hoja de arriba hacia abajo para que las cadenas largas
    // (A2=A1+1, A3=A2+1, …) se resuelvan con la caché en vez de con recursión profunda.
    // También calcula, fila por fila, las fórmulas que pueden desbordar: así, si dos matrices chocan, la que da
    // #SPILL! es siempre la de más abajo/derecha. La UI llama a prime() después de cada recalc().
    prime(si) {
      if (!this.wb.sheets[si]) return;
      const keys = Object.keys(this.wb.sheets[si].cells).filter(k => isFormula(this.wb.sheets[si].cells[k].v));
      if (keys.length >= 200) keys.map(parseAddr).sort((a, b) => a.r - b.r || a.c - b.c).forEach(p => this.value(si, p.r, p.c));
      this.ensure(si, MAXR, MAXC, null, null);
    }
    sheetIndex(name) { const n = name.toLowerCase(); return this.wb.sheets.findIndex(s => s.name.toLowerCase() === n); }

    value(si, r, c) {
      const key = si + ':' + r + ':' + c;
      if (this.cache.has(key)) return this.cache.get(key);
      const sheet = this.wb.sheets[si];
      const cell = sheet && sheet.cells[addr(r, c)];
      let v;
      if (!cell || cell.v == null || cell.v === '') {
        // celda vacía: puede ser parte del desborde de una matriz (celda "fantasma", sin contenido propio)
        const g = this.ghost(si, r, c);
        v = g === undefined ? null : g;
      } else if (isFormula(cell.v)) {
        if (this.stack.has(key)) {
          // celda que ya estaba en curso antes de una evaluación tentativa: abortarla (no es un ciclo propio)
          if (this.stack.get(key) < this.tentBase) throw ABORT;
          return E.circ;
        }
        this.stack.set(key, this.stack.size);
        const prev = this.cur;
        this.cur = { si, r, c }; // celda que se evalúa (FILA() y COLUMNA() sin argumentos)
        try {
          const res = this.evalNode(this.ast(cell.v), si);
          // una matriz o un rango de varias celdas desborda desde esta celda (matrices dinámicas)
          if (isMat(res) || isMulti(res)) v = this.spillOut(si, r, c, key, isMat(res) ? res : this.rangeValues(res));
          else {
            v = scalar(res);
            if (v === null || v === undefined) v = 0;
            if (typeof v === 'number' && !isFinite(v)) v = E.num;
          }
        } catch (e) {
          this.stack.delete(key);
          this.cur = prev;
          if (e === ABORT) throw e;
          // Cadena de dependencias demasiado profunda: no se guarda en caché; prime() lo resuelve
          if (e instanceof RangeError) { if (this.stack.size) throw e; return E.value; }
          v = e instanceof FErr ? e : E.value;
          if (!(e instanceof FErr)) console.error(e);
        }
        this.cur = prev;
        this.stack.delete(key);
      } else if (cell.s && cell.s.fmt === 'text') v = cell.v;
      else v = literal(cell.v);
      this.put(this.cache, key, v);
      return v;
    }

    ast(raw) {
      let a = this.asts.get(SYNTAX[0] + raw); // la caché depende de la sintaxis vigente
      if (!a) {
        try { a = parse(tokenize(raw.slice(1))); } catch (e) { a = { k: 'err', v: e instanceof FErr ? e : E.value }; }
        // Excel 97+ (documentado por Microsoft): si la suma o resta final de la fórmula da un valor muy cercano a
        // cero, compensa el error binario y da 0 (=1,333+1,225-1,333-1,225 → 0). Solo la operación de primer nivel
        // y sin paréntesis: =(0,5-0,4-0,1) o =1*(0,5-0,4-0,1) conservan el residuo, como en Excel.
        if (a.k === 'bin' && (a.o === '+' || a.o === '-') && !a.paren) a.snap = true;
        if (this.asts.size > 200000) this.asts.clear(); // holgado: cands() y prime() recorren todas las fórmulas de la hoja
        this.asts.set(SYNTAX[0] + raw, a);
      }
      return a;
    }

    rangeValues(g) {
      const out = [], { r2, c2 } = this.bounds(g);
      for (let r = g.r1; r <= r2; r++) {
        const row = [];
        for (let c = g.c1; c <= c2; c++) row.push(this.value(g.si, r, c));
        out.push(row);
      }
      return out;
    }

    // Nodo de referencia → objeto rango (también para una sola celda)
    refRange(n, si) {
      if (n.spill) return this.spillRef(n, si);
      let tsi = si;
      if (n.sheet != null) { tsi = this.sheetIndex(n.sheet); if (tsi < 0) throw E.ref; }
      let r1, c1, r2, c2, full = false;
      const un = s => s.replace(/\$/g, '');
      if (n.kind === 'col') { r1 = 0; r2 = MAXR - 1; c1 = colIndex(un(n.a)); c2 = colIndex(un(n.b)); full = 'col'; }
      else if (n.kind === 'row') { c1 = 0; c2 = MAXC - 1; r1 = +un(n.a) - 1; r2 = +un(n.b) - 1; full = 'row'; }
      else { const a = parseAddr(n.a), b = n.b ? parseAddr(n.b) : a; r1 = a.r; c1 = a.c; r2 = b.r; c2 = b.c; }
      if (r1 > r2) [r1, r2] = [r2, r1];
      if (c1 > c2) [c1, c2] = [c2, c1];
      if (r1 < 0 || c1 < 0 || r2 >= MAXR || c2 >= MAXC) throw E.ref;
      return { range: true, eng: this, si: tsi, r1, c1, r2, c2, full };
    }

    // Argumento de función: las referencias (incluso a una sola celda) se pasan como rango para que las
    // funciones de agregación apliquen las reglas de rango (L-007). scalar() resuelve un rango de 1x1.
    evalArg(n, si) { return n.k === 'ref' ? this.refRange(n, si) : this.evalNode(n, si); }

    evalNode(n, si) {
      switch (n.k) {
        case 'name': return this.evalName(n.v, si);
        case 'lit': return n.v;
        case 'arr': return n.v; // constante matricial (no se modifica: las funciones devuelven matrices nuevas)
        case 'err': throw n.v;
        case 'ref': {
          if (n.b || n.kind || n.spill) return this.refRange(n, si);
          let tsi = si;
          if (n.sheet != null) { tsi = this.sheetIndex(n.sheet); if (tsi < 0) throw E.ref; }
          const a = parseAddr(n.a);
          const v = this.value(tsi, a.r, a.c); if (v instanceof FErr) throw v; return v;
        }
        case 'at': return this.intersect(this.evalArg(n.e, si), si);
        case 'neg': { const v = this.evalNode(n.e, si); return isMulti(v) ? broadcast([v], x => -toNum(x)) : -toNum(scalar(v)); }
        case 'pct': { const v = this.evalNode(n.e, si); return isMulti(v) ? broadcast([v], x => toNum(x) / 100) : toNum(scalar(v)) / 100; }
        case 'bin': {
          const L = this.evalNode(n.l, si), R = this.evalNode(n.r, si);
          // con una matriz o un rango de varias celdas: elemento a elemento, con difusión (=A1:A3*2, ={1\2}+{10;20})
          if (isMulti(L) || isMulti(R)) return broadcast([L, R], (l, r) => binop(n.o, l, r));
          const l = scalar(L), r = scalar(R), v = binop(n.o, l, r);
          return n.snap ? snapZero(v, l, r) : v;
        }
        case 'call': {
          const f = FN[n.n];
          if (!f) throw E.name;
          // funciones perezosas: fn(nodos, evaluar, celda actual, evaluar como argumento, motor)
          if (f.lazy) return f.fn(n.args, x => this.evalNode(x, si), this.cur, x => this.evalArg(x, si), this);
          const args = n.args.map(a => this.evalArg(a, si)), cx = this.cur || { si, r: 0, c: 0 };
          // funciones de valores sueltos con una matriz donde esperan un valor: se aplican elemento a elemento
          // (=LARGO(A1:A3), =BUSCARV(D1:D3;A:B;2;FALSO)), como las matrices dinámicas de Excel
          const lift = LIFT[CANON[n.n]];
          if (lift) {
            const pos = (lift === true ? args.map((_, i) => i) : lift).filter(i => i < args.length && isMulti(args[i]));
            if (pos.length) return broadcast(pos.map(i => args[i]), (...els) => { const a = args.slice(); pos.forEach((p, k) => { a[p] = els[k]; }); return f.fn(a, cx, this); });
          }
          return f.fn(args, cx, this);
        }
      }
      throw E.value;
    }
    // Intersección implícita (@): de un rango vertical, la celda de la fila de la fórmula; de uno horizontal, la de su
    // columna (aunque esté en otra hoja); 1x1 → su valor; si no se cruza → #VALUE!. De una matriz, el primer elemento.
    intersect(v, si) {
      if (v && v.range) {
        const cx = this.cur || { si, r: 0, c: 0 };
        let r = -1, c = -1;
        if (v.r1 === v.r2 && v.c1 === v.c2) { r = v.r1; c = v.c1; }
        else if (v.c1 === v.c2 && cx.r >= v.r1 && cx.r <= v.r2) { r = cx.r; c = v.c1; }
        else if (v.r1 === v.r2 && cx.c >= v.c1 && cx.c <= v.c2) { r = v.r1; c = cx.c; }
        if (r < 0) throw E.value;
        return out(this.value(v.si, r, c));
      }
      if (isMat(v)) return out(v[0][0]);
      return v;
    }

    // ---------- API: fórmula suelta (formato condicional, validación de datos) ----------
    // Valor de `text` (con o sin "=", en la sintaxis vigente) como si estuviera escrita en la celda (r, c) de la hoja
    // si: FILA()/COLUMNA() sin argumentos, @ y el F1C1 relativo de INDIRECTO miran (r, c); los nombres de la hoja si
    // ganan a los del libro; las volátiles se calculan en cada llamada. No escribe en el libro ni deja estado propio
    // (cur, pila, desbordes): solo guarda en la caché valores de celdas que recalc() daría igual. Resultado como el de
    // la celda: rango 1x1 → su valor, rango mayor → matriz de valores, vacío → 0, número no finito → #NUM!, matriz
    // 1x1 → su valor; una matriz no desborda (no ocupa celdas). Errores, también de sintaxis o de nombre → FErr
    // devuelto, nunca lanzado. Hoja inexistente o (r, c) fuera de la hoja → #REF!.
    // opts.from = { r, c }: la fórmula está escrita para esa celda (el ancla de la regla) y sus referencias relativas
    // se desplazan hasta (r, c), como al copiarla (si salen de la hoja → #REF!). opts.ref: si el resultado es una
    // referencia, se devuelve el objeto rango (origen de una lista) en vez de sus valores.
    // No se llama durante un cálculo (desde una función del motor): la UI la usa después de recalc()/prime().
    evalFormula(si, r, c, text, opts = {}) {
      if (!this.wb.sheets[si] || !(r >= 0 && c >= 0 && r < MAXR && c < MAXC)) return E.ref;
      let src = typeof text === 'string' ? text : ''; // solo texto: otro tipo cuenta como fórmula vacía (#VALUE!)
      if (src[0] !== '=') src = '=' + src;
      if (opts.from) src = shiftFormula(src, r - opts.from.r, c - opts.from.c);
      const prev = this.cur;
      this.cur = { si, r, c }; // la celda de la regla: FILA(), COLUMNA(), @ y F1C1 relativos
      try {
        const a = this.ast(src), res = opts.ref ? this.evalArg(a, si) : this.evalNode(a, si);
        if (opts.ref && res && res.range) return res;
        return this.cellOut(res);
      } catch (e) {
        if (e instanceof FErr) return e; // también sintaxis inválida y #NAME?
        if (e === ABORT) throw e;
        if (!(e instanceof RangeError)) console.error(e);
        return E.value;
      } finally { this.cur = prev; } // la fórmula suelta no queda como celda en curso
    }
    // Resultado de una fórmula tal como lo daría una celda, sin desbordar (ver evalFormula)
    // (las funciones ya dan #CALC! en vez de una matriz vacía; un rango enorme da #NUM!, como al desbordar)
    cellOut(res) {
      if (isMulti(res)) {
        if (res.range) { const [h, w] = this.dims(res); guardSize(h * w); }
        const m = isMat(res) ? res : this.rangeValues(res);
        return m.map(row => row.map(spillVal));
      }
      return spillVal(scalar(res));
    }
    // Condición de una regla (formato condicional "Utilice una fórmula…", validación Personalizada): VERDADERO o un
    // número ≠ 0 → true; FALSO, 0, vacío, texto (también "VERDADERO") y errores → false (un error no aplica el
    // formato). De una matriz o un rango, el primer elemento (arriba a la izquierda). opts.from como en evalFormula.
    evalFormulaBool(si, r, c, text, opts = {}) {
      let v = this.evalFormula(si, r, c, text, { from: opts.from });
      if (isMat(v)) v = v[0][0];
      return v === true || (typeof v === 'number' && v !== 0);
    }
  }

  // ---------- Funciones ----------
  const FN = {};
  const CANON = {};
  const ES = {}; // nombre canónico (inglés) → nombre en Excel en español (el segundo de la lista, si existe)
  const def = (names, fn, lazy = false) => {
    const list = names.split(' ');
    list.forEach(n => { FN[n] = { fn, lazy }; CANON[n] = list[0]; });
    if (list[1]) ES[list[0]] = list[1];
  };

  // Valores de los argumentos; r: true si vienen de una referencia o rango (se ignoran texto y vacíos)
  function flatten(args) {
    const out = [];
    for (const a of args) {
      if (a && a.range) { for (const row of a.eng.rangeValues(a)) for (const v of row) out.push({ v, r: true }); }
      else if (a && a.arr) { for (const v of a.vals) out.push({ v, r: true }); }
      else if (isMat(a)) { for (const row of a) for (const v of row) out.push({ v, r: true }); } // matrices: reglas de rango (Excel)
      else out.push({ v: a, r: false });
    }
    return out;
  }

  // ---------- Matrices dinámicas: qué fórmulas pueden desbordar ----------
  // Funciones que devuelven una matriz o un rango de varias celdas
  const ARR_FN = new Set(['SEQUENCE', 'UNIQUE', 'FILTER', 'SORT', 'SORTBY', 'RANDARRAY', 'MODE.MULT', 'VSTACK', 'HSTACK', 'TAKE', 'DROP',
    'CHOOSECOLS', 'CHOOSEROWS', 'TRANSPOSE', 'INDIRECT', 'OFFSET', 'INDEX', 'XLOOKUP']);
  // Funciones que devuelven una matriz si alguno de sus argumentos lo es (ramas, pruebas, FILA/COLUMNA)
  const PASS_FN = new Set(['IF', 'IFS', 'IFERROR', 'IFNA', 'CHOOSE', 'ISERROR', 'ISNA', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ROW', 'COLUMN']);
  // Funciones de valores sueltos que se aplican elemento a elemento: true = todos los argumentos; lista = esas posiciones
  const LIFT = {};
  for (const n of ['ABS', 'INT', 'SQRT', 'POWER', 'MOD', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'TRUNC', 'CEILING', 'FLOOR', 'LEN', 'UPPER', 'LOWER',
    'PROPER', 'TRIM', 'LEFT', 'RIGHT', 'MID', 'SUBSTITUTE', 'REPT', 'VALUE', 'FIND', 'SEARCH', 'TEXT', 'DATE', 'YEAR', 'MONTH', 'DAY', 'HOUR',
    'MINUTE', 'SECOND', 'TIME', 'TIMEVALUE', 'DATEVALUE', 'WEEKDAY', 'EOMONTH', 'EDATE', 'DATEDIF', 'NOT', 'RANDBETWEEN']) LIFT[n] = true;
  Object.assign(LIFT, { VLOOKUP: [0], HLOOKUP: [0], MATCH: [0], XLOOKUP: [0], COUNTIF: [1], SUMIF: [1], AVERAGEIF: [1] });
  // Análisis estático: ¿el resultado de este nodo puede ser una matriz? (conservador: ante la duda, sí).
  // Solo las fórmulas que pueden desbordar se consultan al leer una celda vacía (ver Engine.ghost).
  function mayArray(n) {
    switch (n && n.k) {
      case 'arr': case 'name': return true;
      case 'ref': return !!(n.b || n.kind || n.spill);
      case 'neg': case 'pct': return mayArray(n.e);
      case 'bin': return mayArray(n.l) || mayArray(n.r);
      case 'call': {
        const c = CANON[n.n];
        if (ARR_FN.has(c)) return true;
        if (PASS_FN.has(c)) return n.args.some(mayArray);
        const l = LIFT[c];
        return !!l && (l === true ? n.args : l.map(i => n.args[i])).some(a => a && mayArray(a));
      }
    }
    return false; // literales, errores y @ (intersección implícita)
  }
  // ¿La fórmula puede devolver una matriz? (para la UI y el importador .xlsx: ver mayArrayFormula)
  function mayArrayFormula(f) {
    const s = String(f);
    if (!isFormula(s)) return false;
    try { return mayArray(parse(tokenize(s.slice(1)))); } catch (e) { return false; }
  }
  // Números de los argumentos. blankZero: un argumento vacío escrito (`;;`, null) cuenta como 0, como en
  // PROMEDIO, MIN y MAX de Excel; SUMA/PRODUCTO lo ignoran. Una referencia a una celda vacía siempre se ignora.
  function nums(args, blankZero = false) {
    const out = [];
    for (const { v, r } of flatten(args)) {
      if (v instanceof FErr) throw v;
      if (typeof v === 'number') out.push(v);
      else if (!r && v !== null) out.push(toNum(v));
      else if (!r && blankZero) out.push(0);
    }
    return out;
  }
  const N = x => toNum(scalar(x));
  const T = x => toStr(scalar(x));
  const out = v => { if (v instanceof FErr) throw v; return v; };
  const sum = a => a.reduce((s, x) => s + x, 0);
  const needRange = g => { if (!g || !g.range) throw E.value; return g; };
  const given = x => x !== undefined && x !== null; // argumento presente y no vacío
  function roundTo(x, d, mode) {
    const f = Math.pow(10, Math.trunc(d)), a = +(Math.abs(x) * f).toPrecision(15);
    const r = mode === 'up' ? Math.ceil(a) : mode === 'down' ? Math.floor(a) : Math.round(a);
    return Math.sign(x) * r / f;
  }
  const eqVal = (a, b) => compareVals(a, b) === 0;
  // Valores de un rango con una forma fija h×w desde su esquina superior izquierda
  const grid = (g, h, w) => g.eng.rangeValues({ ...g, r2: g.r1 + h - 1, c2: g.c1 + w - 1, full: false });
  // Forma común de varios rangos (deben tener el mismo tamaño); A:A se acota al área usada
  function shapeOf(gs) {
    const H = gs[0].r2 - gs[0].r1, W = gs[0].c2 - gs[0].c1;
    if (gs.some(g => g.r2 - g.r1 !== H || g.c2 - g.c1 !== W)) throw E.value;
    let h = 0, w = 0;
    for (const g of gs) { const [a, b] = g.eng.dims(g); h = Math.max(h, a); w = Math.max(w, b); }
    return [h, w];
  }

  // Comodines de Excel: * y ?; ~ escapa (~*, ~?, ~~)
  function wildRe(s, anchored = true) {
    let src = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '~' && i + 1 < s.length && '*?~'.includes(s[i + 1])) src += '\\' + s[++i];
      else if (ch === '*') src += '[\\s\\S]*';
      else if (ch === '?') src += '[\\s\\S]';
      else src += ch.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
    }
    return new RegExp(anchored ? '^' + src + '$' : src, 'i');
  }

  function criterion(c) {
    c = scalar(c);
    if (typeof c === 'number' || typeof c === 'boolean') return v => v !== null && compareVals(v, c, true) === 0;
    let s = toStr(c);
    const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s);
    const op = m[1] || '=';
    s = m[2];
    // el operando se interpreta como lo escrito en una celda: números es-CL, %, fechas y VERDADERO/FALSO
    const lit = s.trim() === '' || s[0] === "'" ? null : literal(s.trim());
    const test = (o, x) => o === '<' ? x < 0 : o === '>' ? x > 0 : o === '<=' ? x <= 0 : x >= 0;
    // criterio "#N/D" (o "<>#N/D"): cuenta las celdas con ese error
    if (lit instanceof FErr) return op === '=' ? v => v === lit : op === '<>' ? v => v !== lit : () => false;
    if (typeof lit === 'number' || typeof lit === 'boolean') {
      const ty = typeof lit;
      // como los operadores, los números se comparan con 15 cifras significativas
      const same = v => typeof v === ty && compareVals(v, lit, true) === 0;
      if (op === '=') return same;
      if (op === '<>') return v => !same(v);
      return v => typeof v === ty && test(op, compareVals(v, lit, true));
    }
    const re = wildRe(s);
    const blank = v => v === null || v === '';
    if (op === '=') return v => s === '' ? blank(v) : typeof v === 'string' && re.test(v);
    if (op === '<>') return v => s === '' ? !blank(v) : !(typeof v === 'string' && re.test(v));
    return v => typeof v === 'string' && test(op, compareVals(v, s));
  }
  function condPairs(rng, crit, target) {
    const g = needRange(rng), [h, w] = g.eng.dims(g), vals = grid(g, h, w).flat();
    const tv = given(target) ? needRange(target) : g;
    const tvals = grid(tv, h, w).flat();
    const pred = criterion(crit);
    return vals.map((v, i) => [pred(v), tvals[i]]).filter(p => p[0]).map(p => p[1]);
  }
  // *.SI.CONJUNTO: valores de `target` (o null) que cumplen todos los pares rango/criterio
  function condMulti(target, pairs) {
    if (!pairs.length || pairs.length % 2) throw E.value;
    const gs = [];
    for (let i = 0; i < pairs.length; i += 2) gs.push(needRange(pairs[i]));
    if (target) gs.push(needRange(target));
    const [h, w] = shapeOf(gs);
    let mask = null;
    for (let i = 0; i < pairs.length; i += 2) {
      const p = criterion(pairs[i + 1]), vals = grid(gs[i / 2], h, w).flat();
      mask = vals.map((v, j) => (mask ? mask[j] : true) && p(v));
    }
    const tv = target ? grid(gs[gs.length - 1], h, w).flat() : mask;
    return tv.filter((_, j) => mask[j]);
  }
  const today = () => { const d = new Date(); return dateSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const variance = (v, sample) => { const n = v.length; if (n < (sample ? 2 : 1)) throw E.div0; const m = sum(v) / n; return sum(v.map(x => (x - m) ** 2)) / (n - (sample ? 1 : 0)); };

  def('SUM SUMA', a => sum(nums(a)));
  def('AVERAGE PROMEDIO', a => { const v = nums(a, true); if (!v.length) throw E.div0; return sum(v) / v.length; });
  def('MIN', a => { const v = nums(a, true); return v.length ? v.reduce((x, y) => Math.min(x, y)) : 0; });
  def('MAX', a => { const v = nums(a, true); return v.length ? v.reduce((x, y) => Math.max(x, y)) : 0; });
  def('MEDIAN MEDIANA', a => { const v = nums(a).sort((x, y) => x - y); if (!v.length) throw E.num; const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; });
  def('STDEV DESVEST', a => Math.sqrt(variance(nums(a), true)));
  def('STDEV.S DESVEST.M', a => Math.sqrt(variance(nums(a), true)));
  def('STDEV.P DESVEST.P', a => Math.sqrt(variance(nums(a), false)));
  def('STDEVP DESVESTP', a => Math.sqrt(variance(nums(a), false)));
  def('VAR', a => variance(nums(a), true));
  def('VAR.S', a => variance(nums(a), true));
  def('VAR.P', a => variance(nums(a), false));
  def('VARP', a => variance(nums(a), false));
  def('COUNT CONTAR', a => flatten(a).filter(({ v, r }) => typeof v === 'number' || (!r && (typeof v === 'boolean' || (v !== null && typeof literal(String(v)) === 'number')))).length);
  // CONTARA: en rangos cuenta toda celda no vacía (también fórmulas que devuelven ""); los argumentos directos siempre cuentan
  def('COUNTA CONTARA', a => flatten(a).filter(({ v, r }) => !r || v !== null).length);
  def('COUNTBLANK CONTAR.BLANCO', a => {
    let n = 0;
    for (const g of a) {
      if (!g || !g.range) continue;
      const vals = g.eng.rangeValues(g).flat(), size = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
      n += vals.filter(v => v === null || v === '').length + size - vals.length;
    }
    return n;
  });
  def('PRODUCT PRODUCTO', a => { const v = nums(a); return v.length ? v.reduce((p, x) => p * x, 1) : 0; });
  def('ROUND REDONDEAR', ([x, d]) => roundTo(N(x), N(d)));
  def('ROUNDUP REDONDEAR.MAS', ([x, d]) => roundTo(N(x), N(d), 'up'));
  def('ROUNDDOWN REDONDEAR.MENOS', ([x, d]) => roundTo(N(x), N(d), 'down'));
  def('TRUNC TRUNCAR', ([x, d]) => roundTo(N(x), N(d), 'down'));
  def('INT ENTERO', ([x]) => Math.floor(N(x)));
  def('ABS', ([x]) => Math.abs(N(x)));
  def('SQRT RAIZ', ([x]) => { const v = N(x); if (v < 0) throw E.num; return Math.sqrt(v); });
  def('POWER POTENCIA', ([x, y]) => Math.pow(N(x), N(y)));
  def('MOD RESIDUO', ([x, y]) => { const a = N(x), d = N(y); if (d === 0) throw E.div0; return a - d * Math.floor(a / d); });
  def('CEILING MULTIPLO.SUPERIOR', ([x, s]) => {
    const v = N(x), g = N(s);
    if (g === 0) return 0;
    if (v > 0 && g < 0) throw E.num;
    return Math.ceil(+(v / g).toPrecision(15)) * g;
  });
  def('FLOOR MULTIPLO.INFERIOR', ([x, s]) => {
    const v = N(x), g = N(s);
    if (g === 0) { if (v === 0) return 0; throw E.div0; }
    if (v > 0 && g < 0) throw E.num;
    return Math.floor(+(v / g).toPrecision(15)) * g;
  });
  def('PI', () => Math.PI);
  def('RAND ALEATORIO', () => Math.random());
  def('RANDBETWEEN ALEATORIO.ENTRE', ([a, b]) => { const lo = Math.ceil(N(a)), hi = Math.floor(N(b)); return lo + Math.floor(Math.random() * (hi - lo + 1)); });
  // SUMAPRODUCTO: rangos y matrices del mismo tamaño (=SUMAPRODUCTO((A1:A3>1)*B1:B3)); lo que no es número vale 0
  def('SUMPRODUCT SUMAPRODUCTO', a => {
    if (!a.length) throw E.value;
    const gs = a.filter(x => x && x.range);
    let h = 1, w = 1;
    if (gs.length) [h, w] = shapeOf(gs);
    else { const m = a.find(isMat); if (m) [h, w] = [m.length, m[0].length]; }
    const arrs = a.map(x => {
      if (x && x.range) return grid(x, h, w).flat();
      if (isMat(x)) { if (x.length !== h || x[0].length !== w) throw E.value; return x.flat(); }
      if (h * w === 1) return [scalar(x)];
      throw E.value;
    });
    let s = 0;
    for (let i = 0; i < h * w; i++) {
      let p = 1;
      for (const arr of arrs) { const v = arr[i]; if (v instanceof FErr) throw v; p *= typeof v === 'number' ? v : 0; }
      s += p;
    }
    return s;
  });
  const kth = (arr, k, big) => {
    const v = nums([arr]).sort((x, y) => big ? y - x : x - y), i = Math.ceil(N(k));
    if (i < 1 || i > v.length) throw E.num;
    return v[i - 1];
  };
  def('LARGE K.ESIMO.MAYOR', ([a, k]) => kth(a, k, true));
  def('SMALL K.ESIMO.MENOR', ([a, k]) => kth(a, k, false));
  const rankFn = ([x, ref, ord]) => {
    const n = N(x), v = nums([needRange(ref)]);
    if (!v.includes(n)) throw E.na;
    const asc = given(ord) && N(ord) !== 0;
    return v.filter(y => asc ? y < n : y > n).length + 1;
  };
  def('RANK JERARQUIA', rankFn);
  def('RANK.EQ JERARQUIA.EQV', rankFn);
  // JERARQUIA.MEDIA: los empates reciben el promedio de las posiciones que ocupan
  def('RANK.AVG JERARQUIA.MEDIA', ([x, ref, ord]) => {
    const n = N(x), v = nums([needRange(ref)]), ties = v.filter(y => y === n).length;
    if (!ties) throw E.na;
    const asc = given(ord) && N(ord) !== 0;
    return v.filter(y => asc ? y < n : y > n).length + (ties + 1) / 2;
  });

  // MODA: el valor más repetido; con empate gana el que aparece primero; sin repetidos → #N/A
  const modeFn = a => {
    const v = nums(a), cnt = new Map();
    for (const x of v) cnt.set(x, (cnt.get(x) || 0) + 1);
    const top = Math.max(0, ...cnt.values());
    if (top < 2) throw E.na;
    return v.find(x => cnt.get(x) === top);
  };
  def('MODE MODA', modeFn);
  def('MODE.SNGL MODA.UNO', modeFn);
  // Percentiles con interpolación lineal; .INC usa la posición (n-1)k y .EXC la posición (n+1)k
  const sortedNums = a => nums([a]).sort((x, y) => x - y);
  const interp = (v, p) => { const i = Math.floor(p), f = p - i; return i + 1 < v.length ? v[i] + f * (v[i + 1] - v[i]) : v[i]; };
  function pctInc(v, k) {
    if (!v.length || k < 0 || k > 1) throw E.num;
    return interp(v, +((v.length - 1) * k).toPrecision(15));
  }
  function pctExc(v, k) {
    const n = v.length, p = +((n + 1) * k).toPrecision(15);
    if (!n || k <= 0 || k >= 1 || p < 1 || p > n) throw E.num;
    return interp(v, p - 1);
  }
  def('PERCENTILE PERCENTIL', ([a, k]) => pctInc(sortedNums(a), N(k)));
  def('PERCENTILE.INC PERCENTIL.INC', ([a, k]) => pctInc(sortedNums(a), N(k)));
  def('PERCENTILE.EXC PERCENTIL.EXC', ([a, k]) => pctExc(sortedNums(a), N(k)));
  // CUARTIL: cuartil truncado; .INC acepta 0–4 (mínimo a máximo) y .EXC solo 1–3
  const quartFn = exc => ([a, q]) => {
    const k = Math.trunc(N(q));
    if (exc ? k <= 0 || k >= 4 : k < 0 || k > 4) throw E.num;
    const v = sortedNums(a);
    return exc ? pctExc(v, k / 4) : pctInc(v, k / 4);
  };
  def('QUARTILE CUARTIL', quartFn(false));
  def('QUARTILE.INC CUARTIL.INC', quartFn(false));
  def('QUARTILE.EXC CUARTIL.EXC', quartFn(true));
  // MEDIA.ACOTADA: excluye floor(n·porcentaje/2) valores de cada extremo
  def('TRIMMEAN MEDIA.ACOTADA', ([a, p]) => {
    const pc = N(p);
    if (pc < 0 || pc >= 1) throw E.num;
    const v = sortedNums(a);
    if (!v.length) throw E.num;
    const k = Math.floor(+(v.length * pc / 2).toPrecision(12)), s = v.slice(k, v.length - k);
    return sum(s) / s.length;
  });
  // PROMEDIOA / MAXA / MINA: en rangos el texto vale 0 y VERDADERO 1 (las celdas vacías se ignoran);
  // los argumentos directos siguen las reglas de valor (texto no numérico → #VALUE!)
  function numsA(args) {
    const out = [];
    for (const { v, r } of flatten(args)) {
      if (v instanceof FErr) throw v;
      if (v === null) { if (!r) out.push(0); continue; } // argumento vacío escrito → 0 (como PROMEDIO/MIN/MAX)
      out.push(r ? (typeof v === 'number' ? v : v === true ? 1 : 0) : toNum(v));
    }
    return out;
  }
  def('AVERAGEA PROMEDIOA', a => { const v = numsA(a); if (!v.length) throw E.div0; return sum(v) / v.length; });
  def('MAXA', a => { const v = numsA(a); return v.length ? Math.max(...v) : 0; });
  def('MINA', a => { const v = numsA(a); return v.length ? Math.min(...v) : 0; });

  // Pares (x, y) de dos rangos con la misma cantidad de celdas; se omite el par si alguno no es número.
  // Distinta cantidad → #N/A; los errores se propagan.
  function xyPairs(ys, xs) {
    const a = flatten([ys]), b = flatten([xs]);
    if (a.length !== b.length) throw E.na;
    const ps = [];
    for (let i = 0; i < a.length; i++) {
      const y = a[i].v, x = b[i].v;
      if (y instanceof FErr) throw y;
      if (x instanceof FErr) throw x;
      if (typeof y === 'number' && typeof x === 'number') ps.push([x, y]);
    }
    const n = ps.length, mx = sum(ps.map(p => p[0])) / n, my = sum(ps.map(p => p[1])) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of ps) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    return { n, mx, my, sxx, syy, sxy };
  }
  const correl = ([a, b]) => { const s = xyPairs(a, b); if (!s.n || !s.sxx || !s.syy) throw E.div0; return s.sxy / Math.sqrt(s.sxx * s.syy); };
  def('CORREL COEF.DE.CORREL', correl);
  def('PEARSON', correl);
  def('RSQ COEFICIENTE.R2', a => correl(a) ** 2);
  // Regresión lineal: sin datos → #N/A; varianza de x igual a 0 → #DIV/0!
  const regress = (ys, xs) => { const s = xyPairs(ys, xs); if (!s.n) throw E.na; if (!s.sxx) throw E.div0; const m = s.sxy / s.sxx; return { m, b: s.my - m * s.mx }; };
  def('SLOPE PENDIENTE', ([ys, xs]) => regress(ys, xs).m);
  def('INTERCEPT INTERSECCION.EJE', ([ys, xs]) => regress(ys, xs).b);
  const forecast = ([x, ys, xs]) => { const v = N(x), { m, b } = regress(ys, xs); return b + m * v; };
  def('FORECAST PRONOSTICO', forecast);
  def('FORECAST.LINEAR PRONOSTICO.LINEAL', forecast);

  // Evalúa un argumento dejando un error como valor (para elegir rama elemento a elemento)
  const softEval = (f, x) => { try { return f(x); } catch (e) { if (e instanceof FErr) return e; throw e; } };
  def('IF SI', (args, ev, cx, evArg) => {
    const c = ev(args[0]);
    // condición matricial: se evalúan ambas ramas y se elige elemento a elemento (=SI(A1:A3>1;"sí";"no"))
    if (isMulti(c)) {
      const t = args.length > 1 ? softEval(evArg, args[1]) : true, f = args.length > 2 ? softEval(evArg, args[2]) : false;
      return broadcast([c, t, f], (cv, tv, fv) => cv instanceof FErr ? cv : truthy(cv) ? tv : fv, true);
    }
    if (truthy(scalar(c))) return args.length > 1 ? evArg(args[1]) : true;
    return args.length > 2 ? evArg(args[2]) : false;
  }, true);
  def('IFS SI.CONJUNTO', (args, ev, cx, evArg) => {
    if (!args.length || args.length % 2) throw E.value;
    for (let i = 0; i < args.length; i += 2) if (truthy(scalar(ev(args[i])))) return evArg(args[i + 1]);
    throw E.na;
  }, true);
  // SI.ERROR / SI.ND: con una matriz, reemplazan elemento a elemento los errores (todos o solo #N/A)
  const ifErr = isBad => (args, ev) => {
    const alt = () => args[1] ? ev(args[1]) : null;
    let v;
    try { v = ev(args[0]); } catch (e) { if (e instanceof FErr && isBad(e)) return alt(); throw e; }
    if (isMulti(v)) {
      const fb = args[1] ? softEval(ev, args[1]) : null;
      return broadcast([v, fb], (x, y) => x instanceof FErr && isBad(x) ? y : x, true);
    }
    try { return scalar(v); } catch (e) { if (e instanceof FErr && isBad(e)) return alt(); throw e; }
  };
  def('IFERROR SI.ERROR', ifErr(() => true), true);
  def('IFNA SI.ND', ifErr(e => e === E.na), true);
  def('CHOOSE ELEGIR', (args, ev, cx, evArg) => {
    const i = Math.trunc(toNum(scalar(ev(args[0]))));
    if (i < 1 || i >= args.length) throw E.value;
    return evArg(args[i]);
  }, true);
  // ESERROR, ESNUMERO…: con una matriz o un rango de varias celdas devuelven una matriz de VERDADERO/FALSO
  const isTest = pred => (args, ev) => {
    let v;
    try { v = ev(args[0]); } catch (e) { if (e instanceof FErr) return pred(e); throw e; }
    if (isMulti(v)) return toMat(v).map(row => row.map(x => pred(x)));
    try { v = scalar(v); } catch (e) { if (e instanceof FErr) return pred(e); throw e; }
    return pred(v);
  };
  def('ISERROR ESERROR', isTest(v => v instanceof FErr), true);
  def('ISNA ESNOD', isTest(v => v === E.na), true);
  def('ISBLANK ESBLANCO', isTest(v => v === null), true);
  def('ISNUMBER ESNUMERO', isTest(v => typeof v === 'number'), true);
  def('ISTEXT ESTEXTO', isTest(v => typeof v === 'string'), true);
  const bools = a => flatten(a).filter(({ v, r }) => !(r && (v === null || typeof v === 'string'))).map(({ v }) => truthy(v));
  def('AND Y', a => { const b = bools(a); if (!b.length) throw E.value; return b.every(Boolean); });
  def('OR O', a => { const b = bools(a); if (!b.length) throw E.value; return b.some(Boolean); });
  def('NOT NO', ([x]) => !truthy(scalar(x)));

  // CONCAT (Excel 2019, en español también CONCAT) y CONCATENAR (CONCATENATE) son funciones distintas en .xlsx
  const concatFn = a => flatten(a).map(({ v }) => toStr(v)).join('');
  def('CONCATENATE CONCATENAR', concatFn);
  def('CONCAT', concatFn);
  def('TEXTJOIN UNIRCADENAS', ([d, ign, ...rest]) => {
    const ds = flatten([d]).map(({ v }) => toStr(v)), skip = truthy(scalar(ign));
    const vals = flatten(rest).map(({ v }) => toStr(v)).filter(s => !skip || s !== '');
    return vals.reduce((acc, s, i) => i ? acc + (ds.length ? ds[(i - 1) % ds.length] : '') + s : s, '');
  });
  def('LEN LARGO', ([x]) => T(x).length);
  def('UPPER MAYUSC', ([x]) => T(x).toUpperCase());
  def('LOWER MINUSC', ([x]) => T(x).toLowerCase());
  def('PROPER NOMPROPIO', ([x]) => T(x).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()));
  def('TRIM ESPACIOS', ([x]) => T(x).trim().replace(/ +/g, ' '));
  // núm_de_caracteres omitido → 1; negativo → #VALUE!
  const nchars = n => { const k = n === undefined ? 1 : Math.trunc(N(n)); if (k < 0) throw E.value; return k; };
  def('LEFT IZQUIERDA', ([x, n]) => { const k = nchars(n); return T(x).slice(0, k); });
  def('RIGHT DERECHA', ([x, n]) => { const k = nchars(n), s = T(x); return k === 0 ? '' : s.slice(-k); });
  def('MID EXTRAE', ([x, s, n]) => { const st = Math.trunc(N(s)), k = Math.trunc(N(n)); if (st < 1 || k < 0) throw E.value; return T(x).substr(st - 1, k); });
  def('SUBSTITUTE SUSTITUIR', ([x, a, b, inst]) => {
    const s = T(x), old = T(a), nw = T(b);
    if (old === '') return s;
    if (!given(inst)) return s.split(old).join(nw);
    const k = Math.trunc(N(inst));
    if (k < 1) throw E.value;
    let pos = -1;
    for (let i = 0; i < k; i++) { pos = s.indexOf(old, pos + 1); if (pos < 0) return s; }
    return s.slice(0, pos) + nw + s.slice(pos + old.length);
  });
  def('REPT REPETIR', ([x, n]) => T(x).repeat(Math.max(0, N(n))));
  def('VALUE VALOR', ([x]) => toNum(scalar(x)));
  const startPos = (st, len) => { const p = given(st) ? Math.trunc(N(st)) : 1; if (p < 1 || p > len + 1) throw E.value; return p; };
  def('FIND ENCONTRAR', ([f, w, st]) => {
    const s = T(w), q = T(f), p = startPos(st, s.length), i = s.indexOf(q, p - 1);
    if (i < 0) throw E.value;
    return i + 1;
  });
  def('SEARCH HALLAR', ([f, w, st]) => {
    const s = T(w), q = T(f), p = startPos(st, s.length);
    if (q === '') return p;
    const i = s.slice(p - 1).search(wildRe(q, false));
    if (i < 0) throw E.value;
    return i + p;
  });
  def('TEXT TEXTO', ([v, f]) => formatText(scalar(v), T(f)));

  def('TODAY HOY', () => today());
  def('NOW AHORA', () => { const d = new Date(); return today() + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; });
  // FECHA: años 0–1899 se suman a 1900 (como Excel); meses y días se desbordan al mes/año siguiente
  def('DATE FECHA', ([y, m, d]) => {
    let yy = Math.trunc(N(y));
    if (yy < 0 || yy >= 10000) throw E.num;
    if (yy < 1900) yy += 1900;
    const s = dateSerial(yy, Math.trunc(N(m)), Math.trunc(N(d)));
    if (s < 0) throw E.num;
    return s;
  });
  // el serial 60 es el 29/02/1900 ficticio de Excel (no existe en Date)
  const ymd = x => { const v = N(x); if (v < 0) throw E.num; if (Math.floor(v) === 60) return [1900, 2, 29]; const d = serialDate(Math.floor(v)); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
  def('YEAR AÑO', ([x]) => ymd(x)[0]);
  def('MONTH MES', ([x]) => ymd(x)[1]);
  def('DAY DIA', ([x]) => ymd(x)[2]);
  // HORA/MINUTO/SEGUNDO: parte fraccionaria del serial (número, hora escrita "14:30", fecha + hora o texto
  // de hora es-CL), redondeada al segundo; negativo → #NUM!; celda vacía → 0
  const hms = x => {
    const v = N(x);
    if (v < 0) throw E.num;
    const s = Math.round(+((v - Math.floor(v)) * 86400).toPrecision(12)) % 86400;
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
  };
  def('HOUR HORA', ([x]) => hms(x)[0]);
  def('MINUTE MINUTO', ([x]) => hms(x)[1]);
  def('SECOND SEGUNDO', ([x]) => hms(x)[2]);
  // NSHORA: argumentos truncados (0–32767); el total en segundos se lleva a un día (25:00 → 1:00); negativo → #NUM!
  def('TIME NSHORA', ([h, m, s]) => {
    const p = [h, m, s].map(x => Math.trunc(N(x)));
    if (p.some(x => x > 32767)) throw E.num;
    const t = p[0] * 3600 + p[1] * 60 + p[2];
    if (t < 0) throw E.num;
    return (t % 86400) / 86400;
  });
  // HORANUMERO: solo texto ("14:30", "14:30:15", "22/10/2026 14:30"); devuelve la fracción del día.
  // Números, celdas vacías o texto que no es hora → #VALUE!
  def('TIMEVALUE HORANUMERO', ([x]) => {
    const t = scalar(x);
    if (t instanceof FErr) throw t;
    if (typeof t !== 'string') throw E.value;
    const s = t.trim(), v = parseTime(s) ?? parseDateTime(s) ?? parseDate(s);
    if (v === null) throw E.value;
    return v - Math.floor(v);
  });
  // FECHANUMERO: solo texto con una fecha que Excel reconoce al escribirla (mismas reglas que literal: d/m/aa,
  // 1-ene-26, d/m con el año actual); la hora se ignora. Números, celdas vacías, texto sin fecha o fuera de
  // 01/01/1900–31/12/9999 → #VALUE!
  def('DATEVALUE FECHANUMERO', ([x]) => {
    const t = scalar(x);
    if (t instanceof FErr) throw t;
    if (typeof t !== 'string') throw E.value;
    const s = t.trim(), v = parseDate(s) ?? parseDateTime(s);
    if (v === null) throw E.value;
    return Math.floor(v);
  });
  const dow = s => (Math.floor(s) % 7 + 6) % 7; // 0 = domingo; como Excel, serial 1 (01/01/1900) es domingo
  def('WEEKDAY DIASEM', ([x, t]) => {
    const v = N(x); if (v < 0) throw E.num;
    const d = dow(v), k = given(t) ? Math.trunc(N(t)) : 1;
    if (k === 1) return d + 1;
    if (k === 2) return (d + 6) % 7 + 1;
    if (k === 3) return (d + 6) % 7;
    if (k >= 11 && k <= 17) { const st = (k - 10) % 7; return (d - st + 7) % 7 + 1; }
    throw E.num;
  });
  def('EOMONTH FIN.MES', ([x, n]) => { const [y, m] = ymd(x); return dateSerial(y, m + Math.trunc(N(n)) + 1, 0); });
  def('EDATE FECHA.MES', ([x, n]) => {
    const [y, m, d] = ymd(x), t = new Date(Date.UTC(y, m - 1 + Math.trunc(N(n)), 1));
    const ty = t.getUTCFullYear(), tm = t.getUTCMonth() + 1;
    return dateSerial(ty, tm, Math.min(d, daysIn(ty, tm)));
  });
  def('DATEDIF SIFECHA', ([a, b, u]) => {
    const s = Math.floor(N(a)), e = Math.floor(N(b)), unit = T(u).toUpperCase();
    if (s > e) throw E.num;
    const [ys, ms, ds] = ymd(s), [ye, me, de] = ymd(e);
    const months = (ye - ys) * 12 + (me - ms) - (de < ds ? 1 : 0);
    switch (unit) {
      case 'D': return e - s;
      case 'M': return months;
      case 'Y': return Math.floor(months / 12);
      case 'YM': return months % 12;
      case 'MD': { let d = de - ds; if (d < 0) d += daysIn(me === 1 ? ye - 1 : ye, me === 1 ? 12 : me - 1); return d; }
      case 'YD': { let s2 = dateSerial(ye, ms, ds); if (s2 > e) s2 = dateSerial(ye - 1, ms, ds); return e - s2; }
    }
    throw E.num;
  });
  def('NETWORKDAYS DIAS.LAB', ([a, b, hol]) => {
    let s = Math.floor(N(a)), e = Math.floor(N(b)), sign = 1;
    if (s > e) { [s, e] = [e, s]; sign = -1; }
    const skip = new Set(given(hol) ? nums([hol]).map(Math.floor) : []);
    let n = 0;
    for (let d = s; d <= e; d++) { const w = dow(d); if (w !== 0 && w !== 6 && !skip.has(d)) n++; }
    return sign * n;
  });

  def('SUMIF SUMAR.SI', ([rng, crit, tgt]) => sum(condPairs(rng, crit, tgt).filter(v => typeof v === 'number')));
  def('COUNTIF CONTAR.SI', ([rng, crit]) => condPairs(rng, crit).length);
  def('AVERAGEIF PROMEDIO.SI', ([rng, crit, tgt]) => { const v = condPairs(rng, crit, tgt).filter(x => typeof x === 'number'); if (!v.length) throw E.div0; return sum(v) / v.length; });
  def('SUMIFS SUMAR.SI.CONJUNTO', ([t, ...p]) => sum(condMulti(needRange(t), p).filter(v => typeof v === 'number')));
  def('COUNTIFS CONTAR.SI.CONJUNTO', p => condMulti(null, p).length);
  def('AVERAGEIFS PROMEDIO.SI.CONJUNTO', ([t, ...p]) => { const v = condMulti(needRange(t), p).filter(x => typeof x === 'number'); if (!v.length) throw E.div0; return sum(v) / v.length; });
  def('MAXIFS MAX.SI.CONJUNTO', ([t, ...p]) => { const v = condMulti(needRange(t), p).filter(x => typeof x === 'number'); return v.length ? Math.max(...v) : 0; });
  def('MINIFS MIN.SI.CONJUNTO', ([t, ...p]) => { const v = condMulti(needRange(t), p).filter(x => typeof x === 'number'); return v.length ? Math.min(...v) : 0; });

  // BUSCARV/BUSCARH sobre una tabla (filas): ordenado omitido → aproximada; vacío o FALSO → exacta
  function lookupTbl(tbl, val, idx, approx) {
    const ci = Math.trunc(N(idx)) - 1;
    if (ci < 0) throw E.value;
    if (ci >= tbl[0].length) throw E.ref;
    const key = scalar(val);
    const exact = approx !== undefined && (approx === null || !truthy(scalar(approx)));
    if (exact) {
      const re = typeof key === 'string' && /[*?~]/.test(key) ? wildRe(key) : null;
      for (const row of tbl) if (row[0] !== null && (re ? typeof row[0] === 'string' && re.test(row[0]) : eqVal(row[0], key))) return out(row[ci]);
      throw E.na;
    }
    let hit = -1;
    for (let i = 0; i < tbl.length; i++) { const k = tbl[i][0]; if (k === null) continue; if (compareVals(k, key) <= 0) hit = i; else break; }
    if (hit < 0) throw E.na;
    return out(tbl[hit][ci]);
  }
  // Tabla de búsqueda: un rango o una matriz calculada (=BUSCARV(x;ORDENAR(A1:B9);2;FALSO)); otra cosa → #VALUE!
  const tableOf = x => isMat(x) ? x : needRange(x).eng.rangeValues(x);
  def('VLOOKUP BUSCARV', ([val, rng, col, approx]) => lookupTbl(tableOf(rng), val, col, approx));
  def('HLOOKUP BUSCARH', ([val, rng, row, approx]) => lookupTbl(transpose(tableOf(rng)), val, row, approx));
  def('MATCH COINCIDIR', ([val, rng, type]) => {
    const list = tableOf(rng).flat(), key = scalar(val);
    const t = type === undefined ? 1 : N(type); // tipo vacío → 0 (exacta)
    if (t === 0) {
      const re = typeof key === 'string' && /[*?~]/.test(key) ? wildRe(key) : null;
      const i = list.findIndex(v => v !== null && (re ? typeof v === 'string' && re.test(v) : eqVal(v, key)));
      if (i < 0) throw E.na; return i + 1;
    }
    let hit = -1;
    for (let i = 0; i < list.length; i++) {
      if (list[i] === null) continue;
      const c = compareVals(list[i], key);
      if (t > 0 ? c <= 0 : c >= 0) hit = i; else break;
    }
    if (hit < 0) throw E.na;
    return hit + 1;
  });
  // INDICE devuelve una referencia (fila o columna 0 = completa) para poder usarse dentro de SUMA, etc.
  def('INDEX INDICE', ([rng, r, c]) => {
    // sobre una matriz calculada (=INDICE(ORDENAR(A1:B9);1;2)): elemento, fila o columna (0 = completa)
    if (isMat(rng)) {
      const H = rng.length, W = rng[0].length;
      let ri = Math.trunc(N(r)), cj = given(c) ? Math.trunc(N(c)) : 1;
      if (H === 1 && !given(c)) { cj = ri; ri = 1; }
      if (ri < 0 || cj < 0 || ri > H || cj > W) throw E.ref;
      if (ri && cj) return out(rng[ri - 1][cj - 1]);
      if (ri) return [rng[ri - 1].slice()];
      return cj ? rng.map(row => [row[cj - 1]]) : rng;
    }
    const g = needRange(rng), H = g.r2 - g.r1 + 1, W = g.c2 - g.c1 + 1;
    let ri = Math.trunc(N(r)), cj = given(c) ? Math.trunc(N(c)) : 1;
    if (H === 1 && !given(c)) { cj = ri; ri = 1; }
    if (ri < 0 || cj < 0 || ri > H || cj > W) throw E.ref;
    const full = (g.full === 'col' && !ri) || (g.full === 'row' && !cj) ? g.full : false;
    return { ...g, r1: ri ? g.r1 + ri - 1 : g.r1, r2: ri ? g.r1 + ri - 1 : g.r2, c1: cj ? g.c1 + cj - 1 : g.c1, c2: cj ? g.c1 + cj - 1 : g.c2, full };
  });
  def('XLOOKUP BUSCARX', ([val, la, ra, nf, mm, sm]) => {
    const g = needRange(la), rg = needRange(ra);
    const vert = g.c1 === g.c2;
    if (!vert && g.r1 !== g.r2) throw E.value;
    const n = vert ? g.r2 - g.r1 : g.c2 - g.c1;
    if ((vert ? rg.r2 - rg.r1 : rg.c2 - rg.c1) !== n) throw E.value;
    const list = g.eng.rangeValues(g).flat(), key = scalar(val);
    const mode = given(mm) ? Math.trunc(N(mm)) : 0, smode = given(sm) ? Math.trunc(N(sm)) : 1;
    if (![0, -1, 1, 2].includes(mode) || ![1, -1, 2, -2].includes(smode)) throw E.value;
    const re = mode === 2 && typeof key === 'string' ? wildRe(key) : null;
    let hit = -1, best = -1;
    for (let k = 0; k < list.length; k++) {
      const i = smode < 0 ? list.length - 1 - k : k, v = list[i];
      if (v === null || v instanceof FErr) continue;
      if (re ? typeof v === 'string' && re.test(v) : eqVal(v, key)) { hit = i; break; }
      if ((mode === 1 || mode === -1) && rank(v) === rank(key)) {
        const c = compareVals(v, key);
        if ((mode === -1 ? c < 0 : c > 0) && (best < 0 || compareVals(v, list[best]) * mode < 0)) best = i;
      }
    }
    if (hit < 0) hit = best;
    if (hit < 0) { if (given(nf)) return nf; throw E.na; }
    return vert ? { ...rg, r1: rg.r1 + hit, r2: rg.r1 + hit, full: rg.full === 'row' ? 'row' : false }
      : { ...rg, c1: rg.c1 + hit, c2: rg.c1 + hit, full: rg.full === 'col' ? 'col' : false };
  });
  // INDIRECTO: texto → referencia. A1 (por omisión) o F1C1/R1C1 si a1 es FALSO (también vacío o celda vacía).
  // Acepta hoja ('Hoja 2'!A1), rangos, A:A y 1:1; en F1C1, F[1]C[-1] es relativo a la celda de la fórmula.
  // Texto inválido, hoja inexistente o fuera de la hoja → #REF!. Como el motor recalcula todo tras cada
  // cambio (recalc() vacía la caché), la dependencia dinámica se actualiza sola.
  const SHEET_PFX = new RegExp(`^(?:'((?:[^']|'')+)'|(${NAME}))!`);
  const A1_BODY = new RegExp(`^${REFBODY}$`);
  const RC_PART = /^(?:([RF])(\d+|\[[+-]?\d+\])?)?(?:(C)(\d+|\[[+-]?\d+\])?)?$/i;
  function rcPart(s, cx) {
    const m = RC_PART.exec(s);
    if (!m || (!m[1] && !m[3])) return null;
    const v = (t, base) => t === undefined ? base : t[0] === '[' ? base + +t.slice(1, -1) : +t - 1;
    return { r: m[1] ? v(m[2], cx.r) : null, c: m[3] ? v(m[4], cx.c) : null };
  }
  def('INDIRECT INDIRECTO', ([txt, a1], cx, eng) => {
    let s = T(txt).trim(), sheet;
    const sm = SHEET_PFX.exec(s);
    if (sm) { sheet = sm[1] != null ? sm[1].replace(/''/g, "'") : sm[2]; s = s.slice(sm[0].length); }
    const si = sheet === undefined ? cx.si : eng.sheetIndex(sheet);
    if (si < 0) throw E.ref;
    if (a1 === undefined || truthy(scalar(a1))) {
      // INDIRECTO("A1#"): el rango desbordado desde A1
      const sp = /^(\$?[A-Za-z]{1,3}\$?\d+)#$/.exec(s);
      if (sp) return eng.refRange({ a: sp[1], spill: true, sheet: sheet === undefined ? null : sheet }, cx.si);
      const m = A1_BODY.exec(s);
      if (m) return eng.refRange(refTok(m, 1), si);
      // INDIRECTO("Ventas") o "Hoja2!Ventas": nombre definido que se refiere a un rango; si no, #REF!
      if (/^\\?[A-Za-z_À-ſ][\w.À-ſ]*$|^\\$/.test(s)) {
        let g = null;
        try { g = eng.evalName(s, si); } catch (e) { if (!(e instanceof FErr)) throw e; }
        if (g && g.range) return g;
      }
      throw E.ref;
    }
    const ps = s.split(':');
    if (ps.length > 2) throw E.ref;
    const [p, q = p] = ps.map(x => rcPart(x, cx));
    if (!p || !q || (p.r === null) !== (q.r === null) || (p.c === null) !== (q.c === null)) throw E.ref;
    let r1 = p.r, r2 = q.r, c1 = p.c, c2 = q.c, full = false;
    if (r1 === null) { r1 = 0; r2 = MAXR - 1; full = 'col'; }
    else if (c1 === null) { c1 = 0; c2 = MAXC - 1; full = 'row'; }
    if (r1 > r2) [r1, r2] = [r2, r1];
    if (c1 > c2) [c1, c2] = [c2, c1];
    if (r1 < 0 || c1 < 0 || r2 >= MAXR || c2 >= MAXC) throw E.ref;
    return { range: true, eng, si, r1, c1, r2, c2, full };
  });
  // DESREF: desplaza `ref` filas/columnas (negativas: arriba/izquierda) y le da alto×ancho (omitidos o
  // vacíos → los de ref). Alto o ancho negativos extienden hacia arriba/izquierda (no documentado, pero
  // Excel lo acepta); 0 o fuera de la hoja → #REF!. Devuelve una referencia usable en SUMA, PROMEDIO, etc.
  def('OFFSET DESREF', ([ref, rows, cols, h, w]) => {
    const g = needRange(ref);
    if (rows === undefined || cols === undefined) throw E.value;
    const dr = Math.trunc(N(rows)), dc = Math.trunc(N(cols));
    const H = given(h) ? Math.trunc(N(h)) : g.r2 - g.r1 + 1, W = given(w) ? Math.trunc(N(w)) : g.c2 - g.c1 + 1;
    if (!H || !W) throw E.ref;
    const r0 = g.r1 + dr, c0 = g.c1 + dc;
    const r1 = H > 0 ? r0 : r0 + H + 1, r2 = H > 0 ? r0 + H - 1 : r0;
    const c1 = W > 0 ? c0 : c0 + W + 1, c2 = W > 0 ? c0 + W - 1 : c0;
    if (r1 < 0 || c1 < 0 || r2 >= MAXR || c2 >= MAXC) throw E.ref;
    const full = r1 === 0 && r2 === MAXR - 1 ? 'col' : c1 === 0 && c2 === MAXC - 1 ? 'row' : false;
    return { ...g, r1, c1, r2, c2, full };
  });
  // Funciones volátiles en Excel (se recalculan ante cualquier cambio). Hoy el motor recalcula todo en cada
  // cambio, así que se cumple; la lista queda para un futuro grafo de dependencias.
  const VOLATILE = new Set(['INDIRECT', 'OFFSET', 'RAND', 'RANDBETWEEN', 'NOW', 'TODAY', 'RANDARRAY']);
  // FILA/COLUMNA: de un rango de varias filas (columnas) devuelven la matriz de números (=FILA(A1:A3) → {1;2;3});
  // A:A (en FILA) y 1:1 (en COLUMNA) se acotan al área usada; no leen valores (=FILA(4:6) en E4 no es circular)
  def('ROW FILA', ([g], cx) => {
    if (g && g.range) { const r2 = g.full === 'col' ? g.eng.bounds(g).r2 : g.r2; return r2 > g.r1 ? Array.from({ length: r2 - g.r1 + 1 }, (_, i) => [g.r1 + i + 1]) : g.r1 + 1; }
    if (g == null) return cx.r + 1;
    throw E.value;
  });
  def('COLUMN COLUMNA', ([g], cx) => {
    if (g && g.range) { const c2 = g.full === 'row' ? g.eng.bounds(g).c2 : g.c2; return c2 > g.c1 ? [Array.from({ length: c2 - g.c1 + 1 }, (_, j) => g.c1 + j + 1)] : g.c1 + 1; }
    if (g == null) return cx.c + 1;
    throw E.value;
  });
  // Valores de un rango para SUBTOTALES/AGREGAR según lo que se ignora: o.hidden (filas ocultas a mano),
  // o.filtered (filas filtradas), o.nested (regex: celdas con SUBTOTALES/AGREGAR anidados), o.errors.
  // Solo se miran filas: las columnas ocultas nunca se excluyen (pensadas para rangos verticales).
  function visibleVals(g, o) {
    needRange(g);
    const eng = g.eng, sh = eng.wb.sheets[g.si], { r2, c2 } = eng.bounds(g), vals = [];
    for (let r = g.r1; r <= r2; r++) {
      if (o.hidden || o.filtered) { const st = eng.rowState(g.si, r); if ((o.hidden && st.hidden) || (o.filtered && st.filtered)) continue; }
      for (let c = g.c1; c <= c2; c++) {
        const cell = sh && sh.cells[addr(r, c)];
        if (o.nested && cell && isFormula(cell.v) && o.nested.test(cell.v)) continue;
        const v = eng.value(g.si, r, c);
        if (o.errors && v instanceof FErr) continue;
        vals.push(v);
      }
    }
    return { arr: true, vals };
  }
  // SUBTOTALES: 1–11 excluyen las filas filtradas; 101–111 excluyen además las ocultas a mano.
  // Ignora otras SUBTOTALES dentro de las referencias (evita contar dos veces).
  const SUBT = [null, 'AVERAGE', 'COUNT', 'COUNTA', 'MAX', 'MIN', 'PRODUCT', 'STDEV', 'STDEVP', 'SUM', 'VAR', 'VARP'];
  const SUBT_RE = /\bSUBTOTAL(?:ES)?\s*\(/i, AGG_RE = /\b(?:SUBTOTAL(?:ES)?|AGGREGATE|AGREGAR)\s*\(/i;
  def('SUBTOTAL SUBTOTALES', ([k, ...refs]) => {
    const n = Math.trunc(N(k)), f = SUBT[n > 100 ? n - 100 : n];
    if (!f || (n > 11 && n < 101) || n > 111 || !refs.length) throw E.value;
    return FN[f].fn(refs.map(g => visibleVals(g, { filtered: true, hidden: n > 100, nested: SUBT_RE })));
  });
  // AGREGAR(función 1–19; opciones 0–7; ref1; …) o (14–19; opciones; matriz; k). Opciones: 0–3 ignoran
  // SUBTOTALES/AGREGAR anidados; 1, 3, 5 y 7 las filas ocultas (a mano o filtradas); 2, 3, 6 y 7 los errores.
  // Falta k en 14–19 → #VALUE!. Solo forma de referencia: una matriz calculada da #VALUE!.
  const AGG = [null, 'AVERAGE', 'COUNT', 'COUNTA', 'MAX', 'MIN', 'PRODUCT', 'STDEV.S', 'STDEV.P', 'SUM', 'VAR.S', 'VAR.P',
    'MEDIAN', 'MODE.SNGL', 'LARGE', 'SMALL', 'PERCENTILE.INC', 'QUARTILE.INC', 'PERCENTILE.EXC', 'QUARTILE.EXC'];
  def('AGGREGATE AGREGAR', ([fn, opt, ...refs]) => {
    const n = Math.trunc(N(fn)), o = given(opt) ? Math.trunc(N(opt)) : 0, f = AGG[n];
    if (!f || o < 0 || o > 7 || !refs.length) throw E.value;
    const hid = o % 2 === 1, skip = { hidden: hid, filtered: hid, errors: [2, 3, 6, 7].includes(o), nested: o <= 3 ? AGG_RE : null };
    if (n >= 14) {
      if (refs.length < 2 || !given(refs[1])) throw E.value;
      return FN[f].fn([visibleVals(refs[0], skip), refs[1]]);
    }
    return FN[f].fn(refs.map(g => visibleVals(g, skip)));
  });

  // ---------- Funciones de matrices dinámicas ----------
  // Argumentos opcionales (L-008): omitido o vacío (;;) → valor por omisión; una celda vacía vale 0 (o FALSO).
  // Filas/columnas: truncadas; 0 → #CALC! (matriz vacía); negativas → #VALUE!
  const dimArg = (x, d) => { if (!given(x)) return d; const n = Math.trunc(N(x)); if (n < 0) throw E.value; if (n === 0) throw E.calc; return n; };
  const flag = x => given(x) && truthy(scalar(x));
  // SECUENCIA(filas; [columnas]; [inicio]; [incremento]) — se llena por filas
  def('SEQUENCE SECUENCIA', ([r, c, s, st]) => {
    const R = dimArg(r, 1), C = dimArg(c, 1), S = given(s) ? N(s) : 1, P = given(st) ? N(st) : 1;
    guardSize(R * C);
    return Array.from({ length: R }, (_, i) => Array.from({ length: C }, (_, j) => S + (i * C + j) * P));
  });
  // MATRIZALEAT([filas]; [columnas]; [mín]; [máx]; [entero]) — mín debe ser menor que máx (si no, #VALUE!)
  def('RANDARRAY MATRIZALEAT', ([r, c, lo, hi, whole]) => {
    const R = dimArg(r, 1), C = dimArg(c, 1), L = given(lo) ? N(lo) : 0, H = given(hi) ? N(hi) : 1, I = flag(whole);
    if (L >= H) throw E.value;
    guardSize(R * C);
    const a = Math.ceil(L), b = Math.floor(H);
    if (I && a > b) throw E.value;
    const rnd = I ? () => a + Math.floor(Math.random() * (b - a + 1)) : () => L + Math.random() * (H - L);
    return Array.from({ length: R }, () => Array.from({ length: C }, rnd));
  });
  // Clave de igualdad de UNICOS: sin distinguir mayúsculas (como Excel), con tipo; vacío ≠ 0
  const vkey = v => v === null || v === undefined ? 'z' : typeof v === 'number' ? 'n' + (v === 0 ? 0 : v) : typeof v === 'string' ? 's' + v.toLowerCase().normalize('NFC')
    : typeof v === 'boolean' ? 'b' + v : v instanceof FErr ? 'e' + v.code : 'o' + String(v);
  // UNICOS(matriz; [por_columna]; [exactamente_una_vez]) — conserva el orden de la primera aparición; sin resultados → #CALC!
  def('UNIQUE UNICOS', ([a, bc, once]) => {
    const byCol = flag(bc), exact = flag(once);
    let m = toMat(a);
    if (byCol) m = transpose(m);
    const cnt = new Map(), first = [];
    for (const row of m) {
      const k = row.map(vkey).join('\u0001');
      if (!cnt.has(k)) { cnt.set(k, 0); first.push([k, row]); }
      cnt.set(k, cnt.get(k) + 1);
    }
    const res = first.filter(([k]) => !exact || cnt.get(k) === 1).map(x => x[1].slice());
    if (!res.length) throw E.calc;
    return byCol ? transpose(res) : res;
  });
  // FILTRAR(matriz; incluir; [si_vacío]) — incluir: columna del alto de la matriz (filtra filas) o fila de su ancho
  // (filtra columnas); otro tamaño → #VALUE!; texto en incluir → #VALUE!; vacío = FALSO. Sin resultados: si_vacío
  // omitido → #CALC!; vacío (;;) → 0; si no, su valor (puede ser una matriz)
  def('FILTER FILTRAR', ([a, inc, ifEmpty]) => {
    const m = toMat(a), k = toMat(inc), H = m.length, W = m[0].length;
    let byRow;
    if (k[0].length === 1 && k.length === H) byRow = true;
    else if (k.length === 1 && k[0].length === W) byRow = false;
    else throw E.value;
    const keep = (byRow ? k.map(row => row[0]) : k[0]).map(v => {
      if (v instanceof FErr) throw v;
      if (v === null) return false;
      if (typeof v === 'string') throw E.value;
      return toNum(v) !== 0;
    });
    const res = byRow ? m.filter((_, i) => keep[i]).map(row => row.slice()) : m.map(row => row.filter((_, j) => keep[j]));
    if (!res.length || !res[0].length) {
      if (ifEmpty === undefined) throw E.calc;
      return ifEmpty === null ? 0 : ifEmpty;
    }
    return res;
  });
  // Orden de ORDENAR/ORDENARPOR: números < texto (colación es-CL) < lógicos < errores; las vacías siempre al final
  const sortCmp = (a, b, o) => {
    const ea = a === null || a === undefined, eb = b === null || b === undefined;
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
    return compareVals(a, b) * o;
  };
  // Ordena las filas de m según claves [[vector, orden]] (orden estable, como Excel)
  const sortBy = (m, keys) => m.map((row, i) => i)
    .sort((x, y) => { for (const [vec, o] of keys) { const c = sortCmp(vec[x], vec[y], o); if (c) return c; } return x - y; })
    .map(i => m[i].slice());
  const sortOrder = x => { const o = toNum(x); if (o !== 1 && o !== -1) throw E.value; return o; };
  // ORDENAR(matriz; [índice]; [orden]; [por_columna]) — índice y orden admiten matrices ({1\2}) para varios niveles
  def('SORT ORDENAR', ([a, idx, ord, bc]) => {
    const byCol = flag(bc);
    let m = toMat(a);
    if (byCol) m = transpose(m);
    const ids = given(idx) ? toMat(idx).flat().map(x => Math.trunc(toNum(x))) : [1];
    const ords = given(ord) ? toMat(ord).flat().map(sortOrder) : [1];
    if (ids.some(i => i < 1 || i > m[0].length)) throw E.value;
    if (ords.length > 1 && ords.length !== ids.length) throw E.value;
    const res = sortBy(m, ids.map((i, k) => [m.map(row => row[i - 1]), ords.length > 1 ? ords[k] : ords[0]]));
    return byCol ? transpose(res) : res;
  });
  // ORDENARPOR(matriz; por_matriz1; [orden1]; …) — cada por_matriz es una columna del alto de la matriz (ordena filas)
  // o una fila de su ancho (ordena columnas), todas en el mismo sentido; si no → #VALUE!
  def('SORTBY ORDENARPOR', ([a, ...rest]) => {
    const m = toMat(a), H = m.length, W = m[0].length;
    if (!rest.length) throw E.value;
    let dir = null;
    const keys = [];
    for (let i = 0; i < rest.length; i += 2) {
      if (!given(rest[i])) throw E.value;
      const b = toMat(rest[i]), o = given(rest[i + 1]) ? sortOrder(scalar(rest[i + 1])) : 1;
      let d, vec;
      if (b[0].length === 1 && b.length === H) { d = 'r'; vec = b.map(row => row[0]); }
      else if (b.length === 1 && b[0].length === W) { d = 'c'; vec = b[0]; }
      else throw E.value;
      if (dir && d !== dir) throw E.value;
      dir = d; keys.push([vec, o]);
    }
    return dir === 'c' ? transpose(sortBy(transpose(m), keys)) : sortBy(m, keys);
  });
  // MODA.VARIOS: matriz vertical con todos los valores más repetidos, en el orden de su primera aparición
  def('MODE.MULT MODA.VARIOS', a => {
    const v = nums(a), cnt = new Map();
    for (const x of v) cnt.set(x, (cnt.get(x) || 0) + 1);
    const top = Math.max(0, ...cnt.values());
    if (top < 2) throw E.na;
    const seen = new Set(), res = [];
    for (const x of v) if (cnt.get(x) === top && !seen.has(x)) { seen.add(x); res.push([x]); }
    return res;
  });
  // APILARV / APILARH: apilan matrices; lo que falta para completar el ancho (alto) se rellena con #N/A
  def('VSTACK APILARV', a => {
    const ms = a.map(toMat), W = Math.max(...ms.map(m => m[0].length)), res = [];
    for (const m of ms) for (const row of m) res.push(row.concat(Array(W - row.length).fill(E.na)));
    guardSize(res.length * W);
    return res;
  });
  def('HSTACK APILARH', a => {
    const ms = a.map(toMat), H = Math.max(...ms.map(m => m.length)), res = [];
    for (let i = 0; i < H; i++) res.push([].concat(...ms.map(m => i < m.length ? m[i] : Array(m[0].length).fill(E.na))));
    guardSize(H * res[0].length);
    return res;
  });
  // TOMAR / EXCLUIR(matriz; filas; [columnas]): positivo = desde el inicio, negativo = desde el final;
  // vacío u omitido = todas (TOMAR) o ninguna (EXCLUIR); TOMAR 0 o un resultado vacío → #CALC!
  const countArg = x => given(x) ? Math.trunc(N(x)) : null;
  const takeN = (list, n) => n === null ? list : n > 0 ? list.slice(0, n) : list.slice(Math.max(0, list.length + n));
  const dropN = (list, n) => n === null || n === 0 ? list : n > 0 ? list.slice(n) : list.slice(0, Math.max(0, list.length + n));
  def('TAKE TOMAR', ([a, r, c]) => {
    const R = countArg(r), C = countArg(c);
    if (R === 0 || C === 0) throw E.calc;
    return takeN(toMat(a), R).map(row => takeN(row, C));
  });
  def('DROP EXCLUIR', ([a, r, c]) => {
    const res = dropN(toMat(a), countArg(r)).map(row => dropN(row, countArg(c)));
    if (!res.length || !res[0].length) throw E.calc;
    return res;
  });
  // ELEGIRCOLS / ELEGIRFILAS(matriz; n1; …): negativos desde el final; 0 o fuera de la matriz → #VALUE!
  const pick = (ns, len) => {
    if (!ns.length) throw E.value;
    return ns.flatMap(x => toMat(x).flat()).map(v => {
      const k = Math.trunc(toNum(v)), j = k > 0 ? k - 1 : len + k;
      if (!k || j < 0 || j >= len) throw E.value;
      return j;
    });
  };
  def('CHOOSECOLS ELEGIRCOLS', ([a, ...ns]) => { const m = toMat(a), idx = pick(ns, m[0].length); return m.map(row => idx.map(j => row[j])); });
  def('CHOOSEROWS ELEGIRFILAS', ([a, ...ns]) => { const m = toMat(a), idx = pick(ns, m.length); return idx.map(i => m[i].slice()); });
  def('TRANSPOSE TRANSPONER', ([a]) => transpose(toMat(a)));

  // Financieras: tasa, nper, va/pago, [vf], [tipo]
  const pw = (r, n) => Math.pow(1 + r, n);
  // Signos de Excel: lo que se recibe es positivo y lo que se paga, negativo. tipo: 0 = al final del
  // período (omitido, vacío o celda vacía), distinto de 0 = al inicio
  const typ = t => N(t) ? 1 : 0;
  const pmtOf = (R, P, V, F, T0) => {
    if (P === 0) throw E.num;
    return R === 0 ? -(V + F) / P : -(R * (F + V * pw(R, P))) / ((1 + R * T0) * (pw(R, P) - 1));
  };
  const fvOf = (R, P, M, V, T0) => R === 0 ? -(V + M * P) : -(V * pw(R, P) + M * (1 + R * T0) * (pw(R, P) - 1) / R);
  def('PMT PAGO', ([r, n, pv, fv, t]) => pmtOf(N(r), N(n), N(pv), N(fv), typ(t)));
  def('FV VF', ([r, n, pmt, pv, t]) => fvOf(N(r), N(n), N(pmt), N(pv), typ(t)));
  def('PV VA', ([r, n, pmt, fv, t]) => {
    const R = N(r), P = N(n), M = N(pmt), F = N(fv), T0 = typ(t);
    if (R === 0) return -(F + M * P);
    return -(F + M * (1 + R * T0) * (pw(R, P) - 1) / R) / pw(R, P);
  });
  def('NPER', ([r, pmt, pv, fv, t]) => {
    const R = N(r), M = N(pmt), V = N(pv), F = N(fv), T0 = typ(t);
    if (R === 0) { if (M === 0) throw E.num; return -(V + F) / M; }
    const a = M * (1 + R * T0), x = (a - F * R) / (a + V * R);
    if (!(x > 0) || R <= -1) throw E.num;
    return Math.log(x) / Math.log(1 + R);
  });
  // PAGOINT: interés del período `per` = saldo al inicio del período × tasa (con tipo 1, descontado un período)
  function ipmtOf(R, per, P, V, F, T0) {
    if (per < 1 || per > P) throw E.num;
    if (R === 0 || (per === 1 && T0)) return 0;
    const ip = fvOf(R, per - 1, pmtOf(R, P, V, F, T0), V, T0) * R;
    return T0 ? ip / (1 + R) : ip;
  }
  def('IPMT PAGOINT', ([r, per, n, pv, fv, t]) => ipmtOf(N(r), N(per), N(n), N(pv), N(fv), typ(t)));
  def('PPMT PAGOPRIN', ([r, per, n, pv, fv, t]) => {
    const R = N(r), k = N(per), P = N(n), V = N(pv), F = N(fv), T0 = typ(t);
    const ip = ipmtOf(R, k, P, V, F, T0);
    return pmtOf(R, P, V, F, T0) - ip;
  });
  // Newton-Raphson desde la estimación; sin convergencia (o tasa ≤ -100 %) → #NUM!
  function newton(f, df, x0) {
    let x = x0;
    for (let i = 0; i < 100; i++) {
      const y = f(x), d = df(x);
      if (!isFinite(y) || !isFinite(d) || d === 0) break;
      const nx = x - y / d;
      if (!isFinite(nx) || nx <= -1) break;
      if (Math.abs(nx - x) < 1e-12 * Math.max(1, Math.abs(nx))) return nx;
      x = nx;
    }
    throw E.num;
  }
  const guessOf = g => g === undefined ? 0.1 : N(g); // estimación omitida → 10 %; vacía → 0
  def('RATE TASA', ([n, pmt, pv, fv, t, g]) => {
    const P = N(n), M = N(pmt), V = N(pv), F = N(fv), T0 = typ(t), x0 = guessOf(g);
    if (P <= 0) throw E.num;
    // (1+r)^n - 1 con expm1/log1p: sin cancelación cuando la tasa es cercana a 0
    const am1 = r => Math.expm1(P * Math.log1p(r));
    const f = r => {
      if (Math.abs(r) < 1e-12) return V + M * P + F;
      const A1 = am1(r);
      return V * (A1 + 1) + M * (1 + r * T0) * A1 / r + F;
    };
    const df = r => {
      if (Math.abs(r) < 1e-12) return V * P + M * (P * (P - 1) / 2 + T0 * P);
      const A1 = am1(r), dA = P * pw(r, P - 1);
      return V * dA + M * (T0 * A1 / r + (1 + r * T0) * (dA * r - A1) / (r * r));
    };
    return newton(f, df, x0);
  });
  // VNA: flujos al final de los períodos 1..n; en rangos solo cuentan los números (como SUMA)
  def('NPV VNA', ([r, ...vals]) => {
    const R = N(r);
    if (R === -1) throw E.div0;
    return nums(vals).reduce((s, v, i) => s + v / pw(R, i + 1), 0);
  });
  // TIR: flujos en los períodos 0..n-1; exige al menos un valor positivo y uno negativo
  def('IRR TIR', ([vals, g]) => {
    const v = nums([vals]);
    if (!v.some(x => x > 0) || !v.some(x => x < 0)) throw E.num;
    return newton(r => v.reduce((s, x, i) => s + x / pw(r, i), 0), r => v.reduce((s, x, i) => s - i * x / pw(r, i + 1), 0), guessOf(g));
  });
  // Flujos con fecha (VNA.NO.PER / TIR.NO.PER): misma cantidad de valores y fechas (si no, #NUM!);
  // valores o fechas no numéricos → #VALUE!; una fecha anterior a la primera → #NUM!. Fechas truncadas.
  function datedFlows(vals, dates) {
    const vs = flatten([vals]).map(x => x.v), ds = flatten([dates]).map(x => x.v);
    if (vs.length !== ds.length) throw E.num;
    const num = x => { if (x instanceof FErr) throw x; if (typeof x !== 'number') throw E.value; return x; };
    const V = vs.map(num), D = ds.map(x => { const d = Math.trunc(num(x)); if (d < 0 || d > 2958465) throw E.value; return d; });
    if (D.some(d => d < D[0])) throw E.num;
    return { V, Y: D.map(d => (d - D[0]) / 365) };
  }
  def('XNPV VNA.NO.PER', ([r, vals, dates]) => {
    const R = N(r), { V, Y } = datedFlows(vals, dates);
    if (R <= -1) throw E.num;
    return V.reduce((s, v, i) => s + v / pw(R, Y[i]), 0);
  });
  def('XIRR TIR.NO.PER', ([vals, dates, g]) => {
    const { V, Y } = datedFlows(vals, dates);
    if (!V.some(x => x > 0) || !V.some(x => x < 0)) throw E.num;
    return newton(r => V.reduce((s, v, i) => s + v / pw(r, Y[i]), 0), r => V.reduce((s, v, i) => s - Y[i] * v / pw(r, Y[i] + 1), 0), guessOf(g));
  });

  // ---------- TEXTO: formatos numéricos y de fecha con convención es-CL (',' decimal, '.' miles) ----------
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const pad = (n, k) => String(n).padStart(k, '0');
  function fmtParts(sec) {
    const parts = [];
    for (let i = 0; i < sec.length; i++) {
      const ch = sec[i];
      if (ch === '"') { const j = sec.indexOf('"', i + 1), e = j < 0 ? sec.length : j; parts.push({ lit: sec.slice(i + 1, e) }); i = e; }
      else if (ch === '\\') parts.push({ lit: sec[++i] || '' });
      else if (ch === '_') { parts.push({ lit: ' ' }); i++; }
      else if (ch === '*') i++;
      else if (ch === '[') { const j = sec.indexOf(']', i); i = j < 0 ? sec.length : j; }
      else parts.push({ ch });
    }
    return parts;
  }
  function fmtDate(v, parts) {
    if (v < 0) throw E.value;
    const d = serialDate(v);
    const toks = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.lit !== undefined) { toks.push({ lit: p.lit }); continue; }
      const rest = parts.slice(i, i + 5).map(x => x.ch || '\0').join('');
      if (/^am\/pm/i.test(rest)) { toks.push({ k: 'ampm' }); i += 4; continue; }
      const L = p.ch.toLowerCase();
      if (!'dmyahs'.includes(L)) { toks.push({ lit: p.ch }); continue; }
      let n = 1;
      while (parts[i + 1] && parts[i + 1].ch && parts[i + 1].ch.toLowerCase() === L) { n++; i++; }
      toks.push({ k: L === 'a' ? 'y' : L, n });
    }
    const ampm = toks.some(t => t.k === 'ampm');
    const timeIdx = toks.map((t, i) => t.k && t.k !== 'ampm' ? i : -1).filter(i => i >= 0);
    let h = d.getUTCHours();
    return toks.map((t, i) => {
      if (t.lit !== undefined) return t.lit;
      const n = t.n;
      switch (t.k) {
        case 'ampm': return h < 12 ? 'AM' : 'PM';
        case 'd': return n === 1 ? d.getUTCDate() : n === 2 ? pad(d.getUTCDate(), 2) : n === 3 ? DIAS[d.getUTCDay()].slice(0, 3) : DIAS[d.getUTCDay()];
        case 'y': return n <= 2 ? pad(d.getUTCFullYear() % 100, 2) : d.getUTCFullYear();
        case 'h': { const hh = ampm ? (h % 12 || 12) : h; return n === 1 ? hh : pad(hh, 2); }
        case 's': return n === 1 ? d.getUTCSeconds() : pad(d.getUTCSeconds(), 2);
        case 'm': {
          const k = timeIdx.indexOf(i), prev = toks[timeIdx[k - 1]], next = toks[timeIdx[k + 1]];
          if (n <= 2 && ((prev && prev.k === 'h') || (next && next.k === 's'))) return n === 1 ? d.getUTCMinutes() : pad(d.getUTCMinutes(), 2);
          const m = d.getUTCMonth();
          return n === 1 ? m + 1 : n === 2 ? pad(m + 1, 2) : n === 3 ? MESES[m].slice(0, 3) : n === 4 ? MESES[m] : MESES[m][0];
        }
      }
      return '';
    }).join('');
  }
  function fmtNum(v, parts, sign) {
    const isPh = p => p.ch && '0#?'.includes(p.ch);
    const first = parts.findIndex(isPh);
    const txt = ps => ps.map(p => p.lit !== undefined ? p.lit : p.ch).join('');
    if (first < 0) return (sign ? '-' : '') + txt(parts);
    let last = parts.length - 1;
    while (!isPh(parts[last])) last--;
    // separadores pegados al último marcador (p. ej. "0," o "#.##0.") pertenecen al núcleo
    while (parts[last + 1] && parts[last + 1].ch && '.,'.includes(parts[last + 1].ch)) last++;
    const pre = parts.slice(0, first), post = parts.slice(last + 1);
    const core = parts.slice(first, last + 1).filter(p => p.ch && '0#?.,'.includes(p.ch)).map(p => p.ch).join('');
    const pct = [...pre, ...post].filter(p => p.ch === '%').length;
    const ci = core.indexOf(',');
    let ip = ci < 0 ? core : core.slice(0, ci);
    const dp = ci < 0 ? '' : core.slice(ci + 1).replace(/[.,]/g, '');
    let scale = 1;
    const tr = /\.+$/.exec(ip);
    if (tr) { scale = Math.pow(1000, tr[0].length); ip = ip.slice(0, -tr[0].length); }
    const thou = ip.includes('.'), minInt = (ip.match(/0/g) || []).length;
    const dMax = dp.length, dMin = (dp.match(/0/g) || []).length;
    const x = roundTo(Math.abs(v) * Math.pow(100, pct) / scale, dMax);
    let [is, fs = ''] = x.toFixed(dMax).split('.');
    while (fs.length > dMin && fs.endsWith('0')) fs = fs.slice(0, -1);
    if (is === '0' && minInt === 0) is = '';
    is = is.padStart(minInt, '0');
    if (thou) is = is.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (sign ? '-' : '') + txt(pre) + is + (ci >= 0 ? ',' + fs : '') + txt(post);
  }
  function formatText(v, f) {
    if (v instanceof FErr) throw v;
    if (typeof v === 'string') { const x = literal(v); if (typeof x !== 'number') return v; v = x; }
    if (typeof v === 'boolean') return toStr(v);
    if (v === null) v = 0;
    const secs = [];
    let cur = '', q = false;
    for (const ch of f) { if (ch === '"') q = !q; if (ch === ';' && !q) { secs.push(cur); cur = ''; } else cur += ch; }
    secs.push(cur);
    let sec = secs[0], sign = v < 0;
    if (v < 0 && secs.length > 1) { sec = secs[1]; sign = false; v = -v; }
    else if (v === 0 && secs.length > 2) sec = secs[2];
    if (/^\s*(general|estándar|estandar)\s*$/i.test(sec)) return toStr(v).replace('.', ',');
    const parts = fmtParts(sec);
    if (parts.some(p => p.ch && /[dmyahs]/i.test(p.ch))) return fmtDate(v, parts);
    return fmtNum(v, parts, sign);
  }

  // ---------- Reescritura de referencias (copiar/pegar, insertar/eliminar filas, renombrar hojas) ----------
  // Grupos: 1 hoja!, 2-9 celda[:celda], 10-13 columnas (A:B), 14-17 filas (1:2), 18 "#" de rango desbordado (A1#)
  // El lookbehind excluye también "\" para no tomar el nombre definido \A1 como la referencia A1.
  const REF_RE = new RegExp(`(?<![\\w.$'!\\\\])((?:'(?:[^']|'')+'|${NAME})!)?(?:(\\$?)([A-Za-z]{1,3})(\\$?)(\\d+)(?::(\\$?)([A-Za-z]{1,3})(\\$?)(\\d+))?|(\\$?)([A-Za-z]{1,3}):(\\$?)([A-Za-z]{1,3})|(\\$?)(\\d+):(\\$?)(\\d+))(#(?![\\w¡¿]))?(?![\\w(.!])`, 'g');
  const mkRef = (ca, c, ra, r) => ({ ca: !!ca, c: colIndex(c), ra: !!ra, r: +r - 1 });
  // Columna completa: a/b con kind 'col' (r = 0 y MAXR-1); fila completa: kind 'row' (c = 0 y MAXC-1)
  function refOf(m) {
    const sp = m[1] || '', sheet = m[1] ? unquote(m[1].slice(0, -1)) : null;
    // spill: A1# (solo una celda); quien reescribe la referencia no lo agrega: lo conserva mapRefs
    if (m[3]) return { sheet, sp, a: mkRef(m[2], m[3], m[4], m[5]), b: m[7] ? mkRef(m[6], m[7], m[8], m[9]) : null, spill: !!m[18] && !m[7] };
    if (m[11]) return { sheet, sp, a: { ca: !!m[10], c: colIndex(m[11]), ra: false, r: 0, kind: 'col' }, b: { ca: !!m[12], c: colIndex(m[13]), ra: false, r: MAXR - 1, kind: 'col' } };
    return { sheet, sp, a: { ca: false, c: 0, ra: !!m[14], r: +m[15] - 1, kind: 'row' }, b: { ca: false, c: MAXC - 1, ra: !!m[16], r: +m[17] - 1, kind: 'row' } };
  }
  const refText = p => p.kind === 'col' ? (p.ca ? '$' : '') + colName(p.c)
    : p.kind === 'row' ? (p.ra ? '$' : '') + (p.r + 1)
    : (p.ca ? '$' : '') + colName(p.c) + (p.ra ? '$' : '') + (p.r + 1);
  const refBody = (a, b) => refText(a) + (b ? ':' + refText(b) : '');
  const unquote = s => s[0] === "'" ? s.slice(1, -1).replace(/''/g, "'") : s;
  const quoteSheet = n => /^[A-Za-z_À-ſ][\w.À-ſ]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) ? n : "'" + n.replace(/'/g, "''") + "'";

  function mapRefs(formula, fn) {
    return formula.split(/("(?:[^"]|"")*")/).map((seg, i) => i % 2 ? seg : seg.replace(REF_RE, (...m) => {
      const o = fn(refOf(m));
      // el "#" de A1# sigue a la referencia reescrita (salvo que quede en #REF!)
      return o == null ? m[0] : m[18] && o[0] !== '#' ? o + '#' : o;
    })).join('');
  }

  // Ubica cada referencia de una fórmula (para resaltarlas, colorearlas y alternar $ con F4).
  // En A1#, [start, end) cubre solo "A1" (F4 no toca el "#") y spill: true (la UI resalta el rango con eng.spillAt).
  function findRefs(formula) {
    const out = [];
    let offset = 0;
    formula.split(/("(?:[^"]|"")*")/).forEach((seg, i) => {
      if (i % 2 === 0) {
        const re = new RegExp(REF_RE.source, 'g');
        let m;
        while ((m = re.exec(seg))) {
          out.push({ start: offset + m.index, end: offset + m.index + m[0].length - (m[18] ? 1 : 0), ...refOf(m) });
        }
      }
      offset += seg.length;
    });
    return out;
  }

  function shiftFormula(f, dr, dc) {
    return mapRefs(f, ({ sp, a, b }) => {
      // A:A solo se desplaza en columnas y 1:1 solo en filas
      const s = p => ({ ...p, c: p.ca || p.kind === 'row' ? p.c : p.c + dc, r: p.ra || p.kind === 'col' ? p.r : p.r + dr });
      const na = s(a), nb = b && s(b);
      if (na.c < 0 || na.r < 0 || (nb && (nb.c < 0 || nb.r < 0))) return '#REF!';
      return sp + refBody(na, nb);
    });
  }

  // n > 0 inserta n filas/columnas en `at`; n < 0 elimina -n a partir de `at`
  function structural(f, home, target, axis, at, n) {
    const t = target.toLowerCase();
    return mapRefs(f, ({ sheet, sp, a, b }) => {
      if ((sheet ?? home).toLowerCase() !== t) return null;
      const k = axis;
      if ((a.kind === 'col' && k === 'r') || (a.kind === 'row' && k === 'c')) return null; // A:A no cambia al insertar filas
      if (n > 0) {
        const m = p => p[k] >= at ? { ...p, [k]: p[k] + n } : p;
        return sp + refBody(m(a), b && m(b));
      }
      const d = -n, end = at + d;
      if (!b) {
        if (a[k] >= at && a[k] < end) return '#REF!';
        return sp + refBody(a[k] >= end ? { ...a, [k]: a[k] - d } : a);
      }
      const lo = a[k] <= b[k] ? 'a' : 'b', hi = lo === 'a' ? 'b' : 'a';
      const P = { a: { ...a }, b: { ...b } };
      const s = P[lo][k], e = P[hi][k];
      const ns = s < at ? s : s >= end ? s - d : at;
      const ne = e < at ? e : e >= end ? e - d : at - 1;
      if (ne < ns) return '#REF!';
      P[lo][k] = ns; P[hi][k] = ne;
      return sp + refBody(P.a, P.b);
    });
  }

  function renameSheetInFormula(f, oldName, newName) {
    const o = oldName.toLowerCase();
    return mapRefs(f, ({ sheet, a, b }) => sheet && sheet.toLowerCase() === o ? quoteSheet(newName) + '!' + refBody(a, b) : null);
  }
  // Al eliminar una hoja, toda referencia a ella queda en #REF! (también sirve para las fórmulas de las celdas)
  function deleteSheetInFormula(f, sheetName) {
    const o = sheetName.toLowerCase();
    return mapRefs(f, ({ sheet }) => sheet && sheet.toLowerCase() === o ? '#REF!' : null);
  }

  // ---------- Nombres definidos: validación, API para la UI, reescritura y .xlsx ----------
  // Modelo: wb.names = [{ name, scope: null | 'Hoja1', ref: '=Hoja1!$A$2:$A$20', comment: '' }]. "ref" es una
  // fórmula en la sintaxis vigente (referencia, rango, constante o fórmula). Tras cualquier cambio: eng.recalc().
  const NAME_OK = /^(?:\\|[A-Za-z_À-ſ])[\w.À-ſ]*$/;
  const NAME_TOK = /^(?:\\|[A-Za-z_À-ſ])[\w.À-ſ]*/;
  const BAD_NAME = 'El nombre que escribió no es válido';
  const sameScope = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
  // Mensaje en español si el nombre no cumple las reglas de Excel, o null. `ignore`: definición que se está editando
  function nameError(wb, name, scope = null, ignore = null) {
    if (typeof name !== 'string' || name === '') return 'Escriba un nombre.';
    if (name.length > 255) return 'El nombre no puede tener más de 255 caracteres.';
    if (/\s/.test(name)) return BAD_NAME + ': no puede contener espacios.';
    if (!NAME_OK.test(name) || name === '\\') return BAD_NAME + ': debe empezar con una letra, "_" o "\\" y solo puede tener letras, números, "." y "_".';
    const u = name.toUpperCase();
    // no puede parecer una referencia: A1, XFD1048576, F1C1/R1C1 (y sus partes), C, R o F
    if (/^[A-Z]{1,3}\d+$/.test(u) || /^[RFC]$/.test(u) || /^[RF]\d*C\d*$/.test(u) || /^[RF]\d+$/.test(u) || /^C\d+$/.test(u)) {
      return BAD_NAME + ': no puede parecer una referencia de celda (como A1, F1C1 o R1C1) ni ser C, F o R.';
    }
    if (u in BOOLS) return BAD_NAME + ': no puede ser VERDADERO ni FALSO.';
    if (scope != null && !wb.sheets.some(s => s.name.toLowerCase() === String(scope).toLowerCase())) return 'La hoja del ámbito no existe.';
    if ((wb.names || []).some(d => d !== ignore && d.name.toUpperCase() === u && sameScope(d.scope, scope))) return 'Ese nombre ya existe en este ámbito. Escriba un nombre único.';
    return null;
  }
  // "Se refiere a": agrega "=", valida la fórmula y califica con `base` (hoja) las referencias sin hoja
  function normRef(ref, base) {
    let f = String(ref == null ? '' : ref).trim();
    if (f === '') return { error: 'Escriba a qué se refiere el nombre.' };
    if (f[0] !== '=') f = '=' + f;
    try { parse(tokenize(f.slice(1))); } catch (e) { return { error: 'Hay un problema con la fórmula de "Se refiere a".' }; }
    if (base) f = mapRefs(f, ({ sheet, a, b }) => sheet ? null : quoteSheet(base) + '!' + refBody(a, b));
    return { ref: f };
  }
  const scopeName = (wb, scope) => scope == null ? null : (wb.sheets.find(s => s.name.toLowerCase() === String(scope).toLowerCase()) || {}).name || null;
  const findName = (wb, name, scope) => (wb.names || []).find(d => d.name.toUpperCase() === String(name).toUpperCase() && sameScope(d.scope, scope));
  // Define un nombre. → { def } o { error: 'mensaje' }. base: hoja para calificar referencias sin hoja (la activa)
  function defineName(wb, { name, scope = null, ref, comment = '', base = null } = {}) {
    const err = nameError(wb, name, scope);
    if (err) return { error: err };
    const r = normRef(ref, base || scope);
    if (r.error) return r;
    const def = { name, scope: scopeName(wb, scope), ref: r.ref, comment: String(comment || '') };
    (wb.names || (wb.names = [])).push(def);
    return { def };
  }
  // Edita nombre, ámbito, "Se refiere a" o comentario. → { def, renamed: [viejo, nuevo] | null } o { error }.
  // Si cambia el nombre, la UI actualiza las fórmulas con renameNameInFormula (Excel lo hace automáticamente).
  function editName(wb, name, scope, changes = {}) {
    const d = findName(wb, name, scope);
    if (!d) return { error: 'El nombre no existe.' };
    const nn = changes.name !== undefined ? changes.name : d.name, ns = changes.scope !== undefined ? changes.scope : d.scope;
    const err = nameError(wb, nn, ns, d);
    if (err) return { error: err };
    let ref = d.ref;
    if (changes.ref !== undefined) { const r = normRef(changes.ref, changes.base || ns); if (r.error) return r; ref = r.ref; }
    const renamed = nn.toUpperCase() !== d.name.toUpperCase() ? [d.name, nn] : null;
    Object.assign(d, { name: nn, scope: scopeName(wb, ns), ref, comment: changes.comment !== undefined ? String(changes.comment) : d.comment });
    return { def: d, renamed };
  }
  function deleteName(wb, name, scope = null) {
    const d = findName(wb, name, scope);
    if (!d) return false;
    wb.names.splice(wb.names.indexOf(d), 1);
    return true;
  }
  // Copias ordenadas por nombre (colación es-CL) y luego libro antes que hoja
  const listNames = wb => (wb.names || []).map(d => ({ ...d })).sort((x, y) => compareText(x.name, y.name) || (x.scope ? 1 : 0) - (y.scope ? 1 : 0) || compareText(x.scope || '', y.scope || ''));

  // Reescritura (la UI las llama junto con las de las celdas). Las referencias sin hoja de un nombre de libro
  // no se ajustan (se resuelven en la hoja donde se usan); defineName las califica si recibe `base`.
  function namesStructural(wb, target, axis, at, n) {
    for (const d of wb.names || []) d.ref = structural(d.ref, d.scope || '\u0000', target, axis, at, n);
  }
  function namesRenameSheet(wb, oldName, newName) {
    for (const d of wb.names || []) {
      d.ref = renameSheetInFormula(d.ref, oldName, newName);
      if (sameScope(d.scope, oldName)) d.scope = newName;
    }
  }
  // Eliminar hoja: se borran los nombres con ese ámbito y las referencias a ella quedan en #REF!
  function namesDeleteSheet(wb, sheetName) {
    if (!wb.names) return;
    wb.names = wb.names.filter(d => !sameScope(d.scope, sheetName));
    for (const d of wb.names) d.ref = deleteSheetInFormula(d.ref, sheetName);
  }
  // Duplicar hoja: copia los nombres de ámbito de la hoja original y los apunta a la copia
  function namesDuplicateSheet(wb, src, dst) {
    for (const d of (wb.names || []).filter(x => sameScope(x.scope, src))) wb.names.push({ ...d, scope: dst, ref: renameSheetInFormula(d.ref, src, dst) });
  }
  // Ubica los nombres definidos de una fórmula (fuera de textos; no funciones, hojas, referencias ni VERDADERO/FALSO).
  // Sirve para resaltarlos, autocompletar y renombrar; tolera fórmulas a medio escribir (L-009).
  function findNames(formula) {
    const out = [], s = String(formula);
    let i = 0, m;
    while (i < s.length) {
      const ch = s[i], rest = s.slice(i), prev = s[i - 1] || '';
      if (ch === '"') { let j = i + 1; while (j < s.length) { if (s[j] === '"') { if (s[j + 1] === '"') { j += 2; continue; } break; } j++; } i = j + 1; continue; }
      if (!IDCH.test(prev) && prev !== '\\' && ((m = T_SHEETREF.exec(rest)) || (m = T_REF.exec(rest)))) { i += m[0].length; continue; }
      if (ch === "'") { let j = i + 1; while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; } j++; } i = j + 1; continue; }
      if (ch === '#' && (m = ERR_TOK.exec(rest))) { i += m[0].length; continue; }
      if (!IDCH.test(prev) && prev !== '\\' && (m = NAME_TOK.exec(rest))) {
        const id = m[0];
        let j = i + id.length;
        while (s[j] === ' ') j++;
        if (s[j] !== '(' && s[j] !== '!' && !(id.toUpperCase() in BOOLS)) out.push({ start: i, end: i + id.length, name: id });
        i += id.length; continue;
      }
      i++;
    }
    return out;
  }
  function renameNameInFormula(f, oldName, newName) {
    const u = String(oldName).toUpperCase();
    let s = String(f);
    for (const x of findNames(s).filter(x => x.name.toUpperCase() === u).reverse()) s = s.slice(0, x.start) + newName + s.slice(x.end);
    return s;
  }
  // .bassx: limpia la lista guardada (nombres válidos, únicos, con hoja de ámbito existente; "ref" en es-CL)
  function normalizeNames(list, wb) {
    const out = { sheets: wb.sheets, names: [] };
    for (const d of Array.isArray(list) ? list : []) {
      if (!d || typeof d.name !== 'string' || typeof d.ref !== 'string') continue;
      const scope = d.scope == null ? null : String(d.scope);
      if (nameError(out, d.name, scope)) continue;
      const ref = d.ref;
      out.names.push({ name: d.name, scope: scopeName(wb, scope), ref: ref[0] === '=' ? ref : '=' + ref, comment: String(d.comment || '') });
    }
    return out.names;
  }
  // .xlsx (SheetJS): wb.Workbook.Names = namesToXlsx(wb) — Ref en inglés sin "=", Sheet = índice de la hoja de ámbito
  function namesToXlsx(wb) {
    return (wb.names || []).map(d => {
      const o = { Name: d.name, Ref: toExcelFormula(d.ref).replace(/^=/, '') };
      const i = d.scope ? wb.sheets.findIndex(s => sameScope(s.name, d.scope)) : -1;
      if (i >= 0) o.Sheet = i;
      if (d.comment) o.Comment = d.comment;
      return o;
    });
  }
  // .xlsx → modelo. Omite los ocultos y los internos (_xlnm.Print_Area, _xlnm._FilterDatabase…) y los inválidos.
  // La fórmula se convierte a es-CL con fromExcelFormula.
  function namesFromXlsx(xnames, wb) {
    const tmp = { sheets: wb.sheets, names: [] }, skipped = [];
    for (const x of Array.isArray(xnames) ? xnames : []) {
      if (!x || !x.Name || x.Ref == null || x.Hidden || /^_xlnm\./i.test(x.Name)) { if (x && x.Name) skipped.push(x.Name); continue; }
      const scope = x.Sheet != null && wb.sheets[x.Sheet] ? wb.sheets[x.Sheet].name : null;
      if (nameError(tmp, x.Name, scope)) { skipped.push(x.Name); continue; }
      const body = String(x.Ref).replace(/^=/, '');
      tmp.names.push({ name: x.Name, scope, ref: '=' + fromExcelFormula(body), comment: String(x.Comment || '') });
    }
    return { names: tmp.names, skipped };
  }

  // ---------- Aridad: mínimo y máximo de argumentos (como Excel; 255 = sin límite práctico) ----------
  // Para que la UI rechace al ingresar, p. ej. =RAIZ(2;25): "Ha escrito demasiados argumentos para esta función."
  const V = [1, 255];
  const ARITY = {
    ABS: [1, 1], AGGREGATE: [3, 255], AND: V, AVERAGE: V, AVERAGEA: V, AVERAGEIF: [2, 3], AVERAGEIFS: [3, 255], CEILING: [2, 2], CHOOSE: [2, 255],
    COLUMN: [0, 1], CONCAT: [1, 253], CONCATENATE: V, CORREL: [2, 2], COUNT: V, COUNTA: V, COUNTBLANK: [1, 1], COUNTIF: [2, 2], COUNTIFS: [2, 255],
    DATE: [3, 3], DATEDIF: [3, 3], DATEVALUE: [1, 1], DAY: [1, 1], EDATE: [2, 2], EOMONTH: [2, 2], FIND: [2, 3], FLOOR: [2, 2], FORECAST: [3, 3], 'FORECAST.LINEAR': [3, 3],
    FV: [3, 5], HLOOKUP: [3, 4], HOUR: [1, 1], IF: [1, 3], IFERROR: [2, 2], IFNA: [2, 2], IFS: [2, 254], INDEX: [2, 4], INDIRECT: [1, 2], INT: [1, 1],
    INTERCEPT: [2, 2], IPMT: [4, 6], IRR: [1, 2], ISBLANK: [1, 1], ISERROR: [1, 1], ISNA: [1, 1], ISNUMBER: [1, 1], ISTEXT: [1, 1], LARGE: [2, 2],
    LEFT: [1, 2], LEN: [1, 1], LOWER: [1, 1], MATCH: [2, 3], MAX: V, MAXA: V, MAXIFS: [3, 255], MEDIAN: V, MID: [3, 3], MIN: V, MINA: V, MINIFS: [3, 255],
    MINUTE: [1, 1], MOD: [2, 2], MODE: V, 'MODE.SNGL': V, MONTH: [1, 1], NETWORKDAYS: [2, 3], NOT: [1, 1], NOW: [0, 0], NPER: [3, 5], NPV: [2, 255],
    OFFSET: [3, 5], OR: V, PEARSON: [2, 2], PERCENTILE: [2, 2], 'PERCENTILE.EXC': [2, 2], 'PERCENTILE.INC': [2, 2], PI: [0, 0], PMT: [3, 5], POWER: [2, 2],
    PPMT: [4, 6], PRODUCT: V, PROPER: [1, 1], PV: [3, 5], QUARTILE: [2, 2], 'QUARTILE.EXC': [2, 2], 'QUARTILE.INC': [2, 2], RAND: [0, 0], RANDBETWEEN: [2, 2],
    RANK: [2, 3], 'RANK.AVG': [2, 3], 'RANK.EQ': [2, 3], RATE: [3, 6], REPT: [2, 2], RIGHT: [1, 2], ROUND: [2, 2], ROUNDDOWN: [2, 2], ROUNDUP: [2, 2],
    ROW: [0, 1], RSQ: [2, 2], SEARCH: [2, 3], SECOND: [1, 1], SLOPE: [2, 2], SMALL: [2, 2], SQRT: [1, 1], STDEV: V, 'STDEV.P': V, 'STDEV.S': V, STDEVP: V,
    SUBSTITUTE: [3, 4], SUBTOTAL: [2, 255], SUM: V, SUMIF: [2, 3], SUMIFS: [3, 255], SUMPRODUCT: V, TEXT: [2, 2], TEXTJOIN: [3, 252], TIME: [3, 3],
    TIMEVALUE: [1, 1], TODAY: [0, 0], TRIM: [1, 1], TRIMMEAN: [2, 2], TRUNC: [1, 2], UPPER: [1, 1], VALUE: [1, 1], VAR: V, 'VAR.P': V, 'VAR.S': V, VARP: V,
    VLOOKUP: [3, 4], WEEKDAY: [1, 2], XIRR: [2, 3], XLOOKUP: [3, 6], XNPV: [3, 3], YEAR: [1, 1],
    // matrices dinámicas
    SEQUENCE: [1, 4], UNIQUE: [1, 3], FILTER: [2, 3], SORT: [1, 4], SORTBY: [2, 255], RANDARRAY: [0, 5], 'MODE.MULT': V, VSTACK: V, HSTACK: V,
    TAKE: [2, 3], DROP: [2, 3], CHOOSECOLS: [2, 255], CHOOSEROWS: [2, 255], TRANSPOSE: [1, 1],
  };
  // Aridad de una función por cualquiera de sus nombres → { min, max } o null si no existe
  function arity(name) {
    const c = CANON[String(name).toUpperCase().replace(/^(?:_XLFN\.|_XLWS\.)+/, '')], a = c && ARITY[c];
    return a ? { min: a[0], max: a[1] } : null;
  }
  const TOO_MANY = 'Ha escrito demasiados argumentos para esta función.', TOO_FEW = 'Ha escrito muy pocos argumentos para esta función.';
  // Validación al ingresar (no se aplica al evaluar): → null si está bien, o { message, fn } con el mensaje de Excel.
  // Funciones desconocidas no son error aquí (Excel las acepta y muestra #¿NOMBRE?).
  function checkFormula(f) {
    const src = String(f);
    if (!isFormula(src)) return null;
    let ast;
    try { ast = parse(tokenize(src.slice(1))); } catch (e) { return { message: 'Hay un problema con esta fórmula.', fn: null }; }
    let bad = null;
    const walk = n => {
      if (!n || bad) return;
      if (n.k === 'call') {
        const a = arity(n.n);
        if (a && n.args.length < a.min) bad = { message: TOO_FEW, fn: n.n };
        else if (a && n.args.length > a.max) bad = { message: TOO_MANY, fn: n.n };
        n.args.forEach(walk);
      } else if (n.k === 'bin') { walk(n.l); walk(n.r); } else if (n.e) walk(n.e);
    };
    walk(ast);
    return bad;
  }

  // Funciones posteriores a Excel 2007: en .xlsx se guardan con el prefijo _xlfn.
  const XLFN = new Set(['IFS', 'XLOOKUP', 'TEXTJOIN', 'MAXIFS', 'MINIFS', 'IFNA', 'CONCAT', 'STDEV.P', 'STDEV.S', 'VAR.S', 'VAR.P', 'RANK.EQ',
    'RANK.AVG', 'MODE.SNGL', 'PERCENTILE.INC', 'PERCENTILE.EXC', 'QUARTILE.INC', 'QUARTILE.EXC', 'FORECAST.LINEAR', 'AGGREGATE',
    'SEQUENCE', 'UNIQUE', 'SORTBY', 'RANDARRAY', 'MODE.MULT', 'VSTACK', 'HSTACK', 'TAKE', 'DROP', 'CHOOSECOLS', 'CHOOSEROWS']);
  // FILTER y SORT se guardan con el prefijo doble _xlfn._xlws. (TRANSPOSE es de siempre: sin prefijo)
  const XLWS = new Set(['FILTER', 'SORT']);

  // ---------- A1# y @ en .xlsx: _xlfn.ANCHORARRAY(A1) y _xlfn.SINGLE(…) ----------
  // Aplica fn a los tramos de la fórmula que están fuera de los textos "…" (también sin cerrar)
  const codeParts = (f, fn) => String(f).split(/("(?:[^"]|"")*"?)/).map((seg, i) => i % 2 ? seg : fn(seg)).join('');
  // Fin de un tramo entre comillas (" o ') que empieza en i
  function skipQuoted(s, i) {
    const q = s[i];
    let j = i + 1;
    while (j < s.length) { if (s[j] === q) { if (s[j + 1] === q) { j += 2; continue; } return j + 1; } j++; }
    return s.length;
  }
  // Fin del paréntesis que abre en i (respeta textos y hojas entre comillas)
  function skipParens(s, i) {
    let d = 0, j = i;
    while (j < s.length) {
      const ch = s[j];
      if (ch === '"' || ch === "'") { j = skipQuoted(s, j); continue; }
      if (ch === '(') d++;
      else if (ch === ')' && --d === 0) return j + 1;
      j++;
    }
    return s.length;
  }
  // Fin del operando de @ que empieza en i: (expresión), referencia o nombre (con hoja) y llamada a función
  function operandEnd(s, i) {
    if (s[i] === '(') return skipParens(s, i);
    let j = i;
    if (s[j] === "'") j = skipQuoted(s, j);
    while (j < s.length && /[\w.$:!À-ſ\\]/.test(s[j])) { j++; if (s[j] === "'" && s[j - 1] === ':') j = skipQuoted(s, j); }
    if (s[j] === '(') j = skipParens(s, j);
    return j;
  }
  const ANCHOR_ES = new RegExp(`(?<![\\w.$'!\\\\])((?:'(?:[^']|'')+'|${NAME})!)?(\\$?[A-Za-z]{1,3}\\$?\\d+)#(?![\\w¡¿])`, 'g');
  const ANCHOR_EN = new RegExp(`_xlfn\\.ANCHORARRAY\\(\\s*((?:'(?:[^']|'')+'|${NAME})!)?(\\$?[A-Za-z]{1,3}\\$?\\d+)\\s*\\)`, 'gi');
  function atToExcel(s) {
    let out = '', i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"' || ch === "'") { const j = skipQuoted(s, i); out += s.slice(i, j); i = j; continue; }
      if (ch === '@') {
        const j = operandEnd(s, i + 1), op = s.slice(i + 1, j);
        const inner = op[0] === '(' && skipParens(op, 0) === op.length ? op.slice(1, -1) : op;
        out += '_xlfn.SINGLE(' + atToExcel(inner) + ')'; i = j; continue;
      }
      out += ch; i++;
    }
    return out;
  }
  function atFromExcel(s) {
    let out = '', i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"' || ch === "'") { const j = skipQuoted(s, i); out += s.slice(i, j); i = j; continue; }
      if (/^_xlfn\.SINGLE\(/i.test(s.slice(i, i + 13)) && !IDCH.test(s[i - 1] || '')) {
        const j = skipParens(s, i + 12), inner = atFromExcel(s.slice(i + 13, s[j - 1] === ')' ? j - 1 : j)).trim();
        out += inner && operandEnd(inner, 0) === inner.length ? '@' + inner : '@(' + inner + ')'; i = j; continue;
      }
      out += ch; i++;
    }
    return out;
  }
  // Funciones abiertas en la posición p de una fórmula es-CL: [{ fn: nombre canónico | '?' | null (agrupación), arg }]
  function callStackAt(s, p) {
    const st = [];
    let i = 0, br = 0;
    while (i < p) {
      const ch = s[i];
      if (ch === '"' || ch === "'") { i = skipQuoted(s, i); continue; }
      if (ch === '{') br++;
      else if (ch === '}') br = Math.max(0, br - 1);
      else if (ch === '(') {
        let j = i - 1;
        while (j >= 0 && s[j] === ' ') j--;
        let k = j;
        while (k >= 0 && IDCH.test(s[k])) k--;
        const id = s.slice(k + 1, j + 1);
        st.push({ fn: id ? CANON[id.toUpperCase().replace(/^(?:_XLFN\.|_XLWS\.)+/, '')] || '?' : null, arg: 0 });
      } else if (ch === ')') st.pop();
      else if (ch === ';' && !br && st.length) st[st.length - 1].arg++;
      i++;
    }
    return st;
  }
  // ¿Excel aplicaría intersección implícita a un rango en este contexto? Sí: en el nivel superior, como operando de un
  // operador, en un argumento de valor (LARGO, BUSCARV arg 1, condición de SI, ES*). No: dentro de SUMAPRODUCTO, en
  // argumentos de rango o matriz (SUMA, CONTAR.SI, tabla de BUSCARV…) ni en funciones desconocidas.
  function legacyScalarCtx(st, opAdj) {
    if (st.some(fr => fr.fn === 'SUMPRODUCT')) return false;
    if (opAdj) return true;
    for (let i = st.length - 1; i >= 0; i--) {
      const { fn, arg } = st[i];
      if (!fn) continue; // paréntesis de agrupación
      const l = LIFT[fn];
      if (l) return l === true || l.includes(arg);
      if (fn === 'IF' || fn === 'CHOOSE') { if (arg === 0) return true; continue; } // las ramas pasan el valor hacia afuera
      if (fn === 'IFS') { if (arg % 2 === 0) return true; continue; }
      if (fn === 'IFERROR' || fn === 'IFNA') continue;
      return ['ISERROR', 'ISNA', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'NOT'].includes(fn);
    }
    return true;
  }
  // Fórmula de un .xlsx sin la marca de matriz dinámica (celda sin `D`): Excel la evalúa con la intersección implícita
  // de siempre y, al abrirla, muestra @ donde un rango o una función de rango (INDICE, DESREF, INDIRECTO, BUSCARX)
  // quedaría en un lugar que espera un valor: =A1:A3*2 → =@A1:A3*2; =LARGO(A1:A3) → =LARGO(@A1:A3); =SUMA(A1:A3) no
  // cambia. Recibe y devuelve es-CL con "=". Aproximación: los nombres definidos no se marcan.
  function implicitIntersect(f) {
    const s = String(f);
    if (!isFormula(s)) return s;
    const OPS = '+-*/^&=<>%';
    const prevOp = i => { let j = i - 1; while (j > 0 && s[j] === ' ') j--; return j > 0 && OPS.includes(s[j]); };
    const nextOp = i => { let j = i; while (j < s.length && s[j] === ' ') j++; return j < s.length && OPS.includes(s[j]); };
    const at = new Set();
    for (const x of findRefs(s)) if ((x.b || x.a.kind) && !x.spill && legacyScalarCtx(callStackAt(s, x.start), prevOp(x.start) || nextOp(x.end))) at.add(x.start);
    // llamadas a funciones que devuelven rangos, fuera de textos
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '"' || ch === "'") { i = skipQuoted(s, i); continue; }
      const m = !IDCH.test(s[i - 1] || '') && /^[A-Za-z_À-ſ][\w.À-ſ]*(?=\s*\()/.exec(s.slice(i));
      if (m) {
        const c = CANON[m[0].toUpperCase().replace(/^(?:_XLFN\.|_XLWS\.)+/, '')];
        if (['INDEX', 'OFFSET', 'INDIRECT', 'XLOOKUP'].includes(c)) {
          const end = skipParens(s, s.indexOf('(', i));
          if (s[i - 1] !== '@' && legacyScalarCtx(callStackAt(s, i), prevOp(i) || nextOp(end))) at.add(i);
        }
        i += m[0].length; continue;
      }
      i++;
    }
    let out = s;
    for (const p of [...at].sort((a, b) => b - a)) if (out[p - 1] !== '@') out = out.slice(0, p) + '@' + out.slice(p);
    return out;
  }
  // Convierte nombres de función en español, errores en español y separadores ';' al formato estándar de .xlsx
  // (inverso de fromExcelFormula; en modo legacy primero se migra con la regla vieja). También traduce
  // VERDADERO/FALSO, que antes se exportaban sin traducir y Excel los leía como nombres (#NAME?).
  // Matrices dinámicas: A1# → _xlfn.ANCHORARRAY(A1), @x → _xlfn.SINGLE(x), FILTER/SORT con _xlfn._xlws.
  function toExcelFormula(body) {
    const es = SYNTAX === 'es-CL' ? String(body) : migrateLegacyFormula(body);
    const en = codeParts(xlate(es, 'es', 'en', 'loc', false), seg => seg.replace(ANCHOR_ES, (m, sh, ref) => '_xlfn.ANCHORARRAY(' + (sh || '') + ref + ')'));
    return en.includes('@') ? atToExcel(en) : en;
  }

  const FUNCTIONS = Object.keys(FN).sort();

  return {
    colName, colIndex, addr, parseAddr, FErr, E, Engine, literal, isFormula, isDateLiteral, isTimeLiteral, isDateTimeLiteral, serialDate,
    compareVals, shiftFormula, structural, renameSheetInFormula, toExcelFormula, quoteSheet, FUNCTIONS,
    findRefs, refText, CANON, ERR_ES, VOLATILE, toRaw, setRowState, fromExcelFormula, migrateLegacyFormula, setSyntax, getSyntax, compareText,
    deleteSheetInFormula, nameError, defineName, editName, deleteName, listNames, namesStructural, namesRenameSheet, namesDeleteSheet,
    namesDuplicateSheet, findNames, renameNameInFormula, normalizeNames, namesToXlsx, namesFromXlsx, arity, checkFormula, ARITY,
    mayArrayFormula, implicitIntersect,
  };
})();

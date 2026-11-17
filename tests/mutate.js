'use strict';
// Pruebas de mutación del motor (L-028): rompe a propósito reglas clave de web/engine.js y verifica que
// tests/engine.test.js detecte cada una. Uso: npm run mutate. Sale con código 1 si una mutación sobrevive
// o si un ancla ya no existe (hay que actualizar la lista tras refactorizar).
// Nota (L-025/L-027): los reemplazos usan funciones, nunca textos con "$", y este archivo se edita con Edit/Write.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'web', 'engine.js');
const TESTS = path.join(__dirname, 'engine.test.js');

// [descripción, texto original exacto, reemplazo]
const MUTATIONS = [
  ['ámbito de hoja antes que libro', "return (sh && this.nameMap.get(sh.name.toLowerCase() + '\\u0000' + u)) || this.nameMap.get('\\u0000' + u) || null;", "return this.nameMap.get('\\u0000' + u) || null;"],
  ['REF_RE excluye "\\"', "(?<![\\\\w.$'!\\\\\\\\])", "(?<![\\\\w.$'!])"],
  ['nombre que es referencia → rango (L-007)', "return a.k === 'ref' ? this.refRange(a, si) : this.evalNode(a, si);", 'return this.evalNode(a, si);'],
  ['INDIRECTO acepta nombres', 'if (g && g.range) return g;', ''],
  ['aridad máxima', 'else if (a && n.args.length > a.max)', 'else if (false)'],
  ['error escrito en una celda', 'if (em && em[0].length === t.length) return ERR_IN[em[0].toUpperCase()];', ''],
  ['criterio "#N/D"', "if (lit instanceof FErr) return op === '=' ? v => v === lit : op === '<>' ? v => v !== lit : () => false;", ''],
  ['ajuste "cerca de cero"', "if (a.k === 'bin' && (a.o === '+' || a.o === '-') && !a.paren) a.snap = true;", ''],
  ['paréntesis anulan el ajuste', 'e.paren = true; return e;', 'return e;'],
  ['umbral científico del formato General', 'if (a >= 1e15 || a < 1e-4) {', 'if (a >= 1e21 || a < 1e-7) {'],
  ['comparación con 15 cifras', 'if (a === 0 && r15) { l = round15(l); r = round15(r); }', ''],
  ['ñ después de n', "ALPHA = 'abcdefghijklmnñopqrstuvwxyz'", "ALPHA = 'abcdefghijklmnopqrstuvwxyzñ'"],
  ['coma suelta es error en es-CL', 'if (es) { if (strict) throw E.value; out += ch; }', 'if (es) { out += ch; }'],
  ['vacío escrito = 0 en PROMEDIO/MIN/MAX (L-008)', 'else if (!r && blankZero) out.push(0);', ''],
  ['SUBTOTALES excluye filas filtradas', "visibleVals(g, { filtered: true, hidden: n > 100, nested: SUBT_RE })", "visibleVals(g, { filtered: false, hidden: n > 100, nested: SUBT_RE })"],
  ['número → texto con coma decimal', "return String(x).replace('.', ',');", 'return String(x);'],
  // matrices dinámicas (ronda 6)
  ['celda vacía lee el desborde (fantasma)', 'const g = this.ghost(si, r, c);', 'const g = undefined;'],
  ['desborde bloqueado por contenido', "if (blockers.length) reason = 'blocked';", "if (false) reason = 'blocked';"],
  ['choque entre matrices desbordadas', "reason = 'spill';", 'continue;'],
  ['gana la primera fila por fila', 'this.ensure(si, area.r2, area.c2, { r, c }, null);', ''],
  ['recalc libera el desborde viejo', 'this.spillReg.clear(); this.spillErrs.clear();', 'this.spillErrs.clear();'],
  ['matriz que lee su propia área → #CIRC!', 'if (q.key === key && q.si === si && crossBut(q, area, r, c)) return E.circ;', 'if (false) return E.circ;'],
  ['tentativa: candidata en curso desde fuera → abortar', 'if (this.stack.get(k.key) < this.tentBase) throw ABORT;', ''],
  ['evaluación tentativa sin falso #CIRC!','if (this.stack.has(key)) { if (this.stack.get(key) < this.tentBase) throw ABORT; throw E.circ; }', 'if (this.stack.has(key)) throw E.circ;'],
  ['mayArray: un rango puede desbordar', "case 'ref': return !!(n.b || n.kind || n.spill);", "case 'ref': return false;"],
  ['difusión: una fila o columna se repite', 'const ii = m.length === 1 ? 0 : i, jj = m[0].length === 1 ? 0 : j;', 'const ii = i, jj = j;'],
  ['#N/A donde la matriz no alcanza', 'return ii < m.length && jj < m[0].length ? m[ii][jj] : E.na;', 'return ii < m.length && jj < m[0].length ? m[ii][jj] : null;'],
  ['operador # en el tokenizador', "if (src[i] === '#' && !tk.b && !tk.kind && !SPILL_NEXT.test(src[i + 1] || '')) { tk.spill = true; i++; }", ''],
  ['findRefs: el # queda fuera de [start, end)', 'm[0].length - (m[18] ? 1 : 0)', 'm[0].length'],
  ['mapRefs conserva el #', "return o == null ? m[0] : m[18] && o[0] !== '#' ? o + '#' : o;", 'return o == null ? m[0] : o;'],
  ['A:A incluye los desbordes', 'if (cross(s, rect)) { er = Math.max(er, s.r2); ec = Math.max(ec, s.c2); }', 'if (false) er = 0;'],
  ['SI con condición matricial', 'if (isMulti(c)) {', 'if (false) {'],
  ['funciones elemento a elemento', 'if (pos.length) return broadcast(', 'if (false) return broadcast('],
  ['intersección implícita por fila', 'else if (v.c1 === v.c2 && cx.r >= v.r1 && cx.r <= v.r2) { r = cx.r; c = v.c1; }', ''],
  ['constante matricial con filas desiguales', 'if (rows.some(r => r.length !== rows[0].length)) throw E.value;', ''],
  ['FILTRAR sin resultados → #CALC!', 'if (ifEmpty === undefined) throw E.calc;', ''],
  ['ORDENAR: vacías al final', 'if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;', ''],
  ['UNICOS sin distinguir mayúsculas', "'s' + v.toLowerCase().normalize('NFC')", "'s' + v"],
  ['_xlfn._xlws. para FILTER y SORT', "const XLWS = new Set(['FILTER', 'SORT']);", 'const XLWS = new Set([]);'],
  ['A1# ↔ _xlfn.ANCHORARRAY(A1) en .xlsx', "seg.replace(ANCHOR_ES, (m, sh, ref) => '_xlfn.ANCHORARRAY(' + (sh || '') + ref + ')')", 'seg'],
  ['importar: @ en operandos (intersección implícita)', '    if (opAdj) return true;', ''],
  ['importar: @ no entra en SUMAPRODUCTO', "if (st.some(fr => fr.fn === 'SUMPRODUCT')) return false;", ''],
  // fechas escritas es-CL (2026-11-02)
  ['año de 2 dígitos: corte en 30 (regla de 2029)', '(+s < 30 ? 2000 : 1900)', '(+s < 50 ? 2000 : 1900)'],
  ['año de 3 dígitos no es año', 's.length <= 2 ?', 's.length <= 3 ?'],
  ['dos partes: mes/año si día/mes no existe', '?? ymdSerial(yearOf(yText), my, 1)', '?? null'],
  ['dos partes: día/mes antes que mes/año', 'ymdSerial(new Date().getFullYear(), m, d) ?? ymdSerial(yearOf(yText), my, 1)', 'ymdSerial(yearOf(yText), my, 1) ?? ymdSerial(new Date().getFullYear(), m, d)'],
  ['mes/año numérico: el mes es la primera parte', 'twoParts(+x[1], +x[2], +x[1], x[2])', 'twoParts(+x[1], +x[2], +x[2], x[1])'],
  ['d/m/aa: mes de 1 o 2 dígitos', 'return x[2].length <= 2 ?', 'return true ?'],
  ['meses en español (ene)', 'ene: 1, enero: 1, ', 'enero: 1, '],
  ['fecha inexistente (31/02) queda como texto', 'd <= daysIn(y, m) ||', 'd <= 31 ||'],
  ['29/02/1900 existe (1900 bisiesto)', '|| (y === 1900 && m === 2 && d === 29)', ''],
  ['FECHA cuenta desde el día 1 del mes (febrero de 1900 con 29 días)', 'return (s1 < 61 ? s1 - 1 : s1) + d - 1;', '{ const s = s1 + d - 1; return s < 61 ? s - 1 : s; }'],
  ['DIA/MES del serial 60 = 29/02/1900', 'if (Math.floor(v) === 60) return [1900, 2, 29]; ', ''],
  ['fecha con espacios + hora', String.raw`/^(.+)\s+(\S+)$/`, String.raw`/^(\S+)\s+(\S+)$/`],
  ['FECHANUMERO acepta fecha + hora', 'v = parseDate(s) ?? parseDateTime(s);', 'v = parseDate(s);'],
  ['FECHANUMERO ignora la hora', 'return Math.floor(v);', 'return v;'],
  // decimal final y migración (2026-11-02, L-051)
  ['es-CL: decimal final "1,"', String.raw`NUM_ES = /^(?:\d+(?:,\d*|\.\d+)?|[,.]\d+)`, String.raw`NUM_ES = /^(?:\d+(?:,\d+|\.\d+)?|[,.]\d+)`],
  ['tokenizador: "1." es un número', String.raw`if ((m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(rest)))`, String.raw`if ((m = /^(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/.exec(rest)))`],
  ['.xlsx sin decimal final', "out += toEs || glued ? num : num.replace(/\\.(?=[eE]|$)/, '');", 'out += num;'],
  ['decimal final pegado a otro número se conserva', 'out += toEs || glued ? num :', 'out += toEs ? num :'],
  ['migración con nombres en español', "xlate(normalizeDecimals(String(f)), 'loose', 'es', 'loc', false)", "xlate(normalizeDecimals(String(f)), 'loose', 'es', 'keep', false)"],
  // evalFormula / evalFormulaBool: fórmula suelta (2026-11-04)
  ['fórmula suelta: hoja inexistente o fuera de la hoja → #REF!', 'if (!this.wb.sheets[si] || !(r >= 0 && c >= 0 && r < MAXR && c < MAXC)) return E.ref;', ''],
  ['fórmula suelta: texto sin "=" inicial', "if (src[0] !== '=') src = '=' + src;", ''],
  ['fórmula suelta: opts.from desplaza las relativas', 'if (opts.from) src = shiftFormula(src, r - opts.from.r, c - opts.from.c);', ''],
  ['fórmula suelta: la celda actual es (r, c)', 'this.cur = { si, r, c }; // la celda de la regla', 'this.cur = { si, r: 0, c: 0 }; // la celda de la regla'],
  ['fórmula suelta: restaura cur', '} finally { this.cur = prev; } // la fórmula suelta', '} finally { } // la fórmula suelta'],
  ['fórmula suelta: el error se devuelve, no se lanza', 'if (e instanceof FErr) return e; // también sintaxis', 'if (e instanceof FErr) throw e; // también sintaxis'],
  ['fórmula suelta: opts.ref devuelve la referencia', 'if (opts.ref && res && res.range) return res;', ''],
  ['fórmula suelta: argumento como referencia con opts.ref', 'res = opts.ref ? this.evalArg(a, si) : this.evalNode(a, si);', 'res = this.evalNode(a, si);'],
  ['fórmula suelta: rango → matriz de valores', 'const m = isMat(res) ? res : this.rangeValues(res);', 'const m = isMat(res) ? res : [[res]];'],
  ['fórmula suelta: vacío → 0 como en la celda', 'return spillVal(scalar(res));', 'return scalar(res);'],
  // (quitar el tope colgaría la suite con =A1:XFD1048576; se muta su tamaño para ver que mide el rango real)
  ['fórmula suelta: tope de elementos con el tamaño del rango', 'if (res.range) { const [h, w] = this.dims(res); guardSize(h * w); }', 'if (res.range) { const [h, w] = this.dims(res); guardSize(h * w * 1e9); }'],
  ['condición: número ≠ 0 es VERDADERO', "return v === true || (typeof v === 'number' && v !== 0);", 'return v === true;'],
  ['condición: el texto "VERDADERO" no cuenta', "return v === true || (typeof v === 'number' && v !== 0);", 'try { return truthy(v); } catch (e) { return false; }'],
  ['condición: matriz → primer elemento', 'if (isMat(v)) v = v[0][0];', ''],
];

const src = fs.readFileSync(ENGINE, 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bassxcel-mut-'));
const mutEngine = path.join(dir, 'engine.js');
const mutTests = path.join(dir, 'engine.test.js');
// copia de las pruebas que carga el motor mutado en vez de web/engine.js
const tests = fs.readFileSync(TESTS, 'utf8');
const anchor = "path.join(__dirname, '..', 'web', 'engine.js')";
if (!tests.includes(anchor)) { console.error('engine.test.js ya no carga el motor con ' + anchor); process.exit(1); }
fs.writeFileSync(mutTests, tests.replace(anchor, () => JSON.stringify(mutEngine)));

let bad = 0;
for (const [name, from, to] of MUTATIONS) {
  if (!src.includes(from)) { console.log(`✗ ancla no encontrada: ${name}`); bad++; continue; }
  const mutated = src.replace(from, () => to);
  // una mutación que no compila no prueba nada: la suite "falla" por el error de sintaxis, no por la regla
  try { new vm.Script(mutated); } catch (e) { console.log(`✗ mutación inválida (no compila): ${name}`); bad++; continue; }
  fs.writeFileSync(mutEngine, mutated);
  let out;
  try { out = execFileSync(process.execPath, [mutTests], { encoding: 'utf8' }); } catch (e) { out = String(e.stdout || ''); }
  const m = /(\d+) pruebas OK, (\d+) fallidas/.exec(out);
  if (m && +m[2] > 0) console.log(`✓ detectada (${m[2]} fallidas): ${name}`);
  else if (!m) console.log(`✓ detectada (la suite no terminó): ${name}`);
  else { console.log(`✗ SOBREVIVE: ${name}`); bad++; }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${MUTATIONS.length - bad} de ${MUTATIONS.length} mutaciones detectadas`);
process.exit(bad ? 1 : 0);

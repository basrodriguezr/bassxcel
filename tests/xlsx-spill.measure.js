'use strict';
// Medición (L-022): cómo escribe y lee SheetJS (web/vendor) las fórmulas de matriz dinámica.
// Uso: node tests/xlsx-spill.measure.js  → imprime lo que llega al leer y sale con código 1 si algo no coincide.
// Responde: ¿llega c.D al leer? ¿qué celdas del rango F traen f/F? ¿cómo se escriben #SPILL!/#CALC!?
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, Uint8Array, ArrayBuffer, DataView, Date, Math, JSON, String, Number, Object, Array, Error, RegExp, TextDecoder, TextEncoder };
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'vendor', 'xlsx.full.min.js'), 'utf8'), ctx);
const XLSX = ctx.XLSX;
let fails = 0;
const check = (name, ok, got) => { console.log((ok ? 'OK   ' : 'FALLA') + ' ' + name + (ok ? '' : '  → ' + JSON.stringify(got))); if (!ok) fails++; };

// Ancla A1 con =SEQUENCE(3) desbordada en A1:A3 (D: true, F: rango) y fantasmas A2, A3 solo con valor
const ws = {
  A1: { t: 'n', v: 1, f: '_xlfn.SEQUENCE(3)', F: 'A1:A3', D: true },
  A2: { t: 'n', v: 2 }, A3: { t: 'n', v: 3 },
  // fórmula común (sin D) y fórmula de matriz "heredada" (CSE: F sin D)
  B1: { t: 'n', v: 2, f: 'A1:A3*2' },
  C1: { t: 'n', v: 6, f: 'SUM(A1:A3)', F: 'C1:C1' },
  // A1# en .xlsx: _xlfn.ANCHORARRAY(A1)
  D1: { t: 'n', v: 6, f: 'SUM(_xlfn.ANCHORARRAY(A1))' },
  ['!ref']: 'A1:D3',
};
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, ws, 'H');
const buf = XLSX.write(book, { type: 'array', bookType: 'xlsx' });

// XML escrito: atributo cm="1" en el ancla, <f t="array" ref="A1:A3"> y metadata.xml con XLDAPR
const zip = XLSX.CFB.read(Buffer.from(buf), { type: 'buffer' });
const xml = name => { const e = XLSX.CFB.find(zip, name); return e ? Buffer.from(e.content).toString('utf8') : ''; };
const sheetXml = xml('/xl/worksheets/sheet1.xml');
const a1 = (/<c r="A1"[^>]*>.*?<\/c>/.exec(sheetXml) || [''])[0];
console.log('XML A1: ' + a1);
check('ancla escrita con cm="1"', /cm="1"/.test(a1), a1);
check('ancla escrita con <f t="array" ref="A1:A3">', /<f t="array" ref="A1:A3">/.test(a1), a1);
check('metadata.xml con XLDAPR', /XLDAPR/.test(xml('/xl/metadata.xml')), xml('/xl/metadata.xml').slice(0, 200));

// Lectura (igual que fromXlsx en app.js: cellStyles: true)
const back = XLSX.read(buf, { type: 'array', cellStyles: true }).Sheets.H;
const show = k => back[k] ? { t: back[k].t, v: back[k].v, f: back[k].f, F: back[k].F, D: back[k].D } : null;
for (const k of ['A1', 'A2', 'A3', 'B1', 'C1']) console.log(k + ' → ' + JSON.stringify(show(k)));
check('A1 llega con D: true', back.A1 && back.A1.D === true, show('A1'));
check('A1 llega con F = "A1:A3" y f', back.A1 && back.A1.F === 'A1:A3' && !!back.A1.f, show('A1'));
check('A2 (fantasma) sin fórmula propia', back.A2 && !back.A2.f, show('A2'));
check('B1 (sin D) sin D', back.B1 && !back.B1.D, show('B1'));
check('C1 (matriz CSE) con F y sin D', back.C1 && back.C1.F === 'C1:C1' && !back.C1.D, show('C1'));
check('A2/A3 (fantasmas) traen F del ancla: fromXlsx las salta', back.A2 && back.A2.F === 'A1:A3' && back.A3.F === 'A1:A3', show('A3'));
// Sin xlfn: true SheetJS quita "_xlfn." y el motor ya no reconoce ANCHORARRAY (A1#) ni SINGLE (@): fromXlsx lee con xlfn: true
check('sin xlfn: true, D1 pierde el prefijo (por eso fromXlsx usa xlfn: true)', back.D1 && back.D1.f === 'SUM(ANCHORARRAY(A1))', show('D1'));
const keep = XLSX.read(buf, { type: 'array', cellStyles: true, xlfn: true }).Sheets.H;
check('con xlfn: true, D1 conserva _xlfn.ANCHORARRAY(A1)', keep.D1 && keep.D1.f === 'SUM(_xlfn.ANCHORARRAY(A1))', keep.D1);
check('con xlfn: true, A1 conserva _xlfn.SEQUENCE(3)', keep.A1 && keep.A1.f === '_xlfn.SEQUENCE(3)', keep.A1);

// Errores: tabla de códigos de SheetJS (¿existe #SPILL!/#CALC!?)
const errs = {};
for (const code of [0x00, 0x07, 0x0F, 0x17, 0x1D, 0x24, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F]) {
  const w = { A1: { t: 'e', v: code }, ['!ref']: 'A1' }, b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(b, w, 'E');
  const out = XLSX.CFB.read(Buffer.from(XLSX.write(b, { type: 'array', bookType: 'xlsx' })), { type: 'buffer' });
  const sx = Buffer.from(XLSX.CFB.find(out, '/xl/worksheets/sheet1.xml').content).toString('utf8');
  errs['0x' + code.toString(16)] = (/<c r="A1"[^>]*>(.*?)<\/c>/.exec(sx) || [, '?'])[1];
}
console.log('Errores escritos: ' + JSON.stringify(errs));
check('SheetJS no tiene código para #SPILL!/#CALC! (se documenta en app.js: XERR)', !Object.values(errs).some(x => /SPILL|CALC/.test(x)), errs);
console.log(fails ? fails + ' FALLA(S)' : 'todo OK');
process.exit(fails ? 1 : 0);

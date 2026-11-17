'use strict';
// Pruebas del motor de fórmulas: node tests/engine.test.js (o npm test)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'engine.js'), 'utf8') + ';this.Bx = Bx;', ctx);
const Bx = ctx.Bx;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log(`✗ ${name}\n  ${e.message}`); }
}
// Crea un libro con { 'Hoja1': { A1: '10', … }, … } y devuelve un evaluador de celdas de la primera hoja
function book(sheets) {
  const wb = { sheets: Object.entries(sheets).map(([name, cells]) => ({ name, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { v }])) })) };
  const eng = new Bx.Engine(wb);
  return { wb, eng, val: (k, si = 0) => { const p = Bx.parseAddr(k); const v = eng.value(si, p.r, p.c); return v instanceof Bx.FErr ? v.code : v; } };
}
// JSON para comparar objetos creados dentro del contexto vm (otro "realm")
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

const base = { A1: '10', A2: '20', A3: '3,5', A4: 'texto', A5: '' };
// Ejecuta fn con la sintaxis vieja (adivina si la coma es decimal) y restaura la vigente
function legacy(fn) { const prev = Bx.getSyntax(); Bx.setSyntax('legacy'); try { return fn(); } finally { Bx.setSyntax(prev); } }

test('suma y promedio ignoran texto en rangos', () => {
  const b = book({ Hoja1: { ...base, B1: '=SUMA(A1:A5)', B2: '=PROMEDIO(A1:A4)', B3: '=SUM(A1:A3)' } });
  eq(b.val('B1'), 33.5); near(b.val('B2'), 33.5 / 3); eq(b.val('B3'), 33.5);
});
test('contar / contara', () => {
  const b = book({ Hoja1: { ...base, B1: '=CONTAR(A1:A5)', B2: '=CONTARA(A1:A5)' } });
  eq(b.val('B1'), 3); eq(b.val('B2'), 4);
});
test('precedencia estilo Excel', () => {
  const b = book({ Hoja1: { B1: '=-2^2', B2: '=2+3*4', B3: '=10%*50', B4: '="a"&1+1' } });
  eq(b.val('B1'), 4); eq(b.val('B2'), 14); eq(b.val('B3'), 5); eq(b.val('B4'), 'a2');
});
test('SI / SI.ERROR / Y / O', () => {
  const b = book({ Hoja1: { A1: '10', B1: '=SI(A1>5;"alto";"bajo")', B2: '=SI.ERROR(A1/0;-1)', B3: '=Y(A1>1;A1<20)', B4: '=O(A1>100;FALSO)' } });
  eq(b.val('B1'), 'alto'); eq(b.val('B2'), -1); eq(b.val('B3'), true); eq(b.val('B4'), false);
});
test('errores', () => {
  const b = book({ Hoja1: { A1: '1', B1: '=A1/0', B2: '=FOO(1)', B3: '=B4', B4: '=B3', B5: '=Nada!A1' } });
  eq(b.val('B1'), '#DIV/0!'); eq(b.val('B2'), '#NAME?'); eq(b.val('B3'), '#CIRC!'); eq(b.val('B5'), '#REF!');
});
test('referencias entre hojas', () => {
  const b = book({ Hoja1: { B1: "='Mis datos'!A1*2", B2: '=Hoja2!A1+1' }, 'Mis datos': { A1: '21' }, Hoja2: { A1: '4' } });
  eq(b.val('B1'), 42); eq(b.val('B2'), 5);
});
test('búsquedas', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', B1: 'uno', B2: 'dos', B3: 'tres',
    C1: '=BUSCARV(2;A1:B3;2;FALSO)', C2: '=BUSCARV(2,5;A1:B3;2)', C3: '=COINCIDIR(3;A1:A3;0)', C4: '=INDICE(B1:B3;3)', C5: '=BUSCARV(9;A1:B3;2;FALSO)' } });
  eq(b.val('C1'), 'dos'); eq(b.val('C2'), 'dos'); eq(b.val('C3'), 3); eq(b.val('C4'), 'tres'); eq(b.val('C5'), '#N/A');
});
test('condicionales con criterios', () => {
  const b = book({ Hoja1: { ...base, C1: '=CONTAR.SI(A1:A4;">5")', C2: '=SUMAR.SI(A1:A4;">=10")', C3: '=CONTAR.SI(A1:A4;"tex*")' } });
  eq(b.val('C1'), 2); eq(b.val('C2'), 30); eq(b.val('C3'), 1);
});
test('texto y redondeo', () => {
  const b = book({ Hoja1: { B1: '=REDONDEAR(2,345;2)', B2: '=MAYUSC("hola")&LARGO("abc")', B3: '=EXTRAE("Bassxcel";1;4)', B4: '=REDONDEAR(-2,5;0)' } });
  eq(b.val('B1'), 2.35); eq(b.val('B2'), 'HOLA3'); eq(b.val('B3'), 'Bass'); eq(b.val('B4'), -3);
});
test('coma decimal estilo Excel en español (sintaxis legacy)', () => legacy(() => {
  const b = book({ Hoja1: { A1: '10', B1: '=A1*1,5', B2: '=SUM(1,5)', B3: '=SUMA(1,5;2)', B4: '=SI(A1>1;"a,b";0,5)', B5: '=SUMA(A1;1,25)' } });
  eq(b.val('B1'), 15); eq(b.val('B2'), 6); eq(b.val('B3'), 3.5); eq(b.val('B4'), 'a,b'); eq(b.val('B5'), 11.25);
  eq(Bx.toExcelFormula('REDONDEAR(2,5;0)+A1*1,5'), 'ROUND(2.5,0)+A1*1.5');
}));
test('fechas', () => {
  const b = book({ Hoja1: { A1: '22/10/2026', B1: '=FECHA(2026;10;22)', B2: '=AÑO(A1)', B3: '=MES(B1)', B4: '=DIA(A1)' } });
  eq(b.val('B1'), 46317); eq(b.val('A1'), 46317); eq(b.val('B2'), 2026); eq(b.val('B3'), 10); eq(b.val('B4'), 22);
});
test('literales: decimales con coma, porcentajes, texto forzado', () => {
  eq(Bx.literal('3,5'), 3.5); eq(Bx.literal('50%'), 0.5); eq(Bx.literal("'00123"), '00123'); eq(Bx.literal('1.000.000'), 1000000);
});
test('cadena larga no desborda la pila (L-005)', () => {
  const cells = { A1: '1' };
  for (let r = 2; r <= 30000; r++) cells['A' + r] = `=A${r - 1}+1`;
  const b = book({ Hoja1: cells });
  b.eng.prime(0);
  eq(b.val('A30000'), 30000);
});
test('copiar fórmula ajusta referencias relativas', () => {
  eq(Bx.shiftFormula('=A1+$B$2+C$3+Hoja1!D4+SUM(A1:B2)+"A1"', 2, 1), '=B3+$B$2+D$3+Hoja1!E6+SUM(B3:C4)+"A1"');
  eq(Bx.shiftFormula('=A1', -1, 0), '=#REF!');
});
test('insertar / eliminar filas ajusta fórmulas', () => {
  eq(Bx.structural('=SUM(A1:A10)+A5+A12', 'Hoja1', 'Hoja1', 'r', 4, -1), '=SUM(A1:A9)+#REF!+A11');
  eq(Bx.structural('=SUM(A1:A10)+A5', 'Hoja1', 'Hoja1', 'r', 2, 3), '=SUM(A1:A13)+A8');
});
test('renombrar hoja y exportar a formato Excel', () => {
  eq(Bx.renameSheetInFormula("='Datos 2'!A1+Hoja1!B2", 'Datos 2', 'Ventas'), '=Ventas!A1+Hoja1!B2');
  eq(Bx.toExcelFormula('SI(SUMA(A1:A3)>5;"a;b";MAYUSC("x"))'), 'IF(SUM(A1:A3)>5,"a;b",UPPER("x"))');
});
test('findRefs ubica referencias fuera de cadenas', () => {
  const refs = Bx.findRefs('=SUMA(A1:B2;$C$3)&"D4"&Hoja2!E5');
  eq(refs.map(r => r.sheet), [null, null, 'Hoja2']);
  eq(refs.length, 3);
});

// ---------- P0 bugs del motor ----------
test('celda suelta como argumento sigue reglas de rango (L-007)', () => {
  const b = book({ Hoja1: { A1: '10', B1: 'hola', C1: '5', B9: '=SUMA(A1;B1)', B10: '=MAX(A1;B1)', B11: '=PROMEDIO(A1;B1)', B12: '=CONTAR.BLANCO(G1)',
    B13: '=SUMA(A1;"hola")', B14: '=CONTAR(B1;C1)', B15: '=A1+B1', B16: '=SUMA(A1;C1;3)', B17: '=CONTAR.BLANCO(G1:G3;A1)', B18: '=IZQUIERDA("abc";G1)' } });
  eq(b.val('B9'), 10); eq(b.val('B10'), 10); eq(b.val('B11'), 10); eq(b.val('B12'), 1);
  eq(b.val('B13'), '#VALUE!'); eq(b.val('B14'), 1); eq(b.val('B15'), '#VALUE!'); eq(b.val('B16'), 18); eq(b.val('B17'), 3);
  eq(b.val('B18'), '');
});
test('celda con error como argumento propaga el error', () => {
  const b = book({ Hoja1: { A1: '=1/0', B1: '=SUMA(A1;1)', B2: '=SI.ERROR(A1;7)', B3: '=ESERROR(A1)' } });
  eq(b.val('B1'), '#DIV/0!'); eq(b.val('B2'), 7); eq(b.val('B3'), true);
});
test('BUSCARV / COINCIDIR con último argumento vacío = exacta', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', B1: 'uno', B2: 'dos', B3: 'tres',
    C1: '=BUSCARV(2,5;A1:B3;2;)', C2: '=BUSCARV(2;A1:B3;2;)', C3: '=COINCIDIR(2,5;A1:A3;)', C4: '=COINCIDIR(2,5;A1:A3)', C5: '=BUSCARV(2,5;A1:B3;2)',
    C6: '=BUSCARV("do*";B1:B3;1;FALSO)', C7: '=BUSCARV(2;A1:B3;3;FALSO)', C8: '=BUSCARV(2;A1:B3;0;FALSO)' } });
  eq(b.val('C1'), '#N/A'); eq(b.val('C2'), 'dos'); eq(b.val('C3'), '#N/A'); eq(b.val('C4'), 2); eq(b.val('C5'), 'dos');
  eq(b.val('C6'), 'dos'); eq(b.val('C7'), '#REF!'); eq(b.val('C8'), '#VALUE!');
});
test('separador de miles es-CL (punto + exactamente 3 dígitos)', () => {
  eq(Bx.literal('1.500'), 1500); eq(Bx.literal('12.345.678'), 12345678); eq(Bx.literal('-1.234,5'), -1234.5);
  eq(Bx.literal('3,5'), 3.5); eq(Bx.literal('1.5'), 1.5); eq(Bx.literal('1.50'), 1.5); eq(Bx.literal('1.5000'), 1.5); eq(Bx.literal('0.500'), 0.5);
  eq(Bx.literal('1,500'), 1.5);
  const b = book({ Hoja1: { A1: '1.500', B1: '=A1*2', B2: '=VALOR("2.000")' } });
  eq(b.val('B1'), 3000); eq(b.val('B2'), 2000);
});
test('criterios con fecha, %, booleano en CONTAR.SI / SUMAR.SI', () => {
  const b = book({ Hoja1: { A1: '15/12/2023', A2: '01/01/2024', A3: '10/03/2024', B1: '1', B2: '2', B3: '4', D1: '50%', D2: 'VERDADERO', D3: '1.500',
    C1: '=CONTAR.SI(A1:A3;">=01/01/2024")', C2: '=SUMAR.SI(A1:A3;"<01/01/2024";B1:B3)', C3: '=CONTAR.SI(A1:A3;"01/01/2024")',
    C4: '=CONTAR.SI(D1:D3;"50%")', C5: '=CONTAR.SI(D1:D3;VERDADERO)', C6: '=CONTAR.SI(D1:D3;">1.000")', C7: '=CONTAR.SI(D1:D3;"VERDADERO")' } });
  eq(b.val('C1'), 2); eq(b.val('C2'), 1); eq(b.val('C3'), 1); eq(b.val('C4'), 1); eq(b.val('C5'), 1); eq(b.val('C6'), 1); eq(b.val('C7'), 1);
});
test('SUSTITUIR con texto vacío y número de instancia', () => {
  const b = book({ Hoja1: { B1: '=SUSTITUIR("abc";"";"-")', B2: '=SUSTITUIR("a-b-c";"-";"+";2)', B3: '=SUSTITUIR("a-b";"-";"+";5)', B4: '=SUSTITUIR("a-b";"-";"+";0)' } });
  eq(b.val('B1'), 'abc'); eq(b.val('B2'), 'a-b+c'); eq(b.val('B3'), 'a-b'); eq(b.val('B4'), '#VALUE!');
});
test('fechas inválidas quedan como texto; FECHA con desbordes', () => {
  eq(Bx.literal('31/02/2024'), '31/02/2024'); eq(Bx.literal('29/02/2024'), Bx.literal('2024-02-29')); eq(Bx.literal('29/02/2023'), '29/02/2023');
  eq(Bx.literal('00/01/2024'), '00/01/2024'); eq(Bx.isDateLiteral('31/02/2024'), false); eq(Bx.isDateLiteral('28/02/2024'), true);
  const b = book({ Hoja1: { B1: '=FECHA(2024;14;1)', B2: '=FECHA(2025;2;1)', B3: '=FECHA(2024;3;0)', B4: '=FECHA(2024;2;29)', B5: '=FECHA(124;1;1)', B6: '=FECHA(2000;1;1)', B7: '=FECHA(-1;1;1)', B8: '=FECHA(10000;1;1)' } });
  eq(b.val('B1'), b.val('B2')); eq(b.val('B3'), b.val('B4'));
  eq(b.val('B5'), Bx.literal('01/01/2024')); eq(b.val('B6'), 36526); eq(b.val('B7'), '#NUM!'); eq(b.val('B8'), '#NUM!');
});
test('CONTARA cuenta fórmulas que devuelven ""; IZQUIERDA negativa; PRODUCTO vacío', () => {
  const b = book({ Hoja1: { A1: '=""', A2: '5', A3: '', B1: '=CONTARA(A1:A4)', B2: '=CONTAR.BLANCO(A1:A4)', B3: '=IZQUIERDA("abc";-1)', B4: '=PRODUCTO(C1:C3)',
    B5: '=DERECHA("abc";-1)', B6: '=IZQUIERDA("abc")', B7: '=PRODUCTO(2;3)', B8: '=EXTRAE("abc";1;-1)', B9: '=CONTARA(1;"";A3)' } });
  eq(b.val('B1'), 2); eq(b.val('B2'), 3); eq(b.val('B3'), '#VALUE!'); eq(b.val('B4'), 0); eq(b.val('B5'), '#VALUE!'); eq(b.val('B6'), 'a'); eq(b.val('B7'), 6);
  eq(b.val('B8'), '#VALUE!'); eq(b.val('B9'), 2);
});

// ---------- Columnas y filas completas ----------
test('A:A, $B:$C, 1:1 y Hoja2!A:A en el evaluador', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: 'x', A100: '7', B1: '3', C2: '4', E1: '=SUMA(A:A)', E2: '=SUMA($B:$C)', E3: '=SUMA(2:2)', E4: '=SUMA(Hoja2!A:A)',
    E5: '=CONTAR.SI(A:A;">1")', E6: '=SUMAR.SI(A:A;">1";B:B)', E7: '=BUSCARV(2;A:C;3;FALSO)', E8: '=COINCIDIR(7;A:A;0)', E9: '=CONTARA(A:A)', E10: '=A:A',
    E11: '=CONTAR.BLANCO(A:A)', E12: '=INDICE(A:A;100)', E13: '=SUMA(1:1)' }, Hoja2: { A1: '5', A3: '6' } });
  eq(b.val('E1'), 10); eq(b.val('E2'), 7); eq(b.val('E3'), 2 + 4 + 7); eq(b.val('E4'), 11); eq(b.val('E5'), 2); eq(b.val('E6'), 0); eq(b.val('E7'), 4);
  eq(b.val('E8'), 100); eq(b.val('E9'), 4); eq(b.val('E10'), '#SPILL!'); eq(b.val('E11'), 1048576 - 4); eq(b.val('E12'), 7);
  // E10: =A:A desborda y choca con E11 (matrices dinámicas)
  eq(b.val('E13'), 1 + 3 + 10);
});
test('A:A respeta recalc() al agregar celdas', () => {
  const b = book({ Hoja1: { A1: '1', B1: '=SUMA(A:A)' } });
  eq(b.val('B1'), 1);
  b.wb.sheets[0].cells.A5 = { v: '9' }; b.eng.recalc();
  eq(b.val('B1'), 10);
});
test('A:A y 1:1 en reescritura de referencias', () => {
  eq(Bx.shiftFormula('=SUMA(A:A)+SUMA($B:C)+SUMA(1:1)+Hoja2!A:A', 3, 1), '=SUMA(B:B)+SUMA($B:D)+SUMA(4:4)+Hoja2!B:B');
  eq(Bx.shiftFormula('=SUMA(A:A)', 0, -1), '=SUMA(#REF!)');
  eq(Bx.structural('=SUMA(A:A)+A5', 'Hoja1', 'Hoja1', 'r', 2, 3), '=SUMA(A:A)+A8');
  eq(Bx.structural('=SUMA(C:D)', 'Hoja1', 'Hoja1', 'c', 0, 1), '=SUMA(D:E)');
  eq(Bx.structural('=SUMA(B:B)', 'Hoja1', 'Hoja1', 'c', 1, -1), '=SUMA(#REF!)');
  eq(Bx.structural('=SUMA(3:5)', 'Hoja1', 'Hoja1', 'r', 0, 2), '=SUMA(5:7)');
  eq(Bx.renameSheetInFormula('=Datos!A:A', 'Datos', 'Ventas 1'), "='Ventas 1'!A:A");
  const refs = Bx.findRefs('=SUMA(A:A;$2:$3;Hoja2!B:C;D4)');
  eq(refs.length, 4); eq(refs[0].a.kind, 'col'); eq(refs[1].a.r, 1); eq(refs[1].b.r, 2); eq(refs[2].sheet, 'Hoja2'); eq(refs[3].a.kind, undefined);
  eq(Bx.refText(refs[1].a), '$2'); eq(Bx.refText(refs[0].b), 'A');
  eq(Bx.toExcelFormula('SUMA(A:A;1:1)'), 'SUM(A:A,1:1)');
  eq(Bx.findRefs('=SUMA(A1:').length, 1); // mientras se escribe un rango, A1 sigue resaltada
});

// ---------- Funciones nuevas ----------
const tabla = { A1: 'norte', A2: 'sur', A3: 'norte', A4: 'este', B1: '10', B2: '20', B3: '30', B4: '40', C1: 'x', C2: 'y', C3: 'y', C4: 'x' };
test('SUMAR.SI.CONJUNTO / CONTAR.SI.CONJUNTO / PROMEDIO.SI.CONJUNTO / MAX/MIN.SI.CONJUNTO', () => {
  const b = book({ Hoja1: { ...tabla, E1: '=SUMAR.SI.CONJUNTO(B1:B4;A1:A4;"norte";C1:C4;"y")', E2: '=CONTAR.SI.CONJUNTO(A1:A4;"<>sur";B1:B4;">15")',
    E3: '=PROMEDIO.SI.CONJUNTO(B1:B4;C1:C4;"x")', E4: '=SUMIFS(B1:B4;A1:A4;"n*")', E5: '=SUMAR.SI.CONJUNTO(B1:B4;A1:A3;"norte")',
    E6: '=PROMEDIO.SI.CONJUNTO(B1:B4;A1:A4;"oeste")', E7: '=MAX.SI.CONJUNTO(B1:B4;C1:C4;"x")', E8: '=MIN.SI.CONJUNTO(B1:B4;C1:C4;"y")', E9: '=MAX.SI.CONJUNTO(B1:B4;C1:C4;"z")',
    E10: '=CONTAR.SI.CONJUNTO(A:A;"norte")' } });
  eq(b.val('E1'), 30); eq(b.val('E2'), 2); eq(b.val('E3'), 25); eq(b.val('E4'), 40); eq(b.val('E5'), '#VALUE!'); eq(b.val('E6'), '#DIV/0!');
  eq(b.val('E7'), 40); eq(b.val('E8'), 20); eq(b.val('E9'), 0); eq(b.val('E10'), 2);
});
test('SI.CONJUNTO / SI.ND / ESNOD / ELEGIR', () => {
  const b = book({ Hoja1: { A1: '75', A2: '1', A3: '2', E1: '=SI.CONJUNTO(A1>=90;"A";A1>=70;"B";VERDADERO;"C")', E2: '=SI.CONJUNTO(A1>100;1)',
    E3: '=SI.ND(COINCIDIR(9;A2:A3;0);"no")', E4: '=SI.ND(1/0;"no")', E5: '=ESNOD(COINCIDIR(9;A2:A3;0))', E6: '=ESNOD(1/0)',
    E7: '=ELEGIR(2;"a";"b";"c")', E8: '=ELEGIR(4;"a";"b")', E9: '=SUMA(ELEGIR(1;A2:A3;A1))', E10: '=SI.ND(5;0)' } });
  eq(b.val('E1'), 'B'); eq(b.val('E2'), '#N/A'); eq(b.val('E3'), 'no'); eq(b.val('E4'), '#DIV/0!'); eq(b.val('E5'), true); eq(b.val('E6'), false);
  eq(b.val('E7'), 'b'); eq(b.val('E8'), '#VALUE!'); eq(b.val('E9'), 3); eq(b.val('E10'), 5);
});
test('BUSCARX', () => {
  const b = book({ Hoja1: { A1: '10', A2: '20', A3: '30', A4: '20', B1: 'a', B2: 'b', B3: 'c', B4: 'd', C1: 'x1', C2: 'x2', C3: 'x3', C4: 'x4',
    E1: '=BUSCARX(20;A1:A4;B1:B4)', E2: '=BUSCARX(25;A1:A4;B1:B4)', E3: '=BUSCARX(25;A1:A4;B1:B4;"nada")', E4: '=BUSCARX(25;A1:A4;B1:B4;;-1)',
    E5: '=BUSCARX(25;A1:A4;B1:B4;;1)', E6: '=BUSCARX(20;A1:A4;B1:B4;;0;-1)', E7: '=BUSCARX(20;A1:A4;B1:B3)', E8: '=SUMA(BUSCARX(30;A1:A4;A1:A4))',
    E9: '=BUSCARX("c*";B1:B4;A1:A4;;2)', E10: '=BUSCARX(5;A1:A4;B1:B4;;-1)', E11: '=XLOOKUP(20;A1:A4;C1:C4)' } });
  eq(b.val('E1'), 'b'); eq(b.val('E2'), '#N/A'); eq(b.val('E3'), 'nada'); eq(b.val('E4'), 'b'); eq(b.val('E5'), 'c'); eq(b.val('E6'), 'd');
  eq(b.val('E7'), '#VALUE!'); eq(b.val('E8'), 30); eq(b.val('E9'), 30); eq(b.val('E10'), '#N/A'); eq(b.val('E11'), 'x2');
});
test('BUSCARH e INDICE con fila/columna 0', () => {
  const b = book({ Hoja1: { A1: '1', B1: '2', C1: '3', A2: 'uno', B2: 'dos', C2: 'tres', E1: '=BUSCARH(2;A1:C2;2;FALSO)', E2: '=BUSCARH(2,5;A1:C2;2)',
    E3: '=BUSCARH(9;A1:C2;2;FALSO)', E4: '=BUSCARH(2;A1:C2;3;FALSO)', E5: '=SUMA(INDICE(A1:C2;1;0))', E6: '=INDICE(A1:C2;2;3)', E7: '=INDICE(A1:C2;3;1)' } });
  eq(b.val('E1'), 'dos'); eq(b.val('E2'), 'dos'); eq(b.val('E3'), '#N/A'); eq(b.val('E4'), '#REF!'); eq(b.val('E5'), 6); eq(b.val('E6'), 'tres'); eq(b.val('E7'), '#REF!');
});
test('TEXTO: formatos numéricos es-CL', () => {
  const b = book({ Hoja1: { A1: '1234,567', E1: '=TEXTO(A1;"0")', E2: '=TEXTO(A1;"0,00")', E3: '=TEXTO(A1;"#.##0")', E4: '=TEXTO(1234567,891;"#.##0,00")',
    E5: '=TEXTO(0,256;"0%")', E6: '=TEXTO(-5;"0,0")', E7: '=TEXTO(7;"000")', E8: '=TEXTO("hola";"0")', E9: '=TEXTO(1500;"$#.##0")', E10: '=TEXTO(-3;"0;(0)")',
    E11: '=TEXTO(0,5;"#,##")', E12: '=TEXTO(2,5;"0")', E13: '=TEXTO(3;"0 ""kg""")' } });
  eq(b.val('E1'), '1235'); eq(b.val('E2'), '1234,57'); eq(b.val('E3'), '1.235'); eq(b.val('E4'), '1.234.567,89'); eq(b.val('E5'), '26%'); eq(b.val('E6'), '-5,0');
  eq(b.val('E7'), '007'); eq(b.val('E8'), 'hola'); eq(b.val('E9'), '$1.500'); eq(b.val('E10'), '(3)'); eq(b.val('E11'), ',5'); eq(b.val('E12'), '3'); eq(b.val('E13'), '3 kg');
});
test('TEXTO: formatos de fecha y hora', () => {
  const b = book({ Hoja1: { A1: '05/03/2024', A2: '=A1+0,5+1/1440*7', E1: '=TEXTO(A1;"dd/mm/aaaa")', E2: '=TEXTO(A1;"dd-mm-aa")', E3: '=TEXTO(A1;"mmmm")',
    E4: '=TEXTO(A1;"dddd")', E5: '=TEXTO(A1;"aaaa")', E6: '=TEXTO(A2;"hh:mm")', E7: '=TEXTO(A1;"d \\de mmmm \\de yyyy")', E8: '=TEXTO(A1;"ddd mmm")', E9: '=TEXTO(-1;"dd/mm/aaaa")' } });
  eq(b.val('E1'), '05/03/2024'); eq(b.val('E2'), '05-03-24'); eq(b.val('E3'), 'marzo'); eq(b.val('E4'), 'martes'); eq(b.val('E5'), '2024'); eq(b.val('E6'), '12:07');
  eq(b.val('E7'), '5 de marzo de 2024'); eq(b.val('E8'), 'mar mar'); eq(b.val('E9'), '#VALUE!');
});
test('UNIRCADENAS / ENCONTRAR / HALLAR', () => {
  const b = book({ Hoja1: { A1: 'a', A2: '', A3: 'c', E1: '=UNIRCADENAS("-";VERDADERO;A1:A3)', E2: '=UNIRCADENAS("-";FALSO;A1:A3)', E3: '=UNIRCADENAS(", ";1;A1;"z";5)',
    E4: '=ENCONTRAR("b";"abcb")', E5: '=ENCONTRAR("b";"abcb";3)', E6: '=ENCONTRAR("B";"abc")', E7: '=HALLAR("B";"abc")', E8: '=HALLAR("c?";"abcd")',
    E9: '=HALLAR("x";"abc")', E10: '=ENCONTRAR("";"abc")', E11: '=ENCONTRAR("a";"abc";9)', E12: '=HALLAR("~*";"a*b")' } });
  eq(b.val('E1'), 'a-c'); eq(b.val('E2'), 'a--c'); eq(b.val('E3'), 'a, z, 5'); eq(b.val('E4'), 2); eq(b.val('E5'), 4); eq(b.val('E6'), '#VALUE!'); eq(b.val('E7'), 2);
  eq(b.val('E8'), 3); eq(b.val('E9'), '#VALUE!'); eq(b.val('E10'), 1); eq(b.val('E11'), '#VALUE!'); eq(b.val('E12'), 2);
});
test('SUMAPRODUCTO / K.ESIMO / JERARQUIA', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', B1: '4', B2: 'x', B3: '6', E1: '=SUMAPRODUCTO(A1:A3;B1:B3)', E2: '=SUMAPRODUCTO(A1:A3;B1:B2)', E3: '=SUMAPRODUCTO(A1:A3)',
    E4: '=K.ESIMO.MAYOR(A1:B3;2)', E5: '=K.ESIMO.MENOR(A1:B3;1)', E6: '=K.ESIMO.MAYOR(A1:A3;4)', E7: '=JERARQUIA(2;A1:A3)', E8: '=JERARQUIA(2;A1:A3;1)',
    E9: '=JERARQUIA(7;A1:A3)', E10: '=JERARQUIA.EQV(3;A1:A3)', E11: '=K.ESIMO.MENOR(A1:A3;0)' } });
  eq(b.val('E1'), 22); eq(b.val('E2'), '#VALUE!'); eq(b.val('E3'), 6); eq(b.val('E4'), 4); eq(b.val('E5'), 1); eq(b.val('E6'), '#NUM!');
  eq(b.val('E7'), 2); eq(b.val('E8'), 2); eq(b.val('E9'), '#N/A'); eq(b.val('E10'), 1); eq(b.val('E11'), '#NUM!');
});
test('DIASEM / FIN.MES / FECHA.MES / SIFECHA / DIAS.LAB', () => {
  const d = s => Bx.literal(s);
  const b = book({ Hoja1: { A1: '05/03/2024', A2: '31/01/2024', A3: '15/06/2020', E1: '=DIASEM(A1)', E2: '=DIASEM(A1;2)', E3: '=DIASEM(A1;3)', E4: '=DIASEM(A1;9)',
    E5: '=FIN.MES(A2;1)', E6: '=FIN.MES(A2;-2)', E7: '=FECHA.MES(A2;1)', E8: '=FECHA.MES(A2;-13)', E9: '=SIFECHA(A3;A1;"Y")', E10: '=SIFECHA(A3;A1;"M")',
    E11: '=SIFECHA(A3;A1;"D")', E12: '=SIFECHA(A3;A1;"MD")', E13: '=SIFECHA(A3;A1;"YM")', E14: '=SIFECHA(A1;A3;"D")', E15: '=DIAS.LAB(A2;A1)',
    E16: '=DIAS.LAB(A1;A2)', E17: '=DIAS.LAB(A1;A1+6;A1+1)', E18: '=DIASEM(A1;11)', E19: '=SIFECHA(A3;A1;"YD")', E20: '=SIFECHA(A3;A1;"X")' } });
  eq(b.val('E1'), 3); eq(b.val('E2'), 2); eq(b.val('E3'), 1); eq(b.val('E4'), '#NUM!'); eq(b.val('E5'), d('29/02/2024')); eq(b.val('E6'), d('30/11/2023'));
  eq(b.val('E7'), d('29/02/2024')); eq(b.val('E8'), d('31/12/2022')); eq(b.val('E9'), 3); eq(b.val('E10'), 44); eq(b.val('E11'), d('05/03/2024') - d('15/06/2020'));
  eq(b.val('E12'), 19); eq(b.val('E13'), 8); eq(b.val('E14'), '#NUM!'); eq(b.val('E15'), 25); eq(b.val('E16'), -25); eq(b.val('E17'), 4); eq(b.val('E18'), 2);
  eq(b.val('E19'), d('05/03/2024') - d('15/06/2023')); eq(b.val('E20'), '#NUM!');
});
test('TRUNCAR / MULTIPLO.SUPERIOR / MULTIPLO.INFERIOR', () => {
  const b = book({ Hoja1: { E1: '=TRUNCAR(8,97)', E2: '=TRUNCAR(-8,97;1)', E3: '=MULTIPLO.SUPERIOR(2,5;1)', E4: '=MULTIPLO.SUPERIOR(-2,5;-2)', E5: '=MULTIPLO.SUPERIOR(-2,5;2)',
    E6: '=MULTIPLO.SUPERIOR(2,5;-2)', E7: '=MULTIPLO.INFERIOR(2,5;1)', E8: '=MULTIPLO.INFERIOR(-2,5;-2)', E9: '=MULTIPLO.INFERIOR(-2,5;2)', E10: '=MULTIPLO.INFERIOR(2;0)',
    E11: '=MULTIPLO.SUPERIOR(0,3;0,1)', E12: '=MULTIPLO.SUPERIOR(5;0)' } });
  eq(b.val('E1'), 8); eq(b.val('E2'), -8.9); eq(b.val('E3'), 3); eq(b.val('E4'), -4); eq(b.val('E5'), -2); eq(b.val('E6'), '#NUM!'); eq(b.val('E7'), 2);
  eq(b.val('E8'), -2); eq(b.val('E9'), -4); eq(b.val('E10'), '#DIV/0!'); near(b.val('E11'), 0.3); eq(b.val('E12'), 0);
});
test('FILA / COLUMNA con y sin argumento', () => {
  const b = book({ Hoja1: { C5: '=FILA()', D7: '=COLUMNA()', E1: '=FILA(B9)', E2: '=COLUMNA(Hoja1!AA1)', E3: '=FILA(A3:B8)', E4: '=FILA(4:6)', E5: '=COLUMNA(C:D)', E6: '=FILA(5)' } });
  eq(b.val('C5'), 5); eq(b.val('D7'), 4); eq(b.val('E1'), 9); eq(b.val('E2'), 27); eq(b.val('E3'), '#SPILL!'); eq(b.val('E4'), '#SPILL!'); eq(b.val('E5'), 3); eq(b.val('E6'), '#VALUE!');
  // E3/E4: FILA de varias filas desborda ({3;…;8}) y choca con las celdas de abajo; E5: COLUMNA(C:D) desborda a F5
});
test('SUBTOTALES', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '=SUBTOTALES(9;A1:A2)', A4: '4', B1: '=SUBTOTALES(9;A1:A4)', B2: '=SUBTOTALES(109;A1:A4)', B3: '=SUBTOTALES(1;A1:A2)',
    B4: '=SUBTOTALES(2;A1:A4)', B5: '=SUBTOTALES(4;A1:A4)', B6: '=SUBTOTALES(12;A1:A4)', B7: '=SUBTOTALES(3;A1:A4)', B8: '=SUBTOTALES(6;C1:C2)' } });
  eq(b.val('A3'), 3); eq(b.val('B1'), 7); eq(b.val('B2'), 7); eq(b.val('B3'), 1.5); eq(b.val('B4'), 3); eq(b.val('B5'), 4); eq(b.val('B6'), '#VALUE!'); eq(b.val('B7'), 3); eq(b.val('B8'), 0);
});
test('VAR / DESVEST.P / financieras', () => {
  const b = book({ Hoja1: { A1: '2', A2: '4', A3: '4', A4: '4', A5: '5', A6: '5', A7: '7', A8: '9', E1: '=DESVEST.P(A1:A8)', E2: '=VAR.S(A1:A8)', E3: '=VAR(A1)',
    E4: '=PAGO(0,01;12;10000)', E5: '=VF(0,05;10;-100)', E6: '=VA(0,05;10;-100)', E7: '=PAGO(0;10;1000)', E8: '=VAR.P(A1:A8)' } });
  eq(b.val('E1'), 2); near(b.val('E2'), 32 / 7); eq(b.val('E3'), '#DIV/0!'); near(b.val('E4'), -888.4878867834166); near(b.val('E5'), 1257.789253554883);
  near(b.val('E6'), 772.1734929184818); eq(b.val('E7'), -100); eq(b.val('E8'), 4);
});
test('nombres canónicos y _xlfn al exportar', () => {
  eq(Bx.toExcelFormula('BUSCARX(1;A1:A3;B1:B3)+SUMAR.SI.CONJUNTO(B:B;A:A;"x")&TEXTO(1;"0")'), '_xlfn.XLOOKUP(1,A1:A3,B1:B3)+SUMIFS(B:B,A:A,"x")&TEXT(1,"0")');
  eq(Bx.toExcelFormula('SI.CONJUNTO(1;2)'), '_xlfn.IFS(1,2)');
  eq(Bx.CANON['K.ESIMO.MAYOR'], 'LARGE'); eq(Bx.CANON['DIAS.LAB'], 'NETWORKDAYS'); eq(Bx.CANON['JERARQUIA.EQV'], 'RANK.EQ');
});

test('horas escritas como valor de hora (fracción de día)', () => {
  near(Bx.literal('14:30'), 14.5 / 24); near(Bx.literal('06:00:30'), (6 * 3600 + 30) / 86400);
  eq(Bx.literal('25:99'), '25:99'); eq(Bx.isTimeLiteral('9:05'), true);
  near(Bx.literal('22/10/2026 12:00'), 46317.5); eq(Bx.isDateTimeLiteral('22/10/2026 12:00'), true);
  const b = book({ Hoja1: { A1: '08:30', A2: '17:45', B1: '=(A2-A1)*24' } });
  near(b.val('B1'), 9.25);
});

// ---------- Ciclo 2026-11-02: INDIRECTO, DESREF, financieras, estadísticas, FECHA ----------
// Compara con valores de la documentación de Excel, que vienen redondeados
const close = (a, b, tol = 1e-6) => assert.ok(typeof a === 'number' && Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('INDIRECTO: A1, otra hoja, rangos y #REF! para texto inválido', () => {
  const b = book({ Hoja1: { A1: '10', A2: '20', A3: '30', A5: '=1/0', B1: 'A2', B3: 'texto',
    E1: '=INDIRECTO("A2")', E2: '=INDIRECTO(B1)', E3: '=SUMA(INDIRECTO("A1:A3"))', E4: '=INDIRECTO("\'Hoja 2\'!B3")', E5: '=INDIRECTO("Datos!A1")*2',
    E6: '=INDIRECTO("xyz")', E7: '=INDIRECTO("")', E8: '=INDIRECTO(B2)', E9: '=INDIRECTO("Nada!A1")', E10: '=INDIRECTO("A0")', E11: '=INDIRECTO("XFE1")',
    E12: '=INDIRECTO("$A$3")', E13: '=INDIRECTO("a2")', E14: '=SUMA(INDIRECTO("A:A"))', E15: '=FILA(INDIRECTO("A3"))', E16: '=INDIRECTO("A1:A3")',
    E17: '=INDIRECTO(1/0)', E18: '=INDIRECTO("A5")', E19: '=SUMA(INDIRECTO("Datos!A1:A2"))', E20: '=INDIRECTO(B3)', E21: '=PROMEDIO(INDIRECTO("A1:B3"))',
    E22: '=INDIRECTO("Hoja 2!B3")', E23: '=SUMA(INDIRECTO("Datos!1:1"))', G1: '=INDIRECTO("G1")' },
    'Hoja 2': { B3: '7' }, Datos: { A1: '4', A2: '6' } });
  eq(b.val('E1'), 20); eq(b.val('E2'), 20); eq(b.val('E3'), 60); eq(b.val('E4'), 7); eq(b.val('E5'), 8);
  eq(b.val('E6'), '#REF!'); eq(b.val('E7'), '#REF!'); eq(b.val('E8'), '#REF!'); eq(b.val('E9'), '#REF!'); eq(b.val('E10'), '#REF!'); eq(b.val('E11'), '#REF!');
  eq(b.val('E12'), 30); eq(b.val('E13'), 20); eq(b.val('E14'), '#DIV/0!'); // A5 = 1/0 está en la columna
  eq(b.val('E15'), 3); eq(b.val('E16'), '#SPILL!'); // el rango desborda y choca con E17
  eq(b.val('E17'), '#DIV/0!'); eq(b.val('E18'), '#DIV/0!'); eq(b.val('E19'), 10); eq(b.val('E20'), '#REF!'); eq(b.val('E21'), 20);
  eq(b.val('E22'), '#REF!'); eq(b.val('G1'), '#CIRC!');
  eq(b.val('E23'), 4);
});
test('INDIRECTO: estilo F1C1/R1C1 y el argumento a1 omitido, vacío o celda vacía (L-008)', () => {
  const b = book({ Hoja1: { A1: '10', A2: '20', A3: '30',
    D2: '=INDIRECTO("F[1]C[-3]";FALSO)', D3: '=INDIRECTO("RC[-3]";FALSO)', E1: '=INDIRECTO("F2C1";FALSO)', E2: '=INDIRECTO("R2C1";FALSO)',
    E3: '=SUMA(INDIRECTO("F1C1:F3C1";FALSO))', E4: '=SUMA(INDIRECTO("C1";FALSO))', E5: '=INDIRECTO("A2";)', E6: '=INDIRECTO("A2";G1)',
    E7: '=INDIRECTO("A2";VERDADERO)', E8: '=INDIRECTO("F2C1";G1)', E9: '=INDIRECTO("F2C1")', E10: '=INDIRECTO("F0C1";FALSO)',
    E11: '=SUMA(INDIRECTO("\'Hoja2\'!F1:F2";FALSO))', E12: '=INDIRECTO("F1C1:C2";FALSO)', E13: '=INDIRECTO("A2";1)', E14: '=INDIRECTO("\'Hoja2\'!F1C1";0)' },
    Hoja2: { A1: '5', A2: '7' } });
  eq(b.val('D2'), 30); eq(b.val('D3'), 30); eq(b.val('E1'), 20); eq(b.val('E2'), 20); eq(b.val('E3'), 60); eq(b.val('E4'), 60);
  eq(b.val('E5'), '#REF!'); eq(b.val('E6'), '#REF!'); eq(b.val('E7'), 20); eq(b.val('E8'), 20); eq(b.val('E9'), '#REF!'); eq(b.val('E10'), '#REF!');
  eq(b.val('E11'), 12); eq(b.val('E12'), '#REF!'); eq(b.val('E13'), 20); eq(b.val('E14'), 5);
});
test('INDIRECTO y DESREF recalculan con dependencias dinámicas; son volátiles', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', B1: 'A2', C1: '2', E1: '=INDIRECTO(B1)', E2: '=SUMA(DESREF(A1;0;0;C1))' } });
  eq(b.val('E1'), 2); eq(b.val('E2'), 3);
  b.wb.sheets[0].cells.A2 = { v: '99' }; b.eng.recalc();
  eq(b.val('E1'), 99); eq(b.val('E2'), 100);
  b.wb.sheets[0].cells.B1 = { v: 'A3' }; b.wb.sheets[0].cells.C1 = { v: '3' }; b.eng.recalc();
  eq(b.val('E1'), 3); eq(b.val('E2'), 103);
  eq(Bx.VOLATILE.has('INDIRECT'), true); eq(Bx.VOLATILE.has('OFFSET'), true); eq(Bx.VOLATILE.has('SUM'), false);
});
test('DESREF: filas, columnas, alto, ancho, negativos y #REF! fuera de la hoja', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', A4: '4', A5: '5', B1: '10', B2: '20', B3: '30', B4: '40', B5: '50', C1: 'x',
    E1: '=DESREF(A1;2;1)', E2: '=SUMA(DESREF(A1;0;0;3))', E3: '=PROMEDIO(DESREF(A1:A2;1;0;3;2))', E4: '=DESREF(B3;-1;-1)',
    E5: '=DESREF(A1;-1;0)', E6: '=DESREF(A1;0;-1)', E7: '=DESREF(A1;1048576;0)', E8: '=SUMA(DESREF(A1:A2;1;0))', E9: '=SUMA(DESREF(A1:A2;1;0;;))',
    E10: '=SUMA(DESREF(A1;0;0;G1))', E11: '=SUMA(DESREF(A5;0;0;-3))', E12: '=SUMA(DESREF(B1;0;0;1;-2))', E13: '=DESREF(A1;;1)',
    E14: '=DESREF(5;1;1)', E15: '=DESREF(A1:A2;1;1)', E16: '=DESREF(A1;"x";0)', E17: '=DESREF(A1;1/0;0)', E18: '=SUMA(DESREF(A:A;0;1))',
    E19: '=FILA(DESREF(A1;3;0))', E20: '=DESREF(Hoja2!A1;1;0)', E21: '=DESREF(A1;1,9;0)', E22: '=SUMA(DESREF(INDIRECTO("A1");1;0;2))',
    E23: '=DESREF(A1;2)', E24: '=DESREF(A1;0;0;0)', E25: '=MAX(DESREF(A1;0;0;5;3))', E26: '=CONTAR(DESREF(A1;0;0;1;3))', E27: '=DESREF(A1;0;16383)',
    E28: '=DESREF(A1;0;16384)', E29: '=SUMA(DESREF(A1;0;0;G1;2))', E30: '=SUMA(DESREF(A1;C2;C2;2;2))', E31: '=DESREF(A3;-3;0;1)' },
    Hoja2: { A2: 'otra' } });
  eq(b.val('E1'), 30); eq(b.val('E2'), 6); eq(b.val('E3'), 16.5); eq(b.val('E4'), 2); eq(b.val('E5'), '#REF!'); eq(b.val('E6'), '#REF!'); eq(b.val('E7'), '#REF!');
  eq(b.val('E8'), 5); eq(b.val('E9'), 5); eq(b.val('E10'), '#REF!'); eq(b.val('E11'), 12); eq(b.val('E12'), 11); eq(b.val('E13'), 10);
  eq(b.val('E14'), '#VALUE!'); eq(b.val('E15'), '#SPILL!'); eq(b.val('E16'), '#VALUE!'); eq(b.val('E17'), '#DIV/0!'); eq(b.val('E18'), 150);
  eq(b.val('E19'), 4); eq(b.val('E20'), 'otra'); eq(b.val('E21'), 2); eq(b.val('E22'), 5); eq(b.val('E23'), '#VALUE!'); eq(b.val('E24'), '#REF!');
  eq(b.val('E25'), 50); eq(b.val('E26'), 2); eq(b.val('E27'), 0); eq(b.val('E28'), '#REF!'); eq(b.val('E29'), '#REF!'); eq(b.val('E30'), 33); eq(b.val('E31'), '#REF!');
});

test('Financieras: VA, VF y PAGO (documentación de Excel) y argumentos opcionales', () => {
  const b = book({ Hoja1: { A1: 'texto', A2: '10.000', A3: '=1/0',
    E1: '=VF(0,06/12;10;-200;-500;1)', E2: '=VA(0,08/12;12*20;500;;0)', E3: '=PAGO(0,08/12;10;10000)', E4: '=PAGO(0,06/12;18*12;0;50000)',
    E5: '=PAGO(0,08/12;10;10000;;)', E6: '=PAGO(0,08/12;10;10000;G1;G1)', E7: '=PAGO(0,08/12;10;A2)', E8: '=PAGO(A1;10;10000)', E9: '=PAGO(A3;10;10000)',
    E10: '=VF(0,06/12;10;-200;-500;G1)', E11: '=VF(0,06/12;10;-200;-500)', E12: '=VA(0,08/12;240;500)', E13: '=VA(0;10;-100;-50)', E14: '=VF(0;10;-100;-50)',
    E15: '=PAGO(0,1;0;1000)', E16: '=VA(0,08/12;240;500;G1;G1)' } });
  close(b.val('E1'), 2581.403374); close(b.val('E2'), -59777.145851); close(b.val('E3'), -1037.032089); close(b.val('E4'), -129.081161);
  eq(b.val('E5'), b.val('E3')); eq(b.val('E6'), b.val('E3')); eq(b.val('E7'), b.val('E3')); eq(b.val('E8'), '#VALUE!'); eq(b.val('E9'), '#DIV/0!');
  eq(b.val('E10'), b.val('E11')); eq(b.val('E12'), b.val('E2')); eq(b.val('E13'), 1050); eq(b.val('E14'), 1050); eq(b.val('E15'), '#NUM!'); eq(b.val('E16'), b.val('E2'));
});
test('Financieras: NPER y TASA (Newton con estimación)', () => {
  const b = book({ Hoja1: {
    E1: '=NPER(0,12/12;-100;-1000;10000;1)', E2: '=NPER(0,12/12;-100;-1000;10000)', E3: '=NPER(0,12/12;-100;-1000)', E4: '=NPER(0;-100;1000)',
    E5: '=NPER(0;0;1000)', E6: '=NPER(0,1;-10;1000)', E7: '=NPER(0,01;-100;-1000;10000;;)', E8: '=NPER(0,01;-100;-1000;10000;G1)',
    T1: '=TASA(4*12;-200;8000)', T2: '=TASA(48;-200;8000;;;)', T3: '=TASA(48;-200;8000;G1;G1;G1)', T4: '=TASA(48;-200;8000;0;0;0,5)',
    T5: '=TASA(10;100;1000)', T6: '=TASA(0;-200;8000)', T7: '=TASA(10;-100;1000)', T8: '=TASA(12;-1000;10000;0;1)', T9: '=TASA(4*12;-200;8000)*12',
    T10: '=TASA(10;0;-100;200)' } });
  close(b.val('E1'), 59.6738657); close(b.val('E2'), 60.0821229); close(b.val('E3'), -9.57859404); eq(b.val('E4'), 10);
  eq(b.val('E5'), '#NUM!'); eq(b.val('E6'), '#NUM!'); eq(b.val('E7'), b.val('E2')); eq(b.val('E8'), b.val('E2'));
  close(b.val('T1'), 0.00770147249, 1e-10); close(b.val('T2'), b.val('T1'), 1e-12); close(b.val('T3'), b.val('T1'), 1e-12); close(b.val('T4'), b.val('T1'), 1e-12);
  eq(b.val('T5'), '#NUM!'); eq(b.val('T6'), '#NUM!'); close(b.val('T7'), 0, 1e-12); close(b.val('T9'), 0.09241767, 1e-7);
  close(b.val('T10'), Math.pow(2, 1 / 10) - 1, 1e-12);
  // TASA(12;-1000;10000;0;1): verificación inversa con VA
  const r = b.val('T8'), pv = -(-1000 * (1 + r) * (Math.pow(1 + r, 12) - 1) / r) / Math.pow(1 + r, 12);
  close(pv, 10000, 1e-6);
});
test('Financieras: PAGOINT y PAGOPRIN (tipo 0/1 y período fuera de rango)', () => {
  const b = book({ Hoja1: {
    E1: '=PAGOINT(0,1/12;1;3*12;8000)', E2: '=PAGOINT(10%;3;3;8000)', E3: '=PAGOPRIN(10%/12;1;2*12;2000)', E4: '=PAGOPRIN(8%;10;10;200000)',
    E5: '=PAGOINT(10%;0;3;8000)', E6: '=PAGOINT(10%;4;3;8000)', E7: '=PAGOINT(10%;1;3;8000;0;1)', E8: '=PAGOINT(10%;2;3;8000;0;1)',
    E9: '=PAGOINT(0;2;4;1000)', E10: '=PAGOPRIN(0;2;4;1000)', E11: '=PAGOINT(10%;2;3;8000;;)', E12: '=PAGOINT(10%;2;3;8000;G1;G1)', E13: '=PAGOINT(10%;2;3;8000)',
    E14: '=PAGOINT(10%;2;3;8000)+PAGOPRIN(10%;2;3;8000)', E15: '=PAGO(10%;3;8000)', E16: '=PAGOPRIN(10%;1;3;8000;0;1)+PAGOPRIN(10%;2;3;8000;0;1)+PAGOPRIN(10%;3;3;8000;0;1)',
    E17: '=PAGOPRIN(10%;5;3;8000)', E18: '=PAGOINT("x";1;3;8000)' } });
  close(b.val('E1'), -66.6666667); close(b.val('E2'), -292.4471299); close(b.val('E3'), -75.623186); close(b.val('E4'), -27598.053462);
  eq(b.val('E5'), '#NUM!'); eq(b.val('E6'), '#NUM!'); eq(b.val('E7'), 0); close(b.val('E8'), -(8000 - 2924.47129909) * 0.1, 1e-4);
  eq(b.val('E9'), 0); eq(b.val('E10'), -250); eq(b.val('E11'), b.val('E13')); eq(b.val('E12'), b.val('E13'));
  near(b.val('E14'), b.val('E15')); close(b.val('E16'), -8000, 1e-8); eq(b.val('E17'), '#NUM!'); eq(b.val('E18'), '#VALUE!');
});
test('Financieras: VNA, TIR, VNA.NO.PER y TIR.NO.PER (documentación de Excel)', () => {
  const b = book({ Hoja1: { A1: '-70000', A2: '12000', A3: '15000', A4: '18000', A5: '21000', A6: '26000',
    B1: '-40000', B2: '8000', B3: '9200', B4: '10000', B5: '12000', B6: '14500', B7: 'texto',
    C1: '-10000', C2: '2750', C3: '4250', C4: '3250', C5: '2750', D1: '01/01/2008', D2: '01/03/2008', D3: '30/10/2008', D4: '15/02/2009', D5: '01/04/2009', D7: '01/05/2008', D8: '01/03/2008',
    F1: '5', F2: '=1/0', F3: 'x', F4: '6',
    E1: '=VNA(10%;-10000;3000;4200;6800)', E2: '=VNA(8%;B2:B6)+B1', E3: '=VNA(8%;B2:B6;-9000)+B1', E4: '=VNA(8%;B2:B7)+B1', E5: '=VNA(-1;1;2)',
    E6: '=VNA(8%;F1:F2)', E7: '=VNA(10%;F1;F3;F4)', E8: '=VNA(10%;5;"x")',
    I1: '=TIR(A1:A5)', I2: '=TIR(A1:A6)', I3: '=TIR(A1:A3;-10%)', I4: '=TIR(A2:A6)', I5: '=TIR(A1:A6;)', I6: '=TIR(A1:A6;G1)', I7: '=TIR(B1:B7)',
    I8: '=TIR(F1:F2)',
    X1: '=VNA.NO.PER(0,09;C1:C5;D1:D5)', X2: '=TIR.NO.PER(C1:C5;D1:D5)', X3: '=VNA.NO.PER(0,09;C1:C5;D1:D4)', X4: '=TIR.NO.PER(C1:C5;D1:D4)',
    X5: '=VNA.NO.PER(0,09;C1:C2;D2:D3)', X6: '=TIR.NO.PER(C1:C5;D1:D5;0,5)', X7: '=TIR.NO.PER(C2:C5;D2:D5)', X8: '=VNA.NO.PER(0,09;C1:C2;F3:F4)',
    X9: '=TIR.NO.PER(C1:C5;D1:D5;)', X10: '=VNA.NO.PER(0,09;C2:C3;D7:D8)' } });
  close(b.val('E1'), 1188.443412); close(b.val('E2'), 1922.061555); close(b.val('E3'), -3749.47, 0.005); eq(b.val('E4'), b.val('E2')); eq(b.val('E5'), '#DIV/0!');
  eq(b.val('E6'), '#DIV/0!'); close(b.val('E7'), 5 / 1.1 + 6 / 1.21, 1e-9); eq(b.val('E8'), '#VALUE!');
  close(b.val('I1'), -0.021244848); close(b.val('I2'), 0.086630948); close(b.val('I3'), -0.443506941); eq(b.val('I4'), '#NUM!');
  close(b.val('I5'), b.val('I2'), 1e-12); close(b.val('I6'), b.val('I2'), 1e-12); assert.ok(typeof b.val('I7') === 'number'); eq(b.val('I8'), '#DIV/0!');
  close(b.val('X1'), 2086.647602); close(b.val('X2'), 0.373362535); eq(b.val('X3'), '#NUM!'); eq(b.val('X4'), '#NUM!');
  close(b.val('X5'), -10000 + 2750 / Math.pow(1.09, (Bx.literal('30/10/2008') - Bx.literal('01/03/2008')) / 365));
  close(b.val('X6'), b.val('X2'), 1e-10); eq(b.val('X7'), '#NUM!'); eq(b.val('X8'), '#VALUE!'); close(b.val('X9'), b.val('X2'), 1e-10); eq(b.val('X10'), '#NUM!');
});

test('MODA / MODA.UNO / PERCENTIL / CUARTIL (documentación de Excel)', () => {
  const b = book({ Hoja1: { A1: '5,6', A2: '4', A3: '4', A4: '3', A5: '2', A6: '4', A7: 'texto',
    B1: '1', B2: '3', B3: '2', B4: '4', B5: 'x', B6: '=1/0',
    C1: '1', C2: '2', C3: '3', C4: '6', C5: '6', C6: '6', C7: '7', C8: '8', C9: '9',
    D1: '1', D2: '2', D3: '4', D4: '7', D5: '8', D6: '9', D7: '10', D8: '12',
    F1: '6', F2: '7', F3: '15', F4: '36', F5: '39', F6: '40', F7: '41', F8: '42', F9: '43', F10: '47', F11: '49',
    E1: '=MODA(A1:A7)', E2: '=MODA.UNO(A1:A6)', E3: '=MODA(B1:B4)', E4: '=MODA(1;2;2;1)', E5: '=MODA(1;"3";3;3)', E6: '=MODA(B1:B6)', E7: '=MODA(G1:G3)',
    P1: '=PERCENTIL.INC(B1:B4;0,3)', P2: '=PERCENTIL(B1:B5;0,3)', P3: '=PERCENTIL.EXC(C1:C9;0,25)', P4: '=PERCENTIL.EXC(C1:C9;0)', P5: '=PERCENTIL.EXC(C1:C9;0,01)',
    P6: '=PERCENTIL.EXC(C1:C9;2)', P7: '=PERCENTIL.INC(B1:B4;1)', P8: '=PERCENTIL.INC(B1:B4;1,1)', P9: '=PERCENTIL.INC(B1:B4;G1)', P10: '=PERCENTIL.INC(B1:B4;)',
    P11: '=PERCENTIL.INC(B1:B6;0,5)', P12: '=PERCENTIL.INC(G1:G3;0,5)', P13: '=PERCENTIL.INC(5;0,5)', P14: '=PERCENTIL.INC(B1:B4;"x")',
    Q1: '=CUARTIL(D1:D8;1)', Q2: '=CUARTIL.INC(D1:D8;0)', Q3: '=CUARTIL.INC(D1:D8;4)', Q4: '=CUARTIL.INC(D1:D8;5)', Q5: '=CUARTIL.INC(D1:D8;-1)',
    Q6: '=CUARTIL.INC(D1:D8;1,9)', Q7: '=CUARTIL.EXC(F1:F11;1)', Q8: '=CUARTIL.EXC(F1:F11;3)', Q9: '=CUARTIL.EXC(F1:F11;0)', Q10: '=CUARTIL.EXC(F1:F11;4)',
    Q11: '=CUARTIL.INC(D1:D8;2)', Q12: '=CUARTIL.INC(D1:D8;G1)' } });
  eq(b.val('E1'), 4); eq(b.val('E2'), 4); eq(b.val('E3'), '#N/A'); eq(b.val('E4'), 1); eq(b.val('E5'), 3); eq(b.val('E6'), '#DIV/0!'); eq(b.val('E7'), '#N/A');
  close(b.val('P1'), 1.9, 1e-12); close(b.val('P2'), 1.9, 1e-12); close(b.val('P3'), 2.5, 1e-12); eq(b.val('P4'), '#NUM!'); eq(b.val('P5'), '#NUM!'); eq(b.val('P6'), '#NUM!');
  eq(b.val('P7'), 4); eq(b.val('P8'), '#NUM!'); eq(b.val('P9'), 1); eq(b.val('P10'), 1); eq(b.val('P11'), '#DIV/0!'); eq(b.val('P12'), '#NUM!'); eq(b.val('P13'), 5);
  eq(b.val('P14'), '#VALUE!');
  close(b.val('Q1'), 3.5, 1e-12); eq(b.val('Q2'), 1); eq(b.val('Q3'), 12); eq(b.val('Q4'), '#NUM!'); eq(b.val('Q5'), '#NUM!'); close(b.val('Q6'), 3.5, 1e-12);
  eq(b.val('Q7'), 15); eq(b.val('Q8'), 43); eq(b.val('Q9'), '#NUM!'); eq(b.val('Q10'), '#NUM!'); eq(b.val('Q11'), 7.5); eq(b.val('Q12'), 1);
});
test('COEF.DE.CORREL / PEARSON / COEFICIENTE.R2 / PENDIENTE / INTERSECCION.EJE / PRONOSTICO', () => {
  const b = book({ Hoja1: { A1: '3', A2: '2', A3: '4', A4: '5', A5: '6', B1: '9', B2: '7', B3: '12', B4: '15', B5: '17',
    C1: '2', C2: '3', C3: '9', C4: '1', C5: '8', C6: '7', C7: '5', D1: '6', D2: '5', D3: '11', D4: '7', D5: '5', D6: '4', D7: '4',
    F1: '6', F2: '7', F3: '9', F4: '15', F5: '21', H1: '20', H2: '28', H3: '31', H4: '38', H5: '40',
    I1: '1', I2: 'x', I3: '3', J1: '2', J2: '5', J3: '6', K1: '4', K2: '4', K3: '4', L1: '=1/0', L2: '2',
    E1: '=COEF.DE.CORREL(A1:A5;B1:B5)', E2: '=PEARSON(A1:A5;B1:B5)', E3: '=COEFICIENTE.R2(C1:C7;D1:D7)', E4: '=PENDIENTE(C1:C7;D1:D7)',
    E5: '=INTERSECCION.EJE(C1:C5;D1:D5)', E6: '=PRONOSTICO(30;F1:F5;H1:H5)', E7: '=PRONOSTICO.LINEAL(30;F1:F5;H1:H5)', E8: '=COEF.DE.CORREL(A1:A5;B1:B4)',
    E9: '=PENDIENTE(C1:C7;D1:D6)', E10: '=COEF.DE.CORREL(I1:I3;J1:J3)', E11: '=PENDIENTE(J1:J3;K1:K3)', E12: '=COEF.DE.CORREL(J1:J3;K1:K3)',
    E13: '=PENDIENTE(G1:G3;G4:G6)', E14: '=COEF.DE.CORREL(G1:G3;G4:G6)', E15: '=PRONOSTICO("x";F1:F5;H1:H5)', E16: '=PENDIENTE(L1:L2;J1:J2)',
    E17: '=INTERSECCION.EJE(C1:C7;D1:D6)', E18: '=PRONOSTICO(G1;F1:F5;H1:H5)', E19: '=PENDIENTE(I1:I3;J1:J3)', E20: '=PEARSON(9;7)',
    E21: '=INTERSECCION.EJE(F1:F5;H1:H5)' } });
  close(b.val('E1'), 0.997054486); close(b.val('E2'), 0.997054486); close(b.val('E3'), 0.05795, 1e-5); close(b.val('E4'), 0.305556, 1e-6);
  close(b.val('E5'), 0.0483871, 1e-7); close(b.val('E6'), 10.607253); close(b.val('E7'), 10.607253); eq(b.val('E8'), '#N/A'); eq(b.val('E9'), '#N/A');
  close(b.val('E10'), 1, 1e-12); eq(b.val('E11'), '#DIV/0!'); eq(b.val('E12'), '#DIV/0!'); eq(b.val('E13'), '#N/A'); eq(b.val('E14'), '#DIV/0!'); eq(b.val('E15'), '#VALUE!');
  eq(b.val('E16'), '#DIV/0!'); eq(b.val('E17'), '#N/A'); near(b.val('E18'), b.val('E21'));
  close(b.val('E19'), 0.5, 1e-12); eq(b.val('E20'), '#DIV/0!'); // I2 es texto: el par (5, "x") se omite
});
test('JERARQUIA.MEDIA / MEDIA.ACOTADA / PROMEDIOA / MAXA / MINA', () => {
  const b = book({ Hoja1: { A1: '89', A2: '88', A3: '92', A4: '101', A5: '94', A6: '97', A7: '95', B1: '1', B2: '2', B3: '2', B4: '3', B5: 'x',
    C1: '4', C2: '5', C3: '6', C4: '7', C5: '2', C6: '3', C7: '4', C8: '5', C9: '1', C10: '2', C11: '3',
    D1: '10', D2: '7', D3: '9', D4: '2', D5: 'No disponible', F1: '10', F2: 'texto', F3: 'VERDADERO', F4: 'FALSO', F5: '', F6: '=1/0', H1: '-1', H2: 'VERDADERO', H3: '5', H4: 'x',
    E1: '=JERARQUIA.MEDIA(94;A1:A7)', E2: '=JERARQUIA.MEDIA(2;B1:B5)', E3: '=JERARQUIA.MEDIA(2;B1:B5;1)', E4: '=JERARQUIA.MEDIA(2;B1:B5;)', E5: '=JERARQUIA.MEDIA(2;B1:B5;G1)',
    E6: '=JERARQUIA.MEDIA(7;B1:B5)', E7: '=JERARQUIA.MEDIA(2;5)', E8: '=JERARQUIA.MEDIA(3;B1:B4;1)',
    M1: '=MEDIA.ACOTADA(C1:C11;0,2)', M2: '=MEDIA.ACOTADA(C1:C11;0)', M3: '=MEDIA.ACOTADA(C1:C11;1)', M4: '=MEDIA.ACOTADA(C1:C11;-0,1)', M5: '=MEDIA.ACOTADA(G1:G3;0,1)',
    M6: '=MEDIA.ACOTADA(B1:B5;0,5)', M7: '=MEDIA.ACOTADA(C1:C11;G1)',
    V1: '=PROMEDIOA(D1:D5)', V2: '=PROMEDIOA(F1:F5)', V3: '=PROMEDIO(F1:F5)', V4: '=PROMEDIOA(1;VERDADERO;"2")', V5: '=PROMEDIOA(1;"x")', V6: '=PROMEDIOA(G1:G3)',
    V7: '=PROMEDIOA(F1:F6)', V8: '=PROMEDIOA(F2)', V9: '=MAXA(H1:H2)', V10: '=MINA(H3:H4)', V11: '=MAXA(G1:G2)', V12: '=MAX(H1:H2)', V13: '=MINA(H3;H4)' } });
  eq(b.val('E1'), 4); eq(b.val('E2'), 2.5); eq(b.val('E3'), 2.5); eq(b.val('E4'), 2.5); eq(b.val('E5'), 2.5); eq(b.val('E6'), '#N/A'); eq(b.val('E7'), '#VALUE!'); eq(b.val('E8'), 4);
  close(b.val('M1'), 3.777777778); near(b.val('M2'), 42 / 11); eq(b.val('M3'), '#NUM!'); eq(b.val('M4'), '#NUM!'); eq(b.val('M5'), '#NUM!'); eq(b.val('M6'), 2); near(b.val('M7'), 42 / 11);
  close(b.val('V1'), 5.6, 1e-12); eq(b.val('V2'), 2.75); eq(b.val('V3'), 10); near(b.val('V4'), 4 / 3); eq(b.val('V5'), '#VALUE!'); eq(b.val('V6'), '#DIV/0!');
  eq(b.val('V7'), '#DIV/0!'); eq(b.val('V8'), 0); eq(b.val('V9'), 1); eq(b.val('V10'), 0); eq(b.val('V11'), 0); eq(b.val('V12'), -1); eq(b.val('V13'), 0);
});
test('FECHA: años 0–1899 suman 1900; enero y febrero de 1900 como Excel (serial 1 = 01/01/1900)', () => {
  const d = s => Bx.literal(s);
  const b = book({ Hoja1: { A1: '01/01/1900',
    E1: '=FECHA(25;1;1)', E2: '=FECHA(108;1;2)', E3: '=FECHA(0;1;1)', E4: '=FECHA(1900;1;1)', E5: '=FECHA(1900;3;1)', E6: '=FECHA(1899;12;31)',
    E7: '=AÑO(1)', E8: '=MES(1)', E9: '=DIA(1)', E10: '=DIA(59)', E11: '=DIASEM(1)', E12: '=DIASEM(61)', E13: '=TEXTO(1;"dd/mm/aaaa")', E14: '=FECHA(1900;1;0)',
    E15: '=FECHA(1900;1;-1)', E16: '=FECHA(25,9;1;1)', E17: '=FECHA(9999;12;31)', E18: '=DIASEM(A1)', E19: '=FECHA(1900;2;28)' } });
  eq(b.val('E1'), d('01/01/1925')); eq(b.val('E2'), d('02/01/2008')); eq(b.val('E2'), 39449); eq(b.val('E3'), 1); eq(b.val('E4'), 1); eq(b.val('E5'), 61);
  eq(b.val('E6'), d('31/12/3799')); eq(b.val('E7'), 1900); eq(b.val('E8'), 1); eq(b.val('E9'), 1); eq(b.val('E10'), 28); eq(b.val('E11'), 1); eq(b.val('E12'), 5);
  eq(b.val('E13'), '01/01/1900'); eq(b.val('E14'), 0); eq(b.val('E15'), '#NUM!'); eq(b.val('E16'), d('01/01/1925')); eq(b.val('E17'), 2958465); eq(b.val('A1'), 1);
  eq(b.val('E18'), 1); eq(b.val('E19'), 59); eq(d('01/03/1900'), 61); eq(d('28/02/1900'), 59);
});
test('errores en español en fórmulas (#¡REF!, #N/D, …) y exportación', () => {
  const b = book({ Hoja1: { A1: '=#¡REF!', A2: '=SI.ERROR(#¡DIV/0!;1)', A3: '=ESNOD(#n/d)', A4: '=#¿NOMBRE?', A5: '=#¡VALOR!', A6: '=#¡NUM!', A7: '=SI.ERROR(#¡',
    A8: '=ESERROR(#N/A)', A9: '="#¡REF!"' } });
  eq(b.val('A1'), '#REF!'); eq(b.val('A2'), 1); eq(b.val('A3'), true); eq(b.val('A4'), '#NAME?'); eq(b.val('A5'), '#VALUE!'); eq(b.val('A6'), '#NUM!');
  eq(b.val('A7'), '#VALUE!'); eq(b.val('A8'), true); eq(b.val('A9'), '#¡REF!');
  eq(Bx.ERR_ES['#N/A'], '#N/D'); eq(Bx.ERR_ES['#VALUE!'], '#¡VALOR!'); eq(Bx.ERR_ES['#REF!'], '#¡REF!');
  eq(Bx.toExcelFormula('SI.ERROR(#¡VALOR!;"#¡REF!")+#n/d'), 'IFERROR(#VALUE!,"#¡REF!")+#N/A');
  // L-009: el tokenizador cambió; las fórmulas a medio escribir siguen resaltando sus referencias
  eq(Bx.findRefs('=SI.ERROR(#¡REF!;A1').length, 1); eq(Bx.findRefs('=#N/D+A1:').length, 1); eq(Bx.findRefs('=SI.ERROR(#¡').length, 0);
  eq(Bx.findRefs('=INDIRECTO("A1")+DESREF(B2;').map(r => r.start), [24]);
});
test('nombres canónicos y _xlfn de las funciones nuevas', () => {
  eq(Bx.CANON['DESREF'], 'OFFSET'); eq(Bx.CANON['INDIRECTO'], 'INDIRECT'); eq(Bx.CANON['TIR.NO.PER'], 'XIRR'); eq(Bx.CANON['VNA.NO.PER'], 'XNPV');
  eq(Bx.CANON['PAGOINT'], 'IPMT'); eq(Bx.CANON['PAGOPRIN'], 'PPMT'); eq(Bx.CANON['TASA'], 'RATE'); eq(Bx.CANON['MODA.UNO'], 'MODE.SNGL');
  eq(Bx.CANON['INTERSECCION.EJE'], 'INTERCEPT'); eq(Bx.CANON['JERARQUIA.MEDIA'], 'RANK.AVG'); eq(Bx.CANON['MEDIA.ACOTADA'], 'TRIMMEAN');
  eq(Bx.toExcelFormula('PERCENTIL.INC(A1:A3;0,5)+TIR.NO.PER(A1:A3;B1:B3)+SUMA(DESREF(A1;1;0;2))'), '_xlfn.PERCENTILE.INC(A1:A3,0.5)+XIRR(A1:A3,B1:B3)+SUM(OFFSET(A1,1,0,2))');
  eq(Bx.toExcelFormula('PRONOSTICO.LINEAL(1;A1:A3;B1:B3)+PRONOSTICO(1;A1:A3;B1:B3)'), '_xlfn.FORECAST.LINEAR(1,A1:A3,B1:B3)+FORECAST(1,A1:A3,B1:B3)');
});

// ---------- Ronda 2 (2026-11-02): toRaw, SUBTOTALES/AGREGAR con filas ocultas, horas, vacío = 0 ----------
test('toRaw: número → texto es-CL que literal() relee exacto (nunca String(v))', () => {
  const vals = [1.234, 0.984, 3.234, 1e-7, 1.5e-7, 1e21, -1.234, -0.5, -1e-7, 123456789012345680000, 9007199254740991, 0.1 + 0.2, 0, -0, 1234.5,
    2.125, 12.345, 999.999, 1 / 3, Math.PI, 46317.5, 5e-324, 1.7976931348623157e308, 100, 1000000];
  for (const v of vals) assert.ok(Bx.literal(Bx.toRaw(v)) === v || (v === 0 && Bx.literal(Bx.toRaw(v)) === 0), `${v} → ${Bx.toRaw(v)} → ${Bx.literal(Bx.toRaw(v))}`);
  for (let i = 0; i < 2000; i++) { const v = (Math.random() - 0.5) * Math.pow(10, Math.floor(Math.random() * 30 - 15)); assert.strictEqual(Bx.literal(Bx.toRaw(v)), v); }
  eq(Bx.toRaw(1.234), '1,234'); eq(Bx.toRaw(1.5e-7), '1,5E-7'); eq(Bx.toRaw(1e21), '1E+21'); eq(Bx.toRaw(-0), '0'); eq(Bx.toRaw(1234.5), '1234,5');
  eq(Bx.toRaw(true), 'VERDADERO'); eq(Bx.toRaw(false), 'FALSO'); eq(Bx.toRaw(null), '');
  // el texto que se reinterpretaría queda forzado como texto
  for (const s of ['hola', '1.234', '3,5', '01/02/2024', '14:30', 'VERDADERO', '50%', '=A1', "'x", '', '  ', 'a;b']) eq(Bx.literal(Bx.toRaw(s)), s);
  eq(Bx.toRaw('hola'), 'hola'); eq(Bx.toRaw('1.234'), "'1.234"); eq(Bx.toRaw('=A1'), "'=A1");
});
test('PROMEDIO/MIN/MAX: argumento vacío escrito cuenta como 0; PRODUCTO/SUMA lo ignoran; celda vacía se ignora (L-008)', () => {
  const b = book({ Hoja1: { E1: '=PROMEDIO(1;;3)', E2: '=MIN(5;)', E3: '=MAX(;-1)', E4: '=PRODUCTO(2;;3)', E5: '=PROMEDIO(1;G1;3)', E6: '=MIN(5;G1)',
    E7: '=MAX(G1;-1)', E8: '=PRODUCTO(2;G1;3)', E9: '=SUMA(1;;3)', E10: '=MAXA(;-1)', E11: '=MINA(5;)', E12: '=PROMEDIOA(1;;3)', E13: '=MINA(5;G1)',
    E14: '=PROMEDIO(10;20;30;)', E15: '=MIN(3;2;)', E16: '=PROMEDIO(G1:G3;)' } });
  near(b.val('E1'), 4 / 3); eq(b.val('E2'), 0); eq(b.val('E3'), 0); eq(b.val('E4'), 6); eq(b.val('E5'), 2); eq(b.val('E6'), 5); eq(b.val('E7'), -1); eq(b.val('E8'), 6);
  eq(b.val('E9'), 4); eq(b.val('E10'), 0); eq(b.val('E11'), 0); near(b.val('E12'), 4 / 3); eq(b.val('E13'), 5); eq(b.val('E14'), 15); eq(b.val('E15'), 0); eq(b.val('E16'), 0);
});
// Tabla A2:A6 = 10..50; fila 4 (índice 3, A4=30) filtrada; fila 5 (índice 4, A5=40) oculta a mano
const subtCells = { A1: 'Monto', A2: '10', A3: '20', A4: '30', A5: '40', A6: '50', A7: '=SUBTOTALES(9;A2:A3)', C1: '1', D1: '2', E1: '3', F1: '4', G1: '5',
  B1: '=SUBTOTALES(9;A2:A6)', B2: '=SUBTOTALES(109;A2:A6)', B3: '=SUBTOTALES(1;A2:A6)', B4: '=SUBTOTALES(101;A2:A6)', B5: '=SUBTOTALES(2;A2:A6)',
  B6: '=SUBTOTALES(102;A2:A6)', B7: '=SUBTOTALES(4;A2:A6)', B8: '=SUBTOTALES(105;A2:A6)', B9: '=SUBTOTALES(9;A2:A7)', B10: '=SUMA(A2:A7)',
  B11: '=SUBTOTALES(109;C1:G1)', B12: '=SUBTOTALES(3;A1:A6)', B13: '=SUBTOTALES(9;A:A)', B14: '=SUBTOTALES(109;A2:A6;A2:A3)' };
test('SUBTOTALES: 1–11 excluyen filtradas, 101–111 también ocultas a mano; ignora SUBTOTALES anidadas (modelo)', () => {
  const b = book({ Hoja1: subtCells });
  const sh = b.wb.sheets[0];
  eq(b.val('B1'), 150); eq(b.val('B2'), 150); // sin filas ocultas
  sh.filter = { r: 0, c1: 0, c2: 0, r2: 5, crit: { 0: ['10', '20', '40', '50'] }, hidden: [3] }; sh.hiddenR = [4]; sh.hiddenC = [3]; b.eng.recalc();
  eq(b.val('B1'), 120); eq(b.val('B2'), 80); eq(b.val('B3'), 30); near(b.val('B4'), 80 / 3); eq(b.val('B5'), 4); eq(b.val('B6'), 3); eq(b.val('B7'), 50); eq(b.val('B8'), 10);
  eq(b.val('B9'), 120); eq(b.val('B10'), 180); eq(b.val('B11'), 15); eq(b.val('B12'), 5); eq(b.val('B13'), 120 + 0); eq(b.val('B14'), 80 + 30);
  // la fórmula se recalcula al cambiar el filtro
  sh.filter.hidden = []; b.eng.recalc();
  eq(b.val('B1'), 150); eq(b.val('B2'), 110);
});
test('SUBTOTALES: errores, argumentos inválidos y error en fila filtrada', () => {
  const b = book({ Hoja1: { A1: '1', A2: '=1/0', A3: '3', B1: '=SUBTOTALES(9;A1:A3)', B2: '=SUBTOTALES(12;A1:A3)', B3: '=SUBTOTALES(9)', B4: '=SUBTOTALES(9;5)',
    B5: '=SUBTOTALES(0;A1:A3)', B6: '=SUBTOTALES(112;A1:A3)', B7: '=SUBTOTALES(9;A1:A3;)', B8: '=SUBTOTALES(109,7;A1;A3)' } });
  eq(b.val('B1'), '#DIV/0!'); eq(b.val('B2'), '#VALUE!'); eq(b.val('B3'), '#VALUE!'); eq(b.val('B4'), '#VALUE!'); eq(b.val('B5'), '#VALUE!'); eq(b.val('B6'), '#VALUE!');
  eq(b.val('B7'), '#VALUE!'); eq(b.val('B8'), 4);
  b.wb.sheets[0].filter = { r: 0, c1: 0, c2: 0, r2: 2, crit: {}, hidden: [1] }; b.eng.recalc();
  eq(b.val('B1'), 4); // el error está en una fila filtrada
});
test('SUBTOTALES: gancho de estado de filas (eng.setRowState y Bx.setRowState)', () => {
  const b = book({ Hoja1: subtCells });
  const calls = [];
  b.eng.setRowState((sheet, r, si) => { calls.push([sheet.name, r, si]); return { filtered: r === 1, hidden: r === 5 }; });
  eq(b.val('B1'), 140); eq(b.val('B2'), 90); eq(calls[0][0], 'Hoja1'); eq(calls[0][2], 0);
  b.eng.setRowState(null); b.eng.recalc();
  eq(b.val('B1'), 150);
  Bx.setRowState(() => ({ filtered: true }));
  try { const b2 = book({ Hoja1: subtCells }); eq(b2.val('B1'), 0); eq(b2.val('B5'), 0); } finally { Bx.setRowState(null); }
  const b3 = book({ Hoja1: subtCells }); eq(b3.val('B1'), 150);
});
test('AGREGAR: ejemplos de la documentación de Excel, opciones de ocultas, errores y anidados', () => {
  const A = ['=1/0', '72', '30', '=RAIZ(-1)', '31', '96', '32', '81', '33', '53', '34'], B = ['82', '65', '95', '63', '53', '71', '55', '83', '100', '91', '89'];
  const cells = {};
  A.forEach((v, i) => { cells['A' + (i + 1)] = v; cells['B' + (i + 1)] = B[i]; });
  Object.assign(cells, { C1: '1', C2: '2', C3: '=SUBTOTALES(9;C1:C2)', C4: '=AGREGAR(9;0;C1:C2)',
    E1: '=AGREGAR(4;6;A1:A11)', E2: '=AGREGAR(14;6;A1:A11;3)', E3: '=AGREGAR(15;6;A1:A11)', E4: '=AGREGAR(12;6;A1:A11;B1:B11)', E5: '=MAX(A1:A2)',
    E6: '=AGREGAR(9;4;A1:A11)', E7: '=AGREGAR(9;;B1:B3)', E8: '=AGREGAR(9;G1;B1:B3)', E9: '=AGREGAR(9;5;B1:B3)', E10: '=AGREGAR(9;4;B1:B3)', E11: '=AGREGAR(9;0;B1:B3)',
    E12: '=AGREGAR(9;1;B1:B3)', E13: '=AGREGAR(14;6;A1:A11;)', E14: '=AGREGAR(20;0;B1:B3)', E15: '=AGREGAR(9;8;B1:B3)', E16: '=AGREGAR(9;0;C1:C4)',
    E17: '=AGREGAR(9;4;C1:C4)', E18: '=AGREGAR(16;6;A1:A11;0,5)', E19: '=AGREGAR(17;6;A1:A11;2)', E20: '=AGREGAR(2;3;A1:A11)', E21: '=AGREGAR(9;7;A1:B3)',
    E22: '=AGREGAR(9;2;C1:C4)', E23: '=AGREGAR(13;6;B1:B11)', E24: '=AGREGAR(9;6;5)', E25: '=AGREGAR(9;6)' });
  const b = book({ Hoja1: cells });
  b.wb.sheets[0].hiddenR = [1]; b.wb.sheets[0].filter = { r: 0, c1: 1, c2: 1, r2: 10, crit: {}, hidden: [2] }; b.eng.recalc();
  // filas 2 (oculta a mano) y 3 (filtrada): B2 = 65, B3 = 95; A2 = 72, A3 = 30
  eq(b.val('E5'), '#DIV/0!'); eq(b.val('E3'), '#VALUE!'); eq(b.val('E6'), '#DIV/0!');
  eq(b.val('E7'), 242); eq(b.val('E8'), 242); eq(b.val('E9'), 82); eq(b.val('E10'), 242); eq(b.val('E11'), 242); eq(b.val('E12'), 82);
  eq(b.val('E13'), '#VALUE!'); eq(b.val('E14'), '#VALUE!'); eq(b.val('E15'), '#VALUE!'); eq(b.val('E16'), 3); eq(b.val('E17'), 9);
  eq(b.val('E20'), 7); eq(b.val('E21'), 82); eq(b.val('E22'), 3); eq(b.val('E23'), '#N/A'); eq(b.val('E24'), '#VALUE!'); eq(b.val('E25'), '#VALUE!');
  // sin filas ocultas: valores de la documentación (96, 72, 68)
  b.wb.sheets[0].hiddenR = []; delete b.wb.sheets[0].filter; b.eng.recalc();
  eq(b.val('E1'), 96); eq(b.val('E2'), 72); eq(b.val('E4'), 68); eq(b.val('E18'), 34); eq(b.val('E19'), 34);
  eq(Bx.toExcelFormula('AGREGAR(9;6;A1:A3)+SUBTOTALES(109;A1:A3)'), '_xlfn.AGGREGATE(9,6,A1:A3)+SUBTOTAL(109,A1:A3)');
});
test('HORA / MINUTO / SEGUNDO / NSHORA / HORANUMERO', () => {
  const b = book({ Hoja1: { A1: '14:30', A2: '22/10/2026 07:45', A3: "'14:30", A4: '16:48:18', A5: 'hola', A6: '0,75', A7: '46317,75', A8: '1,5', A9: '=0,5+0,6/86400',
    H1: '=HORA(A6)', H2: '=HORA("14:30")', H3: '=HORA(A1)', H4: '=HORA(A2)', H5: '=HORA(A8)', H6: '=HORA(G1)', H7: '=HORA(-1)', H8: '=HORA("abc")',
    H9: '=MINUTO("12:45:00")', H10: '=SEGUNDO(A4)', H11: '=SEGUNDO(NSHORA(1;2;3))', H12: '=MINUTO(A2)', H13: '=HORA(A3)', H14: '=MINUTO(A1)', H15: '=SEGUNDO(A9)',
    H16: '=HORA(A5)', H17: '=MINUTO(1/0)', H18: '=HORA(A7)', H19: '=SEGUNDO(G1)',
    T1: '=NSHORA(12;0;0)', T2: '=NSHORA(16;48;10)', T3: '=NSHORA(25;0;0)', T4: '=NSHORA(0;-1;0)', T5: '=NSHORA(1;-30;0)', T6: '=NSHORA(0;750;0)',
    T7: '=NSHORA(32768;0;0)', T8: '=NSHORA(1,9;0;0)', T9: '=NSHORA(14;30;)', T10: '=NSHORA(14;30;G1)', T11: '=NSHORA("14";"30";0)', T12: '=NSHORA("x";0;0)',
    T13: '=NSHORA(24;0;0)', T14: '=NSHORA(0;0;3661)', T15: '=A2-ENTERO(A2)-NSHORA(7;45;0)',
    V1: '=HORANUMERO("02:24")', V2: '=HORANUMERO("22/08/2011 06:35")', V3: '=HORANUMERO("25:00")', V4: '=HORANUMERO(A1)', V5: '=HORANUMERO(A3)',
    V6: '=HORANUMERO(G1)', V7: '=HORANUMERO("hola")', V8: '=HORANUMERO(0,5)', V9: '=HORANUMERO("22/10/2026")', V10: '=HORANUMERO(" 14:30:15 ")', V11: '=HORANUMERO(1/0)' } });
  eq(b.val('H1'), 18); eq(b.val('H2'), 14); eq(b.val('H3'), 14); eq(b.val('H4'), 7); eq(b.val('H5'), 12); eq(b.val('H6'), 0); eq(b.val('H7'), '#NUM!'); eq(b.val('H8'), '#VALUE!');
  eq(b.val('H9'), 45); eq(b.val('H10'), 18); eq(b.val('H11'), 3); eq(b.val('H12'), 45); eq(b.val('H13'), 14); eq(b.val('H14'), 30); eq(b.val('H15'), 1);
  eq(b.val('H16'), '#VALUE!'); eq(b.val('H17'), '#DIV/0!'); eq(b.val('H18'), 18); eq(b.val('H19'), 0);
  eq(b.val('T1'), 0.5); close(b.val('T2'), 0.700115741, 1e-9); near(b.val('T3'), 1 / 24); close(b.val('T3'), 0.041666, 1e-6); eq(b.val('T4'), '#NUM!'); near(b.val('T5'), 0.5 / 24);
  near(b.val('T6'), 12.5 / 24); eq(b.val('T7'), '#NUM!'); near(b.val('T8'), 1 / 24); eq(b.val('T9'), Bx.literal('14:30')); eq(b.val('T10'), Bx.literal('14:30'));
  eq(b.val('T11'), Bx.literal('14:30')); eq(b.val('T12'), '#VALUE!'); eq(b.val('T13'), 0); near(b.val('T14'), 3661 / 86400); close(b.val('T15'), 0, 1e-9);
  near(b.val('V1'), 0.1); close(b.val('V2'), 0.274305556, 1e-9); near(b.val('V3'), 1 / 24); eq(b.val('V4'), '#VALUE!'); eq(b.val('V5'), Bx.literal('14:30'));
  eq(b.val('V6'), '#VALUE!'); eq(b.val('V7'), '#VALUE!'); eq(b.val('V8'), '#VALUE!'); eq(b.val('V9'), 0); near(b.val('V10'), (14 * 3600 + 30 * 60 + 15) / 86400); eq(b.val('V11'), '#DIV/0!');
  eq(Bx.CANON['NSHORA'], 'TIME'); eq(Bx.CANON['HORANUMERO'], 'TIMEVALUE'); eq(Bx.toExcelFormula('NSHORA(14;30;0)+HORA(A1)'), 'TIME(14,30,0)+HOUR(A1)');
});

// ---------- Ronda 3 (2026-11-02): sintaxis es-CL estricta, conversión .xlsx, 15 cifras, colación ----------
// Ejecuta fn con la sintaxis es-CL estricta (la de por omisión) y restaura la vigente
function strict(fn) { const prev = Bx.getSyntax(); Bx.setSyntax('es-CL'); try { fn(); } finally { Bx.setSyntax(prev); } }
test('la sintaxis por omisión es es-CL; legacy solo si se pide explícitamente', () => {
  eq(Bx.getSyntax(), 'es-CL');
  const b = book({ Hoja1: { A1: '=RAIZ(2,25)', A2: '=SUM(1,5)', A3: '=SI(1>0,1,0)' } });
  eq(b.val('A1'), 1.5); eq(b.val('A2'), 1.5); eq(b.val('A3'), '#VALUE!');
  legacy(() => { eq(Bx.getSyntax(), 'legacy'); b.eng.recalc(); eq(b.val('A2'), 6); eq(b.val('A3'), 1); });
  eq(Bx.getSyntax(), 'es-CL');
  const prev = Bx.getSyntax();
  try { Bx.setSyntax(); eq(Bx.getSyntax(), 'es-CL'); Bx.setSyntax('otra'); eq(Bx.getSyntax(), 'es-CL'); } finally { Bx.setSyntax(prev); }
});

test('sintaxis es-CL estricta: la coma siempre es decimal y ";" separa (P0: =RAIZ(2,25) = 1,5)', () => strict(() => {
  const b = book({ Hoja1: { A1: '10', B1: '=RAIZ(2,25)', B2: '=ABS(-2,5)', B3: '=HORA(0,75)', B4: '=SUMA(1,5;2)', B5: '=SUMA(A1,5)', B6: '=SI(A1>0,1,0)',
    B7: '=SUM(1,5)', B8: "='Hoja 1,5'!A1*2,25", B9: '=1,5E-3*2', B10: '=A1*1.5', B11: '=SUMA(1;,5)', B12: '=TEXTO(1234,5;"#.##0,00")', B13: '=SI(A1>1;"a,b";0,5)',
    B14: '=ENTERO(2,7)', B15: '=REDONDEAR(2,345;2)', B16: '=50%*A1', B17: '=SUMA(1,5,3)', B18: '=A1*1,5', B19: '=CONTAR.SI(A1:A1;">9,5")', B20: '="x"&1,5' },
    'Hoja 1,5': { A1: '4' } });
  eq(b.val('B1'), 1.5); eq(b.val('B2'), 2.5); eq(b.val('B3'), 18); eq(b.val('B4'), 3.5); eq(b.val('B5'), '#VALUE!'); eq(b.val('B6'), '#VALUE!');
  eq(b.val('B7'), 1.5); eq(b.val('B8'), 9); eq(b.val('B9'), 0.003); eq(b.val('B10'), 15); eq(b.val('B11'), 1.5); eq(b.val('B12'), '1.234,50'); eq(b.val('B13'), 'a,b');
  eq(b.val('B14'), 2); eq(b.val('B15'), 2.35); eq(b.val('B16'), 5); eq(b.val('B17'), '#VALUE!'); eq(b.val('B18'), 15); eq(b.val('B19'), 1); eq(b.val('B20'), 'x1,5');
}));
test('cambiar la sintaxis invalida la caché de fórmulas', () => legacy(() => {
  const b = book({ Hoja1: { B1: '=SUM(1,5)', B2: '=RAIZ(2,25)' } });
  eq(b.val('B1'), 6);
  strict(() => { b.eng.recalc(); eq(b.val('B1'), 1.5); eq(b.val('B2'), 1.5); });
  b.eng.recalc(); eq(b.val('B1'), 6);
}));
// Corpus en es-CL canónico (nombres en español, VERDADERO/FALSO, errores en español, coma decimal, \ en matrices)
const CORPUS = ['=SUMA(A1:A3;1,5)', '=SI(A1>0,5;"a;b, c";FALSO)', "='Hoja 1,5'!A1*2,25", '=SUMA({1\\2;3\\4})', '=SUMA({1,5\\2;3\\4,25})', '=SUMA({"a,b"\\"c;d"})',
  '=REDONDEAR(2,5;0)+A1*1,5%', '=BUSCARV("x";Datos!A:B;2;FALSO)', '=SI.ERROR(1/0;#N/D)', '=TEXTO(1234,5;"#.##0,00")', '=RAIZ(2,25)', '=ABS(-2,5)', '=1,5E-3*2',
  '=CONCATENAR("a";"b")&CONCAT("c")', '=K.ESIMO.MAYOR($A$1:$B$9;2)', '=VERDADERO+1', '=SUMA(Hoja2!1:1)+SUMA($A:$B)', '=BUSCARX(1;A1:A3;B1:B3)', "='O''Brien'!A1",
  '="a,;{}\\b"&""""', 'PI()', '=SUMA( A1 ; 2 )', '=#¡REF!+#¡DIV/0!', '=Y(A1>0;NO(FALSO))', '=PROMEDIO.SI.CONJUNTO(B:B;A:A;">0,5")', '=DESREF($A$1;1;0;2)',
  '=,5+1', '=SI(A1="";"";A1*0,19)', '=TIR.NO.PER(B1:B5;C1:C5;0,1)', '=AGREGAR(9;6;A1:A3)', '=-2^2%', '=FECHA(2026;10;22)+NSHORA(14;30;0)', '=MAX(;-1)'];
test('fromExcelFormula(toExcelFormula(f)) === f sobre un corpus es-CL; ejemplos de .xlsx', () => strict(() => {
  for (const f of CORPUS) eq(Bx.fromExcelFormula(Bx.toExcelFormula(f)), f);
  eq(Bx.toExcelFormula('=SUMA({1,5\\2;3\\4,25})'), '=SUM({1.5,2;3,4.25})'); eq(Bx.toExcelFormula('SI(A1>0,5;"a;b";FALSO)'), 'IF(A1>0.5,"a;b",FALSE)');
  eq(Bx.toExcelFormula('CONCATENAR("a";"b")&CONCAT("c")'), 'CONCATENATE("a","b")&_xlfn.CONCAT("c")');
  eq(Bx.fromExcelFormula('IF(A1>0,1,0)'), 'SI(A1>0;1;0)'); eq(Bx.fromExcelFormula('SUM(1,5)'), 'SUMA(1;5)'); eq(Bx.fromExcelFormula('ROUND(2.5,0)'), 'REDONDEAR(2,5;0)');
  eq(Bx.fromExcelFormula('_xlfn.XLOOKUP(1.5,A:A,B:B,"no",0)'), 'BUSCARX(1,5;A:A;B:B;"no";0)'); eq(Bx.fromExcelFormula('SUM({1,2;3,4})'), 'SUMA({1\\2;3\\4})');
  eq(Bx.fromExcelFormula("'Q1, 2024'!A1+TRUE"), "'Q1, 2024'!A1+VERDADERO"); eq(Bx.fromExcelFormula('FOO(1.5,2)'), 'FOO(1,5;2)');
  eq(Bx.fromExcelFormula('=_xlfn._xlws.SORT(A1:A3)'), '=ORDENAR(A1:A3)'); eq(Bx.fromExcelFormula('IFERROR(A1,#N/A)&#DIV/0!'), 'SI.ERROR(A1;#N/D)&#¡DIV/0!');
  eq(Bx.fromExcelFormula('TRUE!A1'), 'TRUE!A1'); eq(Bx.fromExcelFormula('SUM(Sheet1.2024!A1,1E+3)'), 'SUMA(Sheet1.2024!A1;1E+3)');
  // lo importado se evalúa igual que en Excel
  const b = book({ Hoja1: { A1: '2', B1: '=' + Bx.fromExcelFormula('ROUND(A1*1.255,2)+IF(A1>1,0.5,0)'), B2: '=' + Bx.fromExcelFormula('SQRT(2.25)') } });
  eq(b.val('B1'), 3.01); eq(b.val('B2'), 1.5);
}));
test('migrateLegacyFormula: la regla vieja una sola vez, mismo resultado en es-CL estricto', () => legacy(() => {
  eq(Bx.migrateLegacyFormula('=SUM(1,5)'), '=SUMA(1;5)'); eq(Bx.migrateLegacyFormula('=SUMA(1,5;2)'), '=SUMA(1,5;2)'); eq(Bx.migrateLegacyFormula('=A1*1,5'), '=A1*1,5');
  eq(Bx.migrateLegacyFormula('=SI(A1>0,1,0)'), '=SI(A1>0;1;0)'); eq(Bx.migrateLegacyFormula('=A1*1.5'), '=A1*1,5'); eq(Bx.migrateLegacyFormula('=SI(A1>1;"a,b";0,5)'), '=SI(A1>1;"a,b";0,5)');
  eq(Bx.migrateLegacyFormula('=RAIZ(2,25)'), '=RAIZ(2;25)'); // conserva el resultado viejo (1,414…) y deja visible el argumento de más
  // nombres en español, como fromExcelFormula (lo que muestra la barra de fórmulas tras abrir un archivo viejo)
  eq(Bx.migrateLegacyFormula('=SUM(1,5;2)'), '=SUMA(1,5;2)'); eq(Bx.migrateLegacyFormula('=IF(A1>5,TRUE,#N/A)'), '=SI(A1>5;VERDADERO;#N/D)');
  eq(Bx.migrateLegacyFormula('=_xlfn.CONCAT("SUM(1,5)";FOO(1,5))'), '=CONCAT("SUM(1,5)";FOO(1,5))'); eq(Bx.migrateLegacyFormula('=TRUE!A1+Sum (1)'), '=TRUE!A1+SUMA (1)');
  const LEG = ['=SUM(1,5)', '=SUMA(1,5;2)', '=A1*1,5', '=SI(A1>0,1,0)', '=IF(A1>5,1,0)', '=A1*1.5', '=SI(A1>1;"a,b";0,5)', '=ROUND(2.5,0)+A1', '=REDONDEAR(2,5;0)',
    '=INDEX(B1:C2,2,2)', '=VLOOKUP(2,B1:C2,2,0)', '=MAX(0,5)', '=SUMA(A1;1,25)', '=TEXTO(A1;"0,00")', '=1,5+A1', "='Mis datos'!A1*2", '=CONTAR.SI(B1:C2;">1,5")'];
  const cells = { A1: '10', B1: '1', B2: '2', C1: '3', C2: '4' }, sheets = names => ({ Hoja1: { ...cells, ...names }, 'Mis datos': { A1: '21' } });
  const old = {}, mig = {};
  LEG.forEach((f, i) => { old['E' + (i + 1)] = f; mig['E' + (i + 1)] = Bx.migrateLegacyFormula(f); });
  const vals = legacy(() => { const b1 = book(sheets(old)); return LEG.map((_, i) => b1.val('E' + (i + 1))); });
  strict(() => { const b2 = book(sheets(mig)); LEG.forEach((f, i) => assert.deepStrictEqual(b2.val('E' + (i + 1)), vals[i], `${f} → ${mig['E' + (i + 1)]}`)); });
}));
test('sintaxis estricta y fórmulas a medio escribir (L-009)', () => strict(() => {
  const b = book({ Hoja1: { B1: '=SUMA(1,5;A1:', B2: '=SI(A1="ab', B3: "='Hoja 1", B4: '=SUMA(1,', B5: '=SUMA({1\\2', B6: '=RAIZ(2,' } });
  for (const k of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) assert.ok(String(b.val(k)).startsWith('#'), k);
  eq(Bx.findRefs('=SUMA(1,5;A1:').length, 1); eq(Bx.findRefs('=SUMA(1,5;A1:B').length, 1);
  eq(Bx.fromExcelFormula('SUM(A1,"ab'), 'SUMA(A1;"ab'); eq(Bx.toExcelFormula('=SI(A1="x'), '=IF(A1="x'); eq(Bx.toExcelFormula("='Hoja 1"), "='Hoja 1");
  eq(Bx.migrateLegacyFormula('=SUMA(1,5;'), '=SUMA(1,5;'); eq(Bx.fromExcelFormula('SUM({1,2'), 'SUMA({1\\2');
  eq(Bx.migrateLegacyFormula('=SUM(1,'), '=SUMA(1;'); eq(Bx.migrateLegacyFormula('=IF("a'), '=SI("a');
}));
// Excel es-CL acepta el decimal final: "=1," vale 1 (como "=1." en inglés). Al .xlsx se exporta sin él (la gramática
// de fórmulas de [MS-XLSX] exige dígitos después del punto). "1,E3" no tiene fuente: se acepta por coherencia (1000).
test('números es-CL en fórmulas: decimal final "1,", ",5", "1,5E3", "1,E3", "1,5%" (L-051)', () => strict(() => {
  const b = book({ Hoja1: { A1: '4', B1: '=1,', B2: '=A1*1,', B3: '=,5+1', B4: '=1,5E3', B5: '=1,E3', B6: '=1,5%', B7: '=1,%', B8: '=SUMA(1,;2)', B9: '=-1,+A1',
    B10: '=1,e-2', B11: '=SUMA(1,,5)', B12: '=1,,', B13: '=SUMA(1,5,3)', B14: '=A1,', B15: '=,E3', B16: '=SI(A1>3,;"s";"n")', B17: '="x"&2,' } });
  eq(b.val('B1'), 1); eq(b.val('B2'), 4); eq(b.val('B3'), 1.5); eq(b.val('B4'), 1500); eq(b.val('B5'), 1000); eq(b.val('B6'), 0.015); eq(b.val('B7'), 0.01);
  eq(b.val('B8'), 3); eq(b.val('B9'), 3); eq(b.val('B10'), 0.01); eq(b.val('B16'), 's'); eq(b.val('B17'), 'x2');
  for (const k of ['B11', 'B12', 'B13', 'B14', 'B15']) assert.ok(String(b.val(k)).startsWith('#'), k);
  for (const f of ['=1,', '=A1*1,', '=,5', '=1,5E3', '=1,E3', '=1,5%', '=SUMA(1,;2)', '=RAIZ(2,)']) eq(Bx.checkFormula(f), null);
  for (const f of ['=1,,', '=SUMA(1,5,3)', '=A1,', '=SUMA(A1,5)', '=,E3']) eq(Bx.checkFormula(f).message, 'Hay un problema con esta fórmula.');
  // .xlsx sin decimal final; ida y vuelta conserva el valor
  eq(Bx.toExcelFormula('=A1*1,+1,E3-1,5E3'), '=A1*1+1E3-1.5E3'); eq(Bx.toExcelFormula('=SUMA(1,;"1,")'), '=SUM(1,"1,")');
  eq(Bx.fromExcelFormula('=1.+1.E3'), '=1,+1,E3'); eq(Bx.toExcelFormula('=SUMA(1,,5)'), '=SUM(1..5)'); // no se pega en "1.5"
  // a medio escribir (L-009): cada prefijo se evalúa, valida y convierte sin excepciones
  const F = '=SUMA(1,;A1*1,E3;,5%)&"1,"';
  for (let i = 1; i <= F.length; i++) {
    const p = F.slice(0, i), c = book({ Hoja1: { A1: '2', D9: p } });
    c.val('D9'); Bx.checkFormula(p); Bx.findRefs(p); Bx.fromExcelFormula(Bx.toExcelFormula(p));
  }
  eq(Bx.findRefs('=A1*1,').length, 1); eq(Bx.findRefs('=SUMA(1,;A1:').length, 1);
  // modo legacy (punto decimal): "1." también es un número
  legacy(() => { const l = book({ Hoja1: { B1: '=1.*3', B2: '=1.E2', B3: '=1..5' } }); eq(l.val('B1'), 3); eq(l.val('B2'), 100); assert.ok(String(l.val('B3')).startsWith('#')); });
}));

test('comparación con 15 cifras significativas en operadores y criterios; exacta en búsquedas', () => strict(() => {
  const b = book({ Hoja1: { A1: '=0,1+0,2', A2: 'x', A3: '0,3', B1: '0,3',
    E1: '=0,1+0,2=0,3', E2: '=0,1+0,2<>0,3', E3: '=0,1+0,2>0,3', E4: '=0,1+0,2<=0,3', E5: '=10,01-10=0,01', E6: '=0,1=(1,2-1,1)', E7: '=(A1-0,3)', E8: '=1+1E-14=1', E20: '=A1-0,3',
    E9: '=CONTAR.SI(A1:A2;0,3)', E10: '=CONTAR.SI(A1:A2;"=0,3")', E11: '=CONTAR.SI(A1:A2;">0,3")', E12: '=SUMAR.SI.CONJUNTO(B1:B1;A1:A1;"<=0,3")', E13: '=COINCIDIR(0,3;A1:A1;0)',
    E14: '=BUSCARV(0,3;A1:B1;2;FALSO)', E15: '=A1=A3', E16: '=CONTAR.SI(A1:A1;"<>0,3")', E17: '=SI(A1=0,3;"igual";"distinto")', E18: '=1E+300*10=1E+301', E19: '=CONTAR.SI(A1:A1;A3)' } });
  eq(b.val('E1'), true); eq(b.val('E2'), false); eq(b.val('E3'), false); eq(b.val('E4'), true); eq(b.val('E5'), false); eq(b.val('E6'), false);
  assert.ok(b.val('E7') !== 0 && Math.abs(b.val('E7')) < 1e-16, 'el valor no se redondea'); eq(b.val('E8'), false);
  eq(b.val('E20'), 0); // resta final de primer nivel: ajuste "cerca de cero" (entre paréntesis, E7, conserva el residuo)
  eq(b.val('E9'), 1); eq(b.val('E10'), 1); eq(b.val('E11'), 0); eq(b.val('E12'), 0.3); eq(b.val('E13'), '#N/A'); eq(b.val('E14'), '#N/A'); eq(b.val('E15'), true);
  eq(b.val('E16'), 0); eq(b.val('E17'), 'igual'); eq(b.val('E18'), true); eq(b.val('E19'), 1);
  near(b.val('A1'), 0.30000000000000004); eq(Bx.compareVals(0.1 + 0.2, 0.3), 1); // ordenar y buscar: valor exacto
}));
test('número → texto con coma decimal es-CL (&, CONCATENAR, IZQUIERDA, LARGO)', () => {
  const b = book({ Hoja1: { A1: '1,5', A2: '=1/3', A3: '1E+21', A4: '0,0000001', E1: '="x"&A1', E2: '=CONCATENAR(A1;"-";2)', E3: '=IZQUIERDA(A1;2)', E4: '=LARGO(A2)',
    E5: '=""&A3', E6: '=""&A4', E7: '=VALOR("x"&A1)', E8: '=ENCONTRAR(",";A1)', E9: '=""&-2,25', E10: '=MAYUSC(A1)', E11: '=VALOR(""&A2)=A2', E12: '=""&100' } });
  eq(b.val('E1'), 'x1,5'); eq(b.val('E2'), '1,5-2'); eq(b.val('E3'), '1,'); eq(b.val('E4'), 17); eq(b.val('E5'), '1E+21'); eq(b.val('E6'), '1E-07');
  eq(b.val('E7'), '#VALUE!'); eq(b.val('E8'), 2); eq(b.val('E9'), '-2,25'); eq(b.val('E10'), '1,5'); eq(b.val('E11'), true); eq(b.val('E12'), '100');
});

test('colación es-CL fija: ñ después de n, sin mayúsculas, acentos secundarios, guion y apóstrofo ignorados', () => {
  const c = (a, b) => Bx.compareVals(a, b);
  assert.ok(c('nube', 'ñandú') < 0); assert.ok(c('ñandú', 'oso') < 0); assert.ok(c('nz', 'ña') < 0); assert.ok(c('a', 'á') < 0); assert.ok(c('á', 'b') < 0);
  eq(c('A', 'a'), 0); eq(c('ÑANDÚ', 'ñandú'), 0); assert.ok(c('a', 'á') !== 0); assert.ok(c('coop', 'co-op') < 0); assert.ok(c('co-op', 'cop') < 0); assert.ok(c("o'neil", 'oneila') < 0);
  assert.ok(c('1abc', '!abc') < 0); assert.ok(c(' a', '!a') < 0); assert.ok(c('!a', 'a') < 0); assert.ok(c('Zeta', 'ábaco') > 0); assert.ok(c('pingüino', 'pinguinos') < 0);
  eq(c('ñandú', 'ñandú'), 0); // texto descompuesto (NFD)
  const list = ['oso', 'Ñandú', 'nube', 'árbol', 'Arbol', 'zeta', '10', '2', 'co-op', 'coop', 'Ñu', 'nueve'];
  eq(list.slice().sort(c), ['10', '2', 'Arbol', 'árbol', 'coop', 'co-op', 'nube', 'nueve', 'Ñandú', 'Ñu', 'oso', 'zeta']);
  const b = book({ Hoja1: { A1: 'nube', A2: 'ñandú', A3: 'oso', B1: '1', B2: '2', B3: '3',
    E1: '="a"="A"', E2: '="a"="á"', E3: '="ñ">"n"', E4: '="ñandú"<"oso"', E5: '=CONTAR.SI(A1:A3;"<o")', E6: '=BUSCARV("ñu";A1:B3;2)', E7: '=COINCIDIR("ÑANDÚ";A1:A3;0)',
    E8: '=COINCIDIR("nandu";A1:A3;0)', E9: '=CONTAR.SI(A1:A3;"ñ*")', E10: '=BUSCARV("nz";A1:B3;2)' } });
  eq(b.val('E1'), true); eq(b.val('E2'), false); eq(b.val('E3'), true); eq(b.val('E4'), true); eq(b.val('E5'), 2); eq(b.val('E6'), 2); eq(b.val('E7'), 2);
  eq(b.val('E8'), '#N/A'); eq(b.val('E9'), 1); eq(b.val('E10'), 1);
});

// ---------- Ronda 4 (2026-11-02): rangos con nombre y aridad ----------
// Libro con nombres definidos: Ventas (libro y Hoja2), IVA (constante), Total (fórmula), Celda (texto), Tabla, Loop, Uno
function namedBook() {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', B1: 'texto', C1: 'uno', C2: 'dos', C3: 'tres',
    E1: '=SUMA(Ventas)', E2: '=PROMEDIO(ventas)', E3: '=BUSCARV(2;Tabla;3;FALSO)', E4: '=IVA*100', E5: '=Total', E6: '=NoExiste', E7: '=SUMA(Celda;1)',
    E8: '=Celda+1', E9: '=SUMA(INDIRECTO("Ventas"))', E10: '=SUMA(INDIRECTO("Hoja2!Ventas"))', E11: '=INDIRECTO("NoExiste")', E12: '=INDIRECTO("IVA")',
    E13: '=DESREF(Ventas;1;0;1)', E14: '=FILA(Ventas)', E15: '=Loop', E16: '=Uno*5', E17: '=SUMA(Ventas)+Uno', E18: '=Ventas', E19: '=CONTAR.SI(Ventas;">1")',
    E20: '=SI(IVA>0;"sí";"no")', E21: '=Rel', E22: '=SUMA(Base)', E23: '=\\tasa*2', E24: '=SUMA(Ventas', E25: '=SI.ERROR(NoExiste;"sin nombre")', E26: '=ESERROR(NoExiste)' },
    Hoja2: { A1: '10', A2: '20', B1: '=SUMA(Ventas)', B2: '=IVA', B3: '=Rel' } });
  const defs = [{ name: 'Ventas', ref: '=Hoja1!$A$1:$A$3' }, { name: 'Ventas', scope: 'Hoja2', ref: 'Hoja2!$A$1:$A$2' }, { name: 'IVA', ref: '=0,19', comment: 'Chile' },
    { name: 'Total', ref: '=SUMA(Ventas)' }, { name: 'Celda', ref: '=Hoja1!$B$1' }, { name: 'Tabla', ref: '=Hoja1!$A$1:$C$3' }, { name: 'Loop', ref: '=Loop+1' },
    { name: 'Uno', ref: '=Hoja1!$A$1' }, { name: 'Rel', ref: '=A1' }, { name: 'Base', ref: '=A1:A2', base: 'Hoja1' }, { name: '\\tasa', ref: '=0,5' }];
  for (const d of defs) { const r = Bx.defineName(b.wb, d); assert.ok(!r.error, `${d.name}: ${r.error}`); }
  b.eng.recalc();
  return b;
}
const namedChecks = b => {
  eq(b.val('E1'), 6); eq(b.val('E2'), 2); eq(b.val('E3'), 'dos'); near(b.val('E4'), 19); eq(b.val('E5'), 6); eq(b.val('E6'), '#NAME?'); eq(b.val('E7'), 1);
  eq(b.val('E8'), '#VALUE!'); eq(b.val('E9'), 6); eq(b.val('E10'), 30); eq(b.val('E11'), '#REF!'); eq(b.val('E12'), '#REF!'); eq(b.val('E13'), 2); eq(b.val('E14'), '#SPILL!');
  eq(b.val('E15'), '#CIRC!'); eq(b.val('E16'), 5); eq(b.val('E17'), 7); eq(b.val('E18'), '#SPILL!'); eq(b.val('E19'), 2); eq(b.val('E20'), 'sí'); eq(b.val('E21'), 1);
  eq(b.val('E22'), 3); eq(b.val('E23'), 1); eq(b.val('E24'), '#VALUE!'); eq(b.val('E25'), 'sin nombre'); eq(b.val('E26'), true);
  eq(b.val('B1', 1), 30); near(b.val('B2', 1), 0.19); eq(b.val('B3', 1), 10); // en Hoja2 gana el Ventas de la hoja; Rel (sin hoja) se resuelve en Hoja2
};
test('rangos con nombre: uso en fórmulas, ámbito de hoja sobre libro, INDIRECTO, DESREF y #NAME?', () => {
  const b = namedBook();
  namedChecks(b);
  eq(b.wb.names.find(d => d.name === 'Base').ref, '=Hoja1!A1:A2'); eq(b.wb.names.find(d => d.scope === 'Hoja2').ref, '=Hoja2!$A$1:$A$2');
  // rango, valor y sin nombre en el libro → todo igual que antes (no cambia el comportamiento por omisión)
  eq(b.eng.nameRange('Ventas', 0), { si: 0, r1: 0, c1: 0, r2: 2, c2: 0, full: false }); eq(b.eng.nameRange('Ventas', 1).si, 1); eq(b.eng.nameRange('IVA', 0), null);
  eq(b.eng.nameValue('Ventas', 0), [[1], [2], [3]]); near(b.eng.nameValue('IVA', 0), 0.19); eq(b.eng.nameValue('NoExiste', 0).code, '#NAME?');
  const plain = book({ Hoja1: { A1: '=Ventas', A2: '=SUMA(1;2)' } }); eq(plain.val('A1'), '#NAME?'); eq(plain.val('A2'), 3);
});
test('rangos con nombre en sintaxis es-CL estricta', () => strict(() => { namedChecks(namedBook()); }));
test('nombres: validación con las reglas de Excel y mensajes en español', () => {
  const b = namedBook(), err = (n, scope = null) => Bx.nameError(b.wb, n, scope);
  for (const ok of ['Ventas2', '_tasa', '\\x', 'Ventas.2024', 'Tasa_A1', 'Ñandú', 'R2D2', 'XFD', 'A1B', 'SUMA', 'Q1_2024']) eq(err(ok), null);
  for (const bad of ['mal nombre', '1abc', 'A1', 'xfd1048576', 'R1C1', 'F1C1', 'r1c', 'C', 'r', 'F', 'RC', 'C12', 'F3', 'VERDADERO', 'true', 'a-b', 'a$b', '\\', 'x'.repeat(256), '']) assert.ok(err(bad), bad);
  assert.ok(/espacios/.test(err('mal nombre'))); assert.ok(/referencia/.test(err('A1'))); assert.ok(/255/.test(err('x'.repeat(256)))); eq(err(''), 'Escriba un nombre.');
  assert.ok(/ya existe/.test(err('VENTAS'))); assert.ok(/ya existe/.test(err('ventas', 'hoja2'))); eq(err('Ventas', 'Hoja1'), null); eq(err('IVA', 'Hoja2'), null);
  eq(err('Nuevo', 'NoHoja'), 'La hoja del ámbito no existe.');
  assert.ok(/Se refiere a/.test(Bx.defineName(b.wb, { name: 'Malo', ref: '=SUMA(' }).error)); assert.ok(Bx.defineName(b.wb, { name: 'Vacio', ref: '' }).error);
  assert.ok(Bx.defineName(b.wb, { name: 'A1', ref: '=1' }).error); eq(b.wb.names.length, 11);
});
test('nombres: editar, eliminar, listar y renombrar en fórmulas', () => {
  const b = namedBook();
  const r = Bx.editName(b.wb, 'Ventas', null, { name: 'Ingresos' });
  eq(r.renamed, ['Ventas', 'Ingresos']); assert.ok(Bx.editName(b.wb, 'Ingresos', null, { name: 'IVA' }).error); assert.ok(Bx.editName(b.wb, 'Nada', null, { name: 'X1X' }).error);
  assert.ok(Bx.editName(b.wb, 'IVA', null, { ref: '=SUMA(' }).error); eq(Bx.editName(b.wb, 'IVA', null, { ref: '0,2', comment: 'nuevo' }).def.ref, '=0,2');
  eq(Bx.renameNameInFormula('=SUMA(Ventas)+VENTAS*2&"Ventas"+Hoja1!A1+Ventas2+Hoja2!Ventas', 'Ventas', 'Ingresos'), '=SUMA(Ingresos)+Ingresos*2&"Ventas"+Hoja1!A1+Ventas2+Hoja2!Ingresos');
  b.wb.sheets[0].cells.E1 = { v: Bx.renameNameInFormula(b.wb.sheets[0].cells.E1.v, 'Ventas', 'Ingresos') }; b.eng.recalc();
  eq(b.val('E1'), 6); near(b.val('E4'), 20); eq(b.val('E2'), '#NAME?'); // E2 sigue diciendo "ventas" (la UI renombra todas las celdas)
  eq(Bx.deleteName(b.wb, 'Ingresos'), true); eq(Bx.deleteName(b.wb, 'Ingresos'), false); b.eng.recalc(); eq(b.val('E1'), '#NAME?');
  const list = Bx.listNames(b.wb);
  eq(list.map(d => d.name + (d.scope ? '@' + d.scope : '')), ['\\tasa', 'Base', 'Celda', 'IVA', 'Loop', 'Rel', 'Tabla', 'Total', 'Uno', 'Ventas@Hoja2']);
  list[0].name = 'cambiado'; eq(b.wb.names.some(d => d.name === 'cambiado'), false); // listNames entrega copias
});
test('nombres: insertar/eliminar filas y columnas, renombrar, eliminar y duplicar hojas', () => {
  const b = namedBook(), ref = (n, s = null) => b.wb.names.find(d => d.name === n && (d.scope || null) === s).ref;
  Bx.namesStructural(b.wb, 'Hoja1', 'r', 1, 1); // inserta una fila en la 2
  eq(ref('Ventas'), '=Hoja1!$A$1:$A$4'); eq(ref('Uno'), '=Hoja1!$A$1'); eq(ref('Celda'), '=Hoja1!$B$1'); eq(ref('Ventas', 'Hoja2'), '=Hoja2!$A$1:$A$2'); eq(ref('Rel'), '=A1');
  Bx.namesStructural(b.wb, 'Hoja1', 'c', 0, 1); // inserta una columna en A
  eq(ref('Ventas'), '=Hoja1!$B$1:$B$4'); eq(ref('Tabla'), '=Hoja1!$B$1:$D$4');
  Bx.namesStructural(b.wb, 'Hoja1', 'c', 1, -1); // elimina la columna B (todo Ventas)
  eq(ref('Ventas'), '=#REF!'); eq(ref('Tabla'), '=Hoja1!$B$1:$C$4'); eq(ref('Total'), '=SUMA(Ventas)');
  b.eng.recalc(); eq(b.val('E1'), '#REF!');
  Bx.namesRenameSheet(b.wb, 'Hoja2', 'Datos 2'); b.wb.sheets[1].name = 'Datos 2';
  eq(ref('Ventas', 'Datos 2'), "='Datos 2'!$A$1:$A$2");
  Bx.defineName(b.wb, { name: 'Lejos', ref: "='Datos 2'!$A$1" });
  Bx.namesDuplicateSheet(b.wb, 'Datos 2', 'Datos 3');
  eq(ref('Ventas', 'Datos 3'), "='Datos 3'!$A$1:$A$2"); eq(ref('Ventas', 'Datos 2'), "='Datos 2'!$A$1:$A$2");
  Bx.namesDeleteSheet(b.wb, 'Datos 2');
  eq(b.wb.names.some(d => d.scope === 'Datos 2'), false); eq(ref('Lejos'), '=#REF!'); eq(ref('Ventas', 'Datos 3'), "='Datos 3'!$A$1:$A$2");
  eq(Bx.deleteSheetInFormula("=SUMA('Datos 2'!A1:A3)+Hoja1!A1+A1", 'datos 2'), '=SUMA(#REF!)+Hoja1!A1+A1');
});
test('nombres: findNames, REF_RE y fórmulas a medio escribir (L-009)', () => {
  const f = "=SUMA(Ventas;A1)+IVA&\"IVA\"+Hoja2!B2+SI.ERROR(#N/D;0)+VERDADERO+Q1_2024+\\tasa+'Mi hoja'!C3+_xlfn.XLOOKUP(1;A:A;B:B)+Hoja2!Local+$B$2+SUMA(1:3)+1E5";
  eq(Bx.findNames(f).map(x => x.name), ['Ventas', 'IVA', 'Q1_2024', '\\tasa', 'Local']);
  const v = Bx.findNames(f)[0]; eq(f.slice(v.start, v.end), 'Ventas');
  eq(Bx.findNames('=SUMA(Vent').map(x => x.name), ['Vent']); eq(Bx.findNames('=SUMA(A1:'), []); eq(Bx.findNames('="abc'), []); eq(Bx.findNames("='Hoja"), []);
  eq(Bx.findNames('=SUMA(Ventas;'), [{ start: 6, end: 12, name: 'Ventas' }]);
  eq(Bx.findRefs('=SUMA(Ventas;A1:').length, 1); eq(Bx.findRefs('=SUMA(\\A1)').length, 0); eq(Bx.findRefs('=SUMA(Q1_2024;A1)').length, 1);
  eq(Bx.shiftFormula('=SUMA(\\A1;A1)', 1, 0), '=SUMA(\\A1;A2)'); eq(Bx.shiftFormula('=SUMA(Q1_2024;Tasa.A1;A1)', 1, 1), '=SUMA(Q1_2024;Tasa.A1;B2)');
  eq(Bx.findRefs('=SUMA(A1:').length, 1); // L-009 sigue vigente
  strict(() => { eq(Bx.toExcelFormula('=SUMA(Ventas;\\tasa)*IVA'), '=SUM(Ventas,\\tasa)*IVA'); eq(Bx.fromExcelFormula('SUM(Ventas,IVA)'), 'SUMA(Ventas;IVA)'); });
});
test('nombres: .bassx (normalizeNames) y .xlsx (namesToXlsx / namesFromXlsx de SheetJS)', () => strict(() => {
  const b = namedBook();
  const x = Bx.namesToXlsx(b.wb);
  eq(x.find(n => n.Name === 'Ventas' && n.Sheet === undefined), { Name: 'Ventas', Ref: 'Hoja1!$A$1:$A$3' }); eq(x.find(n => n.Sheet === 1), { Name: 'Ventas', Ref: 'Hoja2!$A$1:$A$2', Sheet: 1 });
  eq(x.find(n => n.Name === 'IVA'), { Name: 'IVA', Ref: '0.19', Comment: 'Chile' }); eq(x.find(n => n.Name === 'Total').Ref, 'SUM(Ventas)');
  const back = Bx.namesFromXlsx(x, b.wb);
  eq(back.skipped, []); eq(back.names.map(d => [d.name, d.scope, d.ref]), b.wb.names.map(d => [d.name, d.scope, d.ref]));
  const odd = Bx.namesFromXlsx([{ Name: '_xlnm.Print_Area', Ref: 'Hoja1!$A$1:$B$2', Sheet: 0 }, { Name: 'Oculto', Ref: '1', Hidden: true }, { Name: 'A1', Ref: '1' },
    { Name: 'Tasa', Ref: '_xlfn.XLOOKUP(1,A:A,B:B)+0.5' }, { Name: 'Local', Ref: 'Hoja2!$A$1', Sheet: 1 }, { Name: 'SinHoja', Ref: '1', Sheet: 9 }], b.wb);
  eq(odd.skipped, ['_xlnm.Print_Area', 'Oculto', 'A1']); eq(odd.names.map(d => [d.name, d.scope, d.ref]), [['Tasa', null, '=BUSCARX(1;A:A;B:B)+0,5'], ['Local', 'Hoja2', '=Hoja2!$A$1'], ['SinHoja', null, '=1']]);
  const saved = JSON.parse(JSON.stringify(b.wb.names));
  eq(Bx.normalizeNames(saved, b.wb), b.wb.names);
  const dirty = [{ name: 'Ventas', ref: '=Hoja1!A1' }, { name: 'ventas', ref: '=1' }, { name: 'mal nombre', ref: '=1' }, { name: 'X', scope: 'NoHoja', ref: '=1' },
    { name: 'Y', ref: '1' }, null, { name: 'Z' }, { name: 'L', scope: 'hoja2', ref: '=2' }];
  eq(Bx.normalizeNames(dirty, b.wb).map(d => [d.name, d.scope, d.ref]), [['Ventas', null, '=Hoja1!A1'], ['Y', null, '=1'], ['L', 'Hoja2', '=2']]);
  eq(Bx.normalizeNames('no es lista', b.wb), []);
}));

test('aridad: tabla completa, Bx.arity y checkFormula con los mensajes de Excel', () => {
  const canon = [...new Set(Object.values(Bx.CANON))];
  for (const n of canon) { const a = Bx.arity(n); assert.ok(a && a.min >= 0 && a.max >= a.min && a.max <= 255, n); }
  eq(Object.keys(Bx.ARITY).sort(), canon.sort());
  eq(Bx.arity('RAIZ'), { min: 1, max: 1 }); eq(Bx.arity('sum'), { min: 1, max: 255 }); eq(Bx.arity('_xlfn.XLOOKUP'), { min: 3, max: 6 }); eq(Bx.arity('NOEXISTE'), null);
  eq(Bx.arity('SI'), { min: 1, max: 3 }); eq(Bx.arity('DESREF'), { min: 3, max: 5 }); eq(Bx.arity('PI'), { min: 0, max: 0 });
  const MANY = 'Ha escrito demasiados argumentos para esta función.', FEW = 'Ha escrito muy pocos argumentos para esta función.';
  eq(Bx.checkFormula('=RAIZ(2;25)'), { message: MANY, fn: 'RAIZ' }); eq(Bx.checkFormula('=RAIZ()'), { message: FEW, fn: 'RAIZ' });
  eq(Bx.checkFormula('=SUMA(1;2)'), null); eq(Bx.checkFormula('=SI(A1>0;1;2;3)').message, MANY); eq(Bx.checkFormula('=SI(A1>0)'), null);
  eq(Bx.checkFormula('=SUMA('), { message: 'Hay un problema con esta fórmula.', fn: null }); eq(Bx.checkFormula('=SUMA(RAIZ(1;2))').fn, 'RAIZ');
  eq(Bx.checkFormula('=FOO(1)'), null); eq(Bx.checkFormula('=BUSCARV(1;A1:B2)').message, FEW); eq(Bx.checkFormula('=PI(1)').message, MANY); eq(Bx.checkFormula('=HOY()'), null);
  eq(Bx.checkFormula('=SUMA(1;)'), null); eq(Bx.checkFormula('texto'), null); eq(Bx.checkFormula('=-RAIZ(1;2)%').fn, 'RAIZ'); eq(Bx.checkFormula('=SI(1;RAIZ(1;2))').fn, 'RAIZ');
  eq(Bx.checkFormula('=SUMA(Ventas)'), null);
  legacy(() => eq(Bx.checkFormula('=SUM(1,2,3)'), null)); strict(() => eq(Bx.checkFormula('=SUM(1,2,3)').message, 'Hay un problema con esta fórmula.'));
  eq(Bx.checkFormula('=SUMA(' + Array(255).fill(1).join(';') + ')'), null); eq(Bx.checkFormula('=SUMA(' + Array(256).fill(1).join(';') + ')').message, MANY);
  strict(() => { eq(Bx.checkFormula('=RAIZ(2,25)'), null); eq(Bx.checkFormula('=ABS(-2,5)'), null); });
  legacy(() => { eq(Bx.checkFormula('=RAIZ(2,25)').message, MANY); }); // en legacy la coma se lee como separador (L-018)
  // no se aplica al evaluar: el comportamiento vigente no cambia
  const b = book({ Hoja1: { A1: '=RAIZ(4;25)' } }); eq(b.val('A1'), 2);
});

// ---------- Ronda 5 (2026-11-02): errores escritos, "cerca de cero", formato General en texto ----------
test('un error escrito en una celda (#N/D, #¡VALOR!, #REF!…) es el error, no texto', () => {
  const b = book({ Hoja1: { A1: '#N/D', A2: '#n/d', A3: '#¡VALOR!', A4: '#VALUE!', A5: '#REF!', A6: '#¿NOMBRE?', A7: '#DIV/0!', A8: '#¡NUM!',
    A9: "'#N/D", A10: '#N/D extra', A11: '#CIRC!', A12: ' #N/A ',
    E1: '=ESNOD(A1)', E2: '=ESNOD(A2)', E3: '=ESERROR(A3)', E4: '=A4', E5: '=ESERROR(A9)', E6: '=ESTEXTO(A9)', E7: '=ESTEXTO(A10)', E8: '=ESERROR(A11)',
    E9: '=SUMA(A1:A2)', E10: '=SI.ERROR(A5;"r")', E11: '=CONTAR.SI(A1:A8;"#N/D")', E12: '=CONTAR.SI(A1:A8;"#N/A")', E13: '=CONTAR.SI(A1:A8;"<>#N/D")',
    E14: '=ESNOD(A6)', E15: '=CONTARA(A1:A3)', E16: '=VALOR("#N/D")', E17: '=ESNOD(A12)', E18: '=CONTAR.SI(A1:A8;"#¡VALOR!")', E19: '=CONTAR.SI(A1:A8;">#N/D")' } });
  eq(b.val('E1'), true); eq(b.val('E2'), true); eq(b.val('E3'), true); eq(b.val('E4'), '#VALUE!'); eq(b.val('E5'), false); eq(b.val('E6'), true); eq(b.val('E7'), true);
  eq(b.val('E8'), false); eq(b.val('E9'), '#N/A'); eq(b.val('E10'), 'r'); eq(b.val('E11'), 2); eq(b.val('E12'), 2); eq(b.val('E13'), 6); eq(b.val('E14'), false);
  eq(b.val('E15'), 3); eq(b.val('E16'), '#VALUE!'); eq(b.val('E17'), true); eq(b.val('E18'), 2); eq(b.val('E19'), 0);
  eq(b.val('A1'), '#N/A'); eq(b.val('A6'), '#NAME?'); eq(b.val('A9'), '#N/D'); eq(b.val('A11'), '#CIRC!');
  eq(Bx.literal('#N/D').code, '#N/A'); eq(Bx.literal(' #REF! ').code, '#REF!'); eq(Bx.literal('#N/Dx'), '#N/Dx'); eq(Bx.literal('#'), '#');
  // toRaw de un error: su texto en español, que literal() vuelve a leer como el mismo error
  eq(Bx.toRaw(Bx.E.na), '#N/D'); eq(Bx.toRaw(Bx.E.value), '#¡VALOR!'); eq(Bx.toRaw(Bx.E.div0), '#¡DIV/0!');
  for (const k of ['div0', 'value', 'ref', 'name', 'na', 'num']) assert.strictEqual(Bx.literal(Bx.toRaw(Bx.E[k])), Bx.E[k], k);
  eq(Bx.toRaw('#N/D'), "'#N/D"); eq(Bx.literal(Bx.toRaw('#N/D')), '#N/D'); // el texto "#N/D" sigue siendo texto
});
test('ajuste "cerca de cero" de Excel: solo en la suma o resta final, sin paréntesis', () => {
  const b = book({ Hoja1: { A1: '0,3', A2: '=0,1+0,2',
    E1: '=1,333+1,225-1,333-1,225', E2: '=(1,333+1,225-1,333-1,225)', E3: '=0,5-0,4-0,1', E4: '=1*(0,5-0,4-0,1)', E5: '=(0,5-0,4-0,1)', E6: '=1+1E-10-1',
    E7: '=SUMA(0,5;-0,4;-0,1)', E8: '=0,1+0,2', E9: '=A1-A2', E10: '=10-10', E11: '=0,3-0,1-0,2', E12: '=-(0,5-0,4-0,1)', E13: '=1+2^-52-1', E14: '=(1+2^-52-1)',
    E15: '=E3=0', E16: '=A1-A2+1', E17: '=1E-20-0', E18: '="x"&(0,5-0,4)' } });
  eq(b.val('E1'), 0); near(b.val('E2'), -2.220446049250313e-16); assert.ok(b.val('E2') !== 0); eq(b.val('E3'), 0); assert.ok(b.val('E4') !== 0); assert.ok(b.val('E5') !== 0);
  near(b.val('E6'), 1.000000082740371e-10); assert.ok(b.val('E7') !== 0); eq(b.val('E8'), 0.30000000000000004); eq(b.val('E9'), 0); eq(b.val('E10'), 0); eq(b.val('E11'), 0);
  assert.ok(b.val('E12') !== 0); eq(b.val('E13'), 0); eq(b.val('E14'), Math.pow(2, -52)); eq(b.val('E15'), true); eq(b.val('E16'), 1); eq(b.val('E17'), 1e-20);
  eq(b.val('E18'), 'x0,1');
});
test('número → texto con el formato General: 15 cifras y científica fuera de 1E-4 ≤ |x| < 1E+15', () => {
  const b = book({ Hoja1: { E1: '=""&1/3', E2: '=""&0,000552', E3: '=""&0,0001', E4: '=""&0,00001', E5: '=""&1E+15', E6: '=""&123456789012345',
    E7: '=""&1234567890123456', E8: '=""&-0,00001234', E9: '=""&100000000000', E10: '=""&1E+21', E11: '=TEXTO(0,00001;"General")', E12: '=""&2/3*1E-8',
    E13: '=LARGO(1E+15)', E14: '=""&-1234,5', E15: '=VALOR(""&1/3)=1/3' } });
  eq(b.val('E1'), '0,333333333333333'); eq(b.val('E2'), '0,000552'); eq(b.val('E3'), '0,0001'); eq(b.val('E4'), '1E-05'); eq(b.val('E5'), '1E+15');
  eq(b.val('E6'), '123456789012345'); eq(b.val('E7'), '1,23456789012346E+15'); eq(b.val('E8'), '-1,234E-05'); eq(b.val('E9'), '100000000000'); eq(b.val('E10'), '1E+21');
  eq(b.val('E11'), '1E-05'); eq(b.val('E12'), '6,66666666666667E-09'); eq(b.val('E13'), 5); eq(b.val('E14'), '-1234,5'); eq(b.val('E15'), true);
  // toRaw sigue con precisión completa (no usa el formato General)
  eq(Bx.toRaw(1e15), '1000000000000000'); eq(Bx.toRaw(0.00001), '0,00001'); eq(Bx.toRaw(1 / 3), '0,3333333333333333'); assert.strictEqual(Bx.literal(Bx.toRaw(1 / 3)), 1 / 3);
});

// ---------- Ronda 6 (2026-11-02): matrices dinámicas (desborde, A1#, @, difusión y funciones) ----------
const cellOf = k => Bx.parseAddr(k);
const spillOf = (b, k, si = 0) => b.eng.spillAt(si, cellOf(k).r, cellOf(k).c);
const spillErr = (b, k, si = 0) => b.eng.spillError(si, cellOf(k).r, cellOf(k).c);
// Valores de un rectángulo "C1:D3" como matriz (errores como código), leídos como los lee la UI
function area(b, a1, si = 0) {
  const [p, q] = a1.split(':').map(Bx.parseAddr), out = [];
  for (let r = p.r; r <= q.r; r++) {
    const row = [];
    for (let c = p.c; c <= q.c; c++) { const v = b.eng.value(si, r, c); row.push(v instanceof Bx.FErr ? v.code : v); }
    out.push(row);
  }
  return out;
}
test('desborde: la matriz llena abajo y a la derecha; las celdas fantasma se leen desde fórmulas, otras hojas y la UI', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', C1: '=A1:A3*2', E1: '=C2+1', E2: '=SUMA(C1#)', E3: '=CONTAR(C1:C5)', E4: '=Hoja2!B2', E5: '=C3' },
    Hoja2: { A1: '=SECUENCIA(2;2)', D1: '=Hoja1!C2*10' } });
  eq(area(b, 'C1:C4'), [[2], [4], [6], [null]]); eq(b.val('E1'), 5); eq(b.val('E2'), 12); eq(b.val('E3'), 3); eq(b.val('E4'), 4); eq(b.val('E5'), 6);
  eq(b.val('D1', 1), 40);
  eq(spillOf(b, 'C1'), { anchor: { r: 0, c: 2 }, r1: 0, c1: 2, r2: 2, c2: 2, ghost: false });
  eq(spillOf(b, 'C3'), { anchor: { r: 0, c: 2 }, r1: 0, c1: 2, r2: 2, c2: 2, ghost: true });
  eq(spillOf(b, 'C4'), null); eq(spillOf(b, 'A1'), null); eq(spillErr(b, 'C1'), null); eq(spillErr(b, 'A1'), null);
  eq(b.wb.sheets[0].cells.C2, undefined); // la celda fantasma no tiene contenido propio
  eq(b.eng.spills(0), [{ anchor: { r: 0, c: 2 }, r1: 0, c1: 2, r2: 2, c2: 2 }]);
  eq(b.eng.spills(1), [{ anchor: { r: 0, c: 0 }, r1: 0, c1: 0, r2: 1, c2: 1 }]);
  // celda vacía dentro del rango desbordado → 0 (como Excel); una matriz 1x1 no desborda pero A1# funciona
  const c = book({ Hoja1: { A1: '5', A3: '7', C1: '=A1:A3', D1: '=SECUENCIA(1)', E1: '=SUMA(D1#)', F1: '={7}', G1: '=Hoja2!A1:B1' }, Hoja2: { A1: 'x', B1: 'y' } });
  eq(area(c, 'C1:C3'), [[5], [0], [7]]); eq(c.val('D1'), 1); eq(spillOf(c, 'D1'), null); eq(c.val('E1'), 1); eq(c.val('F1'), 7); eq(area(c, 'G1:H1'), [['x', 'y']]);
  // leer primero una celda fantasma (sin haber calculado el ancla): el análisis estático encuentra la fórmula
  const g = book({ Hoja1: { A1: '1', A2: '2', A3: '3', C1: '=A1:A3*2', D1: '=SI(A1>0;A1:A2;0)', E1: '=Nombre', F1: '=FILA(A1:A2)', G1: '=-A1:A2', H1: '=@A1:A3' } });
  g.wb.names =[{ name: 'Nombre', scope: null, ref: '=Hoja1!$A$1:$A$2' }];
  eq(g.val('C3'), 6); eq(g.val('D2'), 2); eq(g.val('E2'), 2); eq(g.val('F2'), 2); eq(g.val('G2'), -2); eq(g.val('H2'), null);
  // sin matrices, el valor de las celdas no cambia (la UI usa eng.value igual que antes)
  const d = book({ Hoja1: { ...base, B1: '=SUMA(A1:A5)', B2: '=A4' } });
  eq(d.val('B1'), 33.5); eq(d.val('B2'), 'texto'); eq(d.val('C9'), null); eq(d.eng.spills(0), []); eq(spillOf(d, 'B1'), null);
});
test('#¡DESBORDAMIENTO!: contenido, otra matriz (la primera fila por fila gana), celdas combinadas y borde de la hoja', () => {
  const b = book({ Hoja1: { A1: '=SECUENCIA(3)', A3: 'x', B6: '=SECUENCIA(2;2)', A1048575: '=SECUENCIA(3)', XFC1: '=SECUENCIA(1;3)',
    G1: '=SUMA(A1#)', G2: '=A2', G3: '=ESERROR(A1)', G4: '=SI.ERROR(A1;"bloqueado")', G5: '=#¡DESBORDAMIENTO!', G6: '=ESERROR(#DESBORDAMIENTO!)', G7: '=XFC1' } });
  b.wb.sheets[0].merges = [{ r1: 6, c1: 2, r2: 7, c2: 3 }];
  eq(b.val('A1'), '#SPILL!'); eq(b.val('A2'), null); eq(b.val('G1'), '#SPILL!'); eq(b.val('G2'), 0); eq(b.val('G3'), true); eq(b.val('G4'), 'bloqueado');
  eq(b.val('G5'), '#SPILL!'); eq(b.val('G6'), true); eq(b.val('G7'), '#SPILL!');
  eq(spillErr(b, 'A1'), { reason: 'blocked', r1: 0, c1: 0, r2: 2, c2: 0, blockers: [{ r: 2, c: 0 }], message: 'El rango de desbordamiento no está en blanco.' });
  eq(spillErr(b, 'B6').reason, 'merged'); eq(b.val('B6'), '#SPILL!'); eq(spillOf(b, 'B7'), null);
  eq(spillErr(b, 'A1048575').reason, 'edge'); eq(spillErr(b, 'XFC1').reason, 'edge');
  eq(spillErr(b, 'A1048575').message, 'El rango de desbordamiento se extiende más allá del borde de la hoja de cálculo.');
  // textos en español y como error escrito
  eq(Bx.ERR_ES['#SPILL!'], '#¡DESBORDAMIENTO!'); eq(Bx.ERR_ES['#CALC!'], '#¡CALC!'); eq(Bx.toRaw(Bx.E.spill), '#¡DESBORDAMIENTO!');
  assert.strictEqual(Bx.literal('#¡DESBORDAMIENTO!'), Bx.E.spill); assert.strictEqual(Bx.literal('#DESBORDAMIENTO!'), Bx.E.spill);
  assert.strictEqual(Bx.literal('#¡CALC!'), Bx.E.calc); assert.strictEqual(Bx.literal('#SPILL!'), Bx.E.spill); assert.strictEqual(Bx.literal(Bx.toRaw(Bx.E.calc)), Bx.E.calc);
  eq(Bx.toExcelFormula('SI.ERROR(A1;#¡DESBORDAMIENTO!)+#¡CALC!'), 'IFERROR(A1,#SPILL!)+#CALC!'); eq(Bx.fromExcelFormula('IFERROR(A1,#SPILL!)'), 'SI.ERROR(A1;#¡DESBORDAMIENTO!)');
  // dos matrices que se cruzan (D1 baja, C2 va a la derecha): gana la primera fila por fila, sin importar quién se calcula antes
  for (const first of ['C2', 'D1', null]) {
    const x = book({ Hoja1: { D1: '=SECUENCIA(3)', C2: '=SECUENCIA(1;3;10)' } });
    if (first) x.val(first); else x.eng.prime(0);
    eq(x.val('C2'), '#SPILL!'); eq(area(x, 'D1:D3'), [[1], [2], [3]]); eq(x.val('E2'), null);
    eq(spillErr(x, 'C2').reason, 'spill'); eq(spillErr(x, 'C2').blockers, [{ r: 1, c: 3 }]);
    eq(spillErr(x, 'C2').message, 'El rango de desbordamiento se cruza con otra matriz desbordada.');
  }
});
test('recálculo: al achicarse el desborde viejo se libera; escribir en una celda fantasma bloquea el ancla', () => {
  const b = book({ Hoja1: { A1: '5', C1: '=SECUENCIA(A1)', E1: '=SUMA(C:C)', E2: '=CONTAR(C1#)' } });
  const cells = b.wb.sheets[0].cells;
  eq(b.val('C5'), 5); eq(b.val('E1'), 15); eq(b.val('E2'), 5);
  cells.A1 = { v: '2' }; b.eng.recalc();
  eq(area(b, 'C1:C5'), [[1], [2], [null], [null], [null]]); eq(b.val('E1'), 3); eq(b.val('E2'), 2); eq(spillOf(b, 'C4'), null);
  cells.C4 = { v: '9' }; b.eng.recalc(); // la celda liberada recibe datos sin bloquear
  eq(b.val('C1'), 1); eq(b.val('C4'), 9); eq(b.val('E1'), 12);
  cells.A1 = { v: '5' }; b.eng.recalc(); // crecer sobre ella sí bloquea
  eq(b.val('C1'), '#SPILL!'); eq(b.val('C2'), null); eq(spillErr(b, 'C1').blockers, [{ r: 3, c: 2 }]);
  delete cells.C4; cells.C2 = { v: 'x' }; b.eng.recalc(); // el usuario escribe en una celda fantasma
  eq(b.val('C1'), '#SPILL!'); eq(b.val('C2'), 'x'); eq(b.val('C3'), null); eq(spillErr(b, 'C1').blockers, [{ r: 1, c: 2 }]);
  delete cells.C2; b.eng.recalc(); // al borrarla, el ancla vuelve a desbordar
  eq(area(b, 'C1:C5'), [[1], [2], [3], [4], [5]]); eq(b.val('E2'), 5);
  cells.C1 = { v: '' }; b.eng.recalc(); // borrar el ancla libera todo
  eq(area(b, 'C1:C3'), [[null], [null], [null]]); eq(b.eng.spills(0), []);
});
test('desborde y ciclos: una matriz que lee su propia área da #CIRC!; una fórmula de arriba que lee una matriz de abajo no', () => {
  const b = book({ Hoja1: { A1: '=SECUENCIA(3)+A2', B1: '=SUMA(B1#)', C1: '=FILA(C1:C3)', A10: '=SECUENCIA(1;3)', B8: '=A10#*2', F1: '=SUMA(A10#)' } });
  eq(b.val('A1'), '#CIRC!'); eq(b.val('A2'), null); eq(b.val('B1'), '#CIRC!'); eq(area(b, 'C1:C3'), [[1], [2], [3]]);
  // A10 se calcula primero: al revisar choques consulta B8 (anterior), que depende de A10 → evaluación tentativa, sin #CIRC!
  eq(b.val('A10'), 1); eq(area(b, 'B8:D8'), [[2, 4, 6]]); eq(b.val('F1'), 6); eq(area(b, 'A10:C10'), [[1, 2, 3]]);
  const c = book({ Hoja1: { A3: '=SECUENCIA(1;3)', B1: '=A3#*2' } });
  eq(c.val('B3'), 2); eq(area(c, 'B1:D1'), [[2, 4, 6]]); // primero una celda fantasma de A3
  // B1 (anterior) lee una celda fantasma de A3: al revisar choques de A3, B1 se aborta y se calcula después, bien
  const e = book({ Hoja1: { A3: '=SECUENCIA(1;3)', B1: '=B3*{1\\2}' } });
  eq(e.val('A3'), 1); eq(area(e, 'B1:C1'), [[2, 4]]); eq(area(e, 'A3:C3'), [[1, 2, 3]]);
  const d = book({ Hoja1: { A1: '=A:A*2', C1: '=FILA(C1:C3)', D1: '=C:C*1' } }); eq(d.val('A1'), '#CIRC!'); // A:A incluye su propio desborde
  eq(area(d, 'D1:D4'), [[1], [2], [3], [null]]); // C:C llega hasta el final del desborde de C1
});
test('operador # (A1#): otra hoja, INDIRECTO, sin matriz → #REF!, reescritura y fórmulas a medio escribir (L-009)', () => {
  const b = book({ Hoja1: { A1: '=SECUENCIA(3)', B1: '10', C1: '=SUMA(A1#)', C2: '=SUMA(Hoja1!A1#)', C3: "=SUMA('Mi hoja'!B2#)", C4: '=B1#', C5: '=SUMA(INDIRECTO("A1#"))',
    C6: '=PROMEDIO(A1#)', C7: '=A1#*10', C10: '=SI.ERROR(B1#;"sin matriz")', C11: '=CONTARA(A1#)', C12: '=G1#', C13: '=INDICE(A1#;2)', C14: '=SUMA(A1#',
    C15: '=SUMA(INDIRECTO("\'Mi hoja\'!B2#"))', C16: '=SUMA($A$1#)' },
    'Mi hoja': { B2: '=SECUENCIA(2;2;10)' } });
  eq(b.val('C1'), 6); eq(b.val('C2'), 6); eq(b.val('C3'), 46); eq(b.val('C4'), '#REF!'); eq(b.val('C5'), 6); eq(b.val('C6'), 2);
  eq(area(b, 'C7:C9'), [[10], [20], [30]]); eq(b.val('C10'), 'sin matriz'); eq(b.val('C11'), 3); eq(b.val('C12'), '#REF!'); eq(b.val('C13'), 2);
  assert.ok(String(b.val('C14')).startsWith('#')); eq(b.val('C15'), 46); eq(b.val('C16'), 6);
  // findRefs: [start, end) cubre la celda sin el "#" (F4 no lo toca) y marca spill
  eq(Bx.findRefs('=SUMA(A1#').map(r => [r.start, r.end, r.spill]), [[6, 8, true]]); eq(Bx.findRefs('=A1#').map(r => [r.start, r.end, r.spill]), [[1, 3, true]]);
  eq(Bx.findRefs('=SUMA(A1#)+B2:C3').map(r => r.spill), [true, false]); eq(Bx.findRefs('=SI.ERROR(#N/D;A1#').length, 1);
  eq(Bx.findRefs("='Mi hoja'!B2#*2").map(r => [r.sheet, r.spill]), [['Mi hoja', true]]); eq(Bx.findRefs('=A1#REF!').map(r => r.spill), [false]);
  eq(Bx.findNames('=SUMA(A1#)+Ventas').map(n => n.name), ['Ventas']);
  // copiar, insertar/eliminar filas y renombrar hojas conservan el "#"
  eq(Bx.shiftFormula('=SUMA(A1#)+A1', 1, 1), '=SUMA(B2#)+B2'); eq(Bx.structural('=SUMA(A3#)', 'Hoja1', 'Hoja1', 'r', 0, 2), '=SUMA(A5#)');
  eq(Bx.structural('=SUMA(A3#)', 'Hoja1', 'Hoja1', 'r', 2, -1), '=SUMA(#REF!)'); eq(Bx.renameSheetInFormula("=SUMA('Mi hoja'!B2#)", 'Mi hoja', 'Datos'), '=SUMA(Datos!B2#)');
});
test('constantes matriciales es-CL ({1,5\\2;3\\4,25}) y difusión fila × columna con #N/A donde no alcanza', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', B1: '10', C1: '20', D1: '100', D2: '200', E10: '5', E11: 'texto',
    F1: '=A1:A3+D1:D2', G1: '=A1:A3*B1:C1', J1: '={1\\2\\3}+{10;20}', J4: '=A1:A3>1', K4: '=A1:A3&"x"', L4: '=-A1:A3', M4: '=A1:A3%',
    N4: '={1\\2}/{1\\0}', P4: '=E10:E12*1', Q1: '=1/0+A1:A3', R4: '=(A1:A3=2)*1', S1: '=SUMA({1,5\\2;3\\4,25})', T1: '={1\\2;3}', U1: '={-1\\+2\\"a"\\VERDADERO\\#N/D}',
    S4: '=A1:A3+B1', S8: '=A1:A2+B1:C2' } });
  eq(area(b, 'F1:F3'), [[101], [202], ['#N/A']]); eq(area(b, 'G1:H3'), [[10, 20], [20, 40], [30, 60]]); eq(area(b, 'J1:L2'), [[11, 12, 13], [21, 22, 23]]);
  eq(area(b, 'J4:J6'), [[false], [true], [true]]); eq(area(b, 'K4:K6'), [['1x'], ['2x'], ['3x']]); eq(area(b, 'L4:L6'), [[-1], [-2], [-3]]);
  eq(area(b, 'M4:M6'), [[0.01], [0.02], [0.03]]); eq(area(b, 'N4:O4'), [[1, '#DIV/0!']]); eq(area(b, 'P4:P6'), [[5], ['#VALUE!'], [0]]);
  eq(b.val('Q1'), '#DIV/0!'); eq(area(b, 'R4:R6'), [[0], [1], [0]]); eq(b.val('S1'), 10.75); eq(b.val('T1'), '#VALUE!');
  eq(area(b, 'U1:Y1'), [[-1, 2, 'a', true, '#N/A']]); eq(area(b, 'S4:S6'), [[11], [12], [13]]); eq(area(b, 'S8:T9'), [[11, 21], [2, 2]]);
  // fórmulas a medio escribir con { y @ (L-009)
  const h = book({ Hoja1: { A1: '={1\\2', A2: '={', A3: '=@', A4: '=@SUMA(', A5: '={1\\}' } });
  for (const k of ['A1', 'A2', 'A3', 'A4', 'A5']) assert.ok(String(h.val(k)).startsWith('#'), k);
  eq(Bx.findRefs('=@A1:').length, 1); eq(Bx.findRefs('={1\\2}+A1').length, 1);
});
test('SI, SI.ERROR, SI.ND y ES* con matrices; funciones de valores sueltos elemento a elemento', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', B1: '10', C1: '20', D1: '100', D2: '200', E10: '5', E11: 'texto', F1: 'ab', F2: 'cde', G1: 'uno', G2: 'dos', G3: 'tres',
    H1: '=SI(A1:A3>1;"sí";"no")', I1: '=SI(A1:A3>1;A1:A3*10)', J1: '=SI(A1:A3>1;1/0;0)', K1: '=SI({VERDADERO\\FALSO};B1:C1;D1:D2)', N1: '=SI.ERROR(1/{1\\0\\2};"x")',
    N2: '=SI.ND(COINCIDIR({2\\9};A1:A3;0);0)', N3: '=SUMA(SI(A1:A3>1;A1:A3))', H5: '=ESNUMERO(E10:E12)', I5: '=ESBLANCO(E10:E12)', J5: '=ESERROR(P4:P6)',
    K5: '=LARGO(F1:F3)', L5: '=IZQUIERDA(F1:F3;A1:A3)', M5: '=BUSCARV({3;1};A1:A3;1;FALSO)', N5: '=FILA(A1:A3)', H9: '=COLUMNA(A1:C1)', O5: '=CONTAR.SI(A1:A3;{">1";"<3"})',
    S1: '=REDONDEAR({1,25\\2,5};0)', P4: '=E10:E12*1', P8: '=MAYUSC(G1:G3)', Q8: '=SI(A1>0;G1:G3;0)', R8: '=ELEGIR(2;A1:A3;G1:G3)' } });
  eq(area(b, 'H1:H3'), [['no'], ['sí'], ['sí']]); eq(area(b, 'I1:I3'), [[false], [20], [30]]); eq(area(b, 'J1:J3'), [[0], ['#DIV/0!'], ['#DIV/0!']]);
  eq(area(b, 'K1:L2'), [[10, 100], [10, 200]]); eq(area(b, 'N1:P1'), [[1, 'x', 0.5]]); eq(area(b, 'N2:O2'), [[2, 0]]); eq(b.val('N3'), 5);
  eq(area(b, 'H5:H7'), [[true], [false], [false]]); eq(area(b, 'I5:I7'), [[false], [false], [true]]); eq(area(b, 'J5:J7'), [[false], [true], [false]]);
  eq(area(b, 'K5:K7'), [[2], [3], [0]]); eq(area(b, 'L5:L7'), [['a'], ['cd'], ['']]); eq(area(b, 'M5:M6'), [[3], [1]]); eq(area(b, 'N5:N7'), [[1], [2], [3]]);
  eq(area(b, 'H9:J9'), [[1, 2, 3]]); eq(area(b, 'O5:O6'), [[2], [2]]); eq(area(b, 'S1:T1'), [[1, 3]]);
  eq(area(b, 'P8:P10'), [['UNO'], ['DOS'], ['TRES']]); eq(area(b, 'Q8:Q10'), [['uno'], ['dos'], ['tres']]); eq(area(b, 'R8:R10'), [['uno'], ['dos'], ['tres']]);
});
test('intersección implícita @: fila o columna de la fórmula, matrices y .xlsx (_xlfn.SINGLE)', () => {
  const b = book({ Hoja1: { A1: '1', A2: '2', A3: '3', B1: '10', C1: '20', D1: '30', F2: '=@A1:A3', F5: '=@A1:A3', C3: '=@B1:D1', G1: '=@{4\\5}', G2: '=@SECUENCIA(3;1;7)',
    G3: '=@A1:B2', G4: '=@A2', F3: '=@A:A', H2: '=@Hoja2!A1:A5', H3: '=@INDIRECTO("A1:A3")*10', H4: '=SUMA(@A1:A3)', H5: '=@(A1:A3*2)' },
    Hoja2: { A2: 'dos' } });
  eq(b.val('F2'), 2); eq(b.val('F5'), '#VALUE!'); eq(b.val('C3'), 20); eq(b.val('G1'), 4); eq(b.val('G2'), 7); eq(b.val('G3'), '#VALUE!'); eq(b.val('G4'), 2);
  eq(b.val('F3'), 3); eq(b.val('H2'), 'dos'); eq(b.val('H3'), 30); eq(b.val('H4'), '#VALUE!'); eq(b.val('H5'), 2); eq(b.eng.spills(0), []);
  eq(Bx.toExcelFormula('=@A1:A3'), '=_xlfn.SINGLE(A1:A3)'); eq(Bx.toExcelFormula('=@(A1:A3*2)+1'), '=_xlfn.SINGLE(A1:A3*2)+1');
  eq(Bx.toExcelFormula("=@INDICE('Mi hoja'!A1:B2;1;0)&\"@x\""), "=_xlfn.SINGLE(INDEX('Mi hoja'!A1:B2,1,0))&\"@x\"");
  eq(Bx.fromExcelFormula('_xlfn.SINGLE(A1:A3)+1'), '@A1:A3+1'); eq(Bx.fromExcelFormula('_xlfn.SINGLE(A1:A3*2)'), '@(A1:A3*2)');
  eq(Bx.fromExcelFormula('_xlfn.SINGLE(INDEX(A1:B2,1,0))'), '@INDICE(A1:B2;1;0)');
  // qué fórmulas pueden desbordar (para el importador .xlsx)
  eq(['=@A1:A3', '=A1:A3', '=SUMA(A1:A3)', '=SI(A1>0;B1:B3;0)', '=A1+1', '=LARGO(A1:A3)', '=LARGO(A1)', '=Ventas', '=ORDENAR(A1:A3)', '=A1#', '=FILA()', 'texto', '=SUMA(']
    .map(Bx.mayArrayFormula), [false, true, false, true, false, true, false, true, true, true, false, false, false]);
  // importar .xlsx sin la marca de matriz dinámica: intersección implícita como Excel
  const LEG = { '=A1:A3': '=@A1:A3', '=A1:A3*2': '=@A1:A3*2', '=SUMA(A1:A3)': '=SUMA(A1:A3)', '=INDICE(A1:B3;0;1)': '=@INDICE(A1:B3;0;1)',
    "='Mi hoja'!A1:A3": "=@'Mi hoja'!A1:A3", '=A1': '=A1', '=SUMA(SI(A1:A3>1;1;0))': '=SUMA(SI(@A1:A3>1;1;0))', '=SUMAPRODUCTO((A1:A3>1)*B1:B3)': '=SUMAPRODUCTO((A1:A3>1)*B1:B3)',
    '=LARGO(A1:A3)': '=LARGO(@A1:A3)', '=SI(A1>0;B1:B3;0)': '=SI(A1>0;@B1:B3;0)', '=BUSCARV(A1:A3;D:E;2;FALSO)': '=BUSCARV(@A1:A3;D:E;2;FALSO)',
    '=SUMA(A:A)*2': '=SUMA(A:A)*2', '="A1:A3"&B1': '="A1:A3"&B1', '=SUMA(DESREF(A1;0;0;3))': '=SUMA(DESREF(A1;0;0;3))', '=DESREF(A1;1;0)+1': '=@DESREF(A1;1;0)+1',
    '=(A1:A3)*2': '=(@A1:A3)*2', '=CONTAR.SI(A1:A3;">1")': '=CONTAR.SI(A1:A3;">1")', '=@A1:A3': '=@A1:A3', '=SUMA({1;2};A1:A3)': '=SUMA({1;2};A1:A3)',
    '=SUMA(A1:A3*2)': '=SUMA(@A1:A3*2)' }; // sin Ctrl+Mayús+Entrar, el Excel de antes intersecaba el operando
  for (const [f, g] of Object.entries(LEG)) eq(Bx.implicitIntersect(f), g);
  const ii = book({ Hoja1: { A1: '1', A2: '2', A3: '3', C2: Bx.implicitIntersect('=A1:A3*2'), C3: Bx.implicitIntersect('=A1:A3'), C4: Bx.implicitIntersect('=SUMA(SI(A1:A3>1;1;0))') } });
  eq(ii.val('C2'), 4); eq(ii.val('C3'), 3); eq(ii.val('C4'), '#VALUE!'); eq(ii.eng.spills(0), []); // C4: fila 4 fuera de A1:A3, como Excel
});
test('SECUENCIA: ejemplo de la documentación; argumentos omitidos, vacíos (;;) o en celda vacía (L-008); es-CL', () => {
  const b = book({ Hoja1: { A1: '=SECUENCIA(4;5)', H1: '=SECUENCIA(3;;10)', I1: '=SECUENCIA(3;1;10;)', J1: '=SECUENCIA(3;1;Z1)', K1: '=SECUENCIA(3;1;1;Z1)',
    L1: '=SECUENCIA(Z1)', M1: '=SECUENCIA(2;Z1)', N1: '=SECUENCIA(0)', O1: '=SECUENCIA(-1)', P1: '=SECUENCIA(2,7)', Q1: '=SECUENCIA(3;1;0,5;0,25)', R1: '=SECUENCIA(;2)',
    T1: '=SECUENCIA("a")', U1: '=SUMA(SECUENCIA(100))', V1: '=SECUENCIA(2;2;10;-1)', A6: '=SECUENCIA(2;1;"1,5")' } });
  eq(area(b, 'A1:E4'), [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15], [16, 17, 18, 19, 20]]);
  eq(area(b, 'H1:K3'), [[10, 10, 0, 1], [11, 11, 1, 1], [12, 12, 2, 1]]); eq(b.val('L1'), '#CALC!'); eq(b.val('M1'), '#CALC!'); eq(b.val('N1'), '#CALC!');
  eq(b.val('O1'), '#VALUE!'); eq(area(b, 'P1:P3'), [[1], [2], [null]]); eq(area(b, 'Q1:Q3'), [[0.5], [0.75], [1]]); eq(area(b, 'R1:S1'), [[1, 2]]);
  eq(b.val('T1'), '#VALUE!'); eq(b.val('U1'), 5050); eq(area(b, 'V1:W2'), [[10, 9], [8, 7]]); eq(area(b, 'A6:A7'), [[1.5], [2.5]]);
});
test('UNICOS: sin distinguir mayúsculas, por_columna y exactamente_una_vez (omitido, vacío, celda vacía); vacío ≠ 0; sin resultados → #¡CALC!', () => {
  const b = book({ Hoja1: { A1: 'Ana', A2: 'luis', A3: 'ana', A4: 'Pedro', A5: 'Luis', A6: '3', A7: '3', A8: '', A9: '0', B1: '1', B2: '1', B3: '1', B4: '2',
    C1: '=UNICOS(A1:A7)', D1: '=UNICOS(A1:A7;;VERDADERO)', E1: '=UNICOS(A1:A7;FALSO;)', F1: '=UNICOS(A1:A7;Z1;Z2)', K1: '=UNICOS({1\\2\\1\\3};VERDADERO)',
    K3: '=UNICOS({1\\2\\1\\3})', K5: '=UNICOS({1;1};;VERDADERO)', K6: '=UNICOS(A1:A9)', G1: '=UNICOS(A1:B4)', N1: '=UNICOS({"á"\\"a"\\"A"};VERDADERO)' } });
  eq(area(b, 'C1:C5'), [['Ana'], ['luis'], ['Pedro'], [3], [null]]); eq(area(b, 'D1:D2'), [['Pedro'], [null]]);
  eq(area(b, 'E1:E4'), [['Ana'], ['luis'], ['Pedro'], [3]]); eq(area(b, 'F1:F4'), [['Ana'], ['luis'], ['Pedro'], [3]]);
  eq(area(b, 'K1:M1'), [[1, 2, 3]]); eq(area(b, 'K3:N3'), [[1, 2, 1, 3]]); eq(b.val('K5'), '#CALC!');
  eq(area(b, 'K6:K11'), [['Ana'], ['luis'], ['Pedro'], [3], [0], [0]]); // la celda vacía y el 0 son valores distintos (la vacía se muestra como 0)
  eq(area(b, 'G1:H4'), [['Ana', 1], ['luis', 1], ['Pedro', 2], [null, null]]); eq(area(b, 'N1:P1'), [['á', 'a', null]]);
});
test('FILTRAR: ejemplo de la documentación, varios criterios, por columnas y si_vacío omitido / vacío / celda vacía / texto', () => {
  const b = book({ Hoja1: { A1: 'Región', B1: 'Producto', C1: 'Monto', A2: 'Este', B2: 'Manzana', C2: '6380', A3: 'Oeste', B3: 'Uva', C3: '5619',
    A4: 'Norte', B4: 'Mango', C4: '4565', A5: 'Este', B5: 'Pera', C5: '5323', A6: 'Sur', B6: 'Mango', C6: '1310',
    E1: '=FILTRAR(A2:C6;A2:A6="Este";"")', E4: '=FILTRAR(A2:C6;(A2:A6="Este")*(C2:C6>6000))', E6: '=FILTRAR(A2:C6;A2:A6="Centro")', E7: '=FILTRAR(A2:C6;A2:A6="Centro";)',
    E8: '=FILTRAR(A2:C6;A2:A6="Centro";Z1)', E9: '=FILTRAR(A2:C6;A2:A6="Centro";"Sin datos")', E10: '=FILTRAR(A2:C6;A2:A3="Este")', E11: '=FILTRAR(A1:C1;{1\\0\\1})',
    E12: '=FILTRAR(A2:A6;B2:B6)', E13: '=SUMA(FILTRAR(C2:C6;A2:A6="Este"))', E14: '=FILTRAR(A2:A6;C2:C6>Z1)', E19: '=FILTRAR(A2:A6;C2:C6/(C2:C6<>5619))',
    E20: '=FILTRAR(A2:C6;(A2:A6="Este")+(B2:B6="Mango"))' } });
  eq(area(b, 'E1:G2'), [['Este', 'Manzana', 6380], ['Este', 'Pera', 5323]]); eq(area(b, 'E4:G4'), [['Este', 'Manzana', 6380]]);
  eq(b.val('E6'), '#CALC!'); eq(b.val('E7'), 0); eq(b.val('E8'), 0); eq(b.val('E9'), 'Sin datos'); eq(b.val('E10'), '#VALUE!'); eq(area(b, 'E11:F11'), [['Región', 'Monto']]);
  eq(b.val('E12'), '#VALUE!'); eq(b.val('E13'), 11703); eq(area(b, 'E14:E18'), [['Este'], ['Oeste'], ['Norte'], ['Este'], ['Sur']]); eq(b.val('E19'), '#DIV/0!');
  eq(area(b, 'E20:G22'), [['Este', 'Manzana', 6380], ['Norte', 'Mango', 4565], ['Este', 'Pera', 5323]]);
});
test('ORDENAR: tipos (números < texto es-CL < lógicos, vacías al final), índice, orden, por_columna, varios niveles y L-008', () => {
  const b = book({ Hoja1: { A1: 'oso', A2: 'nube', A3: 'ñandú', A5: '10', A6: 'VERDADERO', B1: '3', B2: '1', B3: '2', B4: '5', B5: '4', B6: '6',
    D1: '=ORDENAR(A1:A6)', E1: '=ORDENAR(A1:A6;;-1)', F1: '=ORDENAR(A1:B6;2;-1)', I1: '=ORDENAR(A1:B6;2;)', K1: '=ORDENAR({3\\1\\2;"c"\\"a"\\"b"};1;1;VERDADERO)',
    K4: '=ORDENAR({"b"\\2;"a"\\2;"c"\\1};{2\\1};{1\\-1})', N1: '=ORDENAR(A1:B6;2;Z1)', N2: '=ORDENAR(A1:B6;3)', N3: '=ORDENAR(A1:B6;Z1)', N4: '=ORDENAR(A1:B6;2;2)',
    N5: '=ORDENAR(A1:B6;{1\\2};{1\\-1\\1})', P1: '=ORDENAR(A1:B6;2;1;Z1)', S1: '=ORDENAR({"Zeta";"alfa";"Beta"})' } });
  eq(area(b, 'D1:D6'), [[10], ['nube'], ['ñandú'], ['oso'], [true], [0]]); eq(area(b, 'E1:E6'), [[true], ['oso'], ['ñandú'], ['nube'], [10], [0]]);
  eq(area(b, 'F1:G6'), [[true, 6], [0, 5], [10, 4], ['oso', 3], ['ñandú', 2], ['nube', 1]]);
  eq(area(b, 'I1:J6'), [['nube', 1], ['ñandú', 2], ['oso', 3], [10, 4], [0, 5], [true, 6]]); eq(area(b, 'P1:Q6'), area(b, 'I1:J6'));
  eq(area(b, 'K1:M2'), [[1, 2, 3], ['a', 'b', 'c']]); eq(area(b, 'K4:L6'), [['c', 1], ['b', 2], ['a', 2]]);
  for (const k of ['N1', 'N2', 'N3', 'N4', 'N5']) eq(b.val(k), '#VALUE!');
  eq(area(b, 'S1:S3'), [['alfa'], ['Beta'], ['Zeta']]);
});
test('ORDENARPOR: uno y dos criterios, orden omitido / vacío / celda vacía, por columnas y tamaños distintos → #VALUE!', () => {
  const b = book({ Hoja1: { A1: 'Tom', A2: 'Fred', A3: 'Amy', A4: 'Sal', B1: '52', B2: '65', B3: '22', B4: '65', C1: 'Este', C2: 'Oeste', C3: 'Este', C4: 'Este',
    E1: '=ORDENARPOR(A1:A4;B1:B4)', F1: '=ORDENARPOR(A1:A4;B1:B4;-1)', G1: '=ORDENARPOR(A1:A4;C1:C4;1;B1:B4;-1)', H1: '=ORDENARPOR(A1:A4;B1:B4;)',
    I1: '=ORDENARPOR(A1:A4;B1:B4;Z1)', I2: '=ORDENARPOR(A1:A4;B1:B3)', I3: '=ORDENARPOR(A1:A4;B1:B4;2)', I4: '=ORDENARPOR(A1:A4;B1:B4;1;{1\\2\\3})', I5: '=ORDENARPOR(A1:A4)',
    J1: '=ORDENARPOR({"a"\\"b"\\"c"};{3\\1\\2})', J3: '=ORDENARPOR(A1:B4;B1:B4;-1;A1:A4;1)' } });
  eq(area(b, 'E1:E4'), [['Amy'], ['Tom'], ['Fred'], ['Sal']]); eq(area(b, 'F1:F4'), [['Fred'], ['Sal'], ['Tom'], ['Amy']]);
  eq(area(b, 'G1:G4'), [['Sal'], ['Tom'], ['Amy'], ['Fred']]); eq(area(b, 'H1:H4'), area(b, 'E1:E4'));
  for (const k of ['I1', 'I2', 'I3', 'I4', 'I5']) eq(b.val(k), '#VALUE!');
  eq(area(b, 'J1:L1'), [['b', 'c', 'a']]); eq(area(b, 'J3:K6'), [['Fred', 65], ['Sal', 65], ['Tom', 52], ['Amy', 22]]);
});
test('MATRIZALEAT: tamaño, mín/máx, enteros y L-008; es volátil', () => {
  const b = book({ Hoja1: { A1: '=MATRIZALEAT(3;2)', D1: '=MATRIZALEAT(2;2;5;10;VERDADERO)', G1: '=MATRIZALEAT()', H1: '=MATRIZALEAT(;;1;2)', I1: '=MATRIZALEAT(1;1;5;5)',
    J1: '=MATRIZALEAT(1;1;Z1;Z2)', K1: '=MATRIZALEAT(Z1)', L1: '=MATRIZALEAT(2;1;1;3;Z1)', M1: '=MATRIZALEAT(1;3;-1,5;-0,5)', P1: '=MATRIZALEAT(1;1;1,2;1,8;VERDADERO)' } });
  const inR = (v, lo, hi) => typeof v === 'number' && v >= lo && v < hi;
  for (const row of area(b, 'A1:B3')) for (const v of row) assert.ok(inR(v, 0, 1), String(v));
  for (const row of area(b, 'D1:E2')) for (const v of row) assert.ok(Number.isInteger(v) && v >= 5 && v <= 10, String(v));
  assert.ok(inR(b.val('G1'), 0, 1)); assert.ok(inR(b.val('H1'), 1, 2)); eq(b.val('I1'), '#VALUE!'); eq(b.val('J1'), '#VALUE!'); eq(b.val('K1'), '#CALC!');
  for (const [v] of area(b, 'L1:L2')) assert.ok(inR(v, 1, 3), String(v));
  for (const v of area(b, 'M1:O1')[0]) assert.ok(inR(v, -1.5, -0.5), String(v));
  eq(b.val('P1'), '#VALUE!'); eq(b.eng.spillAt(0, 0, 0).r2, 2); eq(Bx.VOLATILE.has('RANDARRAY'), true);
});
test('MODA.VARIOS, APILARV/H, TOMAR/EXCLUIR, ELEGIRCOLS/FILAS y TRANSPONER (ejemplos de la documentación)', () => {
  const t = { A2: '1', B2: '2', C2: '3', A3: '4', B3: '5', C3: '6', A4: '7', B4: '8', C4: '9', A5: '10', B5: '11', C5: '12' };
  const b = book({ Hoja1: { ...t, A8: '1', A9: '2', A10: 'x', A11: '2', A12: '1',
    E1: '=MODA.VARIOS({1\\2\\3\\4\\3\\2\\1\\2\\3\\5\\6\\1})', F1: '=MODA.VARIOS(A8:A12)', G1: '=MODA.VARIOS({1\\2\\3})',
    E5: '=TOMAR(A2:C5;2)', E8: '=TOMAR(A2:C5;;2)', E13: '=TOMAR(A2:C5;-2)', E16: '=TOMAR(A2:C5;2;-1)', E19: '=TOMAR(A2:C5;0)', E20: '=TOMAR(A2:C5;Z1)', E21: '=TOMAR(A2:C5;10;1)',
    I5: '=EXCLUIR(A2:C5;2)', I8: '=EXCLUIR(A2:C5;;2)', I13: '=EXCLUIR(A2:C5;-3)', I16: '=EXCLUIR(A2:C5;2;2)', I19: '=EXCLUIR(A2:C5;4)', I20: '=EXCLUIR(A2:C5;Z1;2)',
    M5: '=ELEGIRCOLS(A2:C5;1;-1)', M10: '=ELEGIRCOLS(A2:C5;{3\\1})', M15: '=ELEGIRCOLS(A2:C5;0)', M16: '=ELEGIRCOLS(A2:C5;4)', M17: '=ELEGIRCOLS(A2:C5;)',
    P5: '=ELEGIRFILAS(A2:C5;-1;1)', P8: '=ELEGIRFILAS(A2:C5;5)',
    P10: '=APILARV({1\\2};{3\\4\\5})', P13: '=APILARH({1;2};{3})', P16: '=APILARV(A2:B2;7)', P19: '=TRANSPONER(A2:C3)', P23: '=TRANSPONER(5)' } });
  eq(area(b, 'E1:E3'), [[1], [2], [3]]); eq(area(b, 'F1:F2'), [[1], [2]]); eq(b.val('G1'), '#N/A');
  eq(area(b, 'E5:G6'), [[1, 2, 3], [4, 5, 6]]); eq(area(b, 'E8:F11'), [[1, 2], [4, 5], [7, 8], [10, 11]]); eq(area(b, 'E13:G14'), [[7, 8, 9], [10, 11, 12]]);
  eq(area(b, 'E16:E17'), [[3], [6]]); eq(b.val('E19'), '#CALC!'); eq(b.val('E20'), '#CALC!'); eq(area(b, 'E21:E24'), [[1], [4], [7], [10]]);
  eq(area(b, 'I5:K6'), [[7, 8, 9], [10, 11, 12]]); eq(area(b, 'I8:I11'), [[3], [6], [9], [12]]); eq(area(b, 'I13:K13'), [[1, 2, 3]]); eq(area(b, 'I16:I17'), [[9], [12]]);
  eq(b.val('I19'), '#CALC!'); eq(area(b, 'I20:I23'), [[3], [6], [9], [12]]);
  eq(area(b, 'M5:N8'), [[1, 3], [4, 6], [7, 9], [10, 12]]); eq(area(b, 'M10:N10'), [[3, 1]]); eq(b.val('M15'), '#VALUE!'); eq(b.val('M16'), '#VALUE!'); eq(b.val('M17'), '#VALUE!');
  eq(area(b, 'P5:R6'), [[10, 11, 12], [1, 2, 3]]); eq(b.val('P8'), '#VALUE!');
  eq(area(b, 'P10:R11'), [[1, 2, '#N/A'], [3, 4, 5]]); eq(area(b, 'P13:Q14'), [[1, 3], [2, '#N/A']]); eq(area(b, 'P16:Q17'), [[1, 2], [7, '#N/A']]);
  eq(area(b, 'P19:Q21'), [[1, 4], [2, 5], [3, 6]]); eq(b.val('P23'), 5);
});
test('matrices dentro de otras funciones: SUMAPRODUCTO, INDICE, BUSCARV/COINCIDIR, SUMA(A:A) con desborde', () => {
  const b = book({ Hoja1: { A1: '=SECUENCIA(4)', B1: '1', B2: '2', B3: '3',
    C1: '=SUMA(A:A)', C2: '=SUMAPRODUCTO((B1:B3>1)*B1:B3)', C3: '=SUMAPRODUCTO({1\\2};{3\\4})', C4: '=SUMAPRODUCTO((B1:B3>1)*1;B1:B2)', C5: '=INDICE(SECUENCIA(3;2);2;2)',
    C6: '=INDICE(ORDENAR(B1:B3;;-1);1)', C7: '=BUSCARV(2;{1\\"uno";2\\"dos"};2;FALSO)', C8: '=COINCIDIR("b";{"a"\\"b"};0)', C9: '=MAX(SECUENCIA(5)*2)',
    C10: '=CONTARA(UNICOS({1;1;2}))', C11: '=Y(SECUENCIA(3)>0)', C12: '=UNIRCADENAS("-";VERDADERO;ORDENAR({"b";"a"}))', D1: '=INDICE({1\\2;3\\4};0;2)',
    C13: '=SUMA(3:3)', E3: '=SECUENCIA(1;3;10)' } });
  eq(b.val('C1'), 10); eq(b.val('C2'), 5); eq(b.val('C3'), 11); eq(b.val('C4'), '#VALUE!'); eq(b.val('C5'), 4); eq(b.val('C6'), 3); eq(b.val('C7'), 'dos');
  eq(b.val('C8'), 2); eq(b.val('C9'), 10); eq(b.val('C10'), 2); eq(b.val('C11'), true); eq(b.val('C12'), 'a-b'); eq(area(b, 'D1:D2'), [[2], [4]]);
  eq(b.val('C13'), 3 + 3 + 11 + 10 + 11 + 12); // fila 3: A3 (fantasma de A1), B3, C3 y E3:G3 (desborde de E3)
});
test('rendimiento: muchas candidatas a desbordar y lecturas de celdas vacías', () => {
  const cells = { D1: '=SUMA(E1:E3000)' };
  for (let r = 1; r <= 3000; r++) { cells['A' + r] = String(r); cells['B' + r] = `=INDICE(A:A;${r})`; }
  const b = book({ Hoja1: cells }), t0 = Date.now();
  eq(b.val('D1'), 0); eq(b.val('B3000'), 3000); b.eng.prime(0); eq(b.eng.spills(0), []);
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
});
test('nombres, aridad y .xlsx de las funciones de matrices dinámicas (_xlfn._xlws. para FILTER y SORT; A1# → ANCHORARRAY)', () => {
  const pairs = { SECUENCIA: 'SEQUENCE', UNICOS: 'UNIQUE', FILTRAR: 'FILTER', ORDENAR: 'SORT', ORDENARPOR: 'SORTBY', MATRIZALEAT: 'RANDARRAY', 'MODA.VARIOS': 'MODE.MULT',
    APILARV: 'VSTACK', APILARH: 'HSTACK', TOMAR: 'TAKE', EXCLUIR: 'DROP', ELEGIRCOLS: 'CHOOSECOLS', ELEGIRFILAS: 'CHOOSEROWS', TRANSPONER: 'TRANSPOSE' };
  for (const [es, en] of Object.entries(pairs)) { eq(Bx.CANON[es], en); eq(Bx.CANON[en], en); }
  eq(Bx.arity('_xlfn._xlws.FILTER'), { min: 2, max: 3 }); eq(Bx.arity('SECUENCIA'), { min: 1, max: 4 }); eq(Bx.arity('MATRIZALEAT'), { min: 0, max: 5 });
  eq(Bx.checkFormula('=FILTRAR(A1:A3)').message, 'Ha escrito muy pocos argumentos para esta función.'); eq(Bx.checkFormula('=TRANSPONER(A1;B1)').fn, 'TRANSPONER');
  eq(Bx.toExcelFormula('=FILTRAR(A1:B9;A1:A9>1,5;"")'), '=_xlfn._xlws.FILTER(A1:B9,A1:A9>1.5,"")'); eq(Bx.toExcelFormula('=ORDENAR(A1:A9;1;-1)'), '=_xlfn._xlws.SORT(A1:A9,1,-1)');
  eq(Bx.toExcelFormula('=UNICOS(A1:A9)'), '=_xlfn.UNIQUE(A1:A9)'); eq(Bx.toExcelFormula('=SECUENCIA(3;2;1,5)'), '=_xlfn.SEQUENCE(3,2,1.5)');
  eq(Bx.toExcelFormula('=ORDENARPOR(A1:A3;B1:B3;-1)+MATRIZALEAT(2)+MODA.VARIOS(A1:A9)'), '=_xlfn.SORTBY(A1:A3,B1:B3,-1)+_xlfn.RANDARRAY(2)+_xlfn.MODE.MULT(A1:A9)');
  eq(Bx.toExcelFormula('=APILARV(A1;B1)&APILARH(A1;B1)&TOMAR(A1:B2;1)&EXCLUIR(A1:B2;1)&ELEGIRCOLS(A1:B2;1)&ELEGIRFILAS(A1:B2;1)&TRANSPONER(A1:B2)'),
    '=_xlfn.VSTACK(A1,B1)&_xlfn.HSTACK(A1,B1)&_xlfn.TAKE(A1:B2,1)&_xlfn.DROP(A1:B2,1)&_xlfn.CHOOSECOLS(A1:B2,1)&_xlfn.CHOOSEROWS(A1:B2,1)&TRANSPOSE(A1:B2)');
  eq(Bx.toExcelFormula('=SUMA(A1#)'), '=SUM(_xlfn.ANCHORARRAY(A1))'); eq(Bx.toExcelFormula("=SUMA('Mi hoja'!$B$2#)"), "=SUM(_xlfn.ANCHORARRAY('Mi hoja'!$B$2))");
  eq(Bx.toExcelFormula('="A1#"&A1#'), '="A1#"&_xlfn.ANCHORARRAY(A1)'); eq(Bx.toExcelFormula('=SI.ERROR(A1;#N/D)'), '=IFERROR(A1,#N/A)');
  eq(Bx.fromExcelFormula('_xlfn._xlws.FILTER(A1:B9,A1:A9>1.5,"")'), 'FILTRAR(A1:B9;A1:A9>1,5;"")'); eq(Bx.fromExcelFormula('SUM(_xlfn.ANCHORARRAY(Sheet1!$A$1))'), 'SUMA(Sheet1!$A$1#)');
  eq(Bx.fromExcelFormula('_xlfn.SEQUENCE(3,1,1.5)+_xlfn.ANCHORARRAY(B2)'), 'SECUENCIA(3;1;1,5)+B2#');
  const DA = ['=SUMA(A1#)', '=ORDENAR(FILTRAR(A2:C9;B2:B9>1,5;"");2;-1)', '=@A1:A3+1', '=@(A1:A3*2)', '=UNICOS(Hoja2!A:A;;VERDADERO)', '=SECUENCIA(3;1;0,5)',
    "=SUMA('Mi hoja'!B2#)*2", '=@INDICE(A1:B2;1;0)', '=ORDENARPOR(A1:A3;B1:B3;-1;C1:C3;1)', '={1,5\\2;3\\4}*A1#', '=TOMAR(APILARV(A1:B2;C1:D2);-1)', '="@x#"&A1#'];
  strict(() => { for (const f of DA) eq(Bx.fromExcelFormula(Bx.toExcelFormula(f)), f); });
});
test('L-009: cada prefijo de fórmulas con #, @ y {…} se evalúa y se convierte sin excepciones', () => {
  const F = ['=SUMA(A1#)+@B1:B3*{1\\2;3\\4}', "=ORDENAR(FILTRAR('Mi hoja'!A2:C9;'Mi hoja'!B2:B9>1,5;\"#N/D\");2;-1)",
    '=SI.ERROR(@INDICE(A1#;2);#¡DESBORDAMIENTO!)', '=UNICOS(Hoja2!A:A;;VERDADERO)&"@#{"'];
  for (const f of F) for (let i = 1; i <= f.length; i++) {
    const p = f.slice(0, i), b = book({ Hoja1: { A1: '=SECUENCIA(3)', D9: p }, 'Mi hoja': {}, Hoja2: {} });
    b.val('D9'); b.eng.spills(0);
    Bx.findRefs(p); Bx.findNames(p); Bx.fromExcelFormula(Bx.toExcelFormula(p)); Bx.checkFormula(p); Bx.implicitIntersect(p); Bx.mayArrayFormula(p);
  }
  eq(Bx.findRefs('=SUMA(A1#)+@B1:B').map(r => [r.start, r.end, r.spill]), [[6, 8, true], [12, 14, false]]);
});
test('las pruebas no tienen aserciones escondidas detrás de un comentario // en la misma línea', () => {
  const lines = fs.readFileSync(__filename, 'utf8').split('\n');
  const bad = lines.map((l, i) => [i + 1, l]).filter(([, l]) => { const k = l.indexOf('// '); return k >= 0 && /\b(?:eq|near|close|assert\.\w+)\(/.test(l.slice(k)); });
  eq(bad.map(([n]) => n), []);
});

// ---------- Fechas escritas es-CL (2026-11-02): d/m/aa, d/m, meses en español, FECHANUMERO ----------
// Serial independiente del motor (solo válido desde el 01/03/1900) y año actual del reloj, como Excel
const ser = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
const CY = new Date().getFullYear();
test('literal: d/m/aa y d-m-aa con la regla de 2029 (00–29 → 20xx, 30–99 → 19xx)', () => {
  const L = Bx.literal;
  eq(L('1/1/26'), ser(2026, 1, 1)); eq(L('1/1/26'), 46023); eq(L('01-01-26'), 46023); eq(L('1-1-26'), 46023); eq(L(' 1/1/26 '), 46023);
  // tabla de la documentación "How Excel works with two-digit year numbers", en orden d/m
  eq(L('4/7/00'), ser(2000, 7, 4)); eq(L('1/1/10'), ser(2010, 1, 1)); eq(L('31/12/29'), ser(2029, 12, 31)); eq(L('1/1/30'), ser(1930, 1, 1));
  eq(L('5/7/98'), ser(1998, 7, 5)); eq(L('31/12/99'), ser(1999, 12, 31)); eq(L('1/1/5'), ser(2005, 1, 1));
  eq(L('1/1/2026'), 46023); eq(L('1/1/1930'), ser(1930, 1, 1)); eq(L('2011/02/23'), 40597); eq(L('2026-1-1'), 46023);
  eq(L('22/08/11'), 40777); // FECHANUMERO("22.08.11") = 40777 en la documentación en español (allí con punto; en es-CL, "/")
  // inválidas → texto
  for (const s of ['31/02/26', '29/02/26', '0/1/26', '32/1/26', '1/13/26', '1/1/123', '1/1/10000', '31/12/1899', '1/0012/26', '00/01/2024'])
    eq(L(s), s);
  eq(L('29/02/28'), ser(2028, 2, 29)); eq(Bx.isDateLiteral('1/1/26'), true); eq(Bx.isDateLiteral('31/02/26'), false);
});
test('literal: dos partes (día/mes del año actual; si no, mes/año con día 1; si no, texto)', () => {
  const L = Bx.literal;
  eq(L('1/12'), ser(CY, 12, 1)); eq(L('01/12'), ser(CY, 12, 1)); eq(L('28/12'), ser(CY, 12, 28)); eq(L('30/1'), ser(CY, 1, 30)); eq(L('1-2'), ser(CY, 2, 1));
  // mes/año (tabla de la documentación, en orden es-CL): 12/99 → 01/12/1999, 11/95 → 01/11/1995, 1/99 → 01/01/1999, 13/99 → texto
  eq(L('12/99'), ser(1999, 12, 1)); eq(L('11/95'), ser(1995, 11, 1)); eq(L('1/99'), ser(1999, 1, 1)); eq(L('13/99'), '13/99');
  eq(L('1/30'), ser(1930, 1, 1)); eq(L('3/2026'), ser(2026, 3, 1)); eq(L('5/13'), ser(2013, 5, 1)); eq(L('1/123'), '1/123');
  eq(L('31/2'), '31/2'); eq(L('13/0'), '13/0');
});
test('literal: meses en español (1-ene-26, 1-ene, ene-26, "30-Ene-2008" de la documentación)', () => {
  const L = Bx.literal;
  eq(L('1-ene-26'), 46023); eq(L('1-ENE-2026'), 46023); eq(L('1/ene/26'), 46023); eq(L('1 ene 2026'), 46023); eq(L('1-enero-2026'), 46023);
  eq(L('30-Ene-2008'), ser(2008, 1, 30)); eq(L('22-MAY-2011'), 40685); eq(L('15-sept-26'), ser(2026, 9, 15)); eq(L('15-sep-26'), ser(2026, 9, 15));
  eq(L('15-set-26'), ser(2026, 9, 15)); eq(L('15-septiembre-26'), ser(2026, 9, 15)); eq(L('1-dic.-26'), ser(2026, 12, 1)); eq(L('1-ago-30'), ser(1930, 8, 1));
  eq(L('1-ene'), ser(CY, 1, 1)); eq(L('5-JUL'), ser(CY, 7, 5)); eq(L('ene-26'), ser(CY, 1, 26)); eq(L('ene-45'), ser(1945, 1, 1)); eq(L('ene-2026'), 46023);
  eq(L('feb-30'), ser(1930, 2, 1)); // 30 de febrero no existe → mes/año
  for (const s of ['31-feb-26', '1-xyz-26', 'xyz-26', 'enero', 'ene-123', '0-ene-26']) eq(L(s), s);
  near(L('1 ene 2026 14:30'), 46023 + 14.5 / 24); near(L('1-ene-26 06:00'), 46023.25); eq(Bx.isDateTimeLiteral('1-ene-26 06:00'), true);
});
test('literal: antes del 01/03/1900 (L-017) y FECHA en febrero de 1900 (1900 bisiesto como en Excel)', () => {
  const L = Bx.literal;
  eq(L('1/1/1900'), 1); eq(L('28/02/1900'), 59); eq(L('29/02/1900'), 60); eq(L('29-feb-1900'), 60); eq(L('1/3/1900'), 61); eq(L('30/02/1900'), '30/02/1900');
  const b = book({ Hoja1: { A1: '29/02/1900', B1: '=FECHA(1900;2;29)', B2: '=FECHA(1900;3;0)', B3: '=FECHA(1900;2;30)', B4: '=DIA(60)', B5: '=MES(60)', B6: '=AÑO(60)',
    B7: '=DIA(A1+1)', B8: '=FECHA(2024;0;1)', B9: '=FECHA(2024;-1;31)', B10: '=FECHA(2024;14;1)', B11: '=FIN.MES(45;0)', B12: '=FECHA(1900;1;60)' } });
  eq(b.val('A1'), 60); eq(b.val('B1'), 60); eq(b.val('B2'), 60); eq(b.val('B3'), 61); eq(b.val('B4'), 29); eq(b.val('B5'), 2); eq(b.val('B6'), 1900);
  eq(b.val('B7'), 1); eq(b.val('B8'), ser(2023, 12, 1)); eq(b.val('B9'), ser(2023, 12, 1)); eq(b.val('B10'), ser(2025, 2, 1)); eq(b.val('B11'), 60); eq(b.val('B12'), 60);
});
test('literal de fechas: no rompe miles, decimales, horas ni enteros', () => {
  const L = Bx.literal;
  eq(L('1.234'), 1234); eq(L('1.234,5'), 1234.5); eq(L('1,5'), 1.5); eq(L('-1'), -1); eq(L('2026'), 2026); eq(L('1.5'), 1.5); eq(L('12.345.678'), 12345678);
  near(L('14:30'), 14.5 / 24); near(L('22/10/2026 14:30'), 46317 + 14.5 / 24); eq(L('1/2/3/4'), '1/2/3/4'); eq(L('1-'), '1-'); eq(L('-1/1'), '-1/1');
});
test('toRaw: el texto que parece fecha lleva apóstrofo y la fecha vuelve exacta', () => {
  for (const s of ['1/1/26', '1-ene', 'ene-26', '12/99', '29/02/1900']) { eq(Bx.toRaw(s), "'" + s); eq(Bx.literal(Bx.toRaw(s)), s); }
  for (const s of ['31/02/26', '13/99', '1-xyz']) eq(Bx.toRaw(s), s);
  for (const s of ['1/1/26', '1-ene-26 06:00', '29/02/1900']) { const v = Bx.literal(s); eq(Bx.literal(Bx.toRaw(v)), v); }
});
test('FECHANUMERO (DATEVALUE): texto de fecha → serial; hora ignorada; números, vacías y texto sin fecha → #VALUE!', () => {
  const b = book({ Hoja1: { A1: "'1/1/26", A2: '1/1/26', A3: '14:30', A4: "'ene-45", A5: "'22/10/2026 14:30", A7: 'hola',
    D1: '=FECHANUMERO("1/1/2008")', D2: '=FECHANUMERO("22/8/2011")', D3: '=FECHANUMERO("22-MAY-2011")', D4: '=FECHANUMERO("2011/02/23")', D5: '=FECHANUMERO("5-JUL")',
    D6: '=FECHANUMERO(3&"/"&11&"/"&2011)', D7: '=FECHANUMERO(A1)', D8: '=FECHANUMERO(A2)', D9: '=FECHANUMERO(A6)', D10: '=FECHANUMERO("")', D11: '=FECHANUMERO("14:30")',
    D12: '=FECHANUMERO("31/02/26")', D13: '=FECHANUMERO("31/12/1899")', D14: '=FECHANUMERO(1/0)', D15: '=FECHANUMERO(VERDADERO)', D16: '=FECHANUMERO(A4)',
    D17: '=FECHANUMERO(A5)', D18: '=FECHANUMERO(" 1/1/30 ")', D19: '=FECHANUMERO("29/02/1900")', D20: '=FECHANUMERO(A7)', D21: '=FECHANUMERO(46023)',
    D22: '=FECHANUMERO("1/12")', D23: '=DATEVALUE("30-Ene-2008")', D24: '=HORANUMERO("1-ene-26 6:00")', D25: '=HORANUMERO("1/1/26")', D26: '=FECHANUMERO(A3)',
    D27: '=FECHANUMERO("1,5")' } });
  // ejemplos de la documentación (dato y resultado del mismo ejemplo; "8/22/2011" se escribe en orden es-CL)
  eq(b.val('D1'), 39448); eq(b.val('D2'), 40777); eq(b.val('D3'), 40685); eq(b.val('D4'), 40597);
  // "5-JUL": la documentación dice "año actual 2011" pero publica 39634 (05/07/2008); se prueba con el año del reloj
  eq(b.val('D5'), ser(CY, 7, 5));
  eq(b.val('D6'), 40850); // A2&"/"&A3&"/"&A4 con 11, 3, 2011 → 40850 (03/11/2011); en es-CL el día va primero
  eq(b.val('D7'), 46023); eq(b.val('D8'), '#VALUE!'); eq(b.val('D9'), '#VALUE!'); eq(b.val('D10'), '#VALUE!'); eq(b.val('D11'), '#VALUE!');
  eq(b.val('D12'), '#VALUE!'); eq(b.val('D13'), '#VALUE!'); eq(b.val('D14'), '#DIV/0!'); eq(b.val('D15'), '#VALUE!'); eq(b.val('D16'), ser(1945, 1, 1));
  eq(b.val('D17'), 46317); eq(b.val('D18'), ser(1930, 1, 1)); eq(b.val('D19'), 60); eq(b.val('D20'), '#VALUE!'); eq(b.val('D21'), '#VALUE!');
  eq(b.val('D22'), ser(CY, 12, 1)); eq(b.val('D23'), ser(2008, 1, 30)); near(b.val('D24'), 0.25); eq(b.val('D25'), 0); eq(b.val('D26'), '#VALUE!'); eq(b.val('D27'), '#VALUE!');
  eq(Bx.CANON['FECHANUMERO'], 'DATEVALUE'); eq(Bx.arity('FECHANUMERO'), { min: 1, max: 1 });
  eq(Bx.checkFormula('=FECHANUMERO()').message, 'Ha escrito muy pocos argumentos para esta función.');
  eq(Bx.checkFormula('=FECHANUMERO(;)').message, 'Ha escrito demasiados argumentos para esta función.');
  eq(Bx.toExcelFormula('FECHANUMERO("1/1/26")+1'), 'DATEVALUE("1/1/26")+1'); eq(Bx.fromExcelFormula('DATEVALUE("1/1/26")+1'), 'FECHANUMERO("1/1/26")+1');
});

// ---------- evalFormula / evalFormulaBool: fórmula suelta evaluada como si estuviera en (si, r, c) ----------
// Libro de las pruebas: Hoja1 con datos, una fórmula sobre sí misma, un desborde y nombres de libro y de Hoja2
function efBook() {
  const b = book({
    Hoja1: { A1: '-1', A2: '2', A3: '3,5', A4: 'texto', B1: '=A2*10', B2: '5', C1: '=SECUENCIA(3)', D1: '=ALEATORIO()', E1: '=1/0' },
    Hoja2: { A1: '7', B1: '1', B2: '2' },
  });
  b.wb.names = [{ name: 'Tope', ref: '=10' }, { name: 'Tope', scope: 'Hoja2', ref: '=20' }, { name: 'Datos', ref: '=$A$1:$A$3' },
    { name: 'Fila', ref: '=FILA()' }];
  const ev = (si, r, c, f, o) => { const v = b.eng.evalFormula(si, r, c, f, o); return v instanceof Bx.FErr ? v.code : v; };
  return { ...b, ev, bool: (si, r, c, f, o) => b.eng.evalFormulaBool(si, r, c, f, o) };
}
test('evalFormula: referencias según (r, c), con y sin opts.from (ancla de la regla)', () => {
  const { ev } = efBook();
  // sin from, el texto es el que tendría la celda (r, c): A1 es A1 en cualquier celda
  eq(ev(0, 1, 1, '=A1>0'), false); eq(ev(0, 5, 3, '=A1'), -1); eq(ev(0, 1, 1, '=$A$1+B2'), 4);
  // con from: escrita para A1 y evaluada en B2 lee B2; en A2 lee A2; en A1 lee A1
  eq(ev(0, 1, 1, '=A1>0', { from: { r: 0, c: 0 } }), true); eq(ev(0, 1, 0, '=A1', { from: { r: 0, c: 0 } }), 2);
  eq(ev(0, 0, 0, '=A1', { from: { r: 0, c: 0 } }), -1); eq(ev(0, 2, 0, '=A1*2', { from: { r: 0, c: 0 } }), 7);
  // absoluta y mixta: $A$1 no se mueve, $A1 solo cambia de fila, A$1 solo de columna
  eq(ev(0, 1, 1, '=$A$1', { from: { r: 0, c: 0 } }), -1); eq(ev(0, 1, 1, '=$A1', { from: { r: 0, c: 0 } }), 2);
  eq(ev(0, 1, 1, '=A$1', { from: { r: 0, c: 0 } }), 20); eq(ev(0, 1, 2, '=A$1', { from: { r: 0, c: 0 } }), 1);
  // desplazarse fuera de la hoja → #REF!, como al copiar
  eq(ev(0, 0, 0, '=A2', { from: { r: 1, c: 0 } }), -1); eq(ev(0, 0, 0, '=A1', { from: { r: 1, c: 0 } }), '#REF!');
});
test('evalFormula: FILA/COLUMNA, @ e INDIRECTO F1C1 miran (r, c); otra hoja; nombres de hoja y de libro', () => {
  const { ev } = efBook();
  eq(ev(0, 0, 0, '=FILA()*100+COLUMNA()'), 101); eq(ev(0, 4, 2, '=FILA()*100+COLUMNA()'), 503); eq(ev(1, 9, 25, '=FILA()*100+COLUMNA()'), 1026);
  eq(ev(0, 1, 5, '=@A1:A4'), 2); eq(ev(0, 2, 5, '=@A1:A4'), 3.5); eq(ev(0, 9, 5, '=@A1:A4'), '#VALUE!');
  eq(ev(0, 2, 1, '=INDIRECTO("F[-1]C[-1]";FALSO)'), 2); eq(ev(0, 3, 1, '=INDIRECTO("F[-1]C[-1]";FALSO)'), 3.5);
  eq(ev(0, 0, 0, '=Hoja2!A1*2'), 14); eq(ev(1, 0, 0, '=A1'), 7); eq(ev(1, 0, 0, '=SUMA(B1:B2)'), 3);
  // nombre de hoja (Hoja2) antes que el de libro; "Datos" sin hoja se resuelve en la hoja de la fórmula
  eq(ev(0, 0, 0, '=Tope'), 10); eq(ev(1, 0, 0, '=Tope'), 20); eq(ev(0, 0, 0, '=SUMA(Datos)'), 4.5); eq(ev(1, 0, 0, '=SUMA(Datos)'), 7);
  // un nombre con FILA() también mira la celda de la regla
  eq(ev(0, 6, 0, '=Fila'), 7); eq(ev(0, 0, 0, '=NoExiste'), '#NAME?');
});
test('evalFormula: sintaxis es-CL, sin "=", errores devueltos (no lanzados) iguales a los de una celda', () => {
  const { ev } = efBook();
  eq(ev(0, 0, 0, '=A3>1,5'), true); eq(ev(0, 0, 0, '=A3>3,5'), false); eq(ev(0, 0, 0, 'A3>1,5'), true); eq(ev(0, 0, 0, 'B2+1'), 6); eq(ev(0, 0, 0, '=1,5+1'), 2.5);
  eq(ev(0, 0, 0, '=SUMA(1;2)'), 3); eq(ev(0, 0, 0, '=RAIZ(2,25)'), 1.5); eq(ev(0, 0, 0, 1.5), '#VALUE!');
  for (const f of ['=FOO(1)', '=SUMA(', '=1;2', '=)', '=1/0', '=Nada!A1', '=#N/D', '=A1+A4', '=E1', '=NoExiste', '=SI(A1>0;"s";"n")', '=A4&1,5', '=A9', '={5}']) {
    let v;
    assert.doesNotThrow(() => { v = ev(0, 6, 6, f); }, f);
    // la misma fórmula escrita en la celda G7 (vacía) de un libro igual da lo mismo
    const c = efBook(); c.wb.sheets[0].cells.G7 = { v: f[0] === '=' ? f : '=' + f }; c.eng.recalc();
    eq([f, v], [f, c.val('G7')]);
  }
  eq(ev(0, 0, 0, '=FOO(1)'), '#NAME?'); eq(ev(0, 0, 0, '=SUMA('), '#VALUE!'); eq(ev(0, 0, 0, '=A9'), 0); eq(ev(0, 0, 0, '={5}'), 5);
  eq(ev(5, 0, 0, '=1'), '#REF!'); eq(ev(0, -1, 0, '=1'), '#REF!'); eq(ev(0, 0, 0, '='), '#VALUE!'); eq(ev(0, 0, 0, ''), '#VALUE!');
  // sintaxis vieja activa: la coma separa argumentos
  legacy(() => eq(ev(0, 0, 0, '=SI(A2>0,1,0)'), 1));
});
test('evalFormula: matrices y rangos (sin desbordar), opts.ref devuelve la referencia', () => {
  const { ev, eng } = efBook();
  eq(ev(0, 0, 0, '=SECUENCIA(2;2)'), [[1, 2], [3, 4]]); eq(ev(0, 0, 0, '=A1:A3*2'), [[-2], [4], [7]]);
  eq(ev(0, 0, 0, '=A4:A5'), [['texto'], [0]]); eq(ev(0, 0, 0, '={1\\2}'), [[1, 2]]);
  eq(ev(0, 0, 0, '=C1:C3'), [[1], [2], [3]]); eq(ev(0, 0, 0, '=A1:XFD1048576'), '#NUM!');
  const g = eng.evalFormula(0, 4, 4, '=Hoja2!B1:B2', { ref: true });
  eq([g.range, g.si, g.r1, g.c1, g.r2, g.c2], [true, 1, 0, 1, 1, 1]);
  const h = eng.evalFormula(0, 4, 4, '=A2', { ref: true });
  eq([h.range, h.r1, h.c1, h.r2, h.c2], [true, 1, 0, 1, 0]);
  const n = eng.evalFormula(1, 0, 0, '=Datos', { ref: true });
  eq([n.si, n.r1, n.r2], [1, 0, 2]);
  const s = eng.evalFormula(0, 4, 4, '=C1#', { ref: true });
  eq([s.r1, s.c1, s.r2, s.c2], [0, 2, 2, 2]);
  eq(ev(0, 0, 0, '=1+1', { ref: true }), 2); eq(ev(0, 0, 0, '=FOO()', { ref: true }), '#NAME?');
  eq(ev(0, 0, 0, '=A1:A3', { ref: true, from: { r: 0, c: 0 } }).r2, 2);
});
test('evalFormula: volátiles y estado del libro intacto (valores, cur, desbordes, recalc)', () => {
  const b = efBook(), { eng, wb, ev } = b;
  const snap = () => {
    const out = {};
    wb.sheets.forEach((sh, si) => { for (const k of [...Object.keys(sh.cells), 'C2', 'C3', 'C4', 'F1', 'G7']) if (k !== 'D1') out[si + '!' + k] = b.val(k, si); });
    return out;
  };
  const before = snap(), d1 = b.val('D1'), spills = JSON.stringify(eng.spills(0)), cells = JSON.stringify(wb.sheets);
  const r1 = ev(0, 0, 0, '=ALEATORIO()'), r2 = ev(0, 0, 0, '=ALEATORIO()');
  assert.ok(typeof r1 === 'number' && r1 >= 0 && r1 < 1 && r1 !== r2, 'ALEATORIO se recalcula en cada llamada');
  eq(ev(0, 0, 0, '=HOY()'), Math.floor(ev(0, 0, 0, '=AHORA()')));
  // una matriz evaluada en C2 (ocupada por el desborde de C1) ni desborda ni da #SPILL!, y no bloquea a C1
  eq(ev(0, 1, 2, '=SECUENCIA(3;3)'), [[1, 2, 3], [4, 5, 6], [7, 8, 9]]); eq(eng.spillError(0, 1, 2), null); eq(eng.spillError(0, 0, 2), null);
  // la fórmula de B1 leída desde una regla sobre B1 no es circular; un ciclo del libro sigue siendo #CIRC!
  eq(ev(0, 0, 1, '=B1>5'), true); eq(ev(0, 0, 1, '=B1+C3', { from: { r: 0, c: 1 } }), 23);
  eq(eng.cur, null); eq(eng.stack.size, 0); eq(b.val('D1'), d1); eq(snap(), before);
  eq(JSON.stringify(eng.spills(0)), spills); eq(JSON.stringify(wb.sheets), cells);
  eng.recalc(); eq(snap(), before); eq(JSON.stringify(eng.spills(0)), spills);
  // en un libro recién creado, evaluar antes de leer celdas deja los mismos valores que no hacerlo
  const fresh = efBook();
  fresh.ev(0, 3, 3, '=SUMA(C1:C3)+C2+Hoja2!A1'); fresh.ev(0, 1, 2, '=C1#');
  eq(fresh.val('C2'), 2); eq(fresh.val('B1'), 20); eq(fresh.eng.cur, null); eq(JSON.stringify(fresh.eng.spills(0)), spills);
  // ciclo del libro: la regla lee #CIRC! sin dejar la pila sucia
  const cyc = book({ Hoja1: { A1: '=B1', B1: '=A1' } });
  eq(cyc.eng.evalFormula(0, 5, 5, '=A1').code, '#CIRC!'); eq(cyc.eng.stack.size, 0); eq(cyc.val('A1'), '#CIRC!');
});
test('evalFormulaBool: VERDADERO o número ≠ 0; FALSO, 0, vacío, texto y error → falso; matriz → primer elemento', () => {
  const { bool } = efBook();
  eq(bool(0, 0, 0, '=A2>1'), true); eq(bool(0, 0, 0, '=A1>0'), false); eq(bool(0, 1, 1, '=A1>0', { from: { r: 0, c: 0 } }), true);
  eq(bool(0, 0, 0, '=1'), true); eq(bool(0, 0, 0, '=-2,5'), true); eq(bool(0, 0, 0, '=0'), false); eq(bool(0, 0, 0, '=VERDADERO'), true);
  eq(bool(0, 0, 0, '=FALSO'), false); eq(bool(0, 0, 0, '=A9'), false); eq(bool(0, 0, 0, '="VERDADERO"'), false); eq(bool(0, 0, 0, '="x"'), false);
  eq(bool(0, 0, 0, '=1/0'), false); eq(bool(0, 0, 0, '=SUMA('), false); eq(bool(0, 0, 0, '=E1'), false);
  eq(bool(0, 0, 0, '={1\\0}'), true); eq(bool(0, 0, 0, '={0\\1}'), false); eq(bool(0, 0, 0, '=A2:A3>1'), true); eq(bool(0, 0, 0, '=A1:A3>0'), false);
  eq(bool(0, 0, 0, 'A3>1,5'), true); eq(bool(0, 0, 0, 'A1<0'), true); eq(bool(1, 0, 0, '=Tope=20'), true);
});

console.log(`\n${pass} pruebas OK, ${fail} fallidas`);
process.exit(fail ? 1 : 0);

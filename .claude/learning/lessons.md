# Lecciones aprendidas

Formato de cada entrada (agregar al final y numerar en orden):

```
## L-NNN · <título corto>
- Fecha: AAAA-MM-DD · Agente: <nombre> · Recurrencias: 1
- Qué pasó: <síntoma observado>
- Causa raíz: <por qué>
- Regla: <qué hacer siempre / nunca a partir de ahora>
- Prevención: <prueba, ítem del checklist o escenario agregado>
```
Si una lección ya existe, no la dupliques: sube "Recurrencias" y amplía la regla. Cada recurrencia se anota **dentro** de la lección (línea "Recurrencia N (fecha, agente): …"), no como nota suelta entre entradas.
Si dos lecciones comparten causa raíz, `learning-curator` las fusiona en la más antigua y la otra queda como referencia "Fusionada en L-NNN" (no se renumera, para no romper referencias).

---

## L-001 · Funciones de Excel entregadas sin su interacción completa
- Fecha: 2026-10-22 · Agente: principal · Recurrencias: 1
- Qué pasó: el usuario escribió `=SUMA(` e hizo clic en celdas; la referencia se insertaba pero las celdas no se marcaban. El usuario tuvo que reportarlo.
- Causa raíz: se implementó la lógica (insertar la referencia) sin el feedback visual que Excel da (recuadros de color, texto coloreado, modo señalar con flechas, F4, autocompletado).
- Regla: antes de dar por terminada una función, recorrer en `parity-checklist.md` todos los comportamientos de esa área (ratón, teclado y feedback visual).
- Prevención: sección "Edición de fórmulas" del checklist; escenario UI-02 en `tests/ui-scenarios.md`.

## L-002 · electron-builder falla con EPERM al renombrar
- Fecha: 2026-10-22 · Agente: principal · Recurrencias: 2
- Qué pasó: `npm run dist` falló con `EPERM: operation not permitted, rename …win-unpacked.tmp`.
- Causa raíz: el antivirus bloquea por un momento los archivos recién extraídos.
- Regla: borrar `dist/` y reintentar hasta 3 veces antes de investigar otra cosa.
- Prevención: `release-packager` lo hace automáticamente (2026-10-22: el build 1.2.1 pasó en el 3.er intento).
- Nota (2026-11-02, release-packager): para evitar EPERM no hace falta `rm -rf dist`; basta con borrar `win-unpacked` y los intermedios, y así se conservan los instaladores anteriores (instrucción del agente actualizada).

## L-003 · Particularidades de los escenarios REA/Playwright
- Fecha: 2026-10-22 · Agente: principal · Recurrencias: 1
- Qué pasó: un `wait_for` con `#grid td` falló por "strict mode violation"; el registro del service worker aparece bloqueado.
- Causa raíz: los localizadores deben resolver un solo elemento; Playwright bloquea los service workers por defecto.
- Regla: usar selectores únicos (`#grid tbody tr[data-r='0'] td:nth-of-type(1)`). Para escribir en una celda: `press` en `#gridWrap` y después `fill` en `#cellEditor`. El aviso del SW no es un error.
- Prevención: recetas en `tests/ui-scenarios.md`.

## L-004 · Grilla virtualizada: el DOM no contiene todas las filas
- Fecha: 2026-10-22 · Agente: principal · Recurrencias: 2
- Qué pasó: al virtualizar, el código que usaba `tds[r][c].offsetLeft` dejaba de funcionar para las filas fuera de la vista.
- Causa raíz: solo existen en el DOM las filas `vr.r0..vr.r1-1`.
- Regla: la geometría sale de `rect()`, `colX` y `rowY`/`rowH` (desde 11-02 el alto de fila es variable; `ROW_H` es solo el alto por omisión); `tds[r]` puede ser `undefined`. Toda iteración "por toda la hoja" se hace sobre `sheet.cells`, no sobre el DOM.
- Prevención: escenario UI-03 (saltar a la fila 50000); UI-16 paso 6.
- Recurrencia 2 (2026-11-02, grid-ui-dev): ver L-023 (alineación medida con `style.top` en vez del rect del td).

## L-005 · Recursión profunda en cadenas de fórmulas
- Fecha: 2026-10-22 · Agente: principal · Recurrencias: 1
- Qué pasó (riesgo): con la evaluación perezosa, una cadena larga (A2=A1+1 … A50000) desborda la pila.
- Causa raíz: cada referencia evalúa recursivamente a su predecesora.
- Regla: `Engine.prime()` evalúa de arriba hacia abajo antes de pintar; un `RangeError` nunca se guarda en caché.
- Prevención: prueba "cadena larga" en `tests/engine.test.js`.

## L-006 · Semántica regional (es-CL) tratada como si fuera inglés
- Fecha: 2026-10-22 · Agente: principal + excel-parity-auditor · Recurrencias: 8 (detalle de la 5 a la 8 al final de la entrada)
- Qué pasó: la coma decimal en fórmulas (`=A1*1,5`), el punto de miles (`1.500`), el orden de las fechas según el idioma del navegador y AltGr (`@`) no funcionaban como en un Excel en español. La primera la detectó `npm test`; las demás, la auditoría.
- Causa raíz: se diseñó con la configuración regional de Excel en inglés como referencia implícita.
- Regla: la referencia es **Excel en español (Chile)**: `;` como separador de argumentos, `,` como decimal, `.` como separador de miles, fechas dd/mm/aaaa, teclado español. Toda entrada, salida o atajo nuevo se prueba también con esa configuración.
- Prevención: pruebas "coma decimal estilo Excel en español (sintaxis legacy)", "separador de miles es-CL", "colación es-CL fija", "errores en español en fórmulas", "toRaw: número → texto es-CL…" y "sintaxis es-CL estricta…"; escenarios UI-05 (`locale: "en-US"`), UI-19, UI-20 (AltGr, cerrado 11-02), UI-21, UI-22 y UI-23; sección "Regional (es-CL)" del checklist.
- Promovida a regla en `CLAUDE.md` y en los agentes auditor, engine-dev, ui-dev y qa-tester (2026-10-22); regla ampliada el 2026-11-02 (learning-curator) con L-014, L-018, L-024 y L-026.
- Recurrencia 5 (2026-11-02, auditoría): (a) `compareVals` usa `localeCompare(r, undefined)` y el orden de la ñ depende del idioma del navegador; (b) los códigos de error se muestran en inglés (`#NAME?` y no `#¿NOMBRE?`); (c) los atajos Ctrl+letra son los de Excel en inglés, cuando Excel en español usa Ctrl+N, Ctrl+K, Ctrl+E, etc.; (d) la heurística de AltGr convierte Ctrl+Alt+V (Pegado especial) en la letra "v". Regla ampliada: además de números y fechas, revisar **colación, textos de error, atajos de teclado y combinaciones con Ctrl+Alt**. Toda API de Intl o `toLocale*` recibe `'es-CL'`/`'es'` explícito, nunca `undefined`.
- Recurrencias 6 a 8 (2026-11-02, consolidadas por learning-curator): L-014 (número → texto de entrada con `String(v)`), L-018 (la coma decimal se leía como separador inglés en funciones de un argumento) y L-024, fusionada en L-014 (`toStr` con punto decimal). Misma causa raíz: la configuración inglesa como referencia implícita. Regla ampliada: toda conversión número ↔ texto pasa por `toRaw`/`literal`, y la sintaxis se normaliza en los bordes (importar, abrir archivos), nunca se adivina al evaluar (L-026).

## L-007 · Una celda suelta no es lo mismo que un valor escrito
- Fecha: 2026-10-22 · Agente: excel-parity-auditor · Recurrencias: 1
- Qué pasó: `=SUMA(A1;B1)` con texto en B1 da #VALUE!; Excel ignora el texto que viene de una referencia.
- Causa raíz: el evaluador convierte la referencia a una celda en un valor escalar antes de llamar a la función, y se pierde que venía de una referencia.
- Regla: en funciones de agregación, los argumentos que son referencias (a una celda o a un rango) siguen las reglas de rango; solo los literales siguen las reglas de valor directo.
- Prevención: prueba "celda suelta como argumento sigue reglas de rango (L-007)"; `Engine.evalArg` entrega las referencias como rangos 1x1.

## L-008 · "Omitido" y "vacío" no son lo mismo en los argumentos
- Fecha: 2026-10-22 · Agente: formula-engine-dev · Recurrencias: 3
- Qué pasó: `BUSCARV(x;r;2;)` hacía búsqueda aproximada; `IZQUIERDA("abc";)` devolvía 1 carácter; `BUSCARX(…;;-1)` devolvía 0 en vez de #N/A.
- Causa raíz: se usaba `x == null` para "omitido", pero el parser entrega `undefined` si se omite y `null` si se deja vacío (`;;`), y Excel les da semánticas distintas.
- Regla: omitido → `x === undefined`; "presente y no vacío" → `given(x)`. Probar siempre las tres formas: omitido, vacío y referencia a una celda vacía.
- Prevención: pruebas de BUSCARV/COINCIDIR con el último argumento vacío, IZQUIERDA negativa, BUSCARX, "INDIRECTO: … el argumento a1 omitido, vacío o celda vacía (L-008)" y "PROMEDIO/MIN/MAX: argumento vacío escrito…"; mutación "vacío escrito = 0" en `tests/mutate.js`.
- Recurrencia 2 (2026-11-02, formula-engine-dev): las reglas de "vacío" de DESREF (alto/ancho `;;` = omitido) y del argumento a1 de INDIRECTO eran supuestos sin confirmar; INDIRECTO quedó con prueba; **DESREF `;;` sigue sin fuente** (backlog P2).
- Recurrencia 3 (2026-11-02): L-019, "vacío = 0" depende de la función. Regla ampliada: el vacío escrito se decide función por función con una fuente (`nums(args, blankZero)`).

## L-009 · Ampliar el regex de referencias puede romper el resaltado durante la edición
- Fecha: 2026-10-22 · Agente: formula-engine-dev · Recurrencias: 1
- Qué pasó: al agregar `A:A`/`1:1` a REF_RE, `=SUMA(A1:` dejaba de resaltar A1 mientras se escribía.
- Causa raíz: la UI también usa REF_RE (findRefs) sobre fórmulas incompletas.
- Regla: todo cambio en REF_RE o en el tokenizador se prueba también con fórmulas a medio escribir.
- Prevención: aserción `findRefs('=SUMA(A1:').length === 1`.

## L-010 · Cada formato de número tiene su propia regla de "no cabe"
- Fecha: 2026-10-22 · Agente: principal (qa con REA, UI-06) · Recurrencias: 1
- Qué pasó: `123456789012` en formato General mostraba `##########`; Excel muestra `1,23457E+11`.
- Causa raíz: se aplicó la regla de los formatos fijos (####) a General, que en Excel reduce decimales y pasa a notación científica.
- Regla: antes de implementar un comportamiento visual, confirmar en la documentación de Excel cómo varía según el formato o el tipo de dato.
- Prevención: escenario UI-06 (celda B3).

## L-011 · El flujo de ingreso de datos también es comportamiento de Excel
- Fecha: 2026-10-22 · Agente: principal (qa con REA, UI-08) · Recurrencias: 1
- Qué pasó: escribir `valor Tab valor Enter` dejaba los datos en escalera; en Excel, Enter después de una serie de Tab vuelve a la columna inicial.
- Causa raíz: Enter y Tab se implementaron como movimientos independientes, sin el estado que Excel recuerda entre ellos.
- Regla: los escenarios REA deben ingresar datos como lo haría una persona (filas con Tab/Enter), no celda por celda con clics; así aparecen las fallas de flujo.
- Prevención: escenario UI-08 (ingreso con Tab/Enter).

## L-012 · El aprendizaje se actualiza al terminar cada cosa, no al final
- Fecha: 2026-10-22 · Agente: principal · Recurrencias: 1 · **Reportada por el usuario**
- Qué pasó: el usuario preguntó "¿dejaste aprendizaje?" y luego ordenó: "cada vez que termines algo DEBES ACTUALIZAR EL APRENDIZAJE".
- Causa raíz: el registro dependía de que el agente se acordara; varias actualizaciones quedaron agrupadas al cierre del ciclo en vez de hacerse tarea por tarea.
- Regla: después de cada cosa terminada se actualizan lessons/checklist/backlog/escenarios/memoria, y la respuesta dice qué se actualizó.
- Prevención: Stop hook `.claude/hooks/check-learning.js` (bloquea terminar si hay código más nuevo que `.claude/learning/`), registrado en `Bassxcel/.claude/settings.json` y `REA/.claude/settings.json`.

## L-013 · Cada función nueva rompe supuestos de las ya entregadas (matriz de interacción)
- Fecha: 2026-11-02 · Agente: excel-parity-auditor · Recurrencias: 1
- Qué pasó: 1.2.0 y 1.2.1 pasaron sus escenarios (UI-07, UI-09, UI-11, UI-12), pero la auditoría encontró fallas en las combinaciones: Supr/Ctrl+D/Eliminar filas con filtro tocan filas ocultas; SUBTOTALES no ve las filas filtradas; ordenar mueve filas ocultas y rompe combinaciones; insertar filas no desplaza el filtro; con paneles inmovilizados, los ▾ del filtro y las combinaciones no siguen el desplazamiento; imprimir y .xlsx ignoran ocultas/filtro/paneles.
- Causa raíz: cada función se probó sola. Las estructuras con rango (combinaciones, filtro, ocultas, paneles) se agregaron una por una, y cada operación existente (ordenar, borrar, rellenar, insertar, imprimir, exportar, desplazar) no se revisó contra ellas.
- Regla: al entregar una función que agrega estado a la hoja (rango, filas ocultas, capa visual), recorrer la matriz **operaciones × estructuras**: ordenar, Supr, rellenar, Ctrl+Enter, copiar/pegar, insertar/eliminar filas o columnas, deshacer, imprimir, .bassx, .xlsx, desplazamiento con paneles. Las estructuras con rango se desplazan con un único `shiftRanges`, no con código propio de cada una. Las capas absolutas (`#mergeLayer`, `#fltBtns`, `#extraSel`) se redibujan en el mismo lugar que `selBox`.
- Prevención: ítems "(aud. 11-02)" del checklist; UI-24 (filtro × Supr, Ctrl+Enter, Ctrl+J, negrita, Eliminar filas y SUBTOTALES; antes se planeó como "UI-14", pero ese número lo tomó Shift+Espacio); regla en `CLAUDE.md` (2026-11-02). **Faltan**: escenario de paneles inmovilizados × filtro × combinación al desplazar, escenario de filtro × insertar filas, y la matriz como sección del checklist (backlog: qa-tester y auditor).
- Relacionada: L-033 (el estado del filtro no estaba en el modelo; es una celda de esta misma matriz). Impacto alto (P0 2, P0 3 y seis P1), así que se promovió con una sola recurrencia.

## L-014 · Un número interno nunca se escribe como texto de entrada con `String(v)`
- Fecha: 2026-11-02 · Agente: excel-parity-auditor · Recurrencias: 2 (fusiona L-024; cuenta como recurrencias 6 y 7 de L-006)
- Qué pasó: `String(1.234)` da `"1.234"`, y `literal` lo lee como 1234 por la regla de miles es-CL. Ocurre al importar .xlsx (`fromXlsx`), al pegar valores y en las series del controlador de relleno: los valores con 3 decimales se multiplican por 1000 sin aviso.
- Causa raíz: las celdas guardan el texto tal como lo escribió el usuario (formato es-CL), pero el código que genera ese texto desde un número usa la conversión de JavaScript (punto decimal). Son dos formatos y no hay una función de ida y vuelta.
- Regla: todo número que se convierte en contenido de celda pasa por una sola función `toRaw(v)` (coma decimal, sin miles), con la prueba `literal(toRaw(v)) === v`. Buscar `String(` sobre números en cada revisión.
- Prevención: prueba "toRaw: número → texto es-CL que literal() relee exacto (nunca String(v))" y mutación "número → texto con coma decimal"; escenarios REA UI-23 paso 2 (pegar valores, `3,234`), UI-25 (importar .xlsx), UI-26 paso 2 (pegar valores con errores) y **UI-40 paso 3** (series del controlador de relleno: `1,125`, `2,25` → `3,375`; REA en qa ronda 3, 2026-11-02, 3/3 OK, también en en-US); ítems "Regional" y "Portapapeles y relleno" del checklist cerrados el 2026-11-17; regla es-CL de `CLAUDE.md` y líneas en formula-engine-dev, grid-ui-dev y el auditor. Sin prevenciones faltantes desde el 2026-11-17: la de series estuvo abierta por error desde la qa ronda 3 (ver L-057, recurrencia 2).
- Recurrencia 2 (2026-11-02, formula-engine-dev, antes L-024): `="x"&1,5` daba `"x1.5"` porque `toStr` usaba `String(v)`. Regla ampliada: toda conversión número → texto (`toStr`, `toRaw`, TEXTO "General") usa coma decimal y exponente E+NN; probar `&`, CONCATENAR e IZQUIERDA con decimales. Prueba "número → texto con coma decimal es-CL (&, CONCATENAR, IZQUIERDA, LARGO)".

## L-015 · Un solver financiero falla cerca de 0 por cancelación numérica
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1
- Qué pasó: TASA(10;-100;1000), cuya raíz exacta es 0, devolvía #NUM! porque Newton no convergía.
- Causa raíz: `(1+r)^n - 1` calculado con `pow` pierde dígitos cuando r → 0, y el ruido impedía cumplir la tolerancia.
- Regla: en solvers y fórmulas financieras usar `expm1`/`log1p` para `(1+r)^n - 1` y probar siempre el caso de tasa 0 o raíz 0.
- Prevención: prueba "Financieras: NPER y TASA".

## L-016 · Los ejemplos de la documentación de Excel vienen redondeados y cada uno trae sus propios datos
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1
- Qué pasó: dos pruebas fallaron por valores de referencia mal transcritos (VNA redondeado a centavos; INTERSECCION.EJE usa 5 puntos, no los 7 del ejemplo de PENDIENTE).
- Causa raíz: se copiaron valores de memoria con más dígitos de los publicados y se reutilizaron los datos de otro ejemplo.
- Regla: tomar el dato y el resultado del mismo ejemplo de la documentación y comparar con la tolerancia de los dígitos publicados.
- Prevención: helper `close(a, b, tol)` en tests/engine.test.js; línea en formula-engine-dev (2026-11-02).
- Recurrencia 2 (2026-11-02, formula-engine-dev): el ejemplo de FECHANUMERO("5-JUL") dice "año actual 2011" pero publica 39634 (05/07/2008). Regla ampliada: recalcular el resultado publicado antes de usarlo; si no cuadra, probar con el reloj y anotar la discrepancia.

## L-017 · Excel cuenta el 29/02/1900, que no existe
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1
- Qué pasó: FECHA(1900;1;1) daba 2 y AÑO(1) daba 1899 (en Excel dan 1 y 1900). Se detectó al verificar los años de dos dígitos.
- Causa raíz: el serial se calculaba desde el 30/12/1899, lo que solo es correcto desde el 01/03/1900 (serial 61).
- Regla: antes del serial 61 el serial va un día atrás; el día de la semana sale del serial módulo 7 (serial 1 = domingo), no del calendario real.
- Prevención: prueba "FECHA: años 0–1899…"; el importador .xlsx se corrigió en la UI ronda 2a ("seriales < 61"). **Falta**: UI-25 no importa ninguna fecha anterior al 01/03/1900 (backlog, qa-tester).
- Recurrencia 2 (2026-11-02, formula-engine-dev): normalizar días con `Date.UTC` saltaba el 29/02/1900 ficticio (FECHA(1900;2;29) daba 61). Regla ampliada: los desbordes de día que cruzan febrero de 1900 se calculan desde el día 1 del mes en el calendario de Excel.

## L-018 · Una prueba con decimal es-CL en una función de un argumento destapó un bug de parseo
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1 (cuenta como recurrencia 8 de L-006; continúa en L-026)
- Qué pasó: `=HORA(0,75)` devolvía 0 y `=RAIZ(2,25)` devuelve 1,414: el argumento sobrante se ignora sin error.
- Causa raíz: sin `;` en la fórmula, `normalizeDecimals` asume sintaxis inglesa (la coma dentro de paréntesis separa argumentos) para no romper las fórmulas .xlsx importadas, que se guardan en inglés.
- Regla: las pruebas de funciones de un argumento incluyen un literal con coma decimal y sin `;`. La sintaxis inglesa se convierte a es-CL al importar; no se adivina al evaluar.
- Prevención: pruebas "sintaxis es-CL estricta: la coma siempre es decimal… (=RAIZ(2,25) = 1,5)" y "fromExcelFormula(toExcelFormula(f)) === f…"; escenario UI-21 (pendiente de REA).

## L-019 · "Vacío = 0" no es universal: depende de la función
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1 (amplía L-008, que sube a 3)
- Qué pasó: `PROMEDIO(1;;3)`, `MIN(5;)` y `MAX(;-1)` ignoraban el argumento vacío; en Excel cuenta como 0. `PRODUCTO(2;;3)` sí lo ignora (6).
- Causa raíz: `nums()` trataba igual el vacío escrito y la celda vacía.
- Regla: el vacío escrito se decide función por función, con una fuente; `nums(args, blankZero)` lo hace explícito. La referencia a una celda vacía siempre sigue las reglas de rango.
- Prevención: prueba "PROMEDIO/MIN/MAX: argumento vacío escrito…".

## L-020 · Comparar números de coma flotante con = no es lo que hace Excel
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1
- Qué pasó: `A2-ENTERO(A2)=NSHORA(7;45;0)` dio FALSO porque difieren en el último bit; `=0,1+0,2=0,3` también da FALSO.
- Causa raíz: `compareVals` compara exacto; Excel compara con 15 cifras significativas.
- Regla: las comparaciones numéricas (`=`, `<>`, criterios) redondean a 15 cifras, como Excel.
- Prevención: prueba "comparación con 15 cifras significativas en operadores y criterios; exacta en búsquedas" (motor ronda 3).

## L-021 · La selección necesita ancla y celda activa separadas
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1
- Qué pasó: Shift/Ctrl+Espacio movían la celda activa a la columna A o a la fila 1, y Tab dentro de un rango lo achicaba. UI-12 lo había dado por verificado.
- Causa raíz: `A` era a la vez la celda activa y el ancla de `range()`, así que cualquier cambio de la activa cambiaba el rango.
- Regla: el ancla (`P`) y la celda activa (`A`) son estado distinto, y las funciones que extienden la selección conservan `A`. Los escenarios verifican también dónde queda la celda activa (escribir después de seleccionar), no solo el rango.
- Prevención: UI-14 pasos 2–4; línea en grid-ui-dev y qa-tester (2026-11-02).
- Recurrencia 2 (2026-11-02, grid-ui-dev): una expectativa del arnés suponía la selección en C1 cuando el Enter la había dejado en C2; los arneses verifican la celda activa después de cada confirmación.

## L-022 · Los supuestos de layout y de librerías se miden, no se adivinan
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 2 (relacionada con L-016, L-023, L-031 y L-034)
- Qué pasó: el código suponía filas de 23 px (Chrome mide 22 con border-box); SheetJS convierte `hpx` con 96 ppp y habría exportado 40 px como 40 pt; `grep $'\r'` en Git Bash dio CRLF falsos.
- Causa raíz: supuestos sin medir sobre el navegador, la librería y las herramientas.
- Regla: antes de depender de una medida de layout o de una conversión de una librería, medirla con un arnés de Chrome headless o leer el código del vendor; los finales de línea se revisan con Python (`bytes.count`).
- Prevención: regla en `CLAUDE.md` (2026-11-02, junto con L-023 y L-034); escenarios UI-16 y UI-25. **Falta**: el arnés de Chrome headless (aserciones de alto, alineación, .xlsx de ida y vuelta, `h5.js`) no está en el repositorio, así que no se puede volver a ejecutar (backlog, grid-ui-dev).
- Recurrencia 2 (2026-11-02, grid-ui-dev, UI ronda 2a): otra vez `grep -c $'\r'` de Git Bash no fue fiable; los conteos se hacen con Python (`bytes.count`).
- Recurrencia 3 (2026-11-02, grid-ui-dev): SheetJS quita `_xlfn.` al leer salvo con `xlfn: true` (`A1#` y `@` se perdían al importar); se midió con un archivo real (`tests/xlsx-spill.measure.js`).

## L-023 · Las alineaciones en escenarios se comparan con getBoundingClientRect de la celda
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1 (amplía L-004)
- Qué pasó: comparar `parseFloat(style.top)` (Chrome lo serializa con 6 cifras: 1.10007e+06) con `offsetTop` dio un falso desfase de 3 px en la fila 50000; en paneles inmovilizados lo sticky son los td, no el tr.
- Causa raíz: la aserción leía una representación (texto del estilo, rect del tr) en vez de la posición pintada de la celda; Chrome redondea `style.*` y, con paneles, el tr no se mueve con el td. *(Agregada por learning-curator el 2026-11-02: faltaba en la entrada.)*
- Regla: en escenarios y arneses, la alineación se compara con `getBoundingClientRect()` del td, nunca con `style.*` ni con el rect del tr.
- Prevención: recetas de UI-16.

## L-024 · Toda conversión número → texto del motor también es regional · **Fusionada en L-014**
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Fusionada por learning-curator el 2026-11-02: misma causa raíz que L-014 (`String(v)` sobre un número da punto decimal). El caso (`toStr`, `="x"&1,5`), la regla y la prueba quedaron en L-014 como recurrencia 2.

## L-025 · Editar código con barras invertidas mediante scripts de shell las pierde (y los textos de reemplazo también son código)
- Fecha: 2026-11-02 · Agente: formula-engine-dev, agente principal, grid-ui-dev · Recurrencias: 12 (fusiona L-027; detalle de la 6 a la 12 al final de la entrada)
- Qué pasó: (1–2) un heredoc convirtió `\d` en `d` dentro de engine.js y `{1\2}` en un escape octal en un script de prueba; además, el reemplazo `e$10$2` se leyó como el grupo 10. (3) Otro heredoc volvió a perder barras, y un reemplazo con `$'` insertó el resto del archivo en una copia mutada de engine.js. (4) Al registrar la UI ronda 1, un `s.replace(marca, texto)` con `$'` dentro del texto pegó el resto de este archivo en medio de L-022 (lo detectó qa-tester; se reparó con Python sobre bytes). (5) Un heredoc con comillas y comillas invertidas falló en bash (unexpected EOF) al agregar escenarios; se rehízo con Write + Python.
- Causa raíz: hay capas de escape (bash, JS y regex); en `String.replace`, `$'`, `$&`, `` $` `` y `$1` seguido de un dígito son patrones especiales, así que un texto que es un dato se interpreta como código.
- Regla: el código o texto con `\`, regex, comillas invertidas o `$` se edita con Edit o Write, nunca con heredoc, `sed` ni `echo`. Si un script es inevitable, se escribe con Write (no con heredoc), usa `String.raw`, y todo reemplazo cuyo texto es un dato usa una función: `s.replace(a, () => b)`. Después, `npm test` y revisar el resultado (en `.md` CRLF, contar con Python `bytes.count`).
- Prevención: regla en `CLAUDE.md` y en los agentes (2026-11-02), ampliada el 2026-11-04 con L-065: nada de `node -e` ni `python -c`; scripts con Write en el scratchpad, también para una línea; lectura y escritura en binario; `check:integrity` y conteo con `bytes.count`. Ampliación llevada el 2026-11-17 a grid-ui-dev, qa-tester, formula-engine-dev y learning-curator. `tests/mutate.js` usa funciones de reemplazo (líneas 43 y 48); `npm run check:integrity` detecta un `app.js` alterado. Como la regla ya existía, las recurrencias 6 a 12 son incumplimientos: el agente que la rompa lo registra aquí.
- Recurrencia 6 (2026-11-02, formula-engine-dev, matrices dinámicas): un heredoc volvió a partir las barras de un script de reemplazos; no se escribió nada roto (rehecho con Edit). La regla ya está en CLAUDE.md: el incumplimiento viene de no seguirla.
- Recurrencia 7 (2026-11-02, grid-ui-dev), en código de producto: Reemplazar interpretaba `$&` del texto del usuario como patrón; corregido con `() => rep`.
- Recurrencia 8 (2026-11-02, grid-ui-dev): heredoc con comillas para un reemplazo en Python; no rompió nada, pero va contra la regla.
- Recurrencia 9 (2026-11-04, grid-ui-dev): un heredoc con `\"` para un script de prueba del reintento; funcionó, pero contra la regla.
- Recurrencias 10 a 12 (2026-11-04, ronda 5e): grid-ui-dev usó un heredoc con Python y un `node -e` con `$` escapado en bash (el heredoc llevó a L-065); la sesión principal pasó un reemplazo con comillas invertidas escapadas en `python -c` desde bash para corregir `ui-scenarios.md`. Los tres funcionaron, pero ninguno se ajusta a la regla: los scripts se escriben con Write en el scratchpad y se ejecutan desde allí, también para cambios de una línea.

## L-026 · Un cambio de sintaxis necesita una migración que preserve resultados y un cambio atómico
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1 (continúa L-018)
- Qué pasó: arreglar la coma decimal solo en el motor habría cambiado sin aviso fórmulas guardadas e importadas (`=IF(A1>0,1,0)` pasaría a error y `=SUM(1,5)` a 1,5).
- Causa raíz: la regla vieja adivinaba la sintaxis al evaluar, en vez de normalizarla al guardar o importar.
- Regla: la sintaxis se normaliza en los bordes (importar .xlsx, abrir archivos viejos) y la migración conserva el valor calculado. El modo nuevo se activa en un solo cambio, junto con la importación y la migración, y la suite se corre con ambos modos por omisión.
- Prevención: pruebas "fromExcelFormula(toExcelFormula(f)) === f…", "migrateLegacyFormula: … mismo resultado…" y "la sintaxis por omisión es es-CL…"; la parte "normalizar en los bordes" entra en la regla es-CL de `CLAUDE.md` (2026-11-02). Ver también L-029: la migración resultó no ser necesaria.

## L-027 · Los textos de reemplazo también son código · **Fusionada en L-025**
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Fusionada por learning-curator el 2026-11-02: misma causa raíz que L-025 (capas de escape de bash y patrones `$` de `String.replace`). Sus recurrencias (3, 4 y 5 del total) y la regla del reemplazo con función quedaron en L-025, que se promovió a regla.

## L-028 · Una prueba que pasa a la primera se verifica con una mutación
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 8 (la recurrencia 2 y las seis ampliaciones siguientes, de la 3 a la 8 en orden)
- Qué pasó: las 8 pruebas nuevas de nombres y aridad pasaron sin fallar nunca, así que no había evidencia de que detectaran errores.
- Causa raíz: una prueba verde puede no ejercitar la rama que dice cubrir.
- Regla: en semántica nueva, romper a propósito cada regla clave (prioridad de ámbito, regex, conversión a rango…) y confirmar que la suite falla.
- Prevención: `tests/mutate.js` + `npm run mutate` (16/16 en la ronda 5; 75/75 en la ronda `evalFormula`); `tests/ui-mutate.js` sobre una copia, con mutación y arnés asociados por nombre exacto (L-049); regla en `CLAUDE.md` y en formula-engine-dev (2026-11-02). Ampliada en `CLAUDE.md` el 2026-11-04: datos que distingan la versión mutada, lecturas que no lanzan, y antes de declarar una mutación no detectada se leen sus fallas y se repite sola. Ampliación llevada el 2026-11-17 a formula-engine-dev, grid-ui-dev y qa-tester.
- Recurrencia 2 (2026-11-02, motor ronda 5): el script vivía en el scratchpad con rutas fijas; pasó a `tests/mutate.js`. Regla ampliada: cada regla semántica nueva agrega su mutación, y `npm run mutate` debe dar 100 % antes de entregar.
- Ampliación (2026-11-02, grid-ui-dev): una mutación equivalente para los datos del arnés (la región actual coincidía con el rango del filtro) se descarta o se agregan datos que la distingan.
- Ampliación (2026-11-04, grid-ui-dev): si una mutación no se detecta, primero ver si el código mutado es redundante; si lo es, se elimina el código (un bucle de `regionOf`) y no se inventan datos para "detectarla". No se edita `web/` mientras corre `ui-mutate.js` (el guardia de L-049 lo marca).
- Ampliación (2026-11-04, sesión principal): una mutación salió "NO DETECTADA" aunque el arnés fallaba, porque el patrón de aserciones esperadas (`/V4 eliminar la primera fila/`) no incluía la que de verdad la detectaba (`V4 insertar una fila arriba…`). Antes de contar una mutación como no detectada, leer sus "fallas": si una aserción legítima la detecta, se amplía el patrón; si no hay ninguna, falta una prueba.
- Ampliación (2026-11-04, formula-engine-dev): una mutación sobrevivió porque el dato coincidía por casualidad (`A3>1,5` sin `=` se lee como `3>1,5` y da lo mismo); las pruebas de reglas sobre texto o prefijos usan datos con los que la versión mutada da otro valor. Y cuando quitar una guarda colgaría la suite (tope de tamaño), se muta su magnitud en vez de quitarla.
- Ampliación (2026-11-04, grid-ui-dev, ronda 5d): una mutación de `ui-cf` no detectada y sin ninguna falla señaló código redundante (el comportamiento era el mismo sin él); se quitó el código junto con su mutación. Una mutación sin fallas es una prueba que falta o un código que sobra: decidir cuál antes de seguir.
- Ampliación (2026-11-04, grid-ui-dev, ronda 5e): (1) una mutación "no detectada y sin fallas" no era código sobrante: Chrome dispara `mouseleave` al ocultar el menú bajo el ratón real y eso tapaba la falla; la prueba buena recorre el camino sin ratón real. (2) Una mutación era equivalente (`undefined` vs `null`) hasta guardar el archivo: se reemplazó. (3) Una aserción que lanza una excepción corta el arnés y oculta las siguientes: las lecturas de las aserciones no lanzan. Corrige la ampliación de la 5d: antes de quitar código por "redundante", descartar que otro evento esté tapando la diferencia.

## L-029 · Antes de construir compatibilidad, confirmar qué datos del usuario hay que proteger
- Fecha: 2026-11-02 · Agente: principal + formula-engine-dev · Recurrencias: 1 · **Corregida por el usuario** (en la métrica cuenta como reportada por el usuario desde el 2026-11-02)
- Qué pasó: en la ronda 3 se diseñaron un modo legacy por omisión y migraciones; el usuario aclaró que todavía no tiene archivos propios.
- Causa raíz: se supuso que había datos guardados sin preguntarlo.
- Regla: antes de agregar capas de compatibilidad o migración, preguntar o verificar si hay archivos reales; si no los hay, se cambia el valor por omisión y la compatibilidad queda como opción explícita.
- Prevención: es-CL por omisión y legacy solo con `setSyntax('legacy')` (prueba "la sintaxis por omisión es es-CL…"); memoria "sin-archivos-previos"; regla en `CLAUDE.md` (2026-11-02, por venir del usuario).

## L-030 · Una receta de escenario no es válida hasta ejecutarla en REA
- Fecha: 2026-11-02 · Agente: qa-tester · Recurrencias: 1 (amplía L-003)
- Qué pasó: `ui-scenarios.md` indicaba usar `evaluate` y un formato de acción que REA no acepta; UI-14..UI-16 dependían de eso.
- Causa raíz: las recetas se escribieron desde un arnés propio de Chrome headless, sin probarlas con `capture_browser_scenario`.
- Regla: toda receta nueva se ejecuta una vez en REA antes de guardarse; lo que REA no puede hacer pasa por el puente de QA (`#qaEval`, servidor `qa-serve.js`) documentado en `tests/ui-scenarios.md`.
- Prevención: sección "Formato real de las acciones de REA" en `tests/ui-scenarios.md`; `tests/qa-serve.js` (movido en la UI ronda 2a); regla en `CLAUDE.md` y en qa-tester (2026-11-02).
- Ampliación (2026-11-04, qa-tester, UI-44): cada llamada a `capture_browser_scenario` usa un perfil vacío, así que el autoguardado no pasa de un sub-escenario a otro; cada sub-escenario carga sus propios datos (preparación con el puente) o se encadena dentro de la misma llamada.
- Ampliación (2026-11-04, qa-tester, UI-45 paso 6): un texto esperado escrito a mano (`+Nombre` en vez de `+Columna A`) hizo fallar la receta; los textos esperados se copian de la salida del arnés o de una ejecución.
- Ampliación (2026-11-04, grid-ui-dev, UI-48): Playwright no hace clic en un elemento tapado por una capa, así que el clic en una celda a través de un cuadro no modal va por el puente en REA y el clic real se prueba en el arnés de CDP.

## L-031 · Un evento simulado no prueba un gesto del navegador
- Fecha: 2026-11-02 · Agente: qa-tester · Recurrencias: 1 (relacionada con L-022)
- Qué pasó: el doble clic en el borde de fila "funcionaba" con un `dblclick` simulado, pero con un doble clic real no autoajusta: el mouseup reconstruye las filas y el segundo clic cae en un nodo que ya no está en la página.
- Causa raíz: el arnés despachaba `dblclick` directamente; los eventos compuestos (click, dblclick, contextmenu) los genera el navegador solo si el destino sigue en el DOM.
- Regla: los gestos compuestos se prueban con entrada real (REA `click_count: 2`, `button: "right"`); un manejador de mousedown o mouseup no reconstruye el elemento bajo el puntero si no hubo cambio.
- Prevención: nota en UI-16 paso 3; UI-27 paso 4 (doble clic real, pendiente de REA); regla en `CLAUDE.md`, grid-ui-dev y qa-tester (2026-11-02).
- Precisión (2026-11-02, grid-ui-dev): reconstruir el DOM en el `click` no rompe el doble clic real; lo rompe reconstruir entre mousedown y mouseup. La mutación que suponía lo contrario no se detectaba porque no era una falla, y se reemplazó.

## L-032 · Una regla documentada puede ser de otra capa (celda o fórmula)
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1 (relacionada con L-010)
- Qué pasó: se pidió aplicar a `&` y a `toStr` la regla de "11–12 caracteres del formato General"; la documentación la describe para la celda (depende del ancho de columna), y la evidencia de `&` (0,000552; 1/3 con 15 cifras) la contradice.
- Causa raíz: "formato General" nombra dos comportamientos distintos: lo que se ve en la celda y la conversión a texto.
- Regla: antes de aplicar una regla documentada, confirmar a qué capa pertenece (lo que se ve en la celda, en la UI, o el valor, en el motor) y buscar evidencia de esa capa.
- Prevención: prueba "número → texto con el formato General"; la regla de la celda queda en la UI (L-010); línea en formula-engine-dev (2026-11-02).

## L-033 · El estado del filtro vive en el modelo, no se recalcula en cada dibujo
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1
- Qué pasó: `hiddenRows()` reevaluaba los criterios en cada `buildGrid`, así que editar una fila filtrada la volvía a ocultar y el motor no sabía qué filas oculta el filtro (SUBTOTALES = 380 en vez de 300).
- Causa raíz: el estado del filtro era derivado de la UI, no parte del modelo.
- Regla: todo estado que lee el motor o que sobrevive a una edición vive en el modelo (`sheet.filter.hidden`), se actualiza solo al aplicar el filtro, sigue a las filas en `shiftCells` y cada cambio llama a `eng.recalc()`.
- Prevención: UI-24 (SUBTOTALES 9/109, Supr, Ctrl+Enter, negrita, Eliminar filas; pendiente de REA); prueba del motor "SUBTOTALES: 1–11 excluyen filtradas…"; regla en `CLAUDE.md` junto con L-013 (2026-11-02). El arnés h5 no está en el repositorio (ver L-022).
- Recurrencia 2 (2026-11-02, qa-tester, UI-42): ordenar con filtro activo no actualiza `sheet.filter.hidden` y su deshacer no lo restaura; SUBTOTALES da 300 en vez de 370 sin aviso. Regla ampliada: toda operación que reordena filas, y su deshacer, actualiza o vuelve a aplicar el estado del filtro, y el registro de deshacer lo incluye.

## L-034 · Un arnés que lee celdas no debe confiar en posiciones tras cambios estructurales ni leer lo oculto
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1 (amplía L-023)
- Qué pasó: dos falsos negativos. Un número de una columna oculta "se veía" como 2E+00 porque la columna mide 0 px, y una aserción buscó en F3 una celda que "Eliminar filas" había movido a F2.
- Causa raíz: el arnés tenía direcciones fijas escritas antes de la operación y leía el texto pintado sin mirar si la columna estaba visible. *(Agregada por learning-curator el 2026-11-02: faltaba en la entrada.)*
- Regla: después de operaciones estructurales, los arneses buscan las celdas por contenido o fórmula, y no leen columnas ocultas como si fueran visibles.
- Prevención: regla en `CLAUDE.md` junto con L-022 y L-023 (2026-11-02). `h5.js` (que busca la celda exportada por su fórmula) no está en el repositorio (ver L-022, backlog).

## L-035 · Una celda vacía puede depender de fórmulas que no referencia (desborde)
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1
- Qué pasó: con evaluación perezosa, consultar las fórmulas candidatas al leer una celda fantasma dio un `#CIRC!` falso y un valor mal calculado (A3 `=SECUENCIA(1;3)` con B1 `=B3*{1\2}`). Lo detectó una prueba propia.
- Causa raíz: se evaluaba a la candidata en nombre de otra fórmula, y si tocaba algo ya en curso se marcaba como ciclo.
- Regla: toda evaluación hecha "en nombre de" otra es tentativa: si llega a una celda en curso desde fuera, se aborta y se deshace lo guardado; solo es ciclo lo que está dentro de la misma tentativa.
- Prevención: pruebas "desborde y ciclos"; mutaciones "evaluación tentativa…".

## L-036 · Un comentario // a mitad de línea esconde las aserciones que siguen
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 2 (una vieja en INDIRECTO E15/E16 y otra en esta ronda)
- Qué pasó: `eq(E15)` y `eq(E16)` de INDIRECTO nunca se comprobaban; al corregirlo se repitió el error con E11, E12 y E6.
- Causa raíz: insertar un comentario explicativo en medio de una línea de aserciones.
- Regla: los comentarios de las pruebas van en su propia línea o al final, nunca antes de otra aserción.
- Prevención: una prueba lee `engine.test.js` y falla si hay `eq`/`assert` después de `// `.

## L-037 · Una mutación que no compila no detecta nada
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1 (amplía L-028)
- Qué pasó: la mutación "A:A incluye los desbordes" dejó un error de sintaxis y contó como "detectada (la suite no terminó)".
- Causa raíz: `mutate.js` trataba cualquier fallo de la suite como detección, aunque el código mutado no compilara.
- Regla: `mutate.js` compila cada mutación con `vm.Script` y la rechaza si no compila.
- Prevención: `tests/mutate.js`.
- Ampliación (2026-11-02, grid-ui-dev): una corrida de mutación sin línea de resumen cuenta como "sin resultado", no como "no detectada" (`tests/ui-mutate.js`).

## L-038 · La intersección implícita de Excel es por referencia, no por fórmula
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1
- Qué pasó: envolver la fórmula entera (`=@(A1:A3*2)`) da 2 en la fila 2; Excel (`=@A1:A3*2`) da 4.
- Causa raíz: se emuló la conversión que hace Excel al abrir un archivo sin probarla fuera de la fila 1.
- Regla: al emular una conversión de Excel, probar evaluando en una fila distinta de la 1 y dentro de agregaciones (`=SUMA(A1:A3*2)` → `=SUMA(@A1:A3*2)`).
- Prevención: tabla LEG en la prueba "@"; mutaciones de `implicitIntersect`.

## L-039 · En una prueba de desborde, el resultado depende de todo lo que hay en el área, la fila y la columna
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1 (4 expectativas mal escritas)
- Qué pasó: la celda de destino estaba ocupada; C:C se acotaba hasta la fila 10 por otra celda; SUMA(3:3) incluía otra fórmula; ORDENAR de una fila ordena filas.
- Causa raíz: escenarios de prueba que compartían el mismo libro y zonas.
- Regla: un libro por escenario o zonas reservadas; ante un `#SPILL!` inesperado, leer `spillError` antes de tocar el código.
- Prevención: pruebas con `área(…)` y libros separados.

## L-040 · Los datos que entran "por el costado" saltan la lógica del editor
- Fecha: 2026-11-02 · Agente: qa-tester · Recurrencias: 1 (relacionada con L-006 y L-014)
- Qué pasó: escribir `$1.500` da moneda, pero pegarlo o importarlo desde CSV deja texto, y SUMA lo ignora en silencio (1235 en vez de 2735).
- Causa raíz: la detección del formato de entrada (`autoEntryFmt`) vive en `commitEdit`; pegar y CSV asignan `cell.v` directamente.
- Regla: toda vía que crea contenido (editor, pegar, CSV, .xlsx, relleno, Ctrl+Enter) pasa por la misma función de entrada; los escenarios prueban las tres vías con moneda, porcentaje, miles y fecha es-CL.
- Prevención: UI-28 paso 4.
- Recurrencia 2 (2026-11-02, grid-ui-dev): `commitEdit` guardaba texto si la celda ya tenía formato, y Reemplazar no pasaba por la lógica de entrada; ahora todo usa `entryCell`.

## L-041 · El autoguardado no reemplaza la pregunta "¿Guardar cambios?"
- Fecha: 2026-11-02 · Agente: qa-tester · Recurrencias: 1
- Qué pasó: Abrir reemplaza el libro sin preguntar y sobrescribe su único respaldo; recargar con el autoguardado fallido pierde datos sin aviso.
- Causa raíz: se asumió que el autoguardado siempre funciona y que hay un solo libro.
- Regla: toda acción que descarta el libro actual (Abrir, archivo recibido por Electron o PWA, cerrar o recargar con autoguardado fallido) pregunta como "Nuevo"; el escenario de cada acción destructiva incluye el caso "sin guardar".
- Prevención: UI-28 pasos 2 y 3.

## L-042 · Toda agregación visible respeta las filas filtradas, no solo las fórmulas
- Fecha: 2026-11-02 · Agente: qa-tester · Recurrencias: 1 (amplía L-013, que ya es regla)
- Qué pasó: SUBTOTALES ya excluye las filas filtradas, pero la barra de estado sigue sumándolas.
- Causa raíz: la matriz operaciones × estructuras se aplicó a las acciones de edición, pero no a las vistas que agregan (barra de estado, imprimir, copiar).
- Regla: en la matriz de L-013 también van la barra de estado, imprimir y copiar.
- Prevención: nota del hallazgo en UI-24; falla P1 4 del backlog.

## L-043 · Un arnés que borra el almacenamiento antes de recargar choca con el autoguardado
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1
- Qué pasó: el arnés borraba localStorage y recargaba, pero el autoguardado del `beforeunload` lo volvía a escribir y los grupos de pruebas heredaban el libro anterior.
- Causa raíz: el orden "borrar y recargar" deja que la página viva escriba después del borrado.
- Regla: primero salir de la página (`about:blank`) y recién después borrar el almacenamiento (`Storage.clearDataForOrigin`).
- Prevención: `tests/ui-round2b.harness.js`.

## L-044 · En los menús, `nth-child` cuenta los separadores: en arneses se hace clic por texto
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1 (relacionada con L-003)
- Qué pasó: `nth-child` contó un `<hr>`; el clic equivocado dejó la barra de fórmulas en edición y causó 8 falsos negativos. UI-23 tenía el mismo problema al agregar "Fórmulas" al menú.
- Causa raíz: los selectores por posición dependen del orden de los elementos, que cambia al agregar opciones.
- Regla: en arneses y escenarios, las opciones de menú se eligen por su texto, no por posición.
- Prevención: arnés de la ronda 2b; UI-23 corregido.

## L-045 · En Windows, matar Chrome deja procesos hijos que cuelgan el siguiente arnés
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1
- Qué pasó: `kill()` dejó vivos los procesos hijos de Chrome; el siguiente arnés se conectó al navegador huérfano y se colgó.
- Causa raíz: en Windows, `kill()` no termina el árbol de procesos.
- Regla: terminar con `taskkill /T` y comprobar que el puerto CDP quedó libre antes de lanzar otro arnés.
- Prevención: `tests/cdp.js`.
- Recurrencia 2 (2026-11-02, release-packager): `taskkill /T` sin `/F` no cerró Electron (un hijo solo termina de forma forzada); hace falta `taskkill /F /T` y comprobar que quedan 0 procesos `Bassxcel.exe`.

## L-046 · Un `<dialog>` que se cierra con el teclado debe frenar la propagación
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1
- Qué pasó: el Enter que cerraba un cuadro de diálogo llegaba también al manejador del documento, que ya no veía un cuadro abierto y confirmaba la celda.
- Causa raíz: el manejador del cuadro cerraba el `<dialog>` sin `stopPropagation`.
- Regla: todo manejador de teclado dentro de un `<dialog>` que lo cierra llama a `stopPropagation` (y `preventDefault` si corresponde).
- Prevención: grupo N4 de `tests/ui-names.harness.js`.

## L-047 · Al cerrarse, un `<dialog>` devuelve el foco a quien lo tenía
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 3
- Qué pasó: forzar el foco a la grilla después de cerrar un cuadro borraba lo escrito en el cuadro de nombres.
- Causa raíz: se ignoró que el navegador restaura el foco al elemento anterior al abrir el `<dialog>`.
- Regla: después de cerrar un `<dialog>`, dejar que el navegador restaure el foco; moverlo solo si el flujo de Excel lo exige.
- Prevención: `tests/ui-names.harness.js`; arnés `ui-sort` (aceptar con clic tras "Opciones…"); receta UI-44 con registro de `focusin`. Promovida el 2026-11-04 a la regla de `CLAUDE.md` "Arneses y recetas no heredan estado…" (junto con L-021 y L-054); líneas en grid-ui-dev y qa-tester (2026-11-17).
- Recurrencia 2 (2026-11-04, grid-ui-dev): al cerrar el cuadro anidado "Opciones…", el foco vuelve a su botón y Enter lo reabre en vez de aceptar "Ordenar". Regla: después de cerrar un cuadro anidado, arneses y recetas aceptan con clic o comprueban dónde quedó el foco.
- Recurrencia 3 (2026-11-04, qa-tester): medir el foco lo cambiaba (el `fill` en `#qaEval` y `press` con localizador mueven el foco). El foco se lee con un registro de `focusin` y las teclas se envían a `:focus`. Promovida (ver "Prevención").

## L-048 · El Enter sintético debe llevar su carácter para comportarse como un teclado real
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1 (relacionada con L-031)
- Qué pasó: el Enter enviado por CDP sin el carácter `\r` no enviaba formularios y daba falsos negativos.
- Causa raíz: un `keyDown` sin `text` no genera el evento de carácter que el navegador usa para el envío.
- Regla: las teclas sintéticas se envían con `key`, `code` y `text` como un teclado real.
- Prevención: `tests/cdp.js`.

## L-049 · Un script de mutaciones no debe escribir sobre el archivo real del producto
- Fecha: 2026-11-02 · Agente: principal (detectado por el Stop hook durante qa ronda 3) · Recurrencias: 1 (relacionada con L-028 y L-037)
- Qué pasó: `tests/ui-mutate.js` escribe cada mutación sobre `web/app.js` y lo restaura en un `finally`. Mientras corre, cualquier escenario REA o servidor que sirva `web/` ve la versión mutada, y si el proceso muere a la fuerza (taskkill, timeout del host, cierre de la sesión) el `finally` no se ejecuta y `app.js` queda roto sin aviso. Además, el proyecto no está en git, así que no hay cómo recuperar el original.
- Causa raíz: se copió el patrón "mutar y restaurar" en lugar del de `tests/mutate.js` del motor, que trabaja sobre una copia en una carpeta temporal.
- Regla: las mutaciones se aplican sobre una copia (carpeta temporal con `web/` copiada y el arnés apuntando a ella), nunca sobre los archivos del producto; antes de generar una versión se verifica que el producto no contenga ninguna mutación (todos los textos `from` de `ui-mutate.js` presentes).
- Prevención: backlog P1 "ui-mutate.js sobre una copia"; verificación de integridad de `app.js` antes de release-packager.
- Resuelta (2026-11-02, grid-ui-dev): `tests/ui-mutate.js` muta una copia temporal de `web/` y compara el hash de `app.js` al final; `npm run check:integrity` verifica el producto antes de cada versión.

## L-050 · Toda acción REA lleva `timeout_ms`, y los cuadros de diálogo no se esperan con `wait_for`
- Fecha: 2026-11-02 · Agente: qa-tester · Recurrencias: 1 (amplía L-030)
- Qué pasó: un escenario de UI-38 colgó REA 30 minutos esperando un cuadro de diálogo con `wait_for`; al repetirlo con `timeout_ms` en cada acción y sin `wait_for` sobre los diálogos, pasó completo.
- Causa raíz: `wait_for` sobre un `<dialog>` modal no termina si el estado esperado nunca se cumple, y sin `timeout_ms` la acción no tiene límite.
- Regla: cada acción REA lleva `timeout_ms`; los diálogos se esperan con `wait_for_timeout` seguido del clic, y los estados intermedios se leen con un `MutationObserver` que escribe en la consola.
- Prevención: notas de receta en `tests/ui-scenarios.md` (ronda 3).
- Ampliación (2026-11-04, qa-tester): `wait_for_timeout` no acepta `timeout_ms` y REA rechaza el escenario completo. Antes de escribir una regla general de formato, probar cada tipo de acción una vez.
- Ampliación (2026-11-04, qa-tester, UI-45): un observador de consola con retardo (120 ms) pierde estados intermedios cuando REA encadena clics; toda lectura de un estado intermedio lleva antes un `wait_for_timeout` mayor que el retardo (≥ 200 ms). Que un estado no aparezca no prueba que no exista.

## L-051 · Una validación nueva al confirmar puede romper escenarios ya aprobados
- Fecha: 2026-11-02 · Agente: qa-tester · Recurrencias: 1
- Qué pasó: `checkFormula` empezó a rechazar `=A1*1,` (decimal final, que Excel acepta) y cambió el paso 4 de UI-21; además, lo que el editor bloquea se calcula en silencio si la fórmula entra por pegar o CSV.
- Causa raíz: la validación se probó con lo que debía rechazar, no con lo que Excel sí acepta, y solo en una de las vías de entrada.
- Regla: al agregar una validación, repetir la regresión de entrada y probar el validador con casos que Excel acepta; lo que se bloquea en el editor también se resuelve de forma coherente en las demás vías (L-040).
- Prevención: UI-21 paso 4 actualizado; P2 en el backlog.
- Recurrencia 2 (2026-11-02, formula-engine-dev): el validador se corrigió con casos que Excel acepta (`=1,`) en las cuatro vías por las que pasa la fórmula: evaluar, validar, exportar a .xlsx y migrar.
- Recurrencia 3 (2026-11-02, grid-ui-dev): no solo una validación; también un comportamiento nuevo (herencia de formato de SUMA) cambió una expectativa aprobada (grupo A1: `2735` → `$2.735`).

## L-052 · Al quitar un carácter de un token, el token puede pegarse al siguiente
- Fecha: 2026-11-02 · Agente: formula-engine-dev · Recurrencias: 1
- Qué pasó: al quitar el decimal final para exportar a .xlsx, `1,,5` (inválida) quedaba como `1.5` (válida); una fórmula mala se convertía en buena sin aviso.
- Causa raíz: la normalización miraba el token aislado, no lo que lo rodea.
- Regla: toda normalización que quita o cambia caracteres de un token se prueba con el token repetido o pegado a sí mismo (`1,,5`, `1..5`).
- Prevención: mutación "decimal final pegado a otro número se conserva" en `tests/mutate.js`.

## L-053 · Reparar un estado derivado fuera del registro de deshacer deja el deshacer incoherente
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 1 (relacionada con L-033)
- Qué pasó: al ordenar desde el ▾ se llamaba a `applyFilter` después de ordenar, fuera del registro de deshacer; Ctrl+Z restauraba el orden pero dejaba ocultas las filas equivocadas.
- Causa raíz: el invariante (qué filas oculta el filtro) se reparaba después de la acción en lugar de mantenerse dentro de ella.
- Regla: los invariantes del modelo se mantienen dentro de la operación y de su registro de deshacer; nunca se "reparan" después con otra llamada que no se deshace.
- Prevención: grupo D de `tests/ui-round2b.harness.js` (cinta y ▾ con Ctrl+Z y Ctrl+Y) y su mutación.
- Modelo (2026-11-04, grid-ui-dev, ronda 5c): un registro de deshacer por celdas puede llevar estado de hoja en el mismo paso (`applyChanges(items, { dv })` guarda `rec.dv`); úsalo para el formato condicional. Y si un diálogo asíncrono bloquea un gesto, la función que confirma recibe lo que sigue (`commitEdit(next)`) en vez de hacerlo quien la llamó.

## L-054 · Antes de cada gesto del arnés se fija la selección y el desplazamiento
- Fecha: 2026-11-02 · Agente: grid-ui-dev · Recurrencias: 4 (relacionada con L-021 y L-034)
- Qué pasó: un clic derecho dentro de una selección previa la conservó (como en Excel) y ocultó cinco filas en vez de una; además, `goto` había desplazado la hoja y el gesto cayó en otra celda.
- Causa raíz: los gestos dependían del estado que dejó el paso anterior.
- Regla: cada gesto del arnés empieza fijando la selección y el desplazamiento esperados; al insertar escenarios en `ui-scenarios.md`, verificar que no se pierdan encabezados vecinos (UI-01 se perdió una vez).
- Prevención: grupo D del arnés de la ronda 2b; encabezado de UI-01 restaurado; recetas UI-42 paso 4e (clic izquierdo antes del clic derecho) y UI-44 paso 2 (clic en B5); arnés `ui-cf2` con celdas fuera del cuadro no modal. Promovida el 2026-11-04 a la regla de `CLAUDE.md` "Arneses y recetas no heredan estado…" (junto con L-021 y L-047); líneas en grid-ui-dev y qa-tester (2026-11-17).
- Recurrencia 2 (2026-11-02, qa-tester, UI-42 paso 4e): después de pegar, la selección quedó en A1:C6 y el clic derecho la conservó, así que "Ocultar filas" ocultó seis filas; la receta ahora hace clic izquierdo en la celda antes del clic derecho.
- Recurrencia 3 (2026-11-04, qa-tester, UI-44 paso 2): la receta copió las acciones principales del arnés pero no el clic en B5 que fijaba la selección antes de reabrir el cuadro. Al pasar un arnés a receta se copia cada gesto que fija el estado. Promovida (ver "Prevención").
- Recurrencia 4 (2026-11-04, grid-ui-dev, ronda 5e): un clic real en E1 con un cuadro no modal abierto cayó sobre el cuadro (centrado, 620 px de ancho). Con cuadros no modales, el arnés elige celdas fuera del rectángulo del cuadro (medido con `getBoundingClientRect()`).

## L-055 · Heredar un formato es heredar el código completo, decimales incluidos
- Fecha: 2026-11-02 · Agente: qa-tester · Recurrencias: 1 (relacionada con L-010)
- Qué pasó: `=SUMA` sobre montos `$#.##0` muestra `$49.690,5`, pero el .xlsx exportado lleva `"$"#,##0` y Excel lo muestra `$49.691`: la pantalla y el archivo no coinciden.
- Causa raíz: la herencia copió el tipo de formato (moneda) sin sus decimales.
- Regla: al heredar o asignar un formato, se hereda el código completo; para comprobarlo, comparar lo que muestra la celda con el `z` que se exporta a .xlsx.
- Prevención: P2 en el backlog (grid-ui-dev); captura `r4_exp1.png`.

## L-056 · Las pruebas de arranque de Electron desde un shell de agente heredan el entorno del host
- Fecha: 2026-11-02 · Agente: release-packager · Recurrencias: 1
- Qué pasó: la primera prueba de arranque de `win-unpacked/Bassxcel.exe` falló ("bad option: --enable-logging") porque el shell heredaba `ELECTRON_RUN_AS_NODE=1` y el exe corría como Node. Además, leer el asar con `/` no encontró `web/vendor/xlsx.full.min.js`, y un script de verificación con `fetch` en Node 24 terminó con código 127 al llamar `process.exit()`.
- Causa raíz: supuestos del entorno de desarrollo (variables, separador de rutas, cierre de conexiones) que no valen en el shell del agente en Windows.
- Regla: antes de lanzar Electron se quita `ELECTRON_RUN_AS_NODE`; el asar se lee con rutas armadas con `path.sep`; los scripts con `fetch` terminan con `process.exitCode`, no con `process.exit()`.
- Prevención: paso 4 de `.claude/agents/release-packager.md` actualizado.

## L-057 · Al mover algo a "Hecho" se cierra también el ítem original de la auditoría
- Fecha: 2026-11-04 · Agente: sesión principal · Recurrencias: 2
- Qué pasó: al responder "¿qué falta?", el backlog seguía listando "Ordenar mueve filas ocultas a mano" y "Imprimir incluye filas ocultas" como P1, y el checklist los tenía en `[ ]`, aunque la ronda 2d y qa ronda 4 ya los habían entregado y verificado.
- Causa raíz: los registros agregaban la entrega a "Hecho" y actualizaban el ítem del checklist con otro texto, pero no buscaban el ítem de la auditoría que describía la misma brecha con otras palabras.
- Regla: al registrar una entrega, buscar por la función tocada (`sortSel`, `printSheet`…) en el backlog y en el checklist, y cerrar o acotar cada ítem que la mencione; antes de informar lo pendiente, contrastar los ítems "confirmado por código" con el código actual.
- Prevención: revisión del 2026-11-04 (3 ítems corregidos); regla en `CLAUDE.md` (2026-11-04: buscar también en la especificación del bloque y en las prevenciones faltantes, y contrastar con el código y con `tests/`); líneas en grid-ui-dev, qa-tester, formula-engine-dev, excel-parity-auditor y learning-curator (2026-11-17). Ítems de la recurrencia 2 cerrados el 2026-11-17 en `backlog.md` y `parity-checklist.md`.
- Recurrencia 2 (2026-11-04, learning-curator, al consolidar el bloque P1): en "Próximo bloque" del backlog, el punto 4 (Formato condicional, entregado en las rondas 5d y 5e) no tenía estado y el punto 5 (Rangos con nombre, entregado en la UI ronda 2c y verificado con REA UI-34..UI-40 en la qa ronda 3) seguía como especificación pendiente. La prevención "Escenario de series con 3 decimales" (L-014) seguía abierta en el backlog, en la métrica y en tres ítems del checklist, aunque UI-40 paso 3 la cubre y pasó REA en la qa ronda 3. También seguían "conjuntos de íconos" (hechos en la 5e) y "ordenar con celdas combinadas" (resuelto en la 5a) en P2. Causa: cada ronda cerraba su ítem de "Hecho" y su sección del checklist, pero no la especificación del bloque ni las prevenciones creadas por otra ronda. Regla ampliada: la búsqueda incluye la especificación del bloque, las prevenciones faltantes, los P2 y los encabezados de sección del checklist ("(próximo bloque P1)").

## L-058 · Un arnés que falla una vez se repite guardando la salida, y la intermitencia se registra
- Fecha: 2026-11-04 · Agente: sesión principal y grid-ui-dev · Recurrencias: 4 (1 y 2: grid-ui-dev, "sin respuesta a Page.navigate" en `ui-names`, y sesión principal, `ui-sort` dio 70/6 en la primera corrida y 76/76 en las cinco siguientes; 3 y 4 al final de la entrada)
- Qué pasó: la primera corrida de `tests/ui-sort.harness.js` tras la entrega dio 6 fallas; como solo se miró `tail`, no quedó qué asertos fallaron, y no se pudo reproducir.
- Causa raíz: la salida completa no se guardó, y los arneses dependen del tiempo de arranque de Chrome con la máquina cargada.
- Regla: los arneses se corren con la salida redirigida a un archivo del scratchpad; ante una falla, se lee la salida antes de repetir. Si al repetir pasa, se registra como intermitente con los asertos que fallaron, nunca se ignora.
- Prevención: `tests/cdp.js` reintenta una vez un `Page.navigate` sin respuesta y lo escribe como `REINTENTO Page.navigate` (ronda 5c); `close()` espera a Chrome y borra el perfil (ronda 5d); `ui-sort` corrido seis veces seguidas 76/76 (qa ronda 5a). Promovida el 2026-11-04 a la regla de `CLAUDE.md` "Los arneses y `ui-mutate.js` se corren de a uno…" (junto con L-045 y L-061); líneas en grid-ui-dev y qa-tester (2026-11-17). Pendiente: P2 del backlog para investigar si el `beforeunload` de la app cuelga `Page.navigate` (grid-ui-dev).
- Seguimiento (2026-11-04, qa-tester): seis corridas seguidas 76/76. Causa probable, sin confirmar: la primera corrida coincidió con una edición de `web/app.js` del agente de desarrollo (el log de `ui-mutate.js` de esa hora avisa "web/app.js cambió durante la corrida"). Regla adicional: no correr arneses mientras un agente todavía edita `web/`.
- Recurrencia 3 (2026-11-04, grid-ui-dev): dos `ui-mutate.js` en paralelo (dos Chrome) dieron "sin respuesta a Page.navigate" y una mutación salió no detectada; corrida sola, se detectó. Una mutación "no detectada" se repite sola antes de contarla, y los arneses no se corren en paralelo. Promovida (ver "Prevención").
- Recurrencia 4 (2026-11-04, qa-tester): "sin respuesta a Page.navigate" en 2 de 9 corridas con un solo Chrome y sin ediciones de `web/`; Chrome registra `frameStartedNavigating` tras `about:blank` y `Storage.clearDataForOrigin`, y la navegación queda colgada 20 s. No es solo paralelismo: `tests/cdp.js` `open()` debe reintentar la navegación una vez y registrar la intermitencia (ronda 5c). Promovida (ver "Prevención").
- Hallazgo (2026-11-04, sesión principal): en la falla de `ui-round2b`, Chrome registró dos `Page.javascriptDialogOpening` de tipo `beforeunload` justo antes de que `Page.navigate` quedara sin respuesta; la causa puede ser el aviso de "salir sin guardar" de la app, no solo la carga de la máquina. Con el reintento de la ronda 5c, 3 de 4 arneses reintentaron y pasaron completos.

## L-059 · Las estructuras del modelo se comparan campo a campo, nunca con `JSON.stringify`
- Fecha: 2026-11-04 · Agente: grid-ui-dev · Recurrencias: 1
- Qué pasó: las combinaciones creadas desde `range()` guardan las claves en otro orden (`r1, r2, c1, c2`) que las creadas a mano, y una comparación por texto las declaraba distintas.
- Causa raíz: `JSON.stringify` depende del orden de inserción de las claves.
- Regla: rectángulos y demás estructuras se comparan por sus campos (`r1`, `c1`, `r2`, `c2`); en arneses también.
- Prevención: `mergesSortable` y el arnés `ui-sort` comparan por campos.

## L-060 · Los efectos de un comando se aplican después de confirmar que la operación se hizo
- Fecha: 2026-11-04 · Agente: grid-ui-dev (reportado por qa-tester en la ronda 5a) · Recurrencias: 2 (selección con `selectSorted` y memoria del cuadro "Ordenar")
- Qué pasó: con combinaciones de distinto tamaño, ordenar mostraba el mensaje de error pero igual ampliaba la selección, y la memoria del cuadro guardaba los niveles de un orden que no ocurrió.
- Causa raíz: los efectos secundarios (selección, memoria) se aplicaban antes de que `sortRange` validara y decidiera.
- Regla: un comando rechazado (validación, cancelar, Esc) no cambia nada; selección, memoria y mensajes de éxito se aplican solo si la operación devolvió que se hizo.
- Prevención: `ui-sort` (selección intacta tras Esc y tras los dos rechazos por combinaciones) y `ui-dedupe` (rechazos), con sus mutaciones.

## L-061 · Al retomar una sesión cortada, buscar procesos huérfanos antes de verificar
- Fecha: 2026-11-04 · Agente: sesión principal · Recurrencias: 1 (relacionada con L-058)
- Qué pasó: el usuario cerró Claude Code con grid-ui-dev en la ronda 5c. Al retomar, una corrida de `ui-mutate.js tests/ui-dv.harness.js` seguía viva con su Chrome en el puerto 9343; `ui-dv` no pudo arrancar ("el puerto CDP 9343 ya está en uso") y `ui-round2b` falló por dos Chrome a la vez.
- Causa raíz: cerrar la sesión no termina los procesos hijos de los agentes; el estado en disco parecía terminado, pero había trabajo corriendo.
- Regla: al retomar, antes de verificar, listar los `node.exe` cuya línea de comando contiene `Bassxcel` y los puertos de los arneses (`netstat -ano`); cerrar solo los procesos de prueba (perfil `bx-cdp-*`, copia `bx-mut-*`) con `taskkill /F /T`, y borrar la copia mutada que quede.
- Prevención: esta lección; P2 de limpieza de perfiles en `cdp.js`.
- Ampliación (2026-11-04, grid-ui-dev): `ui-mutate.js` con 30 mutaciones tarda ~60 minutos; dividir las corridas largas por índices para que un cierre de sesión no deje una corrida huérfana a medias.

## L-062 · Los fragmentos de JS de una receta se verifican con un script, y una receta no se marca ensayada antes de ensayarla
- Fecha: 2026-11-04 · Agente: grid-ui-dev · Recurrencias: 5, más una confirmación (5: UI-48 paso 6 y UI-49 paso 5 ensayadas con CDP fallaron en REA por una lectura con `await` sin pausa; 3: encabezado de UI-49 con 123/123 cuando el arnés da 124; 4: `ui-dv` con 115 aserciones en `tests/ui-scenarios.md` cuando son 117; 1 y 2: dos `\u00ed` que quedaron como "í" literal en fragmentos de JS; UI-47 marcada "ensayada con CDP" sin haberse ensayado)
- Qué pasó: al escribir los fragmentos de JS de UI-47, dos escapes Unicode quedaron como el carácter literal (se detectó comparando con un script que fueran solo ASCII e idénticos a los ensayables); y el encabezado de la receta decía "ensayada con CDP" y "30/30" antes de ensayarla y antes de que terminaran las mutaciones.
- Causa raíz: se escribió el estado esperado en vez del observado.
- Regla: los fragmentos de JS de las recetas se comprueban con un script (solo ASCII, idénticos a lo que se ensaya); el encabezado de una receta registra solo resultados ya obtenidos; amplía L-025 y L-030.
- Prevención: encabezado de UI-47 corregido por la sesión principal; ensayos con CDP de UI-47, UI-48 y UI-49 (`ui49-sim.js` en `tests/`, puente real, 3 corridas). Promovida el 2026-11-04 como ampliación de la regla de escenarios REA de `CLAUDE.md`: lo observado, puente `#qaEval` real, fragmentos solo ASCII comprobados con un script y conteos copiados de la última corrida. Líneas en grid-ui-dev y qa-tester, y en learning-curator para los conteos de la métrica (2026-11-17). `ui47-sim.js` y `ui48-sim.js` están en `tests/` desde el 2026-11-17 (sesión principal). Pendiente, a cargo de la sesión principal: la corrección 115 → 117 en `tests/ui-scenarios.md` (recurrencia 4).
- Confirmación (2026-11-04, grid-ui-dev, UI-48): ensayar la receta con CDP encontró un paso que escrito a mano habría pasado (un segundo Ctrl+Z sobre una regla que viene de un libro preparado no hace nada); se movió al sub-escenario donde la regla se crea. Los 8 fragmentos de JS se comprobaron con un script (solo ASCII, idénticos a los ensayados).
- Ampliación (2026-11-04, grid-ui-dev, UI-49): el primer ensayo evaluaba el puente con `Runtime.evaluate` en vez de `fill #qaEval` + Enter, así que faltaban los eventos que hacen escribir al observador; y `cdp.js` recorta la consola a 200 caracteres. El ensayo usa el puente real y una consola sin recorte, lee los puntos de control después de cada `wait_for_timeout`, los compara en dos corridas o más, y el observador distingue estados que se ven iguales (la vista previa y la regla creada pintan igual: se agregó `MENU`). Además, la sesión principal encontró el encabezado de UI-49 con 123/123 cuando el arnés da 124: un conteo escrito antes del último cambio del arnés; los números del encabezado se copian de la última corrida (recurrencia 3).
- Recurrencia 4 (2026-11-04, learning-curator, al consolidar el bloque P1): la línea de `tests/ui-dv.harness.js` en la sección de arneses de `tests/ui-scenarios.md` dice 115 aserciones, pero el arnés da 117. Lo confirman el encabezado de UI-47, el checklist y el "Hecho" de la ronda 5c. Mismo origen que la recurrencia 3: el conteo se escribió antes del último cambio del arnés y no se volvió a copiar. La regla de `CLAUDE.md` ya lo cubre ("los conteos … se copian de la última corrida"); la corrección del archivo la hace la sesión principal.
- Recurrencia (2026-11-17, qa-tester, REA de UI-48 y UI-49): dos recetas ensayadas con CDP fallaron en REA porque una lectura del puente con `await` (espera interna de 500 ms) corría en paralelo con el gesto siguiente: REA no espera la promesa, el ensayo con CDP sí. Toda lectura con `await` seguida de un gesto que cambia el estado lleva un `wait_for_timeout` mayor que su espera interna, y un punto de control solo prueba un estado intermedio si tiene una pausa delante (el observador escribe solo cuando el estado cambia). El ensayo con CDP no reemplaza a REA: "ensayada" no es "aprobada".

## L-063 · El valor esperado de una referencia desplazada se calcula con el desplazamiento, no se copia del texto
- Fecha: 2026-11-04 · Agente: formula-engine-dev · Recurrencias: 1 (relacionada con L-022/L-023: lo medible se mide)
- Qué pasó: una expectativa decía que `=B$1` desplazada una columna leía B1; lee C$1.
- Causa raíz: se escribió el valor esperado mirando el texto de la fórmula en vez de aplicar el desplazamiento (relativa en columna, absoluta en fila).
- Regla: en pruebas de referencias relativas, mixtas o absolutas, el esperado se obtiene aplicando el desplazamiento a cada componente (`$` fija solo su eje).
- Prevención: pruebas de `evalFormula` con `from` (relativas, absolutas, `$A1`, `A$1`, fuera de la hoja).

## L-064 · Los efectos en vivo de un cuadro se apagan con una marca de cerrado, no solo limpiando el estado
- Fecha: 2026-11-04 · Agente: grid-ui-dev · Recurrencias: 1 (relacionada con L-060: los efectos se aplican después de confirmar)
- Qué pasó: al cerrar con Esc el cuadro "Mayor que", la vista previa del formato condicional volvía a aparecer después de limpiarla.
- Causa raíz: al quitar del DOM un campo enfocado el navegador dispara `change`, y su manejador volvía a calcular la vista previa sobre el estado ya limpio. Con Cancelar no pasaba (el foco ya estaba en el botón), así que solo una de las dos salidas lo mostraba.
- Regla: todo cuadro con efectos en vivo (vista previa, resaltado, selección) marca que está cerrado antes de quitarse, y sus manejadores no hacen nada con la marca puesta; se prueban todas las salidas (Aceptar, Cancelar, Esc, ×, clic fuera).
- Prevención: arnés `ui-cf` (vista previa revertida con Cancelar y con Esc).

## L-065 · En Windows, Python en modo texto convierte LF en CRLF al reescribir un archivo
- Fecha: 2026-11-04 · Agente: grid-ui-dev · Recurrencias: 1 (relacionada con L-025 y con la regla de contar finales de línea con `bytes.count`)
- Qué pasó: un script leyó `web/app.js` y lo escribió con `open(p, 'w')`; las 5870 líneas pasaron a CRLF. `npm run check:integrity` lo detectó (13 textos de mutaciones con `\n` "faltaban") y se revirtió sobre bytes.
- Causa raíz: en Windows, el modo texto de Python traduce `\n` a `\r\n` al escribir; el script vino de un heredoc (L-025) sin `rb`/`wb`.
- Regla: los scripts que reescriben archivos del proyecto leen y escriben en binario (`rb`/`wb`, decodificando UTF-8) o con `newline=''`, preservan el final de línea original de cada archivo (`web/` y `tests/` en LF, `lessons.md` en CRLF) y, al terminar, cuentan CRLF y CR sueltos con `bytes.count`.
- Prevención: `check:integrity` (textos con `\n`); conteo de finales de línea de la sesión principal tras cada ronda (5e: `web/` y `tests/` todo LF).

---
## Métrica del ciclo
| Fecha | Lecciones | Reportadas por el usuario | Detectadas por agentes o pruebas | Promovidas a regla | Prevenciones faltantes |
|---|---|---|---|---|---|
| 2026-10-22 | 11 (sin duplicados) | 1 (L-001) | 10 (L-002..L-011) | 9 lecciones en 8 reglas (L-001, L-003, L-004, L-006..L-011) | 1 (AltGr, L-006) |
| 2026-10-22 (cierre) | 12 | 2 (L-001, L-012) | 10 (L-002..L-011) | 10 (+ L-012 como regla del usuario con hook) | 1 (AltGr, L-006) |
| 2026-11-02 (auditoría) | 14 (+ L-013, L-014; L-006 sube a 5) | 2 | 12 | 10 (L-013/L-014 candidatas cuando se repitan) | 3 (AltGr; escenario matriz filtro/paneles; prueba de ida y vuelta `toRaw`) |
| 2026-11-02 (motor ronda 1) | 17 (+ L-015..L-017; L-008 sube a 2) | 2 | 15 | 10 | 3 |
| 2026-11-02 (motor ronda 2) | 20 (+ L-018..L-020; L-008 sube a 3) | 2 | 18 | 10 (L-008 ya es regla) | 3 (− prueba `toRaw`, entregada; + coma decimal en funciones de un argumento) |
| 2026-11-02 (UI ronda 1) | 23 (+ L-021..L-023; L-004 sube a 2) | 2 | 21 | 10 | 3 |
| 2026-11-02 (motor ronda 3) | 26 (+ L-024..L-026; L-006 sube a 6) | 2 | 24 | 10 | 2 (− coma decimal: pruebas del modo estricto) |
| 2026-11-02 (motor ronda 4) | 29 (+ L-027..L-029; L-025/L-027 suman 3 recurrencias → promover) | 2 | 27 | 10 | 2 |
| 2026-11-02 (QA REA) | 31 (+ L-030, L-031; L-027 sube a 4) | 2 | 29 | 10 | 2 (− AltGr, cerrada con UI-20; + mover qa-serve.js; queda el escenario matriz filtro/paneles) |
| 2026-11-02 (motor ronda 5) | 32 (+ L-032; L-028 sube a 2) | 2 | 30 | 10 | 2 |
| 2026-11-02 (UI ronda 2a) | 34 (+ L-033, L-034; L-025/L-027 suben a 5, L-022 a 2) | 2 | 32 | 10 | 1 (− mover qa-serve.js) |
| 2026-11-02 (cierre, learning-curator) | 34 numeradas, **32 distintas** (L-024 → L-014, L-027 → L-025; L-006 sube a 8) | 3 (L-001, L-012, L-029) | 29 | **24** (+ L-013, L-014, L-018, L-019, L-022, L-023, L-025, L-026, L-028, L-029, L-030, L-031, L-033, L-034) | 6 (ver abajo) |
| 2026-11-02 (matrices dinámicas) | 39 numeradas, 37 distintas (+ L-035..L-039; L-025 sube a 6, L-028 a 3) | 3 | 34 | 10 | sin cambios |
| 2026-11-02 (QA ronda 2) | 42 numeradas, 40 distintas (+ L-040..L-042; L-013 sube a 2) | 3 | 37 | 10 | sin cambios |
| 2026-11-02 (UI ronda 2b) | 45 numeradas, 43 distintas (+ L-043..L-045; L-040 sube a 2, L-022 a 3) | 3 | 40 | 10 | 1 (arnés de L-022/L-034 cubierto en parte con tests/) |
| 2026-11-02 (fechas d/m/aa) | 45 numeradas, 43 distintas (L-016 y L-017 suben a 2) | 3 | 40 | 10 | sin cambios |
| 2026-11-02 (UI ronda 2c) | 48 numeradas, 46 distintas (+ L-046..L-048; L-021 sube a 2) | 3 | 43 | 10 | sin cambios |
| 2026-11-02 (qa ronda 3) | 51 numeradas, 49 distintas (+ L-049..L-051; L-033 sube a 2) | 3 | 46 | 10 | 1 (ui-mutate.js sobre una copia) |
| 2026-11-02 (decimal final) | 52 numeradas, 50 distintas (+ L-052; L-051 sube a 2) | 3 | 47 | 10 | 1 |
| 2026-11-02 (UI ronda 2d) | 54 numeradas, 52 distintas (+ L-053, L-054; L-051 sube a 3, L-025 a 8) | 3 | 49 | 10 | 0 (ui-mutate.js sobre una copia resuelta) |
| 2026-11-02 (qa ronda 4) | 55 numeradas, 53 distintas (+ L-055; L-054 sube a 2) | 3 | 50 | 10 | 0 |
| 2026-11-02 (versión 1.3.0) | 56 numeradas, 54 distintas (+ L-056; L-045 sube a 2) | 3 | 51 | 10 | 0 |
| 2026-11-04 (revisión del backlog) | 57 numeradas, 55 distintas (+ L-057) | 3 | 52 | 10 | 0 |
| 2026-11-04 (UI ronda 5a) | 59 numeradas, 57 distintas (+ L-058, L-059; L-047 sube a 2) | 3 | 54 | 10 | 1 (intermitencia de `ui-sort`, L-058) |
| 2026-11-04 (qa ronda 5a) | 59 numeradas, 57 distintas (L-047 y L-054 suben a 3: promover) | 3 | 54 | 10 | 0 (intermitencia de `ui-sort` sin repetirse en 6 corridas) |
| 2026-11-04 (UI ronda 5b) | 60 numeradas, 58 distintas (+ L-060; L-058 sube a 3) | 3 | 55 | 10 | 0 |
| 2026-11-04 (qa ronda 5b) | 60 numeradas, 58 distintas (L-058 sube a 4) | 3 | 55 | 10 | 1 (reintento de `Page.navigate` en `cdp.js`) |
| 2026-11-04 (retomar 5c) | 61 numeradas, 59 distintas (+ L-061; hallazgo en L-058) | 3 | 56 | 10 | 1 (limpieza de perfiles en `cdp.js`) |
| 2026-11-04 (UI ronda 5c) | 62 numeradas, 60 distintas (+ L-062; L-025 sube a 9) | 3 | 57 | 10 | 2 (limpieza de perfiles en `cdp.js`; ensayo de UI-47) |
| 2026-11-04 (cierre 5c) | 62 numeradas, 60 distintas (ampliación de L-028) | 3 | 57 | 10 | 1 (limpieza de perfiles en `cdp.js`; − ensayo de UI-47, hecho) |
| 2026-11-04 (motor `evalFormula`) | 63 numeradas, 61 distintas (+ L-063; ampliación de L-028) | 3 | 58 | 10 | 1 |
| 2026-11-04 (UI ronda 5d) | 64 numeradas, 62 distintas (+ L-064; ampliaciones de L-028 y L-030; confirmación de L-062) | 3 | 59 | 10 | 0 (limpieza de perfiles en `cdp.js`, hecha) |
| 2026-11-04 (UI ronda 5e) | 65 numeradas, 63 distintas (+ L-065; L-025 +3, L-054 +1; ampliaciones de L-028 y L-062) | 3 | 60 | 10 | 0 |
| 2026-11-04 (consolidación del bloque P1) | 65 numeradas, 63 distintas (recuento real: L-025 = 12, L-028 = 8, L-047 = 3, L-054 = 4, L-058 = 4; contadores de cada entrada pendientes de actualizar) | 3 | 60 | **38** (las filas desde "matrices dinámicas" decían 10; eran 24. + L-021, L-040, L-045, L-047, L-049, L-051, L-054, L-057, L-058, L-060, L-061, L-062, L-064, L-065 en CLAUDE.md: 5 reglas nuevas y 3 ampliadas) | 6 (las filas desde la UI ronda 2b omitían las del 2026-11-02: siguen abiertas la matriz del checklist y el escenario del filtro (L-013), la fecha < 61 en UI-25 (L-017), `h5.js` (L-022/L-034) y DESREF `;;` (L-008); − series con 3 decimales, que cubre UI-40 paso 3; + `ui47-sim.js` y `ui48-sim.js` fuera de `tests/` (L-062)) |
| 2026-11-17 (fin de la consolidación) | 65 numeradas, 63 distintas (contadores actualizados en cada entrada: L-025 = 12, L-028 = 8, L-047 = 3, L-054 = 4, L-058 = 4; L-057 sube a 2 y L-062 a 4; L-014 sigue en 2) | 3 (L-001, L-012, L-029) | 60 | 38 (sin cambios: L-057 y L-062 ya estaban promovidas. L-002, L-016, L-017 y L-036, con 2 recurrencias, quedan como reglas de su agente. Reglas del 2026-11-04 llevadas a grid-ui-dev, qa-tester, formula-engine-dev, excel-parity-auditor y learning-curator) | 5 (matriz del checklist y escenario del filtro (L-013), fecha < 61 en UI-25 (L-017), `h5.js` (L-022/L-034) y DESREF `;;` (L-008). Se cerró `ui47-sim.js` y `ui48-sim.js` en `tests/` (L-062), según el registro de la sesión principal del 17/11. La de series (L-014) ya estaba descontada en la fila anterior y ahora también se cerró en el backlog y el checklist) |
| 2026-11-17 (QA REA del bloque P1) | 65 numeradas, 63 distintas (L-062 sube a 5) | 3 | 60 | 38 | 5 |

Correcciones del 2026-11-02 (learning-curator): la columna "Promovidas" cuenta lecciones, no reglas (la primera fila listaba 9 lecciones y decía 8); "Prevenciones faltantes" se recalculó con lo que cada ronda entregó (las filas decían 4, 4, 4, 3, 3, 2, pero sus propias notas daban 3, 2, 2, 2, 2, 1); L-029 pasa a "reportada por el usuario" porque la suposición la corrigió el usuario, no un agente. Las lecciones sin regla en `CLAUDE.md` (L-002, L-005, L-015, L-016, L-017, L-020, L-021, L-032) tienen prueba, escenario o una línea en su agente.

Prevenciones faltantes (lista del 2026-11-02, actualizada el 2026-11-17: quedan abiertas la 1, 2, 4, 5 y 6, cada una con su ítem en `backlog.md` → "P1 · Prevenciones faltantes"):
1. L-013: la matriz operaciones × estructuras no existe como sección del checklist (excel-parity-auditor).
2. L-013: no hay escenario del filtro que sigue a la tabla al insertar o eliminar filas o columnas, entregado en la ronda 2a (qa-tester).
3. ~~L-014: no hay escenario de series del controlador de relleno con 3 decimales~~. **Cerrada**: la cubre UI-40 paso 3 (`1,125`, `2,25` → `3,375`), que pasó en REA en la qa ronda 3 (2026-11-02). Cerrada en el backlog y el checklist el 2026-11-17 (L-057, recurrencia 2).
4. L-017: UI-25 no importa ninguna fecha anterior al 01/03/1900 (qa-tester).
5. L-022/L-034: el arnés de Chrome headless (`h5.js` y otros) no está en el repositorio; sus aserciones no se pueden volver a ejecutar (grid-ui-dev).
6. L-008: la semántica de DESREF con alto/ancho vacíos (`;;`) no tiene fuente; la prueba fija un supuesto (formula-engine-dev).
7. ~~L-062 (agregada el 2026-11-04): los ensayos `ui47-sim.js` y `ui48-sim.js` de UI-47 y UI-48 deben estar en `tests/`~~. **Cerrada** el 2026-11-17 por la sesión principal: movidos con sus `*-snippets.js` y repetidos desde `tests/` (ver `backlog.md`).

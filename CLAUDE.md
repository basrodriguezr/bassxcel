# Bassxcel: instrucciones del proyecto

Hoja de cálculo personal y original (sin código de Microsoft). La meta es **paridad de comportamiento con Excel** en el uso diario, con la documentación pública de Excel como referencia. Nunca se decompilan binarios de Office.

## Estructura
- `web/engine.js`: motor de fórmulas (tokenizador, parser, evaluador, funciones, reescritura de referencias)
- `web/app.js`: interfaz (grilla virtualizada, edición, selección, portapapeles, archivos)
- `web/styles.css`, `web/index.html`, `web/sw.js` (PWA sin conexión), `web/manifest.webmanifest`
- `desktop/`: Electron (main.js, preload.js) · `build/`: íconos · `dist/`: instalador generado
- `tests/engine.test.js`: pruebas del motor (`npm test`) · `tests/ui-scenarios.md`: recetas de pruebas en navegador con REA

## Equipo de agentes (`.claude/agents/`)
| Agente | Rol |
|---|---|
| `excel-parity-auditor` | Detecta brechas de comportamiento frente a Excel **antes** de que el usuario las encuentre. Mantiene el checklist y el backlog. |
| `formula-engine-dev` | Implementa y corrige funciones y semántica del motor, siempre con pruebas. |
| `grid-ui-dev` | Implementa interacción y UI (edición, selección, teclado, formato, archivos). |
| `qa-tester` | Verifica con `npm test` y escenarios reales en navegador vía REA; reporta fallas con evidencia. |
| `release-packager` | Genera el instalador de Windows y la versión web, y los valida. |
| `learning-curator` | Cierra el ciclo de aprendizaje: consolida lecciones, las convierte en reglas y pruebas. |

Flujo típico: auditor → (engine-dev | ui-dev) → qa-tester → learning-curator → release-packager.

## Ciclo de autoaprendizaje (obligatorio para todos los agentes)
Base de conocimiento en `.claude/learning/`:
- `lessons.md`: lecciones aprendidas (errores, causas, reglas). **Leer antes de trabajar.**
- `parity-checklist.md`: comportamientos de Excel con estado `[x]` hecho, `[~]` parcial o `[ ]` pendiente.
- `backlog.md`: trabajo pendiente priorizado (P0 crítico, P1 importante, P2 menor).

Pasos del ciclo en cada tarea:
1. **Recordar**: leer `lessons.md` y las secciones relevantes del checklist antes de tocar código.
2. **Anticipar**: al implementar una función de Excel, cubrir su comportamiento completo (teclado, ratón, casos límite, deshacer, varias hojas), no solo el camino feliz. Usar el checklist como lista de verificación.
3. **Verificar**: `npm test` y, si cambió la UI, un escenario REA de `tests/ui-scenarios.md`.
4. **Reflexionar**: si algo falló, faltó o lo reportó el usuario, agregar una lección a `lessons.md` con el formato definido ahí, una prueba de regresión si aplica, y actualizar el checklist y el backlog.
5. **Consolidar**: cuando una lección se repite 2 o más veces, `learning-curator` la promueve a regla en este archivo (sección "Reglas aprendidas").

## Regla del usuario (obligatoria)
**Cada vez que se termina algo, se actualiza el aprendizaje antes de responder**: `lessons.md` (si hubo fallas o hallazgos), `parity-checklist.md`, `backlog.md` (Hecho/Pendiente), escenarios o pruebas, y la memoria del proyecto. La respuesta dice qué se actualizó. Lo verifica el Stop hook `.claude/hooks/check-learning.js`: si el código es más nuevo que `.claude/learning/`, no deja terminar. *(origen: L-012, pedido del usuario)*

## Reglas aprendidas
- Toda función de Excel se implementa con su interacción completa (ratón + teclado + feedback visual), no solo su lógica. *(origen: L-001)*
- Al entregar una función que agrega estado a la hoja (rango, filas ocultas, filtro, capa visual) se recorre la matriz **operaciones × estructuras**: ordenar, Supr, rellenar, Ctrl+Enter, copiar/pegar, insertar/eliminar, deshacer, imprimir, .bassx, .xlsx y desplazamiento con paneles. Ese estado vive en el modelo (no se recalcula al dibujar), se desplaza con un único `shiftRanges` y cada cambio llama a `eng.recalc()`. *(origen: L-013, L-033; impacto alto: P0 2, P0 3 y seis P1)*
- Un comando rechazado, cancelado o cerrado no deja efectos: la selección, la memoria del cuadro y los mensajes de éxito se aplican solo si la operación devolvió que se hizo, y un cuadro con efectos en vivo (vista previa, resaltado) marca que está cerrado antes de quitarse, para que sus manejadores no hagan nada. Se prueban todas las salidas: Aceptar, Cancelar, Esc, × y clic fuera. *(origen: L-060, L-064)*
- Toda vía que crea contenido (editor, pegar, CSV, .xlsx, relleno, Ctrl+Enter, Reemplazar) pasa por la misma función de entrada (`entryCell`). Una validación o un comportamiento nuevo al confirmar se prueba también con lo que Excel acepta y en todas esas vías, y se repite la regresión de entrada, porque puede cambiar expectativas ya aprobadas. *(origen: L-040, L-051)*
- Ninguna tarea de UI se da por terminada sin un escenario REA que la ejercite, y una receta no vale hasta haberla ejecutado una vez en REA. Los escenarios ingresan datos como una persona (Tab/Enter), usan selectores únicos, escriben vía `#gridWrap` → `#cellEditor`, siguen el formato real de acciones de REA y usan el puente `tests/qa-serve.js` solo para lo que REA no hace. Los gestos compuestos (doble clic, clic derecho) se prueban con entrada real (`click_count: 2`, `button: "right"`), nunca con eventos despachados. Una receta registra solo lo observado: su ensayo con CDP sigue el camino de REA (puente `#qaEval` real, consola sin recorte) y se guarda en `tests/`, sus fragmentos de JS se comprueban con un script (solo ASCII, idénticos a los ensayados), y los conteos, los textos esperados y la marca "ensayada" se copian de la última corrida. *(origen: L-001, L-003, L-011, L-030, L-031, L-062)*
- Arneses y recetas no heredan estado del paso anterior: cada gesto fija antes la selección, el desplazamiento y el foco (clic en la celda antes de un clic derecho; con un cuadro no modal, celdas fuera de su rectángulo medido), y al pasar un arnés a receta se copian también esos gestos. Después de confirmar se verifica dónde quedó la celda activa. El foco se lee con un registro de `focusin` (un `fill` o un `press` con localizador lo mueven) y las teclas van a `:focus`; tras cerrar un cuadro anidado se acepta con clic. En la app, al cerrar un `<dialog>` el navegador devuelve el foco y no se fuerza, salvo que Excel lo haga. *(origen: L-021, L-047, L-054)*
- Los arneses y `ui-mutate.js` se corren de a uno, sin agentes editando `web/` y con la salida completa redirigida a un archivo del scratchpad. Ante una falla se lee esa salida antes de repetir; si al repetir pasa, se registra como intermitente con los asertos que fallaron (también un `REINTENTO Page.navigate`). Chrome y Electron se cierran con `taskkill /F /T` y se comprueba que el puerto CDP quedó libre; al retomar una sesión cortada, primero se cierran los procesos de prueba huérfanos (`bx-cdp-*`, `bx-mut-*`). *(origen: L-045, L-058, L-061)*
- Geometría y medidas: en la app, las posiciones salen de `colX` y `rowY`/`rowH` (grilla virtualizada, alto variable), nunca del DOM. En pruebas y arneses, lo medible se mide y no se supone: el layout y las conversiones de librerías, con Chrome headless o leyendo el código del vendor; las alineaciones, con `getBoundingClientRect()` del td; tras cambios estructurales, las celdas se buscan por contenido; los finales de línea se cuentan con Python (`bytes.count`), no con grep. *(origen: L-004, L-022, L-023, L-034)*
- La referencia es **Excel en español (Chile)**: `;` separa argumentos, `,` es decimal, `.` es separador de miles, fechas dd/mm/aaaa, teclado español (AltGr), y errores, atajos Ctrl+letra y orden de texto (ñ) en español. Toda entrada, salida o atajo nuevo se prueba con esa configuración y sin depender del idioma del navegador (`Intl`/`toLocale*` reciben `'es-CL'` explícito). Toda conversión número ↔ texto pasa por `toRaw`/`literal`, nunca por `String(v)`. La sintaxis de fórmulas se normaliza en los bordes (importar .xlsx, abrir archivos); nunca se adivina al evaluar. *(origen: L-006, L-014, L-018, L-024, L-026; 8 recurrencias)*
- En argumentos, omitido (`=== undefined`), vacío escrito (`;;`, `null`) y referencia a celda vacía son casos distintos y se prueban los tres. El vacío escrito se decide función por función, con una fuente (`nums(args, blankZero)`), y las referencias en agregaciones siguen reglas de rango. *(origen: L-007, L-008, L-019; 3 recurrencias)*
- Todo cambio en REF_RE o en el tokenizador se prueba también con fórmulas a medio escribir (la UI las usa para resaltar). *(origen: L-009)*
- Antes de implementar un comportamiento visual, confirmar cómo varía según el formato o tipo de dato en Excel. *(origen: L-010)*
- Toda regla semántica nueva agrega su mutación (`tests/mutate.js` en el motor; `tests/ui-mutate.js` en la UI, siempre sobre una copia), y la corrida debe detectar el 100 % antes de entregar: una prueba que nunca falló no es evidencia. Los datos deben dar otro resultado con la versión mutada, y las lecturas de las aserciones no lanzan (una excepción corta el arnés y oculta las siguientes). Antes de contar una mutación como no detectada se leen sus fallas y se repite sola: si la detecta una aserción legítima, se amplía el patrón; si no falla nada, falta una prueba, sobra código u otro evento tapa la diferencia (p. ej. el `mouseleave` del ratón real), y se quita código solo después de descartar las otras dos. *(origen: L-028, L-049; 8 recurrencias)*
- El código o texto con `\`, regex, comillas invertidas o `$` se edita con Edit o Write, nunca con heredoc, `sed`, `echo`, `node -e` ni `python -c`. Si hace falta un script, también para un cambio de una línea, se escribe con Write en el scratchpad y se ejecuta desde allí. Todo reemplazo cuyo texto es un dato usa una función: `s.replace(a, () => b)` (`$'`, `$&` y `$1` seguido de un dígito son patrones). Un script que reescribe un archivo lee y escribe en binario (`rb`/`wb`) o con `newline=''` y conserva sus finales de línea (`lessons.md` en CRLF; `web/`, `tests/`, `backlog.md`, `parity-checklist.md` y `CLAUDE.md` en LF). Después: `npm test`, `npm run check:integrity` y contar CRLF con Python `bytes.count`. *(origen: L-025, L-027, L-065; 12 recurrencias, una dañó `lessons.md` y otra pasó `app.js` a CRLF)*
- Antes de construir compatibilidad hacia atrás o migraciones, confirmar con el usuario qué datos reales hay que proteger; si no los hay, se cambia el valor por omisión y lo viejo queda como opción explícita. *(origen: L-029, corrección del usuario)*
- Al registrar una entrega se buscan, por la función o el escenario tocados, todos los ítems del backlog y del checklist que la mencionen (también la especificación del bloque y las prevenciones faltantes) y se cierran o acotan; antes de informar lo pendiente se contrasta con el código y con `tests/`. *(origen: L-057)*

## Convenciones
- Interfaz y mensajes en español; las funciones aceptan nombres en español e inglés (`def('SUM SUMA', …)`, el primero es el canónico de .xlsx).
- Todo cambio de datos pasa por `applyChanges` (deshacer por celdas) o `snapshotOp` (estructural).
- Mantener el estilo existente: sin dependencias nuevas en `web/` (salvo `vendor/`), comentarios breves en español.

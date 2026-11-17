# Checklist de paridad con Excel

Estados: `[x]` hecho y verificado · `[~]` parcial · `[ ]` pendiente. Prioridad: **P0** uso diario · **P1** importante · **P2** menor.
Al marcar `[x]` se requiere una prueba (`tests/engine.test.js`) o un escenario REA que lo cubra.
Auditoría 2026-11-02 (excel-parity-auditor): ítems marcados *(aud. 11-02)* salen de leer el código; ver `backlog.md`.

## Entrada y edición de celdas
- [x] P0 Escribir sobre una celda reemplaza el contenido; F2 o doble clic editan
- [x] P0 Enter/Shift+Enter, Tab/Shift+Tab confirman y se mueven; Enter tras Tab vuelve a la columna inicial; Esc cancela *(UI-08)*
- [x] P0 Las flechas confirman en modo Introducir; F2 alterna Introducir/Modificar
- [x] P1 Alt+Enter: salto de línea dentro de la celda y en la barra de fórmulas; activa el ajuste en el mismo deshacer *(REA UI-17, 11-02)*
- [x] P1 Ctrl+Enter: escribir el mismo valor en toda la selección *(UI-06)*
- [x] P0 Supr borra el contenido; deshacer y rehacer
- [ ] P1 Autocompletar texto a partir de valores de la misma columna
- [ ] P2 Ctrl+; y Ctrl+Shift+: también funcionan **durante** la edición (insertan en el cursor) *(aud. 11-02)*

## Edición de fórmulas
- [x] P0 Clic o arrastre en celdas inserta la referencia o el rango *(UI-02/UI-05)*
- [x] P0 Referencias resaltadas con recuadros de color y texto coloreado *(UI-02/UI-05)*
- [x] P0 Modo señalar con flechas y Shift+flechas después de un operador *(UI-02/UI-05)*
- [x] P0 F4 alterna referencias absolutas *(UI-02/UI-05)*
- [x] P0 Autocompletar funciones (Tab acepta) y ayuda de sintaxis con el argumento actual *(UI-02/UI-05)*
- [~] P1 Clic en otra hoja durante la fórmula inserta `Hoja!A1` *(implementado, falta verificación REA)*
- [x] P1 Cierre automático de paréntesis al confirmar
- [ ] P2 Arrastrar un recuadro de color para mover la referencia
- [ ] P2 Ctrl+AvPág/RePág en modo señalar cambia de hoja para insertar `Hoja!A1` *(aud. 11-02)*

## Selección y navegación
- [x] P0 Clic, Shift+clic, arrastre, encabezados de fila/columna, seleccionar todo
- [x] P0 Ctrl+flechas saltan al borde de los datos; Ctrl+Shift+flechas extienden
- [ ] P2 Ctrl+flechas y AvPág/RePág saltan filas/columnas ocultas y avanzan una pantalla real (hoy 20 filas fijas) *(aud. 11-02, por confirmar con REA)*
- [x] P0 Ctrl+clic: selección múltiple no contigua (formato, bordes, borrar, barra de estado), también encabezados con Ctrl+clic y Ctrl+arrastrar *(REA UI-15 con el puente de QA, 11-02)*
- [x] P0 Clic derecho en un encabezado lo selecciona si no estaba en la selección y la conserva si ya estaba (Ocultar/Eliminar actúan sobre esa fila/columna) *(REA UI-15, 11-02)*
- [ ] P2 El clic derecho en un encabezado muestra el menú de encabezado de Excel (hoy muestra el de celda) *(qa 11-02)*
- [x] P1 Ctrl+Espacio / Shift+Espacio: columna / fila completa *(UI-12; celda activa conservada, REA UI-14, 11-02)*
- [x] P1 Ctrl+Fin / Ctrl+Shift+Fin: última celda usada *(UI-12)*
- [ ] P2 Ctrl+Fin cuenta celdas que solo tienen formato (rango usado de Excel) *(aud. 11-02)*
- [ ] P2 Ctrl+Inicio con paneles inmovilizados va a la primera celda no inmovilizada *(aud. 11-02)*
- [~] P1 Enter/Tab recorren la selección *(UI-12)* — falta: saltar celdas ocultas y el interior de combinaciones; recorrer las áreas de una selección múltiple
- [x] P1 Cuadro de nombres: ir a una referencia
- [~] P1 Desplazamiento automático al arrastrar fuera del borde visible *(implementado; Playwright no simula arrastre)*

## Portapapeles y relleno
- [x] P0 Copiar, cortar y pegar con ajuste de referencias relativas; pegar desde Excel (TSV)
- [~] P0 Pegado especial: solo valores, solo formatos, transponer *(UI-06: valores)* — la falla P0 (pegar valores convertía 1,234 en 1234) se corrigió en la ronda 2a con `toRaw` **REA UI-23 paso 2 (`3,234`) y UI-26 paso 2, 11-02**; solo formatos y transponer siguen sin escenario
- [x] P1 Ctrl+Alt+V abre "Pegado especial" (hoy un menú con Todo, Valores, Formatos y Transponer; el cuadro completo está en P2) *(ronda 2a, 11-02; falta REA UI-23)* **REA UI-23 (menú; el cuadro completo queda en P2), 11-02**
- [~] P2 Pegado especial completo: Fórmulas, Valores y formato de números, Ancho de columnas, Operación (Sumar/Restar/Multiplicar/Dividir), Saltar blancos, Pegar vínculo; Ctrl+Shift+V = pegar valores *(aud. 11-02)* *(Fórmulas hecho 11-02; menú deshabilitado sin nada copiado)*
- [ ] P2 Copiar/pegar conserva las combinaciones de celdas; "Pegar formato" también *(aud. 11-02)*
- [x] P0 Controlador de relleno con series numéricas; Ctrl+D / Ctrl+R
- [x] P0 Series numéricas con decimales: un paso con 3 decimales ya no produce valores ×1000 (`toRaw` en `seriesFor`, ronda 2a) **REA UI-40 paso 3 (`1,125`, `2,25` → `3,375`), qa ronda 3, 11-02** *(cerrado el 11-17, L-057)*
- [x] P0 Doble clic en el controlador de relleno *(UI-02/UI-05)*
- [x] P1 Series de fechas, días de la semana, meses y "Item 1" con el controlador *(UI-05)*
- [ ] P2 Copiar formato (brocha)

## Formato
- [x] P0 Texto largo se desborda sobre celdas vacías; números que no caben: General → menos decimales / notación científica, otros formatos → #### *(UI-06)*
- [x] P0 Negrita, cursiva, subrayado, colores, alineación horizontal
- [x] P0 Formatos General, Número, Entero, Moneda, Porcentaje, Fecha y Texto
- [x] P1 Horas (`14:30`, fecha + hora), formato Hora, Ctrl+Shift+: *(UI-13)*
- [ ] P2 Hora negativa muestra `####` (Excel, sistema 1900); horas > 24 con `[h]:mm`; entrada `8:30 p. m.` y `8:5` *(aud. 11-02)*
- [x] P0 Bordes de celda *(UI-06)*
- [x] P0 Botones para aumentar o disminuir decimales; separador de miles *(UI-06)*
- [x] P1 Fuente y tamaño (Ctrl+Mayús+> / Ctrl+<, por confirmar en la documentación); ajustar texto; alineación vertical *(REA UI-17/UI-18, 11-02; .xlsx no guarda estilos)*
- [x] P1 Combinar y centrar celdas (+ importar/exportar .xlsx) *(UI-11)*
- [ ] P1 Flechas, Tab y Enter tratan una combinación como una sola celda (hoy entran en las celdas cubiertas y se puede escribir en ellas) *(aud. 11-02, confirmado por código)*
- [ ] P2 Combinar: variantes "Combinar horizontalmente", "Combinar celdas", "Separar celdas"; editor y bordes ocupan toda la combinación; Shift+flechas amplía a la combinación entera *(aud. 11-02)*
- [ ] P2 Formatos personalizados (`0,00 "kg"`)

### Formato condicional (bloque P1: rondas 5d y 5e; REA UI-48 y UI-49 aprobadas el 17/11)
- [x] P1 Reglas para resaltar celdas: Mayor que, Menor que, Entre, Es igual a, Texto que contiene, Una fecha, Duplicar valores *(ronda 5d 11-04, arnés `ui-cf` 147/147, mutaciones 44/44, UI-48 ensayada con CDP)* **REA UI-48, 11-17**
- [x] P1 Reglas superiores e inferiores: 10 superiores/inferiores, 10 % superior/inferior, Por encima/debajo del promedio *(ronda 5d 11-04, arnés `ui-cf` 147/147, mutaciones 44/44, UI-48 ensayada con CDP)* **REA UI-48, 11-17**
- [x] P1 Escalas de color (2 y 3 colores) *(ronda 5e 11-04, arnés `ui-cf2` 124/124, mutaciones 48/48, UI-49 ensayada con CDP)* **REA UI-49, 11-17**
- [x] P1 Barras de datos (relleno degradado y sólido, valores negativos) *(ronda 5e 11-04, arnés `ui-cf2` 124/124, mutaciones 48/48, UI-49 ensayada con CDP)* **REA UI-49, 11-17**
- [x] P2 Conjuntos de íconos (flechas, semáforos, valoraciones) *(ronda 5e 11-04, arnés `ui-cf2` 124/124, mutaciones 48/48, UI-49 ensayada con CDP)* **REA UI-49, 11-17**
- [x] P1 Nueva regla con fórmula ("Utilice una fórmula que determine las celdas para aplicar formato") *(ronda 5d 11-04, arnés `ui-cf` 147/147, mutaciones 44/44, UI-48 ensayada con CDP)* **REA UI-48, 11-17**
- [x] P1 Borrar reglas (selección / toda la hoja) y Administrador de reglas de formato condicionales *(ronda 5d 11-04, arnés `ui-cf` 147/147, mutaciones 44/44, UI-48 ensayada con CDP)* **REA UI-48, 11-17**
- [x] P1 Las reglas siguen a sus celdas al insertar/eliminar filas, ordenar, copiar y pegar; deshacer *(ronda 5d 11-04, arnés `ui-cf` 147/147, mutaciones 44/44, UI-48 ensayada con CDP)* **REA UI-48, 11-17**
- [ ] P2 Conservar formato condicional al importar/exportar .xlsx *(hoy se conserva en .bassx y se avisa al exportar .xlsx: SheetJS CE no escribe `conditionalFormatting`)*

## Filas, columnas y hojas
- [x] P0 Insertar y eliminar filas o columnas con ajuste de fórmulas
- [ ] P1 Ctrl+- / Ctrl++ sin filas completas: cuadro "Eliminar celdas"/"Insertar celdas" con desplazar hacia arriba/izquierda/abajo/derecha (hoy solo filas o columnas completas) *(aud. 11-02)*
- [x] P0 Ancho de columna (arrastre y doble clic para autoajustar)
- [x] P0 Inmovilizar paneles (fila o columna de encabezado) *(UI-07)*
- [~] P1 Con paneles inmovilizados, las combinaciones y la selección siguen el desplazamiento; los botones ▾ del filtro, por confirmar con REA *(revisión 11-04)*
- [ ] P2 Inmovilizar paneles relativo a la vista (como Excel) y etiqueta "Movilizar paneles" cuando ya hay paneles *(aud. 11-02)*
- [x] P1 Ocultar y mostrar filas o columnas *(UI-12)*
- [x] P1 Alto de fila: arrastre del borde, doble clic para autoajustar (corregido con gesto real), "Alto de fila…", alto automático por ajuste o fuente, deshacer, .bassx, importar y exportar .xlsx *(11-02; falta REA UI-27)* **REA UI-16/UI-25/UI-27, 11-02**
- [ ] P2 Ctrl+9 / Ctrl+0 ocultan filas/columnas; Ctrl+Shift+9 / Ctrl+Shift+0 las muestran; indicador visual en encabezados; doble clic o arrastre en el borde muestra la columna oculta *(aud. 11-02)*
- [x] P1 Ordenar no mueve filas ocultas a mano (documentación de Excel) **REA UI-42 paso 4e, qa ronda 4, 11-02**
- [x] P1 Agregar, renombrar, duplicar y eliminar hojas
- [ ] P2 Reordenar pestañas arrastrando; color de pestaña

## Datos
- [x] P1 Ordenar por la columna activa; amplía a la región actual y detecta encabezados *(UI-05)*
- [x] P0 Filtros (autofiltro con casillas, búsqueda y orden; Ctrl+Shift+L) *(UI-09)*
- [x] P0 Con filtro, Supr, Eliminar filas, rellenar, Ctrl+Enter y formato afectan solo las filas visibles *(ronda 2a, 11-02; falta REA UI-24; semántica de copiar por confirmar)* **REA UI-24, 11-02**
- [~] P1 El filtro sigue a su tabla al insertar/eliminar filas o columnas *(ronda 2a, 11-02; falta escenario: ver backlog, prevenciones faltantes)*
- [ ] P2 Autofiltro: la lista solo muestra valores de filas visibles por los otros filtros; Esc cierra y Enter acepta; Alt+↓ abre la lista; "Borrar filtro de…"; Filtros de texto/número/fecha; no dibujar ▾ en columnas ocultas; conteo "X de Y" correcto con filas ocultas a mano *(aud. 11-02)*
- [x] P1 Buscar y reemplazar

### Ordenar por varios niveles (bloque P1: ronda 5a, REA UI-44 en qa ronda 5a)
- [x] P1 Cuadro "Ordenar" (Datos ▸ Ordenar): Agregar/Eliminar/Copiar nivel, subir/bajar, "Mis datos tienen encabezados" **REA UI-44 (8 sub-escenarios), qa ronda 5a, 11-04**
- [x] P1 Criterio según el tipo: A a Z / Z a A, De menor a mayor / De mayor a menor, De más antiguos a más recientes **REA UI-44 (8 sub-escenarios), qa ronda 5a, 11-04**
- [x] P1 Opciones: Distinguir mayúsculas de minúsculas; Ordenar de izquierda a derecha **REA UI-44 (8 sub-escenarios), qa ronda 5a, 11-04**
- [x] P1 "Advertencia antes de ordenar" (Ampliar la selección / Continuar con la selección actual) **REA UI-44 (8 sub-escenarios), qa ronda 5a, 11-04**
- [x] P1 Con combinaciones de distinto tamaño: mensaje de error y no ordena **REA UI-44 (8 sub-escenarios), qa ronda 5a, 11-04**
- [x] P1 Orden alfabético español (ñ después de n) sin depender del idioma del navegador **REA UI-05 en en-US, 11-02**
- [ ] P2 Ordenar según color de celda/fuente/ícono; Lista personalizada

### Quitar duplicados (bloque P1: ronda 5b, REA UI-45 y UI-46 en qa ronda 5b)
- [x] P1 Cuadro "Quitar duplicados" con columnas, Seleccionar todo / Anular selección y "Mis datos tienen encabezados" **REA UI-45 (7 sub-escenarios) y UI-46, qa ronda 5b, 11-04**
- [x] P1 Compara el valor mostrado, sin distinguir mayúsculas; conserva la primera aparición; mensaje "Se encontraron y quitaron N valores duplicados; quedan M valores únicos." **REA UI-45 (7 sub-escenarios) y UI-46, qa ronda 5b, 11-04**
- [x] P1 Solo modifica el rango (las celdas fuera de él no se mueven); un Ctrl+Z lo deshace **REA UI-45 (7 sub-escenarios) y UI-46, qa ronda 5b, 11-04**

### Validación de datos (bloque P1: ronda 5c; REA UI-47 aprobada el 17/11)
- [x] P1 Cuadro "Validación de datos": Configuración / Mensaje de entrada / Mensaje de error *(ronda 5c 11-04, arnés `ui-dv` 117/117, mutaciones 30/30, UI-47 ensayada con CDP)* **REA UI-47, 11-17**
- [x] P1 Lista desplegable (Origen `Sí;No` o rango, también de otra hoja); botón ▾ junto a la celda activa; Alt+↓ la abre *(ronda 5c 11-04, arnés `ui-dv` 117/117, mutaciones 30/30, UI-47 ensayada con CDP)* **REA UI-47, 11-17**
- [x] P1 Número entero, Decimal, Fecha, Hora, Longitud del texto, Personalizada (con es-CL: `1,5`, `dd/mm/aaaa`) *(ronda 5c 11-04, arnés `ui-dv` 117/117, mutaciones 30/30, UI-47 ensayada con CDP)* **REA UI-47, 11-17**
- [x] P1 Mensaje de error con estilos Detener / Advertencia / Información y mensaje por defecto de Excel *(ronda 5c 11-04, arnés `ui-dv` 117/117, mutaciones 30/30, UI-47 ensayada con CDP)* **REA UI-47, 11-17**
- [ ] P2 Rodear con un círculo datos no válidos; Pegado especial ▸ Validación; conservar en .xlsx *(ronda 5c: al exportar .xlsx se avisa que se pierde la validación; SheetJS CE no lee ni escribe `dataValidations`)*

## Archivo y datos del usuario (ronda 2b, 11-02; falta REA UI-28)
- [~] P1 Abrir (botón, Electron, PWA) y Nuevo preguntan si hay cambios sin guardar (`dirty`, `confirmDiscard`); falta el cuadro de tres botones Guardar / No guardar / Cancelar
- [~] P1 Cerrar o recargar con el autoguardado fallido pide confirmación (`beforeunload`; Electron con `will-prevent-unload`)
- [~] P1 Barra de estado sin filas filtradas, ocultas ni columnas ocultas; suma valores desbordados (que Excel excluya las ocultas a mano: por confirmar)
- [x] P1 Copiar con filtro activo copia solo las filas visibles **REA UI-28, qa ronda 3, 11-02**

## Fórmulas: motor
- [x] P2 El resultado de SUMA, PROMEDIO, MAX, MIN, MEDIANA, REDONDEAR, ABS, SUBTOTALES y AGREGAR hereda el formato de número de sus referencias (`$2.735`); CONTAR, SI y BUSCARV no *(ronda 2d 11-02; sin documentación de Microsoft, basado en lo observado; falta REA UI-43)* **REA UI-43 (P2 aparte: hereda sin respetar los decimales del formato), qa ronda 4, 11-02**
- [x] P2 Barra de estado con General de 11 caracteres (`2,666666667`) y el formato de la celda activa en Suma y Promedio *(ronda 2d 11-02; falta REA UI-43)* **REA UI-43, qa ronda 4, 11-02**
- [x] P2 Las capas (selección, celda activa, desborde, recuadros) no se dibujan sobre las filas o columnas inmovilizadas (`fzClip`) *(ronda 2d 11-02; falta REA UI-43)* **REA UI-43 paso 1, qa ronda 4, 11-02**
- [x] P1 Ordenar con filtro activo conserva qué filas están filtradas (las visibles se ordenan entre sí y las ocultas no se mueven, según "Ordenar datos en un rango o tabla"), y Ctrl+Z/Ctrl+Y lo restauran en un paso; también filas ocultas a mano *(ronda 2d 11-02, arnés grupo D; falta REA UI-42 paso 4; confirmar en Excel el orden de los ocultos al quitar el filtro)* **REA UI-42 paso 4 a–e (SUBTOTALES = 370 en 8 estados), qa ronda 4, 11-02**
- [x] P1 Al confirmar, una fórmula con argumentos de más o de menos se rechaza con el mensaje de Excel y la celda sigue en edición (`checkFormula`) *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-38 (P2: rechaza el decimal final `=1,`), qa ronda 3, 11-02**
- [x] P2 Eliminar una hoja deja `#¡REF!` permanente en las fórmulas que la usaban *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-37, qa ronda 3, 11-02**
- [x] P2 Series de fechas por meses (`15/01`, `15/02` → `15/03`) y de fechas d/m *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-40, qa ronda 3, 11-02**
- [x] P0 Aritmética, comparación, concatenación, %, precedencia de Excel (-2^2 = 4)
- [x] P0 SUMA, PROMEDIO, MIN, MAX, CONTAR, CONTARA, SI, SI.ERROR, Y, O, NO, REDONDEAR, BUSCARV, COINCIDIR, INDICE, SUMAR.SI, CONTAR.SI, texto y fechas
- [x] P0 SUMAR.SI.CONJUNTO, CONTAR.SI.CONJUNTO, PROMEDIO.SI.CONJUNTO, SI.CONJUNTO, BUSCARX, TEXTO, UNIRCADENAS y ~30 más (147 funciones en total al 11-02) *(112 pruebas, 61 mutaciones con `npm run mutate`)*
- [x] P1 Referencias a columnas o filas completas (`A:A`, `1:1`) *(pruebas)*
- [x] P1 INDIRECTO (A1 y F1C1, otra hoja, rangos, #REF!, recálculo) y DESREF (negativos, alto/ancho, #REF!, dentro de agregaciones) *(pruebas, 11-02)*
- [x] P1 Financieras: VA, VF, PAGO, NPER, TASA, VNA, TIR, PAGOINT, PAGOPRIN, VNA.NO.PER, TIR.NO.PER *(pruebas con ejemplos de la documentación, 11-02)*
- [x] P1 Estadísticas: MODA, PERCENTIL, CUARTIL (.INC/.EXC), COEF.DE.CORREL, PEARSON, COEFICIENTE.R2, PENDIENTE, INTERSECCION.EJE, PRONOSTICO, JERARQUIA.MEDIA, MEDIA.ACOTADA, PROMEDIOA, MAXA, MINA *(pruebas, 11-02)*
- [x] P1 Serial de fechas igual a Excel antes del 01/03/1900 (FECHA(1900;1;1) = 1; DIASEM por serial módulo 7) *(prueba, 11-02; importador .xlsx corregido en la ronda 2a; falta una fecha < 61 en UI-25)*
- [x] P1 Errores en español (`#¿NOMBRE?`, `#¡REF!`…) en pantalla, en es-CL y en-US *(REA UI-19, 11-02)*
- [x] P2 Escribir `#N/D` en una celda produce el error, no texto (`=ESNOD(A1)` → VERDADERO; `CONTAR.SI(r;"#N/D")` cuenta errores) *(motor y prueba 11-02; importar y pegar valores conectados en la UI; falta REA UI-26)* **REA UI-26, 11-02**
- [x] P2 Exportar .xlsx: los errores se guardan como error (`t: 'e'`) *(corregido 11-02; falta REA UI-26)* **REA UI-26, 11-02**
- [x] P0 SUBTOTALES 1–11 ignora filas filtradas; 101–111 ignora además las ocultas a mano *(motor + UI con `filter.hidden`, 11-02; falta REA UI-24)* **REA UI-24 (9 y 109 = 300), 11-02**
- [x] P1 AGREGAR, funciones 1–19, opciones 0–7 *(prueba con el ejemplo de la documentación)*
- [x] P1 Vacío escrito = 0 en PROMEDIO, MIN, MAX, PROMEDIOA, MAXA, MINA; PRODUCTO y SUMA lo ignoran *(prueba, L-008)*
- [x] P0 Coma decimal en funciones de un argumento sin `;` (`=RAIZ(2,25)` = 1,5) *(L-018; motor con pruebas; activado en la UI en la ronda 2a; falta REA UI-21)* **REA UI-21, 11-02**
- [x] P1 Comparación numérica con 15 cifras en `=`, `<>`, `<`, `>` y criterios; BUSCARV/COINCIDIR/ordenar exactos *(prueba, 11-02)*
- [x] P1 Exportar .xlsx: VERDADERO/FALSO como TRUE/FALSE; CONCAT y CONCATENAR distintas *(prueba, 11-02)*
- [~] P1 Funciones de hora: HORA, MINUTO, SEGUNDO, NSHORA, HORANUMERO *(motor y pruebas, 11-02; formato Hora automático de NSHORA en la UI desde la ronda 2a; falta REA UI-26)*
- [x] P1 Matrices dinámicas: SECUENCIA, UNICOS, FILTRAR, ORDENAR, ORDENARPOR, MATRIZALEAT, MODA.VARIOS, APILARV/H, TOMAR, EXCLUIR, ELEGIRCOLS/FILAS, TRANSPONER *(motor + UI 11-02; falta REA UI-29..UI-33)* **REA UI-29..UI-32, qa ronda 3, 11-02**
- [x] P1 Desborde, `#¡DESBORDAMIENTO!` (contenido, cruce, combinadas, borde), celdas fantasma pintadas, borde azul, indicador con "Seleccionar celdas que obstruyen", `A1#`, `@`, edición y Supr en fantasmas *(motor + UI 11-02; falta REA)* **REA UI-29/UI-30/UI-41 (P2: borde sobre la fila inmovilizada), qa ronda 3, 11-02**
- [x] P1 Constantes matriciales `{…}` y difusión fila × columna con `#N/D` *(prueba 11-02)*
- [x] P2 FILA/COLUMNA de un rango devuelven matriz *(prueba 11-02)*
- [x] P1 .xlsx de matrices dinámicas: exportar ancla con `F`/`D`, importar con `xlfn: true` (conserva `A1#` y `@`) *(11-02; medido con SheetJS; falta REA; `#SPILL!`/`#CALC!` se exportan como texto en caché)* **REA UI-33, qa ronda 3, 11-02**
- [x] P0 Referencias circulares detectadas (#CIRC!)

### Rangos con nombre (bloque P1: motor ronda 4, UI ronda 2c, REA UI-34..UI-40 en qa ronda 3)
- [x] P1 Cuadro de nombres: escribir un nombre + Enter define el nombre de la selección; ▾ lista los nombres; muestra el nombre si la selección coincide *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-34, qa ronda 3, 11-02**
- [x] P1 Administrador de nombres (Ctrl+F3): Nuevo, Editar, Eliminar; Nombre, Valor, Se refiere a, Ámbito, Comentario *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-35, qa ronda 3, 11-02**
- [x] P1 Nombres en fórmulas (`=SUMA(Ventas)`, INDIRECTO("Ventas"), ámbito de hoja antes que de libro), autocompletado, recuadro de color; nombre inexistente → `#¿NOMBRE?` *(motor y pruebas 11-02; faltan autocompletado y recuadro en la UI)* *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-36, qa ronda 3, 11-02**
- [x] P1 Reglas de nombres de Excel (sin espacios, no parecido a una referencia, único por ámbito, sin distinguir mayúsculas) *(motor: `nameError`, 11-02; falta la UI)* *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-34, qa ronda 3, 11-02**
- [x] P1 Ajuste al insertar/eliminar filas o columnas, renombrar o eliminar hojas; deshacer *(motor: `namesStructural`, `namesRenameSheet`, `namesDeleteSheet`, 11-02; faltan la conexión en la UI y el deshacer)* *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-37, qa ronda 3, 11-02**
- [x] P2 Crear desde la selección (Ctrl+Shift+F3), Pegar nombre (F3), nombres de constante (`=0,19`), ámbito de hoja *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-37, qa ronda 3, 11-02**
- [x] P1 Importar/exportar nombres definidos en .xlsx *(UI ronda 2c 11-02, arnés `tests/ui-names.harness.js` 85/85)* **REA UI-39, qa ronda 3, 11-02**

## Archivos
- [x] P0 Guardar y abrir .bassx; autoguardado; importar .xlsx/.xls/.ods/.csv; exportar .xlsx/.csv
- [x] P0 Importar .xlsx no altera números: `1.234` (1,234) no se convierte en 1234 *(corregido en la ronda 2a; falta REA UI-25)* **REA UI-25, 11-02**
- [~] P1 .xlsx conserva filas/columnas ocultas, autofiltro y paneles inmovilizados (importar y exportar) *(ocultas y altos desde la ronda 2a, UI-25; faltan autofiltro y paneles)*
- [ ] P1 Conservar formato (negrita, colores, bordes) al importar y exportar .xlsx
- [~] P1 Imprimir / exportar a PDF (Ctrl+P) *(implementado; el diálogo de impresión no se puede verificar en modo headless)*
- [~] P1 Imprimir omite filas/columnas ocultas y filtradas (hecho en `printSheet`) y respeta las combinaciones (pendiente) *(revisión 11-04)*

## Otros
- [ ] P1 Gráficos (columnas, líneas, circular)
- [ ] P1 Zoom
- [ ] P2 Comentarios / notas
- [ ] P2 Tablas dinámicas
- [ ] P2 Deshacer una operación estructural no revierte cambios no deshacibles posteriores (inmovilizar, filtro, ancho); memoria de instantáneas acotada *(aud. 11-02)*

## Regional (es-CL) — ver L-006
- [x] P2 Decimal final en fórmulas (`=1,`, `=A1*1,`, `1,E3`, `1,%`); se quita al exportar a .xlsx *(motor y prueba 11-02; `1,E3` sin fuente; UI-21 paso 4 revertido; falta REA)* **REA UI-21 paso 4, qa ronda 4, 11-02**
- [x] P2 Migración de fórmulas viejas con nombres de funciones, VERDADERO/FALSO y errores en español *(prueba 11-02)*
- [ ] P2 Negativo contable `(1.500)` escrito en una celda = −1500 (sin fuente oficial de Microsoft; solo blogs) · auditor
- [~] P2 Formato Científica automático al escribir `1e3` (`1,00E+03`), opción "Científica", ida y vuelta .xlsx `0.00E+00` *(ronda 2d 11-02; falta REA UI-43)*
- [ ] P2 `1,` escrito en una celda (no en fórmula) como número (sin fuente) · formula-engine-dev
- [x] P1 Fechas escritas es-CL: d/m/aa y d-m-aa (corte 2029), d/m con el año actual, mes/año como respaldo (`12/99`), meses en español (`1-ene-26`, `ene-26`), aaaa-mm-dd, inválidas como texto, 29/02/1900 = 60 *(pruebas y 14 mutaciones, 11-02)*
- [x] P1 FECHANUMERO (DATEVALUE) y FECHA en febrero de 1900 (FECHA(1900;2;29) = 60) *(pruebas 11-02)*
- [ ] P2 Formato automático según cómo se escribió la fecha (d-mmm para `1-ene`, mmm-aa para `ene-26`), por confirmar en Excel es-CL · auditor + grid-ui-dev
- [ ] P2 Mostrar el serial 60 como 29/02/1900 en la celda y en TEXTO; TEXTO "dddd" antes del serial 61 · formula-engine-dev
- [ ] P2 Fracciones escritas (`0 1/2`) · formula-engine-dev
- [x] P1 Pegar texto desde otra aplicación, abrir CSV, Ctrl+Enter y Reemplazar reconocen moneda, porcentaje, miles y fechas es-CL igual que escribir (una sola lógica `entryCell`/`autoEntryFmt`) *(ronda 2b 11-02; falta REA UI-28)* **REA UI-28 (Reemplazar no ejercitado), qa ronda 3, 11-02**
- [x] P0 Fórmulas en es-CL estricto en la UI: importar .xlsx con `fromExcelFormula`, archivos viejos migrados, ayuda de argumentos con `;` *(11-02; falta REA UI-21/UI-25)* **REA UI-21/UI-25, 11-02**
- [x] P0 Acciones sobre un rango filtrado (Supr, Eliminar filas, rellenar, Ctrl+Enter, formato) solo en filas visibles *(11-02; falta REA UI-24)* **REA UI-24, 11-02**
- [x] P0 Números con decimales no se multiplican por 1000 al importar, pegar valores o rellenar series (`toRaw`) *(11-02)* **REA UI-25 (importar), UI-23 paso 2 y UI-26 (pegar valores) y UI-40 paso 3 (series), 11-02** *(cerrado el 11-17, L-057)*
- [x] P2 Ajuste "cerca de cero" en la suma/resta final sin paréntesis (`=1,333+1,225-1,333-1,225` = 0) *(prueba 11-02; umbral aproximado)*
- [x] P2 Número → texto con 15 cifras y notación científica solo fuera de [1E-4; 1E+15) *(prueba 11-02; umbrales aproximados)*
- [x] P1 Número → texto con coma decimal (`="x"&1,5` → `x1,5`) *(prueba, 11-02, L-024)*
- [~] P1 Orden de texto con ñ fijo, sin depender del idioma del navegador (ordenar y lista del filtro usan `compareVals`) *(prueba en el motor, 11-02; falta UI-05 en en-US)*
- [x] P0 Coma decimal en fórmulas (`=A1*1,5`), `;` separador *(prueba)*
- [x] P0 Fechas dd-mm-aaaa independientes del idioma del navegador *(UI-05)*
- [x] P0 Formato automático al escribir `50%` y `$1.500`; las fórmulas heredan fecha/moneda/% *(UI-05)*
- [x] P0 AltGr (`@`, `\`, `[`, `{`, `€`) inicia la edición *(REA UI-20, 11-02)*
- [x] P0 Todo número que la app convierte a texto de entrada usa coma decimal (ida y vuelta `literal(toRaw(v)) === v`) — ver L-014 *(prueba "toRaw: número → texto es-CL…" y mutación; en la UI desde la ronda 2a)* **REA UI-23 paso 2, UI-25 y UI-40 paso 3 (series), 11-02** *(cerrado el 11-17, L-057)*
- [x] P1 Ctrl+Alt+letra (Ctrl+Alt+V Pegado especial, Ctrl+Alt+L volver a aplicar filtro) es un atajo, no AltGr *(corregido 11-02; falta REA UI-23)* **REA UI-23, 11-02**
- [x] P1 Atajos Ctrl+letra de Excel en español: Ctrl+N/K/S (y Ctrl+2/3/4), Ctrl+G guardar, Ctrl+A abrir, Ctrl+U nuevo, Ctrl+E seleccionar todo, Ctrl+B buscar, Ctrl+L reemplazar, Ctrl+I/F5 ir a, Ctrl+J/Ctrl+D rellenar, F12 guardar como *(implementado 11-02; falta REA UI-22)* **REA UI-22, 11-02**
- [~] P1 Códigos de error en español: `#¡DIV/0!`, `#¡VALOR!`, `#¡REF!`, `#¿NOMBRE?`, `#N/D`, `#¡NUM!` (en .xlsx se guardan en inglés) *(en la celda: REA UI-19; .xlsx con `t:'e'`: falta REA UI-26; lista del filtro y CSV por confirmar, backlog P2)*

## Atajos agregados (2026-10-22)
- [x] Ctrl+AvPág/RePág cambia de hoja · Ctrl+; fecha de hoy · Ctrl+-/Ctrl++ eliminar/insertar · Ctrl+H buscar/reemplazar · Ctrl+P imprimir · Ctrl+Shift+L filtro · Backspace edita la celda vacía · Enter/Tab recorren la selección *(UI-12; brechas en las secciones de arriba)*

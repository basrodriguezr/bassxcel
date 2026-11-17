# Bassxcel 1.3.0: notas de la versión

Fecha: 2 de noviembre de 2026 · Versión anterior: 1.2.1

Instalador para Windows: `Bassxcel-Setup-1.3.0.exe`. Si ya tienes la 1.2.1, instala encima: tus libros y el autoguardado se conservan. La versión web se actualiza sola la próxima vez que la abras con conexión.

## Lo nuevo

### Funciona como Excel en español (Chile)
- **Configuración regional es-CL estricta**: el punto y coma (`;`) separa los argumentos y la coma (`,`) es el decimal, al escribir, al mostrar, al pegar y al abrir archivos. Ejemplo: `=SI(B2>1,5;"Alto";"Bajo")`.
- Los libros creados con versiones anteriores se convierten solos al abrirlos y conservan sus resultados.
- **Fechas escritas como en Chile**: `5/11/26`, `5/11` (año actual), `11/26` (noviembre de 2026), `5-nov-26`, `5-noviembre-2026`, `2026-11-05`. Con año de dos dígitos, de 00 a 29 se lee como 2000–2029 y de 30 a 99 como 1930–1999. Una fecha imposible, como `31/02/26`, queda como texto.
- **Errores en español** en las celdas: `#¡VALOR!`, `#N/D`, `#¡DIV/0!`, `#¡REF!`, `#¿NOMBRE?`, etc. También puedes escribirlos.
- **Pegar desde otras aplicaciones con el formato es-CL**: `$1.500` se pega como moneda, `50%` como porcentaje, `1.234,5` como número con separador de miles y `01/01/2026` como fecha, igual que si los escribieras. Lo mismo vale al abrir un CSV.

### Atajos de teclado de Excel en español
- Ctrl+N negrita, Ctrl+K cursiva, Ctrl+S subrayado (también Ctrl+2/3/4), Ctrl+G guardar, F12 guardar como, Ctrl+A abrir, Ctrl+U libro nuevo, Ctrl+E seleccionar todo, Ctrl+B buscar, Ctrl+L reemplazar, Ctrl+I o F5 ir a, Ctrl+J rellenar hacia abajo, Ctrl+D hacia la derecha.
- Ctrl+Alt+V abre el Pegado especial (Todo, Fórmulas, Valores, Formatos, Transponer).
- Ctrl+Mayús+L activa o quita el filtro, y Ctrl+Alt+L lo vuelve a aplicar.
- Mayús+Espacio selecciona la fila y Ctrl+Espacio la columna, sin perder la celda activa. Ctrl+clic y Ctrl+arrastrar sobre los encabezados seleccionan varias filas o columnas.
- En el navegador, Ctrl+N está reservado: usa Ctrl+2. En la app de escritorio funcionan todos.

### Formato y apariencia
- **Alto de fila** ajustable arrastrando el borde o con doble clic para ajustarlo al contenido.
- **Ajustar texto**, y **Alt+Enter** para agregar un salto de línea mientras escribes.
- **Alineación vertical**: superior, medio e inferior.
- **Fuente y tamaño**: lista de fuentes y de tamaños, y botones para aumentar o disminuir el tamaño (Ctrl+Mayús+> y Ctrl+<).
- El formato **Científica** se aplica solo a los números muy grandes o muy pequeños, y una suma hereda el formato de moneda de las celdas que suma.

### Fórmulas
- **147 funciones**, entre ellas INDIRECTO, DESREF, BUSCARX, SUBTOTALES, AGREGAR, funciones financieras (TIR, VNA, TASA, NPER, TIR.NO.PER…) y estadísticas (PERCENTIL, CUARTIL, MODA, PRONOSTICO…), además de FECHANUMERO, HORANUMERO y NSHORA.
- **Matrices dinámicas**: una fórmula que devuelve varios valores, como `=SECUENCIA(3;2)`, `=FILTRAR(A2:B9;B2:B9>10)`, `=UNICOS(A2:A20)`, `=ORDENAR(A2:C9)` o `=A1:A5*2`, se desborda sobre las celdas vecinas (borde azul). `A1#` se refiere a todo el resultado. Si algo lo bloquea aparece `#¡DESBORDAMIENTO!` con un indicador para seleccionar las celdas que estorban (también con Alt+Mayús+F10).
- **Rangos con nombre**: selecciona un rango, escribe un nombre en el cuadro de nombres y presiona Enter. Después úsalo en las fórmulas: `=SUMA(Ventas)`. Incluye el Administrador de nombres (Ctrl+F3), Pegar nombre (F3) y Crear desde la selección (Ctrl+Mayús+F3). Los nombres se guardan en .bassx y en .xlsx.
- Ayuda al escribir: la descripción de los argumentos aparece al escribir las funciones más comunes, el autocompletado incluye los nombres definidos, y al confirmar una fórmula se avisa si sobran o faltan argumentos.

### Filtro
- **Autofiltro con SUBTOTALES**: `=SUBTOTALES(9;…)` suma solo las filas visibles.
- Con un filtro activo, **Supr, eliminar filas, rellenar, Ctrl+Enter, dar formato, copiar y ordenar actúan solo sobre las filas visibles**, como en Excel.
- El filtro sigue a su tabla al insertar o eliminar filas o columnas.
- La barra de estado (Suma, Promedio, Recuento) no cuenta las filas filtradas ni las ocultas.

### Archivos
- **.xlsx**: se importan y exportan los altos de fila, las filas y columnas ocultas, los errores, las matrices dinámicas, los rangos con nombre y las fechas antiguas (anteriores a marzo de 1900).
- Abrir y Libro nuevo preguntan antes de descartar cambios sin guardar. La app de escritorio también avisa al cerrar si no pudo autoguardar.

## Correcciones importantes
- **Los números con decimales ya no se multiplican por 1000.** En la 1.2.1, un valor como `1,125` podía convertirse en `1125` al abrir un .xlsx, al pegar valores o al arrastrar una serie con el controlador de relleno.
- **Las acciones ya no afectan las filas filtradas.** En la 1.2.1, borrar, eliminar filas, rellenar o dar formato con un filtro activo también modificaba las filas ocultas.
- **SUBTOTALES ya no incluye las filas filtradas.** Antes podía dar 380 donde correspondía 300.
- Ordenar una lista filtrada ordena solo las filas visibles, y ordenar ya no mueve las filas ocultas a mano.
- El clic derecho sobre el encabezado de una columna o fila la selecciona, como en Excel. Antes, "Eliminar columnas" desde ese menú podía borrar otra columna.
- Reemplazar ya no interpreta caracteres especiales como `$&` en el texto de reemplazo.
- La función FECHA calcula bien los días de enero y febrero de 1900.
- Eliminar una hoja deja `#¡REF!` en las fórmulas que la usaban, como Excel, en lugar de resultados incorrectos.
- Los cuadros de diálogo se cierran con Enter o Esc sin confirmar por error la celda de atrás.

## Limitaciones conocidas
- **El autofiltro y los paneles inmovilizados no se guardan en .xlsx.** Al abrir el archivo en Excel la tabla aparece sin filtro y sin paneles inmovilizados. Por la misma razón, el valor de SUBTOTALES guardado puede no coincidir con el que muestra Excel hasta que vuelvas a filtrar. En el formato propio .bassx sí se conservan.
- **Los estilos no se guardan en .xlsx**: la negrita, los colores, los bordes y las fuentes se pierden al exportar. Para conservarlos, guarda en .bassx.
- **El formato heredado no respeta los decimales.** Una `=SUMA` sobre celdas con formato `$#.##0` puede mostrar `$49.690,5`, mientras Excel muestra `$49.691`. El valor es correcto; solo cambia cómo se muestra.
- **`(1.500)` escrito entre paréntesis queda como texto**, no como el número negativo -1.500. Escribe `-1500`.
- Ordenar una tabla con celdas combinadas puede desordenarla. Separa las celdas antes de ordenar.
- Imprimir incluye las filas ocultas y filtradas, y no muestra las celdas combinadas como tales.
- Con paneles inmovilizados, los botones ▾ del filtro y los títulos combinados no siempre siguen a la fila inmovilizada al desplazarse.

# Bassxcel

Hoja de cálculo personal que funciona sin conexión. Disponible como app de escritorio (instalador de Windows) y como app web instalable (PWA).

## Escritorio (Windows)
- Instalador: `dist\Bassxcel-Setup-1.0.0.exe`. Crea accesos directos y asocia los archivos `.bassx`.
- Para regenerarlo después de hacer cambios: `crear-instalador.bat` (o `npm run dist`).
- Para probar sin instalar: `npm start`.
- El instalador no está firmado, así que Windows SmartScreen puede advertir: "Más información" → "Ejecutar de todas formas".

## Web
- Local: `iniciar-web.bat` abre http://localhost:8080 (con `node serve.js --lan` también se puede usar desde otros equipos de la red).
- Publicada: sube la carpeta `web/` a cualquier hosting estático con HTTPS (GitHub Pages, Netlify, Cloudflare Pages…).
- En Chrome o Edge, el ícono "Instalar" de la barra de direcciones la deja como app. Después de la primera carga funciona sin conexión.

## Características
- Fórmulas con nombres en español o inglés (`=SUMA(A1:A5)` o `=SUM(A1:A5)`), separador `;` o `,`
- Referencias entre hojas (`=Hoja2!A1`, `='Mis datos'!B3`) y absolutas con `$`
- Grilla virtualizada: solo dibuja lo visible y calcula las fórmulas cuando hacen falta, así que soporta cientos de miles de filas
- Copiar y pegar (también desde y hacia Excel), controlador de relleno con series, Ctrl+D y Ctrl+R
- Insertar y eliminar filas o columnas (las fórmulas se ajustan solas), ordenar, buscar y reemplazar, Autosuma
- Formato: negrita, cursiva, subrayado, colores, alineación, número, moneda, porcentaje y fecha
- Deshacer y rehacer, autoguardado
- Abre `.bassx`, `.xlsx`, `.xls`, `.ods` y `.csv`; exporta a `.xlsx` y `.csv`

## Estructura
- `web/`: la aplicación (`index.html`, `styles.css`, `app.js`, `engine.js` = motor de fórmulas, `sw.js` = modo sin conexión)
- `desktop/`: la carcasa Electron para Windows
- `build/`: íconos del instalador

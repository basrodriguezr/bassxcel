'use strict';
// Verificación de integridad para release-packager (L-049): falla si algún texto `from` de las mutaciones de
// tests/ui-mutate.js no está en web/app.js. Si falta uno, app.js quedó mutado (o la regla cambió y la mutación hay
// que actualizarla): no se genera la versión hasta revisarlo. Uso: npm run check:integrity
// (node tests/check-integrity.js <otro app.js> revisa otra copia; así se prueba la verificación sin tocar web/)
const fs = require('fs'), path = require('path');
const { MUTS } = require('./ui-mutate');
const app = fs.readFileSync(path.resolve(process.argv[2] || path.join(__dirname, '..', 'web', 'app.js')), 'utf8');
const missing = MUTS.filter(([, from]) => !app.includes(from));
for (const [name, from] of missing) console.log('FALTA  ' + name + '\n       ' + JSON.stringify(from).slice(0, 160));
console.log(missing.length ? `\n${missing.length} de ${MUTS.length} textos no están en web/app.js: revisar antes de generar la versión`
  : `web/app.js íntegro: los ${MUTS.length} textos de las mutaciones están presentes`);
process.exit(missing.length ? 1 : 0);

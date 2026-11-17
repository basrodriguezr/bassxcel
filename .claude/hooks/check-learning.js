#!/usr/bin/env node
'use strict';
// Stop hook: impide terminar si hay cambios de código posteriores a la última actualización
// del aprendizaje (.claude/learning/). Revisa la carpeta indicada y sus subcarpetas directas que
// tengan .claude/learning (así funciona abriendo Claude Code en REA o dentro de un proyecto).
// Uso: node check-learning.js <carpeta-raíz>
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', 'dist', '.claude', '.git', 'vendor', 'build', '__pycache__', '.venv', 'data']);
const SLACK_MS = 2000;   // tolerancia: cambios casi simultáneos no cuentan

function newest(dir, skip = SKIP) {
  let max = 0, file = null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { max, file }; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skip.has(e.name)) continue;
      const sub = newest(p, skip);
      if (sub.max > max) ({ max, file } = sub);
    } else {
      const m = fs.statSync(p).mtimeMs;
      if (m > max) { max = m; file = p; }
    }
  }
  return { max, file };
}

let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input || '{}'); } catch { /* sin datos */ }
  // Si ya se bloqueó una vez en este turno, no volver a bloquear (evita un ciclo infinito)
  if (payload.stop_hook_active) process.exit(0);

  const root = path.resolve(process.argv[2] || process.cwd());
  const candidates = [root];
  try { for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) candidates.push(path.join(root, e.name)); } catch { /* raíz ilegible */ }

  const pending = [];
  for (const proj of candidates) {
    const learning = path.join(proj, '.claude', 'learning');
    if (!fs.existsSync(learning)) continue;
    const code = newest(proj);
    const learned = newest(learning, new Set());
    if (code.max > learned.max + SLACK_MS) pending.push(`${path.basename(proj)} (último cambio: ${path.relative(proj, code.file)})`);
  }
  if (!pending.length) process.exit(0);

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `Regla del usuario: cada vez que terminas algo DEBES ACTUALIZAR EL APRENDIZAJE. Hay cambios sin registrar en: ${pending.join('; ')}. ` +
      'Antes de terminar actualiza .claude/learning/ (lessons.md si hubo fallas o hallazgos, parity-checklist.md, backlog.md: Hecho/Pendiente), ' +
      'tests/ui-scenarios.md o pruebas si aplica, y la memoria del proyecto. Luego indica en tu respuesta qué actualizaste.',
  }));
});

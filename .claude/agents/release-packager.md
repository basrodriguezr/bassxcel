---
name: release-packager
description: Genera y valida los entregables de Bassxcel, el instalador de Windows (electron-builder NSIS) y la versión web/PWA. Úsalo cuando haya cambios listos y verificados por qa-tester.
tools: Read, Grep, Glob, Edit, Bash
---

Eres responsable de los entregables de Bassxcel.

## Ciclo de autoaprendizaje
1. **Recordar**: lee `.claude/learning/lessons.md` (L-002: EPERM de electron-builder).
2. **Precondiciones**: `npm run check:integrity` (sin restos de mutaciones, L-049), `npm test` y `npm run mutate` pasan, `node --check` de `web/app.js`, `web/engine.js` y `desktop/*.js`, y el último reporte de `qa-tester` sin fallas P0 abiertas en el backlog.
3. **Versión**: sube la versión en `package.json` (semver: corrección = patch, función = minor) y la constante `CACHE` de `web/sw.js` (por ejemplo `bassxcel-v3`), para que la PWA reciba la actualización.
4. **Instalador**: borra solo `dist/win-unpacked` y los intermedios (nunca `rm -rf dist`: conserva los instaladores anteriores) y corre `npm run dist`, con hasta 3 reintentos si aparece EPERM (L-002). Confirma que existe `dist/Bassxcel-Setup-<versión>.exe` y reporta su tamaño. Prueba de arranque (L-056): quita `ELECTRON_RUN_AS_NODE` del entorno, lanza `dist/win-unpacked/Bassxcel.exe`, comprueba que sigue vivo unos segundos y ciérralo con `taskkill /F /T` hasta que queden 0 procesos. Compara el hash de `web/app.js` con el de dentro de `app.asar` (rutas con `path.sep`).
5. **Web**: confirma que todos los archivos de `FILES` en `web/sw.js` existen. La carpeta `web/` es el artefacto para hosting estático.
6. **Reflexionar**: cualquier falla de empaquetado nueva → lección en `lessons.md` con su solución.

## Entrega
Versión generada, ruta y tamaño del instalador, estado de la versión web y los problemas encontrados.

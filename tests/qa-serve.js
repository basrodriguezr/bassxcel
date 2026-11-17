'use strict';
// Servidor de QA: sirve web/ sin cambios e inyecta en index.html un "puente" de evaluación
// (REA capture_browser_scenario no tiene acción evaluate). Uso: fill #qaEval "<js>" + press Enter.
// El resultado sale por console.log('QA <json>') y queda en window.__qa.
// Arranque (desde la raíz del proyecto): `PORT=8767 node tests/qa-serve.js`. Solo escucha en 127.0.0.1.
// Raíz alternativa (copia mutada de web/, L-049): `--web=<carpeta>` o la variable BX_WEB; por omisión, web/.
const http = require('http'), fs = require('fs'), path = require('path');
const webArg = process.argv.find(a => a.startsWith('--web='));
const ROOT = path.resolve(webArg ? webArg.slice(6) : process.env.BX_WEB || path.join(__dirname, '..', 'web'));   // sin rutas fijas
if (!fs.existsSync(path.join(ROOT, 'index.html'))) { console.error('qa-serve: ' + ROOT + ' no tiene index.html'); process.exit(1); }
const PORT = +process.env.PORT || 8767;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const BRIDGE = `
<input id="qaEval" autocomplete="off" spellcheck="false" style="position:fixed;right:0;bottom:0;width:6px;height:6px;opacity:.02;z-index:2147483647;border:0;padding:0">
<script>
window.__qa = [];
// Ayudas de lectura (solo leen el DOM o despachan eventos, no tocan el estado interno de la app)
window.Q = {
  rc(a){ const m=/^([A-Z]+)(\\d+)$/.exec(a); let c=0; for(const ch of m[1]) c=c*26+ch.charCodeAt(0)-64; return {r:+m[2]-1,c:c-1}; },
  td(a){ const p=Q.rc(a); return document.querySelector("#grid tbody tr[data-r='"+p.r+"'] td:nth-of-type("+(p.c+1)+")"); },
  t(a){ const e=Q.td(a); return e ? e.textContent : '(no DOM)'; },
  ts(list){ const o={}; for(const a of list.split(' ')) o[a]=Q.t(a); return o; },
  nb(){ return document.getElementById('nameBox').value; },
  fb(){ return document.getElementById('formulaInput').value; },
  R(e){ if(!e) return null; const r=e.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}; },
  act(){ const s=getComputedStyle(document.getElementById('actBox')); return Q.R(document.getElementById('actBox')); },
  // la celda activa coincide con el td indicado (L-023: getBoundingClientRect del td)
  at(a){ const x=Q.R(document.getElementById('actBox')), y=Q.R(Q.td(a)); return {act:x, td:y, dTop: y&&x ? x.t-y.t : null, dLeft: y&&x ? x.l-y.l : null}; },
  extra(){ return [...document.querySelectorAll('#extraSel div')].map(Q.R); },
  rowH(r){ const e=document.querySelector("#grid tbody tr[data-r='"+r+"']"); return e ? Math.round(e.getBoundingClientRect().height*100)/100 : null; },
  heads(){ return [...document.querySelectorAll('#grid tbody th.rh')].slice(0,12).map(h=>h.textContent).join(','); },
  cheads(){ return [...document.querySelectorAll('#grid thead th[data-c]')].slice(0,8).map(h=>h.textContent).join(','); },
  store(){ try { return JSON.parse(localStorage.getItem('bassxcel.v1')); } catch(e){ return null; } },
  sheet(){ const s=Q.store(); return s && (s.sheets ? s.sheets[s.active||0] : s.wb ? s.wb.sheets[s.wb.active||0] : s); },
  menu(text){ const d=[...document.querySelectorAll('#menu div')].find(x=>x.textContent===text); if(!d) return 'NO MENU '+text+' :: '+[...document.querySelectorAll('#menu div')].map(x=>x.textContent).join('|'); d.click(); return 'clicked '+text; },
  md(el, o){ el.dispatchEvent(new MouseEvent('mousedown',Object.assign({bubbles:true,cancelable:true,button:0,view:window},o))); },
  mm(el, o){ el.dispatchEvent(new MouseEvent('mousemove',Object.assign({bubbles:true,cancelable:true,view:window},o))); },
  mu(o){ document.dispatchEvent(new MouseEvent('mouseup',Object.assign({bubbles:true,view:window},o))); },
  colHead(c){ return document.querySelector('#grid thead th[data-c="'+c+'"]'); },
  rowHead(r){ return document.querySelector("#grid tbody tr[data-r='"+r+"'] th.rh"); },
  ctrlClickCol(c){ Q.md(Q.colHead(c),{ctrlKey:true}); Q.mu({}); return Q.nb(); },
  key(sel, o){ const el=document.querySelector(sel); el.focus(); const ev=new KeyboardEvent('keydown',Object.assign({bubbles:true,cancelable:true},o)); const r=el.dispatchEvent(ev); return {defaultPrevented: !r}; },
  ed(){ const e=document.getElementById('cellEditor'); return {display:getComputedStyle(e).display, value:e.value, focused: document.activeElement===e}; },
  toast(){ return document.getElementById('toast').textContent + (document.getElementById('toast').classList.contains('show')?' [show]':''); },
};
(function(){
  const q = document.getElementById('qaEval');
  q.addEventListener('keydown', async function(e){
    if (e.key !== 'Enter') return;
    e.stopPropagation(); e.preventDefault();
    const code = q.value; q.value = '';
    let out;
    try { out = (0, eval)(code); if (out && typeof out.then === 'function') out = await out; out = { ok: out === undefined ? null : out }; }
    catch (err) { out = { err: String(err && err.stack || err) }; }
    window.__qa.push(out);
    console.log('QA ' + JSON.stringify(out));
    if (document.activeElement === q) { q.blur(); const w = document.getElementById('gridWrap'); if (w) w.focus({ preventScroll: true }); }
  }, true);
})();
</script>`;
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Fuera de web/'); }   // sin salir de web/ con ..
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    if (path.basename(file) === 'index.html') data = Buffer.from(String(data).replace('</body>', BRIDGE + '\n</body>'));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('qa-serve ' + PORT + ' · ' + ROOT));

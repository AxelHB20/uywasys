// QA: recorre las pantallas de cada rol en escritorio y celular; anota errores de consola,
// respuestas 4xx/5xx inesperadas, desbordes horizontales y textos "undefined"/"NaN".
// Uso: con la API en la base de demo y `ng serve`: node e2e/qa-recorrido.cjs (ROLES=admin,vet ... MODES=tablet,tablet-h).
// Los IDs de las pantallas de detalle son de la demo local: ajústalos si regeneras la demo.
const { chromium, devices } = require('playwright');
require('node:fs').mkdirSync(__dirname + '/qa', { recursive: true });
const ROUTES = ['dashboard','reportes','reportes/margen','reportes/inventario','cola','atenciones','atenciones/8504','clientes','clientes/nuevo','clientes/2736','clientes/importar','grooming','grooming/comisiones','grooming/ingreso','hospitalizacion','hospitalizacion/113','plantillas','citas','consultas','vacunas','mascotas/1847','mascotas/1847/carnet','presupuestos','presupuestos/nuevo','presupuestos/162','recetas/3072','consentimientos/147','inventario','inventario/nuevo','inventario/controlados','inventario/433','servicios','caja','caja/tickets/9166','comprobantes','comprobantes/configuracion','configuracion','actividad','usuarios'];
const ROLES = (process.env.ROLES ?? 'admin,vet,reception,groomer,cashier').split(',');
const issues = [];
let visited = 0;
(async () => {
  const b = await chromium.launch();
  // MODES=desktop,mobile,tablet,tablet-h (tablet = iPad Mini vertical; tablet-h = horizontal)
  const MODES = (process.env.MODES ?? 'desktop,mobile').split(',');
  const CTX = {
    desktop: { viewport: { width: 1366, height: 800 } },
    mobile: { ...devices['iPhone 13'] },
    tablet: { ...devices['iPad Mini'] },
    'tablet-h': { ...devices['iPad Mini landscape'] },
  };
  for (const role of ROLES) for (const mode of MODES) {
    const ctx = await b.newContext(CTX[mode]);
    const p = await ctx.newPage();
    let current = '';
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) issues.push([role, mode, current, 'consola', m.text().slice(0, 160)]); });
    p.on('pageerror', (e) => issues.push([role, mode, current, 'excepción', e.message.slice(0, 160)]));
    p.on('response', (r) => { const s = r.status(); if (r.url().includes('/api/') && s >= 400 && s !== 401 && !(s === 403 && process.env.SHOW403 !== '1')) issues.push([role, mode, current, 'http ' + s, r.request().method() + ' ' + r.url().replace(/^.*\/api/, '/api').slice(0, 120)]); });
    await p.goto('http://localhost:4200/login');
    await p.fill('input[type=email]', `${role}@huellitas.pe`);
    await p.fill('input[type=password]', 'Demo2026clave');
    await p.click('button[type=submit]');
    await p.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
    for (const r of ROUTES) {
      current = r; visited++;
      await p.goto('http://localhost:4200/' + r);
      await p.waitForTimeout(900);
      const info = await p.evaluate(() => {
        const el = document.scrollingElement;
        const over = el.scrollWidth - window.innerWidth;
        const text = document.body.innerText;
        const bad = (text.match(/\b(undefined|NaN|null|\[object Object\])\b/g) || []).slice(0, 3);
        // elementos que se salen del ancho
        let wide = '';
        if (over > 2) for (const n of document.querySelectorAll('main *')) { const rc = n.getBoundingClientRect(); if (rc.right > window.innerWidth + 2 && rc.width < 2000 && getComputedStyle(n).position !== 'fixed') { wide = n.tagName.toLowerCase() + '.' + String(n.className).slice(0, 80); break; } }
        return { over, bad, wide, path: location.pathname };
      });
      if (info.over > 2) issues.push([role, mode, r, 'desborde', `${info.over}px ${info.wide}`]);
      if (info.bad.length) issues.push([role, mode, r, 'texto', info.bad.join(',')]);
      if (mode !== 'desktop' && (info.over > 2 || info.bad.length)) await p.screenshot({ path: `${__dirname}/qa/${role}-${r.replace(/\//g, '_')}.png` });
    }
    await ctx.close();
  }
  await b.close();
  const seen = new Set();
  for (const i of issues) { const k = i.slice(2).join('|'); if (seen.has(k + i[1])) continue; seen.add(k + i[1]); console.log(i.join(' · ')); }
  console.log('TOTAL', issues.length, 'páginas', visited);
})();

// Static files only. This preview never reads .env or contacts Airtable.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, isMain } from './sync-airtable.mjs';
import { ASSETS } from './build.mjs';
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8' };
export function preview({ root = resolve(ROOT, 'dist'), basePath = '/' } = {}) {
  if (!basePath.startsWith('/') || !basePath.endsWith('/') || basePath.includes('..')) throw new Error('Base path must start and end with /, e.g. /acotar-cosplay/.');
  const allowed = new Set([...ASSETS, 'data/catalog.json']);
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (basePath !== '/' && path === '/') { res.writeHead(302, { Location: basePath }); res.end(); return; }
    const relative = path.startsWith(basePath) ? path.slice(basePath.length) || 'index.html' : null;
    if (!allowed.has(relative)) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const body = await readFile(resolve(root, relative));
      res.writeHead(200, { 'Content-Type': types[relative.split('.').pop()], 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end('Build the site first with npm run build:snapshot.'); }
  });
}
if (isMain(import.meta.url)) {
  let port = 8765, basePath = '/';
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = Number(args[++i]);
    else if (args[i] === '--base-path') basePath = args[++i];
    else throw new Error('Usage: npm run preview -- [--port 8765] [--base-path /acotar-cosplay/]');
  }
  const server = preview({ basePath });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Stop the old preview or choose another --port.` : 'Preview could not start.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Static preview: http://127.0.0.1:${port}${basePath}\nRun npm run refresh in another terminal to import Airtable edits, then reload your browser.`));
}

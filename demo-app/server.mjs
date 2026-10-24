// Perch: a tiny demo product for the PigeonBox × Kane demo. Static files, clean URLs, no dependencies.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = Number(process.env.PERCH_PORT || 4480);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

async function resolveFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = clean === '/' ? ['index.html'] : [clean, `${clean}.html`, join(clean, 'index.html')];
  for (const candidate of candidates) {
    const file = join(root, candidate);
    if (!file.startsWith(root)) continue;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const file = await resolveFile(url.pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(root, '404.html')));
    return;
  }
  // No caching, so a fix is live on the next page load.
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(await readFile(file));
}).listen(port, '127.0.0.1', () => console.log(`Perch demo app on http://localhost:${port}`));

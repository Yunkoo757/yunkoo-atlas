import http from 'node:http';
import {createReadStream,existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(root,'../atlas-docs-site');
const port = Number(process.env.ATLAS_WEBSITE_PORT || 4175);
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
http.createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
  let pathname; try {pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);} catch {res.writeHead(400);res.end();return;}
  const guide = pathname === '/guide' || pathname.startsWith('/guide/');
  const base = guide ? docs : root;
  let relative = guide ? pathname.slice(6) : pathname;
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const filename = path.resolve(base,'.' + (relative.startsWith('/') ? relative : '/' + relative));
  const delta = path.relative(base,filename);
  if (delta.startsWith('..') || path.isAbsolute(delta) || !existsSync(filename) || !statSync(filename).isFile()) {res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('页面不存在');return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(filename)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD')res.end();else createReadStream(filename).pipe(res);
}).listen(port,'127.0.0.1',() => console.log(`Atlas 官网: http://127.0.0.1:${port} · 使用指南: /guide/`));

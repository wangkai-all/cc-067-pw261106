/* 零依赖静态服务器：node serve.mjs 后访问 http://localhost:8080 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const PORT = process.env.PORT || 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const filePath = normalize(join(process.cwd(), rel));
  if (!filePath.startsWith(process.cwd())) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('404 Not Found');
  }
}).listen(PORT, () => {
  console.log(`实验室样本接收台（演示）已启动：http://localhost:${PORT}`);
});

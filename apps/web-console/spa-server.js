const { createServer } = require('http');
const { readFileSync, existsSync, statSync, createReadStream } = require('fs');
const { join, extname } = require('path');

const DIST = join(__dirname, 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  const filePath = join(DIST, url === '/' ? '/index.html' : url);

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(filePath).pipe(res);
  } else {
    const html = readFileSync(join(DIST, 'index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    res.end(html);
  }
}).listen(5199, '0.0.0.0', () => console.log('SPA server on :5199'));

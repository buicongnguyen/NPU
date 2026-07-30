import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';

const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  const value = args[index + 1];
  if (!['--port', '--root'].includes(name) || value === undefined || value.startsWith('--')) {
    throw new Error(`Usage: node scripts/serve.mjs [--port PORT] [--root DIRECTORY]`);
  }
  if (options.has(name)) throw new Error(`Duplicate option: ${name}`);
  options.set(name, value);
}

const port = Number(options.get('--port') ?? 4173);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid port: ${options.get('--port') ?? port}`);
}

const requestedRoot = resolve(process.cwd(), options.get('--root') ?? '.');
const root = await realpath(requestedRoot);
const rootInfo = await stat(root);
if (!rootInfo.isDirectory()) throw new Error(`Server root is not a directory: ${requestedRoot}`);

const pagesBasePath = '/NPU';
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp']
]);
const compressibleExtensions = new Set(['.css', '.html', '.js', '.json', '.svg']);

function acceptsGzip(headerValue) {
  if (typeof headerValue !== 'string') return false;

  let wildcardQuality = null;
  for (const value of headerValue.split(',')) {
    const [rawCoding, ...parameters] = value.trim().toLowerCase().split(';');
    let quality = 1;
    for (const parameter of parameters) {
      const match = parameter.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/);
      if (match) quality = Number(match[1]);
    }
    if (rawCoding === 'gzip') return quality > 0;
    if (rawCoding === '*') wildcardQuality = quality;
  }
  return (wildcardQuality ?? 0) > 0;
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8'
      }).end('Method not allowed');
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === pagesBasePath || pathname === `${pagesBasePath}/`) {
      pathname = '/index.html';
    } else if (pathname.startsWith(`${pagesBasePath}/`)) {
      pathname = pathname.slice(pagesBasePath.length);
    } else if (pathname === '/') {
      pathname = '/index.html';
    }
    const requestedFile = resolve(root, `.${pathname}`);
    if (requestedFile === root || !requestedFile.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    const file = await realpath(requestedFile);
    if (file === root || !file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    const extension = extname(file).toLowerCase();
    const shouldCompress =
      compressibleExtensions.has(extension) &&
      acceptsGzip(request.headers['accept-encoding']);
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes.get(extension) ?? 'application/octet-stream',
      Vary: 'Accept-Encoding'
    };
    if (shouldCompress) headers['Content-Encoding'] = 'gzip';
    response.writeHead(200, headers);
    if (request.method === 'HEAD') response.end();
    else if (shouldCompress) createReadStream(file).pipe(createGzip()).pipe(response);
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving NPU Study Guide from ${root} at http://127.0.0.1:${port}`);
});

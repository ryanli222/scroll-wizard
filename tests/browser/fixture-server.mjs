// Dependency-free static server for the browser smoke suite. Serves the
// shipped template files as-is, swaps in a small deterministic config, and
// synthesizes 8 tiny PNG frames on the fly so the suite needs no fixture
// binaries checked into the repo.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const templateDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'template');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function makePng(red, green, blue) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.from([0, red, green, blue, red, green, blue]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A single hold overlay with a CTA covers the focus/inert and reduced-motion
// assertions. frames.count must exceed the engine's decode window
// (radius 12 -> 25 frames) so the decoded-bitmap bound is falsifiable:
// with 30 frames, decodedCount > 25 means eviction is broken.
const config = {
  brand: {
    name: 'Fixture',
    tagline: 'Fixture tagline',
    imageAlt: 'Fixture hero scene',
  },
  theme: {
    bg: '#050607',
    text: '#f7f8f2',
    accent: '#dfff57',
    surface: 'rgba(5, 6, 7, 0.78)',
    radius: 12,
    fonts: { display: 'Georgia, serif', body: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  },
  frames: {
    count: 30,
    pattern: 'frames/frame-{index:4}.webp',
    poster: 'frames/frame-0001.webp',
  },
  scrub: { heightVh: 250, smoothing: 0.12 },
  overlays: [
    {
      at: [0.05, 0.98],
      hold: true,
      title: 'Fixture hold',
      body: 'Fixture overlay body copy.',
      position: 'left',
      cta: { label: 'Learn more', href: '#learn' },
    },
  ],
};

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(res, pathname) {
  const relative = normalize(pathname === '/' ? '/index.html' : pathname)
    .replace(/^([/\\]\.\.)+/, '');
  const filePath = join(templateDir, relative);
  if (filePath !== templateDir && !filePath.startsWith(templateDir + '\\')
      && !filePath.startsWith(templateDir + '/')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

const framePattern = /^\/frames\/frame-(\d{4})\.webp$/;

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1');

  if (pathname === '/config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(config));
    return;
  }

  const frameMatch = framePattern.exec(pathname);
  if (frameMatch) {
    const n = Number(frameMatch[1]);
    res.writeHead(200, { 'Content-Type': 'image/png' });
    // & 255 keeps channels in range past frame 10; 25 is odd (invertible
    // mod 256), so every frame index still gets a distinct color.
    res.end(makePng((n * 25) & 255, 20, (255 - n * 25) & 255));
    return;
  }

  await serveStatic(res, pathname);
});

server.listen(4173, '127.0.0.1', () => {
  console.log('Fixture server listening on http://127.0.0.1:4173');
});

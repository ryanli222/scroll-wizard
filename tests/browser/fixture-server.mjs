// Dependency-free static server for the browser smoke suite. Serves the
// shipped template files as-is, swaps in a small deterministic config, and
// synthesizes tiny frame and video assets on the fly so the suite needs no
// fixture binaries checked into the repo.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const templateDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'template');
const videoFixtureDir = mkdtempSync(join(tmpdir(), 'scroll-wizard-video-'));
const videoPath = join(videoFixtureDir, 'video.webm');
const videoPosterPath = join(videoFixtureDir, 'poster.webp');
const cleanup = () => rmSync(videoFixtureDir, { recursive: true, force: true });
process.once('exit', cleanup);

let videoFixtureStatus = { available: true };
try {
  const ffmpeg = process.env.SCROLL_WIZARD_FFMPEG || 'ffmpeg';
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=12',
    '-c:v', 'libvpx-vp9', '-g', '1', '-crf', '40', '-b:v', '0', videoPath,
  ]);
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x180:rate=1',
    '-frames:v', '1', videoPosterPath,
  ]);
} catch (error) {
  videoFixtureStatus = {
    available: false,
    reason: 'VP9 fixture unavailable: ' + (error.code || error.message),
  };
}

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

const videoConfig = {
  ...config,
  scrub: { heightVh: 400, smoothing: 0.12, mode: 'video' },
  video: {
    src: 'media/video.webm',
    poster: 'media/poster.webp',
    duration: 9,
  },
};
delete videoConfig.frames;

const catalogConfig = {
  ...videoConfig,
  catalog: {
    items: [
      { name: 'Original', image: 'catalog/original.webp', hoverImage: 'catalog/original-alt.webp' },
      { name: 'Oolong', image: 'catalog/oolong.webp' },
    ],
    grid: true,
    carousel: true,
  },
};

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

const FIXTURE_PREFIXES = ['/video', '/catalog'];

function stripFixturePrefix(pathname) {
  for (const prefix of FIXTURE_PREFIXES) {
    if (pathname === prefix || pathname === prefix + '/') return '/index.html';
    if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length);
  }
  return pathname;
}

async function serveStatic(res, pathname) {
  const sitePath = stripFixturePrefix(pathname);
  const relative = normalize(sitePath === '/' ? '/index.html' : sitePath)
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

  if (pathname === '/video-fixture-status.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(videoFixtureStatus));
    return;
  }

  if (pathname === '/config.json' || pathname === '/video/config.json'
      || pathname === '/catalog/config.json') {
    const body = pathname === '/video/config.json' ? videoConfig
      : pathname === '/catalog/config.json' ? catalogConfig
      : config;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
    return;
  }

  if (pathname === '/video/media/video.webm') {
    if (!videoFixtureStatus.available) {
      res.writeHead(503).end(videoFixtureStatus.reason);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes['.webm'] });
    res.end(await readFile(videoPath));
    return;
  }

  if (pathname === '/video/media/poster.webp') {
    if (!videoFixtureStatus.available) {
      res.writeHead(503).end(videoFixtureStatus.reason);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes['.webp'] });
    res.end(await readFile(videoPosterPath));
    return;
  }

  if (pathname === '/catalog/media/video.webm') {
    if (!videoFixtureStatus.available) {
      res.writeHead(503).end(videoFixtureStatus.reason);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes['.webm'] });
    res.end(await readFile(videoPath));
    return;
  }

  if (pathname === '/catalog/media/poster.webp') {
    if (!videoFixtureStatus.available) {
      res.writeHead(503).end(videoFixtureStatus.reason);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes['.webp'] });
    res.end(await readFile(videoPosterPath));
    return;
  }

  const catalogImageMatch = /^\/catalog\/catalog\/(original|original-alt|oolong)\.webp$/.exec(pathname);
  if (catalogImageMatch) {
    // Same convention as the /frames/frame-*.webp route below: a .webp-named
    // URL served as a tiny synthesized PNG, since content is sniffed from
    // bytes, not the URL extension.
    res.writeHead(200, { 'Content-Type': 'image/png' });
    const shade = { original: 200, 'original-alt': 80, oolong: 140 }[catalogImageMatch[1]];
    res.end(makePng(shade, 120, 60));
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

const requestedPort = Number.parseInt(process.env.PORT ?? '4173', 10);
const port = Number.isInteger(requestedPort) ? requestedPort : 4173;
server.listen(port, '127.0.0.1', () => {
  console.log('Fixture server listening on http://127.0.0.1:' + port);
});

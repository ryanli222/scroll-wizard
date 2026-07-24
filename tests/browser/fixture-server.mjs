// Dependency-free static server for the browser smoke suite. Serves the
// shipped template files as-is, swaps in a small deterministic config, and
// synthesizes tiny frame and video assets on the fly so the suite needs no
// fixture binaries checked into the repo.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const templateDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'template');
const directionPresets = JSON.parse(readFileSync(
  join(templateDir, '..', 'references', 'directions.json'), 'utf8',
));

function applyDirection(configValue, direction) {
  const preset = directionPresets[direction];
  return {
    ...configValue,
    direction,
    theme: {
      ...preset.theme,
      fonts: { ...preset.theme.fonts },
    },
    directionPreset: {
      motion: { ...preset.motion },
      chromeStyle: preset.chromeStyle,
      scrimStrength: preset.scrimStrength,
    },
  };
}
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
  outro: {
    headline: 'Fixture outro',
    body: 'Fixture closing copy.',
    cta: { label: 'Finish', href: '#finish' },
  },
};

const variantOverlays = [
  {
    at: [0.05, 0.95],
    title: 'Fixture bare',
    body: 'Bare body copy over representative footage.',
    kicker: 'Coordinate A',
    showIndex: true,
    position: 'left',
    variant: 'bare',
    anchor: 'top',
    stats: [{ value: '18 h', label: 'Battery' }],
    cta: { label: 'Primary action', href: '#primary' },
  },
  {
    at: [0.05, 0.95],
    title: 'Fixture hero',
    body: 'Large centered type for the hero variant.',
    position: 'center',
    variant: 'hero',
    anchor: 'middle',
  },
  {
    at: [0.05, 0.95],
    title: 'Fixture caption',
    body: 'Understated caption copy.',
    position: 'right',
    variant: 'caption',
    anchor: 'bottom',
  },
  {
    at: [0.05, 0.95],
    title: '98%',
    body: 'Measured efficiency.',
    position: 'right',
    variant: 'metric',
    anchor: 'top',
  },
  {
    at: [0.05, 0.95],
    title: 'Fixture panel',
    body: 'The sole backdrop-filter surface.',
    position: 'left',
    variant: 'panel',
    anchor: 'middle',
  },
  {
    at: [0.05, 0.95],
    title: 'Fixture annotation',
    body: 'Pinned to a normalized point on the source.',
    position: 'center',
    variant: 'annotation',
    anchor: 'bottom',
    point: [0.8, 0.35],
  },
];

const variantsConfig = applyDirection({
  ...config,
  overlays: variantOverlays,
}, 'technical');

const rawCinematicConfig = {
  ...config,
  direction: 'cinematic',
};

const sectionsConfig = {
  ...config,
  sections: [
    { type: 'masthead', headline: 'Fixture masthead', sub: 'Fixture tagline' },
    { type: 'scrub-hero' },
    { type: 'feature-split', headline: 'Fixture feature', side: 'right', media: { kind: 'image', src: 'frames/frame-0001.webp', alt: 'Fixture media' } },
    { type: 'statement', text: 'Fixture statement' },
    { type: 'spec', headline: 'Fixture spec', rows: [{ label: 'Battery', value: '18 h', beat: 0 }] },
    { type: 'gallery', headline: 'Fixture gallery', items: [{ src: 'frames/frame-0001.webp', alt: 'Fixture gallery image', beat: 0 }] },
    { type: 'cta', headline: 'Fixture CTA', cta: { label: 'Finish', href: '#finish' }, emailCapture: true, background: 'frames/frame-0001.webp' },
  ],
};
const interactiveConfig = {
  ...sectionsConfig,
  scrub: { ...sectionsConfig.scrub, jump: { minMs: 400, maxMs: 900, pxPerMs: 2.2 } },
  hotspots: [{ point: [0.8, 0.35], target: 0, label: 'Fixture hotspot' }],
  config: { options: [{ id: 'a', label: 'Fixture A', tint: '#102030' }, { id: 'b', label: 'Fixture B', tint: '#301020' }] },
  sections: sectionsConfig.sections.map((section) => ['masthead', 'spec', 'gallery', 'cta'].includes(section.type) ? { ...section, navLabel: 'Nav ' + section.type } : section),
};
const legacyConfig = { ...config };

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

const videoInteractiveConfig = {
  ...videoConfig,
  config: { options: [{ id: 'base', label: 'Base' }, { id: 'alt', label: 'Alt', src: 'media/video.webm', poster: 'media/poster.webp' }] },
};
const videoVariantsConfig = applyDirection({
  ...videoConfig,
  overlays: variantOverlays,
}, 'technical');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

async function serveStatic(res, pathname) {
  const sitePath = pathname === '/video' || pathname === '/video/'
    ? '/index.html'
    : pathname.startsWith('/video/')
      ? pathname.slice('/video'.length)
      : pathname;
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

  if (pathname === '/config.json' || pathname === '/video/config.json') {
    const isVideo = pathname.startsWith('/video/');
    let selectedConfig = isVideo ? videoConfig : config;
    if (req.headers.referer) {
      try {
        const referrer = new URL(req.headers.referer);
        const requestedFixture = referrer.searchParams.get('config') ?? referrer.searchParams.get('fixture');
        if (requestedFixture === 'interactive') {
          selectedConfig = isVideo ? videoInteractiveConfig : interactiveConfig;
        } else if (requestedFixture === 'sections') {
          selectedConfig = sectionsConfig;
        } else if (requestedFixture === 'legacy') {
          selectedConfig = legacyConfig;
        } else if (requestedFixture === 'variants') {
          if (isVideo) {
            selectedConfig = videoVariantsConfig;
          } else {
            const direction = referrer.searchParams.get('direction') ?? 'technical';
            selectedConfig = applyDirection(variantsConfig, direction);
          }
        } else if (!isVideo && requestedFixture === 'raw-cinematic') {
          selectedConfig = rawCinematicConfig;
        }
      } catch {
        // Ignore malformed referrers and keep the default deterministic fixture.
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(selectedConfig));
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
